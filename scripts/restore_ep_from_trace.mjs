/**
 * restore_ep_from_trace.mjs — run_traces.renderer_trace.generated_text를 episodes.content로 복원
 *
 * Usage:
 *   node scripts/restore_ep_from_trace.mjs --book-id <uuid> --episode 1 [--trace-id <id>] [--yes]
 *
 * --trace-id 미지정 시 가장 최근 직전(last - 1)의 trace 자동 선택.
 * 본문 전문은 출력 안 하고 길이만 표시.
 */
import pg from "pg";
import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const ep = parseInt(args[args.indexOf("--episode") + 1] ?? "1", 10);
const traceId = args.includes("--trace-id") ? args[args.indexOf("--trace-id") + 1] : null;
const apply = args.includes("--yes");
if (!bookId || !ep) { console.error("Usage: --book-id <uuid> --episode N [--trace-id <id>] [--yes]"); process.exit(1); }

const SUMMARY_FALLBACK_MARKER = "[[FALLBACK]]";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 모든 trace 나열
  const all = await pool.query(
    `SELECT trace_id, created_at, LENGTH(renderer_trace->>'generated_text') AS gtlen
     FROM run_traces WHERE book_id=$1 AND episode_number=$2
     ORDER BY created_at ASC`,
    [bookId, ep]
  );
  console.log(`[traces for ep${ep}]`);
  for (const r of all.rows) {
    console.log(`  ${r.created_at.toISOString()} id=${r.trace_id.slice(0,8)} text_len=${r.gtlen}`);
  }
  if (!all.rows.length) { console.error("no traces"); process.exit(1); }

  // 대상 trace 결정
  let target;
  if (traceId) {
    target = all.rows.find(r => r.trace_id === traceId || r.trace_id.startsWith(traceId));
  } else {
    // 가장 최근 직전 (last - 1) — 자동 fallback
    target = all.rows[all.rows.length - 2] ?? all.rows[all.rows.length - 1];
  }
  if (!target) { console.error("target trace not found"); process.exit(1); }

  // 본문 fetch
  const det = await pool.query(
    `SELECT renderer_trace->>'generated_text' AS gt FROM run_traces WHERE trace_id=$1`,
    [target.trace_id]
  );
  const gt = det.rows[0]?.gt;
  if (!gt) { console.error("generated_text not found in trace"); process.exit(1); }

  const cur = await pool.query(
    `SELECT LENGTH(content) AS clen, LENGTH(summary) AS slen FROM episodes WHERE book_id=$1 AND episode_number=$2`,
    [bookId, ep]
  );
  console.log("");
  console.log(`[plan] target trace: ${target.trace_id.slice(0,8)} @ ${target.created_at.toISOString()} text_len=${gt.length}`);
  console.log(`[plan] current ep${ep}: content_len=${cur.rows[0]?.clen ?? 0} summary_len=${cur.rows[0]?.slen ?? 0}`);
  console.log(`[plan] action: UPDATE episodes SET content=<trace>, summary=[[FALLBACK]]<first sentence>`);

  if (!apply) {
    console.log("\n[dry-run] --yes 추가 시 실제 적용");
    await pool.end();
    return;
  }

  const fallbackSummary = SUMMARY_FALLBACK_MARKER + (gt.split(/[.。!?]/)[0]?.trim() ?? "");
  await pool.query(
    `UPDATE episodes SET content=$1, summary=$2 WHERE book_id=$3 AND episode_number=$4`,
    [gt, fallbackSummary, bookId, ep]
  );
  console.log("✅ restored — content+summary updated. summary는 fallback marker 부착 — 다음 LLM trigger 시 자동 갱신");
  await pool.end();
}
main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(1); });
