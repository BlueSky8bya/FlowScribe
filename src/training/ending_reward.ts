/**
 * src/training/ending_reward.ts — 결말/종결 품질 평가기
 *
 * 두 단계:
 *   1. Heuristic pass: DB 신호만으로 패널티/보너스 계산 (LLM 불필요)
 *   2. LLM judge pass: 마지막 N화 요약을 LLM에게 평가 의뢰 (opt-in)
 *
 * resolved_final_episode가 랜덤으로 결정되는 FlowScribe 구조에서
 * "그 최종화까지 기승전결이 맞게 흘렀는가"를 최대한 정확히 평가한다.
 *
 * 사용:
 *   const reward = await computeEndingReward(bookId, finalEp, pool, { useLLM: true });
 */

import type { Pool } from "pg";
import type { EndingLevelReward } from "./types.js";
import { loadEpisodeSnapshots } from "./trajectory_reward.js";
import { logInfo, logWarn } from "../lib/logger.js";

import OpenAI from "openai";

function getJudgeClient(): { client: OpenAI; model: string } {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY 환경변수가 없습니다");
  return {
    client: new OpenAI({ apiKey, baseURL: "https://api.deepseek.com/v1" }),
    model: "deepseek-chat",
  };
}

// ── Heuristic pass ───────────────────────────────────────────────
interface HeuristicSignals {
  ending_readiness: number;
  central_conflict_resolution: number;
  foreshadow_payoff_coverage: number;
  ending_proportionality: number;
  premature_closure_penalty: number;
  overextended_delay_penalty: number;
  pre_final_convergence_score: number;
}

function computeHeuristicSignals(
  episodes: ReturnType<typeof Array.prototype.map>,
  finalEpisode: number,
  resolvedFinal: number,
): HeuristicSignals {
  const eps = episodes as Array<{
    episode_number: number;
    foreshadow_count: number;
    remaining_episodes: number;
    episode_role: string;
    quality_scores: Record<string, number>;
    final_verdict: string;
  }>;

  const finalEp = eps.find(e => e.episode_number === finalEpisode);
  if (!eps.length || !finalEp) {
    return {
      ending_readiness: 0, central_conflict_resolution: 0,
      foreshadow_payoff_coverage: 0, ending_proportionality: 0.5,
      premature_closure_penalty: 0, overextended_delay_penalty: 0,
      pre_final_convergence_score: 0,
    };
  }

  // 결말 준비도: final episode의 ending_hook + plot_momentum
  const finalHook    = (finalEp.quality_scores.ending_hook    ?? 60) / 100;
  const finalMoment  = (finalEp.quality_scores.plot_momentum  ?? 60) / 100;
  const ending_readiness = finalHook * 0.4 + finalMoment * 0.6;

  // 핵심 갈등 해소: remaining_episodes가 final에서 0 또는 1이어야
  const remAtFinal = finalEp.remaining_episodes;
  const central_conflict_resolution = remAtFinal <= 1 ? 0.9 : Math.max(0, 1 - (remAtFinal - 1) * 0.15);

  // 복선 페이오프: foreshadow_count가 후반에 감소했는가
  const firstHalf = eps.filter(e => e.episode_number <= Math.ceil(resolvedFinal * 0.5));
  const lastThird = eps.filter(e => e.episode_number >= Math.floor(resolvedFinal * 0.67));
  const firstForeshadow = firstHalf.length
    ? firstHalf.reduce((s, e) => s + e.foreshadow_count, 0) / firstHalf.length : 0;
  const lastForeshadow  = lastThird.length
    ? lastThird.reduce((s, e) => s + e.foreshadow_count, 0) / lastThird.length : 0;
  // 후반에 복선이 감소하면 payoff가 일어났다는 신호
  const foreshadow_payoff_coverage = firstForeshadow > 0
    ? Math.min(1, Math.max(0, 1 - lastForeshadow / firstForeshadow)) * 0.7 + 0.3
    : 0.5;  // 복선 없으면 중립

  // 비례성: episode_role이 final인 화가 실제로 resolved_final에 있는가
  const hasFinalRole = finalEp.episode_role === "final" || finalEp.episode_role === "pre-final";
  const distanceFromResolved = Math.abs(finalEpisode - resolvedFinal);
  const ending_proportionality = hasFinalRole
    ? Math.max(0, 1 - distanceFromResolved * 0.1)
    : Math.max(0, 0.7 - distanceFromResolved * 0.1);

  // 조기종결 패널티: 최종화가 resolved_final보다 3화 이상 이른 경우
  const premature_closure_penalty = finalEpisode < resolvedFinal - 2
    ? -Math.min(0.5, (resolvedFinal - finalEpisode - 2) * 0.1) : 0;

  // 미종결 패널티: resolved_final 이후에도 계속 생성된 경우
  const overextended_delay_penalty = finalEpisode > resolvedFinal + 2
    ? -Math.min(0.5, (finalEpisode - resolvedFinal - 2) * 0.1) : 0;

  // 최종 수렴 지표: 마지막 3화 평균 final_score
  const lastThreeEps = eps.filter(e => e.episode_number >= finalEpisode - 2);
  const pre_final_convergence_score = lastThreeEps.length
    ? lastThreeEps.reduce((s, e) => s + ((e.quality_scores.plot_momentum ?? 70) / 100), 0) / lastThreeEps.length
    : 0;

  return {
    ending_readiness, central_conflict_resolution, foreshadow_payoff_coverage,
    ending_proportionality, premature_closure_penalty, overextended_delay_penalty,
    pre_final_convergence_score,
  };
}

