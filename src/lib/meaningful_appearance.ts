/**
 * src/lib/meaningful_appearance.ts — R5B-1.8D Meaningful Appearance Guard
 *
 * 인물 이름이 본문에 등장한 횟수만으로 판단하던 기존 absent_in_body guard의 한계를
 * 해소하기 위한 deterministic detector.
 *
 * 핵심 원칙:
 *   "의미 있는 등장" = 그 인물이 현재 장면에서 직접 행위자/반응 주체로 기능하는 경우.
 *   단순 호명, 회상 속 언급, 다른 인물 대사 안의 이름은 의미 있는 등장이 아님.
 *
 * 운영 계층:
 *   - level "strong"  → 직접 대사/행동/결정 (state update 허용)
 *   - level "medium"  → 주체로 등장 + 감정/상태/소지품 상호작용 (state update 허용)
 *   - level "weak"    → 다른 인물 대사 안의 이름, 회상, 단순 호명 (state update 금지)
 *   - level "none"    → 본문에 없음
 *
 * 본 detector는 한국어 일반 패턴(주격조사 + 술어 형태)으로 동작하며,
 * 특정 인물/책/장르에 의존하는 하드코딩은 포함하지 않는다.
 *
 * critical-path 사용을 가정해 LLM 호출 없이 순수 deterministic하게 처리한다.
 */

export type EvidenceLevel = "strong" | "medium" | "weak" | "none";

export interface AppearanceEvidence {
  level: EvidenceLevel;
  occurrence_count: number;       // 본문에 이름이 substring으로 매칭된 총 횟수
  strong_count: number;           // 직접 대사/행동 형태로 분류된 occurrence
  medium_count: number;           // 주체로 등장하지만 약한 형태
  weak_count: number;             // 대사 안 / 단순 언급
  evidence_types: string[];       // ["dialogue_attribution","direct_action","subject_with_state","inside_dialogue","mention"] 등 unique
  reason: string;                 // 한 줄 사유
}

/**
 * inQuoteMap — body의 각 문자 인덱스가 dialogue 안인지 outside인지 구간 표시.
 * 한국어 소설에서 자주 쓰이는 quote 표기:
 *   "..."  ‘...’  '...'  「...」  『...』
 * 짝 매칭은 단순 토글로 처리. 짝이 안 맞으면 마지막 열린 구간은 "닫지 않은 채" 끝낸다.
 */
function buildInQuoteMap(body: string): Uint8Array {
  const N = body.length;
  const map = new Uint8Array(N);
  if (N === 0) return map;

  // 토글형(같은 문자가 열고 닫음): " ' "‘"’"
  // 비대칭(열기/닫기 다름):           「 ↔ 」, 『 ↔ 』, “ ↔ ”, ‘ ↔ ’
  // 단순화: 좌·우가 다른 quote는 left → +1 depth, right → -1 depth
  // 토글형은 짝 토글
  const toggleChars = new Set(["\"", "'"]);
  const leftRightPairs: Record<string, string> = { "「": "」", "『": "』", "“": "”", "‘": "’" };
  const rightChars = new Set(Object.values(leftRightPairs));
  const leftChars = new Set(Object.keys(leftRightPairs));

  let toggleQuote: string | null = null; // 현재 열린 토글형 quote
  let bracketDepth = 0;                  // 비대칭 quote 중첩 깊이

  for (let i = 0; i < N; i++) {
    const ch = body[i]!;
    const inAny = toggleQuote !== null || bracketDepth > 0;
    map[i] = inAny ? 1 : 0;
    if (toggleQuote !== null) {
      if (ch === toggleQuote) toggleQuote = null;
      continue;
    }
    if (toggleChars.has(ch)) {
      toggleQuote = ch;
      continue;
    }
    if (leftChars.has(ch)) {
      bracketDepth++;
      continue;
    }
    if (rightChars.has(ch) && bracketDepth > 0) {
      bracketDepth--;
      continue;
    }
  }
  return map;
}

/**
 * Korean dialogue attribution verbs (말했다/외쳤다/중얼/속삭/대답/...) - 어간만 매칭.
 * 인물 + 주격조사 + (조사/짧은 부사) + 이 어간들 → strong (대사 화자 표시).
 * 어간 형태는 다양하므로 충분히 포괄적으로 잡는다 (false negative 회피).
 */
