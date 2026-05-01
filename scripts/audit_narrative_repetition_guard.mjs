/**
 * audit_narrative_repetition_guard.mjs — R5B-3.5
 *
 * 기존 episodes 본문에 대해 deterministic narrative repetition guard를 적용,
 * 인접 화 사이 narrative 수준 반복을 검출.
 *
 * 검사:
 *   per (ep_n, ep_n-1): exact_dup_count, adjacent_full_sim, closing_scene_sim, verdict
 *
 * Usage:
 *   node scripts/audit_narrative_repetition_guard.mjs --book-id <uuid> [--max-ep N]
 */
import pg from "pg";
import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "fs";
import { checkNarrativeRepetition } from "../dist/lib/narrative_repetition_guard.js";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const maxEp = parseInt(args[args.indexOf("--max-ep") + 1] ?? "100", 10);
if (!bookId) { console.error("Usage: --book-id <uuid> [--max-ep N]"); process.exit(1); }

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const eps = (await pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 AND episode_number<=$2 ORDER BY episode_number`,
    [bookId, maxEp]
  )).rows;
  if (!eps.length) { console.error("no episodes"); process.exit(0); }
  console.log(`book_id: ${bookId}  episodes: ${eps.length}`);
  console.log("");

  const records = [];
  let totalRetry = 0, totalWarn = 0, totalPass = 0;
  let totalExactDup = 0;
  let maxClosingSim = 0, maxAdjacentSim = 0;
  for (let i = 1; i < eps.length; i++) {
    const cur = eps[i];
    // recent 3화 (ep-3 ~ ep-1)
    const recent = [];
    for (let j = Math.max(0, i - 3); j < i; j++) {
      recent.push({ episode_number: eps[j].episode_number, content: eps[j].content ?? "" });
    }
    const r = checkNarrativeRepetition(cur.content ?? "", recent);
    records.push({ episode: cur.episode_number, ...r });
    if (r.verdict === "RETRY") totalRetry++;
    else if (r.verdict === "WARN") totalWarn++;
    else totalPass++;
    totalExactDup += r.exact_duplicate_count;
    if (r.closing_scene_similarity > maxClosingSim) maxClosingSim = r.closing_scene_similarity;
    if (r.adjacent_full_similarity > maxAdjacentSim) maxAdjacentSim = r.adjacent_full_similarity;
  }

  console.log("ep   | verdict | exact_dup | adj_full_sim | closing_sim | issues");
  for (const r of records) {
    const flag = r.verdict === "RETRY" ? "⚠" : (r.verdict === "WARN" ? "·" : " ");
    console.log(`${String(r.episode).padStart(4)} | ${r.verdict.padEnd(7)} ${flag} | ${String(r.exact_duplicate_count).padStart(9)} | ${r.adjacent_full_similarity.toFixed(3).padStart(12)} | ${r.closing_scene_similarity.toFixed(3).padStart(11)} | ${r.issues.length}`);
  }

  console.log("");
  console.log("── [Aggregate] ──");
  console.log(`PASS=${totalPass}  WARN=${totalWarn}  RETRY=${totalRetry}`);
  console.log(`total exact_duplicate_count: ${totalExactDup}`);
  console.log(`max adjacent full similarity: ${maxAdjacentSim.toFixed(3)}`);
  console.log(`max closing scene similarity: ${maxClosingSim.toFixed(3)}`);

  console.log("");
  console.log("── [R5B-3.5 PASS criteria] ──");
  const checks = [
    { name: "word-for-word narrative duplicate = 0",        pass: totalExactDup === 0 },
    { name: "adjacent severe (sim ≥ 0.85) = 0 (RETRY = 0)",  pass: totalRetry === 0 },
    { name: "max adjacent full sim < 0.85",                  pass: maxAdjacentSim < 0.85 },
    { name: "max closing scene sim < 0.65",                  pass: maxClosingSim < 0.65 },
  ];
  for (const c of checks) console.log(`  ${c.pass?"✓":"✗"} ${c.name}`);
  const passed = checks.filter(c => c.pass).length;
  console.log("");
  console.log(`R5B-3.5 audit: ${passed}/${checks.length} ${passed===checks.length?"✅ READY":"⚠ CONDITIONAL"}`);

  // save raw
  mkdirSync(".tmp", { recursive: true });
  const outPath = `.tmp/r5b3_5_narrative_repetition_${bookId}.json`;
  writeFileSync(outPath, JSON.stringify({
    book_id: bookId,
    episodes: { from: eps[0].episode_number, to: eps[eps.length - 1].episode_number },
    records,
    summary: {
      pass: totalPass, warn: totalWarn, retry: totalRetry,
      exact_duplicate_count: totalExactDup,
      max_adjacent_full_similarity: maxAdjacentSim,
      max_closing_scene_similarity: maxClosingSim,
    },
    criteria: { passed, total: checks.length, checks },
  }, null, 2), "utf8");
  console.log("");
  console.log(`written: ${outPath}`);

  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
}
main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(1); });
