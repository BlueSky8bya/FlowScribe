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
  EpisodeTask, PrevEpisodeState, ContinuityContract, EpisodeDeltaContract,
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
    if (content) prevEpisodeTail = content.slice(-900);
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

  // ── Continuity Contract (ep >= 2) ─────────────────────────────
  const foreshadowList: Array<{ id: string; planted_episode: number; content: string; keywords: string[] }> =
    foreshadows.status === "fulfilled" ? (foreshadows.value as any[]).map(f => ({ id: f.id, planted_episode: f.planted_episode, content: f.content, keywords: f.keywords })) : [];

  const continuityContract: ContinuityContract | undefined = episodeNumber >= 2
    ? buildContinuityContract(episodeNumber, dynStates, characterArcs, foreshadowList, prevEpisodeTail, rollingSummary)
    : undefined;

  const episodeDeltaContract: EpisodeDeltaContract | undefined = episodeNumber >= 2
    ? buildEpisodeDeltaContract(episodeNumber, dynStates, characterArcs, foreshadowList, prevEpisodeTail, rollingSummary)
    : undefined;

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
    foreshadow_memory: foreshadowList,
    arc_summaries: arcSummaries.status === "fulfilled"
      ? (arcSummaries.value as any[]).map(a => ({ arc_number: a.arc_number, episode_start: a.episode_start, episode_end: a.episode_end, summary: a.summary }))
      : [],
    character_arcs: characterArcs,
    rolling_summary: rollingSummary,
    prev_episode_tail: prevEpisodeTail,
    continuity_contract: continuityContract,
    episode_delta_contract: episodeDeltaContract,
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

/**
 * buildContinuityContract — ep >= 2 생성 시 직전 화 상태를 구조화된 계약으로 변환.
 * LLM에게 "이미 알려진 사실"과 "금지된 퇴행"을 명시해 서사 연속성을 강제한다.
 */
