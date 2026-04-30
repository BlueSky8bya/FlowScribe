/**
 * multi_judge_reader_immersion_audit.mjs — Phase 4.12 Gemini + OpenAI consensus
 *
 * 두 judge가 동일한 chunk를 평가하고, fatal_consensus / fatal_union /
 * judge_disagreement / verdict (READY/CONDITIONAL/NOT_READY)를 생성한다.
 *
 * Usage: node scripts/multi_judge_reader_immersion_audit.mjs --book-id <uuid>
 *
 * 환경:
 *   GEMINI_API_KEY (필수)
 *   OPENAI_API_KEY (필수)
 *   OPENAI_JUDGE_MODEL (기본 gpt-4.1-mini)
 *
 * 비용 절감: 본 스크립트는 chunked 형태가 아니라 5화 단위 단순 chunk로 두 judge에 한 번씩 호출.
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
const OPENAI_MODEL = process.env.OPENAI_JUDGE_MODEL ?? "gpt-4.1-mini";
const GEMINI_MODEL = "gemini-2.5-flash";

if (!GEMINI_KEY) { console.error("GEMINI_API_KEY 미설정"); process.exit(1); }
if (!OPENAI_KEY) { console.error("OPENAI_API_KEY 미설정"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── HTTP helpers ─────────────────────────────────────────────
function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, res => {
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

async function callGemini(prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 4000, temperature: 0.1 },
  });
  return httpsRequest({
    hostname: "generativelanguage.googleapis.com",
    path: `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  }, body);
}

async function callOpenAI(prompt) {
  const body = JSON.stringify({
    model: OPENAI_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    max_tokens: 3000,
    response_format: { type: "json_object" },
  });
  return httpsRequest({
    hostname: "api.openai.com",
    path: "/v1/chat/completions",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Length": Buffer.byteLength(body),
    },
  }, body);
}

function repairTruncated(s) {
  const stack = [];
  let inStr = false, escape = false;
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

function parseGeminiBody(raw) {
  try {
    const env = JSON.parse(raw);
    const text = env.candidates?.[0]?.content?.parts?.find(p => !p.thought && p.text)?.text ?? "";
    const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    try { return JSON.parse(clean); } catch {}
    try { return JSON.parse(repairTruncated(clean)); } catch (e) {
      return { _parse_error: e.message };
    }
  } catch (e) {
    return { _parse_error: `envelope: ${e.message}` };
  }
}

function parseOpenAIBody(raw) {
  try {
    const env = JSON.parse(raw);
    const text = env.choices?.[0]?.message?.content ?? "";
    try { return JSON.parse(text); } catch {}
    try { return JSON.parse(repairTruncated(text)); } catch (e) {
      return { _parse_error: e.message };
    }
  } catch (e) {
    return { _parse_error: `envelope: ${e.message}` };
  }
}

// ── 데이터 로드 ──────────────────────────────────────────────
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

  if (epRes.rows.length === 0) {
    console.log("episodes 없음"); process.exit(0);
  }

  const stateByEp = {};
  for (const r of stRes.rows) {
    if (!stateByEp[r.episode_number]) stateByEp[r.episode_number] = [];
    stateByEp[r.episode_number].push(r);
  }

  // ── 본문 chunks (1-5, 6-10) ─────────────────────────────────
  const chunks = [];
  for (let i = 0; i < epRes.rows.length; i += 5) {
    const slice = epRes.rows.slice(i, i + 5);
    const stateBrief = slice.map(ep => {
      const sts = stateByEp[ep.episode_number] ?? [];
      return `ep${ep.episode_number} states: ` + sts.map(s => {
        const items = Array.isArray(s.items) ? s.items : [];
        const itemNames = items.map(it => typeof it === "string" ? it : it?.name).filter(Boolean).slice(0,3).join(",");
        return `${s.character_name}(loc=${s.location ?? "?"},vis=${s.visibility_state ?? "?"},items=${itemNames})`;
      }).join("; ");
    }).join("\n");
    const body = slice.map(ep => `=== ep${ep.episode_number} ===\n${ep.content.slice(0, 3000)}`).join("\n\n");
    chunks.push({
      label: `ep${slice[0].episode_number}-${slice[slice.length-1].episode_number}`,
      stateBrief,
      body,
    });
  }

  const W = 70;
  console.log(`\n${"═".repeat(W)}`);
  console.log(` Multi-Judge Reader Immersion (book: ${bookId.slice(0, 8)}...)`);
  console.log(` judges: gemini-2.5-flash + ${OPENAI_MODEL}`);
  console.log("═".repeat(W));

  const judgePromptFor = (chunk) => [
    "당신은 한국어 소설의 독자 몰입 감사관이다. 아래 본문을 읽고 fatal/major/minor issue를 찾아라.",
    "fatal: 독자가 즉시 몰입을 잃는 결정적 모순 (위치/지식/소지품/visibility/affordance 등).",
    "major: 흐름이 어색하지만 치명적이진 않음.",
    "minor: 사소한 표현/감정/연결.",
    "",
    "[인물 상태 누적]",
    chunk.stateBrief,
    "",
    `[본문 chunk: ${chunk.label}]`,
    chunk.body,
    "",
    "출력 (JSON만):",
    `{"fatal":[{"episode":N,"category":"...","why":"..."}], "major":[...], "minor":[...]}`,
  ].join("\n");

  const geminiAll = { fatal: [], major: [], minor: [] };
  const openaiAll = { fatal: [], major: [], minor: [] };
  const errors = { gemini: 0, openai: 0 };

  for (const chunk of chunks) {
    process.stdout.write(`  ${chunk.label} → gemini... `);
    const gRes = await callGemini(judgePromptFor(chunk));
    if (gRes.status !== 200) {
      errors.gemini++;
      console.log(`HTTP ${gRes.status}`);
    } else {
      const parsed = parseGeminiBody(gRes.body);
      if (parsed._parse_error) {
        errors.gemini++;
        console.log(`parse err: ${parsed._parse_error.slice(0, 30)}`);
      } else {
        for (const sev of ["fatal", "major", "minor"]) {
          for (const it of (parsed[sev] ?? [])) geminiAll[sev].push({ ...it, chunk: chunk.label });
        }
        console.log(`f=${(parsed.fatal||[]).length} m=${(parsed.major||[]).length} mn=${(parsed.minor||[]).length}`);
      }
    }

    process.stdout.write(`  ${chunk.label} → openai... `);
    const oRes = await callOpenAI(judgePromptFor(chunk));
    if (oRes.status !== 200) {
      errors.openai++;
      console.log(`HTTP ${oRes.status}`);
    } else {
      const parsed = parseOpenAIBody(oRes.body);
      if (parsed._parse_error) {
        errors.openai++;
        console.log(`parse err: ${parsed._parse_error.slice(0, 30)}`);
      } else {
        for (const sev of ["fatal", "major", "minor"]) {
          for (const it of (parsed[sev] ?? [])) openaiAll[sev].push({ ...it, chunk: chunk.label });
        }
        console.log(`f=${(parsed.fatal||[]).length} m=${(parsed.major||[]).length} mn=${(parsed.minor||[]).length}`);
      }
    }
  }

  // ── consensus ──────────────────────────────────────────────
  // key: "ep::category" simplified
  const keyOf = i => `ep${i.episode}::${(i.category ?? "").slice(0, 30).toLowerCase()}`;
  const gFatalKeys = new Set(geminiAll.fatal.map(keyOf));
  const oFatalKeys = new Set(openaiAll.fatal.map(keyOf));
  const consensusKeys = [...gFatalKeys].filter(k => oFatalKeys.has(k));
  const unionKeys = new Set([...gFatalKeys, ...oFatalKeys]);
  const onlyG = [...gFatalKeys].filter(k => !oFatalKeys.has(k));
  const onlyO = [...oFatalKeys].filter(k => !gFatalKeys.has(k));

  // ── verdict ────────────────────────────────────────────────
  let verdict;
  if (consensusKeys.length === 0 && gFatalKeys.size === 0 && oFatalKeys.size === 0) {
    verdict = "READY";
  } else if (consensusKeys.length === 0) {
    verdict = "CONDITIONAL"; // disagreement only
  } else {
    verdict = "NOT_READY";
  }

  console.log(`\n${"─".repeat(W)}`);
  console.log("Multi-Judge Summary");
  console.log(`${"─".repeat(W)}`);
  console.log(`gemini fatal=${geminiAll.fatal.length} major=${geminiAll.major.length} minor=${geminiAll.minor.length}`);
  console.log(`openai fatal=${openaiAll.fatal.length} major=${openaiAll.major.length} minor=${openaiAll.minor.length}`);
  console.log(`fatal_consensus: ${consensusKeys.length}건`);
  console.log(`fatal_union:     ${unionKeys.size}건`);
  console.log(`gemini-only:     ${onlyG.length}건`);
  console.log(`openai-only:     ${onlyO.length}건`);
  console.log(`errors: gemini=${errors.gemini} openai=${errors.openai}`);

  if (consensusKeys.length) {
    console.log("\n🔴 fatal_consensus (두 judge 모두 지적):");
    for (const k of consensusKeys.slice(0, 8)) {
      const g = geminiAll.fatal.find(i => keyOf(i) === k);
      console.log(`  ${k} — ${(g?.why ?? "").slice(0, 80)}`);
    }
  }
  if (onlyG.length) {
    console.log("\n🟡 gemini-only fatal:");
    for (const k of onlyG.slice(0, 5)) console.log(`  ${k}`);
  }
  if (onlyO.length) {
    console.log("\n🟡 openai-only fatal:");
    for (const k of onlyO.slice(0, 5)) console.log(`  ${k}`);
  }

  console.log(`\n${"─".repeat(W)}`);
  console.log(`Multi-Judge Verdict: ${verdict === "READY" ? "✅" : verdict === "CONDITIONAL" ? "⚠️" : "❌"} ${verdict}`);
  console.log(`${"═".repeat(W)}\n`);

  process.exit(verdict === "NOT_READY" ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
