/**
 * character_policy.ts — 인물 등장 정책 및 이름 관련 사건 분류 타입
 *
 * ── 분리 원칙 ─────────────────────────────────────────────────────────────
 * "이름 혼동(canonical_name_confusion)"과 "신규 인물 도입(new_character_introduction)"은
 * 의미가 완전히 다르므로 타입 수준에서 분리한다.
 *
 * 현 단계: UI 미노출 — 내부 default policy로만 동작.
 * 향후 단계: GenConfig 또는 WorldConfig에 optional 필드로 노출 가능.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ══════════════════════════════════════════════════════════════
// 1. 신규 인물 도입 정책
// ══════════════════════════════════════════════════════════════

/**
 * new_character_policy — 사전 설정되지 않은 인물이 등장할 때 허용 수준
 *
 * closed_cast      : 설정된 인물 외 등장 전면 금지
 * extras_only      : 이름 없는 배경 인물만 허용 (이름 있는 신규 인물 금지)
 * named_with_gate  : 이름 있는 신규 인물 등장 허용하되, 생성기가 명시적으로 도입해야 함 (기본값)
 * open_cast        : 생성기 재량으로 인물 자유 추가 허용
 */
export type NewCharacterPolicy =
  | "closed_cast"
  | "extras_only"
  | "named_with_gate"
  | "open_cast";

/**
 * alias_policy — 호칭/성씨/역할 지칭을 이름 혼동으로 판정할 민감도
 *
 * strict      : 등록된 canonical name 표기만 허용
 * conservative: 성씨·호칭·역할 지칭은 허용, 의도 불분명한 약칭은 경고 (기본값)
 * flexible    : 별명·약칭 포함 폭넓게 허용
 */
export type AliasPolicy = "strict" | "conservative" | "flexible";

/**
 * CharacterPolicyConfig — 인물 정책 통합 설정
 * GenConfig 또는 WorldConfig에 optional 필드로 삽입 가능하도록 설계.
 * 현 단계에서는 내부 기본값 리졸버(character_policy_resolver.ts)가 채운다.
 */
export interface CharacterPolicyConfig {
  new_character_policy: NewCharacterPolicy;
  background_extras_allowed: boolean;
  alias_policy: AliasPolicy;
}

// ══════════════════════════════════════════════════════════════
// 2. 이름 관련 사건 분류
// ══════════════════════════════════════════════════════════════

/**
 * NameEventKind — 이름 관련 사건의 의미적 분류
 *
 * canonical_name_confusion      : 기존 인물 이름을 잘못 표기하거나 인물 간 이름 교차
 * alias_or_reference_usage      : 성씨·호칭·역할·별명으로 기존 인물을 지칭 (오류 아님)
 * background_extra_introduction : 이름 없는 배경/단역 인물 등장
 * named_new_character_introduction: 이름 있는 신규 인물 등장 (사전 설정 없음)
 */
export type NameEventKind =
  | "canonical_name_confusion"
  | "alias_or_reference_usage"
  | "background_extra_introduction"
  | "named_new_character_introduction";

/** 이름 관련 사건 단위 */
export interface NameEvent {
  kind: NameEventKind;
  /** 텍스트에 등장한 표기 */
  surface_form: string;
  /** 매칭된 canonical name (혼동/별칭 경우), 없으면 null */
  matched_canonical: string | null;
  /** 판정 근거 설명 */
  reason: string;
  /** 신규 인물 도입인 경우 현재 policy 위반 여부 */
  policy_violation?: boolean;
}

/** 이름 분석 결과 집합 */
export interface NameAnalysisResult {
  events: NameEvent[];
  has_confusion: boolean;
  has_new_named_character: boolean;
  has_background_extra: boolean;
  policy_violations: NameEvent[];
}
