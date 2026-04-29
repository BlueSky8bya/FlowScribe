/**
 * src/lib/item_ledger.ts — Item & Location Ledger
 *
 * 소지품 canonical name 유지, condition 분리, skill reject,
 * carry-forward, location 변화 추적을 담당한다.
 *
 * DB schema 변경 없이 runtime + trace JSON 중심으로 동작한다.
 */

import type { ItemEntry } from "../types/canonical.js";

// ══════════════════════════════════════════════════════════════
// Item Ledger types
// ══════════════════════════════════════════════════════════════

export type ItemResolution =
  | "canonical"         // 정확히 일치
  | "known_alias"       // 축약형 → canonical 복원
  | "condition_split"   // 이름에 상태 포함 → 분리
  | "new_item"          // 새로운 아이템
  | "skill_rejected"    // 스킬/능력 → 거부
  | "rejected";         // 그 외 거부

export interface ItemNormalizeResult {
  canonical_name: string | null;
  condition?: string;
  description?: string;
  grade?: string;
  resolution: ItemResolution;
  reason: string;
}

export interface ItemLedgerEntry {
  owner: string;
  canonical_name: string;
  raw_name?: string;
  aliases?: string[];
  category?: string;
  description?: string;
  condition?: string;
  possession_state: "carried" | "stored" | "lost" | "damaged" | "consumed" | "unknown";
  source: "canonical_initial" | "planner_update" | "carry_forward" | "inferred";
  first_seen_episode?: number;
  last_seen_episode?: number;
  last_changed_episode?: number;
  change_note?: string;
}

export interface LocationLedgerEntry {
  character_name: string;
  previous_location?: string;
  current_location: string;
  transition_reason?: string;
  source: "planner_update" | "state_extractor" | "carry_forward" | "inferred";
  episode_number: number;
}

export interface ItemLedgerCheck {
  canonical_items_count: number;
  normalized_items_count: number;
  rejected_skill_items_count: number;
  condition_split_count: number;
  new_items_count: number;
  item_name_drift_count: number;
  missing_canonical_items_restored_count: number;
}

export interface LocationLedgerCheck {
  location_carry_forward_count: number;
  abrupt_location_change_count: number;
  missing_location_count: number;
}

// ══════════════════════════════════════════════════════════════
// 스킬/능력 감지
// ══════════════════════════════════════════════════════════════

const SKILL_KEYWORDS = [
  "스킬", "능력", "특성", "패시브", "액티브", "마법 능력", "고유 스킬",
  "Lv.", "레벨", "level", "skill", "ability", "passive", "active",
  "마법", "마력", "법술", "주문", "주술", "봉인술", "召喚",
  "버프", "디버프", "상태이상", "이능", "초능력", "각성",
];

const SKILL_PATTERN = /스킬$|능력$|특성$|패시브$|레벨\s*\d+|Lv\.\s*\d+/;

export function isSkillLike(name: string): boolean {
  const lower = name.toLowerCase();
  if (SKILL_KEYWORDS.some(k => name.includes(k))) return true;
  if (SKILL_PATTERN.test(name)) return true;
  // "고유 스킬: 분석" 패턴
  if (/고유\s*(스킬|능력|특성)/.test(name)) return true;
  if (/[가-힣]+\s*(스킬|능력|이능|기술)$/.test(name)) return true;
  return false;
}

// ══════════════════════════════════════════════════════════════
// 환경 사물 감지 — 소지품이 아닌 장면 소품/가구/식기
// ══════════════════════════════════════════════════════════════

