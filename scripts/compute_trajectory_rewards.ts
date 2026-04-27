/**
 * scripts/compute_trajectory_rewards.ts — trajectory reward 배치 계산 + DB 적재
 *
 * 실행: npx tsx scripts/compute_trajectory_rewards.ts [book_id1 book_id2 ...]
 *       book_id 미전달 시 run_traces에 에피소드가 있는 모든 책 처리
 *
 * 저장 위치:
 *   run_traces.trajectory_reward  (책 단위 summary JSON)
 *   trajectory_rewards            (window 단위 전체 row)
 */

import "dotenv/config";
import { Pool } from "pg";
import { computeTrajectoryReward, computeAllWindows, loadEpisodeSnapshots } from "../src/training/trajectory_reward.js";
import { logInfo, logWarn, logError } from "../src/lib/logger.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

async function getTargetBooks(specificIds: string[]): Promise<string[]> {
  if (specificIds.length) return specificIds;
  const r = await pool.query(
    `SELECT DISTINCT book_id FROM run_traces
     WHERE book_id IS NOT NULL AND prose_validation IS NOT NULL
     ORDER BY book_id`,
  );
  return r.rows.map((row: any) => row.book_id);
}

async function processBook(bookId: string): Promise<{ windows: number; skipped: boolean }> {
  const episodes = await loadEpisodeSnapshots(bookId, pool);
  if (episodes.length < 2) {
    logWarn("batch:trajectory", "에피소드 부족 — 스킵", { book_id: bookId, count: episodes.length });
    return { windows: 0, skipped: true };
  }

  const reward = await computeTrajectoryReward(bookId, pool);

  // ── trajectory_rewards 테이블에 window 단위 저장 ──────────────
  let insertedWindows = 0;
  for (const w of reward.windows) {
    await pool.query(
      `INSERT INTO trajectory_rewards
         (book_id, window_size, start_episode, end_episode,
          scores, window_score, arc_phase,
          includes_final_episode, resolved_final_episode, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (book_id, window_size, start_episode, end_episode)
       DO UPDATE SET
         scores = EXCLUDED.scores,
         window_score = EXCLUDED.window_score,
         arc_phase = EXCLUDED.arc_phase,
         includes_final_episode = EXCLUDED.includes_final_episode,
         resolved_final_episode = EXCLUDED.resolved_final_episode,
         computed_at = NOW()`,
      [
        bookId,
        w.window_size,
        w.start_episode,
        w.end_episode,
        JSON.stringify(w.scores),
        w.window_score,
        w.arc_phase,
        w.includes_final_episode,
        reward.resolved_final_episode,
      ],
    );
    insertedWindows++;
  }

  // ── run_traces.trajectory_reward (책 단위 summary) ───────────
  const summaryPayload = {
    book_id:                  reward.book_id,
    resolved_final_episode:   reward.resolved_final_episode,
    summary:                  reward.summary,
    window_count:             reward.windows.length,
    computed_at:              reward.computed_at,
    reward_schema_version:    "2.0",
  };
  await pool.query(
    `UPDATE run_traces
     SET trajectory_reward = $1
     WHERE book_id = $2 AND computed_reward IS NOT NULL`,
    [JSON.stringify(summaryPayload), bookId],
  ).catch((err: any) => {
    logWarn("batch:trajectory", "run_traces.trajectory_reward 저장 실패", { error: String(err) });
  });

  logInfo("batch:trajectory", "완료", {
    book_id:  bookId,
    episodes: episodes.length,
    windows:  insertedWindows,
    mean:     reward.summary.mean_window_score,
    arc_coherence: reward.summary.arc_coherence_score,
  });

  return { windows: insertedWindows, skipped: false };
}

async function main() {
  const specificIds = process.argv.slice(2).filter(a => a.length > 10);
  const bookIds = await getTargetBooks(specificIds);

  console.log(`\n[Trajectory Batch] 대상 책: ${bookIds.length}개\n`);

  let totalWindows = 0;
  let skipped = 0;
  for (const bookId of bookIds) {
    try {
      const r = await processBook(bookId);
      if (r.skipped) skipped++;
      else totalWindows += r.windows;
    } catch (err) {
      logError("batch:trajectory", err, { book_id: bookId });
    }
  }

  console.log(`\n완료 — 총 window ${totalWindows}개 저장, ${skipped}개 스킵`);
  await pool.end();
}

main().catch(async (e) => {
  console.error("실패:", e);
  await pool.end();
  process.exit(1);
});
