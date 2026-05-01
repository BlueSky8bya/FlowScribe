/**
 * src/lib/discovery_signature.ts — R5B-3 Duplicate Discovery Dedup
 *
 * 같은 단서/흔적/사건이 후속 화에서 다시 "처음 발견"되지 않도록 하는
 * deterministic discovery event signature 추출 + similarity check.
 *
 * 본 모듈은 두 가지를 제공한다:
 *   1. extractDiscoveryEvents(body) — 본문에서 narrative 발견 사건 시그니처 추출.
 *   2. extractClosingScene(body)    — episode 마지막 N자 (closing scene) 추출.
 *   3. similarity 비교 함수.
 *
 * 정책:
 *   - 발견(찾아냄/감지/확인됨) narrative만 잡는다. 일반 다짐 dialogue("찾아야 해")는 제외.
 *   - quote 안에 있는 dialogue는 발견 사건이 아니다. narrative 외부에서만 잡는다.
 *   - 특정 단어(마력/흔적/잔재)에 의존하지 않고 일반 패턴(주체 + "발견"/"확인"/"감지" 동사 + object)으로 처리.
 *   - LLM 호출 없음, critical path 안전.
 */

export interface DiscoveryEvent {
  episode: number;
  raw_phrase: string;        // 매치된 narrative 구절
  tokens: string[];          // 정규화된 키워드 토큰 (한글 2~5자)
}

export interface ClosingScene {
  episode: number;
  tail_text: string;         // 본문 마지막 N자
  tokens: string[];          // 정규화된 키워드 토큰
}

// 발견·관찰 narrative 패턴 (외부 narrative).
// 매치 조건:
//   - quote 밖
//   - "발견했다 / 찾아냈다 / 감지했다 / 확인했다 / 알아챘다 / 눈치챘다 / 보았다 / 마주쳤다" 어간을 포함
//   - 그 앞 30자 안에 명사구가 있어야 함 (주체+object 구성)
// "찾아야"/"남았어"/"확인해야" 같은 의지/명령형 어미는 발견 사건 아님 (제외).
const DISCOVERY_VERB_STEMS = [
  "발견했", "발견됐", "발견된", "발견하",
  "찾아냈", "찾아내",
  "감지됐", "감지했", "감지된",
  "확인됐", "확인된", "확인했",
  "알아챘", "알아챈",
  "눈치챘", "눈치챈",
  "마주쳤", "마주친",
];

const _OBJECT_KEYWORD_RE = /[가-힣]{2,5}/g;

/**
 * inQuoteMap (간단 toggle 기반) — discovery_signature 단독용.
 * 한글 소설 quote 짝 처리. dialogue 안에 발견 사건 표현은 제외용.
 */
function buildInQuoteMap(body: string): Uint8Array {
  const N = body.length;
  const map = new Uint8Array(N);
  if (N === 0) return map;
  const toggleChars = new Set(["\"", "'"]);
  const leftRightPairs: Record<string, string> = { "「": "」", "『": "』", "“": "”", "‘": "’" };
  const leftChars = new Set(Object.keys(leftRightPairs));
  const rightChars = new Set(Object.values(leftRightPairs));
  let toggleQuote: string | null = null;
  let bracketDepth = 0;
  for (let i = 0; i < N; i++) {
    const ch = body[i]!;
    map[i] = (toggleQuote !== null || bracketDepth > 0) ? 1 : 0;
    if (toggleQuote !== null) {
      if (ch === toggleQuote) toggleQuote = null;
      continue;
    }
    if (toggleChars.has(ch)) { toggleQuote = ch; continue; }
    if (leftChars.has(ch))   { bracketDepth++;  continue; }
    if (rightChars.has(ch) && bracketDepth > 0) { bracketDepth--; continue; }
  }
  return map;
}

/**
 * extractDiscoveryEvents — 본문에서 외부 narrative 발견 사건 추출.
 *   동작: discovery verb stem이 narrative(quote 밖)에 등장하는 모든 위치를 잡고,
 *         그 주변 ±50자 phrase를 raw_phrase로 저장하면서 한글 2~5자 토큰을 추출.
 */
