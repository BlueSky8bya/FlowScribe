/**
 * setup_route_smoke_books.mjs — Phase 4.14 route별 smoke book 생성
 *
 * baseline은 기존 1f5854ed... 책 사용. deepseek_full / high_quality_ensemble은
 * 새 빈 book을 만들어 같은 world bible로 시작.
 *
 * Usage: node scripts/setup_route_smoke_books.mjs
 */
import pg from "pg";
import IORedis from "ioredis";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

// 기존 baseline book의 world bible 그대로 복제 — 같은 조건에서 모델만 비교
const BASELINE_BOOK_ID = "1f5854ed-581f-46f5-b009-89d1c8ec4bbd";
const TITLES = {
  deepseek_full: "폐허의 열쇠 — DeepSeek route",
  high_quality_ensemble: "폐허의 열쇠 — Ensemble route",
};

async function main() {
  // 기존 책의 user_id + context 가져오기
  const baseRes = await pool.query(
    "SELECT user_id, context FROM books WHERE id=$1",
    [BASELINE_BOOK_ID]
  );
  if (!baseRes.rows.length) { console.error("baseline book not found"); process.exit(1); }
  const userId = baseRes.rows[0].user_id;
  const baseContext = baseRes.rows[0].context;

  // 기존 redis world bible 복제용으로 가져오기
  const wb = await redis.get(`context:${BASELINE_BOOK_ID}`);
  if (!wb) { console.error("redis world bible 없음"); process.exit(1); }

  // 기존 canonical_characters 가져오기
  const canonRes = await pool.query(
    "SELECT name, type, gender, personality, initial_items FROM canonical_characters WHERE book_id=$1",
    [BASELINE_BOOK_ID]
  );

  const result = {};
  for (const [routeKey, title] of Object.entries(TITLES)) {
    // 기존 동명 책 삭제 후 재생성
    await pool.query("DELETE FROM books WHERE user_id=$1 AND title=$2", [userId, title]);
    const ins = await pool.query(
      "INSERT INTO books (id, user_id, title, context) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id",
      [userId, title, baseContext]
    );
    const bookId = ins.rows[0].id;
    result[routeKey] = bookId;

    // redis context 복제
    await redis.set(`context:${bookId}`, wb);

    // canonical_characters 복제
    for (const c of canonRes.rows) {
      await pool.query(
        `INSERT INTO canonical_characters (book_id, name, type, gender, personality, initial_items)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bookId, c.name, c.type, c.gender, c.personality, JSON.stringify(c.initial_items)]
      );
    }
    console.log(`✓ ${routeKey}: ${bookId} (${canonRes.rows.length} canonical characters)`);
  }

  console.log("\nbaseline_local:        ", BASELINE_BOOK_ID);
  console.log("deepseek_full:         ", result.deepseek_full);
  console.log("high_quality_ensemble: ", result.high_quality_ensemble);

  await pool.end();
  await redis.quit();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
