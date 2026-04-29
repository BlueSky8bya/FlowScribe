/**
 * episode_delta_validator.ts — 에피소드 반복 패턴 감지기
 *
 * 생성된 본문이 delta contract에서 경고한 반복 패턴을 포함하는지
 * deterministic heuristic으로 확인한다. verdict는 WARN까지만 — FAIL로 생성 중단하지 않음.
 */

import type { EpisodeDeltaContract } from "../types/canonical.js";

export interface EpisodeDeltaCheckResult {
  verdict: "PASS" | "WARN";
  repeated_patterns: string[];
  missing_progress: string[];
  opening_similarity_score: number;
}

// 의식 상실·기절 등 반복 위험 패턴
const REPEAT_DETECT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /의식을?\s*(잃|잃어|상실)/, label: "의식 상실" },
  { re: /기절/, label: "기절" },
  { re: /쓰러|쓰러짐/, label: "쓰러짐" },
  { re: /혼란|혼돈|혼수/, label: "혼란/혼수" },
  { re: /처음\s*(만|발견|알게)/, label: "처음 만남/발견" },
  { re: /다시\s*(처음|새롭게|또\s*다시)/, label: "다시 처음" },
  { re: /또\s*(다시|한번)\s*같은/, label: "또 같은 상황" },
];

// n-gram 유사도 (간단 bigram overlap)
function bigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ngrams = (s: string) => {
    const chars = [...s.replace(/\s+/g, "")];
    const set = new Set<string>();
    for (let i = 0; i < chars.length - 1; i++) set.add(chars[i] + chars[i + 1]);
    return set;
  };
  const sa = ngrams(a);
  const sb = ngrams(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  return (2 * inter) / (sa.size + sb.size);
}

export function checkEpisodeDelta(
  generatedText: string,
  prevTail: string | undefined,
  contract: EpisodeDeltaContract | undefined,
): EpisodeDeltaCheckResult {
  const repeated_patterns: string[] = [];
  const missing_progress: string[] = [];

  // ── 1. 반복 위험 패턴이 계약에서 경고했는데 본문에도 나타나는지 ──
  if (contract) {
    const riskLabels = new Set(contract.repetition_risk.map(r => r.pattern));
    for (const { re, label } of REPEAT_DETECT_PATTERNS) {
      if (riskLabels.has(label) && re.test(generatedText)) {
        repeated_patterns.push(`[경고] '${label}' 패턴이 반복 위험 목록에 있었는데 이번 화 본문에도 감지됨`);
      }
    }
  } else {
    // contract 없어도 기본 패턴만 체크
    for (const { re, label } of REPEAT_DETECT_PATTERNS.slice(0, 4)) {
      if (re.test(generatedText)) {
        // contract 없으면 단순 감지만 (반복 위험 여부 불명확)
        // WARN 없음 — 기록만
      }
    }
  }

  // ── 2. must_progress 항목 중 본문에 흔적이 없는지 ───────────
  if (contract) {
    for (const prog of contract.must_progress.slice(0, 3)) {
      // 키워드 추출 (3자 이상 한글 단어)
      const kws = prog.match(/[가-힣]{3,}/g) ?? [];
      const found = kws.some(kw => generatedText.includes(kw));
      if (!found && kws.length >= 3) {
        missing_progress.push(`must_progress 항목의 핵심 키워드가 본문에서 감지되지 않음: "${prog.slice(0, 50)}"`);
      }
    }
  }

  // ── 3. 직전 화 tail과 이번 화 opening의 유사도 ───────────────
  const opening = generatedText.slice(0, 300);
  const opening_similarity_score = bigramSimilarity(prevTail?.slice(-200) ?? "", opening);

  // 유사도 0.4 이상이면 직전 화 장면을 거의 그대로 반복하는 것
  if (opening_similarity_score >= 0.4) {
    repeated_patterns.push(
      `[경고] 이번 화 첫 300자가 직전 화 말미와 bigram 유사도 ${(opening_similarity_score * 100).toFixed(0)}% — 같은 장면 반복 가능성`,
    );
  }

  // ── 4. 명시적 반복 지시어 과다 체크 ─────────────────────────
  const REPEAT_MARKERS = ["다시 처음", "처음으로 돌아", "여전히 같은", "또다시 같은", "또 한번 같은"];
  for (const marker of REPEAT_MARKERS) {
    if (generatedText.includes(marker)) {
      repeated_patterns.push(`[경고] 반복 지시어 감지: "${marker}"`);
    }
  }

  const verdict = repeated_patterns.length > 0 || missing_progress.length > 2 ? "WARN" : "PASS";

  return {
    verdict,
    repeated_patterns,
    missing_progress,
    opening_similarity_score,
  };
}
