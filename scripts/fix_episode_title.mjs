/**
 * fix_episode_title.mjs — 특정 화의 제목을 안전하게 변경 (content 첫 줄 + summary 동기화)
 *
 * 일반 도구. 특정 책 하드코딩 없음. CLI 인자로 모든 값 받음.
 *
 * Usage:
 *   node scripts/fix_episode_title.mjs --book-id <uuid> --ep <N> --new-title "<새 제목>"
 *
 * 동작:
 *   1. content 첫 줄 "# N화 - 제목"을 "# N화 - <새 제목>"으로 치환
 *   2. summary가 동일한 첫 줄로 시작하면 그것도 동기화
 *   3. 변경 전후 미리보기 표시 + 확인 (--yes 없으면 dry-run)
 */
import pg from "pg";
import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const ep = parseInt(args[args.indexOf("--ep") + 1], 10);
const newTitle = args[args.indexOf("--new-title") + 1];
const apply = args.includes("--yes");

if (!bookId || !ep || !newTitle) {
  console.error("Usage: --book-id <uuid> --ep <N> --new-title \"<title>\" [--yes]");
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TITLE_LINE_RE = /^(#\s*\d+화\s*[-–—]\s*)(.+?)(\s*)$/m;

async function main() {
  const r = await pool.query(
    `SELECT content, summary FROM episodes WHERE book_id=$1 AND episode_number=$2`,
    [bookId, ep]
  );
  if (!r.rows.length) {
    console.error(`ep${ep} not found for book ${bookId}`);
    process.exit(1);
  }
  const { content, summary } = r.rows[0];
  const m = content.match(TITLE_LINE_RE);
  if (!m) {
    console.error("title line not detected (expected '# N화 - 제목')");
    process.exit(1);
  }
  const oldTitle = m[2].trim();
  const newContent = content.replace(TITLE_LINE_RE, `$1${newTitle}$3`);

  // summary가 같은 첫 줄로 시작하면 동기화 (선택적)
  let newSummary = summary;
  if (summary && TITLE_LINE_RE.test(summary)) {
    newSummary = summary.replace(TITLE_LINE_RE, `$1${newTitle}$3`);
  }

  console.log(`book_id : ${bookId}`);
  console.log(`episode : ${ep}`);
  console.log(`OLD     : ${oldTitle}`);
  console.log(`NEW     : ${newTitle}`);
  console.log(`summary : ${newSummary !== summary ? "동기화됨" : "변경 없음"}`);

  if (!apply) {
    console.log("\n[dry-run] --yes 추가 시 실제 적용");
    await pool.end();
    return;
  }

  await pool.query(
    `UPDATE episodes SET content=$1, summary=$2 WHERE book_id=$3 AND episode_number=$4`,
    [newContent, newSummary, bookId, ep]
  );
  console.log("✅ updated");
  await pool.end();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
