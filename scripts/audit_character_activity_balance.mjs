/**
 * audit_character_activity_balance.mjs
 * canonical 인물별 화수별 등장·활동 균형 감사
 * Usage: node scripts/audit_character_activity_balance.mjs --book-id <uuid>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
if (!bookId) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const [canonRes, stateRes, traceRes, epRes] = await Promise.all([
  pool.query(`SELECT name FROM canonical_characters WHERE book_id=$1 ORDER BY name`, [bookId]),
  pool.query(
    `SELECT character_name, episode_number, recent_goal, emotional_state
     FROM character_dynamic_states WHERE book_id=$1 ORDER BY character_name, episode_number`,
    [bookId]
  ),
  pool.query(
    `SELECT DISTINCT ON (episode_number) episode_number, planner_trace
     FROM run_traces WHERE book_id=$1 ORDER BY episode_number, created_at DESC`,
    [bookId]
  ),
  pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
    [bookId]
  ),
]);
await pool.end();

const canonical = canonRes.rows.map(r => r.name);
const episodes  = epRes.rows;
const totalEps  = episodes.length;

console.log(`\n═══════════════════════════════════════════════════════`);
console.log(` AUDIT — Character Activity Balance (book: ${bookId.slice(0, 8)}...)`);
console.log(` canonical: ${canonical.join(", ")} | episodes: ${totalEps}`);
console.log(`═══════════════════════════════════════════════════════\n`);

// state record 인덱스
const stateByChar = {};
for (const s of stateRes.rows) {
  if (!stateByChar[s.character_name]) stateByChar[s.character_name] = {};
  stateByChar[s.character_name][s.episode_number] = s;
}

// planner beats에서 characters_involved 인덱스
const beatsByEp = {};
for (const r of traceRes.rows) {
  const beats = r.planner_trace?.parsed_plan?.scene_beats ?? [];
  beatsByEp[r.episode_number] = beats.flatMap(b => b.characters_involved ?? []);
}

// 에피소드 본문에서 인물 언급 카운트
function countMentions(text, name) {
  return (text.match(new RegExp(name, "g")) ?? []).length;
}

let totalInactive = 0;

for (const name of canonical) {
  const states = stateByChar[name] ?? {};
  let consecutiveInactive = 0;
  let maxConsecutiveInactive = 0;
  let totalMentions = 0;

  console.log(`\n[${name}]`);
  for (const ep of episodes) {
    const epNum = ep.episode_number;
    const state = states[epNum];
    const beats = beatsByEp[epNum] ?? [];
    const inBeats = beats.includes(name);
    const mentions = countMentions(ep.content, name);
    totalMentions += mentions;

    const hasGoal = !!state?.recent_goal?.trim();
    const active  = inBeats || mentions >= 3;

    if (!active) {
      consecutiveInactive++;
      maxConsecutiveInactive = Math.max(maxConsecutiveInactive, consecutiveInactive);
    } else {
      consecutiveInactive = 0;
    }

    const marker = !active ? (consecutiveInactive >= 3 ? "❌" : "⚠️ ") : "✅";
    console.log(`  ${marker} ep${epNum}: beats=${inBeats ? "Y" : "N"} mentions=${mentions} goal=${hasGoal ? "Y" : "N"} consecutive_inactive=${consecutiveInactive}`);
  }

  console.log(`  총 본문 언급: ${totalMentions}회 | 최장 비활성 연속: ${maxConsecutiveInactive}화`);
  if (maxConsecutiveInactive >= 3) {
    totalInactive++;
    console.log(`  ❌ ${name}: ${maxConsecutiveInactive}화 연속 비활성 — planner 인물 배정 점검 필요`);
  }
}

console.log(`\n───────────────────────────────────────────────────────`);
console.log(`3화+ 연속 비활성 인물: ${totalInactive}명`);
if (totalInactive > 0) {
  console.error(`❌ CHARACTER ACTIVITY BALANCE: FAIL (${totalInactive}명 비활성)`);
  process.exit(1);
} else {
  console.log("✅ CHARACTER ACTIVITY BALANCE: PASS");
}
