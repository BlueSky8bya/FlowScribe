import { Router, Request, Response } from "express";
import { streamEpisode } from "../services/story.js";
import type { StoryContext } from "../services/story.js";
import { pool } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { getProfile, getProfileByUser } from "../services/profile.js";
import { getOpenForeshadows } from "../services/foreshadow.js";
import { getArcSummaries, getLatestCharacterArcs } from "../services/arc_memory.js";
import { getLatestDynamicStates, commitDynamicState } from "../services/character_state.js";
import { buildEffectiveContext } from "../services/effective_context.js";
import { runPlannerPipeline } from "../pipeline/index.js";
import { scheduleBackgroundAudit } from "../training/background_audit.js";
import { enterGeneration, exitGeneration } from "../lib/generation_guard.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";
import jwt from "jsonwebtoken";

function softGetUserId(req: Request): string | undefined {
  try {
    const token = req.cookies?.fs_token ?? req.headers.authorization?.replace("Bearer ", "");
    if (!token) return undefined;
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id?: string };
    return decoded.id ?? undefined;
  } catch { return undefined; }
}

export const generateRouter = Router();

const defaultContext: StoryContext = {
  worldBible: {
    world_rules: [],
    character_defaults: {},
    fixed_relationships: [],
    forbidden_settings: [],
  },
  readerProfile: { focus: 70, sentiment: 60, urgency: 50, complexity: 55, dialogue: 60, audio_sync: 40 },
  rollingSummary: "",
  directorOverrides: [],
  foreshadowMemory: [],
  arcSummaries: [],
  characterArcs: {},
  episodeNumber: 1,
};


