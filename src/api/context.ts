import { Router, Request, Response } from "express";
import { redis } from "../lib/redis.js";
import { pool } from "../lib/db.js";
import { upsertCanonicalCharacter } from "../services/character_state.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";

export const contextRouter = Router();

/** 소지품 이름으로 등급 자동 부여 (S/A/B/C/D).
 *  LLM 없이 키워드 기반으로 결정하며, 이미 grade가 있으면 유지한다.
 */
function autoGradeItem(item: { name: string; grade?: string; condition?: string; description?: string }): string {
  if (item.grade && ["S","A","B","C","D"].includes(item.grade)) return item.grade;
  const n = item.name.toLowerCase();
  const d = (item.description ?? "").toLowerCase();
  const combined = n + " " + d;
  // S: 전설/신성/신기/불멸/마왕/천계/신수/최강/신령/고신/유일/세계 최강
  if (/전설|신성|신기|불멸|마왕|천계|신수|최강|신령|고신|유일|세계\s*최강|신검|신창|신궁|신갑|신환|신의|천신|천마|신인|신계/.test(combined)) return "S";
  // A: 마법/정령/마검/마창/마도구/고대/희귀/마나/특수/영혼/마력/봉인/고급 무기
  if (/마법|정령|마검|마창|마갑|마도구|고대|희귀|마나|특수|영혼|마력|봉인|정화|성스|여신|신비|마석|룬|인챈|환생|소울|마왕의|신룡/.test(combined)) return "A";
  // B: 강화/강철/고급/특제/명품/개조/합금/마정석|은/미스릴/아다만
  if (/강화|강철|고급|특제|명품|개조|합금|마정석|미스릴|아다만|오리하|나이트메탈|드래곤 스케일|드래곤스케일|에너지 크리|에너지크리/.test(combined)) return "B";
  // D: 낡은/파손/부서/저급/녹슨/임시/폐기
  if (/낡은|파손|부서|저급|녹슨|임시|폐기|손상|반파|망가/.test(combined)) return "D";
  // default C
  return "C";
}

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

    // World Bible의 character_defaults를 characters + canonical_characters 테이블에 자동 등록
    const charDefs: Record<string, string | { type?: string; gender?: string; description?: string; personality?: string; initial_items?: Array<{name: string; condition?: string}> }> =
      worldBible.character_defaults ?? {};
    const entries = Object.entries(charDefs);
    if (entries.length) {
      await Promise.all(entries.map(([name, info]) => {
        // 문자열/객체 두 형식 모두 처리
        const desc       = typeof info === "string" ? info : (info.description ?? info.personality ?? "");
        const type       = typeof info === "object" ? (info.type ?? null)
          : (info.match(/유형:\s*([^,|\]]+)/)?.[1]?.trim() ?? null);
        const gender     = typeof info === "object" ? (info.gender ?? null)
          : (info.includes("성별: 여") ? "여성" : info.includes("성별: 남") ? "남성" : null);
        const personality = typeof info === "object" ? (info.personality ?? desc) : desc;
        const role       = typeof info === "string" ? (info.match(/역할:\s*([^.]+)/)?.[1]?.trim() ?? null) : null;

        return Promise.all([
          // legacy characters 테이블
          pool.query(
            `INSERT INTO characters (book_id, name, role, personality, gender, source)
             VALUES ($1, $2, $3, $4, $5, 'world_bible')
             ON CONFLICT (book_id, name) DO NOTHING`,
            [book_id, name, role, desc, gender]
          ),
          // canonical_characters 테이블 (type/gender/initial_items 정본) — grade 자동 부여
          upsertCanonicalCharacter(book_id, {
            name, personality, type: type ?? "", gender: gender ?? "",
            initial_items: (() => {
              const rawItems: Array<any> = (typeof info === "object" && Array.isArray((info as any).initial_items))
                ? (info as any).initial_items : [];
              return rawItems.map((it: any) => {
                const obj = typeof it === "string" ? { name: it } : { ...it };
                obj.grade = autoGradeItem(obj);
                return obj;
              });
            })(),
          }),
        ]);
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