function buildContinuityContract(
  episodeNumber: number,
  dynStates: Array<{ character_name: string; location?: string | null; emotional_state?: string | null; recent_goal?: string | null; items?: any[] | null; physical_state?: string | null }>,
  characterArcs: Record<string, { state: string; key_events: string[] }>,
  foreshadows: Array<{ content: string; keywords: string[] }>,
  prevTail?: string,
  rollingSummary?: string,
): ContinuityContract {
  // known_facts: 인물 아크 key_events + recent_goal
  const known_facts: string[] = [];
  for (const [name, arc] of Object.entries(characterArcs)) {
    for (const ev of arc.key_events.slice(-4)) {
      if (ev.trim()) known_facts.push(`${name}: ${ev}`);
    }
  }
  for (const s of dynStates) {
    if (s.recent_goal) known_facts.push(`${s.character_name} 현재 목표: ${s.recent_goal}`);
  }

  // arc가 없는 단편(< 10화)에서는 rolling_summary를 known_facts 보충에 사용
  // rolling_summary 각 줄 "N화: ..." = 이미 발생한 사건의 요약
  if (known_facts.length < 3 && rollingSummary) {
    const summaryLines = rollingSummary.split("\n").filter(l => /^\d+화:/.test(l.trim()));
    for (const line of summaryLines.slice(-(episodeNumber - 1))) {
      const content = line.replace(/^\d+화:\s*/, "").trim();
      if (content.length > 10) known_facts.push(content);
    }
  }

  // relationship_state: 인물 아크 state 필드 (arc 없으면 dynamic state emotional/goal로 보충)
  const relationship_state: string[] = [];
  for (const [name, arc] of Object.entries(characterArcs)) {
    if (arc.state) relationship_state.push(`${name}: ${arc.state}`);
  }
  // arc가 없으면 dynamic state에서 감정/상태로 간이 relationship_state 구성
  if (relationship_state.length === 0) {
    for (const s of dynStates) {
      const parts: string[] = [];
      if (s.emotional_state) parts.push(`감정: ${s.emotional_state}`);
      if (s.recent_goal) parts.push(`목표: ${s.recent_goal}`);
      if (parts.length) relationship_state.push(`${s.character_name}: ${parts.join(", ")}`);
    }
  }

  // open_threads: 복선 메모리
  const open_threads: string[] = foreshadows.map(f => f.content).filter(Boolean);

  // forbidden_regressions: 핵심 이벤트에서 자동 파생
  const forbidden_regressions: string[] = [
    "이미 만난 인물을 처음 만나는 장면으로 반복하지 말 것.",
    "이미 발생한 만남·대화·약속·고백을 처음 일어나는 것처럼 다시 처리하지 말 것.",
    "인물 관계 상태를 직전 화보다 낮은 단계로 되돌리지 말 것.",
    "직전 화에 등장한 소지품을 근거(획득·상실·파손) 없이 바꾸지 말 것.",
    "직전 화에서 열린 B플롯을 이번 화에서 완전히 사라지게 하지 말 것.",
  ];
  // 관계 단어가 아크에 있으면 더 구체적인 regression 추가
  for (const [name, arc] of Object.entries(characterArcs)) {
    if (/돕기로|약속|동맹|신뢰/.test(arc.key_events.join(""))) {
      forbidden_regressions.push(`${name}와의 협력/신뢰 관계를 직전 화보다 소원한 상태로 되돌리지 말 것.`);
    }
    if (/처음 만남|첫 대화|발견/.test(arc.key_events.join(""))) {
      forbidden_regressions.push(`${name}와의 첫 만남 장면을 이번 화에서 반복하지 말 것.`);
    }
  }

  // last_state: prevTail 마지막 2문장 요약 or 동적 상태
  const lastStateLines: string[] = [];
  if (prevTail) {
    const sentences = prevTail.replace(/\s+/g, " ").split(/(?<=[.!?"])\s+/).filter(Boolean);
    lastStateLines.push(sentences.slice(-3).join(" "));
  } else {
    for (const s of dynStates.slice(0, 3)) {
      const parts = [s.character_name];
      if (s.location) parts.push(`위치: ${s.location}`);
      if (s.emotional_state) parts.push(`감정: ${s.emotional_state}`);
      lastStateLines.push(parts.join(", "));
    }
  }

  return {
    mode: "next_episode",
    must_continue_from: {
      episode: episodeNumber - 1,
      last_state: lastStateLines.join(" / "),
    },
    known_facts,
    relationship_state,
    open_threads,
    forbidden_regressions,
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

/**
 * buildEpisodeDeltaContract — ep >= 2 생성 시 "이번 화 진전 강제 계약" 조립.
 * LLM에게 이미 발생한 사건을 반복하지 말고 반드시 전진하도록 명시한다.
 * 규칙 기반 deterministic: LLM 호출 없음.
 */
function buildEpisodeDeltaContract(
  episodeNumber: number,
  dynStates: Array<{ character_name: string; location?: string | null; emotional_state?: string | null; recent_goal?: string | null; physical_state?: string | null }>,
  characterArcs: Record<string, { state: string; key_events: string[] }>,
  foreshadows: Array<{ content: string; keywords: string[] }>,
  prevTail?: string,
  rollingSummary?: string,
): EpisodeDeltaContract {
  const prevEp = episodeNumber - 1;

  // ── previous_episode_facts: 직전 화 확정 사실 ─────────────────
  const previous_episode_facts: string[] = [];
  for (const [name, arc] of Object.entries(characterArcs)) {
    for (const ev of arc.key_events.slice(-3)) {
      if (ev.trim()) previous_episode_facts.push(`[${name}] ${ev}`);
    }
  }
  if (previous_episode_facts.length < 2 && rollingSummary) {
    const lines = rollingSummary.split("\n").filter(l => new RegExp(`^${prevEp}화:`).test(l.trim()));
    for (const line of lines) {
      const content = line.replace(/^\d+화:\s*/, "").trim();
      if (content.length > 8) previous_episode_facts.push(content);
    }
  }

  // ── previous_episode_end_state: 직전 화 끝 상태 ───────────────
  const previous_episode_end_state: string[] = [];
  if (prevTail) {
    const sentences = prevTail.replace(/\s+/g, " ").split(/(?<=[.!?"])\s+/).filter(Boolean);
    previous_episode_end_state.push(...sentences.slice(-2));
  }
  for (const s of dynStates.slice(0, 4)) {
    const parts: string[] = [];
    if (s.emotional_state) parts.push(`감정: ${s.emotional_state}`);
    if (s.physical_state)  parts.push(`신체: ${s.physical_state}`);
    if (s.recent_goal)     parts.push(`목표: ${s.recent_goal}`);
    if (parts.length) previous_episode_end_state.push(`${s.character_name} — ${parts.join(", ")}`);
  }

  // ── repetition_risk: 반복 위험 패턴 감지 ──────────────────────
  // rolling_summary에서 같은 패턴(의식상실/기절/쓰러짐 등)이 반복되면 경고
  const REPEAT_PATTERNS: Array<{ re: RegExp; label: string }> = [
    { re: /의식을?\s*(잃|잃어|상실)/, label: "의식 상실" },
    { re: /기절/, label: "기절" },
    { re: /쓰러|쓰러짐/, label: "쓰러짐" },
    { re: /혼란|혼돈|혼수/, label: "혼란/혼수" },
    { re: /처음\s*(만|발견|알게)/, label: "처음 만남/발견" },
    { re: /위협(을|이|에)?\s*(받|감지|느)/, label: "같은 위협 감지" },
    { re: /균열.{0,15}(나타|열|발생)/, label: "균열 반복 출현" },
  ];
  const repetition_risk: Array<{ pattern: string; reason: string }> = [];

  if (rollingSummary) {
    const recentLines = rollingSummary
      .split("\n")
      .filter(l => /^\d+화:/.test(l.trim()))
      .slice(-(Math.min(episodeNumber - 1, 3)));  // 최근 3화 분석

    for (const { re, label } of REPEAT_PATTERNS) {
      const matchingEps = recentLines.filter(l => re.test(l));
      if (matchingEps.length >= 2) {
        repetition_risk.push({
          pattern: label,
          reason: `최근 ${matchingEps.length}화 연속 같은 패턴 감지: ${matchingEps.map(l => l.slice(0, 40)).join(" / ")}`,
        });
      }
    }
  }

  // prevTail에서도 체크
  if (prevTail) {
    for (const { re, label } of REPEAT_PATTERNS.slice(0, 4)) {
      if (re.test(prevTail) && !repetition_risk.some(r => r.pattern === label)) {
        repetition_risk.push({
          pattern: label,
          reason: `직전 화 말미에서 '${label}' 패턴 감지 — 이번 화에서 같은 방식으로 반복 금지`,
        });
      }
    }
  }

  // ── must_not_repeat: 반복 금지 항목 ───────────────────────────
  const must_not_repeat: string[] = [
    `직전 화(${prevEp}화) 마지막 사건을 이번 화(${episodeNumber}화)에서 새 사건처럼 다시 시작하지 말 것.`,
    `이미 발생한 만남·고백·결정·각성을 처음 일어나는 것처럼 다시 쓰지 말 것.`,
    `인물이 이미 알고 있는 정보를 다시 처음 알게 하지 말 것.`,
  ];
  // 반복 위험 패턴별 금지 추가
  for (const r of repetition_risk) {
    must_not_repeat.push(`'${r.pattern}' 패턴이 이번 화에서도 핵심 사건으로 반복되는 것 금지.`);
  }
  // 직전 화의 확정 사건을 명시적으로 반복 금지
  for (const fact of previous_episode_facts.slice(0, 3)) {
    must_not_repeat.push(`이미 확정된 사건 — "${fact}" — 을 다시 처음처럼 서술하지 말 것.`);
  }

  // ── must_progress: 반드시 전진해야 할 항목 ───────────────────
  const must_progress: string[] = [
    `이번 화는 ${prevEp}화의 결과/후속 행동으로 시작해야 한다.`,
    `각 인물은 직전 상태에서 최소 하나의 새 변화(새 정보 획득, 새 결정, 새 행동)가 있어야 한다.`,
  ];
  for (const s of dynStates.slice(0, 3)) {
    if (s.recent_goal) {
      must_progress.push(`${s.character_name}: "${s.recent_goal}" 목표가 이번 화에서 진전되거나 변화해야 한다.`);
    }
  }
  if (foreshadows.length > 0) {
    must_progress.push(`미해결 복선 중 최소 하나를 이번 화에서 진전시켜야 한다: ${foreshadows.slice(0, 2).map(f => f.content).join(", ")}`);
  }

  // ── newly_required_changes: 이번 화에서 새로 변해야 하는 것 ─
  const newly_required_changes: string[] = [
    `직전 화 말미 상태에서 적어도 하나의 외부 사건 또는 인물 내면 변화가 새로 발생해야 한다.`,
    `플롯이 정체(같은 위협/장소/상황의 반복)되지 않도록 새 요소를 도입해야 한다.`,
  ];

  // ── character_delta_requirements ──────────────────────────────
  const character_delta_requirements: EpisodeDeltaContract["character_delta_requirements"] = [];
  for (const s of dynStates) {
    const arc = characterArcs[s.character_name];
    const recentEvent = arc?.key_events?.slice(-1)[0] ?? "";
    const forbidden: string[] = [];
    if (recentEvent) forbidden.push(`직전 화 사건 반복: "${recentEvent.slice(0, 40)}"`);
    if (s.emotional_state) forbidden.push(`감정 상태를 "${s.emotional_state}"로 그대로 유지만 하는 것`);

    character_delta_requirements.push({
      character_name: s.character_name,
      previous_state: [
        s.emotional_state ? `감정: ${s.emotional_state}` : "",
        s.recent_goal ? `목표: ${s.recent_goal}` : "",
        s.physical_state ? `신체: ${s.physical_state}` : "",
      ].filter(Boolean).join(", ") || "알 수 없음",
      required_change: `새 사건, 새 결정, 또는 이전 목표에 대한 구체적 진전`,
      forbidden_regression: forbidden,
    });
  }

  // ── plot_delta_requirements: open threads ─────────────────────
  const plot_delta_requirements: EpisodeDeltaContract["plot_delta_requirements"] = [];
  for (const f of foreshadows.slice(0, 4)) {
    plot_delta_requirements.push({
      thread: f.content.slice(0, 60),
      previous_status: "미해결/진행 중",
      required_progress: "이번 화에서 구체적 진전(단서 발견, 위협 현실화, 해결 시도)이 있어야 함",
      forbidden_repeat: [`"${f.content.slice(0, 30)}" 상황을 변화 없이 다시 언급만 하는 것`],
    });
  }
  // rolling_summary에서 미해결 스레드 추출 (간단 키워드 기반)
  if (plot_delta_requirements.length === 0 && rollingSummary) {
    const openThreadKws = ["계획", "추적", "비밀", "갈등", "임무", "봉인", "수색"];
    for (const kw of openThreadKws) {
      if (rollingSummary.includes(kw) && plot_delta_requirements.length < 2) {
        plot_delta_requirements.push({
          thread: `${kw} 관련 미해결 스레드`,
          previous_status: "진행 중",
          required_progress: "이번 화에서 새 단계로 진전",
          forbidden_repeat: [`${kw} 상황을 변화 없이 반복 언급`],
        });
      }
    }
  }

  return {
    episode_number: episodeNumber,
    previous_episode_facts,
    previous_episode_end_state,
    must_progress,
    must_not_repeat,
    newly_required_changes,
    character_delta_requirements,
    plot_delta_requirements,
    repetition_risk,
  };
}
