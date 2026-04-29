/**
 * language_guard.ts — character state 필드 한국어 정규화
 *
 * planner/LLM이 영어로 상태를 반환할 때 DB 저장 전에 한국어로 변환한다.
 * pipeline commit 경로와 carry-forward 경로 모두에 적용해야 한다.
 */

const EMOTION_MAP: Record<string, string> = {
  // 감정 상태
  unreadable: "알 수 없음",
  enigmatic: "수수께끼 같음",
  anxious: "불안",
  suspicious: "의심",
  confused: "혼란",
  distressed: "고통",
  angry: "분노",
  sad: "슬픔",
  happy: "기쁨",
  fearful: "두려움",
  scared: "두려움",
  fear: "두려움",
  excited: "흥분",
  calm: "평온",
  nervous: "긴장",
  relieved: "안도",
  determined: "결연함",
  desperate: "절박",
  melancholy: "우울",
  grief: "비통",
  hope: "희망",
  hopeful: "희망",
  distrust: "불신",
  vigilant: "경계",
  wary: "경계",
  exhausted: "탈진",
  stoic: "담담",
  unconscious: "의식 없음",
  injured: "부상",
  unknown: "알 수 없음",
  // 복합 영어 패턴 (대소문자 무관 매핑)
  "concerned, watchful": "걱정, 경계",
  "curious, analytical": "호기심, 분석적",
  distracted: "산만함",
  agitated: "동요",
  overwhelmed: "압도됨",
  panicked: "공황",
  resigned: "체념",
  conflicted: "갈등",
  regretful: "후회",
  suspicious_wary: "의심, 경계",
};

const PHYSICAL_MAP: Record<string, string> = {
  injured: "부상",
  unconscious: "의식 없음",
  exhausted: "탈진",
  wounded: "상처",
  bleeding: "출혈",
  healthy: "정상",
  normal: "정상",
  unknown: "알 수 없음",
};

const LOCATION_MAP: Record<string, string> = {
  unknown: "미상",
  "not present": "미등장",
  absent: "미등장",
};

// 한국어(가-힣) + ASCII 혼합인지 감지 — 순수 한국어 텍스트도 허용
const MOSTLY_ENGLISH_RE = /^[a-zA-Z ,.'"\-_&()]+$/;
const NON_KO_SCRIPT_RE = /[一-鿿㐀-䶿Ѐ-ӿ؀-ۿ฀-๿ก-๿]/;

function _normalizeField(
  value: string | null | undefined,
  map: Record<string, string>,
  fieldName: string,
): string | null {
  if (!value) return value ?? null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // CJK/키릴/태국어 등 비한국어 스크립트 제거
  if (NON_KO_SCRIPT_RE.test(trimmed)) {
    return "알 수 없음";
  }

  // 이미 한국어 포함이면 그대로 — 영어 단어가 일부 섞인 경우도 허용
  const hasKorean = /[가-힣]/.test(trimmed);
  if (hasKorean) return trimmed;

  // 순수 영어 텍스트 처리
  const lower = trimmed.toLowerCase();

  // 직접 매핑
  if (map[lower]) return map[lower];

  // 복합 패턴: 쉼표 구분 영어 → 각 단어 변환 후 합산
  if (MOSTLY_ENGLISH_RE.test(trimmed)) {
    const parts = trimmed.split(/[,;]+/).map(p => p.trim()).filter(Boolean);
    const converted = parts.map(p => {
      const pl = p.toLowerCase();
      return map[pl] ?? null;
    });
    if (converted.every(Boolean)) {
      return converted.join(", ");
    }
    // 일부 변환 가능 — 변환된 것만 사용
    const partial = converted.filter(Boolean);
    if (partial.length > 0) return partial.join(", ");
    // 변환 불가 — 첫 부분만 알 수 없음으로
    return "알 수 없음";
  }

  return trimmed;
}

export function normalizeEmotionalState(v: string | null | undefined): string | null {
  return _normalizeField(v, EMOTION_MAP, "emotional_state");
}

export function normalizePhysicalState(v: string | null | undefined): string | null {
  return _normalizeField(v, PHYSICAL_MAP, "physical_state");
}

export function normalizeLocation(v: string | null | undefined): string | null {
  return _normalizeField(v, LOCATION_MAP, "location");
}

export function normalizeRecentGoal(v: string | null | undefined): string | null {
  if (!v) return v ?? null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (NON_KO_SCRIPT_RE.test(trimmed)) return null;
  // 한국어 비율 30% 이상이어야 유효한 한국어 목표로 인정
  // 혼합형("Determine the reality of 최나래's...") 도 null로 처리
  const koChars = (trimmed.match(/[가-힣]/g) ?? []).length;
  const ratio = koChars / trimmed.replace(/\s/g, "").length;
  if (ratio >= 0.3) return trimmed;
  // 한국어 비율 부족 → null (이전 상태 유지 신호)
  return null;
}

/** character_state_updates 한 항목 전체 정규화 */
export function normalizeStateUpdate<T extends {
  emotional_state?: string | null;
  physical_state?: string | null;
  location?: string | null;
  recent_goal?: string | null;
}>(upd: T): T {
  return {
    ...upd,
    emotional_state: normalizeEmotionalState(upd.emotional_state) ?? upd.emotional_state,
    physical_state:  normalizePhysicalState(upd.physical_state)   ?? upd.physical_state,
    location:        normalizeLocation(upd.location)              ?? upd.location,
    recent_goal:     normalizeRecentGoal(upd.recent_goal)         ?? upd.recent_goal,
  };
}
