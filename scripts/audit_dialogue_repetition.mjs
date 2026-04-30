/**
 * audit_dialogue_repetition.mjs — 반복 대사/구문 루프 감지
 *
 * 같은 대사 구문이 여러 에피소드에서 의미 없이 반복되는 LLM 루프를 감지.
 * 의도된 후렴/주문/복선 반복은 context로 허용 여부를 판단.
 *
 * Usage: node scripts/audit_dialogue_repetition.mjs --book-id <uuid>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
if (!bookId) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const epRes = await pool.query(
  `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
  [bookId]
);
await pool.end();

const episodes = epRes.rows;

// ── 대사 구문 추출 ───────────────────────────────────────────
// "..." 또는 '...' 안의 내용 추출
function extractDialogue(content) {
  const results = [];
  const patterns = [
    /[""][^""]{4,60}[""]/g,   // "..." 형태
    /[''][^'']{4,60}['']/g,   // '...' 형태
    /"[^"]{4,60}"/g,          // ASCII "..."
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      const inner = m[0].slice(1, -1).trim();
      if (inner.length >= 4) results.push(inner);
    }
  }
  return results;
}

// n-gram 추출 (문자 단위, min_len 이상)
function extractNgrams(text, minLen = 6, maxLen = 20) {
  const ngrams = new Set();
  for (let len = minLen; len <= Math.min(maxLen, text.length); len++) {
    for (let i = 0; i <= text.length - len; i++) {
      ngrams.add(text.slice(i, i + len));
    }
  }
  return ngrams;
}

// ── 에피소드별 대사 및 구문 수집 ────────────────────────────
// phrase → { episodes: Set, occurrences: [{ep, snippet}] }
const phraseMap = new Map();

for (const ep of episodes) {
  const dialogues = extractDialogue(ep.content);
  for (const d of dialogues) {
    const key = d.replace(/\s+/g, " ").trim();
    if (key.length < 4) continue;
    if (!phraseMap.has(key)) phraseMap.set(key, { episodes: new Set(), occurrences: [] });
    const entry = phraseMap.get(key);
    if (!entry.episodes.has(ep.episode_number)) {
      entry.episodes.add(ep.episode_number);
      entry.occurrences.push({ ep: ep.episode_number, snippet: key.slice(0, 50) });
    }
  }
}

// ── 반복 구문 분류 ───────────────────────────────────────────
const W = 65;
console.log(`\n${"═".repeat(W)}`);
console.log(` AUDIT — Dialogue Repetition (book: ${bookId.slice(0, 8)}...)`);
console.log("═".repeat(W));

// 의도된 반복 허용 패턴 (주문, 복선, 신원 등)
// 이런 패턴이 포함된 구문은 WARN으로만 처리
const INTENTIONAL_PATTERNS = [
  /[0-9]{3,}/,        // 숫자 코드
  /비밀번호|암호|주문/,
  /제[0-9]/,
  /기억|잊지\s*마/,
];

function isLikelyIntentional(phrase) {
  return INTENTIONAL_PATTERNS.some(re => re.test(phrase));
}

let fatalCount = 0;
let warnCount = 0;
const issues = [];

for (const [phrase, data] of phraseMap.entries()) {
  if (data.episodes.size < 2) continue; // 단일 에피소드 반복은 무시

  const epList = [...data.episodes].sort((a, b) => a - b);
  const severity = data.episodes.size >= 3 ? "fatal"
    : isLikelyIntentional(phrase) ? "minor"
    : "major";

  if (severity === "fatal") fatalCount++;
  else if (severity === "major") warnCount++;

  issues.push({ phrase, epList, severity, count: data.episodes.size });
}

// 결과 출력 (fatal/major만)
const displayed = issues.filter(i => i.severity === "fatal" || i.severity === "major")
  .sort((a, b) => b.count - a.count);

if (displayed.length === 0) {
  console.log("\n반복 대사 감지 없음");
} else {
  for (const iss of displayed) {
    const icon = iss.severity === "fatal" ? "🔴" : "🟡";
    console.log(`\n${icon} [${iss.severity}] "${iss.phrase.slice(0, 40)}" — ${iss.count}개 화에서 반복`);
    console.log(`   ep: ${iss.epList.join(", ")}`);
  }
}

console.log(`\n${"─".repeat(W)}`);
console.log(`repeated_dialogue_fatal: ${fatalCount}건 | major: ${warnCount}건`);

if (fatalCount > 0) {
  console.error("❌ DIALOGUE REPETITION: FAIL");
  process.exit(1);
} else if (warnCount > 0) {
  console.log("⚠️  DIALOGUE REPETITION: WARN");
} else {
  console.log("✅ DIALOGUE REPETITION: PASS");
}
console.log("═".repeat(W) + "\n");