const ENVIRONMENT_OBJECT_WORDS = new Set([
  // 가구/시설
  "식탁", "테이블", "의자", "침대", "소파", "책상", "선반", "서랍", "서랍장", "옷장",
  "문", "창문", "창문틀", "창문유리", "벽", "바닥", "천장", "계단", "복도", "방", "건물",
  "기둥", "통로", "출구", "비상구", "문고리", "손잡이", "경첩",
  // 식기/주방
  "숟가락", "젓가락", "포크", "나이프식기", "컵", "접시", "그릇", "냄비", "후라이팬",
  "쟁반", "밥그릇", "국그릇", "물잔", "유리잔", "머그컵", "냄비뚜껑",
  // 조명/전기
  "전등", "조명", "전구", "형광등", "스탠드", "촛대", "양초", "횃불",
  // 일반 장소 소품
  "난로", "화로", "벽난로", "라디에이터", "에어컨", "선풍기", "환기구",
  // 건물/구조물
  "철장", "우리", "창살", "격자",
]);

const ENVIRONMENT_SUFFIX_RE = /^(낡은|오래된|금이\s*간|부서진|깨진)\s*(식탁|테이블|의자|침대|소파|책상|선반|서랍|문|창문|벽|바닥|천장|계단)$/;

export function isEnvironmentObject(name: string): boolean {
  const trimmed = name.trim();
  if (ENVIRONMENT_OBJECT_WORDS.has(trimmed)) return true;
  if (ENVIRONMENT_SUFFIX_RE.test(trimmed)) return true;
  return false;
}

// ══════════════════════════════════════════════════════════════
// 괄호/접두어 condition 분리
// ══════════════════════════════════════════════════════════════

// 괄호 안 상태 키워드
const CONDITION_PAREN_RE = /[（(]([^）)]+)[）)]\s*$/;

// 접두 상태 수식어
const CONDITION_PREFIX_PATTERNS: Array<{ re: RegExp; cond: string }> = [
  { re: /^방전된?\s+/, cond: "방전" },
  { re: /^파손된?\s+/, cond: "파손" },
  { re: /^손상된?\s+/, cond: "손상" },
  { re: /^고장난?\s+/, cond: "고장" },
  { re: /^낡은\s+/, cond: "낡음" },
  { re: /^깨진\s+/, cond: "파손" },
  { re: /^불완전한\s+/, cond: "불완전" },
  { re: /^반쯤 부러진\s+/, cond: "반파" },
  { re: /^녹슨\s+/, cond: "녹슬음" },
  { re: /^소진된?\s+/, cond: "소진" },
  { re: /^분실된?\s+/, cond: "분실" },
  { re: /^혈흔이 묻은\s+/, cond: "혈흔" },
];

// 접미 상태 수식어
const CONDITION_SUFFIX_PATTERNS: Array<{ re: RegExp; cond: string }> = [
  { re: /\s*\(방전\)$/, cond: "방전" },
  { re: /\s*\(파손\)$/, cond: "파손" },
  { re: /\s*\(손상\)$/, cond: "손상" },
  { re: /\s*\(고장\)$/, cond: "고장" },
  { re: /\s*\(분실\)$/, cond: "분실" },
  { re: /\s*\(소진\)$/, cond: "소진" },
];

export function splitConditionFromName(rawName: string): { name: string; condition?: string } {
  let name = rawName.trim();
  let condition: string | undefined;

  // 접미 괄호 (방전) (파손) 등
  for (const p of CONDITION_SUFFIX_PATTERNS) {
    if (p.re.test(name)) {
      name = name.replace(p.re, "").trim();
      condition = p.cond;
      return { name, condition };
    }
  }

  // 일반 괄호 분리 — 괄호 안이 상태 키워드인 경우
  const parenMatch = CONDITION_PAREN_RE.exec(name);
  if (parenMatch) {
    const inner = parenMatch[1].trim();
    // 숫자+단위는 수량이므로 condition 아님
    if (!/^\d+/.test(inner)) {
      name = name.replace(CONDITION_PAREN_RE, "").trim();
      condition = inner;
      return { name, condition };
    }
  }

  // 접두 수식어
  for (const p of CONDITION_PREFIX_PATTERNS) {
    if (p.re.test(name)) {
      name = name.replace(p.re, "").trim();
      condition = condition ? `${p.cond}, ${condition}` : p.cond;
      return { name, condition };
    }
  }

  return { name };
}

