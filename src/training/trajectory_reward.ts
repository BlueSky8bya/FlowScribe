/**
 * src/training/trajectory_reward.ts — N화 슬라이딩 윈도우 Trajectory Reward 계산기
 *
 * 핵심 원칙:
 * - LLM 호출 없음 (deterministic, DB 신호만 사용)
 * - 2화~10화 슬라이딩 윈도우 전수 계산
 * - "변화가 좋은 것"과 "안정이 좋은 것"을 항목별로 다르게 판단
 * - resolved_final_episode 기준으로 arc_phase 자동 태깅
 *
 * 사용:
 *   import { computeTrajectoryReward } from "./trajectory_reward.js";
 *   const reward = await computeTrajectoryReward(bookId, pool);
 */

import type { Pool } from "pg";
import type {
  TrajectoryReward,
  TrajectoryWindow,
  TrajectoryWindowScores,
  ArcPhase,
} from "./types.js";

// ── Episode snapshot (DB에서 조회한 per-episode 데이터) ────────────
interface EpisodeSnapshot {
  episode_number: number;
  trace_id: string;
  // character_dynamic_states 기반
  emotional_states: string[];  // 각 인물의 emotional_state
  locations: string[];
  items: string[][];           // 각 인물의 items (normalized)
  physical_states: string[];
  recent_goals: string[];
  // planner_trace.input_contract 기반
  foreshadow_count: number;
  remaining_episodes: number;
  episode_role: string;        // "intro" | "mid" | "late" | "pre-final" | "final"
  arc_summaries_count: number;
  has_rolling_summary: boolean;
  // prose_validation 기반
  quality_scores: Record<string, number>;
  final_score: number;
  final_verdict: string;
  // 책 전체 contract
  resolved_final: number;
}

// ── DB 조회 ──────────────────────────────────────────────────────
// B5: books 테이블에서 resolved_final_episode fallback 조회
async function getResolvedFinalFromBooks(bookId: string, pool: Pool): Promise<number> {
  try {
    const r = await pool.query(
      `SELECT context->>'resolved_final_episode' AS rf
       FROM books WHERE id = $1`,
      [bookId],
    );
    const val = parseInt(r.rows[0]?.rf ?? "0", 10);
    return isNaN(val) ? 0 : val;
  } catch {
    return 0;
  }
}

export async function loadEpisodeSnapshots(
  bookId: string,
  pool: Pool,
): Promise<EpisodeSnapshot[]> {
  // books 테이블에서 resolved_final 미리 조회 (planner_trace.input_contract.resolved_final = 0 대비)
  const resolvedFinalFallback = await getResolvedFinalFromBooks(bookId, pool);

  const r = await pool.query(
    `SELECT
       episode_number,
       trace_id::text,
       final_verdict,
       final_score,
       prose_validation->'quality_scores'                         AS quality_scores,
       planner_trace->'input_contract'->>'foreshadow_count'       AS foreshadow_count,
       planner_trace->'input_contract'->>'remaining_episodes'     AS remaining_episodes,
       planner_trace->'input_contract'->>'episode_role'           AS episode_role,
       planner_trace->'input_contract'->>'arc_summaries_count'    AS arc_summaries_count,
       planner_trace->'input_contract'->>'has_rolling_summary'    AS has_rolling_summary,
       planner_trace->'input_contract'->>'resolved_final'         AS resolved_final,
       effective_context_snapshot->'character_dynamic_states'     AS cds
     FROM run_traces
     WHERE book_id = $1 AND prose_validation IS NOT NULL
     ORDER BY episode_number ASC`,
    [bookId],
  );

  return r.rows.map((row): EpisodeSnapshot => {
    const cds: Record<string, any> = row.cds ?? {};
    const chars = Object.values(cds) as any[];

    const normalizeItems = (items: unknown[]): string[] =>
      items.map((i: any) =>
        typeof i === "string" ? i
        : i?.condition ? `${i.name} (${i.condition})` : i?.name ?? String(i),
      );

    return {
      episode_number:     row.episode_number,
      trace_id:           row.trace_id,
      final_verdict:      row.final_verdict ?? "WARN",
      final_score:        Number(row.final_score ?? 0),
      quality_scores:     row.quality_scores ?? {},
      foreshadow_count:   Number(row.foreshadow_count ?? 0),
      remaining_episodes: Number(row.remaining_episodes ?? 99),
      episode_role:       row.episode_role ?? "mid",
      arc_summaries_count:Number(row.arc_summaries_count ?? 0),
      has_rolling_summary:row.has_rolling_summary === "true",
      resolved_final:     Number(row.resolved_final ?? 0) || resolvedFinalFallback,
      emotional_states:   chars.map(c => c?.emotional_state ?? "").filter(Boolean),
      locations:          chars.map(c => c?.location ?? "").filter(Boolean),
      items:              chars.map(c => normalizeItems(Array.isArray(c?.items) ? c.items : [])),
      physical_states:    chars.map(c => c?.physical_state ?? "").filter(Boolean),
      recent_goals:       chars.map(c => c?.recent_goal ?? "").filter(Boolean),
    };
  });
}

