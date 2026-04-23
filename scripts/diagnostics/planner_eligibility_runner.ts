/**
 * planner_eligibility_runner.ts — Planner SFT eligibility 실측 진단
 *
 * 실행: npx tsx scripts/diagnostics/planner_eligibility_runner.ts [count] [seed]
 *   count: 케이스 수 (기본 20)
 *   seed:  재현용 시드 (기본 "planner-eligibility-v1")
 *
 * 측정 항목:
 *   - plan_validation 분포 (PASS / WARN / FAIL)
 *   - fallback_used 비율
 *   - repairPlan 적용 후 verdict 변화
 *   - is_planner_sft_eligible 비율
 *   - planner reward 분포 (min/avg/max/p50)
 *   - 주요 이슈 필드 빈도
 *
 * 주의: LLM 렌더러/prose validator는 호출하지 않는다.
 *   planner(LLM) + plan_validator(결정론적) + repairPlan(결정론적) 까지만 실행.
 *   따라서 is_renderer_sft_eligible은 측정 불가 (n/a).
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

interface EligibilityRow {
  case_id: string;
  difficulty: string;
  pov: string;
  fallback_used: boolean;
  plan_verdict_before_repair: string;
  plan_verdict_after_repair: string;
  repair_applied: boolean;
  repairs: string[];
  plan_issues: number;
  is_planner_sft_eligible: boolean;
  planner_reward: number;
  elapsed_ms: number;
}

async function main() {
  const count = parseInt(process.argv[2] ?? "20", 10);
  const seed  = process.argv[3] ?? "planner-eligibility-v1";

  console.log(`\n📊 Planner Eligibility 진단`);
  console.log(`   케이스: ${count}개 | seed: "${seed}"`);
  console.log(`   측정 범위: planner + plan_validator + repairPlan (렌더러/prose validator 제외)`);
  console.log("─".repeat(70));

  const cases = generateTestCases(count, "all", seed);
  const rows: EligibilityRow[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc  = cases[i];
    const ctx = testCaseToEffectiveContext(tc) as any;
    process.stdout.write(`  [${i+1}/${cases.length}] ${tc.description.slice(0, 50)}... `);

    const t0 = Date.now();
    try {
      const sc = extractStateConstraints(ctx);
      const { plan: creativePlan, fallback_used, raw_output } = await runCreativePlanner(ctx, sc);
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

      // Plan validation (before repair)
      const validationBefore = validatePlan(scenePlan, ctx);
      const verdictBefore = validationBefore.verdict;

      // Auto repair
      let verdictAfter = verdictBefore;
      let repairApplied = false;
      let repairsApplied: string[] = [];
      let finalValidation = validationBefore;

      if (verdictBefore !== "PASS") {
        const repairResult = repairPlan(validationBefore, ctx);
        if (repairResult.repaired) {
          finalValidation = validatePlan(repairResult.plan, ctx);
          verdictAfter   = finalValidation.verdict;
          repairApplied  = true;
          repairsApplied = repairResult.repairs_applied;
        }
      }

      // SFT eligibility
      const is_planner_sft_eligible = finalValidation.verdict === "PASS" && !fallback_used;

      // Reward 계산
      const rewardBreakdown = computePlannerReward(finalValidation, fallback_used);
      const planner_reward  = rewardBreakdown.planner_reward;

      const statusStr = `plan=${verdictBefore}${repairApplied ? `→${verdictAfter}` : ""} fallback=${fallback_used} sft=${is_planner_sft_eligible} reward=${planner_reward.toFixed(2)} (${elapsed_ms}ms)`;
      console.log(statusStr);

      rows.push({
        case_id: tc.id,
        difficulty: tc.difficulty,
        pov: tc.gen_config.pov,
        fallback_used,
        plan_verdict_before_repair: verdictBefore,
        plan_verdict_after_repair: verdictAfter,
        repair_applied: repairApplied,
        repairs: repairsApplied,
        plan_issues: finalValidation.issues.length,
        is_planner_sft_eligible,
        planner_reward,
        elapsed_ms,
      });
    } catch (err) {
      console.log(`ERROR: ${String(err).slice(0, 60)}`);
      rows.push({
        case_id: tc.id, difficulty: tc.difficulty, pov: tc.gen_config.pov,
        fallback_used: true, plan_verdict_before_repair: "ERROR", plan_verdict_after_repair: "ERROR",
        repair_applied: false, repairs: [], plan_issues: 0,
        is_planner_sft_eligible: false, planner_reward: 0, elapsed_ms: Date.now() - t0,
      });
    }
  }

  // ── 집계 ────────────────────────────────────────────────────
  const total = rows.length;
  const passBeforeRepair = rows.filter(r => r.plan_verdict_before_repair === "PASS").length;
  const warnBeforeRepair = rows.filter(r => r.plan_verdict_before_repair === "WARN").length;
  const failBeforeRepair = rows.filter(r => r.plan_verdict_before_repair === "FAIL").length;

  const passAfterRepair  = rows.filter(r => r.plan_verdict_after_repair === "PASS").length;
  const warnAfterRepair  = rows.filter(r => r.plan_verdict_after_repair === "WARN").length;
  const failAfterRepair  = rows.filter(r => r.plan_verdict_after_repair === "FAIL").length;

  const fallbackCount    = rows.filter(r => r.fallback_used).length;
  const repairCount      = rows.filter(r => r.repair_applied).length;
  const eligibleCount    = rows.filter(r => r.is_planner_sft_eligible).length;

  const rewards = rows.map(r => r.planner_reward).sort((a, b) => a - b);
  const avgReward = rewards.reduce((s, r) => s + r, 0) / (rewards.length || 1);
  const p50Reward = rewards[Math.floor(rewards.length * 0.5)] ?? 0;
  const minReward = rewards[0] ?? 0;
  const maxReward = rewards[rewards.length - 1] ?? 0;

  const pct = (n: number) => `${n}/${total} (${Math.round(n/total*100)}%)`;

  console.log("\n" + "═".repeat(70));
  console.log("📊 집계 결과");
  console.log("─".repeat(70));
  console.log(`  케이스 수: ${total}  |  seed: "${seed}"`);
  console.log("");
  console.log("  [Plan Validation — repair 전]");
  console.log(`    PASS:  ${pct(passBeforeRepair)}`);
  console.log(`    WARN:  ${pct(warnBeforeRepair)}`);
  console.log(`    FAIL:  ${pct(failBeforeRepair)}`);
  console.log("");
  console.log("  [Plan Validation — repair 후]");
  console.log(`    PASS:  ${pct(passAfterRepair)}`);
  console.log(`    WARN:  ${pct(warnAfterRepair)}`);
  console.log(`    FAIL:  ${pct(failAfterRepair)}`);
  console.log(`    repair 적용: ${pct(repairCount)}`);
  console.log("");
  console.log("  [Planner 품질]");
  console.log(`    fallback 사용:          ${pct(fallbackCount)}`);
  console.log(`    is_planner_sft_eligible: ${pct(eligibleCount)}`);
  console.log(`    reward min/avg/p50/max:  ${minReward.toFixed(2)} / ${avgReward.toFixed(2)} / ${p50Reward.toFixed(2)} / ${maxReward.toFixed(2)}`);
  console.log("");

  // 이슈 필드 빈도 집계
  const issueCounts: Record<string, number> = {};
  for (const row of rows) {
    // re-run final validation to get issues (row only has count)
  }
  // Note: 이슈 필드 세부는 JSON 파일에서 확인

  // 수집 가능성 판단
  const eligiblePct = Math.round(eligibleCount / total * 100);
  console.log("  [수집 가능성 판단]");
  if (eligiblePct >= 40) {
    console.log(`  ✅ is_planner_sft_eligible ${eligiblePct}% — Phase 1 데이터 수집 시작 가능`);
    console.log(`     2주 수집 시 예상 eligible trace: ${eligiblePct}% × 운영 에피소드 수`);
  } else if (eligiblePct >= 20) {
    console.log(`  ⚠️  is_planner_sft_eligible ${eligiblePct}% — 수집은 가능하나 효율 낮음`);
    console.log(`     repairPlan 추가 보강 또는 planner 프롬프트 개선 권장`);
  } else {
    console.log(`  ❌ is_planner_sft_eligible ${eligiblePct}% — 수집 효율 너무 낮음`);
    console.log(`     planner 프롬프트 개선 + repairPlan 보강 먼저 필요`);
  }
  console.log("═".repeat(70));

  // JSON 저장
  const dir = join(ROOT, "logs", "test_results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = join(dir, `planner_eligibility_${Date.now()}.json`);
  const summary = {
    seed, count: total, timestamp: new Date().toISOString(),
    plan_verdict_before_repair: { PASS: passBeforeRepair, WARN: warnBeforeRepair, FAIL: failBeforeRepair },
    plan_verdict_after_repair:  { PASS: passAfterRepair,  WARN: warnAfterRepair,  FAIL: failAfterRepair },
    fallback_count: fallbackCount,
    repair_count: repairCount,
    eligible_count: eligibleCount,
    eligible_pct: eligiblePct,
    reward: { min: minReward, avg: avgReward, p50: p50Reward, max: maxReward },
    rows,
  };
  writeFileSync(filename, JSON.stringify(summary, null, 2));
  console.log(`\n💾 결과 저장: ${filename}`);
}

main().catch(e => { console.error(e); process.exit(1); });
