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
 * 여러 시도(>=2)에서 반복 등장한 plot pattern을 검출.
 * 단순한 토큰 기반 — 같은 비트 요약 키워드가 N회 이상 등장하면 패턴으로 등록.
 */
function _detectRecurringPatterns(plannerTraces: any[]): string[] {
  if (plannerTraces.length < 2) return [];

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

  for (const [loc, n] of locCount) {
    if (n >= 2) patterns.push(`첫 beat가 "${loc}"에서 시작되는 구성 (${n}회 반복)`);
  }
  for (const [hook, n] of hookCount) {
    if (n >= 2) patterns.push(`엔딩 훅이 "${hook}" 유형 (${n}회 반복)`);
  }
  for (const [combo, n] of charComboCount) {
    if (n >= 2) patterns.push(`첫 beat 인물 조합 "${combo}" (${n}회 반복)`);
  }

  return patterns;
}

/**
 * episode_number와 attempt_count 기반 must_vary_axes 자동 선택.
 * 더 많이 시도했을수록 더 많은 axis에서 분기 권고.
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
  // attempt 2-3: 3 axes
  // attempt 4+: 4 axes
  const minDivergent = attemptCount >= 4 ? 4 : attemptCount >= 2 ? 3 : 2;

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
  // 같은 회차의 모든 이전 시도 trace 조회 (최근 6건까지)
  const r = await pool.query(
    `SELECT planner_trace FROM run_traces
     WHERE book_id=$1 AND episode_number=$2 AND planner_trace IS NOT NULL
     ORDER BY created_at DESC LIMIT 6`,
    [bookId, episodeNumber]
  ).catch(() => ({ rows: [] as any[] }));

  const traces = (r.rows ?? []).map(row => row.planner_trace);
  if (!traces.length) {
    logInfo("regen_divergence", "이전 시도 없음 — contract 미생성", { book_id: bookId, episode: episodeNumber });
    return null;
  }

  // 가장 최근 trace에서 signature 추출
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
    attempt_count: traces.length,
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
