/**
 * effective_context.ts — 유효 컨텍스트 조립기 (Effective Context Resolver)
 *
 * 원본 DB + 동적 상태 + 작가 개입을 조합해 생성 직전 최종 컨텍스트를 만든다.
 *
 * ── 우선순위 규칙 ─────────────────────────────────────────────
 * 1. 절대금지 규칙 (어떤 경우도 override 불가)
 * 2. 시스템 안전 제한
 * 3. 작가 개입 (일반 규칙 override 가능)
 * 4. 일반 세계관 규칙
 * 5. 작품 기본 설정
 * 6. 회차 목표/연출 설정
 * 7. 스타일/표현 선호
 */

import { pool } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";
import { getProfile } from "./profile.js";
import { getOpenForeshadows } from "./foreshadow.js";
import { getArcSummaries, getLatestCharacterArcs } from "./arc_memory.js";
import {
  getCanonicalCharacters,
  getLatestDynamicStates,
  getInferredStates,
  getActiveInterventions,
  getWorldRules,
} from "./character_state.js";
import type {
  EffectiveContext, GenConfig, WorldConfig, AuthorIntervention,
  EpisodeTask, PrevEpisodeState,
} from "../types/canonical.js";

const DEFAULT_GEN_CONFIG: GenConfig = {
  pov: "3인칭 관찰자",
  style: "균형",
  conflict: 5, foreshadow: 5, emotion: 5, dialogue: 5, direction: 5,
  episodeLength: 2000, episodeLengthVar: 500,
  totalEpisodes: 30, totalEpisodesVar: 5,
};

const DEFAULT_PREV_STATE: PrevEpisodeState = {
  ending_event: "",
  current_locations: {},
  current_time: "",
  character_physical_states: {},
  environment_changes: [],
  open_foreshadows: [],
  remaining_resources: {},
  continuity_notes: [],
  updated_states: [],
  active_interventions: [],
};

/**
 * buildEffectiveContext — book_id + episode_number 기준으로 유효 컨텍스트 조립
 *
 * @param opts.overrideGenConfig  API 호출 시 전달된 gen_config (optional)
 * @param opts.overrideTask       API 호출 시 전달된 task (optional)
 * @param opts.overridePrevState  API 호출 시 전달된 prev_episode_state (optional)
 */
