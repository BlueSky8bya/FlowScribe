/**
 * name_classifier.ts — 텍스트 내 이름 관련 사건 분류 유틸
 *
 * 목적: validator/generator가 "이름 혼동"과 "신규 인물 도입"을 혼동하지 않도록
 *       사건을 의미별로 분리 분류한다.
 *
 * 현 단계: validator/generator에 강하게 연결하지 않음.
 *           독립 유틸로서 다음 단계에서 필요한 쪽에서 import해 사용.
 */

import type { CanonicalCharacter } from "../types/canonical.js";
import type {
  AliasPolicy,
  CharacterPolicyConfig,
  NameAnalysisResult,
  NameEvent,
} from "../types/character_policy.js";
import { allowsBackgroundExtra, allowsNamedNewCharacter } from "../policies/character_policy_resolver.js";

// ── 별칭/호칭 판별 헬퍼 ─────────────────────────────────────────────────

/**
 * 이름 없는 배경 인물 표현 패턴.
 * "한 남자", "노인", "점원", "경비" 등 직함·역할 기반 지칭.
 */
const BACKGROUND_EXTRA_PATTERNS = [
  /^(한\s)?(남자|여자|노인|소년|소녀|아이|청년|중년|노파)$/,
  /^(경비|점원|직원|종업원|기사|의사|간호사|경찰|군인|병사)$/,
  /^(행인|통행인|군중|사람들|주민|마을\s?사람)$/,
];

function isBackgroundExtraLabel(surface: string): boolean {
  return BACKGROUND_EXTRA_PATTERNS.some((p) => p.test(surface.trim()));
}

/**
 * conservative/strict 정책에서 허용되는 별칭 패턴.
 * - 성씨 단독 (예: "박", "김")
 * - 호칭 접미 (예: "선배", "씨", "군", "양", "님", "선생", "박사")
 * - 역할 기반 (예: "대장", "팀장")
 */
function isAliasCandidate(
  surface: string,
  canonical: CanonicalCharacter,
  policy: AliasPolicy
): boolean {
  if (policy === "strict") return false;

  const name = canonical.name;

  // 성씨 단독 (2자 이상 이름에서 첫 글자)
  if (name.length >= 2 && surface === name[0]) return true;

  // 이름에 호칭 접미가 붙은 경우
  const honorifics = ["씨", "군", "양", "님", "선배", "선생", "박사", "대장", "팀장", "부장", "과장"];
  for (const h of honorifics) {
    if (surface === name + h || surface === name[0] + h) return true;
  }

  // flexible 정책: 이름의 부분 문자열도 허용
  if (policy === "flexible" && name.includes(surface) && surface.length >= 1) {
    return true;
  }

  return false;
}

// ── 핵심 분류 함수 ──────────────────────────────────────────────────────

/**
 * classifyNameEvent
 *
 * surface_form이 어떤 종류의 이름 사건인지 판별한다.
 *
 * @param surface   텍스트에 등장한 이름/표기
 * @param canonicals 현재 작품의 canonical 인물 목록
 * @param policy    인물 등장 정책
 * @returns NameEvent
 */
export function classifyNameEvent(
  surface: string,
  canonicals: CanonicalCharacter[],
  policy: CharacterPolicyConfig
): NameEvent {
  const trimmed = surface.trim();

  // 1. exact canonical match → 정상 (분류 불필요, 호출자가 필터)
  const exactMatch = canonicals.find((c) => c.name === trimmed);
  if (exactMatch) {
    return {
      kind: "alias_or_reference_usage",
      surface_form: trimmed,
      matched_canonical: exactMatch.name,
      reason: "canonical name 정확 일치",
    };
  }

  // 2. 별칭/호칭 후보 검사
  const aliasMatch = canonicals.find((c) =>
    isAliasCandidate(trimmed, c, policy.alias_policy)
  );
  if (aliasMatch) {
    return {
      kind: "alias_or_reference_usage",
      surface_form: trimmed,
      matched_canonical: aliasMatch.name,
      reason: `별칭/호칭으로 "${aliasMatch.name}" 지칭 (policy: ${policy.alias_policy})`,
    };
  }

  // 3. 배경 단역 표현
  if (isBackgroundExtraLabel(trimmed)) {
    const violation = !allowsBackgroundExtra(policy);
    return {
      kind: "background_extra_introduction",
      surface_form: trimmed,
      matched_canonical: null,
      reason: "이름 없는 배경/단역 인물 등장",
      policy_violation: violation,
    };
  }

  // 4. 근접 이름 혼동 검사 (편집 거리 기반 간략 구현)
  const confusionMatch = canonicals.find((c) => isNameConfusion(trimmed, c.name));
  if (confusionMatch) {
    return {
      kind: "canonical_name_confusion",
      surface_form: trimmed,
      matched_canonical: confusionMatch.name,
      reason: `"${confusionMatch.name}"의 오기 또는 혼동 표기로 추정`,
    };
  }

  // 5. 이름 있는 신규 인물
  const violation = !allowsNamedNewCharacter(policy);
  return {
    kind: "named_new_character_introduction",
    surface_form: trimmed,
    matched_canonical: null,
    reason: "사전 설정되지 않은 이름 있는 신규 인물",
    policy_violation: violation,
  };
}

/**
 * analyzeNameEvents — 텍스트 내 이름 후보 목록을 일괄 분류
 *
 * @param surfaces   추출된 이름 후보 문자열 배열
 * @param canonicals canonical 인물 목록
 * @param policy     인물 등장 정책
 */
export function analyzeNameEvents(
  surfaces: string[],
  canonicals: CanonicalCharacter[],
  policy: CharacterPolicyConfig
): NameAnalysisResult {
  const events: NameEvent[] = surfaces.map((s) =>
    classifyNameEvent(s, canonicals, policy)
  );

  return {
    events,
    has_confusion: events.some((e) => e.kind === "canonical_name_confusion"),
    has_new_named_character: events.some(
      (e) => e.kind === "named_new_character_introduction"
    ),
    has_background_extra: events.some(
      (e) => e.kind === "background_extra_introduction"
    ),
    policy_violations: events.filter((e) => e.policy_violation === true),
  };
}

// ── 내부 헬퍼: 편집 거리 기반 오기 판별 ─────────────────────────────────

/**
 * isNameConfusion — 한글 이름 오기/혼동 여부 간략 판별
 *
 * 전략:
 * - 길이 차이 1 이하 + 공통 글자 비율 ≥ 0.5 이면 혼동 후보
 * - 이름 길이가 1이면 비교 불가 (false 반환)
 */
function isNameConfusion(surface: string, canonical: string): boolean {
  if (canonical.length <= 1 || surface.length <= 1) return false;
  if (Math.abs(surface.length - canonical.length) > 1) return false;

  let common = 0;
  const used = new Array(canonical.length).fill(false);
  for (const ch of surface) {
    const idx = canonical.split("").findIndex((c, i) => c === ch && !used[i]);
    if (idx !== -1) {
      common++;
      used[idx] = true;
    }
  }
  return common / Math.max(surface.length, canonical.length) >= 0.5;
}