const DIALOGUE_VERB_STEMS = [
  "말했", "말하", "말한", "말씀",
  "외쳤", "외치", "외친",
  "소리쳤", "소리치", "소리내",
  "속삭였", "속삭이", "속삭임",
  "중얼거렸", "중얼거리", "중얼",
  "대답했", "대답하", "답했", "답하", "답함",
  "물었", "묻었", "묻", "물었다",
  "투덜거렸", "투덜",
  "읊조렸", "읊조리",
  "되뇌었", "되뇌이",
  "털어놓", "뱉었", "뱉어",
  "운을", "입을 열", "입을 떼",
  "덧붙였", "덧붙이",
  "내뱉", "내뱉었",
  "한숨을", "한숨 쉬",
  "얼버무렸", "얼버무리",
];

/**
 * Korean direct-action verbs (어간만). 행동/이동/상호작용/결정 동사군.
 * 매우 광범위해서 false positive가 일부 있음 — but 그건 "appeared+actor" 인정이므로 허용.
 * 진짜 weak only(대사 속 이름) 케이스를 막는 것이 1차 목표.
 */
const ACTION_VERB_STEMS = [
  // 이동
  "걸었", "걸어", "걸었다", "달렸", "달리", "달려", "뛰었", "뛰어", "뛰", "움직였", "움직이",
  "향했", "향하", "걸음", "발을", "들어왔", "들어와", "들어섰", "들어가", "나섰", "나가",
  "올라", "내려", "다가", "다가갔", "다가왔", "물러", "물러섰", "물러났",
  // 응시/지각
  "보았", "봤", "바라보", "쳐다보", "응시", "노려", "살펴", "둘러보", "마주",
  // 신체/표정
  "고개를", "고개가", "어깨를", "손을", "팔을", "눈을", "입을", "고개", "한숨",
  "끄덕였", "끄덕이", "흔들었", "흔들었다", "기울였", "기울이",
  // 손/소지품
  "잡았", "잡아", "쥐었", "쥐고", "쥔", "들었", "들고", "들어올렸", "꺼냈", "꺼내",
  "건넸", "건네", "받았", "받아", "넘겼", "넘기", "전했", "전해",
  "뽑았", "뽑아", "휘둘렀", "휘둘러", "휘두르",
  "내려놓", "올려놓", "놓았", "놓고", "찼", "차서", "찼다",
  "던졌", "던져", "던지",
  // 결정/판단/의지
  "결심했", "결심하", "결정했", "결정하", "결단", "선택했", "선택하", "택했",
  "다짐했", "다짐하", "마음먹", "마음을 먹",
  // 공격/방어
  "베었", "베어", "벴", "찔렀", "찔러", "찌르",
  "막았", "막아", "쳤", "쳐", "쳤다", "후렸", "후리",
  // 감정 행동 (외부적)
  "웃었", "웃어", "미소를", "찌푸렸", "찌푸리", "표정이", "표정을", "얼굴이", "얼굴을",
  "울었", "울어", "흐느꼈", "흐느끼", "터뜨렸", "터뜨리",
  // 사고/내적행동(주체로 인정)
  "생각했", "생각하", "느꼈", "느끼", "깨달았", "깨닫", "알았", "알아", "알게",
  "기억했", "기억하", "떠올렸", "떠올리",
  // 발언 보조 (대사 직접 인용 없는 발화)
  "말을", "말로", "말이", "이야기했", "이야기하",
  // 자세/행위
  "서 있", "섰다", "앉았", "앉아", "일어섰", "일어나", "누웠", "누워",
];

/**
 * Korean particles that mark the noun as subject/topic (주체).
 * "이름은", "이름이", "이름가" (희박), "이름는" (희박).
 */
const SUBJECT_PARTICLES = ["은", "는", "이", "가"];

/**
 * Particles for medium evidence — 인물이 상호작용/소유 대상으로 등장.
 *   "이름의", "이름에게", "이름한테", "이름과", "이름와", "이름도"
 */
const INTERACTION_PARTICLES = ["의", "에게", "한테", "과", "와", "도", "을", "를", "이", "에게서"];

/**
 * Find sentence boundaries near a position. 한국어 소설 기준:
 *   . ! ? \n 또는 닫는 quote 직후 newline.
 * 본 함수는 보수적으로 ±200자 내에서 boundary를 찾고, 못 찾으면 그 한계를 사용.
 */
function findSentenceWindow(body: string, pos: number, name: string): { start: number; end: number } {
  const MAX_BACK = 120;
  const MAX_FWD = 200;
  const lo = Math.max(0, pos - MAX_BACK);
  const hi = Math.min(body.length, pos + name.length + MAX_FWD);

  let start = lo;
  for (let i = pos - 1; i >= lo; i--) {
    const ch = body[i];
    if (ch === "\n" || ch === "." || ch === "!" || ch === "?" || ch === "”" || ch === "」" || ch === "』") {
      start = i + 1;
      break;
    }
  }
  let end = hi;
  for (let i = pos + name.length; i < hi; i++) {
    const ch = body[i];
    if (ch === "\n" || ch === "." || ch === "!" || ch === "?") {
      end = i + 1;
      break;
    }
  }
  return { start, end };
}