export async function buildEffectiveContext(opts: {
  bookId: string;
  episodeNumber: number;
  overrideGenConfig?: Partial<GenConfig>;
  overrideTask?: Partial<EpisodeTask>;
  overridePrevState?: Partial<PrevEpisodeState>;
}): Promise<EffectiveContext> {
  const { bookId, episodeNumber } = opts;

  // ── 병렬 로드 ────────────────────────────────────────────────
  const [
    worldBibleRaw,
    worldConfigRow,
    worldRules,
    interventions,
    canonicalChars,
    dynamicStates,
    inferredStates,
    readerProfile,
    foreshadows,
    arcSummaries,
    rollingSummaryRows,
    prevTailRow,
  ] = await Promise.allSettled([
    bookId ? redis.get(`context:${bookId}`) : Promise.resolve(null),
    bookId ? pool.query(`SELECT background,genre,mood,theme,common_tone FROM world_configs WHERE book_id=$1`, [bookId]).catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] }),
    bookId ? getWorldRules(bookId) : Promise.resolve([]),
    bookId ? getActiveInterventions(bookId, episodeNumber) : Promise.resolve([]),
    bookId ? getCanonicalCharacters(bookId) : Promise.resolve([]),
    bookId ? getLatestDynamicStates(bookId, episodeNumber - 1) : Promise.resolve([]),
    bookId ? getInferredStates(bookId, undefined, "confirmed") : Promise.resolve([]),
    bookId ? getProfile(bookId) : Promise.resolve({ focus: 55, sentiment: 55, urgency: 50, complexity: 55, dialogue: 55, audio_sync: 40 }),
    bookId ? getOpenForeshadows(bookId) : Promise.resolve([]),
    bookId ? getArcSummaries(bookId) : Promise.resolve([]),
    bookId && episodeNumber > 1
      ? pool.query(`SELECT episode_number, summary FROM episodes WHERE book_id=$1 ORDER BY episode_number DESC LIMIT 5`, [bookId])
      : Promise.resolve({ rows: [] }),
    bookId && episodeNumber > 1
      ? pool.query(`SELECT content FROM episodes WHERE book_id=$1 AND episode_number=$2`, [bookId, episodeNumber - 1])
      : Promise.resolve({ rows: [] }),
  ]);

  // ── World Bible (기존 형식 호환) ──────────────────────────────
  let legacyWorldBible: {
    world_rules?: string[];
    character_defaults?: Record<string, string>;
    fixed_relationships?: string[];
    forbidden_settings?: string[];
    story_config?: Partial<GenConfig>;
  } = {};
  if (worldBibleRaw.status === "fulfilled" && worldBibleRaw.value) {
    try { legacyWorldBible = JSON.parse(worldBibleRaw.value); } catch {}
  }

  // ── World Config ──────────────────────────────────────────────
  const wConfigRow = worldConfigRow.status === "fulfilled" ? (worldConfigRow.value as any).rows[0] : null;
  const worldConfig: WorldConfig = {
    background: wConfigRow?.background ?? "",
    genre: wConfigRow?.genre ?? legacyWorldBible.story_config?.genre ?? "",
    mood: wConfigRow?.mood ?? "",
    theme: wConfigRow?.theme ?? undefined,
    common_tone: wConfigRow?.common_tone ?? undefined,
  };

  // ── Gen Config 조립 (우선순위: override > world_bible.story_config > default) ──
  const genConfig: GenConfig = {
    ...DEFAULT_GEN_CONFIG,
    ...(legacyWorldBible.story_config ?? {}),
    ...(opts.overrideGenConfig ?? {}),
  };

  // ── 규칙 분리 ──────────────────────────────────────────────────
  const rules = worldRules.status === "fulfilled" ? worldRules.value : [];
  const generalRules   = rules.filter(r => r.rule_type === "general").map(r => r.content);
  const absoluteForbid = rules.filter(r => r.rule_type === "absolute_forbidden").map(r => r.content);

  // 기존 WorldBible 규칙도 흡수 (world_rules → general, forbidden_settings → absolute_forbidden)
  if (legacyWorldBible.world_rules?.length)     generalRules.push(...legacyWorldBible.world_rules);
  if (legacyWorldBible.forbidden_settings?.length) absoluteForbid.push(...legacyWorldBible.forbidden_settings);

  // ── 작가 개입 — 절대금지와 충돌 제거 ────────────────────────
  const activeInterventions: AuthorIntervention[] = (
    interventions.status === "fulfilled" ? interventions.value : []
  ).filter(i => !i.conflicts_absolute);

  const blockedCount = (interventions.status === "fulfilled" ? interventions.value : []).length - activeInterventions.length;
  if (blockedCount > 0) {
    logWarn("service:effective_context", "절대금지 충돌 개입 차단", { book_id: bookId, blocked: blockedCount });
  }

  // ── Characters ────────────────────────────────────────────────
  const canonicalRaw = canonicalChars.status === "fulfilled" ? canonicalChars.value : [];

  // personality 필드에서 중복 prefix 제거: "[유형: X, 성별: Y] ..." → "..."
  const canonical = canonicalRaw.map(c => ({
    ...c,
    personality: c.personality?.replace(/^\[유형:[^\]]+\]\s*/, "") ?? c.personality,
  }));

  // 주인공 인물을 배열 맨 앞으로 정렬 (LLM이 첫 번째 인물을 주인공으로 인식하는 경향 대응)
  canonical.sort((a, b) => {
    const aIsProtag = /주인공/.test(a.personality ?? "") ? 0 : 1;
    const bIsProtag = /주인공/.test(b.personality ?? "") ? 0 : 1;
    return aIsProtag - bIsProtag;
  });

  // 기존 character_defaults에서 canonical이 없으면 변환
  if (!canonical.length && legacyWorldBible.character_defaults) {
    for (const [name, raw] of Object.entries(legacyWorldBible.character_defaults)) {
      // 새 형식: 객체 { type, gender, description } 또는 레거시: 문자열
      if (raw && typeof raw === "object") {
        const obj = raw as Record<string, string>;
        canonical.push({
          name,
          personality: obj.description ?? obj.personality ?? name,
          type: obj.type ?? "인간",
          gender: obj.gender ?? "해당없음",
        });
      } else {
        const desc = raw as string;
        const gender = desc.includes("성별: 여") ? "여성"
          : desc.includes("성별: 남") ? "남성" : "해당없음";
        canonical.push({ name, personality: desc.replace(/^\[유형:[^\]]+\]\s*/, ""), type: "인간", gender });
      }
    }
  }

  const dynStates = dynamicStates.status === "fulfilled" ? dynamicStates.value : [];
  const infStates = inferredStates.status === "fulfilled" ? inferredStates.value : [];

  // ── Character Arcs (기존 서비스) ──────────────────────────────
  const charNames = canonical.map(c => c.name);
  let characterArcs: Record<string, { state: string; key_events: string[] }> = {};
  if (charNames.length && bookId) {
    try {
      const arcs = await getLatestCharacterArcs(bookId, charNames);
      characterArcs = Object.fromEntries(
        Object.entries(arcs).map(([n, a]) => [n, { state: a.state, key_events: a.key_events }])
      );
    } catch {}
  }

  // ── Rolling Summary ────────────────────────────────────────────
  let rollingSummary = "";
  if (rollingSummaryRows.status === "fulfilled") {
    const rows = (rollingSummaryRows.value as any).rows as any[];
    rollingSummary = [...rows].reverse().map((r: any) => `${r.episode_number}화: ${r.summary}`).join("\n");
  }

  // ── Prev Episode Tail ─────────────────────────────────────────
  let prevEpisodeTail: string | undefined;
  if (prevTailRow.status === "fulfilled") {
    const content: string = (prevTailRow.value as any).rows[0]?.content ?? "";
    if (content) prevEpisodeTail = content.slice(-300);
  }

  // ── Prev Episode State 조립 ────────────────────────────────────
  const prevState: PrevEpisodeState = {
    ...DEFAULT_PREV_STATE,
    // dynamic state에서 위치/물리 상태 자동 추출
    current_locations: Object.fromEntries(
      dynStates.filter(s => s.location).map(s => [s.character_name, s.location!])
    ),
    character_physical_states: Object.fromEntries(
      dynStates.filter(s => s.physical_state).map(s => [s.character_name, s.physical_state!])
    ),
    active_interventions: activeInterventions.map(i => i.instruction),
    ...opts.overridePrevState,
  };

  // ── Task ───────────────────────────────────────────────────────
  // task.goal — 세계관·장르 정보를 담아 플래너에 의미 있는 방향 제공
  const _genre  = (worldConfig as any)?.genre  ? `장르: ${(worldConfig as any).genre}` : "";
  const _bg     = (worldConfig as any)?.background ? `배경: ${(worldConfig as any).background}` : "";
  const _goal   = [`${episodeNumber}화`, _genre, _bg].filter(Boolean).join(" / ");
  const task: EpisodeTask = {
    goal: _goal,
    ...opts.overrideTask,
  };

  const ctx: EffectiveContext = {
    episode_number: episodeNumber,
    gen_config: genConfig,
    world_config: worldConfig,
    general_rules: [...new Set(generalRules)],
    absolute_forbidden: [...new Set(absoluteForbid)],
    active_interventions: activeInterventions,
    characters: canonical,
    character_dynamic_states: dynStates,
    character_inferred_states: infStates,
    prev_episode_state: prevState,
    task,
    foreshadow_memory: foreshadows.status === "fulfilled"
      ? (foreshadows.value as any[]).map(f => ({ id: f.id, planted_episode: f.planted_episode, content: f.content, keywords: f.keywords }))
      : [],
    arc_summaries: arcSummaries.status === "fulfilled"
      ? (arcSummaries.value as any[]).map(a => ({ arc_number: a.arc_number, episode_start: a.episode_start, episode_end: a.episode_end, summary: a.summary }))
      : [],
    character_arcs: characterArcs,
    rolling_summary: rollingSummary,
    prev_episode_tail: prevEpisodeTail,
    reader_profile: readerProfile.status === "fulfilled" ? readerProfile.value : { focus: 55, sentiment: 55, urgency: 50, complexity: 55, dialogue: 55, audio_sync: 40 },
  };

  logInfo("service:effective_context", "유효 컨텍스트 조립 완료", {
    book_id: bookId,
    episode: episodeNumber,
    general_rules: ctx.general_rules.length,
    absolute_forbidden: ctx.absolute_forbidden.length,
    interventions: ctx.active_interventions.length,
    characters: ctx.characters.length,
    dynamic_states: ctx.character_dynamic_states.length,
    foreshadows: ctx.foreshadow_memory.length,
  });

  return ctx;
}

