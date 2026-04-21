/**
 * pov_policy.ts — POV 지원 정책 레이어
 *
 * 목적: 현재 스토리 모델이 안정적으로 지원하는 POV와 미지원 POV를 내부에서 명시.
 *       POV capability 진단 결과를 구조화된 타입으로 보존한다.
 *
 * 원칙:
 * - "지원하지 않음"과 "자동 변환"은 다르다. 자동 변환 금지.
 * - benchmark에서 미지원 POV를 제외할 때는 반드시 명시적으로 표기한다.
 * - 사용자가 미지원 POV를 요청했을 때 몰래 다른 POV로 바꾸지 않는다.
 * - 모델 교체 시 ACTIVE_POV_POLICY만 교체한다.
 */

import type { GenConfig } from "./canonical.js";

// ══════════════════════════════════════════════════════════════
// 1. 정책 타입 정의
// ══════════════════════════════════════════════════════════════

export type UnsupportedPovStrategy =
  | "disabled_for_current_model"  // 현재 모델에서 안정적 생성 불가 판단 — 생성 시도는 허용하나 benchmark 기본 제외
  | "reject_for_benchmark"        // benchmark 집계에서 명시적 제외
  | "allow_with_warning"          // 경고와 함께 생성 허용 (점수 하락 감수)
  | "fallback_model";             // 대체 모델로 라우팅 (미구현)

export interface UnsupportedPovEntry {
  pov: GenConfig["pov"];
  /** 미지원 판단 근거 */
  reason: string;
  /** 처리 방식 */
  strategy: UnsupportedPovStrategy;
  /** 진단 일자 YYYY-MM-DD */
  diagnosed_at: string;
}

export interface PovModelPolicy {
  /** 대상 스토리 모델 */
  model: string;
  /** 안정적으로 지원 가능한 POV 목록 */
  supported_povs: GenConfig["pov"][];
  /** 미지원 POV 목록과 이유·처리 방식 */
  unsupported_povs: UnsupportedPovEntry[];
  /** 채택된 POV 프롬프트 variant */
  adopted_variant: "A" | "B" | "C" | "D";
  /** variant 채택 근거 */
  variant_rationale: string;
}

// ══════════════════════════════════════════════════════════════
// 2. 모델별 정책 상수
// ══════════════════════════════════════════════════════════════

/**
 * gemma3:12b 기준 POV 지원 정책
 *
 * 진단: pov-capability-diagnostic (2026-04-22)
 * - 고정 10케이스, 4개 variant (A/B/C/D) 비교
 * - Variant C (rules-only): avg=67, POV위반=2 → 최우수, 채택
 * - Variant B (few-shot): 교차 시점 위반 0→5 폭발 → 채택 금지
 * - Variant D (scaffold): FAIL 1건 → 불안정
 * - 1인칭 관찰자: 전 variant에서 위반률 100% (2/2 케이스)
 */
export const GEMMA3_12B_POV_POLICY: PovModelPolicy = {
  model: "gemma3:12b",
  supported_povs: ["1인칭 주인공", "3인칭 관찰자", "전지적 작가", "교차 시점"],
  unsupported_povs: [
    {
      pov: "1인칭 관찰자",
      reason:
        "POV 진단(2026-04-22): 4개 variant(A/B/C/D) 전부에서 위반률 100% (2/2 케이스). " +
        "프롬프트 전략과 무관하게 '화자 내면 허용 / 타인 내면 금지' 경계를 유지하지 못함. " +
        "gemma3:12b 모델 능력 한계로 판단. 향후 모델 교체 또는 이원화 설계 시 재검토 대상.",
      strategy: "disabled_for_current_model",
      diagnosed_at: "2026-04-22",
    },
  ],
  adopted_variant: "C",
  variant_rationale:
    "Variant C (rules-only): avg_score=67, POV위반=2로 최우수. " +
    "Variant B (few-shot): 교차 시점에서 위반 5배 증가(0→5)로 채택 금지. " +
    "Variant D: FAIL 1건으로 불안정. Variant A: baseline (avg=66, 위반=3).",
};

/** 현재 활성 POV 정책 — 스토리 모델 교체 시 이 상수만 교체한다 */
export const ACTIVE_POV_POLICY: PovModelPolicy = GEMMA3_12B_POV_POLICY;

// ══════════════════════════════════════════════════════════════
// 3. 헬퍼 함수
// ══════════════════════════════════════════════════════════════

/** 미지원 POV 여부 확인 */
export function isUnsupportedPov(
  pov: GenConfig["pov"],
  policy: PovModelPolicy = ACTIVE_POV_POLICY,
): boolean {
  return policy.unsupported_povs.some(u => u.pov === pov);
}

/** 미지원 POV 항목 조회 (없으면 null) */
export function getUnsupportedPovEntry(
  pov: GenConfig["pov"],
  policy: PovModelPolicy = ACTIVE_POV_POLICY,
): UnsupportedPovEntry | null {
  return policy.unsupported_povs.find(u => u.pov === pov) ?? null;
}
