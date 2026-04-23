/**
 * planner_sample_runner.ts — Planner→Renderer 파이프라인 샘플 비교 실행기
 *
 * 실행: npx tsx scripts/planner_sample_runner.ts [case_id]
 *   case_id 기본값: sp-01 (1인칭주인공 / easy / 팔 부상)
 *
 * 출력:
 *   1. ScenePlan JSON (Planner 결과)
 *   2. PlanValidation 결과
 *   3. Renderer 출력 텍스트 (첫 300자)
 *   4. Prose Validation 결과
 *   5. Legacy 출력 텍스트 (첫 300자)
 *   6. Legacy Prose Validation 결과
 *   7. 비교 요약
 */

import "dotenv/config";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── 동적 임포트 ───────────────────────────────────────────────
const { pool } = await import("../src/lib/db.js");
const { runMigrateV2 } = await import("../src/db/migrate_v2.js");
const { getLLMClient, getStoryModel } = await import("../src/lib/llm.js");
const { validate } = await import("../src/services/validator.js");
const { runPlannerPipeline } = await import("../src/pipeline/index.js");

import type { TestCase, EffectiveContext } from "../src/types/canonical.js";
import { AB_STATE_PERSISTENCE_CASES as ALL_SP_CASES } from "./ab_state_persistence_cases.js";

// ── test_runner.ts와 동일한 EffectiveContext 변환 ─────────────
function testCaseToEffectiveContext(tc: TestCase, episodeNumber: number): EffectiveContext {
  const generalRules   = tc.world_rules.filter(r => r.rule_type === "general").map(r => r.content);
  const absoluteForbid = tc.world_rules.filter(r => r.rule_type === "absolute_forbidden").map(r => r.content);

  return {
    episode_number: episodeNumber,
    book_id: "sample-run",
    gen_config: tc.gen_config,
    characters: tc.characters,
    character_dynamic_states: (tc.character_dynamic_states ?? []).map(s => ({
      book_id: "sample-run",
      character_name: s.character_name,
      episode_number: episodeNumber,
      location: s.location ?? "",
      physical_state: s.physical_state ?? "정상",
      items: s.items ?? [],
      recent_goal: s.recent_goal ?? "",
    })),
    prev_episode_state: tc.prev_episode_state,
    general_rules: generalRules,
    absolute_forbidden: absoluteForbid,
    foreshadow_memory: (tc.prev_episode_state.open_foreshadows ?? []).map((f, i) => ({
      id: `f${i}`, content: f, planted_episode: episodeNumber - 1, keywords: [],
    })),
    world_config: tc.world_config,
    task: tc.task,
    active_interventions: tc.active_interventions ?? [],
  };
}

