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

import type {
  RunTrace, RewardBreakdown, ComputedReward,
  EpisodeRewardExtended, ComputedRewardV2,
} from "./types.js";
import type { PlanValidationResult } from "../types/planner.js";
import type { ValidationResult, QualityScores } from "../types/canonical.js";

// 가중치 설정 — 실험 후 조정 가능
const WEIGHTS = {
  // Planner reward 가중치
  plan_structure:    0.5,
  hook_concreteness: 0.3,
  fallback_penalty:  0.2,  // 적용 시 음수

  // Renderer reward 가중치
  prose_total:              0.25,  // 0.3 → 0.25 (intervention_adherence 추가로 조정)
  pov_consistency:          0.15,
  character_consistency:    0.20,
  ending_hook:              0.15,
  world_rule_usage:         0.05,  // 0.1 → 0.05 (intervention_adherence로 일부 이전)
  intervention_adherence:   0.10,  // new — active_interventions 준수 신호
  violation_penalty:        0.10,  // 적용 시 음수

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
): Pick<RewardBreakdown,
  "prose_total_score" | "pov_consistency" | "character_consistency" |
  "ending_hook" | "world_rule_usage" | "intervention_adherence" |
  "hard_violation_penalty" | "absolute_forbidden_penalty" | "revision_penalty" | "renderer_reward"
