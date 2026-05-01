/**
 * run_ep1_regen_stability.mjs — R5B-1 ep1 반복 재생성 안정성 테스트
 *
 * /api/generate (GET) + stream_mode=hybrid + model_route=high_quality_ensemble
 * 동일 ep1을 N회 재생성하며 score / fallback / foreign / parse failure / temperature
 * 추적. 본문 전문 미저장 (length만 기록).
 *
 * Usage:
 *   node scripts/run_ep1_regen_stability.mjs --book-id <uuid> --attempts 5 [--episode 1]
 *
 * 환경:
 *   APP_URL (default http://localhost:3000)
 *   FS_TOKEN (optional Bearer/cookie — softGetUserId only, /api/generate에는 필수 아님)
 */
import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "fs";
import pg from "pg";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const attempts = parseInt(args[args.indexOf("--attempts") + 1] ?? "5", 10);
const episode = args.includes("--episode") ? parseInt(args[args.indexOf("--episode") + 1], 10) : 1;
const outDir = args.includes("--out-dir") ? args[args.indexOf("--out-dir") + 1] : ".tmp/forensic";
if (!bookId) { console.error("Usage: --book-id <uuid> --attempts N [--episode N]"); process.exit(1); }

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const ROUTE = "high_quality_ensemble";
const STREAM = "hybrid";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

mkdirSync(outDir, { recursive: true });

// Korean / 한글 외 script 검출 (BIDI-safe — 코드포인트 범위 직접 사용)
const _BAD_SCRIPT_RANGES = [
  [0x4E00, 0x9FFF],   // CJK Unified Ideographs (한자)
  [0x3040, 0x30FF],   // Hiragana + Katakana
  [0x0400, 0x04FF],   // Cyrillic
  [0x0600, 0x06FF],   // Arabic
  [0x0E00, 0x0E7F],   // Thai
  [0x1E00, 0x1EFF],   // Latin Extended Additional (Vietnamese 포함)
];
function countNonKoreanChars(text) {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    for (const [a, b] of _BAD_SCRIPT_RANGES) {
      if (cp >= a && cp <= b) { n++; break; }
    }
  }
  return n;
}
const SPECIAL_TOKEN_RE = /<\|[^>|]*\|>|<\/?s>|\[INST\]|\[\/INST\]|<<\w+>>|<extra_id_\d+>|<im_start>|<im_end>/g;

async function regenOnce(attemptIdx) {
  const t0 = Date.now();
  // regen 모드 강제: 같은 episode를 다시 호출 → detectGenerationMode가 latest_episode_regeneration 또는 episode1_regeneration으로 잡음
  const url = `${BASE}/api/generate?episode=${episode}&book_id=${encodeURIComponent(bookId)}&use_planner=true&model_route=${ROUTE}&stream_mode=${STREAM}&regen_nonce=${Date.now()}_${attemptIdx}`;
  const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  let text = "";
  let phases = [];
  let doneEvent = null;
  let planEvent = null;
  let parseFailure = false;
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
        const obj = JSON.parse(raw);
        if (typeof obj.token === "string") text += obj.token;
        if (obj.phase) phases.push(obj.phase);
        if (obj.done) doneEvent = obj;
        if (obj.plan) planEvent = obj.plan;
        if (obj.error) parseFailure = true;
      } catch { /* skip non-JSON */ }
    }
  }

  const elapsed = Date.now() - t0;
  const meta = doneEvent?.episode_meta ?? {};
  const planMeta = planEvent ?? {};
  const nonKor = countNonKoreanChars(text);
  const specialMatches = text.match(SPECIAL_TOKEN_RE) ?? [];

  // DB에서 저장된 buf와 trace 확인
  const epRow = await pool.query(
    `SELECT LENGTH(content) AS content_len, summary FROM episodes WHERE book_id=$1 AND episode_number=$2`,
    [bookId, episode]
  ).catch(() => ({ rows: [] }));
  const traceRow = await pool.query(
    `SELECT id, plan_verdict, final_score, fallback_used, planner_provider, planner_model, renderer_provider, renderer_model
     FROM run_traces WHERE book_id=$1 AND episode_number=$2 ORDER BY run_started_at DESC LIMIT 1`,
    [bookId, episode]
  ).catch(() => ({ rows: [] }));

  return {
    attempt: attemptIdx,
    elapsed_ms: elapsed,
    chars_streamed: text.length,
    db_content_len: epRow.rows[0]?.content_len ?? 0,
    summary_kind: epRow.rows[0]?.summary?.startsWith?.("[[FALLBACK]]") ? "fallback" : (epRow.rows[0]?.summary ? "llm" : "absent"),
    plan_verdict: meta.plan_verdict ?? planMeta.plan_validation?.verdict ?? null,
    final_score: meta.final_score ?? null,
    revision_count: meta.revision_count ?? null,
    plan_fallback_used: !!(meta.plan_fallback_used ?? planMeta.plan_fallback_used),
    parse_failure: parseFailure,
    foreign_count: nonKor,
    special_token_count: specialMatches.length,
    phases_seen: phases.length ? [...new Set(phases)] : null,
    trace: traceRow.rows[0] ?? null,
  };
}