// ─────────────────────────────────────────────────────────────
async function main() {
  try { await runMigrateV2(); } catch {}

  const targetId = process.argv[2] ?? "sp-01";
  const tc = ALL_SP_CASES.find(c => c.id === targetId);
  if (!tc) {
    console.error(`케이스 "${targetId}" 없음. 사용 가능: ${ALL_SP_CASES.map(c => c.id).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n${"═".repeat(64)}`);
  console.log(`🧪 플래너 샘플 비교 실행: ${tc.id} — ${tc.description}`);
  console.log("═".repeat(64));

  const ctx = testCaseToEffectiveContext(tc, tc.episode_number);

  // ─── 1. Planner→Renderer 파이프라인 ─────────────────────────
  console.log("\n[PIPELINE] Planner → Renderer 실행 중...");
  const t0 = Date.now();
  const pipelineResult = await runPlannerPipeline(ctx, {
    doRevise: false,
    skipRenderOnPlanFail: false,
  });
  const pipelineElapsed = Date.now() - t0;

  // ─── 2. Legacy 생성 ──────────────────────────────────────────
  console.log("\n[LEGACY] 기존 방식 생성 중...");
  const llm   = getLLMClient();
  const model = getStoryModel();
  const cfg   = tc.gen_config;
  const maxTok = Math.ceil((cfg.episodeLength + cfg.episodeLengthVar) * 0.65 * 1.4) + 300;

  const { variantCPovRule } = await import("../src/lib/pov_rules.js") as any;
  const charList = ctx.characters.map(c => `${c.name}(${c.gender}, ${c.type}): ${c.personality}`).join("\n");
  const legacySystem = `당신은 한국 소설 생성 AI다.\n\n[시점]\n${variantCPovRule(cfg.pov)}\n\n[등장인물]\n${charList}`;
  const legacyUser   = `${ctx.episode_number}화를 ${cfg.pov} 시점으로 생성해줘.`;

  let legacyText = "";
  const tL0 = Date.now();
  try {
    const res = await (llm.chat.completions.create as any)({
      model,
      messages: [{ role: "system", content: legacySystem }, { role: "user", content: legacyUser }],
      temperature: 0.85, max_tokens: maxTok,
    });
    legacyText = res.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    legacyText = `[생성 오류: ${err}]`;
  }
  const legacyElapsed = Date.now() - tL0;

  const legacyValidation = await validate(legacyText, ctx, { promptVersion: "A" });

  // ─── 출력 ────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(64));
  console.log("① SCENE PLAN (Planner JSON)");
  console.log("─".repeat(64));
  const plan = pipelineResult.scene_plan;
  console.log(JSON.stringify({
    opening_location: plan.opening_location,
    opening_time_context: plan.opening_time_context,
    forbidden_actions: plan.forbidden_actions,
    must_keep_items: plan.must_keep_items,
    carryover_effects: plan.carryover_effects,
    world_rule: plan.world_rule,
    scene_beats: plan.scene_beats,
    hook_type: plan.hook_type,
    hook_payload: plan.hook_payload,
    hook_concrete_event: plan.hook_concrete_event,
  }, null, 2));

  console.log("\n" + "─".repeat(64));
  console.log("② PLAN VALIDATION");
  console.log("─".repeat(64));
  const pv = pipelineResult.plan_validation;
  console.log(`  verdict: ${pv.verdict}`);
  console.log(`  passed (${pv.passed_checks.length}): ${pv.passed_checks.join(" | ")}`);
  if (pv.issues.length) {
    console.log(`  issues (${pv.issues.length}):`);
    for (const iss of pv.issues) {
      console.log(`    [${iss.severity}] ${iss.field}: ${iss.description}`);
    }
  }
  console.log(`  fallback_used: ${pipelineResult.plan_fallback_used}`);

  console.log("\n" + "─".repeat(64));
  console.log("③ RENDERER 출력 (첫 400자)");
  console.log("─".repeat(64));
  console.log(pipelineResult.generated_text.slice(0, 400));
  console.log(`  ...(총 ${pipelineResult.generated_text.length}자)`);

  console.log("\n" + "─".repeat(64));
  console.log("④ PROSE VALIDATION (Planner→Renderer)");
  console.log("─".repeat(64));
  const prv = pipelineResult.prose_validation;
  console.log(`  verdict: ${prv.verdict} | score: ${prv.total_score}`);
  if (prv.hard_violations.length) {
    console.log(`  hard violations: ${prv.hard_violations.map(v => v.rule).join(", ")}`);
  }
  if (prv.soft_warnings.length) {
    console.log(`  soft warnings: ${prv.soft_warnings.map(w => w.rule).join(", ")}`);
  }

  console.log("\n" + "─".repeat(64));
  console.log("⑤ LEGACY 출력 (첫 400자)");
  console.log("─".repeat(64));
  console.log(legacyText.slice(0, 400));
  console.log(`  ...(총 ${legacyText.length}자)`);

  console.log("\n" + "─".repeat(64));
  console.log("⑥ PROSE VALIDATION (Legacy)");
  console.log("─".repeat(64));
  console.log(`  verdict: ${legacyValidation.verdict} | score: ${legacyValidation.total_score}`);
  if (legacyValidation.hard_violations.length) {
    console.log(`  hard violations: ${legacyValidation.hard_violations.map(v => v.rule).join(", ")}`);
  }

  console.log("\n" + "═".repeat(64));
  console.log("⑦ 비교 요약");
  console.log("═".repeat(64));
  const plannerScore = pipelineResult.prose_validation.total_score;
  const legacyScore  = legacyValidation.total_score;
  const diff = plannerScore - legacyScore;
  console.log(`  케이스: ${tc.id} / ${tc.description}`);
  console.log(`  플래너→렌더러: verdict=${pipelineResult.prose_validation.verdict}, score=${plannerScore}`);
  console.log(`  레거시:         verdict=${legacyValidation.verdict}, score=${legacyScore}`);
  console.log(`  점수 차이: ${diff >= 0 ? "+" : ""}${diff}`);
  console.log(`  플래너 elapsed: ${pipelineElapsed}ms (plan=${pipelineResult.planner_elapsed_ms}ms, render=${pipelineResult.renderer_elapsed_ms}ms)`);
  console.log(`  레거시 elapsed: ${legacyElapsed}ms`);
  console.log(`  계획 검증: ${pv.verdict} (${pv.issues.length}개 이슈)`);
  console.log("═".repeat(64) + "\n");

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
