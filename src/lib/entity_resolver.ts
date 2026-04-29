/**
 * entity_resolver.ts — 일반화된 Entity Resolution Layer
 *
 * LLM이 출력한 raw character name을 canonical entity로 수렴시킨다.
 * 특정 이름을 하드코딩하지 않는다 — 모든 판단은 규칙 + 패턴 기반이다.
 *
 * 흐름:
 *   raw_name → ObservedMention → resolveEntity() → EntityResolution
 *   → resolution === "canonical" 일 때만 DB 커밋
 */

import { logWarn } from "./logger.js";

// ── 타입 ──────────────────────────────────────────────────────

export type ResolutionType =
  | "canonical"           // 기존 인물 확정 (exact or drift-corrected)
  | "known_alias"         // 등록된 alias → canonical로 수렴
  | "descriptive_mention" // 묘사형 명칭 — entity 아님
  | "new_character"       // 신규 인물 후보 (조건 충족 시만)
  | "rejected";           // 노이즈/비한국어 → 무시

export interface EntityResolution {
  raw_name: string;
  canonical_name: string | null;
  resolution: ResolutionType;
  confidence: number;   // 0.0 ~ 1.0
  reason: string;
}

/**
 * ObservedMention — raw mention 수집 단위
 * context 기반 판단을 위한 feature bag (Phase 2A: 기본 필드만 사용)
 */
export interface ObservedMention {
  raw_name: string;
  episode: number;
  features?: {
    has_dialogue?: boolean;
    has_action?: boolean;
    role_hint?: string;
    co_occurring_entities?: string[];
  };
}

// ── 묘사형 명칭 패턴 (일반화된 규칙, 특정 이름 하드코딩 없음) ────────

/**
 * 한국어 일반 명사 — 단독으로 사용 시 entity가 아닌 묘사형으로 분류.
 * 특정 서사의 고유명사를 하드코딩하지 않는다.
 * 어떤 장르/세계관에서도 공통으로 적용되는 보통명사 목록.
 */
const GENERIC_NOUNS = new Set([
  // 인칭/연령
  "아이", "어린아이", "아기", "소년", "소녀", "청년", "청녀",
  "남자", "여자", "남성", "여성", "사내", "여인",
  "노인", "할아버지", "할머니", "어르신",
  "누군가", "누군가가", "사람", "인물", "자", "자신",
  // 직역/역할
  "기사", "병사", "경비", "경비병", "경호원", "근위병",
  "상인", "장사꾼", "행상", "농부", "어부",
  "마법사", "술사", "치료사", "사제", "성직자", "수도사",
  "왕", "왕비", "왕자", "공주", "귀족", "영주", "기병",
  "자객", "암살자", "도둑", "강도", "전사", "용사",
  "영웅", "현자", "예언자", "탐정", "형사", "군인",
  // 추상/현상
  "목소리", "그림자", "존재", "형체", "형상",
  "실루엣", "그것", "무언가",
]);

/**
 * 묘사형 수식어 — 앞에 붙으면 뒤 명사와 무관하게 묘사형으로 분류.
 * 예: "낯선 기사", "그림자 속 아이", "검은 존재"
 */
const DESCRIPTIVE_PREFIXES = [
  "낯선", "모르는", "알 수 없는",
  "검은", "붉은", "흰", "하얀", "어두운",
  "어린", "늙은", "젊은",
  "그림자 속", "어둠 속", "빛 속",
  "작은", "큰", "키 큰", "키 작은",
  "수수께끼의", "정체불명의", "이름 모를",
];

// ── 판별 함수 ────────────────────────────────────────────────

/**
 * 묘사형 명칭인지 판별 (일반화된 패턴 기반, 특정 이름 하드코딩 없음)
 *
 * 판별 기준:
 * 1. GENERIC_NOUNS에 정확히 포함되는 단어
 * 2. DESCRIPTIVE_PREFIXES 중 하나로 시작
 * 3. "수식어 + 공백 + 보통명사" 구조 (끝 토큰이 GENERIC_NOUNS)
 */
export function isDescriptiveMention(name: string): boolean {
  if (GENERIC_NOUNS.has(name)) return true;

  for (const prefix of DESCRIPTIVE_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }

  // "X Y Z" 구조: 마지막 토큰이 보통명사
  const tokens = name.split(/\s+/);
  if (tokens.length >= 2 && GENERIC_NOUNS.has(tokens[tokens.length - 1])) return true;

  return false;
}

