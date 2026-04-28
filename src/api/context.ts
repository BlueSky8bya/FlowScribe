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
  if (/전설|신성|신기|불멸|마왕|천계|신수|최강|신령|고신|유일|세계\s*최강|신검|신창|신궁|신갑|신환|신의|천신|천마|신인|신계/.test(combined)) return "S";
  if (/마법|정령|마검|마창|마갑|마도구|고대|희귀|마나|특수|영혼|마력|봉인|정화|성스|여신|신비|마석|룬|인챈|환생|소울|마왕의|신룡/.test(combined)) return "A";
  if (/강화|강철|고급|특제|명품|개조|합금|마정석|미스릴|아다만|오리하|나이트메탈|드래곤 스케일|드래곤스케일|에너지 크리|에너지크리/.test(combined)) return "B";
  if (/낡은|파손|부서|저급|녹슨|임시|폐기|손상|반파|망가/.test(combined)) return "D";
  return "C";
}

/**
 * 사용자가 입력한 소지품 raw 객체를 구조화한다.
 * 이미 condition/description/hidden_note 필드가 있으면 그대로 유지한다.
 * 괄호 내용의 의미:
 *   - S/A/B/C/D 또는 S급 → grade
 *   - 파손/고장/손상 등 상태어 → condition
 *   - 숨겨/있음/보관 등 위치어 → hidden_note
 *   - 그 외 → description
 */
export function parseItemEntry(raw: any): Record<string, any> {
  const obj: Record<string, any> = typeof raw === "string" ? { name: raw } : { ...raw };
  const fullName: string = obj.name ?? "";

  // 이미 구조화된 경우 name 안의 괄호는 건드리지 않음
  if (obj.condition != null || obj.description != null || obj.hidden_note != null) {
    return obj;
  }

  const m = fullName.match(/^(.+?)\((.+)\)\s*$/);
  if (!m) return obj;

  const baseName = m[1].trim();
  const bracket  = m[2].trim();

  // grade: S/A/B/C/D 또는 S급 형식
  if (/^[SABCD]$/.test(bracket) || /^[SABCD]급$/.test(bracket)) {
    return { ...obj, name: baseName, grade: bracket.replace("급", "") };
  }

  // condition: 상태 이상어
  if (/파손|고장|손상|녹슨|낡은|반파|망가|부서/.test(bracket)) {
    return { ...obj, name: baseName, condition: bracket };
  }

  // hidden_note: 위치/은닉어
  if (/숨겨|있음|위치|넣어|보관|숨긴|안에|속에|밑에|아래/.test(bracket)) {
    return { ...obj, name: baseName, hidden_note: bracket };
  }

  // 그 외는 description
  return { ...obj, name: baseName, description: bracket };
}

const TTL = 60 * 60 * 24 * 7; // 7일

