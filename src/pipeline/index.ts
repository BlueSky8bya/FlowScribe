/**
 * src/pipeline/index.ts — Planner → Plan Validator → Renderer → Prose Validator 파이프라인
 *
 * 기존 story.ts / test_runner.ts legacy 경로는 그대로 유지된다.
 * 이 파이프라인은 병행 경로로 추가된다 (wrapper 방식).
 *
 * 파이프라인 흐름:
 *   1. StateExtractor (결정론적) — 위치/부상/소지품/POV 추출
 *   2. CreativePlanner (LLM, temp=0.4) — 비트/훅/세계관 계획 생성
 *   3. Plan Merge — 결정론적 + 창의적 필드 합성
 *   4. Plan Validator (결정론적) — 논리/구조 검사
 *   5. Renderer (LLM, temp=0.85) — 계획 기반 소설 생성
 *   6. Prose Validator (기존 validator.ts) — 텍스트 품질 검증
 *   7. Revision (기존 revision.ts, optional) — light cleanup
 */

import { logInfo, logWarn } from "../lib/logger.js";
import { validate } from "../services/validator.js";
import { reviseUntilPass } from "../services/revision.js";
import { commitDynamicState, getLatestDynamicStates } from "../services/character_state.js";
import { normalizeStateUpdate, normalizeEmotionalState, normalizeLocation, normalizePhysicalState, normalizeRecentGoal } from "../services/language_guard.js";
import { sanitizeGeneratedBody } from "../services/text_sanitizer.js";
import { judgeAndRepair } from "../services/narrative_coherence.js";
import { normalizeItems, checkLocationChange, emptyItemLedgerCheck, emptyLocationLedgerCheck, type ItemLedgerCheck, type LocationLedgerCheck } from "../lib/item_ledger.js";
import type { EffectiveContext, ValidationResult, Verdict } from "../types/canonical.js";
import type { ScenePlan, PlannerPipelineResult } from "../types/planner.js";
import { extractStateConstraints } from "./state_extractor.js";
import { runCreativePlanner } from "./planner.js";
import { resolveEntity, type EntityResolution } from "../lib/entity_resolver.js";
import { checkEpisodeDelta, type EpisodeDeltaCheckResult } from "../services/episode_delta_validator.js";

/**
 * CharNormEvent — entity_resolver ResolutionType을 파이프라인 통계용으로 매핑.
 * "descriptive_mention"은 DB 커밋에서 제외된다.
 */
type CharNormEvent =
  | "exact_match"
  | "drift_corrected"
  | "orphan_skipped"
  | "new_character_allowed"
  | "descriptive_mention_skipped";

/**
 * resolveCanonicalCharName — entity_resolver.resolveEntity 래퍼
 *
 * resolution 결과:
 *   "canonical"           → name 반환 (exact_match or drift_corrected)
 *   "known_alias"         → canonical_name 반환
 *   "new_character"       → name 반환 (new_character_allowed)
 *   "descriptive_mention" → null 반환 (커밋 스킵) ← Phase 2 핵심 변경
 *   "rejected"            → null 반환 (orphan_skipped)
 */
function resolveCanonicalCharName(
  raw: string,
  canonicalNames: string[],
  logCtx?: { episode?: number; bookId?: string },
): { name: string | null; event: CharNormEvent } {
  const resolution: EntityResolution = resolveEntity(raw, canonicalNames, { logCtx });

  switch (resolution.resolution) {
    case "canonical":
    case "known_alias":
      return {
        name: resolution.canonical_name,
        event: resolution.reason.startsWith("drift_corrected") ? "drift_corrected" : "exact_match",
      };
    case "new_character":
      return { name: resolution.canonical_name, event: "new_character_allowed" };
    case "descriptive_mention":
      // 묘사형 명칭 — DB에 저장하지 않음 (Phase 2 핵심)
      logWarn("pipeline:entityResolution", "descriptive_mention_skipped — character_dynamic_states 저장 제외", {
        raw, reason: resolution.reason, confidence: resolution.confidence, ...logCtx,
      });
      return { name: null, event: "descriptive_mention_skipped" };
    case "rejected":
    default:
      return { name: null, event: "orphan_skipped" };
  }
}
import { validatePlan, repairPlan } from "./plan_validator.js";
import { renderFromPlan, renderFromPlanWithTrace } from "./renderer.js";

export interface PlannerPipelineOptions {
  doRevise?: boolean;
  /** prose 검증 LLM 호출 여부 (기본 true; false 설정 시 검증 스킵 — 속도 우선 모드) */
  doValidate?: boolean;
  promptVersion?: "A" | "B";
  /** plan FAIL 시 렌더링 스킵 여부 (기본 false: plan FAIL여도 렌더링 시도) */
  skipRenderOnPlanFail?: boolean;
  /** A/B 실험용 모델 오버라이드 — 미지정 시 환경변수 기본값 사용 */
  plannerModelOverride?: string;
  rendererModelOverride?: string;
  /**
   * 학습 trace 저장 여부.
   * pool을 전달하면 run_traces 테이블에 실행 궤적을 저장한다.
   * 운영 서버에서 데이터 수집 시 사용; 미전달 시 trace 저장 건너뜀.
   */
  tracePool?: import("pg").Pool;
  /** 캐릭터 상태 커밋용 book_id (없으면 상태 저장 스킵) */
  bookId?: string;
  /** 단계별 진행 상황 콜백 — SSE status 이벤트용 */
  onStatus?: (msg: string) => void;
  /** Phase 4.14 — 이번 호출에 적용할 route_set 이름 (model_router config). 미지정 시 active route 사용. */
  routeSetOverride?: string;
  /** Phase 4.20 R5A — renderer token chunk callback. 설정 시 stream=true로 호출. */
  onRendererChunk?: (delta: string) => void;
  /** Phase 4.20 R5A — pipeline phase 이벤트 콜백 (planner_start/done, renderer_start/done 등). */
  onPhase?: (phase: string, extra?: Record<string, unknown>) => void;
}