generateRouter.get("/", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => clearInterval(heartbeat));

  const episode    = parseInt((req.query.episode as string) ?? "1", 10);
  const bookId     = req.query.book_id as string | undefined;
  const userPrompt = req.query.prompt as string | undefined;
  const userId     = softGetUserId(req);
  const usePlanner = req.query.use_planner === "true" && !!bookId;
  // renderer/planner 모델 오버라이드 (표적 재생성용 — 운영 환경에서는 사용 금지)
  const rendererModelOverride = req.query.renderer_model as string | undefined;
  const plannerModelOverride  = req.query.planner_model  as string | undefined;
  // 1화 재생성 다양성 유도용 nonce (클라이언트가 regenerate() 시 전달)
  const regenNonce = req.query.regen_nonce as string | undefined;

  // ── Planner 경로 (use_planner=true) ─────────────────────────
  if (usePlanner) {
    enterGeneration();
    try {
      logInfo("api:generate", "플래너 경로 시작", { book_id: bookId, episode });
      const ctx = await buildEffectiveContext({ bookId: bookId!, episodeNumber: episode });

      // 재생성 감지 — 같은 회차의 모든 이전 시도 beat 목록을 누적 주입
      try {
        const prevTraces = await pool.query(
          `SELECT planner_trace FROM run_traces
           WHERE book_id=$1 AND episode_number=$2
           ORDER BY created_at DESC LIMIT 6`,
          [bookId!, episode]
        );
        type BeatRow = { beat_number: number; summary: string; location?: string };
        const allBeatSets: string[] = [];
        for (const row of prevTraces.rows) {
          const pt = row.planner_trace as Record<string, any> | null;
          const beats = pt?.parsed_plan?.scene_beats as BeatRow[] | null;
          if (beats?.length) {
            allBeatSets.push(
              beats.map(b => `  Beat${b.beat_number}(${b.location ?? "?"}): ${b.summary}`).join("\n")
            );
          }
        }
        if (allBeatSets.length) {
          (ctx as any).regen_prev_text = allBeatSets
            .map((set, i) => `[시도 ${allBeatSets.length - i}]\n${set}`)
            .join("\n");
        }
        // 1화 재생성: regen_nonce가 있으면 이전 장소 avoid_list 추출하여 주입
        if (regenNonce && episode === 1 && allBeatSets.length) {
          const locRe = /Beat\d+\(([^)]+)\)/g;
          const prevLocs = new Set<string>();
          for (const s of allBeatSets) { let m; while ((m = locRe.exec(s)) !== null) if (m[1] !== "?") prevLocs.add(m[1]); }
          if (prevLocs.size) (ctx as any).regen_avoid_locations = [...prevLocs];
        }
      } catch { /* 무시 */ }

      // 직전 3화 hook_type 주입 (P1: hook 단일 고착 방지)
      try {
        const recentHookRows = await pool.query(
          `SELECT DISTINCT ON (episode_number) episode_number,
                  planner_trace->>'hook_type' AS hook_type
           FROM run_traces
           WHERE book_id=$1 AND episode_number < $2 AND planner_trace->>'hook_type' IS NOT NULL
           ORDER BY episode_number DESC, created_at DESC
           LIMIT 3`,
          [bookId!, episode]
        );
        if (recentHookRows.rows.length >= 2) {
          (ctx as any).recent_hook_types = recentHookRows.rows
            .reverse()
            .map((r: { hook_type: string }) => r.hook_type);
        }
      } catch { /* 무시 */ }
      const t_ctx = Date.now();
      logInfo("api:generate", "buildEffectiveContext 완료", { book_id: bookId, episode, elapsed_ms: t_ctx - Date.now() });
      const result = await runPlannerPipeline(ctx, {
        bookId: bookId!,
        doRevise: false,
        doValidate: false,
        tracePool: pool,
        onStatus: (msg) => res.write(`data: ${JSON.stringify({ status: msg })}\n\n`),
        rendererModelOverride,
        plannerModelOverride,
      });

      // 텍스트를 token SSE로 전송 (generate.js의 json.token 핸들러가 수신)
      res.write(`data: ${JSON.stringify({ token: result.generated_text })}\n\n`);

      // 에피소드 자동 저장 (rolling_summary가 다음 화에서 작동하도록)
      if (result.generated_text.trim()) {
        try {
          const clean = result.generated_text
            .replace(/\[CLIFF[\]\n]?/g, "").replace(/\[END\]/gi, "").trim();
          await pool.query(
            `INSERT INTO episodes (book_id, episode_number, content)
             VALUES ($1, $2, $3)
             ON CONFLICT (book_id, episode_number) DO UPDATE SET content = EXCLUDED.content`,
            [bookId!, episode, clean]
          );
          await pool.query(
            `UPDATE books SET current_episode = GREATEST(current_episode, $1), updated_at = NOW() WHERE id = $2`,
            [episode + 1, bookId!]
          );
          logInfo("api:generate", "에피소드 자동 저장 완료", { book_id: bookId, episode });
        } catch (saveErr) {
          logWarn("api:generate", "에피소드 자동 저장 실패 (skip)", { error: String(saveErr) });
        }
      }

      // fresh char_states (planner가 commitDynamicState 완료 후)
      const freshStates = (await getLatestDynamicStates(bookId!, episode).catch(() => []));
      const wbCtxDefs = ctx.characters ?? [];
      const freshCharStates = freshStates.map(s => {
        const canon = wbCtxDefs.find(c => c.name === s.character_name);
        const dynItems: any[] = s.items ?? [];
        const fallbackItems: any[] = (canon as any)?.initial_items ?? [];
        return {
          character_name:   s.character_name,
          type:             canon?.type            ?? null,
          gender:           canon?.gender          ?? null,
          location:         s.location             ?? null,
          physical_state:   s.physical_state       ?? null,
          items:            dynItems.length > 0 ? dynItems : fallbackItems,
          emotional_state:  s.emotional_state      ?? null,
          visibility_state: s.visibility_state     ?? "present",
          recent_goal:      s.recent_goal          ?? null,
          is_new_character: !canon,
        };
      });

      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify({
        done: true, chars: result.generated_text.length, char_states: freshCharStates,
        episode_meta: {
          plan_verdict: result.plan_validation.verdict,
          final_score: result.final_score,
          revision_count: result.revision_count,
          plan_fallback_used: result.plan_fallback_used,
        },
      })}\n\n`);
      res.end();
      exitGeneration();

      // ── Background Audit (reader_fast 완료 후 비동기) ────────────
      // result.trace_id: pipeline이 저장한 기존 trace에 reward v2를 보완 적용
      scheduleBackgroundAudit(ctx, result, bookId!, pool, result.trace_id);

      logInfo("api:generate", "플래너 경로 완료", {
        book_id: bookId, episode, chars: result.generated_text.length,
        plan_verdict: result.plan_validation.verdict,
      });
    } catch (err) {
      exitGeneration();
      clearInterval(heartbeat);
      logError("api:generate", err, { book_id: bookId, episode, context: "planner_path" });
      res.write(`data: ${JSON.stringify({ error: "generation failed" })}\n\n`);
      res.end();
    }
    return;
  }
  // ── Legacy 경로 ──────────────────────────────────────────────
  // 주의: DPO 수집 및 운영 생성에는 use_planner=true (pipeline 경로)를 사용해야 한다.
  // 이 경로는 pipeline 미적용 시에만 동작하며, canonical name 정규화가 적용되지 않는다.
  logWarn("api:generate", "legacy_path — use_planner 미설정 또는 book_id 없음. DPO 수집에는 반드시 use_planner=true를 사용할 것", { book_id: bookId, episode });

  // 병렬 로드: World Bible + Reader Profile + Director Overrides
  // Reader Profile: userId 기반 우선, 없으면 레거시 bookId 키 fallback
  const profileLoader = userId
    ? getProfileByUser(userId)
    : bookId ? getProfile(bookId) : Promise.resolve(defaultContext.readerProfile);

  const [worldBibleRaw, readerProfileResult, overridesRaw] = await Promise.allSettled([
    bookId ? redis.get(`context:${bookId}`) : Promise.resolve(null),
    profileLoader,
    bookId ? redis.get(`overrides:${bookId}`) : Promise.resolve(null),
  ]);

  // ── World Bible ───────────────────────────────────────
  let worldBible = defaultContext.worldBible;
  if (worldBibleRaw.status === "fulfilled" && worldBibleRaw.value) {
    try {
      worldBible = JSON.parse(worldBibleRaw.value);
      logInfo("api:generate", "World Bible 로드", {
        book_id: bookId, episode,
        world_rules: worldBible.world_rules.length,
        characters: Object.keys(worldBible.character_defaults),
        has_story_config: !!worldBible.story_config,
      });
    } catch (err) {
      logError("api:generate", err, { context: "World Bible 파싱 실패", book_id: bookId });
    }
  } else if (bookId) {
    logWarn("api:generate", "World Bible 없음 — 기본값", { book_id: bookId, episode });
  }

  // ── Reader Profile ────────────────────────────────────
  let readerProfile = defaultContext.readerProfile;
  if (readerProfileResult.status === "fulfilled") {
    readerProfile = readerProfileResult.value;
    logInfo("api:generate", "Reader Profile 로드", { user_id: userId ?? null, book_id: bookId, profile: readerProfile });
  } else {
    logError("api:generate", readerProfileResult.reason, { context: "Reader Profile 실패", user_id: userId ?? null, book_id: bookId });
  }

  // ── Director Overrides (L0) ───────────────────────────
  let directorOverrides: string[] = [];
  if (overridesRaw.status === "fulfilled" && overridesRaw.value) {
    try {
      directorOverrides = JSON.parse(overridesRaw.value);
      logInfo("api:generate", "Director Overrides 로드", {
        book_id: bookId, count: directorOverrides.length,
        overrides: directorOverrides,
      });
    } catch (err) {
      logError("api:generate", err, { context: "Director Overrides 파싱 실패", book_id: bookId });
    }
  }

  const characterNames = Object.keys(worldBible.character_defaults);

  // 병렬 로드: Rolling Summary + Open Foreshadows + Arc Summaries + Character Arcs + 직전 화 tail
  const [summaryResult, foreshadowResult, arcResult, charArcResult, prevTailResult] = await Promise.allSettled([
    // Rolling Summary: 직전 5화 (100화에서도 직근 맥락)
    bookId && episode > 1
      ? pool.query(
          `SELECT episode_number, summary FROM episodes
           WHERE book_id = $1 ORDER BY episode_number DESC LIMIT 5`,
          [bookId]
        )
      : Promise.resolve({ rows: [] }),
    // 전체 open 복선 (DB 기반, 화수 제한 없음)
    bookId ? getOpenForeshadows(bookId) : Promise.resolve([]),
    // 아크 요약 (10화 단위 압축 기억)
    bookId ? getArcSummaries(bookId) : Promise.resolve([]),
    // 최신 인물 상태
    bookId && characterNames.length
      ? getLatestCharacterArcs(bookId, characterNames)
      : Promise.resolve({}),
    // 직전 화 마지막 300자 (연속성 강화)
    bookId && episode > 1
      ? pool.query(
          `SELECT content FROM episodes
           WHERE book_id = $1 AND episode_number = $2`,
          [bookId, episode - 1]
        )
      : Promise.resolve({ rows: [] }),
  ]);

  // ── Rolling Summary ───────────────────────────────────
  let rollingSummary = "";
  if (summaryResult.status === "fulfilled") {
    const rows = summaryResult.value.rows;
    rollingSummary = rows.reverse().map((r: any) => `${r.episode_number}화: ${r.summary}`).join("\n");
    if (rows.length) {
      logInfo("api:generate", "Rolling Summary 로드", {
        book_id: bookId, episode,
        loaded_episodes: rows.length,
        ep_range: rows.length ? `${rows[0].episode_number}~${rows[rows.length - 1].episode_number}화` : "-",
      });
    }
  } else {
    logError("api:generate", summaryResult.reason, { context: "Rolling Summary 실패", book_id: bookId });
  }

  // ── Open Foreshadows ─────────────────────────────────
  const foreshadowMemory = foreshadowResult.status === "fulfilled" ? foreshadowResult.value : [];
  if (foreshadowMemory.length) {
    logInfo("api:generate", "Open 복선 로드", {
      book_id: bookId, episode,
      count: foreshadowMemory.length,
      oldest_episode: Math.min(...foreshadowMemory.map(f => f.planted_episode)),
    });
  }

  // ── Arc Summaries ─────────────────────────────────────
  const arcSummaries = arcResult.status === "fulfilled" ? arcResult.value : [];
  if (arcSummaries.length) {
    logInfo("api:generate", "아크 요약 로드", {
      book_id: bookId, episode,
      arcs: arcSummaries.length,
      arc_range: `Arc1~Arc${arcSummaries[arcSummaries.length - 1]?.arc_number}`,
    });
  }

  // ── Character Arcs ────────────────────────────────────
  const characterArcs = charArcResult.status === "fulfilled" ? charArcResult.value : {};

  // ── 직전 화 마지막 300자 ──────────────────────────────
  let prevEpisodeTail: string | undefined;
  if (prevTailResult.status === "fulfilled") {
    const prevContent: string = prevTailResult.value.rows[0]?.content ?? "";
    if (prevContent.length > 0) prevEpisodeTail = prevContent.slice(-300);
  }

  const ctx: StoryContext = {
    ...defaultContext,
    worldBible,
    readerProfile,
    rollingSummary,
    directorOverrides,
    foreshadowMemory,
    arcSummaries,
    characterArcs,
    episodeNumber: episode,
    userPrompt,
    prevEpisodeTail,
  };

  logInfo("api:generate", "생성 시작", {
    book_id: bookId, episode,
    has_user_prompt: !!userPrompt,
    director_overrides: directorOverrides.length,
    open_foreshadows: foreshadowMemory.length,
    arc_count: arcSummaries.length,
  });

  // World Bible에서 캐릭터 이름 목록 — seed 대상
  const wbCharNames = Object.keys(worldBible.character_defaults ?? {});

  try {
    const t0       = Date.now();
    const fullText = await streamEpisode(ctx, res);

    // 생성 완료 후: DB에 없는 캐릭터는 초기 dynamic state seed (fire-and-forget)
    if (bookId && wbCharNames.length) {
      (async () => {
        try {
          const existing = await getLatestDynamicStates(bookId, episode);
          const existingNames = new Set(existing.map(s => s.character_name));
          const toSeed = wbCharNames.filter(n => !existingNames.has(n));
          for (const name of toSeed) {
            await commitDynamicState({
              book_id: bookId, character_name: name, episode_number: episode,
              location: undefined, physical_state: undefined, items: [],
              recent_goal: undefined, relationship_updates: {}, foreshadow_connections: [],
              behavior_hints: undefined, alias_used: [], emotional_state: undefined, visibility_state: "present",
            });
          }
          if (toSeed.length) {
            logInfo("api:generate", "캐릭터 초기 동적 상태 seed", { book_id: bookId, episode, seeded: toSeed });
          }
        } catch (seedErr) {
          logError("api:generate", seedErr, { context: "char_state_seed", book_id: bookId, episode });
        }
      })();
    }

    // 생성 완료 후 최신 dynamic state 조회 (seed 포함)
    const wbDefs = worldBible.character_defaults ?? {};
    const rawSnapshot = bookId
      ? (await getLatestDynamicStates(bookId, episode).catch(() => []))
      : [];

    // DB snapshot에 WB type/gender merge
    const charStateSnapshot = rawSnapshot.map(s => ({
      character_name:  s.character_name,
      type:            (wbDefs[s.character_name] as any)?.type   ?? null,
      gender:          (wbDefs[s.character_name] as any)?.gender ?? null,
      location:        s.location        ?? null,
      physical_state:  s.physical_state  ?? null,
      items:           s.items           ?? [],
      emotional_state: s.emotional_state ?? null,
      visibility_state: s.visibility_state ?? "present",
    }));

    // fallback: DB 조회 실패해도 World Bible 캐릭터 이름 + type/gender는 표시
    const finalSnapshot = charStateSnapshot.length > 0
      ? charStateSnapshot
      : wbCharNames.map(name => ({
          character_name: name,
          type:            (wbDefs[name] as any)?.type   ?? null,
          gender:          (wbDefs[name] as any)?.gender ?? null,
          location: null, physical_state: null,
          items: [], emotional_state: null, visibility_state: "present" as const,
        }));

    logInfo("api:generate", "char_states 스냅샷", {
      book_id: bookId, episode,
      char_count: finalSnapshot.length,
      from_db: charStateSnapshot.length > 0,
      names: finalSnapshot.map(s => s.character_name),
    });

    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ done: true, chars: fullText.length, char_states: finalSnapshot })}\n\n`);
    res.end();
    logInfo("api:generate", "생성 완료", {
      book_id: bookId, episode,
      chars: fullText.length,
      elapsed_ms: Date.now() - t0,
    });
  } catch (err) {
    clearInterval(heartbeat);
    logError("api:generate", err, { book_id: bookId, episode });
    res.write(`data: ${JSON.stringify({ error: "generation failed" })}\n\n`);
    res.end();
  }
});