contextRouter.post("/", async (req: Request, res: Response) => {
  const { book_id, worldBible, storyConfig } = req.body;
  if (!book_id || !worldBible) {
    res.status(400).json({ error: "book_id and worldBible required" });
    return;
  }
  try {
    const payload: Record<string, any> = storyConfig
      ? { ...worldBible, story_config: storyConfig }
      : { ...worldBible };

    // resolved_final_episode: 이미 있으면 유지, 없으면 기존 컨텍스트에서 복구 or 신규 생성
    const sc = payload.story_config as Record<string, any> | undefined;
    if (sc?.totalEpisodes != null) {
      if (!sc.resolved_final_episode) {
        // 기존 저장 값 우선 보존 (재저장 시 재샘플링 방지)
        let existingRf: number | null = null;
        try {
          const existingRaw = await redis.get(`context:${book_id}`);
          if (existingRaw) {
            const existing = JSON.parse(existingRaw);
            existingRf = existing?.story_config?.resolved_final_episode ?? null;
          }
          if (!existingRf) {
            const dbRow = await pool.query(`SELECT context FROM books WHERE id = $1`, [book_id]);
            existingRf = dbRow.rows[0]?.context?.story_config?.resolved_final_episode ?? null;
          }
        } catch { /* 조회 실패 시 신규 생성으로 진행 */ }

        if (existingRf) {
          // Validate existing rf is within current range; re-sample if out of range
          const variance: number = sc.totalEpisodesVar ?? 0;
          const min = (sc.totalEpisodes as number) - variance;
          const max = (sc.totalEpisodes as number) + variance;
          if (existingRf >= min && existingRf <= max) {
            sc.resolved_final_episode = existingRf;
          } else {
            const delta = variance > 0 ? Math.round((Math.random() * 2 - 1) * variance) : 0;
            sc.resolved_final_episode = (sc.totalEpisodes as number) + delta;
            logInfo("api:context:save", "resolved_final_episode 범위 밖 → 재확정", {
              book_id, existingRf, newRf: sc.resolved_final_episode, min, max
            });
          }
        } else {
          const variance: number = sc.totalEpisodesVar ?? 0;
          const delta = variance > 0
            ? Math.round((Math.random() * 2 - 1) * variance)
            : 0;
          sc.resolved_final_episode = (sc.totalEpisodes as number) + delta;
        }
      }
    }

    await redis.set(`context:${book_id}`, JSON.stringify(payload), "EX", TTL);
    logInfo("api:context:save", "World Bible 캐시 저장", { book_id,
      resolved_final_episode: sc?.resolved_final_episode ?? null });

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
          // canonical_characters 테이블 (type/gender/initial_items 정본) — 괄호 파싱 + grade 자동 부여
          upsertCanonicalCharacter(book_id, {
            name, personality, type: type ?? "", gender: gender ?? "",
            initial_items: (() => {
              const rawItems: Array<any> = (typeof info === "object" && Array.isArray((info as any).initial_items))
                ? (info as any).initial_items : [];
              return rawItems.map((it: any) => {
                const parsed = parseItemEntry(it) as any;
                parsed.grade = autoGradeItem(parsed);
                return parsed;
              }) as import("../types/canonical.js").ItemEntry[];
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
    let ctx: any = null;

    // Redis 우선
    const raw = await redis.get(`context:${bookId}`);
    if (raw) {
      ctx = JSON.parse(raw);
      logInfo("api:context:get", "World Bible 캐시 조회 성공", { bookId });
    } else {
      // Redis 미스 → books 테이블 폴백
      const dbResult = await pool.query(
        `SELECT context FROM books WHERE id = $1`, [bookId]
      );
      ctx = dbResult.rows[0]?.context ?? null;
      if (ctx && Object.keys(ctx).length) {
        logInfo("api:context:get", "World Bible DB 폴백 조회", { bookId });
        await redis.set(`context:${bookId}`, JSON.stringify(ctx), "EX", TTL);
      }
    }

    if (!ctx || !Object.keys(ctx).length) {
      logWarn("api:context:get", "World Bible 없음", { bookId });
      res.status(404).json({ error: "not found" });
      return;
    }

    // canonical_characters.initial_items를 character_defaults에 merge
    // 기존 string 형식 책도 새로고침 후 소지품이 복원되도록 함
    if (ctx.character_defaults) {
      try {
        const canonRows = await pool.query(
          `SELECT name, initial_items FROM canonical_characters WHERE book_id = $1`,
          [bookId]
        );
        for (const row of canonRows.rows) {
          const def = ctx.character_defaults[row.name];
          if (def === undefined) continue;
          const items: any[] = Array.isArray(row.initial_items) ? row.initial_items : [];
          if (!items.length) continue;
          if (typeof def === "string") {
            // legacy string → object로 업그레이드
            const typeMatch   = def.match(/유형:\s*([^,\]]+)/);
            const genderMatch = def.match(/성별:\s*([^\]]+)/);
            const personality = def.replace(/\[[^\]]*\]\s*/, "").trim();
            ctx.character_defaults[row.name] = {
              type:        typeMatch?.[1]?.trim()   ?? "",
              gender:      genderMatch?.[1]?.trim() ?? "",
              personality,
              description: personality,
              initial_items: items,
            };
          } else if (typeof def === "object" && !(def.initial_items as any[])?.length) {
            ctx.character_defaults[row.name] = { ...def, initial_items: items };
          }
        }
      } catch { /* canonical merge 실패해도 context 반환 유지 */ }
    }

    res.json(ctx);
  } catch (err) {
    logError("api:context:get", err, { bookId });
    res.status(500).json({ error: "context fetch failed" });
  }
});
