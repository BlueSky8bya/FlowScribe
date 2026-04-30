/**
 * audit_action_affordance.mjs — 신체/소지품/관계 affordance 감사
 *
 * 인물의 현재 신체 상태/소지품/관계가 본문 행동·발화와 모순되는지 검사.
 * Gemini judge 사용.
 *
 * 검사 대상:
 *   - 부상/기절/구속/탈진 상태에서 가능한 행동인지
 *   - 빈손 상태에서 아이템 사용
 *   - 분실/파손 아이템 사용
 *   - 관계상 모를 인물을 이름으로 부름 등
 *
 * Usage: node scripts/audit_action_affordance.mjs --book-id <uuid>
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
    `SELECT episode_number, character_name, location, items, physical_state, emotional_state, visibility_state
     FROM character_dynamic_states WHERE book_id=$1 ORDER BY episode_number, character_name`,
    [bookId]
  );
  await pool.end();

  if (!epRes.rows.length) {
    console.log("affordance audit은 1화 이상 필요");
    process.exit(0);
  }

  const stateByEp = {};
  for (const r of stRes.rows) {
    if (!stateByEp[r.episode_number]) stateByEp[r.episode_number] = [];
    stateByEp[r.episode_number].push(r);
  }

  const W = 70;
  console.log(`\n${"═".repeat(W)}`);
  console.log(` AUDIT — Action Affordance (book: ${bookId.slice(0, 8)}...)`);
  console.log("═".repeat(W));

  const allIssues = [];

  for (const ep of epRes.rows) {
    const states = stateByEp[ep.episode_number] ?? [];
    const stateBrief = states.map(s => {
      const items = Array.isArray(s.items) ? s.items :
        (typeof s.items === "string" ? JSON.parse(s.items || "[]") : []);
      const itemNames = items.map(it => {
        if (typeof it === "string") return it;
        const cond = it?.condition ? `(${it.condition})` : "";
        return `${it?.name ?? ""}${cond}`;
      }).filter(Boolean).join(", ");
      return `${s.character_name}: 상태=${s.physical_state ?? "?"}/${s.emotional_state ?? "?"}, 위치=${s.location ?? "?"}, 소지=[${itemNames}], visibility=${s.visibility_state ?? "?"}`;
    }).join("\n");

    const prompt = [
      "당신은 서사 affordance 감사관이다. 인물의 신체 상태/소지품/위치와 본문 행동이 모순되는지 검사하라.",
      "",
      "fatal 판정 기준:",
      "- 부상/기절/구속 상태에서 그 부위로 정상 행동 (예: 손이 묶임 → 양손으로 문 열기)",
      "- absent/미등장 상태인데 본문에서 행동 (visibility_state=absent)",
      "- 빈손 또는 미소지 아이템을 꺼내거나 사용",
      "- 분실/파손/소진된 아이템을 정상 사용",
      "- 다른 위치에 있는 인물이 같은 장면에 등장",
      "",
      "주의:",
      "- 본문에 회복/획득/이동을 설명하는 짧은 묘사가 있으면 fatal 아님",
      "- 추측/회상/꿈은 검사 대상 아님",
      "",
      `[ep${ep.episode_number} 인물 상태]`,
      stateBrief,
      "",
      `[ep${ep.episode_number} 본문]`,
      ep.content.slice(0, 4000),
      "",
      "출력 형식 (JSON만):",
      `{"issues": [{"character": "이름", "severity": "fatal|major|minor", "violation": "어긴 affordance", "body_evidence": "본문 인용(60자 이내)", "state_evidence": "상태 단서"}]}`,
      "위반 후보가 없으면 issues는 빈 배열.",
    ].join("\n");

    process.stdout.write(`  ep${ep.episode_number} 검사 중... `);
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
      allIssues.push({ episode: ep.episode_number, ...iss });
    }
  }

  const fatalIssues = allIssues.filter(i => i.severity === "fatal");
  const majorIssues = allIssues.filter(i => i.severity === "major");
  const minorIssues = allIssues.filter(i => i.severity === "minor");

  if (fatalIssues.length) {
    console.log(`\n🔴 FATAL affordance violations (${fatalIssues.length}):`);
    for (const i of fatalIssues) {
      console.log(`  ep${i.episode} [${i.character}] ${(i.violation ?? "").slice(0, 80)}`);
      if (i.body_evidence) console.log(`    body: "${i.body_evidence.slice(0, 60)}"`);
    }
  }
  if (majorIssues.length) {
    console.log(`\n🟡 MAJOR (${majorIssues.length}):`);
    for (const i of majorIssues.slice(0, 10)) {
      console.log(`  ep${i.episode} [${i.character}] ${(i.violation ?? "").slice(0, 80)}`);
    }
  }

  console.log(`\n${"─".repeat(W)}`);
  console.log(`affordance_fatal: ${fatalIssues.length}건 | major: ${majorIssues.length}건 | minor: ${minorIssues.length}건`);

  if (fatalIssues.length > 0) {
    console.error("❌ ACTION AFFORDANCE: FAIL");
    process.exit(1);
  } else if (majorIssues.length > 2) {
    console.log("⚠️  ACTION AFFORDANCE: WARN");
  } else {
    console.log("✅ ACTION AFFORDANCE: PASS");
  }
  console.log("═".repeat(W) + "\n");
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
