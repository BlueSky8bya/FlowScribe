/**
 * run_episodes_hqe_hybrid.mjs — R5B-1 sequential 화 생성 (HQE + hybrid)
 *
 * /api/generate (GET) + stream_mode=hybrid + model_route=high_quality_ensemble.
 * --from N --to M 으로 N~M화 순차 생성. 본문 미저장 (length만).
 *
 * Usage:
 *   node scripts/run_episodes_hqe_hybrid.mjs --book-id <uuid> --from 2 --to 10
 */
import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "fs";
import pg from "pg";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const from = parseInt(args[args.indexOf("--from") + 1] ?? "2", 10);
const to   = parseInt(args[args.indexOf("--to") + 1]   ?? "10", 10);
const outDir = args.includes("--out-dir") ? args[args.indexOf("--out-dir") + 1] : ".tmp/forensic";
if (!bookId || !from || !to) { console.error("Usage: --book-id <uuid> --from N --to M"); process.exit(1); }

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const ROUTE = "high_quality_ensemble";
const STREAM = "hybrid";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
mkdirSync(outDir, { recursive: true });

const _BAD_SCRIPT_RANGES = [
  [0x4E00, 0x9FFF], [0x3040, 0x30FF], [0x0400, 0x04FF],
  [0x0600, 0x06FF], [0x0E00, 0x0E7F], [0x1E00, 0x1EFF],
];
function countNonKor(t) {
  let n = 0;
  for (const c of t) {
    const cp = c.codePointAt(0);
    for (const [a,b] of _BAD_SCRIPT_RANGES) if (cp>=a && cp<=b) { n++; break; }
  }
  return n;
}
const SPECIAL_RE = /<\|[^>|]*\|>|<\/?s>|\[INST\]|\[\/INST\]|<<\w+>>|<extra_id_\d+>|<im_start>|<im_end>/g;

async function genOne(ep) {
  const t0 = Date.now();
  const url = `${BASE}/api/generate?episode=${ep}&book_id=${encodeURIComponent(bookId)}&use_planner=true&model_route=${ROUTE}&stream_mode=${STREAM}`;
  const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  let text = "", doneEvent = null, planEvent = null, parseFailure = false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        const o = JSON.parse(raw);
        if (typeof o.token === "string") text += o.token;
        if (o.done) doneEvent = o;
        if (o.plan) planEvent = o.plan;
        if (o.error) parseFailure = true;
      } catch {}
    }
  }
  const elapsed = Date.now() - t0;
  const meta = doneEvent?.episode_meta ?? {};
  const epRow = await pool.query(
    `SELECT LENGTH(content) AS len, summary FROM episodes WHERE book_id=$1 AND episode_number=$2`,
    [bookId, ep]
  ).catch(()=>({rows:[]}));
  return {
    ep, elapsed_ms: elapsed, chars_streamed: text.length,
    db_content_len: epRow.rows[0]?.len ?? 0,
    summary_kind: epRow.rows[0]?.summary?.startsWith?.("[[FALLBACK]]") ? "fallback" : (epRow.rows[0]?.summary ? "llm" : "absent"),
    plan_verdict: meta.plan_verdict ?? planEvent?.plan_validation?.verdict ?? null,
    final_score: meta.final_score ?? null,
    plan_fallback_used: !!(meta.plan_fallback_used ?? planEvent?.plan_fallback_used),
    parse_failure: parseFailure,
    foreign_count: countNonKor(text),
    special_token_count: (text.match(SPECIAL_RE) ?? []).length,
  };
}

async function main() {
  console.log(`[ep${from}~ep${to} HQE+hybrid] book=${bookId}`);
  const results = [];
  for (let ep = from; ep <= to; ep++) {
    process.stdout.write(`  ep${ep} ...`);
    try {
      const r = await genOne(ep);
      results.push(r);
      console.log(` score=${r.final_score ?? "?"} verdict=${r.plan_verdict ?? "?"} fb=${r.plan_fallback_used?"Y":"N"} foreign=${r.foreign_count} (${r.elapsed_ms}ms, db=${r.db_content_len}ch)`);
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
      results.push({ ep, error: err.message });
      // 한 화 실패 시 중단
      break;
    }
    await new Promise(r => setTimeout(r, 800));
  }
  // summary
  const ok = results.filter(r => !r.error);
  const scores = ok.map(r => r.final_score).filter(s => typeof s === "number");
  const avg = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : null;
  const fbCount = ok.filter(r => r.plan_fallback_used).length;
  const foreign = ok.reduce((s,r)=>s+(r.foreign_count||0),0);
  const special = ok.reduce((s,r)=>s+(r.special_token_count||0),0);
  const parse = ok.filter(r => r.parse_failure).length;
  console.log(`\n── Summary ──`);
  console.log(`  successful: ${ok.length}/${to-from+1}`);
  console.log(`  scores: ${JSON.stringify(scores)}  avg=${avg}`);
  console.log(`  fallback: ${fbCount}  foreign: ${foreign}  special: ${special}  parse_failures: ${parse}`);

  const ts = new Date().toISOString().replace(/[:.]/g,"-");
  const outPath = `${outDir}/episodes_${from}-${to}_${ts}.json`;
  writeFileSync(outPath, JSON.stringify({ book_id: bookId, from, to, route: ROUTE, stream_mode: STREAM, results, summary: { ok_count: ok.length, scores, avg, fbCount, foreign, special, parse } }, null, 2), "utf8");
  console.log(`  written: ${outPath}`);

  await pool.end();
  process.exit(ok.length === to-from+1 ? 0 : 1);
}
main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(2); });
