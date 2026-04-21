import { Router, Request, Response } from "express";
import { enqueueLog, getRecentLogs } from "../services/logger.js";
import { logError, logInfo } from "../lib/logger.js";

export const logsRouter = Router();

// POST /api/logs — 세션 로그 저장 (큐를 통해 비동기 처리)
logsRouter.post("/", async (req: Request, res: Response) => {
  const {
    book_id, episode_number,
    dwell_ms, dropout_position, rewind_count,
    completion_rate, speed_changes, emotion_signals,
  } = req.body;

  if (!book_id || episode_number === undefined) {
    res.status(400).json({ error: "book_id and episode_number are required" });
    return;
  }

  try {
    await enqueueLog({
      book_id, episode_number,
      dwell_ms, dropout_position, rewind_count,
      completion_rate, speed_changes, emotion_signals,
    });
    logInfo("api:logs", "세션 로그 큐 등록", { book_id, episode_number, completion_rate });
    res.json({ ok: true });
  } catch (err) {
    logError("api:logs:enqueue", err, { book_id, episode_number });
    res.status(500).json({ error: "log enqueue failed" });
  }
});

logsRouter.get("/:bookId", async (req: Request, res: Response) => {
  const { bookId } = req.params as { bookId: string };
  const limit = Math.min(parseInt((req.query.limit as string) ?? "10", 10), 50);
  try {
    const rows = await getRecentLogs(bookId, limit);
    res.json({ ok: true, data: rows });
  } catch (err) {
    logError("api:logs:fetch", err, { bookId });
    res.status(500).json({ error: "log fetch failed" });
  }
});
