/**
 * scripts/reaudit_v1_traces.ts — v1 reward trace 재심사
 *
 * v1_reward(reward_schema_version != "2.0") 또는 computed_reward NULL인 pair의
 * chosen trace에 대해 reward v2를 재계산하고 filter_v3_passed를 재적용한다.
 *
 * 실행:
 *   npx tsx scripts/reaudit_v1_traces.ts --dry-run   # 분포만 출력 (DB 변경 없음)
 *   npx tsx scripts/reaudit_v1_traces.ts              # 실제 reward v2 재계산 + DB 업데이트
 *
 * 의존성:
 *   - src/training/reward_aggregator.ts (computeRewardV2)
 *   - apply_filter_v3.ts (applyFilterV3 로직 — 직접 구현)
 *   - scripts/utils/dpo_utils.ts
 */

import "dotenv/config";
import { Pool } from "pg";
import {
  computeArcPhase, computeDistanceToEnd, distanceTag,
  detectForeignChars, detectTruncation,
  EE_MIN, JU_MAX, PP_MAX,
  getScenario, printDist, printCrossTable, inc,
} from "./utils/dpo_utils.js";

// reward_aggregator는 src/에서 직접 import (npx tsx로 실행하므로 .ts 해석 가능)
import { computeRewardV2 } from "../src/training/reward_aggregator.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const DRY_RUN = process.argv.includes("--dry-run");

// ── 대상 pair 조회 ────────────────────────────────────────────────

interface AuditTargetRow {
  pair_id:                  string;
  book_id:                  string;
  episode_number:           number;
  book_title:               string;
  // chosen trace
  chosen_trace_id:          string;
  c_schema_ver:             string | null;
  c_has_reward:             boolean;
  c_has_renderer:           boolean;
  c_generated_text:         string | null;
  c_hard_gate_failed:       boolean | null;
  c_ee_score:               number | null;
  c_judge_uncertainty:      number | null;
  c_pp_penalty:             number | null;
  // arc phase 산출용
  resolved_final_episode:   number | null;
  // ending reward
  has_ending_reward:        boolean;
  // full trace data (실제 실행 모드용)
  planner_trace:            unknown;
  plan_validation:          unknown;
  renderer_trace:           unknown;
  prose_validation:         unknown;
  revision_traces:          unknown;
  final_verdict:            string;
  final_score:              number;
  revision_count:           number;
  effective_context_snapshot: unknown;
}

async function loadTargets(): Promise<AuditTargetRow[]> {
  const r = await pool.query(`
    SELECT
      dp.id::text                                                               AS pair_id,
      dp.book_id,
      dp.episode_number,
      b.title                                                                   AS book_title,
      ct.trace_id::text                                                         AS chosen_trace_id,
      ct.computed_reward->>'reward_schema_version'                              AS c_schema_ver,
      (ct.computed_reward IS NOT NULL)                                          AS c_has_reward,
      (ct.renderer_trace IS NOT NULL)                                           AS c_has_renderer,
      ct.renderer_trace->>'generated_text'                                      AS c_generated_text,
      (ct.computed_reward->'episode_extended'->>'hard_gate_failed')::boolean    AS c_hard_gate_failed,
      (ct.computed_reward->'episode_extended'->>'episode_extended_score')::float AS c_ee_score,
      (ct.computed_reward->'episode_extended'->>'judge_uncertainty')::float     AS c_judge_uncertainty,
      (ct.computed_reward->'episode_extended'->>'postprocess_dependency_penalty')::float AS c_pp_penalty,
      -- resolved_final_episode: 명시값 우선, 없으면 totalEpisodes fallback
      COALESCE(
        (ct.effective_context_snapshot->'gen_config'->>'resolved_final_episode')::int,
        (ct.effective_context_snapshot->'gen_config'->>'totalEpisodes')::int
      )                                                                             AS resolved_final_episode,
      -- ending reward 존재 여부
      EXISTS(
        SELECT 1 FROM ending_rewards er WHERE er.book_id = dp.book_id
      )                                                                         AS has_ending_reward,
      -- full trace data (실제 실행 모드용)
      ct.planner_trace,
      ct.plan_validation,
      ct.renderer_trace,
      ct.prose_validation,
      ct.revision_traces,
      ct.final_verdict,
      ct.final_score,
      ct.revision_count,
      ct.effective_context_snapshot
    FROM dpo_pairs dp
    JOIN run_traces ct ON ct.trace_id = dp.chosen_trace_id
    JOIN books b ON b.id = dp.book_id
    WHERE
      ct.computed_reward IS NULL
      OR ct.computed_reward->>'reward_schema_version' != '2.0'
    ORDER BY dp.created_at
  `);
  return r.rows;
}

