/**
 * audit_scene_transitions.mjs
 * 에피소드 간 급격한 장면 점프 탐지
 *
 * character_dynamic_states.location 기반으로 이전 화→현재 화 위치 변화 감지.
 * planner_trace.scene_beats.location은 부재할 수 있으므로 states를 primary source로 사용.
 *
 * Usage: node scripts/audit_scene_transitions.mjs --book-id <uuid>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
if (!bookId) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const [epRes, stateRes] = await Promise.all([
  pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
    [bookId]
  ),
  pool.query(
    `SELECT character_name, episode_number, location
     FROM character_dynamic_states WHERE book_id=$1
     ORDER BY character_name, episode_number`,
    [bookId]
  ),
]);
await pool.end();

const episodes = epRes.rows;

// character → episode → location
const locMap = {};
for (const r of stateRes.rows) {
  if (!locMap[r.character_name]) locMap[r.character_name] = {};
  locMap[r.character_name][r.episode_number] = r.location;
}

const ABSENT_MARKERS = new Set(["미등장", "알 수 없음", "불명", "비활성", "", null, undefined]);

// 같은 구역인지 (첫 토큰 일치)
function isSameZone(a, b) {
  if (!a || !b) return false;
  const zA = a.split(/[\s\-]/)[0];
  const zB = b.split(/[\s\-]/)[0];
  return zA === zB;
}

// 전환 문장 패턴 (이동/시간 경과 등)
const TRANSITION_PATTERNS = [
  /(?:발걸음|발자국|이동|향했다|갔다|도착했다|이동했다|걸어갔다|들어갔다|찾아갔다|나아갔다|옮겼다|뛰어갔다|올라갔다|내려갔다)/,
  /(?:잠시\s*후|한참\s*후|시간이\s*(?:흘러|지나)|그\s*사이에|얼마\s*후|다음\s*날|그날|밤이\s*지나|아침이)/,
  /(?:공기가|냄새가|빛이|온도가|바람이).*(?:맞았다|스쳤다|채웠다|감쌌다|불었다)/,
  /(?:문을|복도를|계단을|통로를|출입구를|비상구를)\s*(?:열고|지나|내려|올라|따라|통과)/,
  /(?:끌려|데려|따라|안내받|이동하)/,
  /(?:장소를|위치를|공간을).*(?:이동|이탈|탈출|떠나)/,
  /(?:이\s*곳|여기서|여기를)\s*(?:떠나|벗어|탈출)/,
];

const W = 65;
console.log(`\n${"═".repeat(W)}`);
console.log(` AUDIT — Scene Transitions (book: ${bookId.slice(0, 8)}...)`);
console.log("═".repeat(W));

let fatalCount = 0;
let warnCount = 0;

for (let i = 1; i < episodes.length; i++) {
  const prev = episodes[i - 1];
  const curr = episodes[i];
  const prevEp = prev.episode_number;
  const currEp = curr.episode_number;
  const currHead = curr.content.slice(0, 400);

  const hasTransition = TRANSITION_PATTERNS.some(re => re.test(curr.content));

  // Collect all characters that have a real location change prev→curr
  const jumpChars = [];
  for (const [charName, epLocs] of Object.entries(locMap)) {
    const prevLoc = epLocs[prevEp];
    const currLoc = epLocs[currEp];
    if (ABSENT_MARKERS.has(prevLoc) || ABSENT_MARKERS.has(currLoc)) continue;
    if (prevLoc === currLoc) continue;
    if (isSameZone(prevLoc, currLoc)) continue;
    jumpChars.push({ charName, prevLoc, currLoc });
  }

  if (jumpChars.length === 0) {
    console.log(`\n✅ ep${prevEp}→ep${currEp}: 전환 OK (위치 변화 없음 또는 동일 구역)`);
    continue;
  }

  if (hasTransition) {
    console.log(`\n✅ ep${prevEp}→ep${currEp}: 전환 OK (위치 변화 + 이동 문장 있음)`);
    for (const { charName, prevLoc, currLoc } of jumpChars) {
      console.log(`   ${charName}: ${prevLoc} → ${currLoc}`);
    }
    continue;
  }

  // No transition phrase despite location change
  const severity = jumpChars.length >= 2 ? "FAIL" : "WARN";
  if (severity === "FAIL") fatalCount++;
  else warnCount++;

  const icon = severity === "FAIL" ? "❌" : "⚠️ ";
  console.log(`\n${icon} ep${prevEp}→ep${currEp}: 위치 점프 감지 (이동 문장 없음) [${severity}]`);
  for (const { charName, prevLoc, currLoc } of jumpChars) {
    console.log(`   ${charName}: ${prevLoc} → ${currLoc}`);
  }
  console.log(`   curr head (100): ${currHead.slice(0, 100).replace(/\n/g, " ")}`);
}

console.log(`\n${"─".repeat(W)}`);
console.log(`location_jump_fatal: ${fatalCount}건 | warn: ${warnCount}건`);
if (fatalCount > 0) {
  console.error("❌ SCENE TRANSITIONS: FAIL");
  process.exit(1);
} else if (warnCount > 0) {
  console.log("⚠️  SCENE TRANSITIONS: WARN");
} else {
  console.log("✅ SCENE TRANSITIONS: PASS");
}
console.log("═".repeat(W) + "\n");
