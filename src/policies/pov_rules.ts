/**
 * pov_rules.ts — Variant C POV 규칙 공유 모듈
 *
 * 위치: src/policies/ (정책 레이어)
 * 이전 위치: src/lib/pov_rules.ts (re-export shim 유지)
 *
 * 채택 근거: pov-capability-diagnostic (2026-04-22)
 * - Variant C (rules-only): avg=67, POV위반=2, FAIL=0 → 최우수
 * - Variant B (few-shot): 교차 시점 위반 0→5 → 채택 금지 (영구)
 *
 * 1인칭 주인공 오프닝 앵커 추가 (2026-04-22): protagonist-pov-diagnostic
 * - Variant C(앵커): POV위반 7→5, avg 57→61 → 최우수
 * - 주의: revision이 1인칭 주인공 케이스를 오히려 악화시킴 (FAIL 3→4)
 *
 * benchmark(scripts/benchmarks/test_runner.ts)와 서비스(src/services/story.ts) 양쪽에서 임포트한다.
 * 두 경로가 같은 함수를 사용함으로써 POV 정책 의미 불일치를 방지한다.
 */

import { ACTIVE_POV_POLICY, isUnsupportedPov, getUnsupportedPovEntry } from "../types/pov_policy.js";
export { isUnsupportedPov, getUnsupportedPovEntry, ACTIVE_POV_POLICY };

// ══════════════════════════════════════════════════════════════
// Variant C POV 규칙 — few-shot 없는 명시적 금지/허용 규칙
// ══════════════════════════════════════════════════════════════

/**
 * variantCPovRule — POV별 Variant C 규칙 문자열 반환.
 *
 * string 타입을 받아 처리하므로 StoryConfig(string pov)와
 * GenConfig(union type pov) 양쪽에서 사용 가능.
 *
 * 1인칭 관찰자: 현재 모델(gemma3:12b) 미지원이나
 * 규칙 자체는 남긴다. 생성 차단은 호출 지점에서 처리.
 */
export function variantCPovRule(pov: string): string {
  if (pov.includes("1인칭 주인공") || pov === "1인칭주인공") {
    return `시점: 1인칭 주인공
오프닝 앵커: 화의 첫 2~3문장은 반드시 '나'의 감각·행동·시선으로 시작한다. 첫 문장을 타인·'그'·'그녀'로 시작하지 않는다.
필수: 모든 서술부는 '나/나는/내가/나의'로 시작하거나 1인칭 관점을 유지한다.
절대금지: 서술부에서 '그가/그녀가/그는/그녀는'으로 시작하는 3인칭 주어 사용.
허용: 대사(" " 내부) 안에서 다른 인물이 '나'를 지칭하는 것은 정상.`;
  }

  if (pov.includes("1인칭 관찰자") || pov === "1인칭관찰자") {
    // 미지원 POV지만 규칙 자체는 포함 — 호출 지점에서 생성 차단 여부 결정.
    // 자동 변환 금지: 1인칭 주인공이나 다른 POV로 바꾸지 않는다.
    return `시점: 1인칭 관찰자
필수: 서술부에서 화자 '나'의 관찰·행동만 서술한다.
절대금지: 서술부에서 타인의 감정·생각·의도를 '~했다/~이었다' 형식으로 직접 단언하는 것.
예시 금지 표현: '그는 두려웠다', '그녀의 목표는 ~이었다', '그는 기뻤다'.
허용: '~처럼 보였다', '~인 듯했다', '~는 것 같았다' (추측 표현), 외면 관찰.`;
  }

  if (pov === "3인칭 관찰자" || pov === "3인칭관찰자") {
    return `시점: 3인칭 관찰자
필수: 특정 시점 인물의 외부 시선으로만 서술한다.
절대금지: 어느 인물의 감정·생각·내면 목표를 서술부에서 직접 단언하는 것.
  - 금지: '~는 두려웠다', '~의 목표는 ~이었다', '~은 ~라고 믿었다'
허용: 인물의 외면 행동과 표정 묘사, 대사 안에서 내면 암시.
서술부에서 내면을 표현하려면 반드시 추측 어미 사용 ('~듯했다', '~처럼 보였다').`;
  }

  if (pov === "전지적 작가" || pov.includes("전지적")) {
    return `시점: 전지적 작가
허용: 등장 모든 인물의 내면·감정·생각·과거·의도를 직접 서술 가능.
주의: 서술부에서 갑자기 1인칭('나는')으로 전환하지 않는다.`;
  }

  if (pov === "교차 시점" || pov.includes("교차")) {
    return `시점: 교차 시점
필수: 각 장면 전환 시 현재 시점 인물을 반드시 소제목(## 이름) 또는 명시적 서술로 표시한다.
절대금지: 표시 없이 시점 인물이 바뀌는 것.
각 시점 인물의 장면 안에서: 해당 인물 시점에서 자연스러운 내면 서술만 허용. 타인 내면 직접 단언 금지.`;
  }

  // fallback — 알 수 없는 시점값
  return `시점: ${pov}\n필수: 해당 시점을 일관되게 유지한다. 서술부에서 1인칭 표현 금지 (대사 안은 허용).`;
}

// ══════════════════════════════════════════════════════════════
// 미지원 POV 서비스 처리 헬퍼
// ══════════════════════════════════════════════════════════════

export interface PovCheckResult {
  supported: boolean;
  strategy?: string;
  reason?: string;
}

/**
 * checkPovForService — 서비스 경로에서 POV 지원 여부 확인.
 * 자동 변환은 이 함수가 하지 않는다. 변환 결정은 호출 지점에서 한다.
 */
export function checkPovForService(pov: string): PovCheckResult {
  if (!isUnsupportedPov(pov as any)) {
    return { supported: true };
  }
  const entry = getUnsupportedPovEntry(pov as any);
  return {
    supported: false,
    strategy: entry?.strategy,
    reason: entry?.reason,
  };
}
