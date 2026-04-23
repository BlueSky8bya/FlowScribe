/**
 * schema_versions.ts — 학습 파이프라인 스키마 버전 상수
 *
 * bump 정책:
 * - SCHEMA_VERSION:         EffectiveContext, CharacterDynamicState, GenConfig 필드 변경 시
 * - PLANNER_SCHEMA_VERSION: ScenePlan, CreativePlan, PlannerTrace 필드 변경 시
 * - REWARD_SCHEMA_VERSION:  QualityScores, RewardBreakdown 가중치/필드 변경 시
 *
 * 현재 버전 근거:
 * - SCHEMA_VERSION "1.1":
 *     CharacterDynamicState + emotional_state, visibility_state
 *     GenConfig + resolved_final_episode
 *     EpisodeCharBudget, BookArcContract 타입 추가
 * - PLANNER_SCHEMA_VERSION "1.0": ScenePlan 현재 구조 기준
 * - REWARD_SCHEMA_VERSION "1.0": hook_complete 마커 버그 수정 후 기준 (2026-04-23)
 */

export const SCHEMA_VERSION         = "1.1";
export const PLANNER_SCHEMA_VERSION = "1.1";  // +narrative_contract, +rule/intervention/memory contract in input_contract
export const REWARD_SCHEMA_VERSION  = "1.1";  // +intervention_adherence, +absolute_forbidden_penalty 신호 추가

export interface SchemaVersions {
  schema_version:         string;
  planner_schema_version: string;
  reward_schema_version:  string;
}

export function currentSchemaVersions(): SchemaVersions {
  return {
    schema_version:         SCHEMA_VERSION,
    planner_schema_version: PLANNER_SCHEMA_VERSION,
    reward_schema_version:  REWARD_SCHEMA_VERSION,
  };
}
