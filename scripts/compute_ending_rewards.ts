/**
 * scripts/compute_ending_rewards.ts — ending reward 배치 계산 + DB 적재
 *
 * 실행: npx tsx scripts/compute_ending_rewards.ts [book_id1 book_id2 ...]
 *       book_id 미전달 시 final_verdict='PASS'인 최종화가 있는 모든 책 처리
 *
 * 옵션 환경변수:
 *   ENDING_USE_LLM=true       — DeepSeek LLM judge 활성화 (기본 false, heuristic only)
 *   ENDING_MAX_SUMMARIES=5    — LLM에 전달할 최근 화수 (기본 5)
 *
 * 저장 위치:
 *   ending_rewards            (책 단위 ending 품질 row)
 *   run_traces.ending_reward  (final episode trace에 summary JSON)
 */

import "dotenv/config";
import { Pool } from "pg";
import { computeEndingReward } from "../src/training/ending_reward.js";
import { logInfo, logWarn, logError } from "../src/lib/logger.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const USE_LLM = process.env.ENDING_USE_LLM === "true";
const MAX_SUMMARIES = parseInt(process.env.ENDING_MAX_SUMMARIES ?? "5", 10);

interface BookTarget {
  bookId: string;
  finalEpisode: number;
}

async function getTargetBooks(specificIds: string[]): Promise<BookTarget[]> {
  if (specificIds.length) {
    // 지정 book_id에서 최대 episode_number를 final로 가정
    const results: BookTarget[] = [];
    for (const bookId of specificIds) {
      const r = await pool.query(
        `SELECT MAX(episode_number) AS max_ep FROM run_traces
         WHERE book_id = $1 AND prose_validation IS NOT NULL`,
        [bookId],
      );
      const finalEpisode = parseInt(r.rows[0]?.max_ep ?? "0", 10);
      if (finalEpisode > 0) results.push({ bookId, finalEpisode });
    }
    return results;
  }

  // episode_role='final' 또는 remaining_episodes=0인 trace가 있는 책 탐색
  const r = await pool.query(
    `SELECT DISTINCT ON (book_id)
       book_id,
       episode_number AS final_episode
     FROM run_traces
     WHERE book_id IS NOT NULL
       AND prose_validation IS NOT NULL
       AND (
         planner_trace->'input_contract'->>'episode_role' IN ('final', 'pre-final')
         OR (planner_trace->'input_contract'->>'remaining_episodes')::int <= 1
       )
     ORDER BY book_id, episode_number DESC`,
  );

  if (r.rows.length) return r.rows.map((row: any) => ({ bookId: row.book_id, finalEpisode: row.final_episode }));

  // fallback: 에피소드가 5화 이상인 책의 최대 episode_number 사용
  const fallback = await pool.query(
    `SELECT book_id, MAX(episode_number) AS max_ep
     FROM run_traces
     WHERE book_id IS NOT NULL AND prose_validation IS NOT NULL
     GROUP BY book_id
     HAVING COUNT(*) >= 5
     ORDER BY book_id`,
  );
  return fallback.rows.map((row: any) => ({ bookId: row.book_id, finalEpisode: parseInt(row.max_ep, 10) }));
}

async function processBook({ bookId, finalEpisode }: BookTarget): Promise<boolean> {
  const reward = await computeEndingReward(bookId, finalEpisode, pool, {
    useLLM: USE_LLM,
    maxSummaryEpisodes: MAX_SUMMARIES,
  });

  // ── ending_rewards 테이블 저장 ────────────────────────────────
  await pool.query(
    `INSERT INTO ending_rewards (
       book_id, final_episode_number, resolved_final_episode,
       ending_readiness, central_conflict_resolution, foreshadow_payoff_coverage,
       character_arc_resolution, emotional_resolution, ending_proportionality,
       ending_surprise_earned, sequel_open_hook_balance,
       unresolved_critical_thread_penalty, deus_ex_machina_penalty,
       premature_closure_penalty, overextended_delay_penalty, overexplained_ending_penalty,
       pre_final_convergence_score, final_closure_score,
       judge_summary, judge_model, computed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
     ON CONFLICT (book_id, final_episode_number)
     DO UPDATE SET
       resolved_final_episode = EXCLUDED.resolved_final_episode,
       ending_readiness = EXCLUDED.ending_readiness,
       central_conflict_resolution = EXCLUDED.central_conflict_resolution,
       foreshadow_payoff_coverage = EXCLUDED.foreshadow_payoff_coverage,
       character_arc_resolution = EXCLUDED.character_arc_resolution,
       emotional_resolution = EXCLUDED.emotional_resolution,
       ending_proportionality = EXCLUDED.ending_proportionality,
       ending_surprise_earned = EXCLUDED.ending_surprise_earned,
       sequel_open_hook_balance = EXCLUDED.sequel_open_hook_balance,
       unresolved_critical_thread_penalty = EXCLUDED.unresolved_critical_thread_penalty,
       deus_ex_machina_penalty = EXCLUDED.deus_ex_machina_penalty,
       premature_closure_penalty = EXCLUDED.premature_closure_penalty,
       overextended_delay_penalty = EXCLUDED.overextended_delay_penalty,
       overexplained_ending_penalty = EXCLUDED.overexplained_ending_penalty,
       pre_final_convergence_score = EXCLUDED.pre_final_convergence_score,
       final_closure_score = EXCLUDED.final_closure_score,
       judge_summary = EXCLUDED.judge_summary,
       judge_model = EXCLUDED.judge_model,
       computed_at = NOW()`,
    [
      bookId, finalEpisode, reward.resolved_final_episode,
      reward.ending_readiness, reward.central_conflict_resolution, reward.foreshadow_payoff_coverage,
      reward.character_arc_resolution, reward.emotional_resolution, reward.ending_proportionality,
      reward.ending_surprise_earned, reward.sequel_open_hook_balance,
      reward.unresolved_critical_thread_penalty, reward.deus_ex_machina_penalty,
      reward.premature_closure_penalty, reward.overextended_delay_penalty, reward.overexplained_ending_penalty,
      reward.pre_final_convergence_score, reward.final_closure_score,
      reward.judge_summary ?? null, reward.judge_model ?? null,
    ],
  );

  // ── run_traces.ending_reward (final episode trace에 저장) ─────
  await pool.query(
    `UPDATE run_traces
     SET ending_reward = $1
     WHERE book_id = $2 AND episode_number = $3 AND computed_reward IS NOT NULL`,
    [JSON.stringify({ ...reward, reward_schema_version: "2.0" }), bookId, finalEpisode],
  ).catch((err: any) => {
    logWarn("batch:ending", "run_traces.ending_reward 저장 실패", { error: String(err) });
  });

  logInfo("batch:ending", "완료", {
    book_id:      bookId,
    final_ep:     finalEpisode,
    resolved:     reward.resolved_final_episode,
    closure:      reward.final_closure_score,
    llm_used:     USE_LLM,
  });

  return true;
}

async function main() {
  const specificIds = process.argv.slice(2).filter(a => a.length > 10);
  const targets = await getTargetBooks(specificIds);

  console.log(`\n[Ending Batch] 대상 책: ${targets.length}개  LLM=${USE_LLM}\n`);

  let done = 0;
  for (const target of targets) {
    try {
      await processBook(target);
      done++;
    } catch (err) {
      logError("batch:ending", err, { book_id: target.bookId });
    }
  }

  console.log(`\n완료 — ${done}/${targets.length}개 저장`);
  await pool.end();
}

main().catch(async (e) => {
  console.error("실패:", e);
  await pool.end();
  process.exit(1);
});