// ── 캐릭터 상태 전용 엔드포인트 (에피소드 로드 시 패널 복원용) ──
generateRouter.get("/char-states", async (req: Request, res: Response) => {
  const bookId = req.query.book_id as string;
  const episode = parseInt((req.query.episode as string) ?? "1", 10);
  if (!bookId) { res.status(400).json({ error: "book_id 필수" }); return; }

  try {
    // canonical_characters DB에서 type/gender/initial_items 조회
    const canonicalRows = await pool.query(
      `SELECT name, type, gender, initial_items FROM canonical_characters WHERE book_id=$1`,
      [bookId]
    ).catch(() => ({ rows: [] as any[] }));
    const canonicalMap: Record<string, { type: string | null; gender: string | null; initial_items: any[] }> = {};
    for (const r of canonicalRows.rows) {
      canonicalMap[r.name] = {
        type: r.type ?? null,
        gender: r.gender ?? null,
        initial_items: Array.isArray(r.initial_items) ? r.initial_items : [],
      };
    }

    // WB에서 type/gender 조회 (canonical 없을 때 fallback)
    let wbDefs: Record<string, any> = {};
    const wbRaw = await redis.get(`context:${bookId}`).catch(() => null);
    if (wbRaw) {
      try { wbDefs = JSON.parse(wbRaw).character_defaults ?? {}; } catch {}
    }

    const dynStates = await getLatestDynamicStates(bookId, episode);
    let charStates = dynStates.map(s => {
      // canonical DB 우선, 없으면 WB 파싱
      const canonical = canonicalMap[s.character_name];
      const wb = wbDefs[s.character_name];
      const type   = canonical?.type   ?? (typeof wb === "object" ? wb?.type   : null) ?? (typeof wb === "string" ? wb.match(/유형:\s*([^,|\]]+)/)?.[1]?.trim() : null) ?? null;
      const gender = canonical?.gender ?? (typeof wb === "object" ? wb?.gender : null) ?? (typeof wb === "string" ? wb.match(/성별:\s*([^,|\]]+)/)?.[1]?.trim() : null) ?? null;
      // dynamic items 우선, 없으면 canonical initial_items 폴백
      const dynItems: any[] = s.items ?? [];
      const fallbackItems: any[] = canonicalMap[s.character_name]?.initial_items ?? [];
      return {
        character_name:  s.character_name,
        type, gender,
        location:        s.location        ?? null,
        physical_state:  s.physical_state  ?? null,
        items:           dynItems.length > 0 ? dynItems : fallbackItems,
        emotional_state: s.emotional_state ?? null,
        visibility_state: s.visibility_state ?? "present",
        recent_goal:     s.recent_goal     ?? null,
      };
    });

    // fallback: DB에 없으면 canonical_characters 혹은 World Bible character_defaults에서 이름 + 기본 속성 추출
    if (!charStates.length) {
      const fallbackNames = Object.keys(canonicalMap).length > 0
        ? Object.keys(canonicalMap)
        : Object.keys(wbDefs);
      charStates = fallbackNames.map(name => {
        const canonical = canonicalMap[name];
        const info = wbDefs[name];
        let type: string | null = canonical?.type ?? null;
        let gender: string | null = canonical?.gender ?? null;
        if (!type && typeof info === "string") {
          type   = info.match(/유형:\s*([^,|\]]+)/)?.[1]?.trim() ?? null;
        } else if (!type && info && typeof info === "object") {
          type   = info.type   ?? null;
        }
        if (!gender && typeof info === "string") {
          gender = info.match(/성별:\s*([^,|\]]+)/)?.[1]?.trim() ?? null;
        } else if (!gender && info && typeof info === "object") {
          gender = info.gender ?? null;
        }
        return {
          character_name: name,
          type, gender,
          location: null, physical_state: null,
          items: canonicalMap[name]?.initial_items ?? [],
          emotional_state: null, visibility_state: "present" as const,
          recent_goal: null,
        };
      });
    }

    logInfo("api:generate", "char-states 조회", { book_id: bookId, episode, count: charStates.length });
    res.json({ char_states: charStates });
  } catch (err) {
    logError("api:generate", err, { context: "char-states", book_id: bookId });
    res.status(500).json({ error: String(err) });
  }
});

