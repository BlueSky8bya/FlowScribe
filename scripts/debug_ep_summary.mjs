/**
 * debug_ep_summary.mjs — 특정 화 요약/주요 사건 확인 (제목 변경 대안 제안용)
 */
import pg from "pg";
import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const ep = parseInt(args[args.indexOf("--ep") + 1], 10);
if (!bookId || !ep) { console.error("Usage: --book-id <id> --ep <n>"); process.exit(1); }

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const r = await pool.query(
  `SELECT episode_number, summary, LEFT(content, 1500) AS head, LENGTH(content) AS len
   FROM episodes WHERE book_id=$1 AND episode_number=$2`,
  [bookId, ep]
);
if (!r.rows.length) { console.log("not found"); process.exit(0); }
const row = r.rows[0];
console.log(`ep${row.episode_number} — len=${row.len}`);
console.log(`summary: ${row.summary ?? "(none)"}`);
console.log("--- head ---");
console.log(row.head);
await pool.end();
