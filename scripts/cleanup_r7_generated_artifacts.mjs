/**
 * cleanup_r7_generated_artifacts.mjs — POST-S13.5 P0 R7 invalidated 데이터 정리
 *
 * R7 canary 책 (ep1~10)이 stale "현대 로맨스" 장르 + hard rule 미적용 + location stuck
 * 상태에서 생성됐으므로 R7 canary 데이터로 무효 처리.
 *
 * 본 script는 명시적 --apply 없이는 dry-run only — 절대 DB write 안 함.
 * orphan rows cleanup과 절대 섞지 마라 (book_id 정확 일치 가드만 사용).
 *
 * 사용법:
 *   # dry-run
 *   node scripts/cleanup_r7_generated_artifacts.mjs --book-id <book_id>
 *
 *   # 실제 DELETE 적용 (transaction)
 *   node scripts/cleanup_r7_generated_artifacts.mjs --book-id <book_id> --apply
 *
 * 안전 가드:
 *   - book_id 미입력 시 즉시 종료
 *   - title이 정확히 "R7_회색지대_생존기_CANARY"인지 검증 (다른 책 보호)
 *   - --apply 없으면 어떤 DELETE/UPDATE도 수행 안 함
 *   - 단일 트랜잭션 — 부분 실패 시 ROLLBACK
 *   - user-authored 테이블은 절대 미터치
 *
 * 보존 (user-authored, 절대 미터치):
 *   - books (row 자체)
 *   - books.context (jsonb)
 *   - canonical_characters
 *   - characters
 *   - item_vocab
 *   - world_configs
 *   - world_rules
 *
 * 삭제 (generated artifacts):
 *   - arc_summaries
 *   - author_interventions (있으면)
 *   - character_arcs
 *   - character_dynamic_states
 *   - character_inferred_states (있으면)
 *   - dpo_pairs (있으면)
 *   - ending_rewards (있으면)
 *   - episode_snapshots
 *   - episodes
 *   - foreshadows
 *   - revision_logs (있으면)
 *   - run_traces
 *   - session_logs (있으면)
 *   - story_states (있으면)
 *   - trajectory_rewards (있으면)
 *   - validation_logs (있으면)
 *   - voice_character_map (있으면)
 *
 * 추가 작업:
 *   - books.current_episode = 1 reset (1화부터 재시작 가능 상태)
 */

import pg from "pg";
import { config as loadEnv } from "dotenv";
loadEnv();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const bidIdx = args.indexOf("--book-id");
const APPLY  = args.includes("--apply");
const BOOK_ID = bidIdx !== -1 ? args[bidIdx + 1] : null;

const EXPECTED_TITLE = "R7_회색지대_생존기_CANARY";

const GENERATED_TABLES = Object.freeze([
  "arc_summaries",
  "author_interventions",
  "character_arcs",
  "character_dynamic_states",
  "character_inferred_states",
  "dpo_pairs",
  "ending_rewards",
  "episode_snapshots",
  "episodes",
  "foreshadows",
  "revision_logs",
  "run_traces",
  "session_logs",
  "story_states",
  "trajectory_rewards",
  "validation_logs",
  "voice_character_map",
]);

const PRESERVED_TABLES = Object.freeze([
  "books",
  "canonical_characters",
  "characters",
  "item_vocab",
  "world_configs",
  "world_rules",
]);

if (!BOOK_ID) {
  console.error("Usage:");
  console.error("  node scripts/cleanup_r7_generated_artifacts.mjs --book-id <book_id> [--apply]");
  process.exit(1);
}

const MODE = APPLY ? "APPLY" : "DRY-RUN";

async function tableHasBookId(client, table) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='book_id' LIMIT 1`,
    [table]
  );
  return r.rows.length > 0;
}

async function countRows(client, table, bookId) {
  const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE book_id = $1`, [bookId]);
  return r.rows[0]?.n ?? 0;
}

