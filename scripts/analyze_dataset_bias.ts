/**
 * scripts/analyze_dataset_bias.ts — DPO dataset 편향 분석
 *
 * 절대 화수 기준이 아니라 progress_ratio / distance_to_end 기반 상대 위치로 분포를 분석한다.
 * resolved_final_episode가 없는 pair는 "unknown" 버킷으로 처리.
 *
 * 출력 6개 축:
 *   1. 장르(scenario) 분포
 *   2. arc_phase 분포 (progress_ratio 기반)
 *   3. distance_to_end 분포
 *   4. ending_closure_score 분포
 *   5. scenario × arc_phase 교차표
 *   6. scenario × ending zone 교차표
 *
 * 실행:
 *   npx tsx scripts/analyze_dataset_bias.ts [--all | --v3]
 *     --v3   : filter_v3_passed=TRUE pair만 (기본값)
 *     --all  : filter 무관 전체 pair
 */

import "dotenv/config";
import { Pool } from "pg";
import {
  getScenario, computeArcPhase, computeDistanceToEnd, distanceTag,
  printDist, printCrossTable, inc, type DpoArcPhase, type DistanceTag,
} from "./utils/dpo_utils.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const FILTER_ALL = process.argv.includes("--all");

interface BiasRow {
  pair_id:                string;
  book_title:             string;
  episode_number:         number;
  scenario:               string;
  resolved_final_episode: number | null;  // gen_config.resolved_final_episode
  total_episodes:         number | null;  // gen_config.totalEpisodes (fallback)
  effective_final:        number | null;  // resolved ?? total (state_extractor 동일 패턴)
  ending_closure_score:   number | null;
  traj_arc_phase:         string | null;  // trajectory 기반 (참고용)
}

async function loadRows(): Promise<BiasRow[]> {
  const whereClause = FILTER_ALL ? "" : "WHERE dp.filter_v3_passed = TRUE";
  const r = await pool.query(`
    SELECT
      dp.id::text                                                               AS pair_id,
      b.title                                                                   AS book_title,
      dp.episode_number,
      -- resolved_final_episode: 명시값 우선, 없으면 totalEpisodes fallback (state_extractor 동일 패턴)
      (ct.effective_context_snapshot->'gen_config'->>'resolved_final_episode')::int AS resolved_final_episode,
      (ct.effective_context_snapshot->'gen_config'->>'totalEpisodes')::int          AS total_episodes,
      COALESCE(
        (ct.effective_context_snapshot->'gen_config'->>'resolved_final_episode')::int,
        (ct.effective_context_snapshot->'gen_config'->>'totalEpisodes')::int
      )                                                                              AS effective_final,
      -- ending closure (book 최신 ending_reward)
      (
        SELECT er.final_closure_score
        FROM ending_rewards er
        WHERE er.book_id = dp.book_id
        ORDER BY er.computed_at DESC LIMIT 1
      )                                                                         AS ending_closure_score,
      -- trajectory arc_phase (참고용 — 별개 개념)
      (
        SELECT tr.arc_phase
        FROM trajectory_rewards tr
        WHERE tr.book_id = dp.book_id
          AND tr.end_episode <= dp.episode_number
        ORDER BY tr.end_episode DESC LIMIT 1
      )                                                                         AS traj_arc_phase
    FROM dpo_pairs dp
    JOIN run_traces ct ON ct.trace_id = dp.chosen_trace_id
    JOIN books b ON b.id = dp.book_id
    ${whereClause}
    ORDER BY dp.created_at
  `);

  return r.rows.map(row => ({
    ...row,
    scenario: getScenario(row.book_title),
  }));
}

const ARC_COLS:  string[] = ["intro", "early", "mid", "late", "pre_final", "final", "unknown"];
const DIST_COLS: string[] = ["final_1", "final_2", "final_3", "final_5", "far", "unknown"];
const CLOSURE_BUCKETS = ["없음", "0~0.3", "0.3~0.6", "0.6~0.8", "0.8~1.0"] as const;

function closureBucket(score: number | null): string {
  if (score === null || score === undefined) return "없음";
  if (score < 0.3) return "0~0.3";
  if (score < 0.6) return "0.3~0.6";
  if (score < 0.8) return "0.6~0.8";
  return "0.8~1.0";
}