export function extractDiscoveryEvents(body: string, episode: number): DiscoveryEvent[] {
  if (!body) return [];
  const inQuote = buildInQuoteMap(body);
  const events: DiscoveryEvent[] = [];
  for (const stem of DISCOVERY_VERB_STEMS) {
    let pos = 0;
    while (pos < body.length) {
      const idx = body.indexOf(stem, pos);
      if (idx < 0) break;
      pos = idx + stem.length;
      if (inQuote[idx] === 1) continue; // quote 안 → skip

      // sentence boundary 안에서만 phrase capture — 다음 dialogue 포함 방지
      let sentStart = Math.max(0, idx - 50);
      for (let i = idx - 1; i >= sentStart; i--) {
        const c = body[i];
        if (c === "." || c === "!" || c === "?" || c === "\n" ||
            c === "”" || c === "」" || c === "』") {
          sentStart = i + 1; break;
        }
      }
      let sentEnd = Math.min(body.length, idx + stem.length + 20);
      for (let i = idx + stem.length; i < sentEnd; i++) {
        const c = body[i];
        if (c === "." || c === "!" || c === "?" || c === "\n") {
          sentEnd = i; break;
        }
      }
      const phrase = body.slice(sentStart, sentEnd).trim();
      if (!phrase) continue;
      const tokens = (phrase.match(_OBJECT_KEYWORD_RE) ?? []);
      events.push({ episode, raw_phrase: phrase, tokens });
    }
  }
  return events;
}

/**
 * extractClosingScene — episode 본문 마지막 N자 추출 + 키워드 토큰화.
 *   기본 N=300 — closing dialogue + 마지막 narrative 묶음을 잡기에 충분.
 */
export function extractClosingScene(body: string, episode: number, tailChars = 300): ClosingScene {
  const tail = (body ?? "").slice(-tailChars);
  const tokens = (tail.match(_OBJECT_KEYWORD_RE) ?? []);
  return { episode, tail_text: tail, tokens };
}

/**
 * jaccard — 두 token 집합의 set similarity.
 *   set 기반이므로 순서/반복 영향 없음. 0~1.
 */
export function jaccardSim(a: string[] | Set<string>, b: string[] | Set<string>): number {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const k of A) if (B.has(k)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * isDiscoveryDuplicate — 새 event가 기존 event 목록과 sim ≥ threshold 이고
 *   episode 간격 ≤ window면 중복으로 판정.
 *
 *   threshold=0.6, window=5는 audit script 기존 정책과 일치.
 */
export function isDiscoveryDuplicate(
  newEvent: DiscoveryEvent,
  priorEvents: DiscoveryEvent[],
  options: { threshold?: number; window?: number } = {},
): { duplicate: boolean; matched?: DiscoveryEvent; sim?: number } {
  const threshold = options.threshold ?? 0.6;
  const window = options.window ?? 5;
  let best = { duplicate: false } as { duplicate: boolean; matched?: DiscoveryEvent; sim?: number };
  let bestSim = 0;
  for (const prev of priorEvents) {
    if (Math.abs(newEvent.episode - prev.episode) > window) continue;
    const sim = jaccardSim(newEvent.tokens, prev.tokens);
    if (sim >= threshold && sim > bestSim) {
      bestSim = sim;
      best = { duplicate: true, matched: prev, sim };
    }
  }
  return best;
}

/**
 * isClosingSceneSimilar — 직전 화 closing scene과 현재 화 closing scene이
 *   sim ≥ threshold면 scene repetition으로 판정.
 *   기본 threshold=0.45 (한국어 narrative + dialogue mix 특성상 적정).
 */
export function isClosingSceneSimilar(
  current: ClosingScene,
  prior: ClosingScene | undefined,
  options: { threshold?: number } = {},
): { similar: boolean; sim: number } {
  if (!prior) return { similar: false, sim: 0 };
  const threshold = options.threshold ?? 0.45;
  const sim = jaccardSim(current.tokens, prior.tokens);
  return { similar: sim >= threshold, sim };
}