async function main() {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`cleanup_r7_generated_artifacts — ${MODE}`);
  console.log(`book_id:  ${BOOK_ID}`);
  console.log(`${"═".repeat(72)}`);

  const client = await pool.connect();

  // book + title 가드
  const b = await client.query(`SELECT id, title, current_episode FROM books WHERE id = $1`, [BOOK_ID]);
  if (b.rows.length === 0) {
    console.error(`✗ book not found: ${BOOK_ID}`);
    client.release();
    await pool.end();
    process.exit(1);
  }
  const book = b.rows[0];
  console.log(`title: ${book.title}`);
  console.log(`current_episode: ${book.current_episode}`);

  if (book.title !== EXPECTED_TITLE) {
    console.error(`✗ title 불일치 — expected "${EXPECTED_TITLE}", got "${book.title}"`);
    console.error(`  R7 canary 책이 아니므로 cleanup 거부 (다른 책 보호).`);
    client.release();
    await pool.end();
    process.exit(1);
  }

  // ─── 보존 테이블 row count (read-only 확인) ───
  console.log(`\n${"─".repeat(72)}`);
  console.log("보존 (user-authored, 미터치) — row count");
  console.log(`${"─".repeat(72)}`);
  for (const t of PRESERVED_TABLES) {
    if (!(await tableHasBookId(client, t))) {
      console.log(`  ⊘ ${t.padEnd(26)} (book_id 컬럼 없음 — skip)`);
      continue;
    }
    const n = await countRows(client, t, BOOK_ID);
    console.log(`  • ${t.padEnd(26)} ${n} rows (보존)`);
  }

  // ─── cleanup 대상 row count (dry-run) ───
  console.log(`\n${"─".repeat(72)}`);
  console.log("삭제 대상 (generated artifacts) — row count");
  console.log(`${"─".repeat(72)}`);
  let total = 0;
  const targets = [];
  for (const t of GENERATED_TABLES) {
    if (!(await tableHasBookId(client, t))) {
      console.log(`  ⊘ ${t.padEnd(28)} (테이블 또는 book_id 컬럼 없음 — skip)`);
      continue;
    }
    const n = await countRows(client, t, BOOK_ID);
    console.log(`  • ${t.padEnd(28)} ${n} rows`);
    if (n > 0) targets.push({ table: t, count: n });
    total += n;
  }
  console.log(`  ${"─".repeat(38)}`);
  console.log(`  cleanup 합계: ${total} rows`);

  // ─── 추가 작업 ───
  console.log(`\n${"─".repeat(72)}`);
  console.log("추가 작업");
  console.log(`${"─".repeat(72)}`);
  console.log(`  • books.current_episode: ${book.current_episode} → 1 (1화부터 재시작 가능)`);

  if (!APPLY) {
    console.log(`\n${"─".repeat(72)}`);
    console.log("DRY-RUN 종료. DB 미수정. 적용하려면 --apply 인자 추가.");
    client.release();
    await pool.end();
    return;
  }

  // ─── APPLY ───
  console.log(`\n${"─".repeat(72)}`);
  console.log("APPLY — DELETE generated artifacts (transaction)");
  console.log(`${"─".repeat(72)}`);

  let actuallyDeleted = 0;
  try {
    await client.query("BEGIN");

    for (const t of targets) {
      const r = await client.query(`DELETE FROM "${t.table}" WHERE book_id = $1`, [BOOK_ID]);
      console.log(`  ✓ ${t.table.padEnd(28)} deleted ${r.rowCount} rows (expected ${t.count})`);
      actuallyDeleted += r.rowCount;
    }

    // current_episode reset
    const upd = await client.query(
      `UPDATE books SET current_episode = 1 WHERE id = $1 AND title = $2`,
      [BOOK_ID, EXPECTED_TITLE]
    );
    if (upd.rowCount !== 1) throw new Error(`books UPDATE rowCount unexpected: ${upd.rowCount}`);
    console.log(`  ✓ books.current_episode reset to 1`);

    await client.query("COMMIT");
    console.log(`✓ COMMIT — total ${actuallyDeleted} rows deleted, books.current_episode=1`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`✗ ROLLBACK — ${e?.message ?? e}`);
    client.release();
    await pool.end();
    process.exit(1);
  }

  // ─── post-apply 검증 (read-only) ───
  console.log(`\n${"─".repeat(72)}`);
  console.log("POST-APPLY VERIFY (read-only)");
  console.log(`${"─".repeat(72)}`);
  let vFail = 0;
  for (const t of GENERATED_TABLES) {
    if (!(await tableHasBookId(client, t))) continue;
    const n = await countRows(client, t, BOOK_ID);
    const ok = n === 0;
    console.log(`  ${ok ? "✓" : "✗"} ${t.padEnd(28)} ${n} rows ${ok ? "" : "(expected 0)"}`);
    if (!ok) vFail++;
  }
  // 보존 테이블 검증
  for (const t of PRESERVED_TABLES) {
    if (!(await tableHasBookId(client, t))) continue;
    const n = await countRows(client, t, BOOK_ID);
    console.log(`  ✓ ${t.padEnd(28)} ${n} rows (보존 확인)`);
  }
  // current_episode = 1
  const v = await client.query(`SELECT current_episode FROM books WHERE id = $1`, [BOOK_ID]);
  const ce = v.rows[0]?.current_episode;
  console.log(`  ${ce === 1 ? "✓" : "✗"} books.current_episode = ${ce}`);
  if (ce !== 1) vFail++;

  client.release();
  await pool.end();
  process.exit(vFail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("cleanup 실패:", e?.message ?? e);
  await pool.end().catch(() => {});
  process.exit(1);
});
