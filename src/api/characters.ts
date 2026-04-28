import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";
import { upsertCanonicalCharacter } from "../services/character_state.js";
import { parseItemEntry, autoDescItem } from "./context.js";
import { generateAndSaveItemDescriptions } from "../services/item_desc.js";

export const charactersRouter = Router();

charactersRouter.get("/:bookId", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM characters WHERE book_id = $1 ORDER BY source, first_appeared_episode`,
      [req.params.bookId]
    );
    logInfo("api:characters:get", "인물 목록 조회", { bookId: req.params.bookId, count: result.rows.length });
    res.json(result.rows);
  } catch (err) {
    logError("api:characters:get", err, { bookId: req.params.bookId });
    res.status(500).json({ error: "characters fetch failed" });
  }
});

charactersRouter.post("/", async (req: Request, res: Response) => {
  const { book_id, characters } = req.body;
  if (!book_id || !Array.isArray(characters)) {
    logWarn("api:characters:save", "입력 유효성 실패", { book_id, has_characters: Array.isArray(characters) });
    res.status(400).json({ error: "book_id and characters[] required" });
    return;
  }

  try {
    for (const c of characters) {
      await pool.query(
        `INSERT INTO characters (book_id, name, role, personality, type, gender, source, first_appeared_episode, extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (book_id, name) DO UPDATE SET
           role = COALESCE(EXCLUDED.role, characters.role),
           personality = COALESCE(EXCLUDED.personality, characters.personality),
           type = COALESCE(EXCLUDED.type, characters.type),
           gender = COALESCE(EXCLUDED.gender, characters.gender),
           extra = characters.extra || EXCLUDED.extra`,
        [
          book_id,
          c.name,
          c.role ?? null,
          c.personality ?? null,
          c.type ?? null,
          c.gender ?? null,
          c.source ?? "user",
          c.first_appeared_episode ?? null,
          JSON.stringify(c.extra ?? {}),
        ]
      );
    }
    // canonical_characters에도 initial_items 포함 upsert
    for (const c of characters) {
      if (!c.name) continue;
      await upsertCanonicalCharacter(book_id, {
        name: c.name,
        personality: c.personality ?? "",
        type: c.type ?? "인간",
        gender: c.gender ?? "해당없음",
        initial_items: Array.isArray(c.initial_items)
          ? c.initial_items.map((it: any) => parseItemEntry(it)).map((parsed: any) => {
              if (!parsed.description) { const fb = autoDescItem(parsed); if (fb) parsed.description = fb; }
              return parsed;
            })
          : [],
      });
    }
    // description 없는 아이템 → LLM 설명 생성 잡 수집 (응답 전에 실행하지 않음)
    const descJobs: Array<() => Promise<void>> = [];
    for (const c of characters) {
      if (!c.name) continue;
      const rawItems: Array<any> = Array.isArray(c.initial_items) ? c.initial_items : [];
      const missing = rawItems.filter((it: any) => {
        const parsed = typeof it === "string" ? { name: it } : it;
        return !parsed.description;
      });
      if (!missing.length) continue;
      const jobData = {
        book_id,
        char_name: c.name,
        char_personality: (c.personality ?? "").slice(0, 100),
        char_type: c.type ?? "",
        char_gender: c.gender ?? "",
        items_without_desc: missing.map((it: any) => ({
          name: typeof it === "string" ? it : it.name,
          grade: it.grade ?? null,
          condition: it.condition ?? null,
        })),
      };
      descJobs.push(() => generateAndSaveItemDescriptions(jobData));
    }

    logInfo("api:characters:save", "인물 upsert 완료", { book_id, count: characters.length, desc_jobs_queued: descJobs.length });
    // 응답 먼저 반환
    res.json({ ok: true, count: characters.length, desc_jobs_queued: descJobs.length });

    // 응답 후 백그라운드에서 LLM 설명 생성 실행
    for (const run of descJobs) {
      setImmediate(() => {
        run().catch((err: unknown) => {
          logWarn("item_desc:background", err instanceof Error ? err.message : String(err), {});
        });
      });
    }
  } catch (err) {
    logError("api:characters:save", err, { book_id, count: characters?.length });
    res.status(500).json({ error: "characters save failed" });
  }
});