// ══════════════════════════════════════════════════════════════
// Item Name Normalizer
// ══════════════════════════════════════════════════════════════

/**
 * raw item name을 canonical initial_items 기준으로 정규화한다.
 *
 * @param rawItemName - LLM/planner가 출력한 원본 이름
 * @param ownerCanonicalItems - 해당 인물의 canonical initial_items
 * @param prevItems - 직전 화 dynamic items (carry-forward 기준)
 */
export function resolveItemName(
  rawItemName: string,
  ownerCanonicalItems: ItemEntry[],
  prevItems: ItemEntry[] = [],
): ItemNormalizeResult {
  if (!rawItemName || !rawItemName.trim()) {
    return { canonical_name: null, resolution: "rejected", reason: "empty name" };
  }

  // 1. 스킬/능력 reject
  if (isSkillLike(rawItemName)) {
    return {
      canonical_name: null,
      resolution: "skill_rejected",
      reason: `skill-like item rejected: ${rawItemName}`,
    };
  }

  // 1b. 환경 사물 reject (식탁, 의자, 가구 등 scene object)
  if (isEnvironmentObject(rawItemName)) {
    return {
      canonical_name: null,
      resolution: "rejected",
      reason: `environment object rejected (not a character item): ${rawItemName}`,
    };
  }

  // 2. condition 분리
  const { name: splitName, condition: splitCondition } = splitConditionFromName(rawItemName);

  // 3. 모든 canonical sources (initial + prev dynamic)
  const allCanonical = [...ownerCanonicalItems, ...prevItems];

  // 4. 정확히 일치 (원본 또는 condition 분리 후)
  for (const canon of allCanonical) {
    if (!canon.name) continue;
    if (canon.name === rawItemName) {
      return {
        canonical_name: canon.name,
        condition: canon.condition,
        description: canon.description,
        grade: canon.grade,
        resolution: "canonical",
        reason: "exact match",
      };
    }
    if (canon.name === splitName) {
      return {
        canonical_name: canon.name,
        condition: splitCondition ?? canon.condition,
        description: canon.description,
        grade: canon.grade,
        resolution: "condition_split",
        reason: `condition split: "${rawItemName}" → name="${splitName}" condition="${splitCondition}"`,
      };
    }
  }

  // 5. 축약형 — canonical item name이 raw name을 포함하거나 반대
  for (const canon of allCanonical) {
    if (!canon.name) continue;
    const cLower = canon.name.toLowerCase();
    const rLower = splitName.toLowerCase();
    if (cLower.includes(rLower) || rLower.includes(cLower)) {
      // 단, 너무 짧은 단어는 false positive 방지 (2글자 이하는 스킵)
      if (rLower.length > 2 && cLower.length > 2) {
        return {
          canonical_name: canon.name,
          condition: splitCondition ?? canon.condition,
          description: canon.description,
          grade: canon.grade,
          resolution: "known_alias",
          reason: `alias match: "${rawItemName}" → "${canon.name}"`,
        };
      }
    }
  }

  // 6. new item — 새 아이템으로 허용
  return {
    canonical_name: splitName || rawItemName,
    condition: splitCondition,
    resolution: "new_item",
    reason: `new item: "${rawItemName}"`,
  };
}

/**
 * character_state_updates의 items 배열 전체를 정규화한다.
 * canonical initial items 누락 시 carry-forward로 보강한다.
 */
