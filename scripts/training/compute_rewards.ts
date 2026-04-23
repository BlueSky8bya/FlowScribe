/**
 * scripts/training/compute_rewards.ts — Trace Reward 계산 CLI
 *
 * 사용:
 *   npx tsx scripts/training/compute_rewards.ts [options]
 *
 * options:
 *   --limit=100     처리할 trace 수 (default: 100)
 *   --from=2026-04-01
 *   --out=data/rewards/computed_rewards.jsonl
 */

import "dotenv/config";
import { pool } from "../../src/lib/db.js";
import { computeRewardBatch, summarizeRewards } from "../../src/training/reward_aggregator.js";
import { exportToJSONL } from "../../src/training/dataset_builder.js";
import type { RunTrace } from "../../src/training/types.js";

const args = process.argv.slice(2);
const getFlag = (name: string, def: string) =>
  args.find(a => a.startsWith(`--${name}=`))?.split("=")[1] ?? def;

const limit  = parseInt(getFlag("limit", "100"));
const dateFrom = getFlag("from", "");
const outPath  = getFlag("out", "data/rewards/computed_rewards.jsonl");

async function main() {
  console.log(`[compute_rewards] limit=${limit} out=${outPath}`);

  const { rows } = await pool.query<RunTrace>(
    `SELECT * FROM run_traces
     WHERE trace_type = 'planner'
     ${dateFrom ? `AND created_at >= '${dateFrom}'` : ""}
     ORDER BY created_at DESC
     LIMIT ${limit}`,
  );

  console.log(`  → ${rows.length}개 trace 로드`);

  const rewards = computeRewardBatch(rows);
  const summary = summarizeRewards(rewards);

  exportToJSONL(rewards, outPath);

  console.log("\n[Reward 통계]");
  console.log(`  count:          ${summary.count}`);
  console.log(`  mean_combined:  ${summary.mean_combined.toFixed(3)}`);
  console.log(`  mean_planner:   ${summary.mean_planner.toFixed(3)}`);
  console.log(`  mean_renderer:  ${summary.mean_renderer.toFixed(3)}`);
  console.log(`  p50_combined:   ${summary.p50_combined.toFixed(3)}`);
  console.log(`  p90_combined:   ${summary.p90_combined.toFixed(3)}`);

  console.log(`\n✅ ${outPath} 저장 완료`);
}

main()
  .catch(e => { console.error("❌", e); process.exit(1); })
  .finally(() => pool.end());
