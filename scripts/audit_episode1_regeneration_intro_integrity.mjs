/**
 * audit_episode1_regeneration_intro_integrity.mjs — Phase 4.17 1화 재생성 도입 무결성 감사
 *
 * 같은 책의 ep1을 여러 번 생성/재생성한 결과를 비교한다.
 * 본 스크립트는 책의 현재 ep1 본문을 읽고, 추가로 run_traces에 남은 이전 시도들의
 * 본문을 비교 가능하면 함께 분석한다. 단, run_traces에 본문은 안 남으므로 현재 ep1만 검사.
 *
 * 검사:
 *   - intro_coherence: 작품의 첫 장면처럼 읽히는가
 *   - no_prior_episode_dependency: 이전 회차 의존이 없는가
 *   - world_entry_clarity: 세계/갈등이 자연스럽게 처음 제시되는가
 *   - relationship_initial_distance: 인물 관계가 초기 상태로 표현되는가
 *
 * Usage: node scripts/audit_episode1_regeneration_intro_integrity.mjs --book-id <uuid>
 */
import { createRequire } from "module";
import https from "https";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
if (!bookId) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!GEMINI_KEY) { console.error("GEMINI_API_KEY 미설정"); process.exit(1); }

const MODEL = "gemini-2.5-flash";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function callGemini(prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 6000, temperature: 0.1 },
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(body); req.end();
  });
}

function repairTruncated(s) {
  const stack = []; let inStr = false, escape = false;
  let lastColon = -1, lastValueStart = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { if (!inStr) lastValueStart = i; inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === ":") { lastColon = i; lastValueStart = -1; }
    else if (c === "{") { stack.push("}"); lastValueStart = i; }
    else if (c === "[") { stack.push("]"); lastValueStart = i; }
    else if (c === "}" || c === "]") { stack.pop(); lastValueStart = i; }
    else if (c !== " " && c !== "\n" && c !== "\t" && c !== ",") { lastValueStart = i; }
  }
  let prefix = "", suffix = "";
  if (inStr) suffix += '"';
  else if (lastColon > lastValueStart) prefix = "null";
  suffix += stack.reverse().join("");
  return s + prefix + suffix;
}

function parseJSON(raw) {
  let clean;
  try {
    const env = JSON.parse(raw);
    const text = env.candidates?.[0]?.content?.parts?.find(p => !p.thought && p.text)?.text ?? "";
    clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  } catch (e) {
    return { _parse_error: `envelope: ${e.message}` };
  }
  try { return JSON.parse(clean); } catch {}
  try { return JSON.parse(repairTruncated(clean)); } catch (e2) {
    return { _parse_error: `repair: ${e2.message}` };
  }
}

async function main() {
  const epRes = await pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 AND episode_number=1`,
    [bookId]
  );
  if (!epRes.rows.length) { console.log("ep1 없음"); process.exit(0); }
  const ep1Body = epRes.rows[0].content;

  const charRes = await pool.query(
    `SELECT name, type, gender, personality FROM canonical_characters WHERE book_id=$1`,
    [bookId]
  );
  const chars = charRes.rows;
  await pool.end();

  const W = 75;
  console.log(`\n${"═".repeat(W)}`);
  console.log(` AUDIT — Episode 1 Intro Integrity (book ${bookId.slice(0, 8)}...)`);
  console.log("═".repeat(W));
  console.log(`ep1 길이: ${ep1Body.length}자`);
  console.log(`canonical 인물: ${chars.length}명 (${chars.map(c => c.name).join(", ")})`);

  const prompt = [
    "당신은 한국어 소설의 첫 화 도입부 무결성 감사관이다.",
    "이 본문이 작품의 '첫 화 (도입부)'로서 읽기에 자연스러운지 판정하라.",
    "",
    "검사 항목 — 각각 PASS/WARN/FAIL로 평가:",
    "1. intro_coherence: 작품의 첫 장면처럼 읽히는가 (회상이나 후속이 아닌)",
    "2. no_prior_episode_dependency: 독자가 모르는 과거 사건을 이미 일어난 일처럼 단정하지 않는가",
    "3. world_entry_clarity: 세계관/상황/핵심 갈등이 처음 제시되는가",
    "4. character_first_position: 주요 인물의 첫 위치/상태가 납득 가능한가",
    "5. relationship_initial_distance: 인물 관계가 초기 상태로 보이는가 (오래된 친구처럼 막역하지 않음)",
    "",
    "주의:",
    "- 회상/꿈 형태로 과거를 보여주는 것은 OK",
    "- 인물이 '이번에 처음으로' 만나는 장면이어야 의미 있는 인물의 경우는 PASS",
    "- 이미 친한 동료/가족 등 설정상 이미 알고 있는 관계는 OK (canonical에 있는 인물 관계는 일반적으로 OK)",
    "",
    `[canonical 인물]`,
    chars.map(c => `- ${c.name} (${c.type ?? "?"}, ${c.gender ?? "?"}): ${(c.personality ?? "").slice(0, 60)}`).join("\n"),
    "",
    "[ep1 본문]",
    ep1Body.slice(0, 4500),
    "",
    "출력 (JSON만):",
    `{"checks":{"intro_coherence":"PASS|WARN|FAIL","no_prior_episode_dependency":"PASS|WARN|FAIL","world_entry_clarity":"PASS|WARN|FAIL","character_first_position":"PASS|WARN|FAIL","relationship_initial_distance":"PASS|WARN|FAIL"},"issues":[{"check":"...","severity":"fatal|major|minor","detail":"..."}],"verdict":"PASS|CONDITIONAL|FAIL"}`,
  ].join("\n");

  process.stdout.write("Gemini intro integrity judge... ");
  const r = await callGemini(prompt);
  if (r.status !== 200) {
    console.log(`HTTP ${r.status}`);
    process.exit(2);
  }
  const parsed = parseJSON(r.body);
  if (parsed._parse_error) {
    console.log(`parse_err: ${parsed._parse_error.slice(0, 80)}`);
    process.exit(2);
  }

  console.log("\n");
  console.log("Checks:");
  for (const [k, v] of Object.entries(parsed.checks ?? {})) {
    const icon = v === "PASS" ? "✅" : v === "WARN" ? "⚠️" : "❌";
    console.log(`  ${icon} ${k}: ${v}`);
  }
  if (parsed.issues?.length) {
    console.log("\nIssues:");
    for (const i of parsed.issues) {
      const icon = i.severity === "fatal" ? "🔴" : i.severity === "major" ? "🟡" : "·";
      console.log(`  ${icon} [${i.check}] ${(i.detail ?? "").slice(0, 100)}`);
    }
  }
  console.log(`\n${"─".repeat(W)}`);
  const verdict = parsed.verdict ?? "UNKNOWN";
  const icon = verdict === "PASS" ? "✅" : verdict === "CONDITIONAL" ? "⚠️" : "❌";
  console.log(`${icon} INTRO INTEGRITY VERDICT: ${verdict}`);
  console.log(`${"═".repeat(W)}\n`);

  process.exit(verdict === "FAIL" ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
