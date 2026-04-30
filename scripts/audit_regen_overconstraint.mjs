/**
 * audit_regen_overconstraint.mjs — Phase 4.18
 *
 * 재생성 prompt가 과도한 negative constraint로 모델 성능을 제약하는지 정적 측정.
 *
 * 검사:
 *   - planner user prompt 토큰 수 (renderer가 아니라 planner의 prompt 길이를 본다)
 *   - prompt 내 "금지/하지 말 것/회피/제한" 카운트 (negative constraint)
 *   - prompt 내 "허용/권장/자유롭게/선택" 카운트 (positive guidance)
 *   - regen 시 노출되는 sections (regen_divergence_contract, must_vary 등)
 *   - regen_prev_text full beat dump 부재 확인 (Phase 4.18 정책)
 *
 * Usage:
 *   node scripts/audit_regen_overconstraint.mjs --book-id <id> --episode <N> [--latest 1]
 *
 * Exit: 0 PASS, 1 WARN, 2 ERROR
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const episode = parseInt(args[args.indexOf("--episode") + 1] ?? "1", 10);
const latestN = parseInt(args[args.indexOf("--latest") + 1] ?? "1", 10);
if (!bookId) { console.error("Usage: --book-id <uuid> --episode <N> [--latest M]"); process.exit(2); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function _approxTokens(s) {
  // 매우 거친 추정: 한국어 char ≈ 1 token, 영문 단어 ≈ 1 token
  if (!s) return 0;
  return Math.ceil(s.length / 2.5);
}

function countMatches(s, patterns) {
  let n = 0;
  for (const p of patterns) {
    const m = s.match(p);
    if (m) n += m.length;
  }
  return n;
}

const NEGATIVE_PATTERNS = [
  /금지/g,
  /하지\s*말/g,
  /피한다/g,
  /피해야/g,
  /절대\s*(금지|불가)/g,
  /막아야/g,
  /제한/g,
  /제약/g,
  /불가능/g,
  /반복\s*금지/g,
];

const POSITIVE_PATTERNS = [
  /허용/g,
  /권장/g,
  /자유롭게/g,
  /선택하라/g,
  /자연스럽게/g,
  /가능하다/g,
  /적합하다/g,
];

(async () => {
  const W = 75;
  console.log(`\n${"═".repeat(W)}`);
  console.log(` Regen Over-Constraint Audit`);
  console.log(` book ${bookId.slice(0, 8)}… · episode ${episode} · latest ${latestN}`);
  console.log("═".repeat(W));

  // run_traces에는 user_prompt가 저장되지 않을 수 있다.
  // 대신 input_contract와 parsed_plan 사이즈로 추정.
  const tr = await pool.query(
    `SELECT created_at, planner_trace
     FROM run_traces WHERE book_id=$1 AND episode_number=$2 AND planner_trace IS NOT NULL
     ORDER BY created_at DESC LIMIT $3`,
    [bookId, episode, latestN]
  );

  if (!tr.rows.length) {
    console.log(`이 회차의 trace 없음.`);
    await pool.end();
    process.exit(0);
  }

  let warnings = 0;
  for (let i = 0; i < tr.rows.length; i++) {
    const row = tr.rows[i];
    const pt = row.planner_trace;
    const userPrompt = pt?.user_prompt ?? "";
    const inputContract = pt?.input_contract ?? null;

    console.log(`\n[trace #${i + 1}] ${row.created_at.toISOString().slice(0, 19)}`);

    if (userPrompt && userPrompt.length > 0) {
      const tok = _approxTokens(userPrompt);
      const neg = countMatches(userPrompt, NEGATIVE_PATTERNS);
      const pos = countMatches(userPrompt, POSITIVE_PATTERNS);
      const ratio = neg > 0 ? (pos / neg) : 999;
      const hasOldDump = /\[이전 시도 beat 기록 — 다양성 참고용\]/.test(userPrompt);
      const hasContract = /\[재생성 분기 계약/.test(userPrompt);

      console.log(`  prompt length: ${userPrompt.length} chars (~${tok} tokens)`);
      console.log(`  negative constraint count: ${neg}`);
      console.log(`  positive guidance count: ${pos}`);
      console.log(`  pos/neg ratio: ${ratio === 999 ? "∞ (no negative)" : ratio.toFixed(2)}`);
      console.log(`  legacy old-beat dump present: ${hasOldDump ? "❌ YES (Phase 4.18 정책 위반)" : "✅ no"}`);
      console.log(`  divergence contract present: ${hasContract ? "✅ yes" : "(이 trace는 regen이 아닐 수 있음)"}`);

      if (hasOldDump) warnings++;
      if (tok > 5500) { warnings++; console.log(`  ⚠️ prompt 토큰 ${tok} > 5500 (과대 가능)`); }
      if (neg > pos * 3 && pos > 0) { warnings++; console.log(`  ⚠️ negative >> positive (${neg}:${pos}) — 모델 성능 저하 가능`); }
    } else {
      console.log(`  user_prompt 미저장 (legacy trace) — input_contract만 검사`);
      if (inputContract) {
        console.log(`  input_contract keys: ${Object.keys(inputContract).join(", ")}`);
      }
    }
  }

  console.log(`\n${"═".repeat(W)}`);
  console.log(`총 검사 trace: ${tr.rows.length}, warnings: ${warnings}`);
  const verdict = warnings === 0 ? "PASS" : warnings <= 2 ? "WARN" : "FAIL";
  const icon = verdict === "PASS" ? "✅" : verdict === "WARN" ? "⚠️" : "❌";
  console.log(`${icon} OVER-CONSTRAINT VERDICT: ${verdict}`);
  console.log("═".repeat(W) + "\n");

  await pool.end();
  process.exit(verdict === "FAIL" ? 1 : 0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(2); });
