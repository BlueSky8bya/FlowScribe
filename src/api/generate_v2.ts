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
 *   validate?: boolean,      // 생성 후 Claude 검증 여부 (기본 false)
 *   revise?: boolean,        // 검증 실패 시 자동 리비전 여부 (기본 false)
 *   prompt_version?: "A"|"B" // 검증 프롬프트 버전 (기본 "A")
 * }
 *
 * SSE 스트리밍 + 검증 결과 반환:
 * data: {"token": "..."}
 * data: {"done": true, "chars": N}
 * data: {"validation": {...}}   (validate=true일 때)
 * data: {"revision": {...}}     (revise=true일 때)
 */

import { Router, Request, Response } from "express";
import { streamEpisode } from "../services/story.js";
import { buildEffectiveContext, effectiveContextToStoryContext, saveEpisodeSnapshot } from "../services/effective_context.js";
import { validate } from "../services/validator.js";
import { reviseUntilPass } from "../services/revision.js";
import { logInfo, logError } from "../lib/logger.js";
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
  } = req.body as {
    book_id: string;
    episode: number;
    gen_config?: Partial<GenConfig>;
    task?: Partial<EpisodeTask>;
    prev_episode_state?: Partial<PrevEpisodeState>;
    validate?: boolean;
    revise?: boolean;
    prompt_version?: "A" | "B";
  };

  if (!bookId || !episode) {
    send({ error: "book_id와 episode는 필수입니다" });
    res.end();
    clearInterval(heartbeat);
    return;
  }

  logInfo("api:generate_v2", "V2 생성 시작", {
    book_id: bookId, episode, do_validate: doValidate, do_revise: doRevise,
    has_gen_config: !!overrideGenConfig, has_task: !!overrideTask,
  });

  try {
    // ── 유효 컨텍스트 조립 ─────────────────────────────────────
    const ctx = await buildEffectiveContext({
      bookId,
      episodeNumber: episode,
      overrideGenConfig,
      overrideTask,
      overridePrevState,
    });

    // 스냅샷 저장 (fire-and-forget)
    saveEpisodeSnapshot({ ...ctx, book_id: bookId } as any).catch(() => {});

    // ── 기존 StoryContext 형식으로 변환 (하위 호환) ────────────
    const storyCtx = effectiveContextToStoryContext(ctx);

    // ── SSE 스트리밍 생성 ──────────────────────────────────────
    const t0       = Date.now();
    const fullText = await streamEpisode(storyCtx as any, res);
    clearInterval(heartbeat);
    send({ done: true, chars: fullText.length, elapsed_ms: Date.now() - t0 });

    logInfo("api:generate_v2", "생성 완료", {
      book_id: bookId, episode, chars: fullText.length, elapsed_ms: Date.now() - t0,
    });

    // ── 검증 (선택적) ──────────────────────────────────────────
    if (doValidate) {
      const validation = await validate(fullText, ctx, {
        bookId, episodeNumber: episode, iteration: 1, promptVersion,
      });
      send({ validation });

      // ── 리비전 (선택적) ─────────────────────────────────────
      if (doRevise && (validation.verdict === "FAIL" || validation.verdict === "WARN")) {
        const revisionResult = await reviseUntilPass(fullText, validation, ctx, {
          bookId, episodeNumber: episode, promptVersion,
        });
        send({
          revision: {
            verdict: revisionResult.final_verdict,
            score: revisionResult.final_score,
            iterations: revisionResult.iterations,
            absolute_blocked: revisionResult.absolute_blocked,
          },
        });
        // 리비전된 최종 텍스트도 전송
        if (revisionResult.iterations > 0 && !revisionResult.absolute_blocked) {
          send({ revised_text: revisionResult.final_text });
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
