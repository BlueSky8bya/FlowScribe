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
  model_used?: string;            // A/B 실험용 — 실제 사용 모델명
  /** planner가 실제로 참조한 계약 — 학습 데이터 필터링/분석용 */
  input_contract?: {
    // Narrative contract
    target_length: number;
    char_budget: { target: number; min: number; max: number };
    ending_constraint: "cliff" | "final";
    resolved_final: number;
    remaining_episodes: number;
    episode_role: "intro" | "early" | "mid" | "late" | "pre-final" | "final";
    // Character contract
    absent_characters: string[];
    // Rule / Intervention contract
    active_interventions: string[];   // is_active인 instruction 텍스트
    absolute_forbidden: string[];
    episode_forbidden: string[];
    episode_required: string[];
    // Memory / Arc contract (존재 여부만 기록 — 원문은 effective_context_snapshot에)
    has_rolling_summary: boolean;
    arc_summaries_count: number;
    character_arcs_count: number;
    has_prev_tail: boolean;
    has_continuity_contract?: boolean;
    continuity_known_facts?: number;
    foreshadow_count: number;
    // Arc-phase — planner 7-phase (state_extractor 기준)
    // NOTE: training/types.ts ArcPhase(4종)와 다름 — 혼용 금지. planner_arc_phase로 명시
    planner_arc_phase?: string;  // "intro"|"early"|"mid"|"late"|"pre_final"|"final"|"unknown"
    planner_arc_ratio?: number;  // episode_number / resolved_final (0~1)
  };
}

export interface RendererTrace {
  system_prompt: string;          // buildRendererSystemPrompt() 결과
  user_prompt: string;
  generated_text: string;
  elapsed_ms: number;
  model_used?: string;            // A/B 실험용 — 실제 사용 모델명
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

  // 스키마 버전 — null이면 v1.1 이전 (schema_versions.ts 참조)
  schema_version?:         string;
  planner_schema_version?: string;
  reward_schema_version?:  string;
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
  hard_violation_penalty: number;       // -0.25 per critical, -0.1 per major
  absolute_forbidden_penalty: number;   // -0.25 per critical (절대금지 위반 전용 신호)
  intervention_adherence: number;       // 0~1 (prose validator intervention_adherence 점수)
  revision_penalty: number;             // -0.15 per iteration

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
// Extended Episode-Level Reward (v2 — backward compat: breakdown preserved)
// ──────────────────────────────────────────────────────────────

/** episode 단위 확장 점수 (0~1 정규화) */
export interface EpisodeRewardExtended {
  // ── Hard Gate flags ──────────────────────────────────────────
  /** true이면 이 샘플은 DPO chosen/SFT 후보에서 즉시 제외 */
  hard_gate_failed: boolean;
  hard_gate_reasons: string[];  // "truncation" | "foreign_char" | "absolute_forbidden" | "json_parse_fail" | "severe_pov" | "invalid_items" | "postprocess_overload"

  // ── Prose Judge 확장 점수 (0~1) ─────────────────────────────
  state_completeness: number;        // character states fully updated this episode
  goal_progress: number;             // recent_goal clearly advanced
  scene_purpose_clarity: number;     // scene has identifiable dramatic purpose
  dialogue_distinctiveness: number;  // characters sound distinct from each other
  emotional_causality: number;       // emotional shifts have visible cause
  consequence_visibility: number;    // events leave traceable consequences
  narrative_density: number;         // no wasted passages
  ending_progress: number;           // episode moves toward overall resolution

  // ── Postprocess quality ──────────────────────────────────────
  postprocess_dependency_penalty: number;  // ≤ 0: heavy postproc correction = worse sample

  // ── Judge uncertainty ────────────────────────────────────────
  judge_uncertainty: number;         // 0=confident, 1=uncertain (from score variance)

  // ── Aggregate ────────────────────────────────────────────────
  episode_extended_score: number;    // weighted aggregate of all extended scores
}

// ──────────────────────────────────────────────────────────────
// Trajectory Reward — N-episode sliding window
// ──────────────────────────────────────────────────────────────

/**
 * TrajectoryArcPhase — trajectory_reward.ts 전용 4-phase (sliding window 태깅용)
 * ⚠️  pipeline/state_extractor.ts 의 ArcPhase(7종: intro/early/mid/late/pre_final/final/unknown)와
 *     이름이 같지만 다른 vocabulary다. 혼용 금지.
 *     planner arc_phase는 input_contract.planner_arc_phase(string) 로 저장됨.
 */
export type ArcPhase = "intro" | "rising" | "climax" | "resolution";

export interface TrajectoryWindowScores {
  // 변화가 좋아야 하는 항목 (diversity/progression 보상)
  emotional_arc_consistency: number;   // 0~1: emotions change appropriately
  goal_evolution: number;              // 0~1: recent_goal advances, not stale
  escalation_curve: number;            // 0~1: plot_momentum trend is rising
  ending_convergence: number;          // 0~1: remaining_episodes decreasing with good pace

