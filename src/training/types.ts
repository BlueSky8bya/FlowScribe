/**
 * src/training/types.ts — 학습 파이프라인 공통 타입
 *
 * Trace: 운영 중 캡처되는 전체 실행 궤적
 * Dataset: SFT / DPO / Preference 학습 데이터 단위
 * Reward: 다중 신호 통합 보상 구조
 */

import type { ValidationResult, Verdict } from "../types/canonical.js";
import type { ScenePlan, PlanValidationResult } from "../types/planner.js";

// ──────────────────────────────────────────────────────────────
// Run Trace — 파이프라인 한 번 실행의 전체 궤적
// ──────────────────────────────────────────────────────────────

export interface PlannerTrace {
  raw_llm_output: string;         // planner LLM 원문
  parsed_plan: ScenePlan | null;  // 파싱 성공 시
  fallback_used: boolean;
  fallback_reason?: string;
  elapsed_ms: number;
}

export interface RendererTrace {
  system_prompt: string;          // buildRendererSystemPrompt() 결과
  user_prompt: string;
  generated_text: string;
  elapsed_ms: number;
}

export interface RevisionIterationTrace {
  iteration: number;
  system_prompt: string;
  user_prompt: string;
  revised_text: string;
  validation_before: ValidationResult;
  validation_after: ValidationResult;
  improved_rules: string[];
}

export interface RunTrace {
  trace_id: string;               // UUID
  trace_type: "planner" | "legacy";
  book_id: string | null;
  episode_number: number;
  created_at: string;             // ISO timestamp

  // 입력
  effective_context_snapshot: Record<string, unknown>;

  // 각 단계 trace
  planner_trace: PlannerTrace | null;
  plan_validation: PlanValidationResult | null;
  renderer_trace: RendererTrace | null;
  prose_validation: ValidationResult | null;
  revision_traces: RevisionIterationTrace[];

  // 집계
  final_verdict: Verdict;
  final_score: number;
  revision_count: number;
  total_elapsed_ms: number;

  // 학습용 레이블
  is_planner_sft_eligible: boolean;   // plan_validation.verdict == PASS
  is_renderer_sft_eligible: boolean;  // final_verdict == PASS && revision_count == 0
  is_preference_eligible: boolean;    // 동일 ctx에서 두 번 이상 생성된 경우
}

// ──────────────────────────────────────────────────────────────
// Reward Signal
// ──────────────────────────────────────────────────────────────

export interface RewardBreakdown {
  // Plan 품질 (Planner RL용)
  plan_structure_score: number;   // 0~1 (PlanValidator 8규칙 통과율)
  plan_fallback_penalty: number;  // -1 if fallback_used, 0 otherwise
  hook_concreteness: number;      // 0~1 (hook_concrete_event 존재 여부)

  // Prose 품질 (Renderer RL/DPO용)
  prose_total_score: number;      // 0~100 → 정규화 0~1
  pov_consistency: number;        // 0~1
  character_consistency: number;  // 0~1
  ending_hook: number;            // 0~1
  world_rule_usage: number;       // 0~1

  // 제약 위반 페널티
  hard_violation_penalty: number; // -0.25 per critical, -0.1 per major
  revision_penalty: number;       // -0.15 per iteration

  // 종합
  planner_reward: number;         // plan_* 합산
  renderer_reward: number;        // prose_* + penalty 합산
  combined_reward: number;        // weighted sum
}

export interface ComputedReward {
  trace_id: string;
  breakdown: RewardBreakdown;
  computed_at: string;
}

// ──────────────────────────────────────────────────────────────
// Training Dataset Formats
// ──────────────────────────────────────────────────────────────

/** Planner SFT — EffectiveContext → CreativePlan JSON */
export interface PlannerSFTExample {
  id: string;
  instruction: string;   // EffectiveContext 요약 프롬프트
  output: string;        // 정답 CreativePlan JSON
  metadata: {
    trace_id: string;
    plan_verdict: string;
    final_score: number;
    created_at: string;
  };
}

/** Renderer DPO — (chosen, rejected) 쌍 */
export interface RendererDPOExample {
  id: string;
  prompt: string;        // ScenePlan + EffectiveContext 렌더러 프롬프트
  chosen: string;        // 더 나은 소설 텍스트 (higher score)
  rejected: string;      // 덜 나은 소설 텍스트 (lower score)
  metadata: {
    chosen_trace_id: string;
    rejected_trace_id: string;
    score_delta: number;
  };
}

/** Preference Pair — 동일 입력에 대한 두 출력 비교 */
export interface PreferencePair {
  id: string;
  context_hash: string;  // EffectiveContext의 해시 (동일 입력 그룹핑)
  chosen_trace_id: string;
  rejected_trace_id: string;
  chosen_reward: number;
  rejected_reward: number;
  reward_delta: number;
}

// ──────────────────────────────────────────────────────────────
// Dataset Build Config
// ──────────────────────────────────────────────────────────────

export interface DatasetBuildConfig {
  output_dir: string;
  min_plan_verdict: "PASS" | "WARN";      // planner SFT 최소 기준
  min_final_score: number;                // renderer SFT 최소 점수 (기본 70)
  max_revision_count: number;             // renderer SFT 최대 revision (기본 0)
  min_reward_delta_for_preference: number; // preference pair 최소 delta (기본 10)
  include_fallback: boolean;              // fallback plan 포함 여부 (기본 false)
  date_from?: string;
  date_to?: string;
}

export const DEFAULT_DATASET_CONFIG: DatasetBuildConfig = {
  output_dir: "data/datasets",
  min_plan_verdict: "PASS",
  min_final_score: 70,
  max_revision_count: 0,
  min_reward_delta_for_preference: 10,
  include_fallback: false,
};
