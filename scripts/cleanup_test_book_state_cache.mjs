/**
 * cleanup_test_book_state_cache.mjs — Phase 4.19C
 *
 * 특정 TEST 책의 생성/상태/소지품/감정/후처리 캐시를 cleanup한다.
 * 사용자가 세계관 설정에 직접 입력한 값(world_configs / world_rules / canonical_characters /
 * 사용자 입력 initial_items.description)은 보존한다.
 *
 * Usage:
 *   node scripts/cleanup_test_book_state_cache.mjs --book-id <uuid> --dry-run
 *   node scripts/cleanup_test_book_state_cache.mjs --book-id <uuid> --apply
 *
 * 주의:
 *   - --dry-run이 default. --apply 명시 없으면 실제 삭제하지 않는다.
 *   - book_id 없이 실행 불가.
 *   - 단일 book만 영향. 전역 일괄 수정은 하지 않는다.
 *
 * 보존:
 *   books (title, context — 단 character_defaults는 사용자 입력 description만 keep)
 *   world_configs (background, genre, mood, theme, common_tone)
 *   world_rules (사용자 입력 general / absolute_forbidden)
 *   canonical_characters (이름·성별·유형·personality·initial_items 사용자 입력 desc)
 *
 * Cleanup:
 *   episodes
 *   episode_snapshots
 *   run_traces
 *   character_dynamic_states
 *   character_inferred_states
 *   character_arcs
 *   arc_summaries
 *   foreshadows
 *   story_states
 *   author_interventions
 *   session_logs (해당 book만)
 *   validation_logs (해당 book만)
 *   revision_logs (해당 book만)
 *   ending_rewards / trajectory_rewards / dpo_pairs (해당 book만)
 *   item_vocab (LLM이 누적한 카테고리/badge 캐시)
 *   characters (legacy, world_bible source가 아닌 row만)
 *   redis context:<bookId>는 books.context에서 다시 prime 가능하므로 그대로 유지
 *
 * canonical_characters.initial_items 안의 generated description은 비워서
 * 사용자가 입력한 description만 source로 남기고 LLM이 다시 enrich하도록 한다.
 * 사용자 입력인지 LLM 결과인지 판별이 모호한 경우, 길이 기반 휴리스틱은 사용하지 않고
 * 모든 description을 일괄 비운다 — 사용자 입력은 books.context.character_defaults에
 * 별도 보존되어 있을 수 있고, 다음 saveContext에서 source로 다시 들어온다.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const dryRun = !args.includes("--apply");
if (!bookId || bookId.startsWith("--")) {
  console.error("Usage: node scripts/cleanup_test_book_state_cache.mjs --book-id <uuid> [--apply]");
  process.exit(2);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// cleanup 대상 테이블 (단일 book_id 기준)
const CLEANUP_TABLES = [
  "episodes",
  "episode_snapshots",
  "run_traces",
  "character_dynamic_states",
  "character_inferred_states",
  "character_arcs",
  "arc_summaries",
  "foreshadows",
  "story_states",
  "author_interventions",
  "session_logs",
  "validation_logs",
  "revision_logs",
  "ending_rewards",
  "trajectory_rewards",
  "dpo_pairs",
  "item_vocab",
  "characters", // legacy 보조 테이블
];

(async () => {
  const W = 80;
  console.log("\n" + "═".repeat(W));
  console.log(` Test Book Cache Cleanup ${dryRun ? "(DRY RUN)" : "(APPLY)"}`);
  console.log(` book_id: ${bookId}`);
  console.log("═".repeat(W));

  // 1. 책 존재 확인
  const bookRow = await pool.query("SELECT title FROM books WHERE id=$1", [bookId]);
  if (!bookRow.rows.length) {
    console.error("❌ 해당 book_id가 존재하지 않습니다.");
    await pool.end();
    process.exit(2);
  }
  const title = bookRow.rows[0].title;
  console.log(`\n[책] ${title}`);

  // 2. 보존되는 항목 요약
  console.log(`\n[보존]`);
  const wc = await pool.query("SELECT genre, background, mood, theme FROM world_configs WHERE book_id=$1", [bookId]);
  console.log(`  world_configs: ${wc.rows.length ? "있음 (" + Object.entries(wc.rows[0]).filter(([,v]) => v).map(([k]) => k).join(",") + ")" : "없음"}`);
  const wr = await pool.query("SELECT rule_type, COUNT(*) as n FROM world_rules WHERE book_id=$1 AND is_active=true GROUP BY rule_type", [bookId]);
  for (const r of wr.rows) console.log(`  world_rules.${r.rule_type}: ${r.n}건`);
  const cc = await pool.query("SELECT name, jsonb_array_length(COALESCE(initial_items, '[]'::jsonb)) as n_items FROM canonical_characters WHERE book_id=$1 ORDER BY name", [bookId]);
  console.log(`  canonical_characters: ${cc.rows.length}명`);
  for (const c of cc.rows) console.log(`    · ${c.name} (initial_items ${c.n_items}개)`);

  // 3. cleanup 대상 카운트
  console.log(`\n[삭제 대상 row count]`);
  const counts = {};
  for (const tbl of CLEANUP_TABLES) {
    try {
      const r = await pool.query(`SELECT COUNT(*) as n FROM ${tbl} WHERE book_id=$1`, [bookId]);
      counts[tbl] = parseInt(r.rows[0].n, 10);
      const mark = counts[tbl] > 0 ? "🗑" : "·";
      console.log(`  ${mark} ${tbl}: ${counts[tbl]}`);
    } catch (e) {
      console.log(`  ⚠️  ${tbl}: 컬럼/테이블 없음 (스킵) — ${String(e.message).slice(0, 80)}`);
      counts[tbl] = -1;
    }
  }

  // 4. canonical_characters.initial_items의 generated description 처리
  console.log(`\n[canonical_characters.initial_items.description (LLM 생성분 정리)]`);
  for (const c of cc.rows) {
    const r = await pool.query("SELECT initial_items FROM canonical_characters WHERE book_id=$1 AND name=$2", [bookId, c.name]);
    const items = Array.isArray(r.rows[0]?.initial_items) ? r.rows[0].initial_items : [];
    const withDesc = items.filter(it => it && it.description).length;
    console.log(`  · ${c.name}: ${withDesc}/${items.length} 항목에 description 있음 (모두 비워서 다음 saveContext에서 LLM 재enrich)`);
  }

  // 5. books.context.character_defaults의 사용자 입력 보존 여부 확인
  const bc = await pool.query("SELECT context FROM books WHERE id=$1", [bookId]);
  const ctxJson = bc.rows[0]?.context ?? {};
  const cd = ctxJson?.character_defaults ?? {};
  const cdNames = Object.keys(cd);
  console.log(`\n[books.context.character_defaults]`);
  console.log(`  보존됨 (saveContext source): ${cdNames.length}명 (${cdNames.join(", ")})`);

  // 6. 위험 요소 점검
  console.log(`\n[위험 점검]`);
  if (counts.episodes > 0) console.log(`  ⚠️  episodes ${counts.episodes}개 삭제 — 본문 복구 불가`);
  if (counts.run_traces > 0) console.log(`  ⚠️  run_traces ${counts.run_traces}개 삭제 — 학습/감사 trace 손실`);
  if (cdNames.length === 0) console.log(`  ⚠️  books.context.character_defaults 비어있음 — saveContext 다시 호출 권장`);

  if (dryRun) {
    console.log("\n" + "═".repeat(W));
    console.log(`✅ DRY RUN — 실제 삭제하지 않음. apply하려면 --apply 추가.`);
    console.log("═".repeat(W) + "\n");
    await pool.end();
    process.exit(0);
  }

  // 7. APPLY
  console.log(`\n[APPLY] cleanup 시작...`);
  await pool.query("BEGIN");
  try {
    for (const tbl of CLEANUP_TABLES) {
      if (counts[tbl] === -1) continue;
      const r = await pool.query(`DELETE FROM ${tbl} WHERE book_id=$1`, [bookId]);
      console.log(`  · ${tbl}: ${r.rowCount}개 삭제`);
    }

    // canonical_characters.initial_items.description 일괄 비움
    let charsCleaned = 0;
    for (const c of cc.rows) {
      const r = await pool.query("SELECT initial_items FROM canonical_characters WHERE book_id=$1 AND name=$2", [bookId, c.name]);
      const items = Array.isArray(r.rows[0]?.initial_items) ? r.rows[0].initial_items : [];
      const cleaned = items.map(it => {
        if (!it || typeof it !== "object") return it;
        const { description, ...rest } = it;
        return rest;
      });
      await pool.query(
        "UPDATE canonical_characters SET initial_items=$3, updated_at=NOW() WHERE book_id=$1 AND name=$2",
        [bookId, c.name, JSON.stringify(cleaned)]
      );
      charsCleaned++;
    }
    console.log(`  · canonical_characters: ${charsCleaned}명 initial_items.description 비움`);

    // books 테이블의 current_episode 1로 복원
    await pool.query("UPDATE books SET current_episode=1, updated_at=NOW() WHERE id=$1", [bookId]);
    console.log(`  · books.current_episode → 1`);

    await pool.query("COMMIT");
    console.log(`\n✅ APPLY 완료. 트랜잭션 커밋됨.`);
  } catch (e) {
    await pool.query("ROLLBACK");
    console.error(`\n❌ APPLY 실패. ROLLBACK. 원인: ${e.message}`);
    await pool.end();
    process.exit(1);
  }

  console.log("\n" + "═".repeat(W));
  console.log(`다음 단계: saveContext 재호출 또는 ep1 재생성으로 정상 동작 확인.`);
  console.log("═".repeat(W) + "\n");

  await pool.end();
  process.exit(0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(2); });
