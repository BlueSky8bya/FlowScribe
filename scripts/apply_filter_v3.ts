/**
 * scripts/apply_filter_v3.ts — filter v3 backfill
 *
 * filter v2 → v3 변경:
 *   신규 hard reject:
 *     - reward_schema_version != "2.0"     (v1_reward)
 *     - hard_gate_failed = true            (hard_gate_failed)
 *     - episode_extended_score < EE_MIN    (ee_score_too_low, default 0.45)
 *   신규 soft reject:
 *     - judge_uncertainty > JU_MAX         (high_judge_uncertainty, default 0.75)
 *     - postprocess_dependency_penalty > PP_MAX (postprocess_heavy, default 0.15)
 *   기존 유지:
 *     - computed_reward null               (no_reward)
 *     - renderer_trace null                (no_renderer_trace)
 *     - chosen verdict = FAIL              (chosen_is_fail)
 *     - both FAIL                          (both_fail)
 *     - chosen pov_violation && !rejected  (chosen_pov_worse)
 *     - truncation                         (chosen_truncated)
 *     - foreign char                       (chosen_foreign_char)
 *     - score_delta < 5                    (score_delta_below_5)
 *   trajectory/ending: metadata 저장만, hard filter 아님
 *     (final arc pair에서 ending_closure < 0.3이면 metadata flag만 추가)
 *
 * 실행: npx tsx scripts/apply_filter_v3.ts [--dry-run]
 */

import "dotenv/config";
import { Pool } from "pg";
import {
  detectForeignChars, detectTruncation,
  EE_MIN, JU_MAX, PP_MAX,
} from "./utils/dpo_utils.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const DRY_RUN = process.argv.includes("--dry-run");

// EE_MIN, JU_MAX, PP_MAX, detectForeignChars, detectTruncation — dpo_utils에서 import됨

interface PairRow {
  id: string;
  score_delta: number;
  chosen_verdict: string | null;
  rejected_verdict: string | null;
  chosen_pov_violation: boolean;
  rejected_pov_violation: boolean;
  // chosen trace fields
  c_schema_ver: string | null;
  c_has_reward: boolean;
  c_has_renderer: boolean;
  c_generated_text: string | null;
  c_hard_gate_failed: boolean | null;
  c_ee_score: number | null;
  c_judge_uncertainty: number | null;
  c_pp_penalty: number | null;
  // trajectory/ending metadata
  traj_mean: number | null;
  traj_arc_phase: string | null;
  ending_closure: number | null;
}

async function loadPairs(): Promise<PairRow[]> {
  const r = await pool.query(`
    SELECT
      dp.id,
      dp.score_delta,
      dp.chosen_verdict,
      dp.rejected_verdict,
      dp.chosen_pov_violation,
      dp.rejected_pov_violation,
      -- chosen trace
      ct.computed_reward->>'reward_schema_version'           AS c_schema_ver,
      (ct.computed_reward IS NOT NULL)                       AS c_has_reward,
      (ct.renderer_trace IS NOT NULL)                        AS c_has_renderer,
      ct.renderer_trace->>'generated_text'                   AS c_generated_text,
      (ct.computed_reward->'episode_extended'->>'hard_gate_failed')::boolean  AS c_hard_gate_failed,
      (ct.computed_reward->'episode_extended'->>'episode_extended_score')::float AS c_ee_score,
      (ct.computed_reward->'episode_extended'->>'judge_uncertainty')::float   AS c_judge_uncertainty,
      (ct.computed_reward->'episode_extended'->>'postprocess_dependency_penalty')::float AS c_pp_penalty,
      -- trajectory (most recent window for this book/episode)
      (SELECT AVG(window_score) FROM trajectory_rewards tr
       WHERE tr.book_id = dp.book_id
         AND tr.end_episode <= dp.episode_number)            AS traj_mean,
      (SELECT arc_phase FROM trajectory_rewards tr
       WHERE tr.book_id = dp.book_id
         AND tr.end_episode <= dp.episode_number
       ORDER BY tr.end_episode DESC LIMIT 1)                 AS traj_arc_phase,
      -- ending reward
      (SELECT final_closure_score FROM ending_rewards er
       WHERE er.book_id = dp.book_id
       ORDER BY computed_at DESC LIMIT 1)                    AS ending_closure
    FROM dpo_pairs dp
    LEFT JOIN run_traces ct ON ct.trace_id = dp.chosen_trace_id
    ORDER BY dp.created_at
  `);
  return r.rows;
}

