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
import type { EffectiveContext, ValidationResult, Verdict } from "../types/canonical.js";
import type { ScenePlan, PlannerPipelineResult } from "../types/planner.js";
import { extractStateConstraints } from "./state_extractor.js";
import { runCreativePlanner } from "./planner.js";

/**
 * 인물 이름 정규화 — LLM이 출력한 character_name을 canonical 이름으로 매핑.
 *
 * 이벤트 분류 (범용, 모든 책/인물에 공통 적용):
 *   exact_match        — canonical 완전 일치
 *   drift_corrected    — prefix 근접 일치로 canonical 교체 (예: "빅토리아" → "빅토리")
 *   orphan_skipped     — 비한국어 문자 포함, 커밋 스킵
 *   new_character_allowed — 한국어 신규 인물, 허용
 */
type CharNormEvent = "exact_match" | "drift_corrected" | "orphan_skipped" | "new_character_allowed";

function resolveCanonicalCharName(
  raw: string,
  canonicalNames: string[],
): { name: string | null; event: CharNormEvent } {
  const trimmed = raw.trim();
  if (!trimmed) return { name: null, event: "orphan_skipped" };

  // 1. 완전 일치
  if (canonicalNames.includes(trimmed)) return { name: trimmed, event: "exact_match" };

  // 2. 근접 일치: canonical이 raw의 prefix이거나 raw가 canonical의 prefix
  for (const cname of canonicalNames) {
    if (trimmed.startsWith(cname) || cname.startsWith(trimmed)) {
      logWarn("pipeline:charNorm", "drift_corrected — canonical로 정규화", { raw: trimmed, canonical: cname });
      return { name: cname, event: "drift_corrected" };
    }
  }

  // 3. 비한국어 문자 포함 → orphan 스킵
  // Latin, CJK (중국/일본), 태국어(U+0E00-U+0E7F), 기타 비한글 비공백 유니코드
  const hasNonKorean = /[A-Za-z]/.test(trimmed)
    || /[一-鿿㐀-䶿]/.test(trimmed)         // CJK
    || /[฀-๿]/.test(trimmed)       // Thai
    || /[Ѐ-ӿ]/.test(trimmed)       // Cyrillic
    || /[؀-ۿ]/.test(trimmed)       // Arabic
    || /[぀-ゟ゠-ヿ]/.test(trimmed); // Hiragana/Katakana
  if (hasNonKorean) {
    logWarn("pipeline:charNorm", "orphan_skipped — 비한국어 이름", { raw: trimmed });
    return { name: null, event: "orphan_skipped" };
  }

  // 4. 한국어 신규 인물 — 허용하되 경고
  logWarn("pipeline:charNorm", "new_character_allowed — canonical 외 신규 인물", { raw: trimmed });
  return { name: trimmed, event: "new_character_allowed" };
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
  } = opts;
  const notify = (msg: string) => { onStatus?.(msg); };

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
  const t_plan0 = Date.now();
  const { plan: creativePlan, fallback_used, raw_output } = await runCreativePlanner(ctx, stateConstraints, plannerModelOverride);
  const planner_elapsed_ms = Date.now() - t_plan0;
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
  const t_render0 = Date.now();
  let generatedText = "";
  let rawRenderedText = "";
  try {
    const renderResult = await renderFromPlanWithTrace(scenePlan, ctx, rendererModelOverride);
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
    generatedText = rawRenderedText;
    tracer?.setRendererTrace({
      system_prompt:  renderResult.system_prompt,
      user_prompt:    renderResult.user_prompt,
      generated_text: renderResult.text,
      elapsed_ms:     renderResult.elapsed_ms,
      model_used:     renderResult.model_used,
    });
  } catch (err) {
    logWarn("pipeline", "렌더링 오류", { error: String(err) });
  }
  const renderer_elapsed_ms = Date.now() - t_render0;

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

  // ─── Step 5.5: Character State Commit (planner 예측 → DB) ────
  const stateUpdates = scenePlan.character_state_updates ?? [];
  if (stateUpdates.length === 0) {
    logWarn("pipeline", "character_state_updates 없음 — 상태 커밋 스킵", {
      episode: ctx.episode_number,
      plan_fallback: fallback_used,
    });
  }
  if (stateUpdates.length > 0 && bookId && ctx.episode_number) {
    // canonical 이름 목록 (정규화 기준)
    const canonicalNames = ctx.characters.map(c => c.name);
    // normalization 통계
    const normStats = { exact_match: 0, drift_corrected: 0, orphan_skipped: 0, new_character_allowed: 0 };

    // beat locations fallback: character_state_updates에 location 없을 때 beat에서 추출
    const beatLocationMap = new Map<string, string>();
    for (const beat of scenePlan.scene_beats ?? []) {
      if (beat.location) {
        for (const charName of (beat as any).characters_involved ?? []) {
          if (!beatLocationMap.has(charName)) beatLocationMap.set(charName, beat.location);
        }
      }
    }

    // prev state map: name → prev (이전 상태 유지 병합용)
    const prevMap = new Map(
      ctx.character_dynamic_states.map(d => [d.character_name, d]),
    );
    const canonicalItemMap = new Map(
      ctx.characters.map(c => [c.name, c.initial_items ?? []]),
    );
    for (const upd of stateUpdates) {
      try {
        // 이름 정규화 — drift/orphan 차단
        const { name: resolvedName, event: normEvent } = resolveCanonicalCharName(upd.character_name, canonicalNames);
        normStats[normEvent]++;
        if (!resolvedName) continue; // orphan → 커밋 스킵

        const prev = prevMap.get(resolvedName) ?? prevMap.get(upd.character_name);
        const canonicalItems = canonicalItemMap.get(resolvedName) ?? [];
        // items 우선순위: planner 출력 > prev dynamic > canonical initial_items
        const resolvedItems = (upd.items?.length ?? 0) > 0
          ? upd.items!
          : (prev?.items?.length ?? 0) > 0
            ? prev!.items!
            : canonicalItems;
        const resolvedLocation =
          upd.location ??
          beatLocationMap.get(upd.character_name) ??
          beatLocationMap.get(resolvedName) ??
          prev?.location ?? undefined;
        await commitDynamicState({
          book_id:        bookId,
          character_name: resolvedName,
          episode_number: ctx.episode_number,
          location:       resolvedLocation,
          physical_state: upd.physical_state ?? prev?.physical_state ?? undefined,
          emotional_state: upd.emotional_state,
          items:          resolvedItems as import("../types/canonical.js").ItemEntry[],
          visibility_state: upd.visibility_state ?? prev?.visibility_state ?? "present",
          recent_goal:    upd.recent_goal      ?? prev?.recent_goal ?? undefined,
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
    // 플래너가 언급하지 않은 인물 → 이전 상태 그대로 absent로 커밋
    // canonical에 속하는 인물만 carry-forward (orphan 전파 방지)
    const updatedNames = new Set(stateUpdates.map(u => resolveCanonicalCharName(u.character_name, canonicalNames).name).filter(Boolean));
    for (const prev of ctx.character_dynamic_states) {
      const { name: resolvedPrevName } = resolveCanonicalCharName(prev.character_name, canonicalNames);
      if (!resolvedPrevName) continue; // orphan → carry-forward 스킵
      if (updatedNames.has(resolvedPrevName)) continue;
      try {
        await commitDynamicState({
          book_id:        bookId,
          character_name: resolvedPrevName,
          episode_number: ctx.episode_number,
          location:       prev.location,
          physical_state: prev.physical_state,
          emotional_state: prev.emotional_state,
          items:          prev.items ?? [],
          visibility_state: "absent",
          recent_goal:    prev.recent_goal,
          relationship_updates:   prev.relationship_updates ?? {},
          foreshadow_connections: prev.foreshadow_connections ?? [],
          behavior_hints: prev.behavior_hints,
          alias_used:     prev.alias_used ?? [],
        });
      } catch { /* skip */ }
    }
    // canonical 인물 중 prev state도 없고 planner 언급도 없는 인물 → absent seed 커밋
    // (예: 1화에서 적대 세력 인물이 플래너에 포함되지 않는 경우)
    const prevNames = new Set(ctx.character_dynamic_states.map(d => d.character_name));
    for (const canonical of ctx.characters) {
      if (updatedNames.has(canonical.name) || prevNames.has(canonical.name)) continue;
      try {
        await commitDynamicState({
          book_id:        bookId,
          character_name: canonical.name,
          episode_number: ctx.episode_number,
          location:       undefined,
          physical_state: undefined,
          emotional_state: undefined,
          items:          (canonical.initial_items ?? []) as import("../types/canonical.js").ItemEntry[],
          visibility_state: "absent",
          recent_goal:    undefined,
          relationship_updates:   {},
          foreshadow_connections: [],
          behavior_hints: undefined,
          alias_used:     [],
        });
      } catch { /* skip */ }
    }
    logInfo("pipeline", "캐릭터 상태 커밋 완료", {
      episode: ctx.episode_number,
      committed: stateUpdates.map(u => u.character_name),
      norm_stats: normStats,  // exact_match / drift_corrected / orphan_skipped / new_character_allowed
    });
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