> {
  const qs = proseValidation.quality_scores;

  const prose_total_score     = proseValidation.total_score / 100;
  const pov_consistency       = (qs.pov_consistency ?? 0) / 100;
  const character_consistency = (qs.character_consistency ?? 0) / 100;
  const ending_hook           = (qs.ending_hook ?? 0) / 100;
  const world_rule_usage      = (qs.world_rule_usage ?? 0) / 100;
  const intervention_adherence = (qs.intervention_adherence ?? 0) / 100;

  const hard_violation_penalty = proseValidation.hard_violations.reduce((sum, v) => {
    if (v.severity === "critical") return sum - 0.25;
    if (v.severity === "major")    return sum - 0.10;
    return sum - 0.05;
  }, 0);

  // absolute_forbidden_penalty: critical violations만 별도 추출 (절대금지 위반 전용 신호)
  const absolute_forbidden_penalty = proseValidation.hard_violations
    .filter(v => v.severity === "critical")
    .reduce((sum) => sum - 0.25, 0);

  const revision_penalty = revisionCount * -0.15;

  const renderer_reward =
    prose_total_score        * WEIGHTS.prose_total +
    pov_consistency          * WEIGHTS.pov_consistency +
    character_consistency    * WEIGHTS.character_consistency +
    ending_hook              * WEIGHTS.ending_hook +
    world_rule_usage         * WEIGHTS.world_rule_usage +
    intervention_adherence   * WEIGHTS.intervention_adherence +
    hard_violation_penalty   * WEIGHTS.violation_penalty +
    revision_penalty;

  return {
    prose_total_score, pov_consistency, character_consistency,
    ending_hook, world_rule_usage, intervention_adherence,
    hard_violation_penalty, absolute_forbidden_penalty, revision_penalty, renderer_reward,
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
        ending_hook: 0, world_rule_usage: 0, intervention_adherence: 0,
        hard_violation_penalty: 0, absolute_forbidden_penalty: 0,
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

// ──────────────────────────────────────────────────────────────
// Hard Gate — collecting 전 필수 reject 조건
// ──────────────────────────────────────────────────────────────

// scripts/utils/dpo_utils.ts의 FOREIGN_CHAR_PATTERN과 범위 일치: CJK + 전각 문자만
const FOREIGN_PATTERN = /[一-鿿぀-ゟ゠-ヿ　-〿]/;
const UNCLOSED_QUOTE  = /(?<!["“”])"[^"]*$/m;

export interface HardGateResult {
  failed: boolean;
  reasons: string[];
}

/**
 * computeHardGate — 샘플을 DPO chosen/SFT 후보에서 즉시 제외할 조건 검사.
 * reward 계산이 아니라 reject gate다.
 */
export function computeHardGate(
  trace: RunTrace,
  generatedText: string,
  opts: {
    ppStats?: { foreignCharsRemoved?: number; quoteMerges?: number; bracketMerges?: number };
    episodeRole?: string;
  } = {},
): HardGateResult {
  const reasons: string[] = [];

  // ① 텍스트 없음 / JSON 파싱 실패
  if (!generatedText?.trim()) reasons.push("empty_output");

  // ② 외국어 문자 잔류
  if (generatedText && FOREIGN_PATTERN.test(generatedText)) reasons.push("foreign_char");

  // ③ 미닫힘 따옴표 (postprocess 이후에도 남은 경우)
  if (generatedText && UNCLOSED_QUOTE.test(generatedText)) reasons.push("unclosed_quote");

  // ④ 심각한 POV 위반 (critical severity)
  const criticalPOV = trace.prose_validation?.hard_violations?.filter(
    v => v.severity === "critical" && v.rule.includes("시점"),
  );
  if (criticalPOV?.length) reasons.push("severe_pov_violation");

  // ⑤ absolute_forbidden critical violation
  const absoluteViolations = trace.prose_validation?.hard_violations?.filter(
    v => v.severity === "critical",
  );
  if (absoluteViolations?.length) reasons.push("absolute_forbidden_violation");

  // ⑥ truncation (no proper ending)
  if (generatedText) {
    const trimmed = generatedText.trim();
    const hasEnd = /\[END\]$/.test(trimmed) || /\[CLIFF\](\s*\[END\])?$/.test(trimmed);
    const lastChar = trimmed.slice(-1);
    const properEnd = [".", "!", "?", "。", "！", "？", "…", "」", "』", '"'].includes(lastChar);
    if (!hasEnd && !properEnd && trimmed.length < 100) reasons.push("truncation");
  }

  // ⑦ 과도한 postprocess 개입 (외국어 10자 이상 제거 = LLM이 한국어를 못 지킨 것)
  if ((opts.ppStats?.foreignCharsRemoved ?? 0) >= 10) reasons.push("postprocess_overload");

  // ⑧ final episode인데 결말 신호 없음
  if (opts.episodeRole === "final" && trace.prose_validation) {
    const endingHook = trace.prose_validation.quality_scores.ending_hook ?? 100;
    if (endingHook < 20) reasons.push("final_ep_no_ending");
  }

  return { failed: reasons.length > 0, reasons };
}

// ──────────────────────────────────────────────────────────────
// Extended Episode Reward (v2)
// ──────────────────────────────────────────────────────────────

/**
 * computeEpisodeExtended — 기존 breakdown 위에 추가 episode 점수 계산.
 * quality_scores에서 직접 추출하거나 proxy로 추정.
 */
export function computeEpisodeExtended(
  trace: RunTrace,
  generatedText: string,
  opts: {
    ppStats?: { foreignCharsRemoved?: number; quoteMerges?: number; bracketMerges?: number; dialogueLinesTagged?: number };
    episodeRole?: string;
  } = {},
): EpisodeRewardExtended {
  const qs: QualityScores = trace.prose_validation?.quality_scores ?? {
    pov_consistency: 70, scene_clarity: 70, character_consistency: 70, plot_momentum: 70,
    world_rule_usage: 70, exposition_control: 70, prose_density: 70, ending_hook: 60,
    style_adherence: 70, intervention_adherence: 70,
  };
  const gate = computeHardGate(trace, generatedText, opts);

  // 확장 점수 (prose judge에서 직접 추출하거나 proxy)
  // state_completeness: 인물 상태 업데이트 여부 — character_consistency를 proxy로 사용
  const state_completeness = (qs.character_consistency ?? 70) / 100;

  // goal_progress: plot_momentum을 proxy로 사용 (본격 신호는 trajectory에서)
  const goal_progress = (qs.plot_momentum ?? 70) / 100;

  // scene_purpose_clarity: scene_clarity가 직접 해당
  const scene_purpose_clarity = (qs.scene_clarity ?? 70) / 100;

  // dialogue_distinctiveness: character_consistency + style_adherence 조합
  const dialogue_distinctiveness = (
    (qs.character_consistency ?? 70) * 0.6 +
    (qs.style_adherence ?? 70) * 0.4
  ) / 100;

  // emotional_causality: exposition_control (감정 서술의 절제 = 원인 가시성과 상관)
  const emotional_causality = (
    (qs.exposition_control ?? 70) * 0.5 +
    (qs.plot_momentum ?? 70) * 0.5
  ) / 100;

  // consequence_visibility: plot_momentum + character_consistency
  const consequence_visibility = (
    (qs.plot_momentum ?? 70) * 0.6 +
    (qs.character_consistency ?? 70) * 0.4
  ) / 100;

  // narrative_density: prose_density가 직접 해당
  const narrative_density = (qs.prose_density ?? 70) / 100;

  // ending_progress: 이 화의 ending_hook = 다음 화 진입 욕구
  const ending_progress = (qs.ending_hook ?? 60) / 100;

  // postprocess_dependency_penalty
  const ppForeign = opts.ppStats?.foreignCharsRemoved ?? 0;
  const ppQuote   = opts.ppStats?.quoteMerges ?? 0;
  const postprocess_dependency_penalty = -Math.min(0.4,
    (ppForeign >= 5 ? 0.2 : ppForeign >= 1 ? 0.05 : 0) +
    (ppQuote   >= 3 ? 0.1 : ppQuote   >= 1 ? 0.03 : 0),
  );

  // judge_uncertainty: 점수 분산 기반 (점수들이 들쭉날쭉하면 불확실)
  const scoreValues = (Object.values(qs) as unknown[]).map(Number).filter(v => !isNaN(v));
  const mean = scoreValues.length ? scoreValues.reduce((s, v) => s + v, 0) / scoreValues.length : 70;
  const variance = scoreValues.length > 1
    ? scoreValues.reduce((s, v) => s + (v - mean) ** 2, 0) / scoreValues.length : 0;
  const judge_uncertainty = Math.min(1, Math.sqrt(variance) / 30);

  // 집계
  const episode_extended_score = Math.max(0, Math.min(1,
    state_completeness        * 0.10 +
    goal_progress             * 0.12 +
    scene_purpose_clarity     * 0.12 +
    dialogue_distinctiveness  * 0.10 +
    emotional_causality       * 0.10 +
    consequence_visibility    * 0.10 +
    narrative_density         * 0.10 +
    ending_progress           * 0.12 +
    postprocess_dependency_penalty +
    (1 - judge_uncertainty)   * 0.14,
  ));

  return {
    hard_gate_failed: gate.failed,
    hard_gate_reasons: gate.reasons,
    state_completeness:        Math.round(state_completeness * 1000) / 1000,
    goal_progress:             Math.round(goal_progress * 1000) / 1000,
    scene_purpose_clarity:     Math.round(scene_purpose_clarity * 1000) / 1000,
    dialogue_distinctiveness:  Math.round(dialogue_distinctiveness * 1000) / 1000,
    emotional_causality:       Math.round(emotional_causality * 1000) / 1000,
    consequence_visibility:    Math.round(consequence_visibility * 1000) / 1000,
    narrative_density:         Math.round(narrative_density * 1000) / 1000,
    ending_progress:           Math.round(ending_progress * 1000) / 1000,
    postprocess_dependency_penalty: Math.round(postprocess_dependency_penalty * 1000) / 1000,
    judge_uncertainty:         Math.round(judge_uncertainty * 1000) / 1000,
    episode_extended_score:    Math.round(episode_extended_score * 1000) / 1000,
  };
}

/**
 * computeRewardV2 — 기존 computeReward + episode_extended 확장.
 * 기존 breakdown은 그대로 유지 (backward compat).
 */
export function computeRewardV2(
  trace: RunTrace,
  generatedText: string,
  opts: {
    ppStats?: { foreignCharsRemoved?: number; quoteMerges?: number; bracketMerges?: number; dialogueLinesTagged?: number };
    episodeRole?: string;
  } = {},
): ComputedRewardV2 {
  const base = computeReward(trace);
  const episode_extended = computeEpisodeExtended(trace, generatedText, opts);

  return {
    ...base,
    episode_extended,
    reward_schema_version: "2.0",
  };
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
