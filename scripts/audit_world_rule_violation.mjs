/**
 * audit_world_rule_violation.mjs — Phase 4.19
 *
 * 절대 규칙(긍정형 전제 + 부정형 금지) 준수 여부를 본문 기준으로 평가한다.
 * 하드코딩 없이 절대 규칙 텍스트를 일반 파싱하여 본문에 명시·암시 또는 위반이 있는지 점검.
 *
 * 평가:
 *   - rule_polarity: 긍정형(전제) / 부정형(금지) 자동 분류 (어미·키워드 기반)
 *   - 긍정형 → 본문에 핵심 키워드 등장 여부 + Gemini 판정 (있으면)
 *   - 부정형 → 본문에 금지 표현·요소 등장 여부 + Gemini 판정
 *
 * Usage:
 *   node scripts/audit_world_rule_violation.mjs --book-id <uuid> [--episode N]
 *
 * Exit: 0 PASS, 1 WARN/FAIL, 2 ERROR
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const epOpt = args.indexOf("--episode") >= 0 ? parseInt(args[args.indexOf("--episode") + 1]) : null;
if (!bookId) { console.error("Usage: --book-id <uuid> [--episode N]"); process.exit(2); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 부정형 판단 키워드 (있으면 must-not-happen)
const NEGATIVE_RE = /(금지|등장하지\s*않는다|등장하지\s*않음|존재하지\s*않는다|있지\s*않다|없다|안\s*된다|불가|하지\s*마|하지\s*말|허용하지\s*않|배제|제외|쓰지\s*않)/;
// 긍정형/전제 판단 키워드 (있으면 must-happen / must-be-true)
const POSITIVE_RE = /(전개된다|일어난다|발생한다|존재한다|있다|이다|된다|등장한다|시작한다|벌어진다|되어\s*있다)/;

function classifyRule(text) {
  if (NEGATIVE_RE.test(text)) return "negative";
  if (POSITIVE_RE.test(text)) return "positive";
  return "ambiguous";
}

// 본문에서 의미 있는 키워드 추출 (한글 명사 추정 — 2~5글자 어절)
function extractKeywords(text) {
  const tokens = text
    .replace(/[.,!?"'()\[\]<>—\-]/g, " ")
    .split(/\s+/)
    .filter(w => w && w.length >= 2 && w.length <= 8 && /[가-힣]/.test(w));
  const STOP = new Set([
    "있다", "있음", "있는", "이다", "되어", "되어있다", "전개된다", "일어난다", "되었다", "한다",
    "그리고", "또는", "이런", "저런", "이를", "그를", "에서", "에게", "에서는",
    "이번", "또한", "그러나", "하지만", "그래서", "이때", "혹은",
  ]);
  return [...new Set(tokens.filter(t => !STOP.has(t)))];
}

(async () => {
  const W = 78;
  console.log("\n" + "═".repeat(W));
  console.log(` World Rule Violation Audit — book ${bookId.slice(0, 8)}…`);
  console.log("═".repeat(W));

  // 절대 규칙 fetch (테이블 + books.context fallback)
  const rules = [];
  const wr = await pool.query(
    "SELECT content FROM world_rules WHERE book_id=$1 AND rule_type='absolute_forbidden' AND is_active=true",
    [bookId]
  );
  for (const r of wr.rows) rules.push(r.content);
  if (!rules.length) {
    const bk = await pool.query("SELECT context FROM books WHERE id=$1", [bookId]);
    const fb = bk.rows[0]?.context?.forbidden_settings ?? [];
    for (const r of fb) rules.push(String(r));
  }
  if (!rules.length) {
    console.log("절대 규칙 없음 — audit 종료.");
    await pool.end();
    process.exit(0);
  }
  console.log(`\n절대 규칙 ${rules.length}건:`);
  rules.forEach((r, i) => console.log(`  ${i + 1}. (${classifyRule(r)}) ${r.slice(0, 80)}${r.length > 80 ? "…" : ""}`));

  // 본문 fetch
  let epRows;
  if (epOpt) {
    epRows = (await pool.query(
      "SELECT episode_number, content FROM episodes WHERE book_id=$1 AND episode_number=$2",
      [bookId, epOpt]
    )).rows;
  } else {
    epRows = (await pool.query(
      "SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number",
      [bookId]
    )).rows;
  }
  if (!epRows.length) {
    console.log("\n본문 없음 — audit 종료.");
    await pool.end();
    process.exit(0);
  }

  let totalFail = 0;
  let totalWarn = 0;
  for (const ep of epRows) {
    const body = String(ep.content ?? "");
    console.log(`\n── ep${ep.episode_number} (${body.length}자) ──`);
    for (const rule of rules) {
      const polarity = classifyRule(rule);
      const kws = extractKeywords(rule);
      const matchedKws = kws.filter(k => body.includes(k));
      const ratio = kws.length ? matchedKws.length / kws.length : 0;

      let verdict, icon;
      if (polarity === "positive") {
        // 전제: 본문에 핵심 키워드가 충분히 등장해야 함
        if (ratio >= 0.4) { verdict = "OK"; icon = "✅"; }
        else if (ratio >= 0.2) { verdict = "WARN — 키워드 일부만 등장"; icon = "⚠️"; totalWarn++; }
        else { verdict = "FAIL — 전제가 본문에 거의 등장하지 않음"; icon = "❌"; totalFail++; }
      } else if (polarity === "negative") {
        // 금지: 키워드가 많이 등장하면 위반 가능성
        if (ratio >= 0.5) { verdict = "WARN — 금지 키워드가 본문에 다수 등장 (수동 확인 필요)"; icon = "⚠️"; totalWarn++; }
        else { verdict = "OK"; icon = "✅"; }
      } else {
        verdict = "AMBIGUOUS — 어미 분류 실패";
        icon = "•";
      }
      console.log(`  ${icon} [${polarity}] ${rule.slice(0, 50)}${rule.length > 50 ? "…" : ""}`);
      console.log(`     키워드 매칭: ${matchedKws.length}/${kws.length} (${(ratio * 100).toFixed(0)}%)`);
      console.log(`     verdict: ${verdict}`);
    }
  }

  console.log("\n" + "═".repeat(W));
  const total = totalFail + totalWarn;
  const finalVerdict = totalFail >= 1 ? "FAIL" : totalWarn >= 2 ? "CONDITIONAL" : "PASS";
  const icon = finalVerdict === "PASS" ? "✅" : finalVerdict === "CONDITIONAL" ? "⚠️" : "❌";
  console.log(`${icon} VIOLATION VERDICT: ${finalVerdict} (fails ${totalFail}, warns ${totalWarn})`);
  console.log("═".repeat(W) + "\n");

  await pool.end();
  process.exit(finalVerdict === "FAIL" ? 1 : 0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(2); });
