/**
 * audit_context_sync.mjs — POST-S13.5 P0 dynamic audit
 *
 * 특정 book_id 기준으로 books.context / world_configs / world_rules / Redis cache /
 * effective_context.task.goal 5개 source가 일치하는지 read-only 검사.
 *
 * 사용법:
 *   node scripts/audit_context_sync.mjs --book-id <book_id>
 *
 *   # R7 expected 값 모드 (genre = "포스트아포칼립스 서바이벌" 등 강제 검증)
 *   node scripts/audit_context_sync.mjs --book-id <R7_id> --expected-r7
 *
 * 검사:
 *   1. books.context.story_config.genre === world_configs.genre (Redis도 일치)
 *   2. books.context.story_config.mood === world_configs.mood (Redis도 일치)
 *   3. books.context.forbidden_settings === world_rules.absolute_forbidden (active만)
 *   4. books.context.world_rules (장르 prefix 제외) === world_rules.general (active만)
 *   5. effective_context.task.goal에 expected genre가 들어가는지
 *      ("현대 로맨스" 같은 stale 흔적이면 FAIL)
 *   6. effective_context.absolute_forbidden 0건이면 FAIL
 *   7. Redis context:${book_id} TTL > 0
 *
 * 본 audit는 read-only — 어떤 DB/Redis write도 수행 안 함.
 */

import pg from "pg";
import IORedis from "ioredis";
import { config as loadEnv } from "dotenv";
loadEnv();

// effective_context import (dist 빌드 후)
const { buildEffectiveContext } = await import("../dist/services/effective_context.js");

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379");

const args = process.argv.slice(2);
const bidIdx = args.indexOf("--book-id");
const BOOK_ID = bidIdx !== -1 ? args[bidIdx + 1] : null;
const EXPECT_R7 = args.includes("--expected-r7");

const R7_EXPECTED = Object.freeze({
  title: "R7_회색지대_생존기_CANARY",
  genre: "포스트아포칼립스 서바이벌",
  mood:  "스릴러, 드라마",
  forbidden: ["사망자 발화 금지", "지식 경계 / 알 수 없는 정보 사용 금지"],
});

if (!BOOK_ID) {
  console.error("Usage:");
  console.error("  node scripts/audit_context_sync.mjs --book-id <book_id> [--expected-r7]");
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (s, d) => { console.log("  ✓ " + s + (d ? " — " + d : "")); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };

function eq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a).trim() === String(b).trim();
}
function arrEq(a, b) {
  const A = (Array.isArray(a) ? a : []).map(x => String(x).trim()).filter(Boolean).sort();
  const B = (Array.isArray(b) ? b : []).map(x => String(x).trim()).filter(Boolean).sort();
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false;
  return true;
}

