/**
 * r5b4a_extract_plan_fixture.mjs — R5B-4a fixture extractor
 *
 * run_traces에서 (book_id, episode_range)의 planner output + effective context를
 * .tmp/r5b4a_fixtures/ep<N>.json으로 저장. 같은 plan/context를 서로 다른 renderer
 * route에 입력하기 위한 fixture 데이터.
 *
 * 본문 raw output은 fixture에 포함하지 않는다 (재생성용 plan/ctx만).
 *
 * Usage:
 *   node scripts/r5b4a_extract_plan_fixture.mjs --book-id <uuid> --ep-range 76-90
 */
import pg from "pg";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const epRange = args[args.indexOf("--ep-range") + 1] ?? "76-90";
if (!bookId) { console.error("Usage: --book-id <uuid> [--ep-range 76-90]"); process.exit(1); }

const m = epRange.match(/^(\d+)-(\d+)$/);
if (!m) { console.error("ep-range format: from-to"); process.exit(1); }
const epFrom = parseInt(m[1], 10);
const epTo = parseInt(m[2], 10);

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const outDir = ".tmp/r5b4a_fixtures";
  mkdirSync(outDir, { recursive: true });

  // 가장 최신 trace per episode (재생성된 경우 마지막 것)
  const r = await pool.query(`
    SELECT DISTINCT ON (episode_number)
      episode_number, trace_id, planner_trace, effective_context_snapshot, created_at
    FROM run_traces
    WHERE book_id=$1 AND episode_number BETWEEN $2 AND $3
      AND planner_trace IS NOT NULL
      AND (planner_trace->>'fallback_used')::boolean IS DISTINCT FROM true
    ORDER BY episode_number, created_at DESC
  `, [bookId, epFrom, epTo]);

  console.log(`book_id: ${bookId}  fixtures: ${r.rows.length} (ep${epFrom}-${epTo})`);
  let saved = 0, skipped = 0;
  for (const row of r.rows) {
    const ep = row.episode_number;
    const plan = row.planner_trace?.parsed_plan;
    const ctx = row.effective_context_snapshot;
    if (!plan || !ctx) {
      console.log(`  ep${ep}: skip (missing plan or ctx)`);
      skipped++;
      continue;
    }
    const out = {
      book_id: bookId,
      episode_number: ep,
      trace_id: row.trace_id,
      created_at: row.created_at,
      plan,                  // ScenePlan
      ctx,                   // EffectiveContext snapshot
    };
    const outPath = `${outDir}/ep${ep}.json`;
    writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
    saved++;
  }
  console.log(`saved: ${saved}, skipped: ${skipped}`);
  console.log(`out dir: ${outDir}/`);
  await pool.end();
}
main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(1); });