const EMPTY_QUALITY_SCORES = {
  pov_consistency: 0, scene_clarity: 0, character_consistency: 0,
  plot_momentum: 0, world_rule_usage: 0, exposition_control: 0,
  prose_density: 0, ending_hook: 0, style_adherence: 0, intervention_adherence: 0,
};

export async function runPlannerPipeline(
  ctx: EffectiveContext,
  opts: PlannerPipelineOptions = {},
): Promise<PlannerPipelineResult> {
  const t0 = Date.now();
  const {
    doRevise            = true,
    doValidate          = true,
    promptVersion       = "A",
    skipRenderOnPlanFail = false,
    tracePool,
    bookId,
    onStatus,
    plannerModelOverride,
    rendererModelOverride,
    routeSetOverride,
    onRendererChunk,
    onPhase,
  } = opts;
  const notify = (msg: string) => { onStatus?.(msg); };
  const phase  = (p: string, extra?: Record<string, unknown>) => { try { onPhase?.(p, extra); } catch { /* sink */ } };

  // TraceLogger — tracePool 전달 시에만 활성화 (운영 중 데이터 수집)
  let tracer: import("../training/trace_logger.js").TraceLogger | null = null;
  if (tracePool) {
    const { TraceLogger } = await import("../training/trace_logger.js");
    tracer = new TraceLogger(ctx, "planner", bookId);
  }

  logInfo("pipeline", "파이프라인 시작", { episode: ctx.episode_number, pov: ctx.gen_config.pov });

  // ─── Step 1: State Extraction (결정론적, LLM 없음) ───────────
  notify("이야기 구조와 세계관 제약을 분석하는 중...");
  const stateConstraints = extractStateConstraints(ctx);

  // ─── Step 2: Creative Planning (LLM) ─────────────────────────
  notify("플래너가 장면 비트와 인물 감정선을 설계하는 중...");
  phase("planner_start");
  const t_plan0 = Date.now();
  const { plan: creativePlan, fallback_used, raw_output } = await runCreativePlanner(ctx, stateConstraints, plannerModelOverride, routeSetOverride);
  const planner_elapsed_ms = Date.now() - t_plan0;
  phase("planner_done", { elapsed_ms: planner_elapsed_ms, fallback_used });
  tracer?.setPlannerTrace({
    raw_llm_output: raw_output ?? "",
    parsed_plan: fallback_used ? null : creativePlan as unknown as import("../types/planner.js").ScenePlan,
    fallback_used,
    elapsed_ms: planner_elapsed_ms,
    model_used: plannerModelOverride ?? (await import("../lib/llm.js")).getPlannerModel(),
    input_contract: {
      // Narrative
      target_length:      stateConstraints.target_length,
      char_budget: {
        target: stateConstraints.char_budget.target,
        min:    stateConstraints.char_budget.min,
        max:    stateConstraints.char_budget.max,
      },
      ending_constraint:  stateConstraints.ending_constraint,
      resolved_final:     stateConstraints.narrative_contract.resolved_final,
      remaining_episodes: stateConstraints.narrative_contract.remaining_episodes,
      episode_role:       stateConstraints.narrative_contract.episode_role,
      // Character
      absent_characters:  stateConstraints.absent_characters,
      // Rule / Intervention
      active_interventions: stateConstraints.active_intervention_instructions,
      absolute_forbidden:   stateConstraints.absolute_forbidden,
      episode_forbidden:    stateConstraints.episode_forbidden,
      episode_required:     stateConstraints.episode_required,
      // Memory / Arc (존재 여부만)
      has_rolling_summary:   !!ctx.rolling_summary,
      arc_summaries_count:   ctx.arc_summaries?.length ?? 0,
      character_arcs_count:  Object.keys(ctx.character_arcs ?? {}).length,
      has_prev_tail:         !!ctx.prev_episode_tail,
      has_continuity_contract: !!ctx.continuity_contract,
      continuity_known_facts: ctx.continuity_contract?.known_facts?.length ?? 0,
      has_episode_delta_contract: !!ctx.episode_delta_contract,
      delta_must_progress_count: ctx.episode_delta_contract?.must_progress?.length ?? 0,
      delta_must_not_repeat_count: ctx.episode_delta_contract?.must_not_repeat?.length ?? 0,
      delta_repetition_risk_count: ctx.episode_delta_contract?.repetition_risk?.length ?? 0,
      foreshadow_count:      ctx.foreshadow_memory?.length ?? 0,
      // Arc-phase (planner 7-phase 기준 — training ArcPhase 4종과 별개)
      planner_arc_phase:     stateConstraints.narrative_contract.arc_phase,
      planner_arc_ratio:     stateConstraints.narrative_contract.arc_ratio,
    },
  });

  // ─── Step 3: Merge → ScenePlan ───────────────────────────────
  const scenePlan: ScenePlan = {
    // 결정론적 필드 (StateExtractor 확정)
    opening_location:     stateConstraints.opening_location,
    opening_time_context: stateConstraints.opening_time_context,
    forbidden_actions:    stateConstraints.forbidden_actions,
    must_keep_items:      stateConstraints.must_keep_items,
    pov_contract:         stateConstraints.pov_contract,
    tone_contract:        stateConstraints.tone_contract,
    target_length:        stateConstraints.target_length,
    ending_constraint:    stateConstraints.ending_constraint,
    // 창의적 필드 (LLM 또는 fallback)
    carryover_effects:    creativePlan.carryover_effects,
    world_rule:           creativePlan.world_rule,
    scene_beats:          creativePlan.scene_beats,
    hook_type:            creativePlan.hook_type,
    hook_payload:         creativePlan.hook_payload,
    hook_concrete_event:  creativePlan.hook_concrete_event,
    character_state_updates: creativePlan.character_state_updates ?? [],
  };

  // ─── Step 4: Plan Validation → Auto-Repair (결정론적) ────────
  notify("계획 논리와 세계관 규칙을 검증하는 중...");
  let planValidation = validatePlan(scenePlan, ctx);
  if (planValidation.verdict !== "PASS") {
    const { plan: repairedPlan, repaired, repairs_applied } = repairPlan(planValidation, ctx);
    if (repaired) {
      planValidation = validatePlan(repairedPlan, ctx);
      logInfo("pipeline", "계획 자동 보정 적용", { repairs: repairs_applied, verdict_after: planValidation.verdict });
    }
  }
  tracer?.setPlanValidation(planValidation);
  logInfo("pipeline", "계획 검증 완료", {
    verdict:  planValidation.verdict,
    issues:   planValidation.issues.length,
    passed:   planValidation.passed_checks.length,
  });

  // plan FAIL + skipRenderOnPlanFail → 렌더링 스킵
  if (skipRenderOnPlanFail && planValidation.verdict === "FAIL") {
    logWarn("pipeline", "계획 FAIL — 렌더링 스킵");
    const stubVal: ValidationResult = {
      verdict: "FAIL",
      hard_violations: [{
        rule: "계획 검증 실패",
        description: planValidation.issues.map(i => i.description).join("; "),
        severity: "critical",
      }],
      soft_warnings: [],
      quality_scores: EMPTY_QUALITY_SCORES,
      total_score: 0,
      summary: "계획 검증 실패로 렌더링 스킵",
    };
    return {
      scene_plan: scenePlan, plan_validation: planValidation,
      generated_text: "", prose_validation: stubVal,
      final_verdict: "FAIL", final_score: 0, revision_count: 0,
      elapsed_ms: Date.now() - t0, planner_elapsed_ms, renderer_elapsed_ms: 0,
      plan_fallback_used: fallback_used,
    };
  }

  // ─── Step 5: Rendering (LLM) ─────────────────────────────────
  notify("대사와 지문을 소설로 렌더링하는 중...");
  phase("renderer_start", { streaming: !!onRendererChunk });
  const t_render0 = Date.now();
  let generatedText = "";
  let rawRenderedText = "";
  try {
    const renderResult = await renderFromPlanWithTrace(scenePlan, ctx, rendererModelOverride, routeSetOverride, onRendererChunk);
    rawRenderedText = renderResult.text;
    // ── Prose Name Drift Detector: 생성 텍스트에서 canonical name 변형 탐지 (로그만) ──
    // 교정은 하지 않음 (한국어 조사 경계 파싱이 필요하여 오탐 위험 높음)
    // DB 저장 전 탐지 결과를 로그로 남겨 DPO 수집 품질 모니터링에 활용.
    const canonicalNamesForProse = ctx.characters.map(c => c.name);
    const proseNormLog: { raw: string; canonical: string }[] = [];
    for (const cname of canonicalNamesForProse) {
      // 공백·구두점 전후에 나타나는 cname + 한글 1-4자 패턴을 스캔
      const variantPattern = new RegExp(cname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[가-힣]{1,4}", "g");
      const matches = rawRenderedText.match(variantPattern) ?? [];
      for (const match of new Set(matches)) {
        const { event } = resolveCanonicalCharName(match, canonicalNamesForProse);
        if (event === "drift_corrected") proseNormLog.push({ raw: match, canonical: cname });
      }
    }
    if (proseNormLog.length > 0) {
      logWarn("pipeline:proseNorm", "prose_drift_detected — 생성 텍스트에 canonical 변형어 발견 (DB 저장은 원본 그대로)", {
        episode: ctx.episode_number,
        drifts: proseNormLog,
      });
    }
    // ── Body Sanitizer: special token / foreign fragment 제거 ──────
    let sanitized = sanitizeGeneratedBody(rawRenderedText);
    if (sanitized.warnings.length > 0) {
      logWarn("pipeline:sanitizer", "body sanitization applied", {
        episode: ctx.episode_number,
        removed_special_tokens: sanitized.removed_special_tokens,
        removed_foreign_fragments: sanitized.removed_foreign_fragments,
        warnings: sanitized.warnings.slice(0, 10),
      });
    }

    // Phase 4.20 R5A-C — Fix F: foreign/OOD contamination 임계 시 lower-temp retry 1회.
    // 임계: removed_foreign_fragments + removed_special_tokens >= 3 (1회 정도는 자연스러운 alphabet).
    // hybrid streaming 중에는 chunks가 이미 client에 전송됐으므로 retry 안 함 (UX 안전).
    // batch 모드에서만 retry 시도. retry는 1회만.
    const _foreignContamCount = sanitized.removed_foreign_fragments + sanitized.removed_special_tokens;
    const _foreignContamThreshold = 3;
    let _retryAttempted = false;
    let _retrySucceeded = false;
    if (_foreignContamCount >= _foreignContamThreshold && !onRendererChunk) {
      _retryAttempted = true;
      logWarn("pipeline:sanitizer", "foreign contamination 검출 — lower-temp retry 시도", {
        episode: ctx.episode_number,
        foreign_count: _foreignContamCount,
      });
      try {
        const retryResult = await renderFromPlanWithTrace(
          scenePlan, ctx, rendererModelOverride, routeSetOverride, undefined, /*temperatureOverride*/ 0.7,
        );
        const retrySanitized = sanitizeGeneratedBody(retryResult.text);
        const retryContam = retrySanitized.removed_foreign_fragments + retrySanitized.removed_special_tokens;
        if (retryContam < _foreignContamThreshold) {
          _retrySucceeded = true;
          rawRenderedText = retryResult.text;
          sanitized = retrySanitized;
          logInfo("pipeline:sanitizer", "lower-temp retry 성공 — clean output 사용", {
            episode: ctx.episode_number,
            retry_foreign_count: retryContam,
          });
        } else {
          logWarn("pipeline:sanitizer", "lower-temp retry도 contamination — 첫 결과 그대로 사용", {
            episode: ctx.episode_number,
            retry_foreign_count: retryContam,
          });
        }
      } catch (retryErr) {
        logWarn("pipeline:sanitizer", "retry 실행 실패 — 첫 결과 사용", { error: String(retryErr) });
      }
    }

    generatedText = sanitized.text;
    tracer?.setRendererTrace({
      system_prompt:  renderResult.system_prompt,
      user_prompt:    renderResult.user_prompt,
      generated_text: rawRenderedText,
      elapsed_ms:     renderResult.elapsed_ms,
      model_used:     renderResult.model_used,
    });
    // Phase 4.20 R5A-C — Fix F: trace에 contamination 메타 기록 (regen contract usable filter용).
    if (_foreignContamCount > 0 || _retryAttempted) {
      (tracer as any)?.setSanitizationMeta?.({
        foreign_contam_count: _foreignContamCount,
        retry_attempted: _retryAttempted,
        retry_succeeded: _retrySucceeded,
      });
    }
  } catch (err) {
    logWarn("pipeline", "렌더링 오류", { error: String(err) });
  }
  const renderer_elapsed_ms = Date.now() - t_render0;
  phase("renderer_done", { elapsed_ms: renderer_elapsed_ms, chars: generatedText.length });

  // ─── Step 5.25: Continuity Check (ep >= 2) ───────────────────
  if (ctx.episode_number >= 2 && generatedText && ctx.continuity_contract) {
    const cc = ctx.continuity_contract;
    const issues: string[] = [];
    const text = generatedText;

    // 금지된 퇴행 패턴 탐지 (롤링 기반, 특정 예시 하드코딩 없음)
    // 1. 직전 화 인물 접촉/약속 key_event가 있는 인물쌍에 대해 "처음 만남" 패턴 감지
    for (const [name, arc] of Object.entries(ctx.character_arcs ?? {})) {
      const hasContact = arc.key_events.some(ev => /만남|대화|약속|돕기|신뢰|발견/.test(ev));
      if (hasContact) {
        // 본문에 "처음", "낯선", "누구십니까", "처음 보는" 등의 퇴행 패턴이 있으면 WARN
        if (/처음\s*보|낯선\s*사람|처음 만|누구십니까|처음 뵙/.test(text)) {
          issues.push(`${name} 관련 이미 발생한 만남·접촉이 다시 처음처럼 표현될 수 있음`);
        }
      }
    }

    // 2. open_threads 중 최소 1개가 본문에 반영됐는지 확인
    if (cc.open_threads.length >= 2) {
      const reflected = cc.open_threads.filter(th => {
        const kw = th.replace(/[^가-힣\w]/g, " ").split(/\s+/).filter(w => w.length >= 2);
        return kw.some(w => text.includes(w));
      });
      if (reflected.length === 0) {
        issues.push("직전 화에서 열린 플롯 스레드(복선/B플롯)가 이번 화 본문에 전혀 반영되지 않음");
      }
    }

    const verdict = issues.length === 0 ? "PASS" : "WARN";
    logInfo("pipeline:continuity", "연속성 검사", {
      episode: ctx.episode_number,
      verdict,
      issues,
      known_facts: cc.known_facts.length,
      open_threads: cc.open_threads.length,
    });
    // tracer에 continuity_check 첨부
    if (tracer) {
      (tracer as any).continuity_check = { verdict, issues };
    }
  }

  // ─── Step 5.25: Episode Delta Check ────────────────────────────
  {
    const dc = ctx.episode_delta_contract;
    const deltaCheckResult: EpisodeDeltaCheckResult = checkEpisodeDelta(
      generatedText,
      ctx.prev_episode_tail,
      dc,
    );
    logInfo("pipeline:delta", "에피소드 진전 검사", {
      episode: ctx.episode_number,
      verdict: deltaCheckResult.verdict,
      repeated_patterns: deltaCheckResult.repeated_patterns.length,
      missing_progress: deltaCheckResult.missing_progress.length,
      opening_similarity: deltaCheckResult.opening_similarity_score.toFixed(3),
    });
    if (tracer) {
      (tracer as any).episode_delta_check = deltaCheckResult;
    }
  }

  // ─── Step 5.4: Narrative Coherence Judge + Targeted Repair (Phase 4.10) ───
  // selective: deterministic 감사가 후보를 발견했거나 강제 모드일 때만 Gemini judge 호출.
  // fatal 확정 시 단락 단위 최소 수정. 전체 재생성 금지.
  const coherenceForce =
    process.env.COHERENCE_JUDGE === "force" ||
    process.env.COHERENCE_JUDGE === "1";
  const coherenceAllowRepair = process.env.COHERENCE_REPAIR !== "0"; // 기본 허용

  // hint 수집: continuity / delta 결과 중 fatal 후보가 될 만한 것
  // Phase 4.20 R2: judge 발동 임계 상향 — 단일 신호로 5-15s judge 실행을 막는다.
  //   - continuity issues (count)
  //   - delta repeated patterns (count)
  //   기준: 2개 이상 또는 (continuity 1+ AND delta 1+) 또는 force.
  const coherenceHints: string[] = [];
  const tracerAny = tracer as any;
  const continuityIssues = (tracerAny?.continuity_check?.issues ?? []) as string[];
  const deltaRepeats = (tracerAny?.episode_delta_check?.repeated_patterns ?? []) as string[];
  for (const i of continuityIssues) coherenceHints.push(`continuity: ${i}`);
  for (const p of deltaRepeats.slice(0, 3)) coherenceHints.push(`delta_repeat: ${p}`);

  // 임계 정밀화:
  //   threshold A: hints >= 2     (weak signal aggregated)
  //   threshold B: continuity >=1 AND delta >=1     (cross-check 일치 — 강한 시그널)
  //   threshold C: coherenceForce env var
  // 모두 미충족이면 judge skip (audit log만 남고 본문 변경 없음).
  const judgeThresholdMet =
    coherenceForce ||
    coherenceHints.length >= 2 ||
    (continuityIssues.length >= 1 && deltaRepeats.length >= 1);

  if (generatedText && judgeThresholdMet) {
    try {
      // 누적 요약: 직전 화 tail 정도만 (비용 제한)
      const prevSummary = ctx.prev_episode_tail
        ? `직전 화 tail: ${String(ctx.prev_episode_tail).slice(0, 1500)}`
        : undefined;

      // states for judge: scenePlan.character_state_updates를 그대로 (post-normalize)
      const judgeStates = (scenePlan.character_state_updates ?? []).map((u: any) => ({
        character_name: u.character_name,
        location: u.location ?? null,
        physical_state: u.physical_state ?? null,
        emotional_state: u.emotional_state ?? null,
        items: u.items ?? [],
        visibility_state: u.visibility_state ?? null,
      }));

      const result = await judgeAndRepair(
        {
          episode_number: ctx.episode_number,
          content: generatedText,
          states: judgeStates,
          prevSummary,
          hints: coherenceHints,
        },
        { force: coherenceForce, allowRepair: coherenceAllowRepair },
      );

      if (result.judge.judgeCalled) {
        logInfo("pipeline:coherence", "narrative coherence judge 결과", {
          episode: ctx.episode_number,
          fatal: result.judge.fatalIssues.length,
          major: result.judge.majorIssues.length,
          minor: result.judge.minorIssues.length,
          repaired: result.repaired.applied,
          repair_failed: result.repaired.failed,
          hints: coherenceHints.length,
        });
        if (result.repaired.applied > 0) {
          generatedText = result.finalContent;
        }
        if (tracer) {
          (tracer as any).coherence_check = {
            fatal: result.judge.fatalIssues.length,
            major: result.judge.majorIssues.length,
            minor: result.judge.minorIssues.length,
            repair_applied: result.repaired.applied,
            repair_failed: result.repaired.failed,
            judge_error: result.judge.judgeError,
          };
        }
      }
    } catch (err) {
      logWarn("pipeline:coherence", "judge/repair 실행 실패 — skip", { error: String(err) });
    }
  } else if (coherenceHints.length > 0) {
    // Phase 4.20 R2: 임계 미달로 judge skip — audit-only.
    logInfo("pipeline:coherence", "judge skip (threshold below)", {
      episode: ctx.episode_number,
      continuity_issues: continuityIssues.length,
      delta_repeats: deltaRepeats.length,
      hints: coherenceHints.length,
    });
    if (tracer) {
      (tracer as any).coherence_check = {
        skipped_below_threshold: true,
        continuity_issues: continuityIssues.length,
        delta_repeats: deltaRepeats.length,
      };
    }
  }

  // ─── Step 5.5: Character State Commit (planner 예측 → DB) ────
  const stateUpdates = scenePlan.character_state_updates ?? [];
  // R5B-1.7: planner의 character_emotional_beats를 추출 (carry-forward gating용)
  const emotionalBeats: Array<{
    name: string; previous_emotion?: string; current_emotion?: string;
    emotion_cause?: string; goal_delta?: string; behavior_delta?: string;
  }> = (scenePlan as any).character_emotional_beats ?? [];
  const _beatByName = new Map<string, typeof emotionalBeats[number]>();
  for (const b of emotionalBeats) _beatByName.set(b.name, b);
  if (stateUpdates.length === 0) {
    logWarn("pipeline", "character_state_updates 없음 — 상태 커밋 스킵", {
      episode: ctx.episode_number,
      plan_fallback: fallback_used,
    });
  }
  if (bookId && ctx.episode_number) {
    // canonical 이름 목록 (정규화 기준)
    const canonicalNames = ctx.characters.map(c => c.name);
    // normalization 통계
    const normStats = { exact_match: 0, drift_corrected: 0, orphan_skipped: 0, new_character_allowed: 0, descriptive_mention_skipped: 0 };
    // item/location ledger 통계
    const itemLedgerStats: ItemLedgerCheck = emptyItemLedgerCheck();
    const locationLedgerStats: LocationLedgerCheck = emptyLocationLedgerCheck();

    // beat locations fallback: character_state_updates에 location 없을 때 beat에서 추출
    const beatLocationMap = new Map<string, string>();
    for (const beat of scenePlan.scene_beats ?? []) {
      if (beat.location) {
        for (const charName of (beat as any).characters_involved ?? []) {
          if (!beatLocationMap.has(charName)) beatLocationMap.set(charName, beat.location);
        }
      }
    }

    // prev state map: canonical resolved name → prev (non-canonical legacy rows 제외)
    const prevMap = new Map<string, typeof ctx.character_dynamic_states[0]>();
    for (const d of ctx.character_dynamic_states) {
      const { name: rn } = resolveCanonicalCharName(d.character_name, canonicalNames, { episode: ctx.episode_number, bookId });
      if (rn) prevMap.set(rn, d);  // descriptive/orphan 제외
    }
    const canonicalItemMap = new Map(
      ctx.characters.map(c => [c.name, c.initial_items ?? []]),
    );

    // ── item dual-ownership guard ────────────────────────────────
    // 같은 아이템이 여러 인물의 stateUpdates에 동시에 등장하면 이중 소유 발생.
    // 규칙: 이전 화에서 소지하지 않았던 인물이 명시적으로 획득한 경우만 유지.
    // 이전 화에서 모두 미소지였다면 canonical 순서 첫 번째 인물에게만 귀속.
    if (stateUpdates.length > 1) {
      // Collect normalized item name → list of updater character names
      const itemOwnerCandidates = new Map<string, string[]>();
      for (const upd of stateUpdates) {
        if (!upd.items) continue;
        const resolvedUpd = resolveCanonicalCharName(upd.character_name, canonicalNames).name;
        if (!resolvedUpd) continue;
        for (const it of upd.items as any[]) {
          const rawName: string = typeof it === "string" ? it : (it?.name ?? "");
          const normKey = rawName.replace(/[（(][^）)]+[）)]/g, "").trim().toLowerCase();
          if (normKey.length < 2) continue;
          if (!itemOwnerCandidates.has(normKey)) itemOwnerCandidates.set(normKey, []);
          itemOwnerCandidates.get(normKey)!.push(resolvedUpd);
        }
      }
      // For items with multiple candidates, keep only the one who newly acquired it
      for (const [normKey, owners] of itemOwnerCandidates.entries()) {
        if (owners.length < 2) continue;
        // canonical 다중 인스턴스 (각 인물이 자기 것을 갖고 있는 경우) 스킵
        // — 모든 후보 owner의 initial_items에 해당 normKey가 있으면 정상
        const allCanonicalOwners = owners.every(o => {
          const ci = canonicalItemMap.get(o) ?? [];
          return ci.some((c: any) => {
            const n: string = typeof c === "string" ? c : (c?.name ?? "");
            return n.replace(/[（(][^）)]+[）)]/g, "").trim().toLowerCase() === normKey;
          });
        });
        if (allCanonicalOwners) continue;
        // canonical 단일 인스턴스 (한 인물의 initial_items에만 있는 unique item) 추적
        const canonicalOwners = owners.filter(o => {
          const ci = canonicalItemMap.get(o) ?? [];
          return ci.some((c: any) => {
            const n: string = typeof c === "string" ? c : (c?.name ?? "");
            return n.replace(/[（(][^）)]+[）)]/g, "").trim().toLowerCase() === normKey;
          });
        });
        // Find who had it before
        const prevOwners = owners.filter(o => {
          const prevItems: any[] = prevMap.get(o)?.items ?? [];
          return prevItems.some(i => {
            const n: string = typeof i === "string" ? i : (i?.name ?? "");
            return n.replace(/[（(][^）)]+[）)]/g, "").trim().toLowerCase() === normKey;
          });
        });
        const newOwners = owners.filter(o => !prevOwners.includes(o));
        // Keeper 우선순위:
        // 1. canonical owner (initial_items에 있음) — unique item은 본 주인이 우선
        // 2. prev owner (이전 화 소지자) — 누적 상태 유지
        // 3. newOwners — 신규 획득
        // 이전 로직(newOwners 우선)이 unique item에서 canonical owner를 빼앗던 버그 수정
        const keeper = canonicalOwners[0] ?? prevOwners[0] ?? newOwners[0] ?? owners[0];
        // Remove from non-keepers' stateUpdates
        for (const upd of stateUpdates) {
          const resolvedUpd = resolveCanonicalCharName(upd.character_name, canonicalNames).name;
          if (!resolvedUpd || resolvedUpd === keeper) continue;
          if (!owners.includes(resolvedUpd)) continue;
          upd.items = ((upd.items ?? []) as any[]).filter((it: any) => {
            const rawName: string = typeof it === "string" ? it : (it?.name ?? "");
            return rawName.replace(/[（(][^）)]+[）)]/g, "").trim().toLowerCase() !== normKey;
          });
        }
        logInfo("pipeline:itemLedger", `이중 소유 guard: "${normKey}" keeper=${keeper} removed_from=[${owners.filter(o => o !== keeper).join(",")}]`, {});
      }
    }

    // ── direct commit: planner가 명시한 상태 업데이트 ──────────
    if (stateUpdates.length > 0) {
      for (const upd of stateUpdates) {
        try {
          // Entity Resolution — descriptive_mention/orphan은 커밋 스킵 (Phase 2)
          const { name: resolvedName, event: normEvent } = resolveCanonicalCharName(
            upd.character_name, canonicalNames, { episode: ctx.episode_number, bookId },
          );
          normStats[normEvent]++;
          if (!resolvedName) continue; // descriptive_mention / orphan → 커밋 스킵

          const prev = prevMap.get(resolvedName) ?? prevMap.get(upd.character_name);
          const canonicalItems = canonicalItemMap.get(resolvedName) ?? [];
          // item ledger: skill reject + canonical name 복원 + condition 분리 + carry-forward
          const normalizedItems = normalizeItems(
            upd.items as import("../types/canonical.js").ItemEntry[] | undefined,
            canonicalItems,
            prev?.items ?? [],
            itemLedgerStats,
          );
          const resolvedLocation =
            upd.location ??
            beatLocationMap.get(upd.character_name) ??
            beatLocationMap.get(resolvedName) ??
            prev?.location ?? undefined;
          // location ledger: 변화 추적
          const locEntry = checkLocationChange(prev?.location, resolvedLocation ?? undefined, ctx.episode_number, resolvedName);
          if (locEntry.is_abrupt) locationLedgerStats.abrupt_location_change_count++;
          else if (resolvedLocation === prev?.location || !resolvedLocation) locationLedgerStats.location_carry_forward_count++;
          if (!resolvedLocation) locationLedgerStats.missing_location_count++;
          // language guard: planner가 영어로 반환한 상태 필드를 한국어로 정규화
          const rawEmotional = upd.emotional_state ?? prev?.emotional_state ?? undefined;
          const rawPhysical  = upd.physical_state  ?? prev?.physical_state  ?? undefined;
          const rawGoal      = upd.recent_goal     ?? prev?.recent_goal     ?? undefined;

          // R5B-1.7: carry-forward gating + fake progression detection
          // appeared_in_episode=true 인 인물(scene_beats characters_involved에 포함)에 대해
          // emotional_state가 prev와 동일하면 character_emotional_beats의 cause/goal/behavior delta가
          // 채워져 있는지 확인. 모두 비어있으면 silent carry-forward fake risk로 간주 + warn.
          const _isAppearedInBeats = (scenePlan.scene_beats ?? []).some((b: any) =>
            Array.isArray(b?.characters_involved) && b.characters_involved.includes(resolvedName)
          );
          const _emoSame = !!rawEmotional && !!prev?.emotional_state && rawEmotional === prev.emotional_state;
          const _goalSame = !!rawGoal && !!prev?.recent_goal && rawGoal.trim() === prev.recent_goal.trim();
          const _beat = _beatByName.get(resolvedName) ?? _beatByName.get(upd.character_name);
          const _hasDelta = !!(_beat?.emotion_cause || _beat?.goal_delta || _beat?.behavior_delta);
          if (_isAppearedInBeats && _emoSame && _goalSame && !_hasDelta) {
            logWarn("pipeline:emotional_progression", "carry_forward_without_delta — fake progression risk", {
              book_id: bookId, episode: ctx.episode_number, character: resolvedName,
              emotional_state: rawEmotional, has_beat: !!_beat,
              note: "appeared 인물 + emotion/goal 둘 다 동일 + emotional_beat의 cause/goal_delta/behavior_delta 모두 없음",
            });
          }

          await commitDynamicState({
            book_id:        bookId,
            character_name: resolvedName,
            episode_number: ctx.episode_number,
            location:       normalizeLocation(locEntry.current_location) ?? locEntry.current_location,
            physical_state: normalizePhysicalState(rawPhysical) ?? rawPhysical,
            emotional_state: normalizeEmotionalState(rawEmotional) ?? rawEmotional,
            items:          normalizedItems as import("../types/canonical.js").ItemEntry[],
            visibility_state: upd.visibility_state ?? prev?.visibility_state ?? "present",
            recent_goal:    normalizeRecentGoal(rawGoal) ?? "이전 목표 유지",
            relationship_updates:   prev?.relationship_updates   ?? {},
            foreshadow_connections: prev?.foreshadow_connections ?? [],
            behavior_hints: prev?.behavior_hints ?? undefined,
            alias_used:     prev?.alias_used     ?? [],
          });
        } catch (err) {
          logWarn("pipeline", "캐릭터 상태 커밋 실패 (skip)", {
            character: upd.character_name, error: String(err),
          });
        }
      }
    }

    // ── carry-forward + absent-seed: stateUpdates 여부와 무관하게 항상 실행 ──
    const updatedNames = new Set(
      stateUpdates.map(u => resolveCanonicalCharName(u.character_name, canonicalNames).name).filter(Boolean)
    );
    // 플래너가 언급하지 않은 인물 → 이전 상태 그대로 absent로 carry-forward
    // canonical에 속하는 인물만 (orphan 전파 방지)
    for (const prev of ctx.character_dynamic_states) {
      const { name: resolvedPrevName } = resolveCanonicalCharName(prev.character_name, canonicalNames);
      if (!resolvedPrevName) continue; // orphan → carry-forward 스킵
      if (updatedNames.has(resolvedPrevName)) continue;
      try {
        // carry-forward: 영어 오염 방지 + item ledger 정규화
        const prevCanonItems = canonicalItemMap.get(resolvedPrevName) ?? [];
        const normalizedPrevItems = normalizeItems(
          prev.items ?? [],
          prevCanonItems,
          [],
          itemLedgerStats,
        );
        locationLedgerStats.location_carry_forward_count++;
        await commitDynamicState({
          book_id:        bookId,
          character_name: resolvedPrevName,
          episode_number: ctx.episode_number,
          location:       normalizeLocation(prev.location) ?? prev.location,
          physical_state: normalizePhysicalState(prev.physical_state) ?? prev.physical_state,
          emotional_state: normalizeEmotionalState(prev.emotional_state) ?? prev.emotional_state,
          items:          normalizedPrevItems as import("../types/canonical.js").ItemEntry[],
          visibility_state: "absent",
          recent_goal:    normalizeRecentGoal(prev.recent_goal) ?? "이전 목표 유지",
          relationship_updates:   prev.relationship_updates ?? {},
          foreshadow_connections: prev.foreshadow_connections ?? [],
          behavior_hints: prev.behavior_hints,
          alias_used:     prev.alias_used ?? [],
        });
      } catch { /* skip */ }
    }
    // canonical 인물 중 prev state도 없고 planner 언급도 없는 인물 → absent seed
    // prevNames: canonical resolved name 기준 (non-canonical legacy row가 absent seed를 막지 않도록)
    const prevNames = new Set<string>(
      [...prevMap.keys()]  // prevMap은 이미 canonical-only로 필터됨
    );
    for (const canonical of ctx.characters) {
      if (updatedNames.has(canonical.name) || prevNames.has(canonical.name)) continue;
      try {
        await commitDynamicState({
          book_id:        bookId,
          character_name: canonical.name,
          episode_number: ctx.episode_number,
          location:       "미등장",
          physical_state: "정상",
          emotional_state: "알 수 없음",
          items:          (canonical.initial_items ?? []) as import("../types/canonical.js").ItemEntry[],
          visibility_state: "absent",
          recent_goal:    "이전 목표 유지",
          relationship_updates:   {},
          foreshadow_connections: [],
          behavior_hints: undefined,
          alias_used:     [],
        });
      } catch { /* skip */ }
    }
    const canonicalExpected = ctx.characters.length;
    logInfo("pipeline", "캐릭터 상태 커밋 완료", {
      episode: ctx.episode_number,
      committed: stateUpdates.map(u => u.character_name),
      state_source: stateUpdates.length > 0 ? "planner" : "carried_forward",
      norm_stats: normStats,
      state_rows_expected: canonicalExpected,
      state_rows_committed: stateUpdates.length,
      state_rows_missing: Math.max(0, canonicalExpected - stateUpdates.length),
      item_ledger: itemLedgerStats,
      location_ledger: locationLedgerStats,
    });
    // tracer에 item/location ledger 메타데이터 첨부
    if (tracer) {
      (tracer as any).item_ledger_check = itemLedgerStats;
      (tracer as any).location_ledger_check = locationLedgerStats;
    }
  }

  // ─── Step 6: Prose Validation (기존 validator.ts) ────────────
  let proseValidation: ValidationResult;
  if (doValidate) {
    notify("문장 품질과 서사 일관성을 검토하는 중...");
    proseValidation = await validate(generatedText, ctx, { promptVersion });
    tracer?.setProseValidation(proseValidation);
  } else {
    proseValidation = {
      verdict: "PASS" as Verdict,
      hard_violations: [],
      soft_warnings: [],
      quality_scores: EMPTY_QUALITY_SCORES,
      total_score: 80,
      summary: "검증 스킵 (doValidate=false)",
    };
  }

  // ─── Step 7: Revision (기존 revision.ts, optional) ───────────
  let finalVerdict: Verdict = proseValidation.verdict;
  let finalScore             = proseValidation.total_score;
  let revisionCount          = 0;

  if (doRevise && (finalVerdict === "FAIL" || finalVerdict === "WARN")) {
    notify("퇴고 중... 조금만 더 기다려주세요.");
    const revised = await reviseUntilPass(generatedText, proseValidation, ctx, { promptVersion });
    finalVerdict  = revised.final_verdict;
    finalScore    = revised.final_score;
    revisionCount = revised.iterations;
  }

  const totalElapsed = Date.now() - t0;
  tracer?.finalize({ final_verdict: finalVerdict, final_score: finalScore, revision_count: revisionCount, total_elapsed_ms: totalElapsed });
  let savedTraceId: string | undefined;
  if (tracer && tracePool) {
    savedTraceId = await tracer.save(tracePool);
    // reward 계산은 background_audit가 담당 (v2 reward를 같은 trace에 적용)
  }

  logInfo("pipeline", "파이프라인 완료", {
    plan_verdict:  planValidation.verdict,
    prose_verdict: finalVerdict,
    score:         finalScore,
    elapsed_ms:    totalElapsed,
  });

  return {
    scene_plan:        scenePlan,
    plan_validation:   planValidation,
    generated_text:    generatedText,
    prose_validation:  proseValidation,
    final_verdict:     finalVerdict,
    final_score:       finalScore,
    revision_count:    revisionCount,
    elapsed_ms:        totalElapsed,
    planner_elapsed_ms,
    renderer_elapsed_ms,
    plan_fallback_used: fallback_used,
    trace_id:          savedTraceId,
  };
}

// Re-export for convenience
export { extractStateConstraints } from "./state_extractor.js";
export { runCreativePlanner }      from "./planner.js";
export { validatePlan, repairPlan } from "./plan_validator.js";
export { renderFromPlan, renderFromPlanWithTrace } from "./renderer.js";