// ── LLM judge pass ───────────────────────────────────────────────
interface LLMEndingJudge {
  character_arc_resolution: number;   // 0~100
  emotional_resolution: number;       // 0~100
  ending_surprise_earned: number;     // 0~100
  sequel_open_hook_balance: number;   // 0~100
  unresolved_critical_thread_penalty: number;  // 0 to -50
  deus_ex_machina_penalty: number;             // 0 to -50
  overexplained_ending_penalty: number;        // 0 to -30
  summary: string;
}

async function callLLMEndingJudge(
  episodeSummaries: string[],
  resolvedFinal: number,
  finalEpisode: number,
  judgingCtx: {
    genre?: string;
    theme?: string;
    characters?: string[];
    absoluteForbidden?: string[];
    opening_foreshadows?: string[];
  },
): Promise<LLMEndingJudge> {
  const { client, model } = getJudgeClient();

  const summaryBlock = episodeSummaries
    .map((s, i) => `화 ${i + 1}: ${s}`)
    .join("\n");

  const systemPrompt = `당신은 한국 장편 소설의 결말 품질 전문 평가자다.
아래 JSON만 출력한다. 다른 텍스트 없이.

{
  "character_arc_resolution": 0~100,
  "emotional_resolution": 0~100,
  "ending_surprise_earned": 0~100,
  "sequel_open_hook_balance": 0~100,
  "unresolved_critical_thread_penalty": 0 이하 정수 (-50까지),
  "deus_ex_machina_penalty": 0 이하 정수 (-50까지),
  "overexplained_ending_penalty": 0 이하 정수 (-30까지),
  "summary": "한 줄 평가"
}

평가 기준:
- character_arc_resolution: 주요 인물들의 내면 변화/성장/관계가 적절히 마무리됐는가
- emotional_resolution: 독자가 감정적으로 정리되는 느낌을 주는가 (허탈하지 않음)
- ending_surprise_earned: 결말이 예상 밖이되 돌아보면 당연한 느낌 (뜬금없으면 0)
- sequel_open_hook_balance: 열린 결말이면 의도적이고 균형 잡혔는가 (완전히 닫힌 결말이 올바른 경우 50점)
- unresolved_critical_thread_penalty: 핵심 약속(복선, 갈등)이 미해소된 경우 음수
- deus_ex_machina_penalty: 갑자기 새로운 힘/인물/사건이 결말을 해결한 경우 음수
- overexplained_ending_penalty: 결말을 과잉 설명해 감동을 죽인 경우 음수

JSON만 출력.`;

  const userPrompt = `[작품 설정]
장르: ${judgingCtx.genre ?? "알 수 없음"}
테마: ${judgingCtx.theme ?? "알 수 없음"}
주요 인물: ${judgingCtx.characters?.join(", ") ?? "알 수 없음"}
예정 최종화: ${resolvedFinal}화 / 실제 최종화: ${finalEpisode}화
${judgingCtx.opening_foreshadows?.length ? `복선 목록: ${judgingCtx.opening_foreshadows.join(", ")}` : ""}
${judgingCtx.absoluteForbidden?.length ? `절대금지: ${judgingCtx.absoluteForbidden.join(", ")}` : ""}

[에피소드 요약 (최근 ${episodeSummaries.length}화)]
${summaryBlock}

위 요약만으로 결말 품질을 평가해줘.`;

  let raw = "{}";
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 600,
    } as any);
    raw = (res as any).choices?.[0]?.message?.content ?? "{}";
  } catch (err) {
    logWarn("training:ending_reward", "LLM ending judge 실패 — 기본값 사용", { error: String(err) });
  }

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as LLMEndingJudge;
  } catch { /* ignore */ }

  return {
    character_arc_resolution: 60,
    emotional_resolution: 60,
    ending_surprise_earned: 50,
    sequel_open_hook_balance: 50,
    unresolved_critical_thread_penalty: 0,
    deus_ex_machina_penalty: 0,
    overexplained_ending_penalty: 0,
    summary: "LLM 응답 파싱 실패 — 기본값",
  };
}