/** episode_snapshots에 유효 컨텍스트 저장 */
export async function saveEpisodeSnapshot(ctx: EffectiveContext): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO episode_snapshots
         (book_id, episode_number, gen_config, world_config, prev_episode_state, task, effective_context)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (book_id, episode_number) DO UPDATE
         SET gen_config=$3, world_config=$4, prev_episode_state=$5, task=$6,
             effective_context=$7, created_at=NOW()`,
      [
        (ctx as any).book_id ?? "", ctx.episode_number,
        JSON.stringify(ctx.gen_config),
        JSON.stringify(ctx.world_config),
        JSON.stringify(ctx.prev_episode_state),
        JSON.stringify(ctx.task),
        JSON.stringify(ctx),
      ]
    );
  } catch (err) {
    logError("service:effective_context", err, { context: "saveEpisodeSnapshot" });
  }
}

/**
 * effectiveContextToStoryContext — 기존 StoryContext 형식으로 변환 (하위 호환)
 */
export function effectiveContextToStoryContext(ctx: EffectiveContext) {
  const charDefaults: Record<string, string> = {};
  for (const c of ctx.characters) {
    const dyn = ctx.character_dynamic_states.find(d => d.character_name === c.name);
    const parts = [
      `성격: ${c.personality}`, `유형: ${c.type}`, `성별: ${c.gender}`,
    ];
    if (dyn?.location) parts.push(`현재 위치: ${dyn.location}`);
    if (dyn?.physical_state) parts.push(`상태: ${dyn.physical_state}`);
    if (dyn?.items?.length) parts.push(`소지품: ${dyn.items.join(", ")}`);
    charDefaults[c.name] = parts.join(" | ");
  }

  return {
    worldBible: {
      world_rules: ctx.general_rules,
      character_defaults: charDefaults,
      fixed_relationships: [],
      forbidden_settings: ctx.absolute_forbidden,
      story_config: {
        pov: ctx.gen_config.pov,
        style: ctx.gen_config.style,
        episodeLength: ctx.gen_config.episodeLength,
        episodeLengthVar: ctx.gen_config.episodeLengthVar,
        totalEpisodes: ctx.gen_config.totalEpisodes,
        totalEpisodesVar: ctx.gen_config.totalEpisodesVar,
        conflict: ctx.gen_config.conflict,
        foreshadow: ctx.gen_config.foreshadow,
        emotion: ctx.gen_config.emotion,
        dialogue: ctx.gen_config.dialogue,
        direction: ctx.gen_config.direction,
      },
    },
    readerProfile: ctx.reader_profile,
    rollingSummary: ctx.rolling_summary,
    directorOverrides: ctx.active_interventions.map(i => i.instruction),
    foreshadowMemory: ctx.foreshadow_memory,
    arcSummaries: ctx.arc_summaries,
    characterArcs: ctx.character_arcs,
    episodeNumber: ctx.episode_number,
    prevEpisodeTail: ctx.prev_episode_tail,
    userPrompt: buildTaskUserPrompt(ctx),
  };
}

function buildTaskUserPrompt(ctx: EffectiveContext): string | undefined {
  const task = ctx.task;
  if (!task.goal && !task.required_events?.length && !task.ending_hook_direction) return undefined;

  const parts: string[] = [];
  if (task.goal) parts.push(`이번 화 목표: ${task.goal}`);
  if (task.required_events?.length) parts.push(`반드시 보여줄 사건: ${task.required_events.join(", ")}`);
  if (task.hidden_info?.length) parts.push(`이번 화에서 숨길 정보: ${task.hidden_info.join(", ")}`);
  if (task.ending_hook_direction) parts.push(`엔딩 훅 방향: ${task.ending_hook_direction}`);

  return `${ctx.episode_number}화를 ${ctx.gen_config.pov} 시점으로 생성해줘.\n${parts.join("\n")}`;
}