  // 안정이 좋아야 하는 항목 (continuity 보상)
  item_retention_consistency: number;  // 0~1: items don't vanish/appear mysteriously
  location_transition_coherence: number; // 0~1: location changes feel logical
  character_identity_stability: number;  // 0~1: character distinctiveness maintained

  // 해소 패턴 항목 (foreshadow/payoff balance)
  foreshadow_pressure: number;         // 0~1: foreshadow builds mid, resolves late
  curiosity_retention: number;         // 0~1: ending_hook scores stay engaging
  continuity_recall: number;           // 0~1: arc_summaries + rolling_summary signal

  // 비반복 항목
  state_non_repetition: number;        // 0~1: physical/emotional states don't loop
}

export interface TrajectoryWindow {
  window_size: number;
  start_episode: number;
  end_episode: number;
  includes_final_episode: boolean;
  arc_phase: ArcPhase;
  scores: TrajectoryWindowScores;
  window_score: number;             // weighted aggregate
}

export interface TrajectoryReward {
  book_id: string;
  resolved_final_episode: number;
  windows: TrajectoryWindow[];
  summary: {
    mean_window_score: number;
    best_window_score: number;
    worst_window_score: number;
    final_window_score: number | null;   // score of window containing final episode
    arc_coherence_score: number;         // std_dev-based consistency measure
    pre_final_convergence_score: number; // avg score of last 3 windows before final
  };
  computed_at: string;
}

// ──────────────────────────────────────────────────────────────
// Ending / Closure Reward
// ──────────────────────────────────────────────────────────────

export interface EndingLevelReward {
  final_episode_number: number;
  resolved_final_episode: number;

  // ── Positive scores (0~1) ────────────────────────────────────
  ending_readiness: number;              // was the story ready to end?
  central_conflict_resolution: number;  // core conflict resolved
  foreshadow_payoff_coverage: number;   // promises made → promises kept
  character_arc_resolution: number;     // character arcs closed
  emotional_resolution: number;         // emotional throughline lands
  ending_proportionality: number;       // not too rushed, not too dragged
  ending_surprise_earned: number;       // surprising but retroactively inevitable
  sequel_open_hook_balance: number;     // open ending done right (0 if fully closed is correct)

  // ── Penalties (≤ 0) ─────────────────────────────────────────
  unresolved_critical_thread_penalty: number;  // unclosed major promises
  deus_ex_machina_penalty: number;             // resolution came from nowhere
  premature_closure_penalty: number;           // ended too early (before resolved_final)
  overextended_delay_penalty: number;          // still going after resolved_final
  overexplained_ending_penalty: number;        // over-narrated, kills emotional impact

  // ── Pre-final convergence (scored from windows) ──────────────
  pre_final_convergence_score: number;   // avg trajectory window score for last 3 ep window

  // ── Aggregate ────────────────────────────────────────────────
  final_closure_score: number;           // weighted sum including penalties

  // ── LLM judge metadata ──────────────────────────────────────
  judge_summary: string;
  computed_at: string;
  judge_model?: string;
}

// ──────────────────────────────────────────────────────────────
// ComputedRewardV2 — episode + trajectory + ending
// ──────────────────────────────────────────────────────────────

/** run_traces.computed_reward에 저장되는 풀 reward 구조 (v2) */
export interface ComputedRewardV2 {
  trace_id: string;
  // 기존 breakdown 유지 (backward compat)
  breakdown: RewardBreakdown;
  // 확장 episode 점수
  episode_extended?: EpisodeRewardExtended;
  // 이 episode가 포함된 trajectory windows (book 전체 계산 후 역참조)
  trajectory_windows?: TrajectoryWindow[];
  // 최종화인 경우에만 populated
  ending_level?: EndingLevelReward;
  computed_at: string;
  reward_schema_version: string;  // "2.0"
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
