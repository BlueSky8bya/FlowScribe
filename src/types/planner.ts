/**
 * planner.ts — Scene Planner 타입 정의
 *
 * ScenePlan: Planner가 생성하고 Renderer가 소비하는 구조화된 장면 계획.
 * 핵심 설계 원칙:
 *   - 결정론적 필드 (위치/부상/소지품/POV 등): StateExtractor가 EffectiveContext에서 직접 추출
 *   - 창의적 필드 (scene beats/hook/세계관 사건화): LLM CreativePlanner가 생성
 *   두 영역을 분리함으로써 상태 보존 책임을 LLM에서 분리한다.
 */

import type { ValidationResult, Verdict } from "./canonical.js";

// ══════════════════════════════════════════════════════════════
// 장면 계획 구성 요소
// ══════════════════════════════════════════════════════════════

/** 직전 화 여파 — 이번 화 첫 단락에서 드러나야 할 내용 */
export interface CarryoverEffect {
  character_name: string;
  description: string;             // 첫 단락에서 드러내야 할 여파 방식
  must_appear_in_opening: boolean; // true면 첫 단락 필수
}

/** 부상 인물의 행동 제약 — "금지 나열"이 아닌 "묘사 유도" 방식 */
export interface ForbiddenAction {
  character_name: string;
  body_part: string;               // 부상 부위 (예: "오른팔 부상")
  forbidden_description: string;   // 해서는 안 되는 행동 설명
  substitute_description: string;  // 대신 드러낼 묘사 방향
}

/** 소지품 지속성 제약 */
export interface ItemConstraint {
  character_name: string;
  item: string;
  must_persist: boolean;           // true면 이번 화에서 임의 소비/분실 금지
  usage_note?: string;             // 소비 허용 조건 (없으면 유지 필수)
}

/** 세계관 규칙 사건화 계획 */
export interface WorldRuleActivation {
  rule_content: string;            // 활용할 세계관 규칙 원문
  activation_type: "constraint" | "conflict_cause" | "resolution_means";
  scene_usage: string;             // 이번 화 어떤 장면에서 어떻게 인물에게 작동하는지
}

/** 장면 비트 단위 */
export interface SceneBeat {
  beat_number: number;
  summary: string;                 // 이 비트에서 무슨 일이 벌어지는지
  characters_involved: string[];
  location: string;
}

export type HookType =
  | "immediate_threat"
  | "unexpected_discovery"
  | "new_problem"
  | "unresolved_situation";

// ══════════════════════════════════════════════════════════════
// ScenePlan — Planner 최종 출력
// ══════════════════════════════════════════════════════════════

export interface ScenePlan {
  // ── 결정론적 필드 (StateExtractor → 직접 추출, LLM 불개입) ──
  opening_location: string;
  opening_time_context: string;
  forbidden_actions: ForbiddenAction[];
  must_keep_items: ItemConstraint[];
  pov_contract: string;
  tone_contract: string;
  target_length: number;
  ending_constraint: "cliff" | "final";

  // ── 창의적 필드 (LLM CreativePlanner → 생성, fallback 가능) ──
  carryover_effects: CarryoverEffect[];
  world_rule: WorldRuleActivation;
  scene_beats: SceneBeat[];
  hook_type: HookType;
  hook_payload: string;            // 훅 내용 요약
  hook_concrete_event: string;     // 마지막 2~4문장에서 실제로 벌어질 구체적 사건
}

// ══════════════════════════════════════════════════════════════
// LLM이 출력하는 창의적 계획 (merge 전 중간 타입)
// ══════════════════════════════════════════════════════════════

export interface CreativePlan {
  carryover_effects: CarryoverEffect[];
  world_rule: WorldRuleActivation;
  scene_beats: SceneBeat[];
  hook_type: HookType;
  hook_payload: string;
  hook_concrete_event: string;
}

// ══════════════════════════════════════════════════════════════
// Plan Validation 결과
// ══════════════════════════════════════════════════════════════

export type PlanVerdict = "PASS" | "WARN" | "FAIL";

export interface PlanIssue {
  field: string;
  severity: "critical" | "major" | "minor";
  description: string;
}

export interface PlanValidationResult {
  verdict: PlanVerdict;
  issues: PlanIssue[];
  passed_checks: string[];
  plan: ScenePlan;
}

// ══════════════════════════════════════════════════════════════
// 파이프라인 최종 결과
// ══════════════════════════════════════════════════════════════

export interface PlannerPipelineResult {
  scene_plan: ScenePlan;
  plan_validation: PlanValidationResult;
  generated_text: string;
  prose_validation: ValidationResult;
  final_verdict: Verdict;
  final_score: number;
  revision_count: number;
  elapsed_ms: number;
  planner_elapsed_ms: number;
  renderer_elapsed_ms: number;
  plan_fallback_used: boolean;   // LLM 플래너 실패 시 결정론적 fallback 사용 여부
}
