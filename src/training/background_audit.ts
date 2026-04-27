/**
 * src/training/background_audit.ts — 비동기 품질 감사
 *
 * reader_fast 경로에서 SSE 응답 완료 후 비동기로 실행된다.
 * 사용자 응답 지연 없이 prose_validation + reward_breakdown을 run_traces에 저장한다.
 *
 * 호출 패턴:
 *   res.end();
 *   scheduleBackgroundAudit(ctx, pipelineResult, bookId, pool);  // fire-and-forget
 */

import type { Pool } from "pg";
import type { EffectiveContext } from "../types/canonical.js";
import type { PlannerPipelineResult } from "../types/planner.js";
import { validate } from "../services/validator.js";
import { TraceLogger } from "./trace_logger.js";
import { computeReward, computeRewardV2, computeHardGate } from "./reward_aggregator.js";
import { waitForGenerationSlot } from "../lib/generation_guard.js";
import { logInfo, logWarn } from "../lib/logger.js";

/**
 * SSE 완료 후 비동기 품질 평가 + trace 저장/업데이트.
 * 절대 awaited되지 않는다 — 운영 서비스에 영향 없음.
 *
 * existingTraceId: pipeline이 이미 trace를 저장한 경우 해당 ID를 전달.
 *   제공 시 새 trace INSERT 없이 기존 trace를 UPDATE한다 (이중 trace 방지).
 *   미제공 시 background_audit가 새 trace를 INSERT한다.
 */
export function scheduleBackgroundAudit(
  ctx: EffectiveContext,
  pipelineResult: PlannerPipelineResult,
  bookId: string,
  pool: Pool,
  existingTraceId?: string,
): void {
  setImmediate(() => {
    _runAudit(ctx, pipelineResult, bookId, pool, existingTraceId).catch((err) => {
      logWarn("training:audit", "background audit 예외 (운영 미영향)", { error: String(err) });
    });
  });
}

async function _runAudit(
  ctx: EffectiveContext,
  pipelineResult: PlannerPipelineResult,
  bookId: string,
  pool: Pool,
  existingTraceId?: string,
): Promise<void> {
  const t0 = Date.now();
  const generatedText = pipelineResult.generated_text;

  if (!generatedText.trim()) {
    logWarn("training:audit", "빈 생성 텍스트 — audit 스킵", { book_id: bookId });
    return;
  }

  // ── 생성 완료 대기 (다음 에피소드 생성 중이면 LLM 경쟁 방지) ────
  await waitForGenerationSlot(90_000);

  // ── prose validation (reader_fast에서 스킵된 LLM 검증) ────────
  let proseValidation: Awaited<ReturnType<typeof validate>>;
  try {
    proseValidation = await validate(generatedText, ctx);
  } catch (err) {
    logWarn("training:audit", "prose validation 실패 — audit 중단", { book_id: bookId, error: String(err) });
    return;
  }

  // ── TraceLogger 조립 ──────────────────────────────────────────
  const tracer = new TraceLogger(ctx, "planner");

  // planner_trace: raw_llm_output은 post-hoc 복원 불가 → 빈 문자열 표시
  tracer.setPlannerTrace({
    raw_llm_output: "",
    parsed_plan: pipelineResult.plan_fallback_used
      ? null
      : (pipelineResult.scene_plan as unknown as import("../types/planner.js").ScenePlan),
    fallback_used: pipelineResult.plan_fallback_used,
    elapsed_ms: pipelineResult.planner_elapsed_ms,
  });

  tracer.setPlanValidation(pipelineResult.plan_validation);
  tracer.setProseValidation(proseValidation);
  tracer.finalize({
    final_verdict: proseValidation.verdict,
    final_score: proseValidation.total_score,
    revision_count: 0,
    total_elapsed_ms: pipelineResult.elapsed_ms,
  });

  // ── reward 계산 (v2: breakdown + episode_extended + hard_gate) ──
  const traceObj = tracer.toJSON();
  const rewardV2 = computeRewardV2(traceObj, generatedText, {
    episodeRole: (pipelineResult.scene_plan as any)?.episode_role,
  });
  const hardGate = rewardV2.episode_extended
    ? { failed: rewardV2.episode_extended.hard_gate_failed, reasons: rewardV2.episode_extended.hard_gate_reasons }
    : computeHardGate(traceObj, generatedText);

  // ── run_traces 저장 / 업데이트 ────────────────────────────────
  // existingTraceId: pipeline이 이미 INSERT한 trace가 있으면 UPDATE만 수행
  // 없으면 새 trace INSERT (generate.ts legacy 경로)
  let traceId: string;
  if (existingTraceId) {
    traceId = existingTraceId;
    // prose_validation + plan_validation을 기존 trace에 보완 저장
    await pool.query(
      `UPDATE run_traces
       SET prose_validation = $1, plan_validation = $2,
           final_verdict = $3, final_score = $4
       WHERE trace_id = $5`,
      [
        JSON.stringify(proseValidation),
        JSON.stringify(pipelineResult.plan_validation),
        proseValidation.verdict,
        proseValidation.total_score,
        traceId,
      ],
    ).catch((err) => {
      logWarn("training:audit", "prose_validation 보완 저장 실패", { error: String(err) });
    });
  } else {
    traceId = await tracer.save(pool);
  }
  const auditMs = Date.now() - t0;

  // computed_reward에 v2 전체 구조 저장 (breakdown은 기존 위치에 유지, episode_extended 추가)
  const rewardPayload = {
    ...rewardV2.breakdown,
    episode_extended: rewardV2.episode_extended,
    reward_schema_version: "2.0",
  };

  await pool.query(
    `UPDATE run_traces
     SET book_id = $1, computed_reward = $2, audit_elapsed_ms = $3
     WHERE trace_id = $4`,
    [bookId, JSON.stringify(rewardPayload), auditMs, traceId],
  ).catch((err) => {
    logWarn("training:audit", "computed_reward 저장 실패 (migrate_v4 미실행?)", { error: String(err) });
  });

  // hard_gate 결과로 SFT eligibility 재판정 — 파이프라인이 doValidate=false로 실행해
  // prose validation 없이 저장한 초기값을 background audit 완료 후 교정한다.
  const sftRenderer = !hardGate.failed && proseValidation.verdict !== "FAIL";
  await pool.query(
    `UPDATE run_traces SET is_renderer_sft_eligible = $1 WHERE trace_id = $2`,
    [sftRenderer, traceId],
  ).catch(() => {/* non-critical */});

  logInfo("training:audit", "background audit 완료", {
    book_id: bookId,
    episode: ctx.episode_number,
    trace_id: traceId,
    existing_trace: !!existingTraceId,
    verdict: proseValidation.verdict,
    score: proseValidation.total_score,
    planner_reward: rewardV2.breakdown.planner_reward.toFixed(3),
    renderer_reward: rewardV2.breakdown.renderer_reward.toFixed(3),
    combined_reward: rewardV2.breakdown.combined_reward.toFixed(3),
    hard_gate_failed: hardGate.failed,
    hard_gate_reasons: hardGate.reasons,
    audit_ms: auditMs,
  });
}