// ── dry-run: 분포 출력 ────────────────────────────────────────────

function printDryRunReport(rows: AuditTargetRow[]): void {
  console.log(`\n=== reaudit 대상: ${rows.length}개 pair ===\n`);

  const scenarioDist:     Record<string, number> = {};
  const arcPhaseDist:     Record<string, number> = {};
  const distanceDist:     Record<string, number> = {};
  const endingDist:       Record<string, number> = {};
  const resolvedValidN    = rows.filter(r => r.resolved_final_episode).length;

  const scenarioArc:      Record<string, Record<string, number>> = {};
  const scenarioDistance: Record<string, Record<string, number>> = {};

  for (const row of rows) {
    const scenario   = getScenario(row.book_title);
    const arcPhase   = computeArcPhase(row.episode_number, row.resolved_final_episode);
    const distance   = computeDistanceToEnd(row.episode_number, row.resolved_final_episode);
    const dTag       = distanceTag(distance);
    const endingKey  = row.has_ending_reward ? "있음" : "없음";

    inc(scenarioDist, scenario);
    inc(arcPhaseDist, arcPhase);
    inc(distanceDist, dTag);
    inc(endingDist, endingKey);

    (scenarioArc[scenario]      ??= {})[arcPhase] = ((scenarioArc[scenario]?.[arcPhase]) ?? 0) + 1;
    (scenarioDistance[scenario] ??= {})[dTag]     = ((scenarioDistance[scenario]?.[dTag]) ?? 0) + 1;
  }

  printDist("scenario 분포", scenarioDist);
  printDist("arc_phase 분포 (progress_ratio 기반)", arcPhaseDist);
  console.log(`  * resolved_final_episode 유효: ${resolvedValidN}/${rows.length}  (나머지 → unknown)`);
  printDist("distance_to_end 분포", distanceDist);
  printDist("ending_reward 보유 여부", endingDist);
  printDist("reward_schema_version", (() => {
    const m: Record<string, number> = {};
    for (const r of rows) inc(m, r.c_schema_ver ?? "null");
    return m;
  })());

  const ARC_COLS = ["intro", "early", "mid", "late", "pre_final", "final", "unknown"];
  const DIST_COLS = ["final_1", "final_2", "final_3", "final_5", "far", "unknown"];
  printCrossTable("scenario × arc_phase 교차표", scenarioArc, ARC_COLS);
  printCrossTable("scenario × ending zone 교차표", scenarioDistance, DIST_COLS);

  const hasRendererN = rows.filter(r => r.c_has_renderer).length;
  const hasTextN     = rows.filter(r => r.c_generated_text).length;
  console.log(`\n[재심사 가능성 진단]`);
  console.log(`  renderer_trace 존재: ${hasRendererN}/${rows.length}`);
  console.log(`  generated_text 존재: ${hasTextN}/${rows.length}`);
  console.log(`  → 실제 재심사 가능 후보: ~${hasTextN}개`);
  console.log(`\n[DRY RUN — DB 변경 없음]`);
}

// ── 실제 실행: reward v2 재계산 + filter_v3_passed 업데이트 ─────

interface FilterResult { passed: boolean; reason: string | null; }

