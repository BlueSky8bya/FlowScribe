import { Router, Request, Response } from "express";
import { streamEpisode } from "../services/story.js";
import type { StoryContext } from "../services/story.js";
import { pool } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { getProfile, getProfileByUser } from "../services/profile.js";
import { getOpenForeshadows } from "../services/foreshadow.js";
import { getArcSummaries, getLatestCharacterArcs } from "../services/arc_memory.js";
import { getLatestDynamicStates, commitDynamicState } from "../services/character_state.js";
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
    const charStateSnapshot = bookId
      ? (await getLatestDynamicStates(bookId, episode).catch(() => [])).map(s => ({
          character_name:  s.character_name,
          location:        s.location        ?? null,
          physical_state:  s.physical_state  ?? null,
          items:           s.items           ?? [],
          emotional_state: s.emotional_state ?? null,
          visibility_state: s.visibility_state ?? "present",
        }))
      : [];

    // fallback: DB 조회 실패해도 World Bible 캐릭터 이름 + type/gender는 표시
    const wbDefs = worldBible.character_defaults ?? {};
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
    const dynStates = await getLatestDynamicStates(bookId, episode);
    let charStates = dynStates.map(s => ({
      character_name:  s.character_name,
      location:        s.location        ?? null,
      physical_state:  s.physical_state  ?? null,
      items:           s.items           ?? [],
      emotional_state: s.emotional_state ?? null,
      visibility_state: s.visibility_state ?? "present",
    }));

    // fallback: DB에 없으면 World Bible character_defaults에서 이름 + 기본 속성 추출
    if (!charStates.length) {
      const wb = await redis.get(`context:${bookId}`).catch(() => null);
      if (wb) {
        try {
          const parsed = JSON.parse(wb);
          const defs = parsed.character_defaults ?? {};
          charStates = Object.entries(defs).map(([name, info]: [string, any]) => ({
            character_name: name,
            type:            info.type            ?? null,
            gender:          info.gender           ?? null,
            location:        null,
            physical_state:  null,
            items:           [],
            emotional_state: null,
            visibility_state: "present" as const,
          }));
        } catch {}
      }
    }

    logInfo("api:generate", "char-states 조회", { book_id: bookId, episode, count: charStates.length });
    res.json({ char_states: charStates });
  } catch (err) {
    logError("api:generate", err, { context: "char-states", book_id: bookId });
    res.status(500).json({ error: String(err) });
  }
});
