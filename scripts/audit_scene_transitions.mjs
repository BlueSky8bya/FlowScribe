/**
 * audit_scene_transitions.mjs
 * 에피소드 간 급격한 장면 점프 탐지
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

const [epRes, traceRes] = await Promise.all([
  pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
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

const episodes = epRes.rows;
const traceMap = {};
for (const r of traceRes.rows) traceMap[r.episode_number] = r.planner_trace;

console.log(`\n═══════════════════════════════════════════════════════`);
console.log(` AUDIT — Scene Transitions (book: ${bookId.slice(0, 8)}...)`);
console.log(`═══════════════════════════════════════════════════════\n`);

// 장면 점프 탐지 패턴
const ABRUPT_PATTERNS = [
  { re: /^(?:그\s*순간|갑자기|어느새|그때|그\s*사이)/, label: "갑작스러운 시작 부사" },
  { re: /^[가-힣]{2,5}(?:는|은|이|가)\s+(?:[가-힣\s]+에서|[가-힣\s]+으로)/, label: "장소 이동 설명 없는 인물 등장" },
];

const TRANSITION_PATTERNS = [
  /(?:[가-힣]+을|[가-힣]+를)\s+(?:지나|넘어|거쳐)\s+(?:[가-힣]+에|[가-힣]+으로)/,
  /(?:발걸음|발자국|이동|향했다|갔다|도착했다)/,
  /(?:잠시\s*후|한참\s*후|시간이\s*(?:흘러|지나))/,
];

let issues = 0;
let warnings = 0;

for (let i = 1; i < episodes.length; i++) {
  const prev = episodes[i - 1];
  const curr = episodes[i];
  const epNum = curr.episode_number;

  const prevTail = prev.content.slice(-200);
  const currHead = curr.content.slice(0, 300);
  const currFirstLine = currHead.split(/\n/)[0]?.trim() ?? "";

  // 직전 화 끝 위치 추출 (planner trace의 마지막 beat location)
  const prevTrace = traceMap[prev.episode_number];
  const currTrace = traceMap[epNum];
  const prevEndLoc = prevTrace?.parsed_plan?.scene_beats?.slice(-1)[0]?.location ?? null;
  const currStartLoc = currTrace?.parsed_plan?.scene_beats?.[0]?.location ?? null;

  const locChange = prevEndLoc && currStartLoc && prevEndLoc !== currStartLoc;
  const hasTransition = TRANSITION_PATTERNS.some(re => re.test(currHead));
  const abruptPattern = ABRUPT_PATTERNS.find(p => p.re.test(currFirstLine));

  if (locChange && !hasTransition) {
    issues++;
    console.log(`❌ ep${prev.episode_number}→ep${epNum}: 장소 변화 (${prevEndLoc} → ${currStartLoc}) + 전환 문장 없음`);
    console.log(`   prev tail: ...${prevTail.slice(-80)}`);
    console.log(`   curr head: ${currFirstLine.slice(0, 80)}`);
  } else if (abruptPattern && locChange) {
    warnings++;
    console.log(`⚠️  ep${prev.episode_number}→ep${epNum}: 장소 변화 + "${abruptPattern.label}" 패턴`);
    console.log(`   curr head: ${currFirstLine.slice(0, 80)}`);
  } else {
    console.log(`✅ ep${prev.episode_number}→ep${epNum}: 전환 OK${locChange ? ` (${prevEndLoc} → ${currStartLoc}, 전환 문장 있음)` : " (동일 장소)"}`);
  }
}

console.log(`\n───────────────────────────────────────────────────────`);
console.log(`abrupt_scene_jump: ${issues}건 (FAIL), ${warnings}건 (WARN)`);
if (issues > 0) console.error("❌ SCENE TRANSITIONS: FAIL");
else if (warnings > 0) console.log("⚠️  SCENE TRANSITIONS: WARN");
else console.log("✅ SCENE TRANSITIONS: PASS");