function applyFilterV3Logic(row: AuditTargetRow, reward: any): FilterResult {
  if (!row.c_has_renderer || !row.c_generated_text) return { passed: false, reason: "no_renderer_trace" };
  if (reward === null) return { passed: false, reason: "no_reward" };
  if (reward.reward_schema_version !== "2.0") return { passed: false, reason: "v1_reward" };

  const ee = reward.episode_extended;
  if (!ee) return { passed: false, reason: "no_episode_extended" };
  if (ee.hard_gate_failed === true) return { passed: false, reason: "hard_gate_failed" };

  // score_delta, verdict 조건 — dpo_pairs에서 직접 적용
  // (이 함수는 reward 재계산 후 ee_score/judge_uncertainty/pp_penalty만 재검사)
  if (ee.episode_extended_score < EE_MIN) return { passed: false, reason: `ee_score_too_low_${ee.episode_extended_score.toFixed(3)}` };
  if (ee.judge_uncertainty > JU_MAX)      return { passed: false, reason: `high_judge_uncertainty_${ee.judge_uncertainty.toFixed(3)}` };
  if (ee.postprocess_dependency_penalty < -PP_MAX) return { passed: false, reason: `postprocess_heavy` };

  const text = row.c_generated_text;
  if (detectTruncation(text))   return { passed: false, reason: "chosen_truncated" };
  if (detectForeignChars(text)) return { passed: false, reason: "chosen_foreign_char" };

  return { passed: true, reason: null };
}

async function runReaudit(rows: AuditTargetRow[]): Promise<void> {
  const eligible = rows.filter(r => r.c_has_renderer && r.c_generated_text);
  console.log(`\n재심사 가능: ${eligible.length}/${rows.length}개 (renderer_trace + generated_text 있음)`);

  let updated = 0, failed = 0, nowPassed = 0;

  for (const row of eligible) {
    try {
      // RunTrace 재조립 (computeRewardV2에 필요한 최소 구조)
      const runTrace: any = {
        trace_id:         row.chosen_trace_id,
        trace_type:       "planner",
        book_id:          row.book_id,
        episode_number:   row.episode_number,
        planner_trace:    row.planner_trace,
        plan_validation:  row.plan_validation,
        renderer_trace:   row.renderer_trace,
        prose_validation: row.prose_validation,
        revision_traces:  Array.isArray(row.revision_traces) ? row.revision_traces : [],
        final_verdict:    row.final_verdict,
        final_score:      row.final_score,
        revision_count:   row.revision_count,
        effective_context_snapshot: row.effective_context_snapshot,
        created_at:       new Date().toISOString(),
        is_planner_sft_eligible: false,
        is_renderer_sft_eligible: false,
        is_preference_eligible: false,
      };

      const reward = computeRewardV2(runTrace, row.c_generated_text!);
      const filter = applyFilterV3Logic(row, reward);

      await pool.query(`
        UPDATE run_traces
        SET computed_reward = $1, reward_schema_version = '2.0'
        WHERE trace_id = $2::uuid
      `, [JSON.stringify(reward), row.chosen_trace_id]);

      await pool.query(`
        UPDATE dpo_pairs
        SET filter_v3_passed = $1, filter_v3_reason = $2, filter_v3_at = NOW()
        WHERE id = $3::uuid
      `, [filter.passed, filter.reason, row.pair_id]);

      updated++;
      if (filter.passed) nowPassed++;
      process.stdout.write(`\r  진행: ${updated}/${eligible.length}  nowPassed: ${nowPassed}`);
    } catch (err) {
      failed++;
      console.error(`\n  [WARN] pair ${row.pair_id} 재심사 실패: ${(err as Error).message}`);
    }
  }

  console.log(`\n\n=== 재심사 완료 ===`);
  console.log(`  업데이트: ${updated}개  실패: ${failed}개`);
  console.log(`  재심사 후 신규 v3_passed: ${nowPassed}개`);
}

// ── 메인 ──────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[reaudit_v1_traces]  DRY_RUN=${DRY_RUN}`);
  const rows = await loadTargets();

  if (!rows.length) {
    console.log("v1_reward 대상 pair 없음 — 전부 v2 스키마.");
    await pool.end();
    return;
  }

  if (DRY_RUN) {
    printDryRunReport(rows);
  } else {
    printDryRunReport(rows);
    console.log(`\n실제 재심사 실행 중...`);
    await runReaudit(rows);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error("실패:", e.message);
  await pool.end();
  process.exit(1);
});
