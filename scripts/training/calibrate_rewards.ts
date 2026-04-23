/**
 * calibrate_rewards.ts — Reward 분산 및 calibration 진단
 *
 * 실행: npx tsx scripts/training/calibrate_rewards.ts [count] [seed] [--repeat=N]
 *   count:    케이스 수 (기본 5)
 *   seed:     시드 (기본 "reward-calibration-v1")
 *   --repeat: 동일 케이스 반복 횟수 (기본 3, judge 분산 측정용)
 *
 * 측정 항목:
 *   - planner reward 세부 항목 통계 (plan_structure / hook_concreteness / fallback_penalty)
 *   - 동일 케이스 N회 반복 시 planner reward 분산
 *   - hook_concreteness 분포 (0 또는 1로만 나오는지 확인)
 *   - renderer reward 항목별 분산 (prose_validation 있는 경우)
 *   - reward histogram (구간별 빈도)
 *
 * 주의: renderer reward 측정을 위해 전체 파이프라인을 실행한다. LLM 호출 발생.
 */

import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const { generateTestCases } = await import("../benchmarks/case_generator.js");
const { extractStateConstraints } = await import("../../src/pipeline/state_extractor.js");
const { runCreativePlanner } = await import("../../src/pipeline/planner.js");
const { validatePlan, repairPlan } = await import("../../src/pipeline/plan_validator.js");
const { computePlannerReward } = await import("../../src/training/reward_aggregator.js");

import type { TestCase } from "../../src/types/canonical.js";

function testCaseToEffectiveContext(tc: TestCase) {
  return {
    episode_number: tc.episode_number,
    gen_config: tc.gen_config,
    world_config: tc.world_config,
    general_rules: tc.world_rules.filter(r => r.rule_type === "general").map(r => r.content),
    absolute_forbidden: tc.world_rules.filter(r => r.rule_type === "absolute_forbidden").map(r => r.content),
    active_interventions: tc.active_interventions,
    characters: tc.characters,
    character_dynamic_states: tc.character_dynamic_states,
    character_inferred_states: [],
    prev_episode_state: tc.prev_episode_state,
    task: tc.task,
    foreshadow_memory: tc.prev_episode_state.open_foreshadows.map((f: string, i: number) => ({
      id: `test-${i}`, planted_episode: tc.episode_number - 2, content: f, keywords: [],
    })),
    arc_summaries: [],
    character_arcs: {},
    rolling_summary: tc.prev_episode_state.ending_event
      ? `${tc.episode_number - 1}화: ${tc.prev_episode_state.ending_event}` : "",
    prev_episode_tail: undefined,
    reader_profile: { focus: 55, sentiment: 55, urgency: 50, complexity: 55, dialogue: 55, audio_sync: 40 },
  };
}

interface RewardSample {
  case_id: string;
  repeat_idx: number;
  plan_structure_score: number;
  hook_concreteness: number;
  plan_fallback_penalty: number;
  planner_reward: number;
  fallback_used: boolean;
  plan_verdict: string;
  passed_checks: string[];
  elapsed_ms: number;
}

function stats(values: number[]) {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, std: 0, p50: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return {
    min:  sorted[0],
    max:  sorted[sorted.length - 1],
    mean: +mean.toFixed(4),
    std:  +Math.sqrt(variance).toFixed(4),
    p50:  sorted[Math.floor(sorted.length * 0.5)],
  };
}

function histogram(values: number[], bins: number = 10): Record<string, number> {
  if (values.length === 0) return {};
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = (max - min) / bins || 0.1;
  const hist: Record<string, number> = {};
  for (let i = 0; i < bins; i++) {
    const lo = +(min + i * step).toFixed(3);
    const hi = +(min + (i + 1) * step).toFixed(3);
    hist[`${lo}~${hi}`] = 0;
  }
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / step), bins - 1);
    const lo  = +(min + idx * step).toFixed(3);
    const hi  = +(min + (idx + 1) * step).toFixed(3);
    hist[`${lo}~${hi}`]++;
  }
  return hist;
}