export function normalizeItems(
  rawItems: ItemEntry[] | undefined,
  ownerCanonicalItems: ItemEntry[],
  prevItems: ItemEntry[],
  stats: ItemLedgerCheck,
): ItemEntry[] {
  const resolved: ItemEntry[] = [];
  const resolvedCanonNames = new Set<string>();

  if (rawItems && rawItems.length > 0) {
    for (const raw of rawItems) {
      if (!raw.name) continue;
      const result = resolveItemName(raw.name, ownerCanonicalItems, prevItems);

      if (result.resolution === "skill_rejected" || result.resolution === "rejected") {
        stats.rejected_skill_items_count++;
        continue;
      }

      if (result.resolution === "condition_split") {
        stats.condition_split_count++;
      }
      if (result.resolution === "known_alias") {
        stats.item_name_drift_count++;
      }
      if (result.resolution === "new_item") {
        stats.new_items_count++;
      }
      if (result.resolution === "canonical" || result.resolution === "known_alias" || result.resolution === "condition_split") {
        stats.normalized_items_count++;
      }

      if (result.canonical_name) {
        resolvedCanonNames.add(result.canonical_name);
        resolved.push({
          name: result.canonical_name,
          ...(result.grade     ? { grade: result.grade as any }     : raw.grade     ? { grade: raw.grade }     : {}),
          ...(result.condition !== undefined ? { condition: result.condition }
               : raw.condition             ? { condition: raw.condition }           : {}),
          // description: user canonical 우선, 없으면 raw
          ...(result.description ? { description: result.description }
              : raw.description   ? { description: raw.description }                : {}),
        });
      }
    }
  }

  // canonical initial items 중 누락된 것 carry-forward
  for (const canon of ownerCanonicalItems) {
    if (!canon.name || resolvedCanonNames.has(canon.name)) continue;
    // prev에서 해당 아이템 찾기 (condition 업데이트 반영)
    const prevEntry = prevItems.find(p => p.name === canon.name);
    if (prevEntry) {
      resolved.push({ ...prevEntry });
    } else {
      resolved.push({
        name: canon.name,
        ...(canon.grade       ? { grade: canon.grade }           : {}),
        ...(canon.condition   ? { condition: canon.condition }   : {}),
        ...(canon.description ? { description: canon.description } : {}),
      });
    }
    stats.missing_canonical_items_restored_count++;
    stats.canonical_items_count++;
  }

  stats.canonical_items_count += resolvedCanonNames.size;
  return resolved;
}

// ══════════════════════════════════════════════════════════════
// Location Ledger
// ══════════════════════════════════════════════════════════════

const TELEPORT_DISTANCE_KEYWORDS = [
  // 완전히 다른 장소 이름 패턴 — 단순 이름 비교로는 판단하기 어렵지만
  // 이전 location과 현재 location이 둘 다 존재하고 완전히 다를 때 WARN
];

export function checkLocationChange(
  prevLocation: string | undefined | null,
  newLocation: string | undefined | null,
  episodeNumber: number,
  characterName: string,
): LocationLedgerEntry & { is_abrupt: boolean } {
  const prev = prevLocation?.trim() ?? undefined;
  const curr = newLocation?.trim() ?? "미등장";

  const isCarryForward = !newLocation || newLocation === "미등장" || newLocation === prev;
  const isAbrupt = !isCarryForward && !!prev && prev !== "미등장" && curr !== "미등장";

  return {
    character_name: characterName,
    previous_location: prev,
    current_location: curr,
    source: isCarryForward ? "carry_forward" : "planner_update",
    episode_number: episodeNumber,
    is_abrupt: isAbrupt,
  };
}

// ══════════════════════════════════════════════════════════════
// Empty stats factory
// ══════════════════════════════════════════════════════════════

export function emptyItemLedgerCheck(): ItemLedgerCheck {
  return {
    canonical_items_count: 0,
    normalized_items_count: 0,
    rejected_skill_items_count: 0,
    condition_split_count: 0,
    new_items_count: 0,
    item_name_drift_count: 0,
    missing_canonical_items_restored_count: 0,
  };
}

export function emptyLocationLedgerCheck(): LocationLedgerCheck {
  return {
    location_carry_forward_count: 0,
    abrupt_location_change_count: 0,
    missing_location_count: 0,
  };
}
