/**
 * gemini_reader_immersion_audit.mjs — Gemini 기반 Reader Immersion Judge
 *
 * 결정론적 감사로 잡기 어려운 서사 개연성/관계/감정/지식 누출을 Gemini로 판단.
 * story quality 중심이 아니라 독자 몰입 파괴 가능성 중심.
 *
 * Usage: node scripts/gemini_reader_immersion_audit.mjs --book-id <book_id>
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");
import https from "https";

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
if (!bookId) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.error("GEMINI_API_KEY 미설정"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Data fetch ───────────────────────────────────────────────
const [epRes, stateRes, canonRes, bookRes] = await Promise.all([
  pool.query(
    `SELECT episode_number, content, summary FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
    [bookId]
  ),
  pool.query(
    `SELECT DISTINCT ON (character_name) character_name, episode_number,
            location, physical_state, items, emotional_state, recent_goal
     FROM character_dynamic_states WHERE book_id=$1
     ORDER BY character_name, episode_number DESC`,
    [bookId]
  ),
  pool.query(
    `SELECT name, personality, type, gender, initial_items FROM canonical_characters WHERE book_id=$1`,
    [bookId]
  ),
  pool.query(
    `SELECT title, context FROM books WHERE id=$1`,
    [bookId]
  ),
]);
await pool.end();

// ── Build audit packet ───────────────────────────────────────
const bookTitle = bookRes.rows[0]?.title ?? bookId;
const ctx = bookRes.rows[0]?.context ?? {};
const genre = ctx.genre ?? "알 수 없음";
const worldRules = (ctx.rules ?? []).map(r => r.content ?? r).join("\n");

const charList = canonRes.rows.map(c => {
  const items = Array.isArray(c.initial_items) ? c.initial_items.map(i => (typeof i === "string" ? i : i?.name)).join(", ") : "";
  return `- ${c.name}(${c.gender}, ${c.type}): ${c.personality}${items ? ` | 초기소지품: ${items}` : ""}`;
}).join("\n");

// 화별 요약 (max 10화, 최근 상태 포함)
const episodes = epRes.rows;
const MAX_EP_CHARS = 120;
const epSummaries = episodes.map(ep => {
  const text = (ep.summary ?? ep.content ?? "").slice(0, MAX_EP_CHARS);
  const charStates = stateRes.rows
    .filter(s => s.episode_number === ep.episode_number)
    .map(s => `${s.character_name}(위치:${s.location ?? "?"},감정:${s.emotional_state ?? "?"},상태:${s.physical_state ?? "정상"})`)
    .join(" | ");
  return `ep${ep.episode_number}: ${text}${charStates ? `\n  [인물상태] ${charStates}` : ""}`;
}).join("\n\n");

const prompt = `당신은 한국어 소설의 독자 몰입 전문 감사자다.
아래는 작품 정보와 화별 요약이다.

[작품 정보]
제목: ${bookTitle}
장르: ${genre}
세계관 규칙: ${worldRules || "(없음)"}
등장인물:
${charList}

[화별 요약 (최대 ${MAX_EP_CHARS}자/화)]
${epSummaries}

──────────────────────────────────────────────
[Reader Immersion Judge 10개 항목 평가]

각 항목을 1~2문장으로 평가하고, 마지막에 판정(PASS / WARN / FAIL)을 붙여라.
판정 기준: 독자가 "말이 안 된다"고 느낄 가능성 기준. 형식 규칙이 아니라 몰입 파괴 가능성을 우선한다.

1. 독자가 "말이 안 된다"고 느낄 논리 오류가 있는가? (인과관계, 인물 행동 동기)
2. 인물의 감정 반응이 현재 장면 상황에 개연성 있게 맞는가?
3. 처음 만난 인물 사이에서 관계 누적 없이 지나치게 친밀하거나 신뢰하지 않는가?
4. 낯선 공간/위협/죽음 목격 직후에 인물이 부자연스럽게 태연하거나 침착하지 않는가?
5. 인물이 작중에서 아직 알 수 없는 정보를 알고 행동하는 지식 누출이 있는가?
6. 소지품/위치/신체 상태가 직전 화 및 문맥과 일관되는가?
7. 사망/부상/기절/무력화 상태가 이후 인물 행동과 충돌하지 않는가?
8. 호칭/말투/관계 거리감이 사건·대화·선택·희생 같은 변화 계기 없이 급변하지 않는가?
9. 장면 전환이 독자가 맥락을 잃지 않고 따라갈 수 있게 연결되는가?
10. 특수 토큰, 외국어 조각, 갑작스러운 톤 붕괴, 의미 없는 반복 같은 LLM artifact가 있는가?

[주의 사항]
- POV 형식 규칙보다 독자의 이해 가능성과 상태 일관성을 우선한다.
- 장르명 기반 판단 금지 — 현재 작품 내 규칙과 인물 상태를 기준으로 판단하라.
- "3인칭인데 내면묘사 한 줄"보다 "상황상 불가능한 행동/관계/지식/감정"을 더 엄격히 평가하라.

[출력 형식]
1. [항목 내용] — PASS/WARN/FAIL
2. ...
(10항목까지)

fatal_issues: [치명 몰입 파괴 목록, 없으면 "없음"]
soft_issues: [주의 수준 문제 목록, 없으면 "없음"]
likely_root_cause: [가장 빈번한 원인 유형]
suggested_fix_category: [state / prompt / postprocess / memory / ledger 중 우선 수정 영역]
whether_30ep_allowed: YES / NO / CONDITIONAL
immersion_verdict: PASS / CONDITIONAL PASS / WARN / FAIL`;

// ── Gemini REST call ─────────────────────────────────────────
function geminiRequest(prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 4000, temperature: 0.2 },
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    };
    const req = https.request(options, res => {
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Run ──────────────────────────────────────────────────────
const W = 65;
console.log(`\n${"═".repeat(W)}`);
console.log(` Gemini Reader Immersion Judge`);
console.log(` book_id: ${bookId}  |  ep 수: ${episodes.length}`);
console.log("═".repeat(W));
console.log(" Gemini 호출 중...\n");

const { status, body: rawBody } = await geminiRequest(prompt);
const j = JSON.parse(rawBody);
const text = j.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify(j.error ?? "NO_RESPONSE");

if (status !== 200) {
  console.error(`HTTP ${status}\n${text}`);
  process.exit(1);
}

console.log(text);
console.log("\n" + "═".repeat(W) + "\n");
