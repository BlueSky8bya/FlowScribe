/**
 * src/lib/narrative_repetition_guard.ts — R5B-3.5 Narrative Cliché Runtime Guard
 *
 * 새로 생성된 본문이 최근 N화와 narrative 수준에서 과도하게 반복되는지 deterministic으로
 * 검출. discovery dedup(R5B-3)이 잡지 못한 prose-level cliché — 같은 동작 묘사 문장이
 * 화 사이에서 word-for-word 또는 high-similarity로 재등장 — 을 잡는다.
 *
 * 검사:
 *   1. exact_narrative_duplicate — 새 본문의 narrative sentence(quote 밖, 길이 ≥ 20자,
 *      TRIVIAL_RE skip)가 최근 N화 narrative sentence와 정확히 일치하는지.
 *   2. tail_similarity — 새 본문 tail 토큰 set이 직전 화 tail 토큰 set과 jaccard ≥ threshold.
 *   3. adjacent_full_similarity — 새 본문 전체 narrative 토큰이 직전 화 narrative 토큰과
 *      jaccard ≥ threshold (전반적 prose 반복 검출).
 *
 * 정책:
 *   - LLM 호출 없음. critical-path 안전.
 *   - 특정 단어/장르 하드코딩 없음 (TRIVIAL_RE는 일반 의례적 동작 한정).
 *   - severe 기준: exact_narrative_duplicate ≥ 1 OR adjacent_full_similarity ≥ 0.85
 *     OR closing_scene_similarity ≥ 0.65.
 */

import { extractClosingScene, jaccardSim } from "./discovery_signature.js";

export type NarrativeRepetitionVerdict = "PASS" | "WARN" | "RETRY";

export interface NarrativeRepetitionIssue {
  type: "exact_sentence" | "adjacent_full" | "closing_scene";
  episode_with: number;
  similarity?: number;
  sample_phrase?: string;
}

export interface NarrativeRepetitionResult {
  verdict: NarrativeRepetitionVerdict;
  max_similarity: number;
  exact_duplicate_count: number;
  closing_scene_similarity: number;
  adjacent_full_similarity: number;
  issues: NarrativeRepetitionIssue[];
}

export interface PriorEpisode {
  episode_number: number;
  content: string;
}

const _TRIVIAL_RE = /^[가-힣\s]{0,10}(고개를\s*끄덕|고개를\s*저|미소를\s*지|숨을\s*들이|숨을\s*내|숨을\s*삼|입술을\s*깨|눈을\s*감|손을\s*들|손을\s*내|어깨를|침묵이\s*내려)/;

const _OBJECT_KEYWORD_RE = /[가-힣]{2,5}/g;

/**
 * inQuoteMap (toggle 기반) — narrative sentence vs dialogue 분리.
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
 * extractNarrativeSentences — body에서 quote 밖 narrative 문장 추출.
 *   기준: 길이 ≥ 20자, TRIVIAL_RE 제외, 시작/끝 trim.
 *   sentence 경계: . ! ? \n
 */
export function extractNarrativeSentences(body: string): string[] {
  if (!body) return [];
  const inQuote = buildInQuoteMap(body);
  const sentences: string[] = [];
  let cur = "";
  let curIsNarrative = true;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    const inQ = inQuote[i] === 1;
    // narrative 안에서만 누적
    if (!inQ) {
      if (ch === "." || ch === "!" || ch === "?" || ch === "\n") {
        const s = cur.trim();
        if (curIsNarrative && s.length >= 20 && !_TRIVIAL_RE.test(s)) {
          sentences.push(s);
        }
        cur = "";
        curIsNarrative = true;
        continue;
      }
      cur += ch;
    } else {
      // dialogue 안 → narrative 누적 중단, 현재 누적은 mixed로 무효화
      curIsNarrative = false;
      cur += ch;
    }
  }
  // tail flush
  if (curIsNarrative) {
    const s = cur.trim();
    if (s.length >= 20 && !_TRIVIAL_RE.test(s)) sentences.push(s);
  }
  return sentences;
}

/**
 * extractNarrativeTokens — body 안 narrative 부분(quote 밖)만 토큰화.
 *   adjacent_full_similarity 계산용.
 */
export function extractNarrativeTokens(body: string): string[] {
  if (!body) return [];
  const inQuote = buildInQuoteMap(body);
  const narrative: string[] = [];
  let buf = "";
  for (let i = 0; i < body.length; i++) {
    if (inQuote[i] === 1) {
      if (buf) { narrative.push(buf); buf = ""; }
    } else {
      buf += body[i];
    }
  }
  if (buf) narrative.push(buf);
  const joined = narrative.join(" ");
  return joined.match(_OBJECT_KEYWORD_RE) ?? [];
}

/**
 * checkNarrativeRepetition — 새 본문이 최근 화와 narrative 수준에서 반복되는지 판정.
 *
 *   options:
 *     exactMinLen          (default 20)  exact match 최소 길이
 *     adjacentSimThreshold (default 0.85) adjacent 화 narrative jaccard severe
 *     closingSimThreshold  (default 0.65) closing scene jaccard severe (R5B-3 0.45보다 엄격)
 *     warnAdjacentSim      (default 0.65) WARN level
 */
