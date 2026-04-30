/**
 * regen_divergence.ts — Phase 4.18 재생성 분기 계약 빌더
 *
 * 역할:
 *   같은 회차의 이전 생성 시도들을 짧은 signature로 압축하고,
 *   planner에게 어느 axis에서 분기해야 하는지 구조적으로 안내한다.
 *
 * 핵심 원칙:
 *   - 이전 시도의 본문/긴 beat 텍스트를 prompt에 다시 노출하지 않는다 (anchoring 방지).
 *   - must_vary_axes 가운데 attempt_count에 따라 hint_min_divergent_axes 자동 조정.
 *   - 하드코딩된 금지어 추가 금지. 구조적 axis 명세만 제공.
 *   - N+1 이후 문맥은 절대 포함하지 않는다 (재생성 = 최신화 한정).
 */

import { pool } from "../lib/db.js";
import { logInfo, logWarn } from "../lib/logger.js";
import type {
  RegenerationDivergenceContract,
  GenerationMode,
} from "../types/canonical.js";

// ── 짧은 라벨 추출 헬퍼 ──────────────────────────────────────
function _trimLabel(s: string | null | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const t = String(s).trim().replace(/\s+/g, " ");
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/**
 * 가장 최근 시도(N_old)의 planner_trace에서 plot signature를 추출.
 * 본문 전문이 아니라 짧은 라벨로만 압축한다.
 */
function _signatureFromPlannerTrace(plannerTrace: any): RegenerationDivergenceContract["old_episode_signature"] {
  const sig: RegenerationDivergenceContract["old_episode_signature"] = {};
  const pp = plannerTrace?.parsed_plan;
  if (!pp) return sig;

  const beats: Array<{ beat_number?: number; summary?: string; location?: string }> =
    Array.isArray(pp.scene_beats) ? pp.scene_beats : [];

  if (beats.length) {
    const sortedBeats = [...beats].sort((a, b) => (a.beat_number ?? 0) - (b.beat_number ?? 0));
    sig.opening_location = _trimLabel(sortedBeats[0]?.location, 30);
    sig.opening_image = _trimLabel(sortedBeats[0]?.summary, 50);
    if (sortedBeats[1]?.summary || sortedBeats[0]?.summary) {
      sig.first_conflict = _trimLabel(sortedBeats[1]?.summary ?? sortedBeats[0]?.summary, 50);
    }
    sig.main_event_path = sortedBeats
      .map(b => _trimLabel(b.summary, 50))
      .filter((s): s is string => !!s);
  }

  if (pp.hook_type) sig.ending_hook_type = String(pp.hook_type);
  if (pp.hook_concrete_event) sig.ending_hook_image = _trimLabel(pp.hook_concrete_event, 50);

  // 감정 흐름: character_state_updates 첫 두 개의 emotional_state 한 줄로 결합
  const csu: Array<{ character_name?: string; emotional_state?: string }> =
    Array.isArray(pp.character_state_updates) ? pp.character_state_updates : [];
  if (csu.length) {
    const parts = csu.slice(0, 3)
      .map(c => c.character_name && c.emotional_state ? `${c.character_name}=${_trimLabel(c.emotional_state, 20)}` : null)
      .filter((s): s is string => !!s);
    if (parts.length) sig.emotional_pattern = parts.join(", ");
  }

  return sig;
}

/**
 * 여러 시도(>=3)에서 반복 등장한 plot pattern을 검출.
 *
 * Phase 4.20 R5A-C — Fix A:
 *   threshold 2 → 3 으로 상향. ep1 도입부의 자연스러운 hook이 우연히 2회 등장하는 것을
 *   바로 hard 금지 패턴으로 등록하지 않는다.
 *
 *   호출 측에서 usable trace만 필터링한 뒤 전달하는 것을 권장 (PASS 또는 score>=60 WARN).
 */
function _detectRecurringPatterns(plannerTraces: any[]): string[] {
  if (plannerTraces.length < 3) return [];

  const patterns: string[] = [];

  // 1. 반복 location
  const locCount = new Map<string, number>();
  // 2. 반복 hook_type
  const hookCount = new Map<string, number>();
  // 3. 반복 첫 인물 조합
  const charComboCount = new Map<string, number>();

  for (const pt of plannerTraces) {
    const pp = pt?.parsed_plan;
    if (!pp) continue;
    const beats: Array<{ location?: string; characters_involved?: string[] }> =
      Array.isArray(pp.scene_beats) ? pp.scene_beats : [];
    if (beats[0]?.location) {
      const loc = String(beats[0].location).trim();
      if (loc) locCount.set(loc, (locCount.get(loc) ?? 0) + 1);
    }
    if (pp.hook_type) {
      hookCount.set(pp.hook_type, (hookCount.get(pp.hook_type) ?? 0) + 1);
    }
    const beat1Chars = Array.isArray(beats[0]?.characters_involved)
      ? [...beats[0]!.characters_involved!].sort().join("+")
      : "";
    if (beat1Chars) charComboCount.set(beat1Chars, (charComboCount.get(beat1Chars) ?? 0) + 1);
  }

  // Phase 4.20 R5A-C — Fix A: threshold 3 (이전 2). Fix E: 정확한 횟수 노출 안 함.
  for (const [loc, n] of locCount) {
    if (n >= 3) patterns.push(`첫 beat 시작 위치 "${loc}" 패턴이 자주 반복됨`);
  }
  for (const [hook, n] of hookCount) {
    if (n >= 3) patterns.push(`엔딩 훅 "${hook}" 유형이 자주 반복됨`);
  }
  for (const [combo, n] of charComboCount) {
    if (n >= 3) patterns.push(`첫 beat 인물 조합 "${combo}" 패턴이 자주 반복됨`);
  }

  return patterns;
}

/**
 * Phase 4.20 R5A-C — usable trace만 골라낸다.
 * - PASS verdict: 항상 포함
 * - WARN verdict + final_score >= 60: 포함
 * - FAIL / score < 60 / fallback_used / foreign contamination: 제외
 *
 * trace shape: { final_verdict, final_score, planner_trace.fallback_used,
 *                renderer_trace.generated_text } — DB 컬럼 + JSONB 키.
 */
// Phase 4.20 R5A-C — Unicode escape로 명확히 정의 (literal char range는 인코딩에 따라 false positive 가능).
//   Cyrillic       U+0400-04FF
//   Hebrew         U+0590-05FF
//   Arabic         U+0600-06FF
//   Thai           U+0E00-0E7F
//   Devanagari     U+0900-097F
//   Hiragana+Kata  U+3040-30FF
//   CJK Ext A      U+3400-4DBF
//   CJK Unified    U+4E00-9FFF
//   CJK Compat Ideo U+F900-FAFF
//   Vietnamese     U+1EA0-1EF9 (Latin Extended Additional 발음구별기호)
const _NON_KO_SCRIPT_PROBE_RE = /[Ѐ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿Ạ-ỹ぀-ヿ㐀-䶿一-鿿豈-﫿]/;
function _isUsableTrace(row: any): { usable: boolean; reason: string } {
  const verdict = row?.final_verdict;
  const score = row?.final_score ?? 0;
  if (verdict === "FAIL") return { usable: false, reason: "FAIL" };
  if (verdict === "WARN" && score < 60) return { usable: false, reason: "WARN_low_score" };
  if (row?.planner_trace?.fallback_used === true) return { usable: false, reason: "fallback" };
  // foreign contamination 빠른 검출 — generated_text 첫 1.5K char 안에 비한글 비라틴 스크립트 또는
  // 베트남 발음구별기호 (ạ-ỹ)가 나타나면 OOD로 간주.
  const sampleText = String(row?.renderer_trace?.generated_text ?? "").slice(0, 1500);
  if (sampleText && _NON_KO_SCRIPT_PROBE_RE.test(sampleText)) {
    return { usable: false, reason: "foreign_contamination" };
  }
  return { usable: true, reason: "ok" };
}

/**
 * episode_number와 attempt_count 기반 must_vary_axes 자동 선택.
 *
 * Phase 4.20 R5A-C — Fix C: minDivergent cap 4 → 3.
 * 4 axes hard constraint는 coherent space를 과도하게 좁힘. 3 axes를 cap으로 한다.
 */
function _pickAxes(attemptCount: number): {
  axes: RegenerationDivergenceContract["must_vary_axes"];
  minDivergent: number;
} {
  const baseAxes: RegenerationDivergenceContract["must_vary_axes"] = [
    "opening_location",
    "opening_image",
    "first_conflict",
    "main_event_path",
    "information_reveal_order",
    "character_choice",
    "relationship_interaction",
    "item_usage",
    "threat_entry",
    "ending_hook",
    "emotional_route",
  ];

  // attempt 1 (최초 재생성): 2 axes 권고
  // attempt 2+: 3 axes (cap)
  const minDivergent = attemptCount >= 2 ? 3 : 2;

  return { axes: baseAxes, minDivergent };
}

/**
 * 메인: 재생성 시 contract를 빌드.
 * @param bookId
 * @param episodeNumber 재생성 대상 화 번호
 * @param mode "episode1_regeneration" | "latest_episode_regeneration"
 * @returns contract — 이전 시도가 1건이라도 있어야 의미있음. 없으면 null.
 */
export async function buildRegenDivergenceContract(
  bookId: string,
  episodeNumber: number,
  mode: "episode1_regeneration" | "latest_episode_regeneration"
): Promise<RegenerationDivergenceContract | null> {
  // 같은 회차의 모든 이전 시도 trace 조회 (최근 12건 — usable filter 후 6건 cap).
  // Phase 4.20 R5A-C — Fix B: usable trace만 contract 입력에 사용.
  // SELECT 시 verdict + score + planner_trace.fallback_used + renderer_trace.generated_text 검증 데이터 포함.
  const r = await pool.query(
    `SELECT final_verdict, final_score, planner_trace, renderer_trace
     FROM run_traces
     WHERE book_id=$1 AND episode_number=$2 AND planner_trace IS NOT NULL
     ORDER BY created_at DESC LIMIT 12`,
    [bookId, episodeNumber]
  ).catch(() => ({ rows: [] as any[] }));

  const allRows = (r.rows ?? []) as any[];
  if (!allRows.length) {
    logInfo("regen_divergence", "이전 시도 없음 — contract 미생성", { book_id: bookId, episode: episodeNumber });
    return null;
  }

  // usable filter — FAIL/score<60/fallback/foreign contamination 제외.
  const filterStats = { FAIL: 0, WARN_low_score: 0, fallback: 0, foreign_contamination: 0, ok: 0 };
  const usableRows = allRows.filter(row => {
    const { usable, reason } = _isUsableTrace(row);
    filterStats[reason as keyof typeof filterStats] = (filterStats[reason as keyof typeof filterStats] ?? 0) + 1;
    return usable;
  });
  // 최근 6 usable trace만 사용 (window cap).
  const cappedRows = usableRows.slice(0, 6);
  const traces = cappedRows.map(row => row.planner_trace);

  // usable이 아예 없는 경우: 첫 재생성처럼 최소 contract만 출력 (이전 signature 없음, recurring 없음, axes 2 권고).
  if (!traces.length) {
    logInfo("regen_divergence", "usable trace 없음 — soft contract", {
      book_id: bookId, episode: episodeNumber, total: allRows.length, filter_stats: filterStats,
    });
    const { axes, minDivergent } = _pickAxes(1);
    const mustPreserve: string[] = [
      "세계관 규칙",
      "canonical 인물 정체성",
      "초기 핵심 소지품 정체성",
    ];
    if (mode === "latest_episode_regeneration" && episodeNumber > 1) {
      mustPreserve.push(
        `${episodeNumber - 1}화까지 확정된 사건/관계/감정`,
        "열린 복선과 장기 아크 방향",
        "직전 화 종료 시점 인물 위치/소지품",
      );
    }
    return {
      mode,
      episode_number: episodeNumber,
      attempt_count: 1,
      old_episode_signature: {},
      recurring_patterns: [],
      must_preserve: mustPreserve,
      must_vary_axes: axes,
      hint_min_divergent_axes: minDivergent,
    };
  }

  // 가장 최근 usable trace에서 signature 추출
  const latestSig = _signatureFromPlannerTrace(traces[0]);
  const recurring = _detectRecurringPatterns(traces);
  const { axes, minDivergent } = _pickAxes(traces.length);

  const mustPreserve: string[] = [
    "세계관 규칙",
    "canonical 인물 정체성",
    "초기 핵심 소지품 정체성",
  ];
  if (mode === "latest_episode_regeneration" && episodeNumber > 1) {
    mustPreserve.push(
      `${episodeNumber - 1}화까지 확정된 사건/관계/감정`,
      "열린 복선과 장기 아크 방향",
      "직전 화 종료 시점 인물 위치/소지품"
    );
  }

  const contract: RegenerationDivergenceContract = {
    mode,
    episode_number: episodeNumber,
    attempt_count: traces.length,
    old_episode_signature: latestSig,
    recurring_patterns: recurring,
    must_preserve: mustPreserve,
    must_vary_axes: axes,
    hint_min_divergent_axes: minDivergent,
  };

  logInfo("regen_divergence", "contract 생성", {
    book_id: bookId,
    episode: episodeNumber,
    mode,
    total_traces: allRows.length,
    usable_traces: usableRows.length,
    used_in_contract: traces.length,
    filter_stats: filterStats,
    recurring_patterns: recurring.length,
    min_divergent: minDivergent,
  });

  return contract;
}

/**
 * GenerationMode 자동 판정.
 *  - 같은 화의 이전 trace가 있고 ep === 1 → episode1_regeneration
 *  - 같은 화의 이전 trace가 있고 ep > 1 → latest_episode_regeneration
 *  - 없고 ep === 1 → new_episode_generation
 *  - 없고 ep > 1 → next_episode_generation
 */
export async function detectGenerationMode(
  bookId: string,
  episodeNumber: number
): Promise<GenerationMode> {
  const r = await pool.query(
    `SELECT 1 FROM run_traces WHERE book_id=$1 AND episode_number=$2 LIMIT 1`,
    [bookId, episodeNumber]
  ).catch(() => ({ rows: [] as any[] }));

  const hasPrev = (r.rows?.length ?? 0) > 0;
  if (hasPrev) {
    return episodeNumber === 1 ? "episode1_regeneration" : "latest_episode_regeneration";
  }
  return episodeNumber === 1 ? "new_episode_generation" : "next_episode_generation";
}
