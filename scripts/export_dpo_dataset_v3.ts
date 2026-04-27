/**
 * scripts/export_dpo_dataset_v3.ts — DPO dataset v_final export
 *
 * filter_v3_passed=TRUE 기준 동결 export
 * 변경 (v2 대비):
 *   - filter_v3_passed 기준 (filter_passed 아님)
 *   - reward v2 metadata 포함 (ee_score, hard_gate_failed, judge_uncertainty, pp_penalty)
 *   - book_id 기준 train/val split (scenario별 1 book → val)
 *   - 3개 파일 출력: dpo_v3_final / dpo_v3_train / dpo_v3_val
 *   - prompt length 경고 (> 12000 chars ≈ 3000 tokens)
 *
 * 실행:
 *   npx tsx scripts/export_dpo_dataset_v3.ts [--out-dir data/datasets]
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import {
  FOREIGN_CHAR_PATTERN, detectForeignChars, detectTruncation,
  normalizeItems, getScenario, type ItemEntry,
} from "./utils/dpo_utils.js";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

const args = process.argv.slice(2);
function getArg(flag: string, def: string): string {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
}
const outDir = getArg("--out-dir", "data/datasets");

// getScenario — dpo_utils에서 import됨

// ── val split: scenario별 book_id 1개씩 ────────────────────────────
// deterministic: scenario별 n 기준 중간값 book 선택 (최대/최소 제외)
function selectValBooks(
  bookRows: Array<{ book_id: string; title: string; n: number }>
): Set<string> {
  const byScenario: Record<string, typeof bookRows> = {};
  for (const b of bookRows) {
    const s = getScenario(b.title);
    (byScenario[s] ??= []).push(b);
  }

  const valSet = new Set<string>();
  for (const [scenario, books] of Object.entries(byScenario)) {
    if (!books.length) continue;
    // sort by n asc, pick middle-ish (not the largest, not the smallest)
    const sorted = [...books].sort((a, b) => a.n - b.n);
    const idx = Math.floor(sorted.length / 2); // middle
    valSet.add(sorted[idx].book_id);
    console.log(`  val[${scenario}]: book_id=${sorted[idx].book_id} n=${sorted[idx].n} title=${sorted[idx].title}`);
  }
  return valSet;
}

// ── helpers — 모두 dpo_utils에서 import됨 ─────────────────────────

async function main() {
  console.log("\n[DPO Dataset Export v3 — filter_v3_final]\n");

  // 1. book 목록 + scenario 매핑
  const bookR = await pool.query(`
    SELECT dp.book_id, b.title, COUNT(*) n
    FROM dpo_pairs dp
    JOIN books b ON b.id = dp.book_id
    WHERE dp.filter_v3_passed = TRUE
    GROUP BY dp.book_id, b.title
    ORDER BY n DESC
  `);
  const bookRows = bookR.rows as Array<{ book_id: string; title: string; n: number }>;
  console.log(`총 ${bookRows.length}개 book`);

  console.log("\n[val 선택]");
  const valBookIds = selectValBooks(bookRows);
  console.log(`  → val books: ${valBookIds.size}개\n`);

  // 2. pair 조회
  const r = await pool.query(`
    SELECT
      p.id::text                AS pair_id,
      p.book_id,
      p.episode_number,
      p.chosen_model,
      p.rejected_model,
      p.chosen_verdict,
      p.rejected_verdict,
      p.chosen_score,
      p.rejected_score,
      p.score_delta,
      p.reward_delta,
      p.chosen_pov_violation,
      p.rejected_pov_violation,
      p.chosen_state_violation,
      p.rejected_state_violation,
      p.planner_model,
      p.filter_v3_reason,
      p.created_at              AS pair_created_at,
      b.title                   AS book_title,
      -- chosen trace
      ct.trace_id::text         AS chosen_trace_id,
      ct.renderer_trace         AS chosen_renderer_trace,
      ct.audit_elapsed_ms       AS chosen_audit_ms,
      ct.plan_validation        AS chosen_plan_validation,
      -- v2 reward fields
      ct.computed_reward->>'reward_schema_version'                              AS c_schema_ver,
      (ct.computed_reward->'episode_extended'->>'episode_extended_score')::float AS c_ee_score,
      (ct.computed_reward->'episode_extended'->>'hard_gate_failed')::boolean    AS c_hard_gate_failed,
      (ct.computed_reward->'episode_extended'->>'judge_uncertainty')::float     AS c_judge_uncertainty,
      (ct.computed_reward->'episode_extended'->>'postprocess_dependency_penalty')::float AS c_pp_penalty,
      -- rejected trace
      rt.renderer_trace         AS rejected_renderer_trace
    FROM dpo_pairs p
    JOIN run_traces ct ON ct.trace_id = p.chosen_trace_id
    JOIN run_traces rt ON rt.trace_id = p.rejected_trace_id
    JOIN books b ON b.id = p.book_id
    WHERE p.filter_v3_passed = TRUE
    ORDER BY p.score_delta DESC
  `);

  console.log(`대상 pair: ${r.rows.length}개`);

  if (!r.rows.length) {
    console.log("추출할 pair 없음");
    await pool.end();
    return;
  }

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outAll   = fs.createWriteStream(path.join(outDir, "dpo_v3_final.jsonl"),  { encoding: "utf8" });
  const outTrain = fs.createWriteStream(path.join(outDir, "dpo_v3_train.jsonl"),  { encoding: "utf8" });
  const outVal   = fs.createWriteStream(path.join(outDir, "dpo_v3_val.jsonl"),    { encoding: "utf8" });

  let written = 0, skipped = 0, trainN = 0, valN = 0;
  let longPromptWarn = 0;
  const skipReasons: Record<string, number> = {};
  const scenarioStats: Record<string, { train: number; val: number }> = {};

  for (const row of r.rows) {
    const ct = row.chosen_renderer_trace;
    const rt = row.rejected_renderer_trace;

    if (!ct?.system_prompt || !ct?.generated_text) {
      skipped++; skipReasons["chosen_trace_incomplete"] = (skipReasons["chosen_trace_incomplete"] ?? 0) + 1; continue;
    }
    if (!rt?.system_prompt || !rt?.generated_text) {
      skipped++; skipReasons["rejected_trace_incomplete"] = (skipReasons["rejected_trace_incomplete"] ?? 0) + 1; continue;
    }

    const chosenText   = ct.generated_text as string;
    const rejectedText = rt.generated_text as string;

    const prompt = `${ct.system_prompt}\n\n${(ct as any).user_prompt ?? ""}`.trim();
    if (prompt.length > 12000) longPromptWarn++;

    const scenario = getScenario(row.book_title ?? "");
    const split    = valBookIds.has(row.book_id) ? "val" : "train";

    (scenarioStats[scenario] ??= { train: 0, val: 0 })[split]++;

    const example = {
      id:       row.pair_id,
      prompt,
      chosen:   chosenText,
      rejected: rejectedText,
      split,
      metadata: {
        book_id:              row.book_id,
        episode:              row.episode_number,
        scenario,
        trace_id:             row.chosen_trace_id,
        chosen_model:         row.chosen_model,
        rejected_model:       row.rejected_model,
        planner_model:        row.planner_model,
        score_delta:          row.score_delta,
        reward_delta:         row.reward_delta,
        chosen_score:         row.chosen_score,
        rejected_score:       row.rejected_score,
        chosen_verdict:       row.chosen_verdict,
        rejected_verdict:     row.rejected_verdict,
        chosen_pov_violation: row.chosen_pov_violation,
        rejected_pov_violation: row.rejected_pov_violation,
        chosen_state_violation: row.chosen_state_violation,
        // v2 reward quality
        reward_schema_version: row.c_schema_ver,
        ee_score:             row.c_ee_score,
        hard_gate_failed:     row.c_hard_gate_failed,
        judge_uncertainty:    row.c_judge_uncertainty,
        pp_penalty:           row.c_pp_penalty,
        // hygiene flags
        foreign_char_fix:     detectForeignChars(chosenText),
        truncation_flag:      detectTruncation(chosenText),
        // perf
        render_ms:            (ct as any).elapsed_ms ?? null,
        audit_ms:             row.chosen_audit_ms ?? null,
        plan_verdict:         row.chosen_plan_validation?.verdict ?? null,
        pair_created_at:      row.pair_created_at,
      },
    };

    const line = JSON.stringify(example) + "\n";
    outAll.write(line);
    if (split === "val") { outVal.write(line); valN++; }
    else                 { outTrain.write(line); trainN++; }
    written++;
  }

  outAll.end(); outTrain.end(); outVal.end();

  console.log(`\n완료: ${written}개 작성, ${skipped}개 스킵`);
  if (skipped) console.log("스킵 이유:", JSON.stringify(skipReasons));
  if (longPromptWarn) console.log(`⚠ prompt > 12000 chars: ${longPromptWarn}건 (tokenizer truncation 위험)`);

  console.log(`\n[split]`);
  console.log(`  train: ${trainN}  val: ${valN}  (val rate: ${(valN/written*100).toFixed(1)}%)`);

  console.log(`\n[scenario × split]`);
  for (const [s, cnt] of Object.entries(scenarioStats)) {
    console.log(`  ${s}: train=${cnt.train} val=${cnt.val}`);
  }

  console.log(`\n[출력 파일]`);
  console.log(`  ${path.join(outDir, "dpo_v3_final.jsonl")}  (${written}건 전체)`);
  console.log(`  ${path.join(outDir, "dpo_v3_train.jsonl")} (${trainN}건)`);
  console.log(`  ${path.join(outDir, "dpo_v3_val.jsonl")}   (${valN}건)`);

  // v2 model stats
  const mR = await pool.query(`
    SELECT chosen_model, COUNT(*) n, ROUND(AVG(score_delta)::numeric,1) avg_delta
    FROM dpo_pairs WHERE filter_v3_passed=TRUE
    GROUP BY chosen_model ORDER BY n DESC
  `);
  console.log("\n[chosen model 분포]");
  mR.rows.forEach((row: any) => {
    console.log(`  ${row.chosen_model}: ${row.n}건, avg_delta=${row.avg_delta}`);
  });

  await pool.end();
}

main().catch(async (e) => { console.error("실패:", e.message); await pool.end(); process.exit(1); });
