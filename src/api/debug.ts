import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { getProfile, DEFAULT_PROFILE } from "../services/profile.js";
import { logSaveQueue, profileUpdateQueue } from "../queues/index.js";

export const debugRouter = Router();

// GET /api/debug/status?book_id=xxx
// 현재 파이프라인 전체 상태를 한 눈에 확인
debugRouter.get("/status", async (req: Request, res: Response) => {
  const bookId = req.query.book_id as string | undefined;

  const [logQueueSize, profileQueueSize] = await Promise.all([
    logSaveQueue.getJobCounts("wait", "active", "failed"),
    profileUpdateQueue.getJobCounts("wait", "active", "failed"),
  ]);

  let episodeCount = 0;
  let recentLogs: any[] = [];
  let profile = DEFAULT_PROFILE;
  let worldBibleCached = false;

  if (bookId) {
    const [epResult, logResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM episodes WHERE book_id = $1`, [bookId]),
      pool.query(
        `SELECT episode_number, dwell_ms, completion_rate, rewind_count,
                speed_changes, dropout_position, created_at
         FROM session_logs WHERE book_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [bookId]
      ),
    ]);
    episodeCount = parseInt(epResult.rows[0].count, 10);
    recentLogs   = logResult.rows;
    profile      = await getProfile(bookId);
    worldBibleCached = !!(await redis.exists(`context:${bookId}`));
  }

  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    book_id: bookId ?? null,
    episodes: episodeCount,
    world_bible_cached: worldBibleCached,
    reader_profile: profile,
    recent_logs: recentLogs,
    queues: {
      log_save: logQueueSize,
      profile_update: profileQueueSize,
    },
  });
});

// GET /api/debug/profile?book_id=xxx  — 프로필만 빠르게 확인
debugRouter.get("/profile", async (req: Request, res: Response) => {
  const bookId = req.query.book_id as string;
  if (!bookId) { res.status(400).json({ error: "book_id required" }); return; }
  const profile = await getProfile(bookId);
  res.json({ ok: true, book_id: bookId, profile });
});

// DELETE /api/debug/profile?book_id=xxx  — 프로필 초기화 (테스트용)
debugRouter.delete("/profile", async (req: Request, res: Response) => {
  const bookId = req.query.book_id as string;
  if (!bookId) { res.status(400).json({ error: "book_id required" }); return; }
  await redis.del(`profile:${bookId}`);
  res.json({ ok: true, message: "profile reset to default" });
});
