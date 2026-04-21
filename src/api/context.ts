import { Router, Request, Response } from "express";
import { redis } from "../lib/redis.js";
import { pool } from "../lib/db.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";

export const contextRouter = Router();

const TTL = 60 * 60 * 24 * 7; // 7일

contextRouter.post("/", async (req: Request, res: Response) => {
  const { book_id, worldBible, storyConfig } = req.body;
  if (!book_id || !worldBible) {
    res.status(400).json({ error: "book_id and worldBible required" });
    return;
  }
  try {
    const payload = storyConfig
      ? { ...worldBible, story_config: storyConfig }
      : worldBible;

    await redis.set(`context:${book_id}`, JSON.stringify(payload), "EX", TTL);
    logInfo("api:context:save", "World Bible 캐시 저장", { book_id });

    // books 테이블에도 영속화 (Redis 만료 대비)
    await pool.query(
      `UPDATE books SET context = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(payload), book_id]
    ).catch(() => {}); // books 테이블 없는 book_id면 무시

    // World Bible의 character_defaults를 characters 테이블에 자동 등록
    const chars: Record<string, string> = worldBible.character_defaults ?? {};
    const entries = Object.entries(chars);
    if (entries.length) {
      await Promise.all(entries.map(([name, desc]) => {
        const gender = desc.includes("성별: 여") ? "여성"
          : desc.includes("성별: 남") ? "남성" : null;
        const role = desc.match(/역할:\s*([^.]+)/)?.[1]?.trim() ?? null;
        return pool.query(
          `INSERT INTO characters (book_id, name, role, personality, gender, source)
           VALUES ($1, $2, $3, $4, $5, 'world_bible')
           ON CONFLICT (book_id, name) DO NOTHING`,
          [book_id, name, role, desc, gender]
        );
      }));
      logInfo("api:context:save", "World Bible 인물 DB 등록", {
        book_id,
        count: entries.length,
        names: entries.map(([n]) => n),
      });
    }

    res.json({ ok: true });
  } catch (err) {
    logError("api:context:save", err, { book_id });
    res.status(500).json({ error: "context save failed" });
  }
});

contextRouter.get("/:bookId", async (req: Request, res: Response) => {
  const { bookId } = req.params;
  try {
    // Redis 우선
    const raw = await redis.get(`context:${bookId}`);
    if (raw) {
      logInfo("api:context:get", "World Bible 캐시 조회 성공", { bookId });
      res.json(JSON.parse(raw));
      return;
    }

    // Redis 미스 → books 테이블 폴백
    const dbResult = await pool.query(
      `SELECT context FROM books WHERE id = $1`, [bookId]
    );
    const ctx = dbResult.rows[0]?.context;
    if (ctx && Object.keys(ctx).length) {
      logInfo("api:context:get", "World Bible DB 폴백 조회", { bookId });
      // Redis에 다시 올림
      await redis.set(`context:${bookId}`, JSON.stringify(ctx), "EX", TTL);
      res.json(ctx);
      return;
    }

    logWarn("api:context:get", "World Bible 없음", { bookId });
    res.status(404).json({ error: "not found" });
  } catch (err) {
    logError("api:context:get", err, { bookId });
    res.status(500).json({ error: "context fetch failed" });
  }
});
