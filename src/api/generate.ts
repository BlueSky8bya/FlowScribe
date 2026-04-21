import { Router, Request, Response } from "express";
import { streamEpisode } from "../services/story.js";
import type { StoryContext } from "../services/story.js";
import { pool } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { getProfile } from "../services/profile.js";
import { getOpenForeshadows } from "../services/foreshadow.js";
import { getArcSummaries, getLatestCharacterArcs } from "../services/arc_memory.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";

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

  // 병렬 로드: World Bible + Reader Profile + Director Overrides
  const [worldBibleRaw, readerProfileResult, overridesRaw] = await Promise.allSettled([
    bookId ? redis.get(`context:${bookId}`) : Promise.resolve(null),
    bookId ? getProfile(bookId) : Promise.resolve(defaultContext.readerProfile),
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
    logInfo("api:generate", "Reader Profile 로드", { book_id: bookId, profile: readerProfile });
  } else {
    logError("api:generate", readerProfileResult.reason, { context: "Reader Profile 실패", book_id: bookId });
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

  try {
    const t0       = Date.now();
    const fullText = await streamEpisode(ctx, res);
    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ done: true, chars: fullText.length })}\n\n`);
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
