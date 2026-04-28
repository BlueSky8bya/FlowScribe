import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { getLLMClient, getSummaryModel } from "../lib/llm.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";
import { extractAndStoreForeshadow, checkAndResolveForeshadows, getForeshadowStats } from "../services/foreshadow.js";
import { generateAndSaveArcSummary, ARC_SIZE } from "../services/arc_memory.js";

export const episodesRouter = Router();

episodesRouter.post("/", async (req: Request, res: Response) => {
  const { book_id, episode_number, content } = req.body;
  if (!book_id || episode_number == null || !content) {
    res.status(400).json({ error: "book_id, episode_number, content required" });
    return;
  }

  const ep     = Number(episode_number);
  const bookId = String(book_id);

  try {
    // 1. DB 저장 먼저 — LLM 실패와 무관하게 에피소드는 반드시 보존
    const fallbackSummary = content.split(/[.。!?]/)[0]?.trim() ?? "";
    await pool.query(
      `INSERT INTO episodes (book_id, episode_number, content, summary)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (book_id, episode_number) DO UPDATE SET content=$3`,
      [bookId, ep, content, fallbackSummary]
    );
    logInfo("api:episodes:save", "에피소드 저장 완료", { book_id: bookId, episode_number: ep });

    // 응답 즉시 반환
    res.json({ ok: true });

    // 2. 모든 비동기 후처리 (요약·복선·아크) — 응답과 무관
    setImmediate(async () => {
      try {
        // 요약 생성 및 업데이트
        const summaryRes = await getLLMClient().chat.completions.create({
          model: getSummaryModel(),
          messages: [
            {
              role: "system",
              content: [
                "당신은 소설 요약 전문가다. 반드시 아래 규칙을 지켜라.",
                "1. 사용자가 제공한 소설 본문만 요약한다. 없는 내용을 추가하거나 창작하지 않는다.",
                "2. 등장인물 이름, 주요 사건, 감정 흐름을 3~5문장으로 서술한다.",
                "3. 반드시 본문에 실제로 등장한 인물 이름만 사용한다.",
                "4. 요약문만 출력한다. 설명·주석 금지.",
              ].join("\n"),
            },
            { role: "user", content: `다음 소설 화를 요약해줘:\n\n${content}` },
          ],
          temperature: 0.1,
          max_tokens: 250,
        });
        const rawSummary = summaryRes.choices[0]?.message?.content ?? "";
        const summary    = rawSummary.trim().length < 20 ? fallbackSummary : rawSummary.trim();
        await pool.query(
          `UPDATE episodes SET summary=$1 WHERE book_id=$2 AND episode_number=$3`,
          [summary, bookId, ep]
        );
        logInfo("api:episodes:save", "요약 업데이트 완료", { book_id: bookId, episode_number: ep });
      } catch {
        logWarn("api:episodes:save", "요약 생성 실패 (에피소드는 저장됨)", { book_id: bookId, episode_number: ep });
      }

      try {
        // 복선 회수 체크
        const resolveResult = await checkAndResolveForeshadows(bookId, ep, content);
        logInfo("api:episodes:save", "복선 회수 체크 완료", {
          book_id: bookId, episode: ep,
          resolved: resolveResult.resolved,
          checked: resolveResult.checked,
        });

        // 새 복선 추출
        await extractAndStoreForeshadow(bookId, ep, content);

        const stats = await getForeshadowStats(bookId);
        logInfo("api:episodes:save", "복선 현황", {
          book_id: bookId, episode: ep,
          open: stats.open, resolved: stats.resolved, total: stats.total,
          recall_rate: `${stats.recall_rate}%`,
        });

        // 아크 완료 시 (10화 단위) 아크 요약 생성
        // 또는 단편(totalEpisodes < ARC_SIZE)의 최종화 시 임시 아크(arc_number=1) 생성
        // gen_config.totalEpisodes를 episode_snapshots에서 읽어 단편 여부 판단
        const snapRow = await pool.query(
          `SELECT effective_context->'gen_config'->>'totalEpisodes' AS total_episodes
           FROM episode_snapshots WHERE book_id=$1 ORDER BY episode_number DESC LIMIT 1`,
          [bookId]
        ).catch(() => ({ rows: [] }));
        const totalEpisodes: number = parseInt(snapRow.rows[0]?.total_episodes ?? "0", 10) || 0;
        const isShortFinal = totalEpisodes > 0 && totalEpisodes < ARC_SIZE && ep >= totalEpisodes;
        const isArcComplete = ep % ARC_SIZE === 0;

        if (isArcComplete || isShortFinal) {
          // characters 테이블을 우선 조회하고, 비어 있으면 canonical_characters에서 fallback
          // (test 환경에서는 canonical_characters에만 인물이 등록되는 경우가 있음)
          let charRes = await pool.query(
            `SELECT DISTINCT name FROM characters WHERE book_id = $1`, [bookId]
          );
          if (!charRes.rows.length) {
            charRes = await pool.query(
              `SELECT DISTINCT name FROM canonical_characters WHERE book_id = $1`, [bookId]
            );
          }
          if (!charRes.rows.length) {
            charRes = await pool.query(
              `SELECT DISTINCT character_name AS name FROM character_dynamic_states WHERE book_id = $1`, [bookId]
            );
          }
          const characterNames = charRes.rows.map((r: any) => r.name);

          if (isArcComplete) {
            const arcNumber = ep / ARC_SIZE;
            logInfo("api:episodes:save", `아크 ${arcNumber} 완료 — 요약 생성 시작`, {
              book_id: bookId, arc_number: arcNumber,
              ep_range: `${(arcNumber - 1) * ARC_SIZE + 1}~${ep}화`,
            });
            await generateAndSaveArcSummary(bookId, arcNumber, characterNames);
          } else if (isShortFinal) {
            // 단편 최종화: 전체 에피소드를 arc 1로 요약 저장 (arc_number=1, ep_range=1~ep)
            logInfo("api:episodes:save", `단편 최종화 — 미니 아크 요약 생성 시작`, {
              book_id: bookId, total_episodes: totalEpisodes, ep_range: `1~${ep}화`,
            });
            await generateAndSaveArcSummary(bookId, 1, characterNames, ep);
          }
        }
      } catch (err) {
        logError("api:episodes:save", err, { context: "비동기 사후처리 실패", book_id: bookId, episode: ep });
      }
    });
  } catch (err) {
    logError("api:episodes:save", err, { book_id: bookId, episode_number: ep });
    res.status(500).json({ error: "episode save failed" });
  }
});

