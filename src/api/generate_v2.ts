/**
 * generate_v2.ts — 구조화 입력 기반 에피소드 생성 엔드포인트
 *
 * POST /api/generate-v2
 *
 * 기존 GET /api/generate는 유지하면서 새로운 구조화 입력을 지원한다.
 *
 * 요청 바디:
 * {
 *   book_id: string,
 *   episode: number,
 *   gen_config?: Partial<GenConfig>,
 *   task?: Partial<EpisodeTask>,
 *   prev_episode_state?: Partial<PrevEpisodeState>,
 *   validate?: boolean,        // 생성 후 검증 여부 (기본 false)
 *   revise?: boolean,          // 검증 실패 시 자동 리비전 여부 (기본 false)
 *   prompt_version?: "A"|"B"   // 검증 프롬프트 버전 (기본 "A")
 *   use_planner?: boolean,     // Planner→Renderer 파이프라인 사용 (기본 false = legacy)
 *   skip_render_on_plan_fail?: boolean  // 계획 실패 시 렌더링 스킵 (기본 false)
 *   enable_trace?: boolean     // run_traces 테이블에 실행 궤적 저장 (기본 false, use_planner=true 시에만 적용)
 * }
 *
 * SSE 이벤트:
 * data: {"token": "..."}          (legacy 경로 스트리밍)
 * data: {"done": true, "chars": N}
 * data: {"plan": {...}}           (use_planner=true일 때 — ScenePlan + PlanValidation)
 * data: {"validation": {...}}     (validate=true일 때)
 * data: {"revision": {...}}       (revise=true일 때)
 */

import { Router, Request, Response } from "express";
import { streamEpisode } from "../services/story.js";
import { buildEffectiveContext, effectiveContextToStoryContext, saveEpisodeSnapshot } from "../services/effective_context.js";
import { buildFallbackSummary, generateAndSaveLLMSummary, SUMMARY_FALLBACK_MARKER } from "../services/episode_summary.js";
import { validate } from "../services/validator.js";
import { reviseUntilPass } from "../services/revision.js";
import { runPlannerPipeline } from "../pipeline/index.js";
import { getLatestDynamicStates } from "../services/character_state.js";
import { scheduleBackgroundAudit } from "../training/background_audit.js";
import { extractAndStoreForeshadow, checkAndResolveForeshadows } from "../services/foreshadow.js";
import { generateAndSaveArcSummary, ARC_SIZE } from "../services/arc_memory.js";
import { buildRegenDivergenceContract, detectGenerationMode } from "../services/regen_divergence.js";
import { pool } from "../lib/db.js";
import { logInfo, logError, logWarn } from "../lib/logger.js";
import type { GenConfig, EpisodeTask, PrevEpisodeState } from "../types/canonical.js";

export const generateV2Router = Router();

