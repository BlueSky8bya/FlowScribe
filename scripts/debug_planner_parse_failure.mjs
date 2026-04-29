/**
 * debug_planner_parse_failure.mjs
 * 특정 book/episode의 planner trace를 분석해 parse 실패 원인 보고
 * Usage: node scripts/debug_planner_parse_failure.mjs --book-id <uuid> --episode <n>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId  = args[args.indexOf("--book-id") + 1];
const episode = parseInt(args[args.indexOf("--episode") + 1] ?? "0", 10);
if (!bookId || !episode) { console.error("Usage: --book-id <uuid> --episode <n>"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const res = await pool.query(
  `SELECT trace_id, created_at, final_score,
          planner_trace, renderer_trace, effective_context_snapshot
   FROM run_traces
   WHERE book_id=$1 AND episode_number=$2
   ORDER BY created_at DESC LIMIT 3`,
  [bookId, episode]
);
await pool.end();

if (!res.rows.length) {
  console.log(`trace 없음: book=${bookId} ep=${episode}`);
  process.exit(0);
}

for (const [i, row] of res.rows.entries()) {
  const pt = row.planner_trace;
  const rt = row.renderer_trace;
  console.log(`\n${"═".repeat(56)}`);
  console.log(` trace ${i + 1}: ${row.trace_id ?? "(none)"} | created: ${row.created_at?.toISOString?.() ?? row.created_at}`);
  console.log(` final_score: ${row.final_score ?? "(null)"}`);
  console.log("─".repeat(56));

  if (!pt) {
    console.log(" ⚠️  planner_trace: NULL — pipeline이 planner 단계 전에 크래시했거나 tracePool 없이 실행됨");
  } else {
    console.log(` planner_model: ${pt.model_used ?? "(unknown)"}`);
    console.log(` elapsed_ms: ${pt.elapsed_ms ?? "(unknown)"}`);
    console.log(` fallback_used: ${pt.fallback_used ?? false}`);
    console.log(` fallback_reason: ${pt.fallback_reason ?? "-"}`);
    const raw = pt.raw_output ?? "";
    console.log(` raw_output_length: ${raw.length}`);
    console.log(` raw_ends_cleanly: ${raw.trimEnd().endsWith("}") ? "YES" : "NO — truncated?"}`);
    if (raw.length < 200) console.log(` raw_output_preview: ${raw.slice(0, 200)}`);

    const plan = pt.parsed_plan;
    if (!plan) {
      console.log(` ❌ parsed_plan: NULL → parse 실패, fallback_used여야 함`);
    } else {
      console.log(` scene_beats: ${plan.scene_beats?.length ?? 0}개`);
      console.log(` hook_type: ${plan.hook_type ?? "(none)"}`);
      console.log(` character_state_updates: ${plan.character_state_updates?.length ?? 0}건`);
    }
  }

  if (!rt) {
    console.log(` ⚠️  renderer_trace: NULL`);
  } else {
    console.log(` renderer_model: ${rt.model_used ?? "(unknown)"}`);
    console.log(` generated_text_length: ${rt.generated_text?.length ?? 0}`);
  }

  const ctx = row.effective_context_snapshot;
  if (ctx) {
    const plannerPromptLen = JSON.stringify(ctx).length;
    console.log(` context_snapshot_chars: ${plannerPromptLen}`);
    console.log(` foreshadow_count: ${ctx.foreshadow_memory?.length ?? 0}`);
    console.log(` arc_summaries: ${ctx.arc_summaries?.length ?? 0}`);
  }
}