async function main() {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`audit_context_sync — book_id: ${BOOK_ID}${EXPECT_R7 ? " (R7 expected mode)" : ""}`);
  console.log(`${"═".repeat(72)}`);

  // 1. books.context
  const b = await pool.query(`SELECT id, title, context FROM books WHERE id = $1`, [BOOK_ID]);
  if (b.rows.length === 0) {
    console.error(`✗ book not found: ${BOOK_ID}`);
    process.exit(1);
  }
  const book = b.rows[0];
  const ctx = book.context || {};
  const sc  = ctx.story_config || {};
  const ctxFb = Array.isArray(ctx.forbidden_settings) ? ctx.forbidden_settings : [];
  const ctxRules = Array.isArray(ctx.world_rules) ? ctx.world_rules.filter(r => !/^장르\s*[:：]/.test(String(r))) : [];

  console.log(`\ntitle: ${book.title}`);
  console.log(`books.context.story_config.genre: ${JSON.stringify(sc.genre)}`);
  console.log(`books.context.story_config.mood:  ${JSON.stringify(sc.mood)}`);
  console.log(`books.context.forbidden_settings count: ${ctxFb.length}`);
  console.log(`books.context.world_rules (장르 prefix 제외) count: ${ctxRules.length}`);

  // 2. world_configs
  const wc = await pool.query(`SELECT genre, mood, background FROM world_configs WHERE book_id = $1`, [BOOK_ID]);
  const wcRow = wc.rows[0] ?? {};
  console.log(`\nworld_configs.genre: ${JSON.stringify(wcRow.genre)}`);
  console.log(`world_configs.mood:  ${JSON.stringify(wcRow.mood)}`);

  // 3. world_rules (active)
  const wr = await pool.query(`SELECT rule_type, content FROM world_rules WHERE book_id = $1 AND is_active = true`, [BOOK_ID]);
  const wrGeneral = wr.rows.filter(r => r.rule_type === "general").map(r => String(r.content).trim());
  const wrAbsolute = wr.rows.filter(r => r.rule_type === "absolute_forbidden").map(r => String(r.content).trim());
  console.log(`\nworld_rules.general (active) count: ${wrGeneral.length}`);
  console.log(`world_rules.absolute_forbidden (active) count: ${wrAbsolute.length}`);

  // 4. Redis cache
  const rawRedis = await redis.get(`context:${BOOK_ID}`);
  const redisTTL = await redis.ttl(`context:${BOOK_ID}`);
  let redisObj = null;
  if (rawRedis) {
    try { redisObj = JSON.parse(rawRedis); } catch {}
  }
  console.log(`\nRedis cache exists: ${rawRedis ? "yes" : "no"} (TTL: ${redisTTL})`);
  if (redisObj) {
    console.log(`Redis story_config.genre: ${JSON.stringify(redisObj.story_config?.genre)}`);
    console.log(`Redis story_config.mood:  ${JSON.stringify(redisObj.story_config?.mood)}`);
    console.log(`Redis forbidden_settings count: ${(redisObj.forbidden_settings ?? []).length}`);
  }

  // 5. effective_context (generation 직전 실제 prompt source)
  let ec = null;
  try {
    ec = await buildEffectiveContext({ bookId: BOOK_ID, episodeNumber: 1 });
  } catch (e) {
    console.error("✗ buildEffectiveContext 실패:", e?.message ?? e);
  }
  if (ec) {
    console.log(`\neffective_context.world_config.genre: ${JSON.stringify(ec.world_config?.genre)}`);
    console.log(`effective_context.world_config.mood:  ${JSON.stringify(ec.world_config?.mood)}`);
    console.log(`effective_context.task.goal: ${JSON.stringify(ec.task?.goal)}`);
    console.log(`effective_context.absolute_forbidden count: ${(ec.absolute_forbidden ?? []).length}`);
  }

  // ─── 검사 ───
  console.log(`\n${"─".repeat(72)}`);
  console.log("검사");
  console.log(`${"─".repeat(72)}`);

  // [1] books vs world_configs
  console.log("\n── [1] books.context ↔ world_configs ──");
  if (eq(sc.genre, wcRow.genre)) ok("genre 일치", `${JSON.stringify(sc.genre)}`);
  else ng("genre mismatch", `books=${JSON.stringify(sc.genre)} world_configs=${JSON.stringify(wcRow.genre)}`);
  if (eq(sc.mood, wcRow.mood)) ok("mood 일치");
  else ng("mood mismatch", `books=${JSON.stringify(sc.mood)} world_configs=${JSON.stringify(wcRow.mood)}`);

  // [2] books vs world_rules
  console.log("\n── [2] books.context ↔ world_rules ──");
  if (arrEq(ctxFb, wrAbsolute)) ok(`forbidden_settings 일치 (${ctxFb.length}건)`);
  else ng("forbidden_settings mismatch", `books=${JSON.stringify(ctxFb)} world_rules=${JSON.stringify(wrAbsolute)}`);
  if (arrEq(ctxRules, wrGeneral)) ok(`general world_rules 일치 (${ctxRules.length}건)`);
  else ng("general world_rules mismatch", `books=${JSON.stringify(ctxRules)} world_rules=${JSON.stringify(wrGeneral)}`);

  // [3] books vs Redis
  console.log("\n── [3] books.context ↔ Redis cache ──");
  if (!redisObj) {
    ng("Redis cache 부재 (saveContext 또는 helper 호출 누락)");
  } else {
    if (eq(sc.genre, redisObj.story_config?.genre)) ok("Redis story_config.genre 일치");
    else ng("Redis story_config.genre mismatch", `books=${JSON.stringify(sc.genre)} redis=${JSON.stringify(redisObj.story_config?.genre)}`);
    if (eq(sc.mood, redisObj.story_config?.mood)) ok("Redis story_config.mood 일치");
    else ng("Redis story_config.mood mismatch", `books=${JSON.stringify(sc.mood)} redis=${JSON.stringify(redisObj.story_config?.mood)}`);
    const redisFb = Array.isArray(redisObj.forbidden_settings) ? redisObj.forbidden_settings : [];
    if (arrEq(ctxFb, redisFb)) ok(`Redis forbidden_settings 일치 (${redisFb.length}건)`);
    else ng("Redis forbidden_settings mismatch", `books=${JSON.stringify(ctxFb)} redis=${JSON.stringify(redisFb)}`);
    if (redisTTL > 0) ok(`Redis TTL > 0 (${redisTTL}s)`);
    else ng("Redis TTL ≤ 0", `${redisTTL}`);
  }

  // [4] effective_context (실제 prompt source)
  console.log("\n── [4] effective_context (generation 직전 실제 값) ──");
  if (ec) {
    if (eq(ec.world_config?.genre, sc.genre)) ok("effective.world_config.genre 일치");
    else ng("effective.world_config.genre mismatch", `effective=${JSON.stringify(ec.world_config?.genre)} books=${JSON.stringify(sc.genre)}`);
    if (eq(ec.world_config?.mood, sc.mood)) ok("effective.world_config.mood 일치");
    else ng("effective.world_config.mood mismatch", `effective=${JSON.stringify(ec.world_config?.mood)} books=${JSON.stringify(sc.mood)}`);

    const taskGoal = String(ec.task?.goal ?? "");
    if (/현대\s*로맨스/.test(taskGoal)) ng(`task.goal에 "현대 로맨스" stale 흔적 — FAIL`, taskGoal);
    else ok("task.goal에 stale 흔적 없음", taskGoal);

    if ((ec.absolute_forbidden ?? []).length === 0) ng("effective.absolute_forbidden 0건 — hard rule prompt 누락");
    else ok(`effective.absolute_forbidden ${ec.absolute_forbidden.length}건`);
  } else {
    ng("effective_context 빌드 실패");
  }

  // [5] R7 expected 모드
  if (EXPECT_R7) {
    console.log("\n── [5] R7 expected 검증 ──");
    if (book.title === R7_EXPECTED.title) ok(`title = ${R7_EXPECTED.title}`);
    else ng("R7 title 불일치", book.title);
    if (eq(sc.genre, R7_EXPECTED.genre)) ok(`books genre = ${R7_EXPECTED.genre}`);
    else ng("R7 genre mismatch", JSON.stringify(sc.genre));
    if (eq(wcRow.genre, R7_EXPECTED.genre)) ok(`world_configs genre = ${R7_EXPECTED.genre}`);
    else ng("R7 world_configs.genre mismatch", JSON.stringify(wcRow.genre));
    if (ec && eq(ec.world_config?.genre, R7_EXPECTED.genre)) ok(`effective.world_config.genre = ${R7_EXPECTED.genre}`);
    else if (ec) ng("R7 effective.world_config.genre mismatch", JSON.stringify(ec.world_config?.genre));
    for (const r of R7_EXPECTED.forbidden) {
      const inWr = wrAbsolute.includes(r);
      const inEc = ec ? (ec.absolute_forbidden ?? []).map(s => String(s).trim()).includes(r) : false;
      if (inWr) ok(`world_rules.absolute_forbidden contains "${r}"`);
      else ng(`world_rules.absolute_forbidden missing "${r}"`);
      if (inEc) ok(`effective.absolute_forbidden contains "${r}"`);
      else if (ec) ng(`effective.absolute_forbidden missing "${r}"`);
    }
  }

  await pool.end();
  await redis.quit();

  console.log("\n" + "─".repeat(72));
  const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
  console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("audit_context_sync 실패:", e?.message ?? e);
  await pool.end().catch(() => {});
  await redis.quit().catch(() => {});
  process.exit(1);
});