async function main() {
  const rows = await loadRows();
  const filterDesc = FILTER_ALL ? "전체 pair" : "filter_v3_passed=TRUE pair";
  console.log(`\n=== DPO Dataset Bias Analysis (${filterDesc}: ${rows.length}개) ===`);

  const scenarioDist:       Record<string, number>                  = {};
  const arcPhaseDist:       Record<string, number>                  = {};
  const distanceDist:       Record<string, number>                  = {};
  const closureDist:        Record<string, number>                  = {};

  const scenarioArc:        Record<string, Record<string, number>>  = {};
  const scenarioDistance:   Record<string, Record<string, number>>  = {};
  const scenarioClosure:    Record<string, Record<string, number>>  = {};

  let unknownResolved = 0;

  for (const row of rows) {
    const arcPhase  = computeArcPhase(row.episode_number, row.effective_final);
    const distance  = computeDistanceToEnd(row.episode_number, row.effective_final);
    const dTag      = distanceTag(distance);
    const closure   = closureBucket(row.ending_closure_score);

    if (!row.effective_final) unknownResolved++;

    inc(scenarioDist,  row.scenario);
    inc(arcPhaseDist,  arcPhase);
    inc(distanceDist,  dTag);
    inc(closureDist,   closure);

    (scenarioArc[row.scenario]      ??= {})[arcPhase] = ((scenarioArc[row.scenario]?.[arcPhase]) ?? 0) + 1;
    (scenarioDistance[row.scenario] ??= {})[dTag]     = ((scenarioDistance[row.scenario]?.[dTag]) ?? 0) + 1;
    (scenarioClosure[row.scenario]  ??= {})[closure]  = ((scenarioClosure[row.scenario]?.[closure]) ?? 0) + 1;
  }

  // ── 1. 장르 분포 ──────────────────────────────────────────────
  printDist("1. 장르(scenario) 분포", scenarioDist);

  // ── 2. arc_phase 분포 ─────────────────────────────────────────
  printDist("2. arc_phase 분포 (progress_ratio 기반)", arcPhaseDist);
  if (unknownResolved > 0) {
    console.log(`  ⚠ resolved_final_episode 미확인: ${unknownResolved}개 → arc_phase=unknown`);
  }

  // ── 3. distance_to_end 분포 ───────────────────────────────────
  printDist("3. distance_to_end 분포", distanceDist);

  // ── 4. ending_closure_score 분포 ─────────────────────────────
  printDist("4. ending_closure_score 분포 (ending_reward 있는 pair)", closureDist);

  // ── 5. scenario × arc_phase 교차표 ───────────────────────────
  printCrossTable("5. scenario × arc_phase 교차표", scenarioArc, ARC_COLS);

  // ── 6. scenario × ending zone 교차표 ─────────────────────────
  printCrossTable("6. scenario × ending zone 교차표", scenarioDistance, DIST_COLS);

  // ── 수집 편향 진단 요약 ───────────────────────────────────────
  console.log(`\n[수집 편향 진단]`);
  const totalN = rows.length;

  // 편향 경고: 장르
  const maxGenre = Math.max(...Object.values(scenarioDist));
  const minGenre = Math.min(...Object.values(scenarioDist));
  if (maxGenre > minGenre * 2) {
    const maxKey = Object.entries(scenarioDist).find(([,v]) => v === maxGenre)![0];
    const minKey = Object.entries(scenarioDist).find(([,v]) => v === minGenre)![0];
    console.log(`  ⚠ 장르 편향: ${maxKey}(${maxGenre}) vs ${minKey}(${minGenre}) — 2배 이상 차이`);
  } else {
    console.log(`  ✓ 장르 분포 균형`);
  }

  // 편향 경고: arc_phase
  const endingN = (arcPhaseDist["pre_final"] ?? 0) + (arcPhaseDist["final"] ?? 0);
  const endingPct = totalN > 0 ? (endingN / totalN * 100).toFixed(1) : "0";
  if (endingN < totalN * 0.15) {
    console.log(`  ⚠ ending zone 부족: pre_final+final=${endingN}개 (${endingPct}%) — 15% 미만`);
  } else {
    console.log(`  ✓ ending zone: pre_final+final=${endingN}개 (${endingPct}%)`);
  }

  // mid 과다
  const midN = arcPhaseDist["mid"] ?? 0;
  if (midN > totalN * 0.5) {
    console.log(`  ⚠ mid 과다: ${midN}개 (${(midN/totalN*100).toFixed(1)}%) — 수집 구간 다양화 필요`);
  }

  // 편향 경고: ending_reward
  const hasEndingN = totalN - (closureDist["없음"] ?? 0);
  console.log(`  ending_reward 커버리지: ${hasEndingN}/${totalN} (${(hasEndingN/totalN*100).toFixed(1)}%)`);

  // unknown resolved
  if (unknownResolved > 0) {
    console.log(`  ⚠ resolved_final_episode 없음: ${unknownResolved}개 → arc 분석 불가`);
  }

  console.log(`\n[참고: trajectory 기반 arc_phase 분포 (training/types.ts 기준 — 별개 개념)]`);
  const trajDist: Record<string, number> = {};
  for (const row of rows) inc(trajDist, row.traj_arc_phase ?? "없음");
  for (const [k, v] of Object.entries(trajDist).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error("실패:", e.message);
  await pool.end();
  process.exit(1);
});
