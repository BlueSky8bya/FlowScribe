/**
 * scripts/utils/dpo_utils.ts — DPO 파이프라인 공통 유틸
 *
 * 아래 3개 스크립트에서 중복 정의됐던 함수를 통합한다:
 *   - dpo_pair_collector_v2.ts
 *   - apply_filter_v3.ts
 *   - export_dpo_dataset_v3.ts
 *
 * Arc Phase 정의:
 *   progress_ratio = episode_number / resolved_final_episode 기반.
 *   절대 화수(회차) 기준이 아님 — resolved_final_episode가 책마다 다르기 때문.
 */

// ── 텍스트 품질 공통 상수/함수 ──────────────────────────────────

/** CJK / 전각 문자 패턴 — 한국어 소설에서 불허 */
export const FOREIGN_CHAR_PATTERN = /[一-鿿぀-ゟ゠-ヿ　-〿]/;

/** filter v3 임계값 — 변경 시 이 파일 한 곳만 수정 */
export const EE_MIN           = 0.45;   // episode_extended_score 하한
export const JU_MAX           = 0.75;   // judge_uncertainty 상한
export const PP_MAX           = 0.15;   // postprocess_dependency_penalty 상한
export const MIN_SCORE_DELTA  = 5;      // chosen-rejected score gap 최소값

export interface ItemEntry { name: string; condition?: string; }

export function normalizeItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const e = item as ItemEntry;
      return e.condition ? `${e.name} (${e.condition})` : e.name;
    }
    return String(item);
  });
}

export function detectForeignChars(text: string): boolean {
  return FOREIGN_CHAR_PATTERN.test(text);
}

export function detectTruncation(text: string): boolean {
  if (!text || text.length < 50) return true;
  const t = text.trim();
  if (/\[END\]$/.test(t) || /\[CLIFF\](\s*\[END\])?$/.test(t)) return false;
  return ![".", "!", "?", "。", "！", "？", '"', "'", "…", "」", "』"].includes(t.slice(-1));
}

/** 책 제목 → 시나리오 레이블 (export/bias analysis 공통) */
export function getScenario(title: string): string {
  if (title.includes("로맨스"))                                return "romance";
  if (title.includes("판타지"))                                return "fantasy";
  if (title.includes("SF") || title.includes("sf"))           return "sf_detective";
  if (title.includes("스릴러") || title.includes("범죄"))     return "thriller";
  return "unknown";
}

// ── Arc Phase — progress_ratio 기반 상대적 위치 ─────────────────

/**
 * DPO 분석용 arc phase.
 * src/training/types.ts의 ArcPhase("intro"|"rising"|"climax"|"resolution")와 다른 개념:
 * 그쪽은 trajectory window 기반, 이쪽은 progress_ratio 기반 서사 위치.
 */
export type DpoArcPhase = "intro" | "early" | "mid" | "late" | "pre_final" | "final" | "unknown";

/** distance_to_end 버킷 태그 */
export type DistanceTag = "final_1" | "final_2" | "final_3" | "final_5" | "far" | "unknown";

/**
 * progress_ratio = episode_number / resolved_final_episode 기반 arc phase.
 * resolved_final_episode가 null/0이면 "unknown".
 */
export function computeArcPhase(
  episodeNumber: number,
  resolvedFinalEpisode: number | null | undefined,
): DpoArcPhase {
  if (!resolvedFinalEpisode || resolvedFinalEpisode <= 0) return "unknown";
  const r = episodeNumber / resolvedFinalEpisode;
  if (r < 0.15) return "intro";
  if (r < 0.35) return "early";
  if (r < 0.65) return "mid";
  if (r < 0.85) return "late";
  if (r < 0.97) return "pre_final";
  return "final";
}

/**
 * distance_to_end = resolved_final_episode - episode_number.
 * resolved_final_episode가 null/0이면 null 반환.
 */
export function computeDistanceToEnd(
  episodeNumber: number,
  resolvedFinalEpisode: number | null | undefined,
): number | null {
  if (!resolvedFinalEpisode || resolvedFinalEpisode <= 0) return null;
  return resolvedFinalEpisode - episodeNumber;
}

/** distance_to_end 숫자 → 버킷 태그 */
export function distanceTag(distance: number | null): DistanceTag {
  if (distance === null) return "unknown";
  if (distance === 0)    return "final_1";
  if (distance === 1)    return "final_2";
  if (distance <= 2)     return "final_3";
  if (distance <= 4)     return "final_5";
  return "far";
}

/**
 * ending zone 판단 — collector --mode ending 기준.
 * progress_ratio >= minRatio 또는 distance_to_end <= maxDistance 중 하나라도 해당하면 ending zone.
 *
 * resolved_final_episode가 없으면 ending zone 판단 불가 → undefined 반환.
 * 호출자는 undefined 시 수집 대상에서 제외하거나 경고를 출력해야 한다.
 */
export function isEndingZone(
  episodeNumber: number,
  resolvedFinalEpisode: number | null | undefined,
  opts: { minProgressRatio?: number; maxDistanceToEnd?: number } = {},
): boolean | undefined {
  if (!resolvedFinalEpisode || resolvedFinalEpisode <= 0) return undefined;
  const { minProgressRatio = 0.85, maxDistanceToEnd = 4 } = opts;
  const r = episodeNumber / resolvedFinalEpisode;
  const d = resolvedFinalEpisode - episodeNumber;
  return r >= minProgressRatio || d <= maxDistanceToEnd;
}

// ── 분포 카운터 헬퍼 ────────────────────────────────────────────

export function inc<K extends string>(map: Record<string, number>, key: K | string): void {
  map[key] = (map[key] ?? 0) + 1;
}

/** 카운터 맵을 내림차순 정렬 후 출력 */
export function printDist(label: string, map: Record<string, number>): void {
  console.log(`\n[${label}]`);
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) {
    console.log(`  ${k}: ${v}`);
  }
}

/** 2-axis cross table 출력 */
export function printCrossTable(
  label: string,
  data: Record<string, Record<string, number>>,
  colKeys: string[],
): void {
  console.log(`\n[${label}]`);
  const header = ["scenario".padEnd(16), ...colKeys.map(k => k.padStart(9))].join(" ");
  console.log("  " + header);
  for (const [scenario, cols] of Object.entries(data)) {
    const row = [scenario.padEnd(16), ...colKeys.map(k => String(cols[k] ?? 0).padStart(9))].join(" ");
    console.log("  " + row);
  }
}
