/**
 * src/policies/index.ts — 정책 레이어 공개 API
 *
 * 이 디렉터리는 FlowScribe의 도메인 정책을 담는다.
 * 순수 인프라(lib/)와 도메인 정책(policies/)을 구분하기 위해 분리.
 *
 * 포함:
 * - POV 지원 정책 및 Variant C 규칙 (pov_rules.ts)
 * - 인물 등장 정책 리졸버 (character_policy_resolver.ts)
 *
 * 정책 타입 정의는 src/types/pov_policy.ts, src/types/character_policy.ts 참조.
 */

export * from "./pov_rules.js";
export * from "./character_policy_resolver.js";