function applyFilterV3(p: PairRow): { passed: boolean; reason: string | null; flags: string[] } {
  const flags: string[] = [];

  // ── hard rejects (순서 중요: 앞쪽이 우선) ──────────────────────
  if (!p.c_has_renderer || !p.c_generated_text) return { passed: false, reason: "no_renderer_trace", flags };
  if (!p.c_has_reward)                           return { passed: false, reason: "no_reward", flags };
  if (p.c_schema_ver !== "2.0")                  return { passed: false, reason: "v1_reward", flags };
  if (p.c_hard_gate_failed === true)             return { passed: false, reason: "hard_gate_failed", flags };
  if (p.score_delta < 5)                         return { passed: false, reason: `score_delta_${p.score_delta.toFixed(1)}_below_5`, flags };
  if (p.chosen_verdict === "FAIL" && p.rejected_verdict === "FAIL")
                                                 return { passed: false, reason: "both_fail", flags };
  if (p.chosen_verdict === "FAIL")               return { passed: false, reason: "chosen_is_fail", flags };
  if (p.chosen_pov_violation && !p.rejected_pov_violation)
                                                 return { passed: false, reason: "chosen_pov_worse", flags };
  if (detectTruncation(p.c_generated_text))      return { passed: false, reason: "chosen_truncated", flags };
  if (detectForeignChars(p.c_generated_text))    return { passed: false, reason: "chosen_foreign_char", flags };

  // ── v3 신규 hard rejects ────────────────────────────────────────
  if (p.c_ee_score !== null && p.c_ee_score < EE_MIN)
    return { passed: false, reason: `ee_score_too_low_${p.c_ee_score.toFixed(3)}`, flags };
  if (p.c_judge_uncertainty !== null && p.c_judge_uncertainty > JU_MAX)
    return { passed: false, reason: `high_judge_uncertainty_${p.c_judge_uncertainty.toFixed(3)}`, flags };
  if (p.c_pp_penalty !== null && p.c_pp_penalty > PP_MAX)
    return { passed: false, reason: `postprocess_heavy_${p.c_pp_penalty.toFixed(3)}`, flags };

  // ── trajectory / ending: metadata flags (hard reject 아님) ──────
  if (p.traj_mean !== null && p.traj_mean < 0.35) flags.push("traj_low");
  if (p.traj_arc_phase) flags.push(`arc_${p.traj_arc_phase}`);
  if (p.ending_closure !== null && p.ending_closure < 0.3) flags.push("ending_closure_low");

  return { passed: true, reason: null, flags };
}

async function main() {
  const pairs = await loadPairs();
  console.log(`\n[Filter v3 Backfill] 대상: ${pairs.length}개  EE_MIN=${EE_MIN}  JU_MAX=${JU_MAX}  PP_MAX=${PP_MAX}  DRY_RUN=${DRY_RUN}\n`);

  // 통계
  let passed = 0;
  const reasonCount: Record<string, number> = {};
  const v1Count = pairs.filter(p => p.c_schema_ver !== "2.0").length;
  const hardGateCount = pairs.filter(p => p.c_hard_gate_failed === true).length;
  const eeLowCount = pairs.filter(p => p.c_ee_score !== null && p.c_ee_score < EE_MIN).length;
  const juHighCount = pairs.filter(p => p.c_judge_uncertainty !== null && p.c_judge_uncertainty > JU_MAX).length;

  // 27b chosen 비율 (v3 기준)
  let chosen27b = 0;
  let chosenTotal = 0;

  const updates: { id: string; passed: boolean; reason: string | null }[] = [];

  for (const p of pairs) {
    const { passed: p3, reason } = applyFilterV3(p);
    updates.push({ id: p.id, passed: p3, reason });
    if (p3) {
      passed++;
      chosenTotal++;
    }
    if (reason) reasonCount[reason] = (reasonCount[reason] ?? 0) + 1;
  }

  // 27b chosen 비율은 passed pair에서 chosen_model 조회 필요
  const r27b = await pool.query(`
    SELECT COUNT(*) FROM dpo_pairs dp
    JOIN run_traces ct ON ct.trace_id = dp.chosen_trace_id
    WHERE dp.id = ANY($1::uuid[]) AND dp.chosen_model LIKE '%27b%'
  `, [updates.filter(u => u.passed).map(u => u.id)]);
  chosen27b = parseInt(r27b.rows[0].count);

  // 결과 출력
  console.log(`filter v2 usable: 315 → filter v3 usable: ${passed} (${(passed/pairs.length*100).toFixed(1)}%)`);
  console.log(`\n신규 탈락 분석:`);
  console.log(`  v1_reward (schema!=2.0): ${v1Count}건`);
  console.log(`  hard_gate_failed:        ${hardGateCount}건`);
  console.log(`  ee_score < ${EE_MIN}:        ${eeLowCount}건`);
  console.log(`  judge_uncertainty > ${JU_MAX}: ${juHighCount}건`);
  console.log(`\n27b chosen: ${chosen27b}/${passed} (${passed>0?(chosen27b/passed*100).toFixed(1):"0"}%)`);
  console.log(`\n탈락 사유 분포 (상위 10):`);
  Object.entries(reasonCount).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

  if (!DRY_RUN) {
    console.log(`\nDB 업데이트 중...`);
    for (const u of updates) {
      await pool.query(
        `UPDATE dpo_pairs SET filter_v3_passed=$1, filter_v3_reason=$2, filter_v3_at=NOW() WHERE id=$3`,
        [u.passed, u.reason, u.id],
      );
    }
    console.log(`완료: ${updates.length}건 업데이트`);
  } else {
    console.log(`\n[DRY RUN — DB 업데이트 없음]`);
  }

  await pool.end();
}

main().catch(async e => { console.error(e); await pool.end(); process.exit(1); });
