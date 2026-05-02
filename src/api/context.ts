import { Router, Request, Response } from "express";
import { redis } from "../lib/redis.js";
import { pool } from "../lib/db.js";
import { upsertCanonicalCharacter } from "../services/character_state.js";
import { generateAndSaveItemDescriptions } from "../services/item_desc.js";
import { syncWorldContext } from "../services/world_context_sync.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";

export const contextRouter = Router();

/** 소지품 이름으로 즉시 카테고리 기반 fallback 설명 부여.
 *  description이 이미 있으면 그대로 유지한다.
 *  프론트엔드 _QLABEL_DESC와 동일 로직 — LLM 없는 즉시 표시용.
 */
export function autoDescItem(item: { name: string; description?: string }): string | null {
  if (item.description) return item.description;
  const n = item.name.toLowerCase();
  if (/폭발|독성|독가스|지뢰|유독|방사/.test(n))                      return '위험한 폭발물 또는 유해 물질';
  if (/검|도\b|창\b|활\b|총\b|총기|단검|단도|대거|블레이드|나이프|칼\b|도끼|망치|석궁|리볼버|소총|권총|탄약|탄창/.test(n)) return '전투에 사용하는 무기';
  if (/갑옷|방패|투구|방어구|흉갑|장갑\b|장화|부츠/.test(n))           return '방어 목적의 장비';
  if (/포션|약\b|붕대|치료제|해독|회복제|응급/.test(n))                return '치료 및 회복에 사용하는 물품';
  if (/지도|서류|편지|일지|기록물|코드|암호|데이터|정보 장치/.test(n)) return '정보가 담긴 문서 또는 자료';
  if (/제단|봉인석|인장|부적|마법진|주술구|의례/.test(n))              return '의식이나 주술에 사용하는 물품';
  if (/수정구|성석|성배|성유물|정령석|신물/.test(n))                   return '신성하거나 영적인 힘을 가진 물품';
  if (/악기|피리|북\b|뿔피리|하프/.test(n))                           return '음악을 연주하는 악기';
  if (/장치|기계|기어|렌치|회로|계기|디바이스/.test(n))               return '특수 목적의 기계 장치';
  if (/군용|군장|전술|야전/.test(n))                                  return '군사 작전에 사용하는 물자';
  if (/배낭|벨트 파우치|조끼|외투|망토/.test(n))                      return '탐험·작전용 기어 및 장비';
  if (/램프|랜턴|등불|횃불|손전등|조명/.test(n))                      return '어둠을 밝히는 조명 도구';
  return null;
}

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
  // Phase 4.19C — saveContext latency 계측
  const _t0 = Date.now();
  const _mark = (label: string) => logInfo("api:context:save:latency", label, { book_id: req.body?.book_id, ms: Date.now() - _t0 });
  _mark("context_save_start");

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
      const variance: number = sc.totalEpisodesVar ?? 0;
      const min = (sc.totalEpisodes as number) - variance;
      const max = (sc.totalEpisodes as number) + variance;
      // 클라이언트가 보낸 값 또는 저장된 값을 후보로 삼아 범위 검증 후 확정
      let existingRf: number | null = sc.resolved_final_episode ?? null;
      if (!existingRf) {
        try {
          const existingRaw = await redis.get(`context:${book_id}`);
          if (existingRaw) existingRf = JSON.parse(existingRaw)?.story_config?.resolved_final_episode ?? null;
          if (!existingRf) {
            const dbRow = await pool.query(`SELECT context FROM books WHERE id = $1`, [book_id]);
            existingRf = dbRow.rows[0]?.context?.story_config?.resolved_final_episode ?? null;
          }
        } catch { /* 조회 실패 시 신규 생성 */ }
      }
      if (existingRf && existingRf >= min && existingRf <= max) {
        sc.resolved_final_episode = existingRf;
      } else {
        const delta = variance > 0 ? Math.round((Math.random() * 2 - 1) * variance) : 0;
        sc.resolved_final_episode = (sc.totalEpisodes as number) + delta;
        if (existingRf) logInfo("api:context:save", "resolved_final_episode 범위 밖 → 재확정", {
          book_id, existingRf, newRf: sc.resolved_final_episode, min, max
        });
      }
    }

    // POST-S13.5 P0 — books.context + world_configs + world_rules + Redis 4중 sync.
    // 이전: redis/books/world_configs/world_rules를 별도로 처리해 source-of-truth drift 발생.
    // 이제: syncWorldContext helper가 단일 트랜잭션 + Redis 한 번에 처리.
    try {
      const result = await syncWorldContext(book_id, payload);
      logInfo("api:context:save", "world context 4중 sync 완료", {
        book_id,
        resolved_final_episode: sc?.resolved_final_episode ?? null,
        genre: result.genre_synced,
        general_count: result.general_count,
        forbidden_count: result.forbidden_count,
      });
    } catch (syncErr) {
      logError("api:context:save", syncErr, { book_id, context: "syncWorldContext" });
      res.status(500).json({ error: "context save failed" });
      return;
    }
    _mark("context_db_save_done");

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
                if (!parsed.description) {
                  const fallback = autoDescItem(parsed);
                  if (fallback) parsed.description = fallback;
                }
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

      // Phase 4.19 — 모든 아이템에 대해 LLM 설명 생성을 백그라운드로 fire-and-forget.
      // 5명 인물 직렬 await로 saveContext 응답이 30초~1분 늦던 문제 해결.
      // 응답은 즉시 반환되고, description은 LLM이 끝나는 대로 DB에 채워짐.
      // 첫 회차 생성 시 description이 아직 미완성일 수 있으나 personality + name만으로
      // 본문 생성에는 영향 없음(description은 인물 카드 표시에만 사용).
      const enrichJobs = entries
        .map(([name, info]) => {
          const rawItems: Array<any> = (typeof info === "object" && Array.isArray((info as any).initial_items))
            ? (info as any).initial_items : [];
          if (!rawItems.length) return null;
          const desc   = typeof info === "string" ? info : ((info as any).personality ?? (info as any).description ?? "");
          const type   = typeof info === "object" ? ((info as any).type ?? "") : "";
          const gender = typeof info === "object" ? ((info as any).gender ?? "") : "";
          return { name, desc, type, gender, rawItems };
        })
        .filter(Boolean) as Array<{ name: string; desc: string; type: string; gender: string; rawItems: any[] }>;

      // setImmediate로 응답 사이클 후 실행 + 인물별 병렬 (Promise.all)
      if (enrichJobs.length) {
        setImmediate(() => {
          const _bgT0 = Date.now();
          logInfo("api:context:save:latency", "item_desc_bg_start", { book_id, jobs: enrichJobs.length });
          Promise.all(enrichJobs.map(j =>
            generateAndSaveItemDescriptions({
              book_id,
              char_name: j.name,
              char_personality: j.desc,
              char_type: j.type,
              char_gender: j.gender,
              items_without_desc: j.rawItems.map((it: any) => {
                const parsed = typeof it === "string" ? { name: it } : it;
                return {
                  name: parsed.name,
                  grade: parsed.grade ?? null,
                  condition: parsed.condition ?? null,
                  user_desc: parsed.description ?? null,
                };
              }),
            }).catch((e) => logWarn("api:context:save:latency", "item_desc_bg_error", { book_id, char: j.name, error: String(e?.message ?? e) }))
          )).then(() => {
            logInfo("api:context:save:latency", "item_desc_bg_done", { book_id, ms: Date.now() - _bgT0, jobs: enrichJobs.length });
          }).catch(() => {});
        });
      }
    }

    _mark("context_response_sent");
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
      try { ctx = JSON.parse(raw); } catch { ctx = null; }
      if (ctx && Object.keys(ctx).length) {
        logInfo("api:context:get", "World Bible 캐시 조회 성공", { bookId });
      } else {
        // POST-1: Redis에 빈 객체가 캐시된 경우 — DB 폴백으로 fall through
        ctx = null;
      }
    }
    if (!ctx) {
      // Redis 미스 또는 빈 캐시 → books 테이블 폴백
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
