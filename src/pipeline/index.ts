/**
 * src/pipeline/index.ts — Planner → Plan Validator → Renderer → Prose Validator 파이프라인
 *
 * 기존 story.ts / test_runner.ts legacy 경로는 그대로 유지된다.
 * 이 파이프라인은 병행 경로로 추가된다 (wrapper 방식).
 *
 * 파이프라인 흐름:
 *   1. StateExtractor (결정론적) — 위치/부상/소지품/POV 추출
 *   2. CreativePlanner (LLM, temp=0.4) — 비트/훅/세계관 계획 생성
 *   3. Plan Merge — 결정론적 + 창의적 필드 합성
 *   4. Plan Validator (결정론적) — 논리/구조 검사
 *   5. Renderer (LLM, temp=0.85) — 계획 기반 소설 생성
 *   6. Prose Validator (기존 validator.ts) — 텍스트 품질 검증
 *   7. Revision (기존 revision.ts, optional) — light cleanup
 */

import { logInfo, logWarn } from "../lib/logger.js";
import { validate } from "../services/validator.js";
import { reviseUntilPass } from "../services/revision.js";
import type { EffectiveContext, ValidationResult, Verdict } from "../types/canonical.js";
import type { ScenePlan, PlannerPipelineResult } from "../types/planner.js";
import { extractStateConstraints } from "./state_extractor.js";
import { runCreativePlanner } from "./planner.js";
import { validatePlan } from "./plan_validator.js";
import { renderFromPlan } from "./renderer.js";

export interface PlannerPipelineOptions {
  doRevise?: boolean;
  promptVersion?: "A" | "B";
  /** plan FAIL 시 렌더링 스킵 여부 (기본 false: plan FAIL여도 렌더링 시도) */
  skipRenderOnPlanFail?: boolean;
}

const EMPTY_QUALITY_SCORES = {
  pov_consistency: 0, scene_clarity: 0, character_consistency: 0,
  plot_momentum: 0, world_rule_usage: 0, exposition_control: 0,
  prose_density: 0, ending_hook: 0, style_adherence: 0, intervention_adherence: 0,
};

export async function runPlannerPipeline(
  ctx: EffectiveContext,
  opts: PlannerPipelineOptions = {},
): Promise<PlannerPipelineResult> {
  const t0 = Date.now();
  const {
    doRevise            = true,
    promptVersion       = "A",
    skipRenderOnPlanFail = false,
  } = opts;

  logInfo("pipeline", "파이프라인 시작", { episode: ctx.episode_number, pov: ctx.gen_config.pov });

  // ─── Step 1: State Extraction (결정론적, LLM 없음) ───────────
  const stateConstraints = extractStateConstraints(ctx);

  // ─── Step 2: Creative Planning (LLM) ─────────────────────────
  const t_plan0 = Date.now();
  const { plan: creativePlan, fallback_used } = await runCreativePlanner(ctx, stateConstraints);
  const planner_elapsed_ms = Date.now() - t_plan0;

  // ─── Step 3: Merge → ScenePlan ───────────────────────────────
  const scenePlan: ScenePlan = {
    // 결정론적 필드 (StateExtractor 확정)
    opening_location:     stateConstraints.opening_location,
    opening_time_context: stateConstraints.opening_time_context,
    forbidden_actions:    stateConstraints.forbidden_actions,
    must_keep_items:      stateConstraints.must_keep_items,
    pov_contract:         stateConstraints.pov_contract,
    tone_contract:        stateConstraints.tone_contract,
    target_length:        stateConstraints.target_length,
    ending_constraint:    stateConstraints.ending_constraint,
    // 창의적 필드 (LLM 또는 fallback)
    carryover_effects:    creativePlan.carryover_effects,
    world_rule:           creativePlan.world_rule,
    scene_beats:          creativePlan.scene_beats,
    hook_type:            creativePlan.hook_type,
    hook_payload:         creativePlan.hook_payload,
    hook_concrete_event:  creativePlan.hook_concrete_event,
  };

  // ─── Step 4: Plan Validation (결정론적) ──────────────────────
  const planValidation = validatePlan(scenePlan, ctx);
  logInfo("pipeline", "계획 검증 완료", {
    verdict:  planValidation.verdict,
    issues:   planValidation.issues.length,
    passed:   planValidation.passed_checks.length,
  });

  // plan FAIL + skipRenderOnPlanFail → 렌더링 스킵
  if (skipRenderOnPlanFail && planValidation.verdict === "FAIL") {
    logWarn("pipeline", "계획 FAIL — 렌더링 스킵");
    const stubVal: ValidationResult = {
      verdict: "FAIL",
      hard_violations: [{
        rule: "계획 검증 실패",
        description: planValidation.issues.map(i => i.description).join("; "),
        severity: "critical",
      }],
      soft_warnings: [],
      quality_scores: EMPTY_QUALITY_SCORES,
      total_score: 0,
      summary: "계획 검증 실패로 렌더링 스킵",
    };
    return {
      scene_plan: scenePlan, plan_validation: planValidation,
      generated_text: "", prose_validation: stubVal,
      final_verdict: "FAIL", final_score: 0, revision_count: 0,
      elapsed_ms: Date.now() - t0, planner_elapsed_ms, renderer_elapsed_ms: 0,
      plan_fallback_used: fallback_used,
    };
  }

  // ─── Step 5: Rendering (LLM) ─────────────────────────────────
  const t_render0 = Date.now();
  let generatedText = "";
  try {
    generatedText = await renderFromPlan(scenePlan, ctx);
  } catch (err) {
    logWarn("pipeline", "렌더링 오류", { error: String(err) });
  }
  const renderer_elapsed_ms = Date.now() - t_render0;

  // ─── Step 6: Prose Validation (기존 validator.ts) ────────────
  const proseValidation = await validate(generatedText, ctx, { promptVersion });

  // ─── Step 7: Revision (기존 revision.ts, optional) ───────────
  let finalVerdict: Verdict = proseValidation.verdict;
  let finalScore             = proseValidation.total_score;
  let revisionCount          = 0;

  if (doRevise && (finalVerdict === "FAIL" || finalVerdict === "WARN")) {
    const revised = await reviseUntilPass(generatedText, proseValidation, ctx, { promptVersion });
    finalVerdict  = revised.final_verdict;
    finalScore    = revised.final_score;
    revisionCount = revised.iterations;
  }

  logInfo("pipeline", "파이프라인 완료", {
    plan_verdict:  planValidation.verdict,
    prose_verdict: finalVerdict,
    score:         finalScore,
    elapsed_ms:    Date.now() - t0,
  });

  return {
    scene_plan:        scenePlan,
    plan_validation:   planValidation,
    generated_text:    generatedText,
    prose_validation:  proseValidation,
    final_verdict:     finalVerdict,
    final_score:       finalScore,
    revision_count:    revisionCount,
    elapsed_ms:        Date.now() - t0,
    planner_elapsed_ms,
    renderer_elapsed_ms,
    plan_fallback_used: fallback_used,
  };
}

// Re-export for convenience
export { extractStateConstraints } from "./state_extractor.js";
export { runCreativePlanner }      from "./planner.js";
export { validatePlan }            from "./plan_validator.js";
export { renderFromPlan }          from "./renderer.js";
