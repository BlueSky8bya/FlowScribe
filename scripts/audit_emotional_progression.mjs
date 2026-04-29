/**
 * audit_emotional_progression.mjs
 * 인물별 감정 상태 루프 및 행동 진전 감사
 * Usage: node scripts/audit_emotional_progression.mjs --book-id <uuid>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
if (!bookId) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const [stateRes, traceRes] = await Promise.all([
  pool.query(
    `SELECT character_name, episode_number, emotional_state, recent_goal, physical_state
     FROM character_dynamic_states
     WHERE book_id=$1 ORDER BY character_name, episode_number`,
    [bookId]
  ),
  pool.query(
    `SELECT DISTINCT ON (episode_number) episode_number, planner_trace
     FROM run_traces WHERE book_id=$1
     ORDER BY episode_number, created_at DESC`,
    [bookId]
  ),
]);
await pool.end();

console.log(`\n═══════════════════════════════════════════════════════`);
console.log(` AUDIT — Emotional Progression (book: ${bookId.slice(0, 8)}...)`);
console.log(`═══════════════════════════════════════════════════════\n`);

// 인물별 그룹핑
const byChar = {};
for (const r of stateRes.rows) {
  if (!byChar[r.character_name]) byChar[r.character_name] = [];
  byChar[r.character_name].push(r);
}

const traceByEp = {};
for (const r of traceRes.rows) traceByEp[r.episode_number] = r.planner_trace;

let loopCount = 0;
let progressCount = 0;

for (const [charName, states] of Object.entries(byChar)) {
  console.log(`\n[${charName}]`);
  let sameEmotionStreak = 0;
  let prevEmotion = null;

  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const emotion = s.emotional_state ?? "(없음)";
    const goal    = s.recent_goal    ?? "(없음)";

    // 감정 동일 여부 (의미적으로 유사한 경우도 포함)
    const sameAsPrev = prevEmotion && (
      emotion === prevEmotion ||
      (emotion.includes("혼란") && prevEmotion.includes("혼란")) ||
      (emotion.includes("공포") && prevEmotion.includes("공포")) ||
      (emotion.includes("불안") && prevEmotion.includes("불안")) ||
      (emotion.includes("두려") && prevEmotion.includes("두려"))
    );

    if (sameAsPrev) {
      sameEmotionStreak++;
    } else {
      sameEmotionStreak = 1;
    }

    // planner trace에서 해당 인물 state_update goal 변화 확인
    const trace = traceByEp[s.episode_number];
    const stateUpdate = trace?.parsed_plan?.character_state_updates?.find(u => u.character_name === charName);
    const tracedGoal  = stateUpdate?.recent_goal ?? null;

    const marker = sameEmotionStreak >= 3 ? "❌" : sameEmotionStreak === 2 ? "⚠️ " : "✅";
    console.log(`  ${marker} ep${s.episode_number}: 감정=${emotion.slice(0, 15)} | 목표=${goal.slice(0, 30)} | streak=${sameEmotionStreak}`);

    if (sameEmotionStreak >= 3) {
      loopCount++;
      // 행동 진전이 있는지 확인 (goal 변화 여부)
      const prevGoal = states[i - 1]?.recent_goal ?? null;
      if (tracedGoal && tracedGoal !== prevGoal) {
        progressCount++;
        console.log(`    → 목표 변화 있음 (semantic progression): ${tracedGoal.slice(0, 40)}`);
      } else {
        console.log(`    → ⚠️  목표 변화 없음 — 감정 루프 + 행동 정체`);
      }
    }

    prevEmotion = emotion;
  }
}

console.log(`\n───────────────────────────────────────────────────────`);
console.log(`same_emotion_3ep_loop: ${loopCount}건 (semantic progression: ${progressCount}건)`);
if (loopCount - progressCount > 0) {
  console.error(`❌ EMOTIONAL PROGRESSION: ${loopCount - progressCount}건 행동 진전 없는 감정 루프`);
} else if (loopCount > 0) {
  console.log(`⚠️  EMOTIONAL PROGRESSION: 감정 루프 있으나 모두 목표 변화로 보완됨`);
} else {
  console.log("✅ EMOTIONAL PROGRESSION: PASS");
}