async function main() {
  console.log(`[ep${episode} regen stability] book=${bookId} attempts=${attempts} route=${ROUTE} stream=${STREAM}`);
  const results = [];
  for (let i = 1; i <= attempts; i++) {
    process.stdout.write(`  attempt ${i}/${attempts} ...`);
    try {
      const r = await regenOnce(i);
      results.push(r);
      console.log(` score=${r.final_score ?? "?"} verdict=${r.plan_verdict ?? "?"} fb=${r.plan_fallback_used ? "Y" : "N"} foreign=${r.foreign_count} special=${r.special_token_count} parse_fail=${r.parse_failure ? "Y" : "N"} (${r.elapsed_ms}ms, ${r.chars_streamed}ch)`);
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
      results.push({ attempt: i, error: err.message });
    }
    // 사이에 간격 (서버 안정)
    await new Promise(r => setTimeout(r, 1000));
  }

  // Summary
  const ok = results.filter(r => !r.error);
  const scores = ok.map(r => r.final_score).filter(s => typeof s === "number");
  const minScore = scores.length ? Math.min(...scores) : null;
  const maxScore = scores.length ? Math.max(...scores) : null;
  const avgScore = scores.length ? (scores.reduce((a,b)=>a+b,0) / scores.length).toFixed(1) : null;
  const fallbackCount = ok.filter(r => r.plan_fallback_used).length;
  const foreignTotal = ok.reduce((s,r) => s + (r.foreign_count || 0), 0);
  const specialTotal = ok.reduce((s,r) => s + (r.special_token_count || 0), 0);
  const parseFailures = ok.filter(r => r.parse_failure).length;
  const verdictCounts = {};
  for (const r of ok) {
    const v = r.plan_verdict ?? "null";
    verdictCounts[v] = (verdictCounts[v] || 0) + 1;
  }

  console.log("\n── Summary ──");
  console.log(`  successful attempts: ${ok.length}/${attempts}`);
  console.log(`  scores: min=${minScore} max=${maxScore} avg=${avgScore}`);
  console.log(`  verdict distribution: ${JSON.stringify(verdictCounts)}`);
  console.log(`  fallback_used: ${fallbackCount}`);
  console.log(`  foreign_total: ${foreignTotal}`);
  console.log(`  special_token_total: ${specialTotal}`);
  console.log(`  parse_failures: ${parseFailures}`);
  // step collapse 검사: 연속 score 차이 ≥ 30
  let collapse = false;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i-1] - scores[i] >= 30) { collapse = true; break; }
  }
  console.log(`  step collapse: ${collapse ? "YES ⚠" : "no"}`);

  // PASS 판정
  const flags = [];
  if (ok.length < attempts) flags.push("incomplete attempts");
  if (scores.includes(0)) flags.push("score 0 trace");
  if (fallbackCount > 0) flags.push(`fallback ${fallbackCount}x`);
  if (foreignTotal > 0) flags.push(`foreign ${foreignTotal}`);
  if (specialTotal > 0) flags.push(`special token ${specialTotal}`);
  if (parseFailures >= 2) flags.push(`parse failure ${parseFailures}x`);
  if (collapse) flags.push("step collapse");
  const passed = flags.length === 0;
  console.log(`\n  ✅ PASS: ${passed ? "YES" : "NO — " + flags.join(", ")}`);

  // 본문 미저장. metric만 jsonl로
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = `${outDir}/ep${episode}_regen_stability_${ts}.json`;
  writeFileSync(outPath, JSON.stringify({
    book_id: bookId, episode, attempts, route: ROUTE, stream_mode: STREAM,
    summary: { ok_count: ok.length, min_score: minScore, max_score: maxScore, avg_score: avgScore, fallback_count: fallbackCount, foreign_total: foreignTotal, special_total: specialTotal, parse_failures: parseFailures, step_collapse: collapse, verdict_counts: verdictCounts, passed, flags },
    results,
  }, null, 2), "utf8");
  console.log(`\n  written: ${outPath}`);

  await pool.end();
  process.exit(passed ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(2); });
