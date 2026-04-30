/**
 * audit_world_rule_integrity.mjs — Phase 4.19
 *
 * 특정 book의 절대 규칙 데이터 흐름이 어디까지 살아 있는지 진단한다.
 *   1) books.context (UI 저장 후 JSON 덩어리)
 *   2) world_configs 테이블
 *   3) world_rules 테이블 (general / absolute_forbidden)
 *   4) Redis context:<bookId>
 *   5) effective_context 조립 결과 (book이 ep1을 한 번이라도 생성했다면 run_traces.effective_context_snapshot)
 *
 * 출력은 어디가 채워졌고 어디가 비었는지 표로 보여준다.
 *
 * Usage:
 *   node scripts/audit_world_rule_integrity.mjs --book-id <uuid>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");
const IORedis = require("ioredis");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
if (!bookId) {
  console.error("Usage: node scripts/audit_world_rule_integrity.mjs --book-id <uuid>");
  process.exit(2);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

function trim(s, n = 80) {
  if (s == null) return "(null)";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

(async () => {
  const W = 80;
  console.log("\n" + "═".repeat(W));
  console.log(` World Rule Integrity Audit — book ${bookId.slice(0, 8)}…`);
  console.log("═".repeat(W));

  // 1. books.context
  const bookRow = await pool.query("SELECT title, context FROM books WHERE id=$1", [bookId]);
  if (!bookRow.rows.length) {
    console.error("book not found");
    process.exit(2);
  }
  const title = bookRow.rows[0].title;
  const ctx = bookRow.rows[0].context ?? null;
  console.log(`\n[책] ${title}`);
  console.log(`\n[1] books.context (JSON 덩어리)`);
  if (!ctx) {
    console.log("  ❌ NULL");
  } else {
    console.log(`  world_rules: ${ctx.world_rules?.length ?? 0}`);
    (ctx.world_rules ?? []).forEach((r, i) => console.log(`    ${i + 1}. ${trim(r)}`));
    console.log(`  forbidden_settings: ${ctx.forbidden_settings?.length ?? 0}`);
    (ctx.forbidden_settings ?? []).forEach((r, i) => console.log(`    ${i + 1}. ${trim(r)}`));
    console.log(`  story_config.genre: ${trim(ctx.story_config?.genre)}`);
    console.log(`  story_config.background: ${trim(ctx.story_config?.background)}`);
  }

  // 2. world_configs 테이블
  console.log(`\n[2] world_configs 테이블`);
  const wc = await pool.query(
    "SELECT genre, background, mood, theme, common_tone FROM world_configs WHERE book_id=$1",
    [bookId]
  );
  if (!wc.rows.length) {
    console.log("  ❌ row 없음");
  } else {
    const r = wc.rows[0];
    console.log(`  genre: ${trim(r.genre)}`);
    console.log(`  background: ${trim(r.background)}`);
    console.log(`  mood: ${trim(r.mood)}`);
    console.log(`  theme: ${trim(r.theme)}`);
  }

  // 3. world_rules 테이블
  console.log(`\n[3] world_rules 테이블`);
  const wr = await pool.query(
    "SELECT rule_type, content, is_active FROM world_rules WHERE book_id=$1 ORDER BY rule_type, created_at",
    [bookId]
  );
  if (!wr.rows.length) {
    console.log("  ❌ 0 rows");
  } else {
    const general = wr.rows.filter(r => r.rule_type === "general" && r.is_active);
    const forbid  = wr.rows.filter(r => r.rule_type === "absolute_forbidden" && r.is_active);
    console.log(`  general (active): ${general.length}`);
    general.forEach((r, i) => console.log(`    ${i + 1}. ${trim(r.content)}`));
    console.log(`  absolute_forbidden (active): ${forbid.length}`);
    forbid.forEach((r, i) => console.log(`    ${i + 1}. ${trim(r.content)}`));
    const inactive = wr.rows.filter(r => !r.is_active).length;
    if (inactive) console.log(`  inactive: ${inactive}`);
  }

  // 4. Redis cache
  console.log(`\n[4] Redis context:${bookId.slice(0, 8)}…`);
  const raw = await redis.get(`context:${bookId}`);
  if (!raw) {
    console.log("  ⚠️ MISS");
  } else {
    const c = JSON.parse(raw);
    console.log(`  world_rules: ${c.world_rules?.length ?? 0}, forbidden: ${c.forbidden_settings?.length ?? 0}, len: ${raw.length}`);
  }

  // 5. run_traces — 가장 최근 trace의 effective_context_snapshot
  console.log(`\n[5] run_traces.effective_context_snapshot (최신)`);
  const tr = await pool.query(
    `SELECT episode_number, effective_context_snapshot FROM run_traces
     WHERE book_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [bookId]
  );
  if (!tr.rows.length) {
    console.log("  (이 책의 trace 없음 — 아직 1화 생성하지 않았거나 trace 비활성)");
  } else {
    const ecs = tr.rows[0].effective_context_snapshot;
    if (!ecs) {
      console.log("  ⚠️ snapshot null");
    } else {
      console.log(`  episode: ${tr.rows[0].episode_number}`);
      console.log(`  general_rules: ${ecs.general_rules?.length ?? 0}`);
      console.log(`  absolute_forbidden: ${ecs.absolute_forbidden?.length ?? 0}`);
      (ecs.absolute_forbidden ?? []).forEach((r, i) => console.log(`    ${i + 1}. ${trim(r)}`));
      console.log(`  world_config.genre: ${trim(ecs.world_config?.genre)}`);
      console.log(`  world_config.background: ${trim(ecs.world_config?.background)}`);
    }
  }

  // 종합 verdict
  const ctxOk    = (ctx?.world_rules?.length ?? 0) + (ctx?.forbidden_settings?.length ?? 0) > 0;
  const wcOk     = wc.rows.length > 0 && (wc.rows[0].genre || wc.rows[0].background);
  const wrOk     = wr.rows.some(r => r.is_active);
  const redisOk  = !!raw;

  console.log("\n" + "═".repeat(W));
  console.log(` 결론`);
  console.log(`   books.context  : ${ctxOk    ? "✅ 데이터 있음" : "❌ 비어있음"}`);
  console.log(`   world_configs  : ${wcOk     ? "✅ 데이터 있음" : "❌ 비어있음 (Phase 4.19 sync 필요)"}`);
  console.log(`   world_rules    : ${wrOk     ? "✅ active rules" : "❌ 없음 (Phase 4.19 sync 필요)"}`);
  console.log(`   redis cache    : ${redisOk  ? "✅ HIT" : "⚠️ MISS"}`);
  const verdict = ctxOk && wcOk && wrOk ? "PASS" : (ctxOk ? "PARTIAL — 다시 한 번 saveContext 필요" : "FAIL");
  const icon = verdict === "PASS" ? "✅" : verdict === "PARTIAL" ? "⚠️" : "❌";
  console.log(`\n${icon} INTEGRITY VERDICT: ${verdict}`);
  console.log("═".repeat(W) + "\n");

  await pool.end();
  await redis.quit();
  process.exit(verdict === "FAIL" ? 1 : 0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(2); });