// ── arc_phase 태깅 ──────────────────────────────────────────────
function tagArcPhase(ep: number, resolved: number): ArcPhase {
  if (resolved <= 0) return "mid" as unknown as ArcPhase;  // unknown final
  const ratio = ep / resolved;
  if (ratio <= 0.25) return "intro";
  if (ratio <= 0.60) return "rising";
  if (ratio <= 0.85) return "climax";
  return "resolution";
}

// ── 유틸: 문자열 배열 다양성 ────────────────────────────────────
function diversityRatio(arr: string[]): number {
  if (!arr.length) return 0;
  const unique = new Set(arr.map(s => s.trim().toLowerCase())).size;
  return unique / arr.length;
}

// 연속 중복 비율 (상태가 변하지 않는 패턴 탐지)
function staleRatio(arr: string[]): number {
  if (arr.length < 2) return 0;
  let same = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i].trim() === arr[i - 1].trim()) same++;
  }
  return same / (arr.length - 1);
}

// quality score 트렌드 (positive slope → 1, negative → 0)
function trendScore(scores: number[]): number {
  if (scores.length < 2) return 0.5;
  let up = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] >= scores[i - 1]) up++;
  }
  return up / (scores.length - 1);
}

// ── 윈도우 점수 계산 ───────────────────────────────────────────
function computeWindowScores(
  window: EpisodeSnapshot[],
  resolvedFinal: number,
): TrajectoryWindowScores {
  const isFinal = window[window.length - 1].episode_number >= resolvedFinal && resolvedFinal > 0;
  const midEp   = window[Math.floor(window.length / 2)].episode_number;
  const phase   = tagArcPhase(midEp, resolvedFinal);

  // 감정 변화 — 변화 있어야 좋음 (resolution phase 제외, 거기선 수렴이 좋음)
  const allEmotions = window.flatMap(ep => ep.emotional_states);
  const emotDiversity = diversityRatio(allEmotions);
  const emotStale    = staleRatio(window.flatMap(ep => [ep.emotional_states.join("|")]));
  const emotional_arc_consistency = phase === "resolution"
    ? 1 - emotStale * 0.5                          // resolution: 안정 수렴이 좋음
    : Math.max(0, Math.min(1, emotDiversity * 1.5 - emotStale)); // 그 외: 변화 있어야 좋음

  // 목표 진화 — 동일 목표 반복이면 감점
  const goals = window.map(ep => ep.recent_goals.join("|"));
  const goalStale = staleRatio(goals);
  const goal_evolution = Math.max(0, 1 - goalStale * 0.9);

  // 에스컬레이션 (plot_momentum 트렌드)
  const momentums = window.map(ep => (ep.quality_scores.plot_momentum ?? 70) / 100);
  const escalation_curve = trendScore(momentums);

  // 결말 수렴 (remaining_episodes 감소 + ending_hook 유지)
  const remainings = window.map(ep => ep.remaining_episodes);
  const remDecreasing = trendScore(remainings.map(r => -r));  // 감소가 좋음
  const hooks = window.map(ep => (ep.quality_scores.ending_hook ?? 60) / 100);
  const hookMean = hooks.reduce((s, v) => s + v, 0) / hooks.length;
  const ending_convergence = isFinal
    ? Math.min(1, remDecreasing * 0.5 + hookMean * 0.5)
    : remDecreasing * 0.4 + hookMean * 0.6;

  // 소지품 연속성 — 갑작스러운 소실/등장 감점
  const itemChanges = window.slice(1).map((ep, i) => {
    const prev = new Set(window[i].items.flat().map(s => s.toLowerCase()));
    const curr = new Set(ep.items.flat().map(s => s.toLowerCase()));
    if (!prev.size && !curr.size) return 1;
    // 갑자기 50% 이상 사라지거나 추가되면 불연속
    const disappeared = [...prev].filter(x => !curr.has(x)).length;
    const appeared    = [...curr].filter(x => !prev.has(x)).length;
    const totalUnion  = new Set([...prev, ...curr]).size;
    const disruption  = totalUnion > 0 ? (disappeared + appeared) / (2 * totalUnion) : 0;
    return Math.max(0, 1 - disruption * 2);
  });
  const item_retention_consistency = itemChanges.length
    ? itemChanges.reduce((s, v) => s + v, 0) / itemChanges.length
    : 1;

  // 위치 전환 일관성 (scene_clarity 참조)
  const clarities = window.map(ep => (ep.quality_scores.scene_clarity ?? 70) / 100);
  const location_transition_coherence = clarities.reduce((s, v) => s + v, 0) / clarities.length;

  // 인물 정체성 안정성 (character_consistency 트렌드 — 낮아지면 감점)
  const charConsts = window.map(ep => (ep.quality_scores.character_consistency ?? 70) / 100);
  const char_mean  = charConsts.reduce((s, v) => s + v, 0) / charConsts.length;
  const charDrop   = trendScore(charConsts.map(v => -v));  // drop = bad
  const character_identity_stability = char_mean * 0.7 + (1 - charDrop) * 0.3;

  // 복선 압력 — 중반까지 쌓이고, 후반에 감소해야 좋음
  const foreshadows = window.map(ep => ep.foreshadow_count);
  let foreshadow_pressure: number;
  if (phase === "resolution" || isFinal) {
    // 후반: 감소가 좋음 (payoff 진행)
    foreshadow_pressure = trendScore(foreshadows.map(f => -f));
  } else {
    // 초중반: 0이 아닌 것 자체가 좋음 (복선 존재)
    const nonZero = foreshadows.filter(f => f > 0).length;
    foreshadow_pressure = nonZero / foreshadows.length;
  }

  // 호기심 유지 (ending_hook 평균 + 하락 없음)
  const hookStability = 1 - trendScore(hooks.map(v => -v));  // 하락 없으면 좋음
  const curiosity_retention = hookMean * 0.6 + hookStability * 0.4;

  // 연속성 리콜 (arc_summaries + rolling_summary 존재 여부)
  const withMemory = window.filter(ep => ep.has_rolling_summary || ep.arc_summaries_count > 0).length;
  const continuity_recall = withMemory / window.length;

  // 상태 비반복 (physical + emotional 반복 없음)
  const allPhysical = window.map(ep => ep.physical_states.join("|"));
  const physStale = staleRatio(allPhysical);
  const state_non_repetition = Math.max(0, 1 - physStale * 0.7 - emotStale * 0.3);

  return {
    emotional_arc_consistency,
    goal_evolution,
    escalation_curve,
    ending_convergence,
    item_retention_consistency,
    location_transition_coherence,
    character_identity_stability,
    foreshadow_pressure,
    curiosity_retention,
    continuity_recall,
    state_non_repetition,
  };
}