// ── 메인 ─────────────────────────────────────────────────────────
export async function computeEndingReward(
  bookId: string,
  finalEpisode: number,
  pool: Pool,
  opts: {
    useLLM?: boolean;
    maxSummaryEpisodes?: number;
    genre?: string;
    theme?: string;
  } = {},
): Promise<EndingLevelReward> {
  const episodes = await loadEpisodeSnapshots(bookId, pool);
  if (!episodes.length) {
    logWarn("training:ending_reward", "에피소드 없음", { book_id: bookId });
    return _defaultEnding(finalEpisode, 0);
  }

  const resolvedFinal = episodes.find(e => e.resolved_final > 0)?.resolved_final ?? finalEpisode;

  // Heuristic
  const heuristic = computeHeuristicSignals(episodes, finalEpisode, resolvedFinal);

  // LLM judge (opt-in)
  let llmJudge: LLMEndingJudge | null = null;
  if (opts.useLLM) {
    const maxN = opts.maxSummaryEpisodes ?? 5;
    // arc_summaries는 effective_context_snapshot에 있으므로 DB에서 직접 읽음
    const summaryRows = await pool.query(
      `SELECT episode_number,
              effective_context_snapshot->'arc_summaries' AS arc_summaries,
              effective_context_snapshot->'characters'    AS characters,
              effective_context_snapshot->'world_config'  AS world_config,
              planner_trace->'input_contract'->>'foreshadow_count' AS foreshadow_count
       FROM run_traces
       WHERE book_id = $1 AND prose_validation IS NOT NULL
       ORDER BY episode_number DESC LIMIT $2`,
      [bookId, maxN],
    );

    const summaries: string[] = summaryRows.rows
      .reverse()
      .map(r => {
        const arcs = r.arc_summaries;
        if (Array.isArray(arcs) && arcs.length) return arcs[arcs.length - 1]?.content ?? "";
        return `화 ${r.episode_number} 요약 없음`;
      })
      .filter(Boolean);

    const firstRow = summaryRows.rows[summaryRows.rows.length - 1];
    const chars: string[] = Array.isArray(firstRow?.characters)
      ? firstRow.characters.map((c: any) => c.name).filter(Boolean)
      : [];
    const wc = firstRow?.world_config ?? {};

    llmJudge = await callLLMEndingJudge(
      summaries, resolvedFinal, finalEpisode,
      { genre: wc.genre ?? opts.genre, theme: wc.theme ?? opts.theme, characters: chars },
    );

    logInfo("training:ending_reward", "LLM ending judge 완료", {
      book_id: bookId, final_ep: finalEpisode,
      arc_resolution: llmJudge.character_arc_resolution,
    });
  }

  // 조합
  const character_arc_resolution = llmJudge
    ? llmJudge.character_arc_resolution / 100
    : heuristic.ending_proportionality;  // heuristic proxy
  const emotional_resolution = llmJudge
    ? llmJudge.emotional_resolution / 100
    : heuristic.ending_readiness;
  const ending_surprise_earned = llmJudge
    ? llmJudge.ending_surprise_earned / 100 : 0.5;
  const sequel_open_hook_balance = llmJudge
    ? llmJudge.sequel_open_hook_balance / 100 : 0.5;
  const deus_ex_machina_penalty = llmJudge
    ? llmJudge.deus_ex_machina_penalty / 100 : 0;
  const overexplained_ending_penalty = llmJudge
    ? llmJudge.overexplained_ending_penalty / 100 : 0;
  const unresolved_critical_thread_penalty = llmJudge
    ? llmJudge.unresolved_critical_thread_penalty / 100
    : heuristic.foreshadow_payoff_coverage < 0.3 ? -0.2 : 0;

  // final_closure_score 가중 합산
  const pos = (
    heuristic.ending_readiness           * 0.15 +
    heuristic.central_conflict_resolution * 0.20 +
    heuristic.foreshadow_payoff_coverage  * 0.15 +
    character_arc_resolution              * 0.15 +
    emotional_resolution                  * 0.10 +
    heuristic.ending_proportionality      * 0.10 +
    ending_surprise_earned                * 0.05 +
    sequel_open_hook_balance              * 0.05 +
    heuristic.pre_final_convergence_score * 0.05
  );
  const neg = (
    heuristic.premature_closure_penalty +
    heuristic.overextended_delay_penalty +
    deus_ex_machina_penalty +
    overexplained_ending_penalty +
    unresolved_critical_thread_penalty
  );
  const final_closure_score = Math.max(0, Math.min(1, pos + neg));

  return {
    final_episode_number: finalEpisode,
    resolved_final_episode: resolvedFinal,
    ending_readiness: Math.round(heuristic.ending_readiness * 1000) / 1000,
    central_conflict_resolution: Math.round(heuristic.central_conflict_resolution * 1000) / 1000,
    foreshadow_payoff_coverage: Math.round(heuristic.foreshadow_payoff_coverage * 1000) / 1000,
    character_arc_resolution: Math.round(character_arc_resolution * 1000) / 1000,
    emotional_resolution: Math.round(emotional_resolution * 1000) / 1000,
    ending_proportionality: Math.round(heuristic.ending_proportionality * 1000) / 1000,
    ending_surprise_earned: Math.round(ending_surprise_earned * 1000) / 1000,
    sequel_open_hook_balance: Math.round(sequel_open_hook_balance * 1000) / 1000,
    unresolved_critical_thread_penalty: Math.round(unresolved_critical_thread_penalty * 1000) / 1000,
    deus_ex_machina_penalty: Math.round(deus_ex_machina_penalty * 1000) / 1000,
    premature_closure_penalty: Math.round(heuristic.premature_closure_penalty * 1000) / 1000,
    overextended_delay_penalty: Math.round(heuristic.overextended_delay_penalty * 1000) / 1000,
    overexplained_ending_penalty: Math.round(overexplained_ending_penalty * 1000) / 1000,
    pre_final_convergence_score: Math.round(heuristic.pre_final_convergence_score * 1000) / 1000,
    final_closure_score: Math.round(final_closure_score * 1000) / 1000,
    judge_summary: llmJudge?.summary ?? "heuristic only",
    computed_at: new Date().toISOString(),
    judge_model: opts.useLLM ? "deepseek-chat" : undefined,
  };
}

function _defaultEnding(finalEp: number, resolvedFinal: number): EndingLevelReward {
  return {
    final_episode_number: finalEp, resolved_final_episode: resolvedFinal,
    ending_readiness: 0, central_conflict_resolution: 0, foreshadow_payoff_coverage: 0,
    character_arc_resolution: 0, emotional_resolution: 0, ending_proportionality: 0,
    ending_surprise_earned: 0, sequel_open_hook_balance: 0,
    unresolved_critical_thread_penalty: 0, deus_ex_machina_penalty: 0,
    premature_closure_penalty: 0, overextended_delay_penalty: 0, overexplained_ending_penalty: 0,
    pre_final_convergence_score: 0, final_closure_score: 0,
    judge_summary: "no episodes", computed_at: new Date().toISOString(),
  };
}
