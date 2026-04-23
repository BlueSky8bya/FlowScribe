/**
 * src/training/reward_aggregator.ts — 다중 신호 Reward 계산기
 *
 * Planner reward와 Renderer reward를 분리 계산한다.
 * RLMR 논문(arXiv 2508.18642) 방식: 주관적 품질 + 객관적 제약 혼합.
 *
 * 사용 목적:
 * - 학습 전: 기존 trace DB에서 reward 역산 (offline)
 * - 학습 중: GRPO/DPO trainer에 reward 함수로 전달
 */

import type { RunTrace, RewardBreakdown, ComputedReward } from "./types.js";
import type { PlanValidationResult } from "../types/planner.js";
import type { ValidationResult } from "../types/canonical.js";

// 가중치 설정 — 실험 후 조정 가능
const WEIGHTS = {
  // Planner reward 가중치
  plan_structure:    0.5,
  hook_concreteness: 0.3,
  fallback_penalty:  0.2,  // 적용 시 음수

  // Renderer reward 가중치
  prose_total:           0.3,
  pov_consistency:       0.15,
  character_consistency: 0.2,
  ending_hook:           0.15,
  world_rule_usage:      0.1,
  violation_penalty:     0.1,  // 적용 시 음수

  // Combined
  planner_weight:  0.4,
  renderer_weight: 0.6,
};

export function computePlannerReward(
  planValidation: PlanValidationResult,
  plannerFallbackUsed: boolean,
): Pick<RewardBreakdown, "plan_structure_score" | "plan_fallback_penalty" | "hook_concreteness" | "planner_reward"> {
  const totalChecks = planValidation.passed_checks.length + planValidation.issues.length;
  const plan_structure_score = totalChecks > 0
    ? planValidation.passed_checks.length / totalChecks
    : 0;

  const plan_fallback_penalty = plannerFallbackUsed ? -1 : 0;

  // hook_concrete_event 존재 여부 (plan validator의 passed_checks에서 추론)
  const hook_concreteness = planValidation.passed_checks.includes("hook_complete") ? 1 : 0;

  const planner_reward =
    plan_structure_score     * WEIGHTS.plan_structure +
    hook_concreteness        * WEIGHTS.hook_concreteness +
    plan_fallback_penalty    * WEIGHTS.fallback_penalty;

  return { plan_structure_score, plan_fallback_penalty, hook_concreteness, planner_reward };
}

export function computeRendererReward(
  proseValidation: ValidationResult,
  revisionCount: number,
): Pick<RewardBreakdown, "prose_total_score" | "pov_consistency" | "character_consistency" | "ending_hook" | "world_rule_usage" | "hard_violation_penalty" | "revision_penalty" | "renderer_reward"> {
  const qs = proseValidation.quality_scores;

  const prose_total_score    = proseValidation.total_score / 100;
  const pov_consistency      = (qs.pov_consistency ?? 0) / 100;
  const character_consistency = (qs.character_consistency ?? 0) / 100;
  const ending_hook          = (qs.ending_hook ?? 0) / 100;
  const world_rule_usage     = (qs.world_rule_usage ?? 0) / 100;

  const hard_violation_penalty = proseValidation.hard_violations.reduce((sum, v) => {
    if (v.severity === "critical") return sum - 0.25;
    if (v.severity === "major")    return sum - 0.10;
    return sum - 0.05;
  }, 0);

  const revision_penalty = revisionCount * -0.15;

  const renderer_reward =
    prose_total_score      * WEIGHTS.prose_total +
    pov_consistency        * WEIGHTS.pov_consistency +
    character_consistency  * WEIGHTS.character_consistency +
    ending_hook            * WEIGHTS.ending_hook +
    world_rule_usage       * WEIGHTS.world_rule_usage +
    hard_violation_penalty * WEIGHTS.violation_penalty +
    revision_penalty;

  return {
    prose_total_score, pov_consistency, character_consistency,
    ending_hook, world_rule_usage, hard_violation_penalty,
    revision_penalty, renderer_reward,
  };
}

export function computeReward(trace: RunTrace): ComputedReward {
  const plannerPart = trace.plan_validation && trace.planner_trace
    ? computePlannerReward(trace.plan_validation, trace.planner_trace.fallback_used)
    : { plan_structure_score: 0, plan_fallback_penalty: 0, hook_concreteness: 0, planner_reward: 0 };

  const rendererPart = trace.prose_validation
    ? computeRendererReward(trace.prose_validation, trace.revision_count)
    : {
        prose_total_score: 0, pov_consistency: 0, character_consistency: 0,
        ending_hook: 0, world_rule_usage: 0, hard_violation_penalty: 0,
        revision_penalty: 0, renderer_reward: 0,
      };

  const combined_reward =
    plannerPart.planner_reward  * WEIGHTS.planner_weight +
    rendererPart.renderer_reward * WEIGHTS.renderer_weight;

  const breakdown: RewardBreakdown = {
    ...plannerPart,
    ...rendererPart,
    combined_reward,
  };

  return {
    trace_id: trace.trace_id,
    breakdown,
    computed_at: new Date().toISOString(),
  };
}

/** 배치 reward 계산 */
export function computeRewardBatch(traces: RunTrace[]): ComputedReward[] {
  return traces.map(computeReward);
}

/** reward 통계 요약 */
export function summarizeRewards(rewards: ComputedReward[]): {
  count: number;
  mean_combined: number;
  mean_planner: number;
  mean_renderer: number;
  p50_combined: number;
  p90_combined: number;
} {
  if (rewards.length === 0) {
    return { count: 0, mean_combined: 0, mean_planner: 0, mean_renderer: 0, p50_combined: 0, p90_combined: 0 };
  }

  const combined = rewards.map(r => r.breakdown.combined_reward).sort((a, b) => a - b);
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const percentile = (arr: number[], p: number) => arr[Math.floor(arr.length * p)];

  return {
    count: rewards.length,
    mean_combined:  mean(combined),
    mean_planner:   mean(rewards.map(r => r.breakdown.planner_reward)),
    mean_renderer:  mean(rewards.map(r => r.breakdown.renderer_reward)),
    p50_combined:   percentile(combined, 0.5),
    p90_combined:   percentile(combined, 0.9),
  };
}