// ── background audit 완료 여부 조회 (debug drawer용) ─────────
generateRouter.get("/audit-status", async (req: Request, res: Response) => {
  const bookId  = req.query.book_id as string;
  const episode = parseInt((req.query.episode as string) ?? "0", 10);
  if (!bookId || !episode) { res.status(400).json({ error: "book_id, episode 필수" }); return; }

  try {
    // 최신 trace를 무조건 가져온 뒤 audit 완료 여부를 직접 판단
    // (computed_reward IS NOT NULL 조건을 걸면 audit 대기 중인 최신 trace를 건너뛰고
    //  이전 생성의 stale 데이터를 반환하는 문제가 생김)
    const result = await pool.query(
      `SELECT trace_id, final_verdict, final_score, revision_count,
              computed_reward, audit_elapsed_ms, created_at,
              planner_trace, plan_validation, renderer_trace,
              prose_validation, revision_traces,
              effective_context_snapshot,
              is_planner_sft_eligible, is_renderer_sft_eligible
       FROM run_traces
       WHERE book_id = $1 AND episode_number = $2
       ORDER BY created_at DESC LIMIT 1`,
      [bookId, episode]
    );
    if (!result.rows.length) {
      res.json({ status: "pending" });
      return;
    }
    const row = result.rows[0];
    // audit 아직 미완료 — 최신 trace는 있지만 reward 계산 전
    if (row.computed_reward == null) {
      res.json({
        status: "pending",
        trace_id:   row.trace_id,
        created_at: row.created_at,
      });
      return;
    }
    const reward  = row.computed_reward   as Record<string, any>    | null;
    const pt      = row.planner_trace     as Record<string, any>    | null;
    const pval    = row.plan_validation   as Record<string, any>    | null;
    const rt      = row.renderer_trace    as Record<string, any>    | null;
    const pv      = row.prose_validation  as Record<string, any>    | null;
    const revs    = (row.revision_traces  as Record<string, any>[]  | null) ?? [];
    const ic      = pt?.input_contract    as Record<string, any>    | null;
    const ctx     = row.effective_context_snapshot as Record<string, any> | null;
    const ee      = reward?.episode_extended as Record<string, any>  | null;
    const r3 = (v: number | null | undefined) => v != null ? Math.round(v * 1000) / 1000 : null;
    res.json({
      status: "done",
      verdict:         row.final_verdict,
      score:           row.final_score,
      revision_count:  row.revision_count,
      // 집계 보상
      combined_reward:              r3(reward?.combined_reward),
      planner_reward:               r3(reward?.planner_reward),
      renderer_reward:              r3(reward?.renderer_reward),
      reward_schema_version:        reward?.reward_schema_version ?? null,
      // 세부 보상 breakdown
      breakdown: reward ? {
        plan_structure:             r3(reward.plan_structure_score),
        hook_concreteness:          r3(reward.hook_concreteness),
        ending_hook:                r3(reward.ending_hook),
        world_rule_usage:           r3(reward.world_rule_usage),
        intervention_adherence:     r3(reward.intervention_adherence),
        hard_violation:             r3(reward.hard_violation_penalty),
        absolute_forbidden:         r3(reward.absolute_forbidden_penalty),
        revision_penalty:           r3(reward.revision_penalty),
      } : null,
      // Episode-level reward v2 (background_audit 완료 후 채워짐)
      episode_extended: ee ? {
        hard_gate_failed:            ee.hard_gate_failed   ?? null,
        hard_gate_reasons:           ee.hard_gate_reasons  ?? [],
        episode_extended_score:      r3(ee.episode_extended_score),
        state_completeness:          r3(ee.state_completeness),
        goal_progress:               r3(ee.goal_progress),
        scene_purpose_clarity:       r3(ee.scene_purpose_clarity),
        dialogue_distinctiveness:    r3(ee.dialogue_distinctiveness),
        emotional_causality:         r3(ee.emotional_causality),
        consequence_visibility:      r3(ee.consequence_visibility),
        narrative_density:           r3(ee.narrative_density),
        ending_progress:             r3(ee.ending_progress),
        postprocess_dependency_penalty: r3(ee.postprocess_dependency_penalty),
        judge_uncertainty:           r3(ee.judge_uncertainty),
      } : null,
      // 생성 메타
      renderer_model:  rt?.model_used ?? null,
      renderer_ms:     rt?.elapsed_ms ?? null,
      planner_ms:      pt?.elapsed_ms ?? null,
      target_length:   ic?.target_length ?? pt?.target_length ?? null,
      char_budget:     ic?.char_budget ?? null,                    // { target, min, max }
      actual_chars:    rt?.generated_text?.length ?? null,
      // 플래너 계획 세부
      hook_type:           pt?.parsed_plan?.hook_type ?? null,
      hook_payload:        pt?.parsed_plan?.hook_payload ?? null,
      hook_concrete_event: pt?.parsed_plan?.hook_concrete_event ?? null,
      scene_beats:         pt?.parsed_plan?.scene_beats ?? null,   // 전체 배열
      scene_beats_count:   pt?.parsed_plan?.scene_beats?.length ?? null,
      fallback_used:       pt?.fallback_used ?? null,
      fallback_reason:     pt?.fallback_reason ?? null,
      planner_model:       pt?.model_used ?? null,
      // 플랜 검증 세부
      plan_verdict:        pval?.verdict ?? null,
      plan_issues:         pval?.issues ?? [],
      plan_passed_checks:  pval?.passed_checks ?? [],
      // 연재 계약
      episode_role:        ic?.episode_role ?? null,
      remaining_episodes:  ic?.remaining_episodes ?? null,
      ending_constraint:   pt?.parsed_plan?.ending_constraint ?? null,
      // 서사 국면 (planner input_contract 기반)
      planner_arc_phase:   ic?.planner_arc_phase ?? null,
      planner_arc_ratio:   ic?.planner_arc_ratio != null ? Math.round(ic.planner_arc_ratio * 100) : null,
      // 재생성 여부 (regen_prev_text 주입 여부로 판단)
      is_regen:            !!(row.effective_context_snapshot as any)?.regen_prev_text,
      // 제약/개입 — 이번 화에 실제 적용된 것
      active_interventions:  ic?.active_interventions ?? [],
      absolute_forbidden:    ic?.absolute_forbidden ?? [],
      episode_forbidden:     ic?.episode_forbidden ?? [],
      episode_required:      ic?.episode_required ?? [],
      absent_characters:     ic?.absent_characters ?? [],
      // 메모리 현황
      has_rolling_summary:   ic?.has_rolling_summary ?? null,
      arc_summaries_count:   ic?.arc_summaries_count ?? null,
      foreshadow_count:      ic?.foreshadow_count ?? null,
      character_arcs_count:  ic?.character_arcs_count ?? null,
      // 독자 설정 (gen_config)
      gen_config: ctx?.gen_config ? {
        episodeLength:    (ctx.gen_config as any).episodeLength,
        episodeLengthVar: (ctx.gen_config as any).episodeLengthVar,
        pov:              (ctx.gen_config as any).pov,
        style:            (ctx.gen_config as any).style,
      } : null,
      // 리비전 이력
      revision_traces: revs.map((r: any) => ({
        iteration:      r.iteration,
        improved_rules: r.improved_rules ?? [],
        verdict_before: r.validation_before?.verdict ?? null,
        verdict_after:  r.validation_after?.verdict  ?? null,
        score_before:   r.validation_before?.score   ?? null,
        score_after:    r.validation_after?.score    ?? null,
      })),
      // 산문 품질 세부 점수
      quality_scores:  pv?.quality_scores ?? null,
      soft_warnings:   pv?.soft_warnings  ?? null,
      hard_violations: pv?.hard_violations ?? null,
      revision_hints:  pv?.revision_hints  ?? null,
      pov_violations:  pv?.pov_violations  ?? null,
      // 학습 레이블
      sft_eligible_planner:  row.is_planner_sft_eligible  ?? null,
      sft_eligible_renderer: row.is_renderer_sft_eligible ?? null,
      // 감사 시간 + trace
      audit_ms:        row.audit_elapsed_ms,
      trace_id:        row.trace_id,
      created_at:      row.created_at,
      // trajectory / ending — 별도 쿼리
      trajectory_summary: await pool.query(
        `SELECT window_size, window_score, arc_phase, scores, includes_final_episode
         FROM trajectory_rewards WHERE book_id = $1
         ORDER BY computed_at DESC LIMIT 50`,
        [bookId],
      ).then(tr => {
        if (!tr.rows.length) return null;
        const windows = tr.rows;
        const allScores = windows.map((w: any) => w.window_score ?? 0);
        const mean = allScores.reduce((s: number, v: number) => s + v, 0) / allScores.length;
        // 마지막 3개 window (recent convergence)
        const last3 = windows.slice(-3);
        const pre_final_convergence = last3.length
          ? last3.reduce((s: number, w: any) => s + (w.window_score ?? 0), 0) / last3.length : 0;
        const finalWindows = windows.filter((w: any) => w.includes_final_episode);
        // size=2 최근 window scores (detailed)
        const size2 = windows.filter((w: any) => w.window_size === 2).slice(-1)[0];
        return {
          computed: true,
          window_count: windows.length,
          mean_window_score: Math.round(mean * 1000) / 1000,
          pre_final_convergence_score: Math.round(pre_final_convergence * 1000) / 1000,
          includes_final: finalWindows.length > 0,
          recent_size2_scores: size2?.scores ?? null,
          recent_size2_score: r3(size2?.window_score),
          arc_phases: [...new Set(windows.map((w: any) => w.arc_phase))],
        };
      }).catch(() => null),
      ending_summary: await pool.query(
        `SELECT final_closure_score, ending_readiness, central_conflict_resolution,
                foreshadow_payoff_coverage, character_arc_resolution, emotional_resolution,
                ending_proportionality, ending_surprise_earned,
                premature_closure_penalty, overextended_delay_penalty,
                unresolved_critical_thread_penalty, deus_ex_machina_penalty,
                resolved_final_episode, judge_summary
         FROM ending_rewards WHERE book_id = $1
         ORDER BY computed_at DESC LIMIT 1`,
        [bookId],
      ).then(er => {
        if (!er.rows.length) return null;
        const e = er.rows[0];
        return {
          computed: true,
          final_closure_score: r3(e.final_closure_score),
          ending_readiness: r3(e.ending_readiness),
          central_conflict_resolution: r3(e.central_conflict_resolution),
          foreshadow_payoff_coverage: r3(e.foreshadow_payoff_coverage),
          character_arc_resolution: r3(e.character_arc_resolution),
          emotional_resolution: r3(e.emotional_resolution),
          ending_proportionality: r3(e.ending_proportionality),
          ending_surprise_earned: r3(e.ending_surprise_earned),
          premature_closure_penalty: r3(e.premature_closure_penalty),
          overextended_delay_penalty: r3(e.overextended_delay_penalty),
          unresolved_critical_thread_penalty: r3(e.unresolved_critical_thread_penalty),
          deus_ex_machina_penalty: r3(e.deus_ex_machina_penalty),
          resolved_final_episode: e.resolved_final_episode,
          judge_summary: e.judge_summary,
        };
      }).catch(() => null),
    });
  } catch (err) {
    logError("api:generate", err, { context: "audit-status", book_id: bookId });
    res.status(500).json({ error: String(err) });
  }
});