function startsWithAny(s: string, prefixes: string[]): string | null {
  for (const p of prefixes) {
    if (s.startsWith(p)) return p;
  }
  return null;
}

function containsAny(s: string, stems: string[]): string | null {
  for (const stem of stems) {
    if (s.includes(stem)) return stem;
  }
  return null;
}

/**
 * detectMeaningfulAppearance — 인물 이름의 의미 있는 등장 여부 분석.
 *
 * 분류 규칙:
 *  1. 이름이 본문에 한 번도 안 나옴            → none
 *  2. 모든 occurrence가 dialogue quote 안       → weak (인물이 다른 사람 대사 속 호명만 됨)
 *  3. 적어도 한 번이 narrative이고:
 *     a. 이름 직후 주격조사(은/는/이/가) + 30자 내 dialogue verb stem → strong (대사 화자)
 *     b. 이름 직후 주격조사 + 50자 내 action verb stem               → strong (직접 행동)
 *     c. 이름 직후 주격조사만 (술어 verb stem 미발견)                 → medium (주체 등장 + 행위 묘사 약함)
 *     d. 이름 직후 interaction particle (의/에게/한테/와/과/도/을/를) → medium
 *     e. 그 외 (조사 없는 단순 언급)                                  → weak
 *  4. 최종 level은 max(strong > medium > weak > none) 누적 결과.
 */
export function detectMeaningfulAppearance(body: string, name: string): AppearanceEvidence {
  const empty: AppearanceEvidence = {
    level: "none",
    occurrence_count: 0,
    strong_count: 0,
    medium_count: 0,
    weak_count: 0,
    evidence_types: [],
    reason: "본문에 이름 없음",
  };
  if (!body || !name) return empty;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "g");
  const matches: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    matches.push(m.index);
    if (re.lastIndex === m.index) re.lastIndex++; // safety for zero-width
  }
  if (matches.length === 0) return empty;

  const inQuote = buildInQuoteMap(body);
  const types = new Set<string>();
  let strongCount = 0;
  let mediumCount = 0;
  let weakCount = 0;

  for (const pos of matches) {
    const isInQuote = inQuote[pos] === 1;
    if (isInQuote) {
      types.add("inside_dialogue");
      weakCount++;
      continue;
    }

    // narrative occurrence
    const after = body.slice(pos + name.length, Math.min(pos + name.length + 60, body.length));
    const subjectParticle = startsWithAny(after, SUBJECT_PARTICLES);

    if (subjectParticle) {
      const tail = after.slice(subjectParticle.length, 60);
      const dialVerb = containsAny(tail, DIALOGUE_VERB_STEMS);
      if (dialVerb) {
        types.add("dialogue_attribution");
        strongCount++;
        continue;
      }
      const actionVerb = containsAny(tail, ACTION_VERB_STEMS);
      if (actionVerb) {
        types.add("direct_action");
        strongCount++;
        continue;
      }
      // 주격은 잡혔으나 술어 stem 미발견 — 주체로는 인정 (medium)
      types.add("subject_no_verb");
      mediumCount++;
      continue;
    }

    const interactionParticle = startsWithAny(after, INTERACTION_PARTICLES);
    if (interactionParticle) {
      // 인물이 상호작용/소유/대상으로 등장
      types.add("interaction_or_object");
      mediumCount++;
      continue;
    }

    // 조사도 없이 그냥 이름만 (호명, list, metadata) → weak
    types.add("bare_mention");
    weakCount++;
  }

  let level: EvidenceLevel;
  let reason: string;
  if (strongCount >= 1) {
    level = "strong";
    reason = `narrative 안 직접 행동/대사 ${strongCount}회 (occurrence ${matches.length})`;
  } else if (mediumCount >= 1) {
    level = "medium";
    reason = `narrative 안 주체/상호작용 ${mediumCount}회 (occurrence ${matches.length})`;
  } else if (weakCount >= 1) {
    level = "weak";
    reason = `대사 속 또는 단순 언급 ${weakCount}회 (occurrence ${matches.length})`;
  } else {
    level = "none";
    reason = "본문에 이름 없음";
  }

  return {
    level,
    occurrence_count: matches.length,
    strong_count: strongCount,
    medium_count: mediumCount,
    weak_count: weakCount,
    evidence_types: Array.from(types).sort(),
    reason,
  };
}

/**
 * isUpdateAllowed — pipeline guard 정책: strong/medium만 state update 허용.
 *   weak/none → carry-forward + visibility="absent".
 */
export function isUpdateAllowed(level: EvidenceLevel): boolean {
  return level === "strong" || level === "medium";
}
