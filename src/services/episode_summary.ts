/**
 * episode_summary.ts — 에피소드 LLM 요약 helper (R5B-1)
 *
 * episodes.summary는 다음 화 생성 시 rolling_summary의 source가 된다.
 * fallback(첫 문장)만 저장되면 known_facts/planner [스토리 흐름]이 빈약해져
 * 같은 사실이 반복 prompt 주입되는 정체 패턴이 발생한다.
 *
 * 본 helper는:
 *   1. fallback summary로 즉시 저장 (with marker)된 row를 LLM 요약으로 덮어쓴다
 *   2. fire-and-forget으로 동작 (사용자 latency 영향 없음)
 *   3. 실패 시 fallback이 그대로 유지되어 안전
 *
 * 호출자: api/generate.ts, api/generate_v2.ts, api/episodes.ts
 */
import type { Pool } from "pg";
import { getLLMClient, getSummaryModel } from "../lib/llm.js";
import { logInfo, logWarn } from "../lib/logger.js";

/**
 * fallback summary marker. summary가 이 prefix로 시작하면 LLM 요약으로 덮어쓰기 가능.
 * LLM 요약은 marker 없이 저장됨 → 두 번째 update 차단 (idempotent).
 */
export const SUMMARY_FALLBACK_MARKER = "[[FALLBACK]]";

/**
 * fallback prefix가 붙은 summary 생성 (즉시 저장용).
 * 본문 첫 문장 + marker. rolling_summary 사슬에서 표시는 marker 제거 후 사용.
 */
export function buildFallbackSummary(content: string): string {
  const first = content.split(/[.。!?]/)[0]?.trim() ?? "";
  return `${SUMMARY_FALLBACK_MARKER}${first}`;
}

/** rolling_summary용 — marker 제거 (clean text 반환). */
export function stripFallbackMarker(summary: string | null | undefined): string {
  if (!summary) return "";
  return summary.startsWith(SUMMARY_FALLBACK_MARKER)
    ? summary.slice(SUMMARY_FALLBACK_MARKER.length)
    : summary;
}

/** 해당 summary가 fallback(아직 LLM 요약 없음)인지. */
export function isFallbackSummary(summary: string | null | undefined): boolean {
  return !!summary && summary.startsWith(SUMMARY_FALLBACK_MARKER);
}

/**
 * LLM으로 3~5문장 요약 생성 후 episodes.summary update.
 * - 이미 LLM 요약이 있으면 (marker 없음) 덮어쓰기 안 함 (idempotent).
 * - 실패 시 throw 안 함 — fallback 유지.
 *
 * @returns true if updated, false if skipped (already LLM summary or LLM failure)
 */
export async function generateAndSaveLLMSummary(opts: {
  pool: Pool;
  bookId: string;
  episodeNumber: number;
  content: string;
}): Promise<boolean> {
  const { pool, bookId, episodeNumber, content } = opts;
  // 현재 summary 조회 — 이미 LLM 요약이면 skip
  try {
    const cur = await pool.query(
      `SELECT summary FROM episodes WHERE book_id=$1 AND episode_number=$2`,
      [bookId, episodeNumber],
    );
    const curSummary = cur.rows[0]?.summary as string | undefined;
    if (curSummary && !isFallbackSummary(curSummary)) {
      // 이미 LLM 요약 — skip
      return false;
    }
  } catch (e) {
    logWarn("service:episode_summary", "summary 조회 실패 (계속 진행)", { error: String(e) });
  }

  let llmSummary: string;
  try {
    const t0 = Date.now();
    const res = await getLLMClient().chat.completions.create({
      model: getSummaryModel(),
      messages: [
        {
          role: "system",
          content: [
            "당신은 소설 요약 전문가다. 반드시 아래 규칙을 지켜라.",
            "1. 사용자가 제공한 소설 본문만 요약한다. 없는 내용을 추가하거나 창작하지 않는다.",
            "2. 등장인물 이름, 주요 사건(발견·결정·관계 변화·확정 사실), 감정 흐름을 3~5문장으로 서술한다.",
            "3. 반드시 본문에 실제로 등장한 인물 이름만 사용한다.",
            "4. 요약문만 출력한다. 설명·주석·도입어 금지.",
          ].join("\n"),
        },
        { role: "user", content: `다음 소설 화를 요약해줘:\n\n${content}` },
      ],
      temperature: 0.1,
      max_tokens: 280,
    });
    const raw = res.choices[0]?.message?.content?.trim() ?? "";
    if (raw.length < 30) {
      logWarn("service:episode_summary", "LLM 요약 너무 짧음 — fallback 유지", {
        book_id: bookId, episode: episodeNumber, len: raw.length,
      });
      return false;
    }
    llmSummary = raw;
    logInfo("service:episode_summary", "LLM 요약 생성 완료", {
      book_id: bookId, episode: episodeNumber, len: raw.length, ms: Date.now() - t0,
    });
  } catch (e) {
    logWarn("service:episode_summary", "LLM 요약 호출 실패 — fallback 유지", {
      book_id: bookId, episode: episodeNumber, error: String(e),
    });
    return false;
  }

  try {
    // marker 없는 LLM 요약으로 덮어쓰기. 단, 이 사이 다른 caller가 LLM 요약을 이미 넣었을 가능성 대비
    // → WHERE 절에 fallback marker 조건을 둬서 race condition 시 후속 update 차단.
    const upd = await pool.query(
      `UPDATE episodes
         SET summary=$1
       WHERE book_id=$2 AND episode_number=$3
         AND (summary IS NULL OR summary LIKE $4 || '%')`,
      [llmSummary, bookId, episodeNumber, SUMMARY_FALLBACK_MARKER],
    );
    return (upd.rowCount ?? 0) > 0;
  } catch (e) {
    logWarn("service:episode_summary", "summary update 실패", {
      book_id: bookId, episode: episodeNumber, error: String(e),
    });
    return false;
  }
}
