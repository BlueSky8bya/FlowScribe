/**
 * debug_episode_titles.mjs — 책별 에피소드 제목 진단 (중복/패턴 확인용)
 *
 * Usage:
 *   node scripts/debug_episode_titles.mjs                — 모든 책 요약
 *   node scripts/debug_episode_titles.mjs --book "확깨용" — 제목으로 검색
 *   node scripts/debug_episode_titles.mjs --book-id <id>
 */
import pg from "pg";
import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const titleFilter = args.includes("--book") ? args[args.indexOf("--book") + 1] : null;
const bookIdFilter = args.includes("--book-id") ? args[args.indexOf("--book-id") + 1] : null;

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TITLE_RE = /^#\s*(\d+화\s*[-–—]\s*.+?)\s*$/m;

async function main() {
  let q, params;
  if (bookIdFilter) {
    q = `SELECT id, title FROM books WHERE id=$1`;
    params = [bookIdFilter];
  } else if (titleFilter) {
    q = `SELECT id, title FROM books WHERE title ILIKE $1 ORDER BY updated_at DESC`;
    params = [`%${titleFilter}%`];
  } else {
    q = `SELECT id, title FROM books ORDER BY updated_at DESC LIMIT 10`;
    params = [];
  }
  const books = await pool.query(q, params);

  for (const b of books.rows) {
    const ep = await pool.query(
      `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number ASC`,
      [b.id]
    );
    console.log(`\n=== ${b.title} (${b.id}) — ${ep.rows.length}화 ===`);
    const titles = [];
    for (const e of ep.rows) {
      const m = e.content.match(TITLE_RE);
      const t = m ? m[1].trim() : "(제목 미추출)";
      titles.push({ ep: e.episode_number, title: t });
      console.log(`  ep${String(e.episode_number).padStart(2)}: ${t}`);
    }
    // 중복 검사
    const norm = (s) => s.replace(/^\d+화\s*[-–—]\s*/, "").trim();
    const seen = new Map();
    for (const { ep: n, title } of titles) {
      const k = norm(title);
      if (seen.has(k)) {
        console.log(`  ⚠️ DUPLICATE: ep${seen.get(k)} ↔ ep${n}: "${k}"`);
      } else {
        seen.set(k, n);
      }
    }
  }

  await pool.end();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
