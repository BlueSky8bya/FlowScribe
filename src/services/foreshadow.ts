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
            "",
            "[복선이란 — 추출 대상]",
            "복선은 '아직 본문에서 일어나지 않은 사건을 암시'하거나 '앞으로 답이 필요한 미해결 질문'이다.",
            "다음만 추출한다:",
            "  - 아직 정체가 밝혀지지 않은 인물·존재",
            "  - 아직 발생하지 않은 위험·사건의 암시",
            "  - 아직 설명되지 않은 모순·이질성",
            "  - 등장인물의 숨겨진 동기·비밀·이중성",
            "  - 다음 화 이후에 답·결과·정체가 드러날 수 있는 미해결 질문",
            "",
            "[복선 아님 — 절대 추출 금지]",
            "다음 항목은 '이미 본문에서 발생한 사건'이므로 복선이 아니다. 의미가 미스터리하더라도 복선으로 추출하지 않는다:",
            "  - 본문에서 인물이 직접 발견·확인한 흔적·단서·증거",
            "  - 본문에서 인물이 말로 공유한 사실·정보",
            "  - 본문에서 이미 일어난 검증·조사·실험 행위",
            "  - 본문에서 이미 확인된 상태·규칙·물리 현상",
            "  - 본문에서 이미 일어난 만남·대화·결정·각성",
            "  - 단순 장소·환경·분위기 묘사",
            "발견된 흔적의 '의미가 무엇인가'는 미해결 질문이 될 수 있지만, 그 경우 '발견 사건'이 아니라 '의미에 대한 미해결 질문' 형태로만 표현하라.",
            "",
            "[출력 규칙]",
            "1. 본문에 없는 내용을 추가하거나 창작하지 않는다.",
            "2. 각 복선은 '아직 답이 없는 질문' 또는 '아직 일어나지 않은 사건의 암시' 형태로 한 문장 서술. 발견 행위 자체를 서술하지 말 것.",
            "3. 핵심 키워드(2~4개) 동반.",
            "4. 0~4개 추출. 명백한 미해결 질문이 없으면 빈 배열 반환 OK — 억지로 추출하지 말 것.",
            '5. 반드시 JSON 배열만 출력. 형식: [{"content":"복선 내용","keywords":["키워드1","키워드2"]}]',
            "",
            "[예시]",
            '나쁨: {"content":"카이렌이 도서관 입구에서 흔적을 발견했다","keywords":["흔적","발견"]}',
            "  → 발견 사건은 이미 일어남. 복선 아님.",
            '좋음: {"content":"도서관 입구의 흔적을 남긴 자의 정체와 목적이 아직 드러나지 않았다","keywords":["흔적 주체","정체","목적"]}',
            "  → 발견 자체가 아닌, '아직 답이 없는 질문'으로 표현.",
          ].join("\n"),
        },
        {
          role: "user",
          content: `다음 소설 화에서 미해결 질문 또는 미래 사건의 암시만 추출해줘 (이미 발생한 발견·확인 사건은 추출 금지):\n\n${content}`,
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

    // R5B-1.5: dedup 강화
    //   - threshold 0.6 → 0.4 (motif 표현 변주를 더 강하게 차단)
    //   - keyword + content head signature 양쪽 비교 (조사·동사·공백 normalize)
    //   - 최근 3화 내 plant된 open 복선만 비교 대상 (오래된 motif는 dedup 제외)
    const RECENT_WINDOW = 3;
    const existingOpen = await pool.query(
      `SELECT planted_episode, keywords, content FROM foreshadows
       WHERE book_id=$1 AND status='open'
         AND planted_episode < $2 AND planted_episode >= $3`,
      [bookId, episodeNumber, Math.max(1, episodeNumber - RECENT_WINDOW)]
    ).then(r => r.rows.map((row: any) => ({
      keywords: Array.isArray(row.keywords) ? row.keywords : [],
      content: typeof row.content === "string" ? row.content : "",
    }))).catch(() => [] as Array<{ keywords: string[]; content: string }>);

    // R5B-1.5: motif normalize — 한글 조사/공백/특수문자 제거, lowercase.
    // "마력의 잔재" / "마력 잔재" / "마력잔재" 모두 동일 시그니처로 처리.
    const _STOPWORD_PARTICLE = /[은는이가을를의에과와로으로도]$/;
    const _normToken = (s: string) => {
      let t = (s ?? "").toLowerCase().trim();
      // 한글 조사 끝글자 제거 (반복 적용으로 다중 조사도 처리)
      while (_STOPWORD_PARTICLE.test(t)) t = t.slice(0, -1);
      return t.replace(/[\s　\p{P}]+/gu, "");
    };
    // content 첫 문장 → 명사구 토큰 set (한글 2~5자 sequence 추출)
    const _contentSig = (content: string) => {
      const head = content.slice(0, 80);
      const tokens = head.match(/[가-힣]{2,5}/g) ?? [];
      return new Set(tokens.map(_normToken).filter(Boolean));
    };
    const _setJaccard = (sa: Set<string>, sb: Set<string>) => {
      if (!sa.size || !sb.size) return 0;
      let inter = 0;
      for (const k of sa) if (sb.has(k)) inter++;
      return inter / (sa.size + sb.size - inter);
    };
    const _kwSet = (a: string[]) => new Set(a.map(_normToken).filter(Boolean));
    const DEDUP_THRESHOLD = 0.4;

    const accepted: typeof items = [];
    let dedupSkipped = 0;
    for (const item of items) {
      const itemKwSet = _kwSet(item.keywords ?? []);
      const itemSigSet = _contentSig(item.content ?? "");
      let dup = false;
      for (const ex of existingOpen) {
        const exKwSet = _kwSet(ex.keywords);
        const exSigSet = _contentSig(ex.content);
        // keyword 또는 content signature 둘 중 하나가 threshold 넘으면 dup
        const kwSim = _setJaccard(itemKwSet, exKwSet);
        const sigSim = _setJaccard(itemSigSet, exSigSet);
        if (kwSim >= DEDUP_THRESHOLD || sigSim >= DEDUP_THRESHOLD) { dup = true; break; }
      }
      if (dup) { dedupSkipped++; continue; }
      accepted.push(item);
    }

    if (accepted.length === 0) {
      logInfo("service:foreshadow", "추출된 복선 모두 dedup으로 차단됨", {
        book_id: bookId, episode: episodeNumber, total: items.length, skipped: dedupSkipped,
      });
      return;
    }

    await Promise.all(accepted.map(item =>
      pool.query(
        `INSERT INTO foreshadows (book_id, planted_episode, content, keywords, status)
         VALUES ($1, $2, $3, $4, 'open')`,
        [bookId, episodeNumber, item.content, item.keywords]
      )
    ));

    if (dedupSkipped > 0) {
      logInfo("service:foreshadow", "복선 dedup", {
        book_id: bookId, episode: episodeNumber,
        accepted: accepted.length, skipped: dedupSkipped, threshold: DEDUP_THRESHOLD,
      });
    }
    // 이후 로그는 accepted 기준으로 동작하도록 items 변수 교체 (logInfo 아래 블록과 정합성)
    items.length = 0;
    items.push(...accepted);

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
    // 키워드 매칭 기준 강화:
    // - keywords 2개 이하: 모든 키워드가 포함되어야 함 (AND 조건)
    // - keywords 3개 이상: 절반 초과 포함 + 본문에 회수 맥락 필요
    // - 같은 에피소드에서 planted + resolved는 허용하지 않음 (즉시 회수 방지)
    if (f.planted_episode === episodeNumber) continue; // 같은 화 planted는 resolved 불가
    const hitCount = f.keywords.filter(kw => content.includes(kw)).length;
    const totalKw = f.keywords.length;
    let meetsThreshold: boolean;
    if (totalKw <= 2) {
      // 2개 이하 키워드: 전부 포함해야 함
      meetsThreshold = hitCount >= totalKw;
    } else {
      // 3개 이상: 절반 초과 + 최소 2개
      meetsThreshold = hitCount >= 2 && hitCount > totalKw / 2;
    }
    // 추가 필터: 본문이 너무 짧으면 (200자 미만) 키워드 단순 재언급 가능성 높음 → 건너뜀
    if (!meetsThreshold) continue;
    if (content.length < 200) continue;
    resolved.push(f.id);
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
