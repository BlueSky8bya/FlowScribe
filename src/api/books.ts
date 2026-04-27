import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { pool } from "../lib/db.js";
import { logInfo, logError } from "../lib/logger.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getProfile } from "../services/profile.js";

export const booksRouter = Router();
booksRouter.use(requireAuth);

booksRouter.get("/", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, title, current_episode, context, created_at
       FROM books WHERE user_id = $1 AND title NOT LIKE '[DPO%' ORDER BY updated_at DESC`,
      [req.user!.id]
    );
    res.json({ books: result.rows });
  } catch (err) {
    logError("api:books", err, { context: "list" });
    res.status(500).json({ error: "books fetch failed" });
  }
});

booksRouter.post("/", async (req: Request, res: Response) => {
  const { title } = req.body;
  const finalTitle = (title ?? "새 이야기").trim();
  const id = randomUUID();
  try {
    const dup = await pool.query(
      `SELECT id FROM books WHERE user_id = $1 AND title = $2`,
      [req.user!.id, finalTitle]
    );
    if (dup.rows.length > 0) {
      res.status(409).json({ error: "duplicate_title", message: "같은 제목의 책이 이미 있습니다." });
      return;
    }
    const result = await pool.query(
      `INSERT INTO books (id, user_id, title) VALUES ($1, $2, $3) RETURNING *`,
      [id, req.user!.id, finalTitle]
    );
    logInfo("api:books", "새 책 생성", { book_id: id, user_id: req.user!.id });
    res.json({ book: result.rows[0] });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "duplicate_title", message: "같은 제목의 책이 이미 있습니다." });
      return;
    }
    logError("api:books", err, { context: "create" });
    res.status(500).json({ error: "book create failed" });
  }
});

booksRouter.get("/:bookId/stats", async (req: Request, res: Response) => {
  const bookId = String(req.params.bookId);
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*)::int                        AS total_sessions,
        ROUND(AVG(completion_rate) * 100)::int AS avg_completion,
        ROUND(AVG(dwell_ms) / 1000)::int     AS avg_seconds,
        SUM(rewind_count)::int               AS total_rewinds
      FROM session_logs WHERE book_id = $1
    `, [bookId]);
    res.json({ stats: r.rows[0] });
  } catch (err) {
    logError("api:books", err, { context: "stats" });
    res.status(500).json({ error: "stats fetch failed" });
  }
});

booksRouter.get("/:bookId/profile", async (req: Request, res: Response) => {
  try {
    const profile = await getProfile(String(req.params.bookId));
    res.json({ profile });
  } catch (err) {
    logError("api:books", err, { context: "profile" });
    res.status(500).json({ error: "profile fetch failed" });
  }
});

booksRouter.delete("/:bookId", async (req: Request, res: Response) => {
  const { bookId } = req.params;
  try {
    await pool.query(`DELETE FROM books WHERE id = $1 AND user_id = $2`, [bookId, req.user!.id]);
    logInfo("api:books", "책 삭제", { book_id: bookId, user_id: req.user!.id });
    res.json({ ok: true });
  } catch (err) {
    logError("api:books", err, { context: "delete" });
    res.status(500).json({ error: "book delete failed" });
  }
});

booksRouter.patch("/:bookId", async (req: Request, res: Response) => {
  const { bookId } = req.params;
  const { title, current_episode, context } = req.body;

  const setClauses: string[] = ["updated_at = NOW()"];
  const params: any[] = [bookId, req.user!.id];

  if (title !== undefined) {
    const trimmedTitle = String(title).trim();
    const dup = await pool.query(
      `SELECT id FROM books WHERE user_id = $1 AND title = $2 AND id != $3`,
      [req.user!.id, trimmedTitle, bookId]
    );
    if (dup.rows.length > 0) {
      res.status(409).json({ error: "duplicate_title", message: "같은 제목의 책이 이미 있습니다." });
      return;
    }
    setClauses.push(`title = $${params.length + 1}`);
    params.push(trimmedTitle);
  }
  if (current_episode !== undefined) {
    setClauses.push(`current_episode = $${params.length + 1}`);
    params.push(current_episode);
  }
  if (context !== undefined) {
    setClauses.push(`context = $${params.length + 1}::jsonb`);
    params.push(JSON.stringify(context));
  }

  try {
    await pool.query(
      `UPDATE books SET ${setClauses.join(", ")} WHERE id = $1 AND user_id = $2`,
      params
    );
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "duplicate_title", message: "같은 제목의 책이 이미 있습니다." });
      return;
    }
    logError("api:books", err, { context: "update" });
    res.status(500).json({ error: "book update failed" });
  }
});