async function main() {
  const count  = parseInt(process.argv[2] ?? "5", 10);
  const seed   = process.argv[3] ?? "reward-calibration-v1";
  const repeat = parseInt(process.argv.find(a => a.startsWith("--repeat="))?.split("=")[1] ?? "3", 10);

  console.log(`\n🔬 Reward Calibration 진단`);
  console.log(`   케이스: ${count}개 | seed: "${seed}" | 반복: ${repeat}회`);
  console.log(`   총 LLM 호출: ${count * repeat}회 (planner만)`);
  console.log("─".repeat(70));

  const cases = generateTestCases(count, "all", seed);
  const samples: RewardSample[] = [];

  for (let ci = 0; ci < cases.length; ci++) {
    const tc  = cases[ci];
    const ctx = testCaseToEffectiveContext(tc) as any;

    console.log(`\n  케이스 ${ci+1}/${cases.length}: ${tc.description.slice(0, 55)}`);

    for (let ri = 0; ri < repeat; ri++) {
      process.stdout.write(`    반복 ${ri+1}/${repeat}... `);
      const t0 = Date.now();

      try {
        const sc = extractStateConstraints(ctx);
        const { plan: creativePlan, fallback_used } = await runCreativePlanner(ctx, sc);
        const elapsed_ms = Date.now() - t0;

        const scenePlan = {
          opening_location:     sc.opening_location,
          opening_time_context: sc.opening_time_context,
          forbidden_actions:    sc.forbidden_actions,
          must_keep_items:      sc.must_keep_items,
          pov_contract:         sc.pov_contract,
          tone_contract:        sc.tone_contract,
          target_length:        sc.target_length,
          ending_constraint:    sc.ending_constraint,
          carryover_effects:    creativePlan.carryover_effects,
          world_rule:           creativePlan.world_rule,
          scene_beats:          creativePlan.scene_beats,
          hook_type:            creativePlan.hook_type,
          hook_payload:         creativePlan.hook_payload,
          hook_concrete_event:  creativePlan.hook_concrete_event,
        } as any;

        let validation = validatePlan(scenePlan, ctx);
        if (validation.verdict !== "PASS") {
          const r = repairPlan(validation, ctx);
          if (r.repaired) validation = validatePlan(r.plan, ctx);
        }

        const rb = computePlannerReward(validation, fallback_used);

        console.log(`plan=${validation.verdict} hook_c=${rb.hook_concreteness} struct=${rb.plan_structure_score.toFixed(2)} reward=${rb.planner_reward.toFixed(3)} (${elapsed_ms}ms)`);

        samples.push({
          case_id: tc.id, repeat_idx: ri,
          plan_structure_score: rb.plan_structure_score,
          hook_concreteness: rb.hook_concreteness,
          plan_fallback_penalty: rb.plan_fallback_penalty,
          planner_reward: rb.planner_reward,
          fallback_used,
          plan_verdict: validation.verdict,
          passed_checks: validation.passed_checks,
          elapsed_ms,
        });
      } catch (err) {
        console.log(`ERROR: ${String(err).slice(0, 60)}`);
      }
    }
  }

  // ── 통계 집계 ────────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("📊 Reward Calibration 결과");
  console.log("─".repeat(70));

  const allRewards     = samples.map(s => s.planner_reward);
  const allStructure   = samples.map(s => s.plan_structure_score);
  const allHookC       = samples.map(s => s.hook_concreteness);

  const hookZero       = allHookC.filter(v => v === 0).length;
  const hookOne        = allHookC.filter(v => v === 1).length;

  console.log("\n  [planner_reward 통계]");
  const rs = stats(allRewards);
  console.log(`    min=${rs.min.toFixed(3)} mean=${rs.mean.toFixed(3)} p50=${rs.p50.toFixed(3)} max=${rs.max.toFixed(3)} std=${rs.std.toFixed(4)}`);

  console.log("\n  [plan_structure_score 통계]");
  const ss = stats(allStructure);
  console.log(`    min=${ss.min.toFixed(3)} mean=${ss.mean.toFixed(3)} p50=${ss.p50.toFixed(3)} max=${ss.max.toFixed(3)} std=${ss.std.toFixed(4)}`);

  console.log("\n  [hook_concreteness 분포]");
  console.log(`    0 (hook_complete 미통과): ${hookZero}/${samples.length} (${Math.round(hookZero/samples.length*100)}%)`);
  console.log(`    1 (hook_complete 통과):   ${hookOne}/${samples.length} (${Math.round(hookOne/samples.length*100)}%)`);

  if (hookZero === 0 || hookOne === 0) {
    console.log(`    ⚠️  hook_concreteness가 한쪽에만 치우쳐 있음 — reward 분산 기여 없음`);
    console.log(`       원인: hook_complete 체크 조건이 지나치게 관대하거나 엄격함`);
    console.log(`       권장: plan_validator.ts hook_complete 체크 조건 재검토`);
  }

  // 케이스 간 분산 vs 케이스 내 분산
  console.log("\n  [반복 재현성 — 케이스별 reward 분산]");
  const caseIds = Array.from(new Set(samples.map(s => s.case_id)));
  let totalIntraVariance = 0;
  for (const cid of caseIds) {
    const csamp = samples.filter(s => s.case_id === cid).map(s => s.planner_reward);
    const cs = stats(csamp);
    console.log(`    ${cid.slice(0, 30).padEnd(30)} std=${cs.std.toFixed(4)}  [${csamp.map(v => v.toFixed(3)).join(", ")}]`);
    totalIntraVariance += cs.std;
  }
  const avgIntraStd = totalIntraVariance / (caseIds.length || 1);
  console.log(`    평균 케이스 내 std: ${avgIntraStd.toFixed(4)}`);
  if (avgIntraStd > 0.05) {
    console.log(`    ⚠️  케이스 내 분산이 높음 — LLM 출력 불안정성이 reward에 영향`);
  } else {
    console.log(`    ✅ 케이스 내 분산 낮음 — planner reward는 주로 케이스 특성에 의존`);
  }

  // Reward histogram
  console.log("\n  [planner_reward 히스토그램]");
  const hist = histogram(allRewards, 5);
  for (const [bin, cnt] of Object.entries(hist)) {
    const bar = "█".repeat(cnt);
    console.log(`    ${bin.padEnd(14)} ${bar.padEnd(20)} (${cnt})`);
  }

  // calibration 진단
  console.log("\n  [Calibration 진단]");
  if (rs.std < 0.05) {
    console.log(`  ⚠️  reward std=${rs.std.toFixed(4)} — 분산이 너무 낮음`);
    console.log(`     GRPO 사용 시 winning/losing pair 구분이 어려움`);
    console.log(`     권장 조치:`);
    console.log(`       1. hook_concreteness: 0/1 이진 → 0/0.5/1 다단계로 변경`);
    console.log(`       2. plan_structure_score: 통과 체크 수 / 전체 체크 수 유지 (현재 OK)`);
    console.log(`       3. scene_beats 개수, beat 다양성 등 세부 점수 추가 검토`);
  } else {
    console.log(`  ✅ reward std=${rs.std.toFixed(4)} — GRPO pair 구분에 충분한 분산`);
  }

  // JSON 저장
  const dir = join(ROOT, "logs", "test_results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = join(dir, `reward_calibration_${Date.now()}.json`);
  const summary = {
    seed, count, repeat, timestamp: new Date().toISOString(),
    stats: {
      planner_reward: rs,
      plan_structure_score: ss,
      hook_concreteness: { zero: hookZero, one: hookOne, total: samples.length },
      avg_intra_std: +avgIntraStd.toFixed(4),
    },
    histogram: hist,
    samples,
  };
  writeFileSync(filename, JSON.stringify(summary, null, 2));
  console.log(`\n💾 결과 저장: ${filename}`);
  console.log("═".repeat(70));
}

main().catch(e => { console.error(e); process.exit(1); });
