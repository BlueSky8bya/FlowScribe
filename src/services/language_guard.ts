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

/**
 * Phase 4.16 — 감정 라벨 짧게 정규화.
 * 문장형 emotional_state ("빅토리를 돕기 위해 노력하며 희망을 품음" 등)는 핵심 감정 단어로 압축.
 * 본문 생성 정보는 emotion_cause / progression_delta 같은 보조 필드에 보존(선택적).
 */
const SENTENCE_HINT_RE = /(하기\s*위해|하려는|하려고|하며|하면서|하고자|품은|품음|느끼며|느끼는|되어|되면서|당하며|당하면서)/;

// 흔한 감정 단어 우선순위 (먼저 매칭되는 것이 label로 채택)
// Phase 4.19 — multi-word 감정과 동사형 감정("조심하면서도", "두려워하며")도 짧은 라벨로 정규화.
const EMOTION_KEYWORDS: Array<[RegExp, string]> = [
  [/희망|기대감|기대/, "희망"],
  [/절망|좌절|체념/, "절망"],
  [/공포|두려움|두려워|두려|무서워|무서움/, "두려움"],
  [/불안|초조|걱정|염려/, "불안"],
  [/긴장/, "긴장"],
  [/분노|격노|성내|화가|짜증|분개/, "분노"],
  [/슬픔|슬퍼|애도|비통|울적/, "슬픔"],
  [/혼란|당혹|당황|혼돈/, "혼란"],
  [/경계심|경계|방어적|조심|주의|경각/, "경계"],
  [/결의|결단|결심|단호함|단호|각오|다짐|확신/, "결의"],
  [/의심|의구심|불신/, "의심"],
  [/안도|안심|위안/, "안도"],
  [/기쁨|기뻐|즐거움|즐거워|환희|명랑/, "기쁨"],
  [/사랑|애정/, "애정"],
  [/외로움|고독|쓸쓸/, "고독"],
  [/죄책감|후회/, "죄책감"],
  [/연민|동정/, "연민"],
  [/호기심/, "호기심"],
  [/충격|놀람|놀라/, "충격"],
  [/평온|차분|침착|고요/, "평온"],
  [/신중/, "신중"],
  [/주저|망설/, "주저"],
  [/집중/, "집중"],
  [/동요|흔들림/, "동요"],
  [/압도|압박/, "압박"],
  [/갈등/, "갈등"],
  [/무력감|무력|좌초/, "무력감"],
];

// 한국어 동사·형용사 어미 — 앞부분에 감정 어근이 있을 때 떼어내기 위해 사용.
// 예: "조심하면서도" → "조심", "두려워하며" → "두려워", "당황한 채" → "당황"
const _VERB_TAIL_RE = /(하면서도|하면서|하며|하다가|하지만|하지|해도|하고도|하고|해서|하기에|하기|하던|한채|한 채|하니|하느라|되어|되면서|되며|되니|되었|었|던|는|은|을|를|이|가|와|과|에|의|로)$/;

function shortenEmotionalLabel(s: string): string {
  // 라벨 후보 매칭 (가장 먼저 매칭되는 단어가 라벨이 됨)
  for (const [re, label] of EMOTION_KEYWORDS) {
    if (re.test(s)) return label;
  }
  // 첫 어절 단축 + 어미 반복 제거
  let firstToken = (s.split(/[\s,，·]+/)[0] ?? "").trim();
  for (let i = 0; i < 3 && firstToken.length > 1; i++) {
    const stripped = firstToken.replace(_VERB_TAIL_RE, "");
    if (stripped === firstToken) break;
    firstToken = stripped;
  }
  // 어미 제거 후 다시 keyword 매칭 시도
  for (const [re, label] of EMOTION_KEYWORDS) {
    if (re.test(firstToken)) return label;
  }
  // 그래도 라벨화 안되면 stem 자체가 짧고 명사형이면 그대로 사용
  if (firstToken && firstToken.length >= 2 && firstToken.length <= 5) return firstToken;
  return "알 수 없음";
}

// 동사·형용사 어미로 끝나면 단축 trigger (예: "기뻐하는", "조심하는", "두려워하며")
const _VERB_END_TRIGGER_RE = /(하면서도|하면서|하며|하다가|하지|해도|하고|해서|하기|하던|한채|하는|하기에|되어|되면|되며|되니|었다|는다|던가|는다고|이며|되는)$/;

export function normalizeEmotionalState(v: string | null | undefined): string | null {
  const baseNormalized = _normalizeField(v, EMOTION_MAP, "emotional_state");
  if (!baseNormalized) return baseNormalized;
  const trimmed = baseNormalized.trim();
  // Phase 4.19 — 단축 진입 조건:
  //   length > 15  : 문장형
  //   SENTENCE_HINT_RE / _VERB_END_TRIGGER_RE : 동사·형용사 어미
  //   공백 포함 + length >= 5 : "긴장 유지" 같은 multi-word
  const hasSpace = /\s/.test(trimmed);
  const isComplex =
    trimmed.length > 15 ||
    SENTENCE_HINT_RE.test(trimmed) ||
    _VERB_END_TRIGGER_RE.test(trimmed) ||
    (hasSpace && trimmed.length >= 5);
  if (!isComplex) return trimmed;
  return shortenEmotionalLabel(trimmed);
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
