/**
 * foreshadow.ts — 구조화 복선 추적 서비스
 *
 * 핵심 원칙:
 * - 복선은 DB에 영구 저장 (Redis는 캐시 역할만)
 * - status: 'open' | 'resolved' | 'abandoned'
 * - 100화가 넘어도 2화에서 심은 복선을 유실 없이 주입 가능
 * - resolved 체크는 매 화 저장 시 자동 수행
 */

import { getLLMClient, getSummaryModel } from "../lib/llm.js";
import { pool } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";

const CACHE_KEY = (bookId: string) => `foreshadow_open:${bookId}`;
const CACHE_TTL = 300; // 5분

export interface Foreshadow {
  id: string;
  planted_episode: number;
  content: string;
  keywords: string[];
  status: "open" | "resolved" | "abandoned";
  resolved_episode?: number;
}

// ── 열린 복선 조회 (캐시 우선) ─────────────────────────────
export async function getOpenForeshadows(bookId: string): Promise<Foreshadow[]> {
  try {
    const cached = await redis.get(CACHE_KEY(bookId));
    if (cached) {
      const list = JSON.parse(cached) as Foreshadow[];
      logInfo("service:foreshadow", "open 복선 캐시 히트", { book_id: bookId, count: list.length });
      return list;
    }
  } catch {}

  try {
    const result = await pool.query<Foreshadow>(
      `SELECT id, planted_episode, content, keywords, status, resolved_episode
       FROM foreshadows WHERE book_id = $1 AND status = 'open'
       ORDER BY planted_episode ASC`,
      [bookId]
    );
    const list = result.rows;
    logInfo("service:foreshadow", "open 복선 DB 조회", { book_id: bookId, count: list.length });
    await redis.setex(CACHE_KEY(bookId), CACHE_TTL, JSON.stringify(list));
    return list;
  } catch (err) {
    logError("service:foreshadow", err, { context: "getOpenForeshadows", book_id: bookId });
    return [];
  }
}

// ── 복선 추출 + DB 저장 ──────────────────────────────────
export async function extractAndStoreForeshadow(
  bookId: string,
  episodeNumber: number,
  content: string
): Promise<void> {
  try {
    // 재생성 시 같은 화의 기존 open 복선을 먼저 삭제 (중복 누적 방지)
    // resolved 복선은 보존 (이미 회수된 복선은 유지해야 하기 때문)
    await pool.query(
      `DELETE FROM foreshadows WHERE book_id=$1 AND planted_episode=$2 AND status='open'`,
      [bookId, episodeNumber]
    );

    const res = await getLLMClient().chat.completions.create({
      model: getSummaryModel(),
      messages: [
        {
          role: "system",
          content: [
            "당신은 소설 복선 분석 전문가다. 반드시 아래 규칙을 지켜라.",
            "1. 제공된 소설 본문에서 다음 중 하나라도 해당하면 복선으로 추출한다:",
            "   - 아직 답이 나오지 않은 의문·미스터리 (누가, 왜, 어떻게 등)",
            "   - 등장인물의 숨겨진 동기·비밀·이중성",
            "   - 앞으로 벌어질 사건을 암시하는 묘사·대화·행동",
            "   - 해결되지 않은 갈등·위험·긴장 요소",
            "2. 본문에 없는 내용을 추가하거나 창작하지 않는다.",
            "3. 각 복선을 한 문장으로 서술하고, 핵심 키워드(2~4개)를 함께 반환한다.",
            "4. 최소 1개, 최대 4개를 추출한다. 명백한 복선 요소가 없어도 미해결 의문이나 갈등을 찾아 추출한다.",
            '5. 반드시 JSON 배열만 출력한다. 형식: [{"content":"복선 내용","keywords":["키워드1","키워드2"]}]',
          ].join("\n"),
        },
        {
          role: "user",
          content: `다음 소설 화에서 복선과 미해결 떡밥을 추출해줘:\n\n${content}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 400,
    });

    const raw = res.choices[0]?.message?.content ?? "[]";
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      logWarn("service:foreshadow", "복선 추출 파싱 실패", { book_id: bookId, episode: episodeNumber, raw: raw.slice(0, 120) });
      return;
    }

    const items: { content: string; keywords: string[] }[] = JSON.parse(match[0]);
    if (!items.length) {
      logInfo("service:foreshadow", "추출된 복선 없음", { book_id: bookId, episode: episodeNumber });
      return;
    }

    await Promise.all(items.map(item =>
      pool.query(
        `INSERT INTO foreshadows (book_id, planted_episode, content, keywords, status)
         VALUES ($1, $2, $3, $4, 'open')`,
        [bookId, episodeNumber, item.content, item.keywords]
      )
    ));

    // 캐시 무효화
    await redis.del(CACHE_KEY(bookId));

    logInfo("service:foreshadow", "복선 DB 저장", {
      book_id: bookId,
      episode: episodeNumber,
      count: items.length,
      items: items.map(i => ({ content: i.content.slice(0, 50), keywords: i.keywords })),
    });
  } catch (err) {
    logError("service:foreshadow", err, { book_id: bookId, episode: episodeNumber });
  }
}

// ── 복선 회수 체크 ──────────────────────────────────────
// 현재 화에서 open 복선 중 언급된 것들을 resolved로 마킹
export async function checkAndResolveForeshadows(
  bookId: string,
  episodeNumber: number,
  content: string
): Promise<{ resolved: number; checked: number }> {
  const openList = await getOpenForeshadows(bookId);
  if (!openList.length) return { resolved: 0, checked: 0 };

  const resolved: string[] = [];

  for (const f of openList) {
    // 키워드 중 2개 이상 본문에 포함되면 회수로 판정
    const hitCount = f.keywords.filter(kw => content.includes(kw)).length;
    const threshold = f.keywords.length >= 3 ? 2 : 1;
    if (hitCount >= threshold) {
      resolved.push(f.id);
    }
  }

  if (resolved.length) {
    await pool.query(
      `UPDATE foreshadows SET status = 'resolved', resolved_episode = $1
       WHERE id = ANY($2::uuid[])`,
      [episodeNumber, resolved]
    );
    await redis.del(CACHE_KEY(bookId));

    logInfo("service:foreshadow", "복선 회수 완료", {
      book_id: bookId,
      episode: episodeNumber,
      resolved_count: resolved.length,
      resolved_ids: resolved,
    });
  } else {
    logInfo("service:foreshadow", "복선 회수 없음", {
      book_id: bookId,
      episode: episodeNumber,
      open_count: openList.length,
    });
  }

  return { resolved: resolved.length, checked: openList.length };
}

// ── 통계 조회 ────────────────────────────────────────────
export async function getForeshadowStats(bookId: string): Promise<{
  open: number; resolved: number; abandoned: number; total: number;
  recall_rate: number;
}> {
  try {
    const res = await pool.query(
      `SELECT status, COUNT(*) as cnt FROM foreshadows WHERE book_id = $1 GROUP BY status`,
      [bookId]
    );
    const counts: Record<string, number> = {};
    for (const row of res.rows) counts[row.status] = parseInt(row.cnt);
    const open = counts["open"] ?? 0;
    const resolved = counts["resolved"] ?? 0;
    const abandoned = counts["abandoned"] ?? 0;
    const total = open + resolved + abandoned;
    const recall_rate = total ? Math.round((resolved / total) * 100) : 0;
    return { open, resolved, abandoned, total, recall_rate };
  } catch (err) {
    logError("service:foreshadow", err, { context: "getForeshadowStats", book_id: bookId });
    return { open: 0, resolved: 0, abandoned: 0, total: 0, recall_rate: 0 };
  }
}
