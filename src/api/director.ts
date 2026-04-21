import { Router, Request, Response } from "express";
import { redis } from "../lib/redis.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";

export const directorRouter = Router();

// POST /api/director/:bookId  — override 추가
directorRouter.post("/:bookId", async (req: Request, res: Response) => {
  const { bookId } = req.params;
  const { override } = req.body;
  if (!override || typeof override !== "string") {
    res.status(400).json({ error: "override (string) required" });
    return;
  }
  try {
    const key = `overrides:${bookId}`;
    const raw = await redis.get(key);
    const list: string[] = raw ? JSON.parse(raw) : [];
    list.push(override.trim());
    await redis.set(key, JSON.stringify(list));
    logInfo("api:director", "Override 추가", { book_id: bookId, override, total: list.length });
    res.json({ ok: true, overrides: list });
  } catch (err) {
    logError("api:director", err, { book_id: bookId });
    res.status(500).json({ error: "override save failed" });
  }
});

// DELETE /api/director/:bookId  — 전체 override 초기화
directorRouter.delete("/:bookId", async (req: Request, res: Response) => {
  const { bookId } = req.params;
  try {
    await redis.del(`overrides:${bookId}`);
    logInfo("api:director", "Overrides 초기화", { book_id: bookId });
    res.json({ ok: true });
  } catch (err) {
    logError("api:director", err, { book_id: bookId });
    res.status(500).json({ error: "override delete failed" });
  }
});

// GET /api/director/:bookId  — 현재 override 목록 조회
directorRouter.get("/:bookId", async (req: Request, res: Response) => {
  const { bookId } = req.params;
  try {
    const raw = await redis.get(`overrides:${bookId}`);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!list.length) logWarn("api:director", "Override 없음", { book_id: bookId });
    else logInfo("api:director", "Overrides 조회", { book_id: bookId, count: list.length });
    res.json({ overrides: list });
  } catch (err) {
    logError("api:director", err, { book_id: bookId });
    res.status(500).json({ error: "override fetch failed" });
  }
});
