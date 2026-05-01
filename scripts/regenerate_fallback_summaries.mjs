/**
 * regenerate_fallback_summaries.mjs — R5B-1 효과 검증용
 *
 * 짧은 fallback summary(LLM 요약 아닌 첫 문장)인 episodes를 찾아
 * dist의 generateAndSaveLLMSummary로 update.
 *
 * marker 있는 경우 + marker 없지만 분량이 짧고 첫 문장 패턴인 경우 둘 다 처리.
 *
 * Usage:
 *   node scripts/regenerate_fallback_summaries.mjs --book-id <uuid>
 */
import pg from "pg";
import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
if (!bookId) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// dist에서 helper + LLM client 사용
const { generateAndSaveLLMSummary, SUMMARY_FALLBACK_MARKER } = await import("../dist/services/episode_summary.js");

async function main() {
  const r = await pool.query(
    `SELECT episode_number, content, summary FROM episodes WHERE book_id=$1 ORDER BY episode_number ASC`,
    [bookId]
  );
  console.log(`[regen-summary] ${r.rows.length} episodes`);
  let updated = 0, skipped = 0, failed = 0;
  for (const row of r.rows) {
    const s = row.summary ?? "";
    const isFallback = s.startsWith(SUMMARY_FALLBACK_MARKER) || s.length < 100;
    if (!isFallback) { skipped++; console.log(`  ep${row.episode_number}: skip (LLM 요약, len=${s.length})`); continue; }

    // marker 없는 fallback도 update 가능하게 — 일시적으로 marker 부착
    if (!s.startsWith(SUMMARY_FALLBACK_MARKER)) {
      await pool.query(
        `UPDATE episodes SET summary=$1 WHERE book_id=$2 AND episode_number=$3`,
        [SUMMARY_FALLBACK_MARKER + s, bookId, row.episode_number]
      );
    }
    process.stdout.write(`  ep${row.episode_number}: ...`);
    try {
      const ok = await generateAndSaveLLMSummary({ pool, bookId, episodeNumber: row.episode_number, content: row.content });
      if (ok) { updated++; console.log(" UPDATED"); }
      else    { failed++;  console.log(" FAILED (no update)"); }
    } catch (e) {
      failed++;
      console.log(` ERROR: ${String(e).slice(0,120)}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`\nupdated=${updated} skipped=${skipped} failed=${failed}`);
  await pool.end();
}

main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(1); });