export function checkNarrativeRepetition(
  newBody: string,
  recentEpisodes: PriorEpisode[],
  options: {
    exactMinLen?: number;
    adjacentSimThreshold?: number;
    closingSimThreshold?: number;
    warnAdjacentSim?: number;
  } = {},
): NarrativeRepetitionResult {
  const exactMinLen = options.exactMinLen ?? 20;
  const adjacentSimThreshold = options.adjacentSimThreshold ?? 0.85;
  const closingSimThreshold = options.closingSimThreshold ?? 0.65;
  const warnAdjacentSim = options.warnAdjacentSim ?? 0.65;

  const issues: NarrativeRepetitionIssue[] = [];
  let maxSim = 0;
  let exactDupCount = 0;

  const newSents = new Set(extractNarrativeSentences(newBody).filter(s => s.length >= exactMinLen));
  // 1. exact narrative duplicate (지능형 trivial filter 이미 적용)
  for (const prior of recentEpisodes) {
    const priorSents = extractNarrativeSentences(prior.content).filter(s => s.length >= exactMinLen);
    for (const ps of priorSents) {
      if (newSents.has(ps)) {
        exactDupCount++;
        issues.push({
          type: "exact_sentence",
          episode_with: prior.episode_number,
          sample_phrase: ps.slice(0, 80),
        });
      }
    }
  }

  // 2. adjacent full narrative similarity (직전 화 vs 새 본문)
  let adjacentFullSim = 0;
  if (recentEpisodes.length > 0) {
    const adjacent = recentEpisodes[recentEpisodes.length - 1]!;
    const newTokens = extractNarrativeTokens(newBody);
    const priorTokens = extractNarrativeTokens(adjacent.content);
    adjacentFullSim = jaccardSim(newTokens, priorTokens);
    if (adjacentFullSim >= adjacentSimThreshold) {
      issues.push({
        type: "adjacent_full",
        episode_with: adjacent.episode_number,
        similarity: adjacentFullSim,
      });
    } else if (adjacentFullSim >= warnAdjacentSim) {
      issues.push({
        type: "adjacent_full",
        episode_with: adjacent.episode_number,
        similarity: adjacentFullSim,
      });
    }
    if (adjacentFullSim > maxSim) maxSim = adjacentFullSim;
  }

  // 3. closing scene similarity (직전 화 tail vs 새 본문 tail)
  let closingSim = 0;
  if (recentEpisodes.length > 0) {
    const adjacent = recentEpisodes[recentEpisodes.length - 1]!;
    const newTail = extractClosingScene(newBody, 0, 300).tokens;
    const priorTail = extractClosingScene(adjacent.content, adjacent.episode_number, 300).tokens;
    closingSim = jaccardSim(newTail, priorTail);
    if (closingSim >= closingSimThreshold) {
      issues.push({
        type: "closing_scene",
        episode_with: adjacent.episode_number,
        similarity: closingSim,
      });
    }
    if (closingSim > maxSim) maxSim = closingSim;
  }

  // verdict
  let verdict: NarrativeRepetitionVerdict;
  if (exactDupCount >= 1
   || adjacentFullSim >= adjacentSimThreshold
   || closingSim >= closingSimThreshold) {
    verdict = "RETRY";
  } else if (adjacentFullSim >= warnAdjacentSim) {
    verdict = "WARN";
  } else {
    verdict = "PASS";
  }

  return {
    verdict,
    max_similarity: maxSim,
    exact_duplicate_count: exactDupCount,
    closing_scene_similarity: closingSim,
    adjacent_full_similarity: adjacentFullSim,
    issues,
  };
}

/**
 * RETRY_INSTRUCTION — renderer retry 시 system prompt에 추가할 instruction.
 *   사건 유지, 장면 기능 변경 가이드.
 */
export const RETRY_INSTRUCTION =
`[★ R5B-3.5 narrative 반복 회피 — 재생성]
방금 생성한 본문이 최근 화와 문장·장면·행동 묘사 수준에서 과도하게 유사하다.
사건의 흐름은 유지하되, 다음 중 _두 가지 이상_을 바꿔라:
- 인물의 행동 방식 (같은 동작·소품·도구의 재사용 금지)
- 대사 방향 (같은 다짐·질문·확인 cliché 재사용 금지)
- 장면 마무리 구조 (같은 ending pattern·closing dialogue·"새로운 여정"류 narrative 재사용 금지)
- 인물의 선택과 결정의 표현 방식
- 단서·정보에 대한 대응 방식 (재발견이 아닌 해석·추적·결과)
- 공간 활용 (같은 장소 안에서도 카메라·시점·동선 변경)
이미 사용한 narrative 문장·문단을 그대로 또는 거의 그대로 반복하지 마라.`;
