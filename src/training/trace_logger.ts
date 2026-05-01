/**
 * src/training/trace_logger.ts — 운영 중 실행 궤적 캡처
 *
 * 파이프라인 각 단계에서 호출하여 run_traces 테이블에 저장한다.
 * 운영 경로에서 데이터를 수집해 학습 데이터로 변환하는 브리지.
 *
 * 사용법:
 *   const logger = new TraceLogger(ctx);
 *   logger.setPlannerTrace({ raw_llm_output, ... });
 *   logger.setRendererTrace({ system_prompt, ... });
 *   await logger.save(pool);
 */

import { randomUUID } from "crypto";
import type { Pool } from "pg";
import type { RunTrace, PlannerTrace, RendererTrace, RevisionIterationTrace } from "./types.js";
import type { EffectiveContext, ValidationResult, Verdict } from "../types/canonical.js";
import type { PlanValidationResult } from "../types/planner.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { currentSchemaVersions } from "./schema_versions.js";

export class TraceLogger {
  private trace: Partial<RunTrace>;

  constructor(ctx: EffectiveContext, traceType: "planner" | "legacy" = "planner", bookId?: string) {
    this.trace = {
      trace_id: randomUUID(),
      trace_type: traceType,
      book_id: bookId ?? (ctx as any).book_id ?? null,
      episode_number: ctx.episode_number,
      created_at: new Date().toISOString(),
      effective_context_snapshot: ctx as unknown as Record<string, unknown>,
      revision_traces: [],
      // 기본값
      final_verdict: "FAIL",
      final_score: 0,
      revision_count: 0,
      total_elapsed_ms: 0,
      is_planner_sft_eligible: false,
      is_renderer_sft_eligible: false,
      is_preference_eligible: false,
      ...currentSchemaVersions(),
    };
  }

  get traceId(): string {
    return this.trace.trace_id!;
  }

  setPlannerTrace(t: PlannerTrace): this {
    this.trace.planner_trace = t;
    return this;
  }

  setPlanValidation(v: PlanValidationResult): this {
    this.trace.plan_validation = v;
    return this;
  }

  setRendererTrace(t: RendererTrace): this {
    this.trace.renderer_trace = t;
    return this;
  }

  /** R5B-3.5: post-gen narrative repetition guard 결과 기록 (renderer_trace에 병합). */
  setNarrativeRepetitionCheck(check: Record<string, unknown>): this {
    if (!this.trace.renderer_trace) {
      // renderer_trace가 아직 없으면 임시 stub 후 추후 setRendererTrace에서 보존
      (this.trace as any).renderer_trace = { narrative_repetition_check: check };
    } else {
      (this.trace.renderer_trace as any).narrative_repetition_check = check;
    }
    return this;
  }

  /** R5B-3.5: 외부 sanitize 결과 기록 (선택, 운영 메타). */
  setSanitizationMeta(meta: Record<string, unknown>): this {
    if (!this.trace.renderer_trace) {
      (this.trace as any).renderer_trace = { sanitization_meta: meta };
    } else {
      (this.trace.renderer_trace as any).sanitization_meta = meta;
    }
    return this;
  }

  setProseValidation(v: ValidationResult): this {
    this.trace.prose_validation = v;
    return this;
  }

  addRevisionTrace(t: RevisionIterationTrace): this {
    this.trace.revision_traces = [...(this.trace.revision_traces ?? []), t];
    return this;
  }

  finalize(opts: {
    final_verdict: Verdict;
    final_score: number;
    revision_count: number;
    total_elapsed_ms: number;
  }): this {
    Object.assign(this.trace, opts);

    // episode_delta_check를 planner_trace에 병합 (Step 5.25에서 tracer에 직접 첨부됨)
    const deltaCheck = (this as any).episode_delta_check;
    if (deltaCheck && this.trace.planner_trace) {
      (this.trace.planner_trace as any).episode_delta_check = deltaCheck;
    }
    // item/location ledger check를 planner_trace에 병합 (pipeline index에서 첨부됨)
    const itemLedger = (this as any).item_ledger_check;
    const locationLedger = (this as any).location_ledger_check;
    if (this.trace.planner_trace) {
      if (itemLedger) (this.trace.planner_trace as any).item_ledger_check = itemLedger;
      if (locationLedger) (this.trace.planner_trace as any).location_ledger_check = locationLedger;
    }

    // 학습 적합성 자동 판단
    this.trace.is_planner_sft_eligible =
      this.trace.plan_validation?.verdict === "PASS" &&
      !(this.trace.planner_trace?.fallback_used ?? true);

    this.trace.is_renderer_sft_eligible =
      opts.final_verdict === "PASS" &&
      opts.revision_count === 0 &&
      opts.final_score >= 70;

    return this;
  }

  /** run_traces 테이블에 저장 */
  async save(pool: Pool): Promise<string> {
    const t = this.trace as RunTrace;
    try {
      await pool.query(
        `INSERT INTO run_traces (
          trace_id, trace_type, book_id, episode_number, created_at,
          effective_context_snapshot, planner_trace, plan_validation,
          renderer_trace, prose_validation, revision_traces,
          final_verdict, final_score, revision_count, total_elapsed_ms,
          is_planner_sft_eligible, is_renderer_sft_eligible, is_preference_eligible,
          schema_version, planner_schema_version, reward_schema_version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT (trace_id) DO NOTHING`,
        [
          t.trace_id, t.trace_type, t.book_id, t.episode_number, t.created_at,
          JSON.stringify(t.effective_context_snapshot),
          JSON.stringify(t.planner_trace ?? null),
          JSON.stringify(t.plan_validation ?? null),
          JSON.stringify(t.renderer_trace ?? null),
          JSON.stringify(t.prose_validation ?? null),
          JSON.stringify(t.revision_traces ?? []),
          t.final_verdict, t.final_score, t.revision_count, t.total_elapsed_ms,
          t.is_planner_sft_eligible, t.is_renderer_sft_eligible, t.is_preference_eligible,
          t.schema_version ?? null, t.planner_schema_version ?? null, t.reward_schema_version ?? null,
        ],
      );
      logInfo("training:trace", "trace 저장", { trace_id: t.trace_id, verdict: t.final_verdict });
      return t.trace_id;
    } catch (err) {
      logWarn("training:trace", "trace 저장 실패 (운영 미영향)", { error: String(err) });
      return t.trace_id;
    }
  }

  /** 파일 시스템에 JSON 덤프 (DB 없는 환경용) */
  toJSON(): RunTrace {
    return this.trace as RunTrace;
  }
}
