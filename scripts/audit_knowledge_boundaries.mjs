/**
 * audit_knowledge_boundaries.mjs — 인물 지식 경계 감사
 *
 * 인물이 알 수 없는 정보를 알고 행동/발화하는지 검사 (knowledge leak).
 * Gemini judge를 사용한다 (deterministic은 불가).
 *
 * 입력: 각 화 본문 + 이전 화까지의 누적 사실(요약 또는 dynamic state)
 * 출력: 화별 fatal/major/minor knowledge leak 후보
 *
 * Usage: node scripts/audit_knowledge_boundaries.mjs --book-id <uuid>
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
if (!GEMINI_KEY) { console.error("GEMINI_API_KEY 미설정"); process.exit(1); }

const MODEL = "gemini-2.5-flash";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function geminiRequest(promptText, maxTokens = 4096) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 },
  });
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(body); req.end();
  });
}

function parseJSON(raw) {
  try {
    const env = JSON.parse(raw);
    const text = env.candidates?.[0]?.content?.parts?.find(p => !p.thought && p.text)?.text ?? "";
    let clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    return { _parse_error: e.message };
  }
}

async function main() {
  const epRes = await pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
    [bookId]
  );
  const stRes = await pool.query(
    `SELECT episode_number, character_name, location, items, recent_goal, emotional_state, visibility_state
     FROM character_dynamic_states WHERE book_id=$1 ORDER BY episode_number, character_name`,
    [bookId]
  );
  await pool.end();

  const episodes = epRes.rows;
  if (episodes.length < 2) {
    console.log("knowledge boundary audit은 2화 이상 필요");
    process.exit(0);
  }

  // 화별 인물 상태 인덱스
  const stateByEp = {};
  for (const r of stRes.rows) {
    if (!stateByEp[r.episode_number]) stateByEp[r.episode_number] = [];
    stateByEp[r.episode_number].push(r);
  }

  const W = 70;
  console.log(`\n${"═".repeat(W)}`);
  console.log(` AUDIT — Knowledge Boundaries (book: ${bookId.slice(0, 8)}...)`);
  console.log("═".repeat(W));

  const allIssues = [];

  // 한 화씩 검사 — 누적 컨텍스트는 이전 화 본문 요약(앞 1500자)
  for (let i = 1; i < episodes.length; i++) { // ep1은 baseline이므로 skip
    const currEp = episodes[i];
    const prevEpsBriefs = episodes.slice(0, i).map(e =>
      `ep${e.episode_number}: ${e.content.slice(0, 600).replace(/\n+/g, " ")}`
    ).join("\n\n");

    const currStates = stateByEp[currEp.episode_number] ?? [];
    const stateBrief = currStates.map(s => {
      const items = Array.isArray(s.items) ? s.items :
        (typeof s.items === "string" ? JSON.parse(s.items || "[]") : []);
      const itemNames = items.map(it => typeof it === "string" ? it : it?.name).filter(Boolean).join(",");
      return `${s.character_name}(loc=${s.location ?? "?"}, items=[${itemNames}], goal=${s.recent_goal ?? "?"})`;
    }).join("; ");

    const prompt = [
      "당신은 서사 일관성 감사관이다. 인물이 자신이 알 수 없는 정보를 알고 행동하거나 말하는 'knowledge leak'을 찾아라.",
      "",
      "판정 기준:",
      "1. 인물 X가 ep_N에서 사실 F에 기반해 행동/발화하는데, F가 ep_1..N-1 동안 X에게 노출된 적이 없으면 fatal.",
      "2. 누가/언제/어디서 알게 됐는지 추적 가능해야 한다.",
      "3. 추측·의심·질문 형태는 leak 아님 (단정적 발화·행동만 leak).",
      "4. 모든 인물이 공통적으로 알고 있는 세계관 상식은 leak 아님.",
      "",
      `[이전 화 요약 — ep1~ep${currEp.episode_number - 1}]`,
      prevEpsBriefs.slice(0, 8000),
      "",
      `[검사 대상 — ep${currEp.episode_number}]`,
      `현재 인물 상태: ${stateBrief}`,
      "",
      `본문:`,
      currEp.content.slice(0, 4000),
      "",
      "출력 형식 (JSON만, 다른 텍스트 금지):",
      `{"issues": [{"character": "이름", "severity": "fatal|major|minor", "claimed_fact": "인물이 알고 있다고 가정된 사실", "evidence_in_body": "본문 인용(50자 이내)", "why_leak": "왜 누설인가"}]}`,
      "leak 후보가 없으면 issues는 빈 배열.",
    ].join("\n");

    process.stdout.write(`  ep${currEp.episode_number} 검사 중... `);
    const { status, body } = await geminiRequest(prompt, 4096);
    if (status !== 200) {
      console.log(`API ${status}, skip`);
      continue;
    }
    const parsed = parseJSON(body);
    if (parsed._parse_error) {
      console.log(`parse_error: ${parsed._parse_error.slice(0, 50)}`);
      continue;
    }
    const issues = parsed.issues ?? [];
    const fatalN = issues.filter(i => i.severity === "fatal").length;
    const majorN = issues.filter(i => i.severity === "major").length;
    console.log(`fatal=${fatalN} major=${majorN} minor=${issues.length - fatalN - majorN}`);

    for (const iss of issues) {
      allIssues.push({ episode: currEp.episode_number, ...iss });
    }
  }

  // ── 결과 출력 ──
  const fatalIssues = allIssues.filter(i => i.severity === "fatal");
  const majorIssues = allIssues.filter(i => i.severity === "major");
  const minorIssues = allIssues.filter(i => i.severity === "minor");

  if (fatalIssues.length) {
    console.log(`\n🔴 FATAL knowledge leaks (${fatalIssues.length}):`);
    for (const i of fatalIssues) {
      console.log(`  ep${i.episode} [${i.character}] ${(i.why_leak ?? "").slice(0, 80)}`);
      console.log(`    fact: ${(i.claimed_fact ?? "").slice(0, 80)}`);
      if (i.evidence_in_body) console.log(`    evidence: "${i.evidence_in_body.slice(0, 60)}"`);
    }
  }
  if (majorIssues.length) {
    console.log(`\n🟡 MAJOR (${majorIssues.length}):`);
    for (const i of majorIssues.slice(0, 10)) {
      console.log(`  ep${i.episode} [${i.character}] ${(i.why_leak ?? "").slice(0, 80)}`);
    }
  }

  console.log(`\n${"─".repeat(W)}`);
  console.log(`knowledge_leak_fatal: ${fatalIssues.length}건 | major: ${majorIssues.length}건 | minor: ${minorIssues.length}건`);

  if (fatalIssues.length > 0) {
    console.error("❌ KNOWLEDGE BOUNDARIES: FAIL");
    process.exit(1);
  } else if (majorIssues.length > 2) {
    console.log("⚠️  KNOWLEDGE BOUNDARIES: WARN");
  } else {
    console.log("✅ KNOWLEDGE BOUNDARIES: PASS");
  }
  console.log("═".repeat(W) + "\n");
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