episodesRouter.get("/:bookId/all", async (req: Request, res: Response) => {
  const { bookId } = req.params;
  try {
    const result = await pool.query(
      `SELECT episode_number, content FROM episodes
       WHERE book_id = $1 ORDER BY episode_number ASC`,
      [bookId]
    );
    res.json({ episodes: result.rows });
  } catch (err) {
    logError("api:episodes:all", err, { bookId });
    res.status(500).json({ error: "episodes fetch failed" });
  }
});

episodesRouter.get("/:bookId/summary", async (req: Request, res: Response) => {
  const { bookId } = req.params;
  try {
    const result = await pool.query(
      `SELECT episode_number, summary FROM episodes
       WHERE book_id = $1 ORDER BY episode_number DESC LIMIT 5`,
      [bookId]
    );
    const summaries = result.rows
      .reverse()
      .map((r) => `${r.episode_number}화: ${r.summary}`)
      .join("\n");
    if (!result.rows.length) logWarn("api:episodes:summary", "에피소드 없음", { bookId });
    else logInfo("api:episodes:summary", "요약 조회", { bookId, count: result.rows.length });
    res.json({ summary: summaries });
  } catch (err) {
    logError("api:episodes:summary", err, { bookId });
    res.status(500).json({ error: "summary fetch failed" });
  }
});

// 복선 현황 조회 엔드포인트
episodesRouter.get("/:bookId/foreshadows", async (req: Request, res: Response) => {
  const bookId      = String(req.params.bookId);
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  try {
    const params: string[] = [bookId];
    const whereClauses = statusFilter ? ` AND status = $2` : "";
    if (statusFilter) params.push(statusFilter);
    const result = await pool.query(
      `SELECT id, planted_episode, content, keywords, status, resolved_episode
       FROM foreshadows WHERE book_id = $1${whereClauses}
       ORDER BY planted_episode ASC`,
      params
    );
    const stats = await getForeshadowStats(String(bookId));
    logInfo("api:episodes:foreshadows", "복선 목록 조회", {
      bookId, count: result.rows.length, stats,
    });
    res.json({ foreshadows: result.rows, stats });
  } catch (err) {
    logError("api:episodes:foreshadows", err, { bookId: String(bookId) });
    res.status(500).json({ error: "foreshadow fetch failed" });
  }
});