// 가중 집계
const WINDOW_WEIGHTS: Record<keyof TrajectoryWindowScores, number> = {
  emotional_arc_consistency:     0.12,
  goal_evolution:                0.12,
  escalation_curve:              0.10,
  ending_convergence:            0.12,
  item_retention_consistency:    0.08,
  location_transition_coherence: 0.08,
  character_identity_stability:  0.10,
  foreshadow_pressure:           0.10,
  curiosity_retention:           0.10,
  continuity_recall:             0.05,
  state_non_repetition:          0.03,
};

function aggregateWindowScore(scores: TrajectoryWindowScores): number {
  let s = 0;
  for (const [k, w] of Object.entries(WINDOW_WEIGHTS)) {
    s += (scores[k as keyof TrajectoryWindowScores] ?? 0) * w;
  }
  return Math.max(0, Math.min(1, s));
}

// ── 메인: 전체 trajectory reward 계산 ─────────────────────────
export function computeAllWindows(
  episodes: EpisodeSnapshot[],
): TrajectoryWindow[] {
  if (episodes.length < 2) return [];

  const resolvedFinal = episodes.find(e => e.resolved_final > 0)?.resolved_final ?? 0;
  const windows: TrajectoryWindow[] = [];

  for (let size = 2; size <= 10; size++) {
    for (let start = 0; start + size <= episodes.length; start++) {
      const slice = episodes.slice(start, start + size);
      const startEp = slice[0].episode_number;
      const endEp   = slice[slice.length - 1].episode_number;
      const midEp   = slice[Math.floor(size / 2)].episode_number;
      const incFinal = resolvedFinal > 0 && endEp >= resolvedFinal;

      const scores = computeWindowScores(slice, resolvedFinal);
      const windowScore = aggregateWindowScore(scores);

      windows.push({
        window_size: size,
        start_episode: startEp,
        end_episode: endEp,
        includes_final_episode: incFinal,
        arc_phase: tagArcPhase(midEp, resolvedFinal),
        scores,
        window_score: Math.round(windowScore * 1000) / 1000,
      });
    }
  }
  return windows;
}