generateV2Router.post("/", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const {
    book_id: bookId,
    episode,
    gen_config: overrideGenConfig,
    task: overrideTask,
    prev_episode_state: overridePrevState,
    validate: doValidate = false,
    revise: doRevise = false,
    prompt_version: promptVersion = "A",
    use_planner: usePlanner = false,
    skip_render_on_plan_fail: skipRenderOnPlanFail = false,
    enable_trace: enableTrace = false,
    planner_model: plannerModelOverride,
    renderer_model: rendererModelOverride,
    model_route: modelRoute,
  } = req.body as {
    book_id: string;
    episode: number;
    gen_config?: Partial<GenConfig>;
    task?: Partial<EpisodeTask>;
    prev_episode_state?: Partial<PrevEpisodeState>;
    validate?: boolean;
    revise?: boolean;
    prompt_version?: "A" | "B";
    use_planner?: boolean;
    skip_render_on_plan_fail?: boolean;
    enable_trace?: boolean;
    planner_model?: string;
    renderer_model?: string;
    /** Phase 4.14 — config/model_routes.json 의 route_set 이름. 미지정 시 active route 사용. */
    model_route?: string;
  };

  if (!bookId || !episode) {
    send({ error: "book_id와 episode는 필수입니다" });
    res.end();
    clearInterval(heartbeat);
    return;
  }

  logInfo("api:generate_v2", "V2 생성 시작", {
    book_id: bookId, episode, do_validate: doValidate, do_revise: doRevise,
    use_planner: usePlanner, has_gen_config: !!overrideGenConfig, has_task: !!overrideTask,
  });

  try {
    // ── 재생성 시 derived memory isolation ────────────────────────
    // 해당 화의 기존 dynamic states / foreshadows를 정리해 이전 재생성 오염 방지
    // (canonical world bible / characters / initial items는 유지)
    if (episode >= 1) {
      await pool.query(
        `DELETE FROM character_dynamic_states WHERE book_id=$1 AND episode_number=$2`,
        [bookId, episode]
      ).catch(() => {});
      await pool.query(
        `DELETE FROM foreshadows WHERE book_id=$1 AND planted_episode=$2`,
        [bookId, episode]
      ).catch(() => {});
      logInfo("api:generate_v2", "재생성 memory isolation 완료", { book_id: bookId, episode });
    }

    // ── 유효 컨텍스트 조립 ─────────────────────────────────────
    const ctx = await buildEffectiveContext({
      bookId, episodeNumber: episode,
      overrideGenConfig, overrideTask, overridePrevState,
    });

    // Phase 4.18 — 재생성 감지 + divergence contract 주입 (generate.ts와 동기화)
    try {
      const mode = await detectGenerationMode(bookId, episode);
      (ctx as any).regen_mode = mode;
      if (mode === "episode1_regeneration" || mode === "latest_episode_regeneration") {
        const contract = await buildRegenDivergenceContract(bookId, episode, mode);
        if (contract) (ctx as any).regen_divergence_contract = contract;
        logInfo("api:generate_v2", "regen contract attached", {
          book_id: bookId, episode, mode,
          attempt_count: contract?.attempt_count ?? 0,
        });
      }
    } catch (e) {
      logWarn("api:generate_v2", "regen contract build failed (계속 진행)", { error: String(e) });
    }

    // 스냅샷 저장 (fire-and-forget)
    saveEpisodeSnapshot({ ...ctx, book_id: bookId } as any).catch(() => {});

    // character dynamic state snapshot — done 이벤트에 포함 (generate.ts와 필드 정합)
    const ctxCanonChars = ctx.characters ?? [];
    const charStateSnapshot = ctx.character_dynamic_states.map(s => {
      const canon = ctxCanonChars.find(c => c.name === s.character_name);
      return {
        character_name:   s.character_name,
        type:             canon?.type            ?? null,
        gender:           canon?.gender          ?? null,
        location:         s.location             ?? null,
        physical_state:   s.physical_state       ?? null,
        items:            s.items                ?? [],
        emotional_state:  s.emotional_state      ?? null,
        visibility_state: s.visibility_state     ?? "present",
        is_new_character: !canon,
      };
    });

    const t0 = Date.now();
    let fullText = "";

    if (usePlanner) {
      // ── Planner→Renderer 파이프라인 경로 ─────────────────────
      const pipelineResult = await runPlannerPipeline(ctx, {
        doRevise: false,  // 리비전은 아래에서 별도 처리
        promptVersion,
        skipRenderOnPlanFail,
        // enable_trace=true 시 학습 궤적 수집 (run_traces 테이블)
        tracePool: enableTrace ? pool : undefined,
        bookId: bookId ?? undefined,
        plannerModelOverride,
        rendererModelOverride,
        routeSetOverride: modelRoute,
      });

      fullText = pipelineResult.generated_text;
      clearInterval(heartbeat);

      // episode content 저장 (generate.ts와 동일 패턴)
      if (bookId && fullText) {
        try {
          // R5B-1: fallback marker 부착
          const fallbackSummary = buildFallbackSummary(fullText);
          await pool.query(
            `INSERT INTO episodes (book_id, episode_number, content, summary)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (book_id, episode_number) DO UPDATE
               SET content = EXCLUDED.content,
                   summary = CASE
                     WHEN episodes.summary IS NULL OR episodes.summary = '' THEN EXCLUDED.summary
                     WHEN episodes.summary LIKE $5 || '%' THEN EXCLUDED.summary
                     ELSE episodes.summary
                   END`,
            [bookId, episode, fullText, fallbackSummary, SUMMARY_FALLBACK_MARKER]
          );
          await pool.query(
            `UPDATE books SET current_episode = GREATEST(current_episode, $1), updated_at = NOW() WHERE id = $2`,
            [episode + 1, bookId]
          );
          // arc + foreshadow + summary 후처리 (비동기, 실패 무시)
          setImmediate(async () => {
            // R5B-1: LLM summary로 fallback 덮어쓰기
            try {
              await generateAndSaveLLMSummary({ pool, bookId, episodeNumber: episode, content: fullText });
            } catch (e) {
              logError("api:generate_v2", e, { context: "summary llm post-processing", episode });
            }
            try {
              await extractAndStoreForeshadow(bookId, episode, fullText);
              await checkAndResolveForeshadows(bookId, episode, fullText);
            } catch (e) {
              logError("api:generate_v2", e, { context: "foreshadow post-processing", episode });
            }
            try {
              const snapRow = await pool.query(
                `SELECT effective_context->'gen_config'->>'totalEpisodes' AS total_episodes
                 FROM episode_snapshots WHERE book_id=$1 AND episode_number=$2 LIMIT 1`,
                [bookId, episode]
              );
              const totalEpisodes = parseInt(snapRow.rows[0]?.total_episodes ?? "0", 10) || 0;
              const isArcComplete = episode % ARC_SIZE === 0;
              const isShortFinal  = totalEpisodes > 0 && totalEpisodes < ARC_SIZE && episode >= totalEpisodes;
              if (isArcComplete || isShortFinal) {
                const canonRes = await pool.query(
                  "SELECT name FROM canonical_characters WHERE book_id=$1 ORDER BY name",
                  [bookId]
                );
                const characterNames = canonRes.rows.map((r: { name: string }) => r.name);
                if (isArcComplete) {
                  const arcNumber = episode / ARC_SIZE;
                  await generateAndSaveArcSummary(bookId, arcNumber, characterNames);
                } else {
                  await generateAndSaveArcSummary(bookId, 1, characterNames, episode);
                }
              }
            } catch (e) {
              logError("api:generate_v2", e, { context: "arc summary post-processing", episode });
            }
          });
        } catch (saveErr) {
          logError("api:generate_v2", saveErr, { context: "episode content save", episode });
        }
      }

      // planner path: pipeline이 commitDynamicState를 완료한 후이므로 재조회
      const wbCtxDefs = ctx?.characters ?? [];
      const freshCharStates = bookId
        ? (await getLatestDynamicStates(bookId, episode).catch(() => [])).map(s => {
            const canon = wbCtxDefs.find(c => c.name === s.character_name);
            return {
              character_name:   s.character_name,
              type:             canon?.type            ?? null,
              gender:           canon?.gender          ?? null,
              location:         s.location             ?? null,
              physical_state:   s.physical_state       ?? null,
              items:            s.items                ?? [],
              emotional_state:  s.emotional_state      ?? null,
              visibility_state: s.visibility_state     ?? "present",
              is_new_character: !canon,
            };
          })
        : charStateSnapshot;
      send({
        done: true, chars: fullText.length, elapsed_ms: Date.now() - t0,
        char_states: freshCharStates,
        episode_meta: {
          plan_verdict:      pipelineResult.plan_validation.verdict,
          final_score:       pipelineResult.final_score,
          revision_count:    pipelineResult.revision_count,
          plan_fallback_used: pipelineResult.plan_fallback_used,
        },
      });
      send({
        plan: {
          scene_plan: pipelineResult.scene_plan,
          plan_validation: {
            verdict: pipelineResult.plan_validation.verdict,
            issues: pipelineResult.plan_validation.issues.length,
            passed: pipelineResult.plan_validation.passed_checks.length,
          },
          planner_elapsed_ms: pipelineResult.planner_elapsed_ms,
          renderer_elapsed_ms: pipelineResult.renderer_elapsed_ms,
          plan_fallback_used: pipelineResult.plan_fallback_used,
        },
      });

      if (doValidate) {
        send({ validation: pipelineResult.prose_validation });
        if (doRevise && (pipelineResult.prose_validation.verdict === "FAIL" || pipelineResult.prose_validation.verdict === "WARN")) {
          const revisionResult = await reviseUntilPass(fullText, pipelineResult.prose_validation, ctx, { promptVersion });
          send({ revision: {
            verdict: revisionResult.final_verdict, score: revisionResult.final_score,
            iterations: revisionResult.iterations, absolute_blocked: revisionResult.absolute_blocked,
          }});
          if (revisionResult.iterations > 0 && !revisionResult.absolute_blocked) {
            send({ revised_text: revisionResult.final_text });
          }
        }
      }

      // enable_trace=true 시 background_audit로 reward v2 적용 (기존 trace에 UPDATE)
      if (enableTrace && ctx && bookId) {
        scheduleBackgroundAudit(ctx, pipelineResult, bookId, pool, pipelineResult.trace_id);
      }

      logInfo("api:generate_v2", "플래너 파이프라인 완료", {
        book_id: bookId, episode, chars: fullText.length,
        plan_verdict: pipelineResult.plan_validation.verdict,
        prose_verdict: pipelineResult.final_verdict,
        elapsed_ms: Date.now() - t0,
      });
    } else {
      // ── Legacy 경로 (story.ts SSE 스트리밍) ──────────────────
      const storyCtx = effectiveContextToStoryContext(ctx);
      fullText = await streamEpisode(storyCtx as any, res);
      clearInterval(heartbeat);
      send({ done: true, chars: fullText.length, elapsed_ms: Date.now() - t0, char_states: charStateSnapshot });

      logInfo("api:generate_v2", "레거시 생성 완료", {
        book_id: bookId, episode, chars: fullText.length, elapsed_ms: Date.now() - t0,
      });

      if (doValidate) {
        const validation = await validate(fullText, ctx, { bookId, episodeNumber: episode, iteration: 1, promptVersion });
        send({ validation });
        if (doRevise && (validation.verdict === "FAIL" || validation.verdict === "WARN")) {
          const revisionResult = await reviseUntilPass(fullText, validation, ctx, { bookId, episodeNumber: episode, promptVersion });
          send({ revision: {
            verdict: revisionResult.final_verdict, score: revisionResult.final_score,
            iterations: revisionResult.iterations, absolute_blocked: revisionResult.absolute_blocked,
          }});
          if (revisionResult.iterations > 0 && !revisionResult.absolute_blocked) {
            send({ revised_text: revisionResult.final_text });
          }
        }
      }
    }
  } catch (err) {
    clearInterval(heartbeat);
    logError("api:generate_v2", err, { book_id: bookId, episode });
    send({ error: "generation failed" });
  }

  res.end();
});

// ── 단건 검증 전용 엔드포인트 ─────────────────────────────────
generateV2Router.post("/validate-only", async (req: Request, res: Response) => {
  const { book_id: bookId, episode, text, prompt_version = "A" } = req.body as {
    book_id: string; episode: number; text: string; prompt_version?: "A" | "B";
  };

  if (!bookId || !episode || !text) {
    res.status(400).json({ error: "book_id, episode, text 필수" });
    return;
  }

  try {
    const ctx = await buildEffectiveContext({ bookId, episodeNumber: episode });
    const result = await validate(text, ctx, { bookId, episodeNumber: episode, promptVersion: prompt_version });
    res.json(result);
  } catch (err) {
    logError("api:generate_v2", err);
    res.status(500).json({ error: String(err) });
  }
});