/**
 * 고유명사 형태인지 판별 — 신규 인물 허용 여부의 기본 조건
 *
 * 판별 기준:
 * 1. 최소 2음절 이상
 * 2. 공백 없음 (복합 묘사어 제외)
 * 3. 비한국어 문자 없음
 * 4. 묘사형 아님 (위 함수와 보완 관계)
 */
export function isProperNounForm(name: string): boolean {
  if (name.length < 2) return false;
  if (name.includes(" ")) return false;  // 복합 묘사어는 공백 포함
  if (/[A-Za-z]/.test(name)) return false;
  if (/[一-鿿㐀-䶿]/.test(name)) return false;  // CJK
  if (/[฀-๿Ѐ-ӿ؀-ۿ぀-ゟ゠-ヿ]/.test(name)) return false;
  return true;
}

// ── 메인 resolveEntity 함수 ──────────────────────────────────

export interface ResolveEntityOptions {
  /** 신규 인물 허용 여부 (기본 true) */
  allowNewCharacter?: boolean;
  /** 등록된 alias 매핑 (raw → canonical) */
  knownAliases?: Map<string, string>;
  /** 로그 context 정보 */
  logCtx?: { episode?: number; bookId?: string };
}

export function resolveEntity(
  rawName: string,
  canonicalNames: string[],
  opts: ResolveEntityOptions = {},
): EntityResolution {
  const { allowNewCharacter = true, knownAliases, logCtx } = opts;
  const trimmed = rawName.trim();

  // 빈 이름 → rejected
  if (!trimmed) {
    return { raw_name: rawName, canonical_name: null, resolution: "rejected", confidence: 1.0, reason: "empty_name" };
  }

  // 1. Exact canonical match (confidence 1.0)
  if (canonicalNames.includes(trimmed)) {
    return { raw_name: rawName, canonical_name: trimmed, resolution: "canonical", confidence: 1.0, reason: "exact_match" };
  }

  // 2. Known alias registry (phase 2A: memory-only)
  if (knownAliases?.has(trimmed)) {
    const canonical = knownAliases.get(trimmed)!;
    return { raw_name: rawName, canonical_name: canonical, resolution: "known_alias", confidence: 0.95, reason: `known_alias → ${canonical}` };
  }

  // 3. Drift correction: canonical이 raw의 prefix이거나 raw가 canonical의 prefix
  for (const cname of canonicalNames) {
    if (trimmed.startsWith(cname) || cname.startsWith(trimmed)) {
      logWarn("entity_resolver", "drift_corrected", { raw: trimmed, canonical: cname, ...logCtx });
      return { raw_name: rawName, canonical_name: cname, resolution: "canonical", confidence: 0.9, reason: `drift_corrected → ${cname}` };
    }
  }

  // 4. 비한국어 문자 → rejected (orphan)
  if (/[A-Za-z]/.test(trimmed) || /[一-鿿㐀-䶿]/.test(trimmed) || /[฀-๿Ѐ-ӿ؀-ۿ぀-ゟ゠-ヿ]/.test(trimmed)) {
    logWarn("entity_resolver", "rejected — 비한국어 이름", { raw: trimmed, ...logCtx });
    return { raw_name: rawName, canonical_name: null, resolution: "rejected", confidence: 1.0, reason: "non_korean_script" };
  }

  // 5. 묘사형 명칭 → descriptive_mention (entity 아님, DB 저장 불가)
  if (isDescriptiveMention(trimmed)) {
    logWarn("entity_resolver", "descriptive_mention — 묘사형 명칭, entity로 저장하지 않음", { raw: trimmed, ...logCtx });
    return { raw_name: rawName, canonical_name: null, resolution: "descriptive_mention", confidence: 0.85, reason: "descriptive_pattern_match" };
  }

  // 6. 고유명사 형태가 아닌 경우 → descriptive_mention
  if (!isProperNounForm(trimmed)) {
    logWarn("entity_resolver", "descriptive_mention — 고유명사 형태 아님", { raw: trimmed, ...logCtx });
    return { raw_name: rawName, canonical_name: null, resolution: "descriptive_mention", confidence: 0.7, reason: "not_proper_noun_form" };
  }

  // 7. 신규 인물 후보 — allowNewCharacter 조건 충족 시만 허용
  if (allowNewCharacter) {
    logWarn("entity_resolver", "new_character — canonical 외 신규 인물 후보", { raw: trimmed, ...logCtx });
    return { raw_name: rawName, canonical_name: trimmed, resolution: "new_character", confidence: 0.6, reason: "new_character_candidate" };
  }

  // 8. 신규 인물 불허 → descriptive_mention으로 fallback
  return { raw_name: rawName, canonical_name: null, resolution: "descriptive_mention", confidence: 0.5, reason: "new_character_not_allowed" };
}