export async function computeTrajectoryReward(
  bookId: string,
  pool: Pool,
): Promise<TrajectoryReward> {
  const episodes = await loadEpisodeSnapshots(bookId, pool);
  if (episodes.length === 0) {
    return {
      book_id: bookId,
      resolved_final_episode: 0,
      windows: [],
      summary: {
        mean_window_score: 0, best_window_score: 0, worst_window_score: 0,
        final_window_score: null, arc_coherence_score: 0, pre_final_convergence_score: 0,
      },
      computed_at: new Date().toISOString(),
    };
  }

  const resolvedFinal = episodes.find(e => e.resolved_final > 0)?.resolved_final ?? 0;
  const windows = computeAllWindows(episodes);
  const scores  = windows.map(w => w.window_score);

  const mean = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  const best = scores.length ? Math.max(...scores) : 0;
  const worst = scores.length ? Math.min(...scores) : 0;

  // 표준편차 기반 arc coherence (낮을수록 일관성 높음 → 1 - stddev)
  const variance = scores.length > 1
    ? scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length : 0;
  const arc_coherence_score = Math.max(0, 1 - Math.sqrt(variance) * 2);

  const finalWindows = windows.filter(w => w.includes_final_episode);
  const final_window_score = finalWindows.length
    ? finalWindows.reduce((s, w) => s + w.window_score, 0) / finalWindows.length
    : null;

  // 마지막 3개 윈도우 평균 (최종 수렴 지표)
  const last3 = windows.slice(-3);
  const pre_final_convergence_score = last3.length
    ? last3.reduce((s, w) => s + w.window_score, 0) / last3.length
    : 0;

  return {
    book_id: bookId,
    resolved_final_episode: resolvedFinal,
    windows,
    summary: {
      mean_window_score: Math.round(mean * 1000) / 1000,
      best_window_score: Math.round(best * 1000) / 1000,
      worst_window_score: Math.round(worst * 1000) / 1000,
      final_window_score: final_window_score !== null ? Math.round(final_window_score * 1000) / 1000 : null,
      arc_coherence_score: Math.round(arc_coherence_score * 1000) / 1000,
      pre_final_convergence_score: Math.round(pre_final_convergence_score * 1000) / 1000,
    },
    computed_at: new Date().toISOString(),
  };
}
