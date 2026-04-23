/**
 * src/training/dataset_builder.ts — DB Trace → 학습 데이터셋 변환기
 *
 * run_traces 테이블에서 조건에 맞는 trace를 쿼리하여
 * SFT / DPO / Preference 형식의 JSONL 파일로 내보낸다.
 *
 * CLI: npx tsx scripts/training/build_dataset.ts [mode] [options]
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { Pool } from "pg";
import type {
  RunTrace, PlannerSFTExample, RendererDPOExample, PreferencePair,
  DatasetBuildConfig,
} from "./types.js";
import { DEFAULT_DATASET_CONFIG } from "./types.js";
import { computeReward } from "./reward_aggregator.js";
import { logInfo } from "../lib/logger.js";

// ──────────────────────────────────────────────────────────────
// Planner SFT 데이터셋
// ──────────────────────────────────────────────────────────────

export async function buildPlannerSFTDataset(
  pool: Pool,
  cfg: Partial<DatasetBuildConfig> = {},
): Promise<PlannerSFTExample[]> {
  const config = { ...DEFAULT_DATASET_CONFIG, ...cfg };

  const { rows } = await pool.query<{ trace_id: string; data: RunTrace }>(
    `SELECT trace_id, row_to_json(t)::jsonb AS data
     FROM run_traces t
     WHERE is_planner_sft_eligible = true
       AND trace_type = 'planner'
       ${config.date_from ? `AND created_at >= '${config.date_from}'` : ""}
       ${config.date_to   ? `AND created_at <= '${config.date_to}'`   : ""}
     ORDER BY final_score DESC`,
  );

  return rows.map(row => {
    const trace: RunTrace = row.data;
    const plan = trace.planner_trace?.parsed_plan;
    if (!plan) return null;

    // EffectiveContext를 instruction 형식으로 변환
    const ctx = trace.effective_context_snapshot as Record<string, unknown>;
    const instruction = buildPlannerInstruction(ctx);
    const output = JSON.stringify(plan, null, 2);

    return {
      id: trace.trace_id,
      instruction,
      output,
      metadata: {
        trace_id: trace.trace_id,
        plan_verdict: trace.plan_validation?.verdict ?? "UNKNOWN",
        final_score: trace.final_score,
        created_at: trace.created_at,
      },
    } satisfies PlannerSFTExample;
  }).filter((x): x is PlannerSFTExample => x !== null);
}

// ──────────────────────────────────────────────────────────────
// Renderer DPO 데이터셋
// ──────────────────────────────────────────────────────────────

export async function buildRendererDPODataset(
  pool: Pool,
  cfg: Partial<DatasetBuildConfig> = {},
): Promise<RendererDPOExample[]> {
  const config = { ...DEFAULT_DATASET_CONFIG, ...cfg };
  const minDelta = config.min_reward_delta_for_preference;

  // 동일 context_hash를 가진 trace 쌍을 찾는다
  const { rows } = await pool.query<RunTrace[]>(
    `SELECT a.*, b.*
     FROM run_traces a
     JOIN run_traces b
       ON a.episode_number = b.episode_number
       AND a.book_id = b.book_id
       AND a.trace_id != b.trace_id
       AND a.final_score - b.final_score >= ${minDelta}
     WHERE a.is_renderer_sft_eligible = true
     ORDER BY (a.final_score - b.final_score) DESC
     LIMIT 1000`,
  );

  // rows 쌍 → DPO 예시 변환 (simplified)
  const examples: RendererDPOExample[] = [];
  // 실제 구현: rows 파싱 + prompt 재구성
  // TODO: renderer_trace.system_prompt + user_prompt 결합
  logInfo("training:dataset", `Renderer DPO 후보: ${rows.length}쌍`);

  return examples;
}

// ──────────────────────────────────────────────────────────────
// JSONL 내보내기
// ──────────────────────────────────────────────────────────────

export function exportToJSONL<T>(items: T[], outputPath: string): void {
  const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const content = items.map(item => JSON.stringify(item)).join("\n");
  writeFileSync(outputPath, content, "utf-8");
  logInfo("training:dataset", `JSONL 내보내기 완료`, {
    path: outputPath,
    count: items.length,
  });
}

export async function buildAndExportAll(
  pool: Pool,
  cfg: Partial<DatasetBuildConfig> = {},
): Promise<void> {
  const config = { ...DEFAULT_DATASET_CONFIG, ...cfg };

  console.log("[DatasetBuilder] Planner SFT 데이터셋 생성 중...");
  const plannerSFT = await buildPlannerSFTDataset(pool, config);
  exportToJSONL(plannerSFT, join(config.output_dir, "planner_sft.jsonl"));
  console.log(`  → ${plannerSFT.length}개 예시`);

  console.log("[DatasetBuilder] Renderer DPO 데이터셋 생성 중...");
  const rendererDPO = await buildRendererDPODataset(pool, config);
  exportToJSONL(rendererDPO, join(config.output_dir, "renderer_dpo.jsonl"));
  console.log(`  → ${rendererDPO.length}개 예시`);
}

// ──────────────────────────────────────────────────────────────
// 내부 헬퍼
// ──────────────────────────────────────────────────────────────

function buildPlannerInstruction(ctx: Record<string, unknown>): string {
  // EffectiveContext의 핵심 필드를 플래너 instruction으로 변환
  const genCfg = (ctx.gen_config ?? {}) as Record<string, unknown>;
  return [
    `회차: ${ctx.episode_number ?? "?"}화`,
    `장르: ${genCfg.genre ?? "미지정"}`,
    `POV: ${genCfg.pov ?? "미지정"}`,
    `이전 화 요약: ${ctx.prev_episode_summary ?? "없음"}`,
    `인물 동적 상태: ${JSON.stringify(ctx.character_dynamic_states ?? [])}`,
    `작가 개입: ${JSON.stringify(ctx.author_interventions ?? [])}`,
    `세계관 규칙 (일반): ${JSON.stringify(ctx.world_rules ?? [])}`,
    `절대 금지: ${JSON.stringify(ctx.absolute_forbidden ?? [])}`,
  ].join("\n");
}
