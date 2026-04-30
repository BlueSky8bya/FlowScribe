/**
 * gemini_reader_immersion_full_audit.mjs — Full-DB Gemini Reader Immersion Judge
 *
 * 전체 DB (episodes, run_traces, character_dynamic_states, canonical_characters,
 * foreshadows, arc_summaries, character_arcs, episode_snapshots, world_rules)를
 * 읽어 Gemini 멀티-chunk 방식으로 Reader Immersion 감사를 수행한다.
 *
 * Structure:
 *   A. DB fetch (all tables)
 *   B. Episode chunks: ep1-3, ep4-6, ep7-10 (각 full content + trace + states)
 *   C. Character consistency audit (전체 state 히스토리 + arcs)
 *   D. Item/location/foreshadow audit
 *   E. Final synthesis (모든 chunk 결과 통합 → 최종 JSON verdict)
 *
 * Usage: node scripts/gemini_reader_immersion_full_audit.mjs --book-id <uuid>
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

const MODEL = "gemini-2.5-flash";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const W = 70;

// ═══════════════════════════════════════════════════════════════════
// A. DB Fetch
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(W)}`);
console.log(` Gemini Full-DB Reader Immersion Audit`);
console.log(` book_id: ${bookId}`);
console.log("═".repeat(W));
console.log(" [A] DB 조회 중...");

const [
  bookRes, epRes, stateRes, canonRes,
  traceRes, foreshadowRes, arcSumRes, charArcRes,
  snapshotRes, worldRuleRes,
] = await Promise.all([
  pool.query(`SELECT title, context FROM books WHERE id=$1`, [bookId]),
  pool.query(
    `SELECT episode_number, content, summary FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
    [bookId]
  ),
  pool.query(
    `SELECT character_name, episode_number, location, physical_state, items,
            emotional_state, recent_goal, relationship_updates
     FROM character_dynamic_states WHERE book_id=$1
     ORDER BY character_name, episode_number`,
    [bookId]
  ),
  pool.query(
    `SELECT name, personality, type, gender, initial_items FROM canonical_characters WHERE book_id=$1`,
    [bookId]
  ),
  pool.query(
    `SELECT episode_number, final_verdict, final_score, revision_count,
            planner_trace, renderer_trace, plan_validation, prose_validation,
            computed_reward
     FROM run_traces WHERE book_id=$1 ORDER BY episode_number`,
    [bookId]
  ),
  pool.query(
    `SELECT planted_episode, resolved_episode, content, keywords, status
     FROM foreshadows WHERE book_id=$1 ORDER BY planted_episode`,
    [bookId]
  ),
  pool.query(
    `SELECT arc_number, episode_start, episode_end, summary, key_events
     FROM arc_summaries WHERE book_id=$1 ORDER BY arc_number`,
    [bookId]
  ),
  pool.query(
    `SELECT character_name, arc_number, state, key_events
     FROM character_arcs WHERE book_id=$1 ORDER BY character_name, arc_number`,
    [bookId]
  ),
  pool.query(
    `SELECT episode_number, task, effective_context
     FROM episode_snapshots WHERE book_id=$1 ORDER BY episode_number`,
    [bookId]
  ),
  pool.query(
    `SELECT rule_type, content FROM world_rules WHERE book_id=$1 AND is_active=true ORDER BY rule_type`,
    [bookId]
  ),
]);
await pool.end();

const bookTitle = bookRes.rows[0]?.title ?? bookId;
const ctx = bookRes.rows[0]?.context ?? {};
const genre = ctx.genre ?? "알 수 없음";
const episodes = epRes.rows;
const dynamicStates = stateRes.rows;
const canonChars = canonRes.rows;
const traces = traceRes.rows;
const foreshadows = foreshadowRes.rows;
const arcSummaries = arcSumRes.rows;
const charArcs = charArcRes.rows;
const snapshots = snapshotRes.rows;
const worldRules = worldRuleRes.rows;

console.log(` ✓ episodes: ${episodes.length}, traces: ${traces.length}, states: ${dynamicStates.length}`);
console.log(` ✓ chars: ${canonChars.length}, foreshadows: ${foreshadows.length}, snapshots: ${snapshots.length}`);
console.log(` ✓ arcSummaries: ${arcSummaries.length}, charArcs: ${charArcs.length}, worldRules: ${worldRules.length}`);

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function trimContent(text, maxChars = 3000) {
  if (!text) return "(없음)";
  if (text.length <= maxChars) return text;
  // opening 1500 + ending 1000
  return text.slice(0, 1500) + "\n...[중략]...\n" + text.slice(-1000);
}

function statesForEpisode(epNum) {
  return dynamicStates.filter(s => s.episode_number === epNum)
    .map(s => {
      const items = Array.isArray(s.items)
        ? s.items.map(i => (typeof i === "string" ? i : i?.name ?? JSON.stringify(i))).join(", ")
        : (s.items ?? "-");
      const rel = s.relationship_updates ? JSON.stringify(s.relationship_updates).slice(0, 100) : "-";
      return `  [${s.character_name}] 위치:${s.location ?? "?"} | 신체:${s.physical_state ?? "정상"} | 감정:${s.emotional_state ?? "?"} | 목표:${s.recent_goal ?? "?"} | 소지:${items} | 관계변화:${rel}`;
    }).join("\n");
}

function traceForEpisode(epNum) {
  const t = traces.find(t => t.episode_number === epNum);
  if (!t) return "  (trace 없음)";
  const plannerOut = t.planner_trace?.output ? JSON.stringify(t.planner_trace.output).slice(0, 300) : "-";
  const rendererOut = t.renderer_trace?.output ? JSON.stringify(t.renderer_trace.output).slice(0, 200) : "-";
  const reward = t.computed_reward ? JSON.stringify(t.computed_reward).slice(0, 150) : "-";
  return [
    `  verdict:${t.final_verdict ?? "?"} score:${t.final_score ?? "?"} revisions:${t.revision_count ?? 0}`,
    `  planner_out: ${plannerOut}`,
    `  renderer_out: ${rendererOut}`,
    `  reward: ${reward}`,
  ].join("\n");
}

function snapshotTask(epNum) {
  const s = snapshots.find(s => s.episode_number === epNum);
  if (!s) return "-";
  const task = s.task ? JSON.stringify(s.task).slice(0, 200) : "-";
  return task;
}

function buildWorldSection() {
  const rules = worldRules.map(r => `  [${r.rule_type}] ${r.content}`).join("\n") || "  (없음)";
  const ctxRules = (ctx.rules ?? []).map(r => `  - ${r.content ?? r}`).join("\n") || "  (없음)";
  return `세계관 규칙 (world_rules table):\n${rules}\n\n세계관 규칙 (books.context.rules):\n${ctxRules}`;
}

function buildCharSection() {
  return canonChars.map(c => {
    const items = Array.isArray(c.initial_items)
      ? c.initial_items.map(i => (typeof i === "string" ? i : i?.name ?? JSON.stringify(i))).join(", ")
      : (c.initial_items ?? "-");
    const arcs = charArcs.filter(a => a.character_name === c.name)
      .map(a => `    arc${a.arc_number}: ${a.state} | events:${JSON.stringify(a.key_events ?? []).slice(0, 100)}`).join("\n");
    const history = dynamicStates.filter(s => s.character_name === c.name)
      .map(s => {
        const si = Array.isArray(s.items) ? s.items.map(i => (typeof i === "string" ? i : i?.name ?? "?")).join(",") : (s.items ?? "-");
        return `    ep${s.episode_number}: 위치:${s.location ?? "?"} 신체:${s.physical_state ?? "정상"} 감정:${s.emotional_state ?? "?"} 목표:${s.recent_goal ?? "?"} 소지:${si}`;
      }).join("\n");
    return `[${c.name}] (${c.gender}, ${c.type})\n  성격:${c.personality}\n  초기소지품:${items}\n  아크:\n${arcs || "  -"}\n  에피소드별 상태:\n${history || "  -"}`;
  }).join("\n\n");
}

function buildForeshadowSection() {
  return foreshadows.map(f =>
    `  ep${f.planted_episode}→${f.resolved_episode ?? "open"} [${f.status}] ${f.content.slice(0, 120)} | keywords:${(f.keywords ?? []).join(",")}`
  ).join("\n") || "  (없음)";
}

function buildArcSection() {
  return arcSummaries.map(a =>
    `  arc${a.arc_number} (ep${a.episode_start}-${a.episode_end}): ${a.summary?.slice(0, 150) ?? "-"}\n  key_events:${JSON.stringify(a.key_events ?? []).slice(0, 150)}`
  ).join("\n\n") || "  (없음)";
}

// ═══════════════════════════════════════════════════════════════════
// Gemini REST
// ═══════════════════════════════════════════════════════════════════
let geminiCallCount = 0;
let totalInputChars = 0;

function geminiRequest(promptText, maxTokens = 4096) {
  geminiCallCount++;
  totalInputChars += promptText.length;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.1,
    },
  });
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
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

const DEBUG = process.env.GEMINI_DEBUG === "1";

function parseGeminiJSON(raw) {
  let text;
  try {
    const j = JSON.parse(raw);
    const parts = j.candidates?.[0]?.content?.parts ?? [];
    const textPart = parts.find(p => !p.thought && p.text) ?? parts[0];
    text = textPart?.text ?? "";
    if (!text) throw new Error("no text: " + JSON.stringify(j.error ?? j).slice(0, 200));
  } catch (e) {
    return { _parse_error: `envelope parse failed: ${e.message}`, _raw: raw.slice(0, 500) };
  }
  if (DEBUG) process.stderr.write(`[DEBUG text len=${text.length}] ${text.slice(0, 400)}\n`);

  // strip markdown fence
  let clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  // try direct parse
  try { return JSON.parse(clean); } catch {}

  // Truncated JSON repair: close unclosed brackets/braces
  function repairTruncated(s) {
    const stack = [];
    let inStr = false;
    let escape = false;
    let lastColon = -1; // track position of last ':' outside string (key-value separator)
    let lastValueStart = -1; // track if a value has started after the last ':'
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') {
        if (!inStr) lastValueStart = i; // opening quote starts a value
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (c === ":") { lastColon = i; lastValueStart = -1; }
      else if (c === "{") { stack.push("}"); lastValueStart = i; }
      else if (c === "[") { stack.push("]"); lastValueStart = i; }
      else if (c === "}" || c === "]") { stack.pop(); lastValueStart = i; }
      else if (c !== " " && c !== "\n" && c !== "\t" && c !== ",") { lastValueStart = i; }
    }
    // if ended mid-string, close it
    let prefix = "";
    let suffix = "";
    if (inStr) suffix += '"';
    // if ended after ':' with no value started, insert null
    else if (lastColon > lastValueStart) prefix = "null";
    suffix += stack.reverse().join("");
    return s + prefix + suffix;
  }

  const repaired = repairTruncated(clean);
  if (DEBUG) process.stderr.write(`[DEBUG repaired suffix added, len=${repaired.length}]\n`);
  try { return { ...JSON.parse(repaired), _truncated: true }; } catch (e2) {
    if (DEBUG) process.stderr.write(`[DEBUG repair failed: ${e2.message}]\n`);
    return { _parse_error: `truncation repair failed: ${e2.message}`, _raw: clean.slice(0, 500) };
  }
}

const CHUNK_SYSTEM = `당신은 한국어 소설의 독자 몰입 전문 감사자다.
판단 기준: 독자가 "말이 안 된다"고 느낄 몰입 파괴 가능성.
POV 형식 규칙보다 독자 이해 가능성, 상태 일관성, 인과 개연성을 우선한다.
장르명 기반 규칙 금지 — 현재 작품 내 확립된 규칙과 인물 상태를 기준으로 판단하라.

출력: 반드시 아래 JSON 형식만 출력. 마크다운 fence 없이 순수 JSON.
{
  "fatal_issues": [{"episode":N,"category":"...","evidence":"...","why_immersion_breaks":"...","root_cause":"state|prompt|memory|ledger|renderer|planner|postprocess"}],
  "major_issues": [{"episode":N,"category":"...","evidence":"...","why_immersion_breaks":"...","root_cause":"..."}],
  "minor_issues": [{"episode":N,"category":"...","evidence":"...","why_immersion_breaks":"..."}],
  "checks_summary": {"항목명":"PASS|WARN|FAIL"},
  "chunk_notes": "이 chunk에서 특이사항 요약"
}`;

// ═══════════════════════════════════════════════════════════════════
// B. Episode Chunks
// ═══════════════════════════════════════════════════════════════════

const worldSection = buildWorldSection();
const bookHeader = `제목: ${bookTitle}\n장르: ${genre}\n\n${worldSection}`;

async function auditEpisodeChunk(epNums, label) {
  console.log(` [B] Episode chunk ${label} Gemini 호출 중...`);
  const epBlocks = epNums.map(n => {
    const ep = episodes.find(e => e.episode_number === n);
    if (!ep) return `=== ep${n}: 데이터 없음 ===`;
    const content = trimContent(ep.content, 2800);
    const states = statesForEpisode(n) || "  (없음)";
    const trace = traceForEpisode(n);
    const task = snapshotTask(n);
    return [
      `=== ep${n} ===`,
      `[생성 task] ${task}`,
      `[본문]\n${content}`,
      `[인물 상태]\n${states}`,
      `[run_trace]\n${trace}`,
    ].join("\n");
  }).join("\n\n");

  const prompt = `${CHUNK_SYSTEM}

[작품 정보]
${bookHeader}

[감사 대상: ${label}]
${epBlocks}

[독자 몰입 감사 항목]
1. 죽음/기절/부상/무력화 후 행동 충돌
2. 소지품 소유/상태 모순 (특히 잃은 아이템 재등장)
3. 위치 이동/장면 전환의 납득 가능성
4. 인물이 알 수 없는 정보 사용 (지식 누출)
5. 관계 거리감/말투의 급격한 변화 (계기 없이)
6. 감정 반응이 현재 위협/상황에 맞는지
7. 특수 토큰/외국어/반복/톤 붕괴 (LLM artifact)
8. 세계관 규칙 위반
9. 인과관계/동기 논리 오류
10. 연속 동일 감정·목표 고착 (독자에게 서사 정체감)`;

  const { status, body } = await geminiRequest(prompt, 6000);
  if (status !== 200) {
    const errText = JSON.parse(body)?.error?.message ?? body.slice(0, 200);
    console.error(`  ✗ HTTP ${status}: ${errText}`);
    return { _http_error: status, fatal_issues: [], major_issues: [], minor_issues: [], checks_summary: {}, chunk_notes: `HTTP ${status}` };
  }
  const result = parseGeminiJSON(body);
  const fi = (result.fatal_issues ?? []).length;
  const mi = (result.major_issues ?? []).length;
  const ni = (result.minor_issues ?? []).length;
  console.log(`  ✓ ${label}: fatal=${fi} major=${mi} minor=${ni}${result._parse_error ? " ⚠ parse_error" : result._truncated ? " ⚡ truncated(repaired)" : ""}`);
  return result;
}

const chunkB1 = await auditEpisodeChunk([1, 2, 3], "ep1-3");
const chunkB2 = await auditEpisodeChunk([4, 5, 6], "ep4-6");
const chunkB3 = await auditEpisodeChunk(
  episodes.filter(e => e.episode_number >= 7).map(e => e.episode_number),
  `ep7-${episodes.length}`
);

// ═══════════════════════════════════════════════════════════════════
// C. Character Consistency Audit
// ═══════════════════════════════════════════════════════════════════
console.log(" [C] Character consistency Gemini 호출 중...");

const charSection = buildCharSection();
const chunkCPrompt = `${CHUNK_SYSTEM}

[작품 정보]
${bookHeader}

[인물 상세 정보 — 전화 히스토리]
${charSection}

[감사 항목 — 인물 일관성]
1. canonical 성격/능력과 실제 행동 괴리
2. 사망/무력화 후 행동 재등장 (alive contradiction)
3. 초기소지품 → 에피소드별 소지품 변화의 개연성 (lost item 재등장 여부)
4. 위치 이동 히스토리의 물리적 납득 가능성
5. 감정 히스토리: 동일 감정 3화+ 연속 고착 여부
6. 목표 변화의 개연성 (계기 없는 급변)
7. 관계 변화의 개연성 (초면→과도한 신뢰/친밀)
8. 아크 상태가 에피소드 상태와 일치하는지`;

const { status: cStatus, body: cBody } = await geminiRequest(chunkCPrompt, 6000);
let chunkC = { fatal_issues: [], major_issues: [], minor_issues: [], checks_summary: {}, chunk_notes: "" };
if (cStatus !== 200) {
  console.error(`  ✗ HTTP ${cStatus}`);
  chunkC.chunk_notes = `HTTP ${cStatus}`;
} else {
  chunkC = parseGeminiJSON(cBody);
  console.log(`  ✓ char chunk: fatal=${(chunkC.fatal_issues??[]).length} major=${(chunkC.major_issues??[]).length} minor=${(chunkC.minor_issues??[]).length}${chunkC._parse_error?" ⚠ parse_error":chunkC._truncated?" ⚡ truncated(repaired)":""}`);
}

// ═══════════════════════════════════════════════════════════════════
// D. Item / Location / Foreshadow Audit
// ═══════════════════════════════════════════════════════════════════
console.log(" [D] Item/Location/Foreshadow Gemini 호출 중...");

const fsSection = buildForeshadowSection();
const arcSection = buildArcSection();

const chunkDPrompt = `${CHUNK_SYSTEM}

[작품 정보]
${bookHeader}

[복선 목록]
${fsSection}

[아크 요약]
${arcSection}

[에피소드별 요약]
${episodes.map(ep => `ep${ep.episode_number}: ${(ep.summary ?? ep.content ?? "").slice(0, 150)}`).join("\n")}

[에피소드별 전체 인물 상태 (위치/소지)]
${episodes.map(ep => {
  const s = statesForEpisode(ep.episode_number);
  return `ep${ep.episode_number}:\n${s || "  (없음)"}`;
}).join("\n")}

[감사 항목 — 아이템/위치/복선]
1. 소지품 이동/분실/파괴 후 근거 없는 복원
2. 소지품 소유권 불일치 (다른 인물이 갖고 있어야 할 아이템)
3. 위치 이동이 물리적으로 불가능한 경우
4. 장소 환경 오브젝트와 인물 행동 충돌
5. 복선 planted 후 해당 정보를 인물이 미리 아는 지식 누출
6. open 복선이 너무 오래 방치되어 독자가 잊을 가능성
7. 아크 요약과 실제 에피소드 흐름의 불일치`;

const { status: dStatus, body: dBody } = await geminiRequest(chunkDPrompt, 6000);
let chunkD = { fatal_issues: [], major_issues: [], minor_issues: [], checks_summary: {}, chunk_notes: "" };
if (dStatus !== 200) {
  console.error(`  ✗ HTTP ${dStatus}`);
  chunkD.chunk_notes = `HTTP ${dStatus}`;
} else {
  chunkD = parseGeminiJSON(dBody);
  console.log(`  ✓ item/loc/fs chunk: fatal=${(chunkD.fatal_issues??[]).length} major=${(chunkD.major_issues??[]).length} minor=${(chunkD.minor_issues??[]).length}${chunkD._parse_error?" ⚠ parse_error":chunkC._truncated?" ⚡ truncated(repaired)":""}`);
}

// ═══════════════════════════════════════════════════════════════════
// E. Final Synthesis
// ═══════════════════════════════════════════════════════════════════
console.log(" [E] Final synthesis Gemini 호출 중...");

const allFatal = [
  ...(chunkB1.fatal_issues ?? []),
  ...(chunkB2.fatal_issues ?? []),
  ...(chunkB3.fatal_issues ?? []),
  ...(chunkC.fatal_issues ?? []),
  ...(chunkD.fatal_issues ?? []),
];
const allMajor = [
  ...(chunkB1.major_issues ?? []),
  ...(chunkB2.major_issues ?? []),
  ...(chunkB3.major_issues ?? []),
  ...(chunkC.major_issues ?? []),
  ...(chunkD.major_issues ?? []),
];
const allMinor = [
  ...(chunkB1.minor_issues ?? []),
  ...(chunkB2.minor_issues ?? []),
  ...(chunkB3.minor_issues ?? []),
  ...(chunkC.minor_issues ?? []),
  ...(chunkD.minor_issues ?? []),
];

const SYNTHESIS_SYSTEM = `당신은 한국어 소설의 독자 몰입 최종 심판자다.
아래는 5개 chunk 감사 결과다. 중복 이슈를 합치고, 최종 판정을 내려라.

출력: 반드시 아래 JSON 형식만 출력. 마크다운 fence 없이 순수 JSON.
{
  "book_id": "${bookId}",
  "audit_type": "reader_immersion_full_db",
  "model": "${MODEL}",
  "verdict": "PASS | CONDITIONAL PASS | WARN | FAIL",
  "immersion_score": 0.0,
  "fatal_issues": [...],
  "major_issues": [...],
  "minor_issues": [...],
  "checks": {
    "logic_consistency": "PASS|WARN|FAIL",
    "relationship_consistency": "PASS|WARN|FAIL",
    "inventory_consistency": "PASS|WARN|FAIL",
    "location_continuity": "PASS|WARN|FAIL",
    "time_continuity": "PASS|WARN|FAIL",
    "knowledge_consistency": "PASS|WARN|FAIL",
    "emotional_plausibility": "PASS|WARN|FAIL",
    "artifact_noise": "PASS|WARN|FAIL",
    "genre_rule_consistency": "PASS|WARN|FAIL",
    "foreshadow_consistency": "PASS|WARN|FAIL"
  },
  "whether_30ep_allowed": "YES | NO | CONDITIONAL",
  "likely_root_cause": "...",
  "suggested_fix_category": "state | prompt | postprocess | memory | ledger",
  "confidence": 0.0
}

점수 기준: fatal 1개=0.15, major 1개=0.03, minor 1개=0.01 페널티. 1.0에서 차감.
verdict: ≥0.95=PASS, ≥0.90=CONDITIONAL PASS, ≥0.80=WARN, <0.80=FAIL
whether_30ep_allowed: fatal=0이면 CONDITIONAL 이상 가능, fatal>0이면 NO`;

// Deduplicate issues by episode+category before synthesis
function dedup(issues) {
  const seen = new Set();
  return issues.filter(iss => {
    const key = `${iss.episode ?? "?"}::${iss.category ?? "?"}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
const dedupFatal = dedup(allFatal);
const dedupMajor = dedup(allMajor);
const dedupMinor = dedup(allMinor);

// Compact issue representation for synthesis (limit evidence length)
function compactIssues(issues, maxEach = 120) {
  return issues.map(iss => ({
    episode: iss.episode,
    category: iss.category,
    evidence: (iss.evidence ?? "").slice(0, maxEach),
    why: (iss.why_immersion_breaks ?? iss.why ?? "").slice(0, maxEach),
    root_cause: iss.root_cause,
  }));
}

const synthPrompt = `${SYNTHESIS_SYSTEM}

[수집된 fatal issues (원본 ${allFatal.length}개 → 중복제거 ${dedupFatal.length}개)]
${JSON.stringify(compactIssues(dedupFatal), null, 1).slice(0, 3000)}

[수집된 major issues (원본 ${allMajor.length}개 → 중복제거 ${dedupMajor.length}개)]
${JSON.stringify(compactIssues(dedupMajor), null, 1).slice(0, 2500)}

[수집된 minor issues (원본 ${allMinor.length}개 → 중복제거 ${dedupMinor.length}개)]
${JSON.stringify(compactIssues(dedupMinor), null, 1).slice(0, 1000)}

[chunk notes]
ep1-3: ${chunkB1.chunk_notes ?? "(truncated)"}
ep4-6: ${chunkB2.chunk_notes ?? "(truncated)"}
ep7+: ${chunkB3.chunk_notes ?? "(truncated)"}
character: ${chunkC.chunk_notes ?? "(truncated)"}
item/loc/fs: ${chunkD.chunk_notes ?? "(truncated)"}

주의: truncated chunk에서 온 이슈는 증거가 불완전할 수 있다. 불확실한 이슈는 confidence를 낮추고 major로 강등 가능.
신뢰도(confidence)는 0~1 사이. 증거가 구체적이면 높게, 요약만 있으면 낮게.`;

const { status: eStatus, body: eBody } = await geminiRequest(synthPrompt, 8000);
// Local score computation fallback (same formula as deterministic audit)
function computeLocalScore(fatal, major, minor) {
  const penalty = fatal.length * 0.15 + major.length * 0.03 + minor.length * 0.01;
  return Math.max(0, 1 - penalty);
}
function localVerdict(score) {
  if (score >= 0.95) return "PASS";
  if (score >= 0.90) return "CONDITIONAL PASS";
  if (score >= 0.80) return "WARN";
  return "FAIL";
}
const localScore = computeLocalScore(dedupFatal, dedupMajor, dedupMinor);
const DEFAULT_RESULT = {
  book_id: bookId,
  audit_type: "reader_immersion_full_db",
  model: MODEL,
  verdict: localVerdict(localScore),
  immersion_score: Math.round(localScore * 100) / 100,
  fatal_issues: dedupFatal,
  major_issues: dedupMajor,
  minor_issues: dedupMinor,
  checks: {},
  whether_30ep_allowed: dedupFatal.length === 0 ? "CONDITIONAL" : "NO",
  likely_root_cause: "(synthesis fallback — chunk data only)",
  suggested_fix_category: "state",
  confidence: 0.7,
};
let finalResult = { ...DEFAULT_RESULT };
if (eStatus !== 200) {
  console.error(`  ✗ synthesis HTTP ${eStatus} — using chunk fallback`);
} else {
  const parsed = parseGeminiJSON(eBody);
  if (parsed._parse_error) {
    console.error(`  ⚠ synthesis parse error: ${parsed._parse_error} — using chunk fallback`);
  } else {
    // Use synthesis result but merge with chunk fallback for missing fields
    const synthFinal = parsed.fatal_issues?.length ? parsed : DEFAULT_RESULT;
    finalResult = {
      ...DEFAULT_RESULT,
      ...synthFinal,
      whether_30ep_allowed: (synthFinal.whether_30ep_allowed ?? DEFAULT_RESULT.whether_30ep_allowed),
      checks: synthFinal.checks ?? {},
      confidence: synthFinal.confidence ?? 0.85,
    };
    console.log(`  ✓ synthesis: verdict=${finalResult.verdict} score=${finalResult.immersion_score} 30ep=${finalResult.whether_30ep_allowed}${parsed._truncated ? " ⚡ truncated" : ""}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Output Report
// ═══════════════════════════════════════════════════════════════════
const fi = (finalResult.fatal_issues ?? []).length;
const mi = (finalResult.major_issues ?? []).length;
const ni = (finalResult.minor_issues ?? []).length;

console.log(`\n${"═".repeat(W)}`);
console.log(` [Gemini Full-DB Reader Immersion Audit] — 최종 보고`);
console.log("═".repeat(W));

console.log(`\n 1. Gemini 호출 증거`);
console.log(`    모델: ${MODEL}`);
console.log(`    총 호출 횟수: ${geminiCallCount}회 (chunk 5개)`);
console.log(`    총 입력 크기: ${(totalInputChars / 1000).toFixed(1)}K chars`);
console.log(`    API key 노출: 없음`);

console.log(`\n 2. 읽은 DB 데이터`);
console.log(`    episodes: ${episodes.length}화 (full content)`);
console.log(`    character_dynamic_states: ${dynamicStates.length}건`);
console.log(`    canonical_characters: ${canonChars.length}명`);
console.log(`    run_traces: ${traces.length}건 (planner/renderer/reward)`);
console.log(`    foreshadows: ${foreshadows.length}건`);
console.log(`    arc_summaries: ${arcSummaries.length}건`);
console.log(`    character_arcs: ${charArcs.length}건`);
console.log(`    episode_snapshots: ${snapshots.length}건`);
console.log(`    world_rules: ${worldRules.length}건`);

console.log(`\n 3. 이전 120자 요약 감사 대비`);
console.log(`    이전 입력: ~120자/화 × ${episodes.length}화 = ~${120 * episodes.length}자`);
console.log(`    이번 입력: ~${(totalInputChars / 1000).toFixed(1)}K chars (${Math.round(totalInputChars / (120 * episodes.length))}배)`);

console.log(`\n 4. Full-DB Gemini Verdict`);
console.log(`    verdict: ${finalResult.verdict}`);
console.log(`    immersion_score: ${finalResult.immersion_score}`);
console.log(`    fatal: ${fi}  major: ${mi}  minor: ${ni}`);
console.log(`    whether_30ep_allowed: ${finalResult.whether_30ep_allowed}`);
console.log(`    confidence: ${finalResult.confidence}`);
console.log(`    root_cause: ${finalResult.likely_root_cause ?? "-"}`);
console.log(`    fix_category: ${finalResult.suggested_fix_category ?? "-"}`);

if (fi > 0) {
  console.log(`\n 🔴 Fatal Issues:`);
  for (const iss of finalResult.fatal_issues ?? []) {
    console.log(`    ep${iss.episode} [${iss.category}]: ${iss.evidence?.slice(0, 80) ?? ""}`);
    console.log(`      → ${iss.why_immersion_breaks?.slice(0, 100) ?? ""}`);
  }
}
if (mi > 0) {
  console.log(`\n 🟡 Major Issues:`);
  for (const iss of finalResult.major_issues ?? []) {
    console.log(`    ep${iss.episode} [${iss.category}]: ${iss.evidence?.slice(0, 80) ?? ""}`);
  }
}

console.log(`\n 5. checks:`);
for (const [k, v] of Object.entries(finalResult.checks ?? {})) {
  const icon = v === "PASS" ? "✅" : v === "WARN" ? "⚠️ " : "❌";
  console.log(`    ${icon} ${k}: ${v}`);
}

const verdictIcon = { "PASS": "✅", "CONDITIONAL PASS": "✅", "WARN": "⚠️", "FAIL": "❌" }[finalResult.verdict] ?? "❓";
console.log(`\n 6. 결론`);
console.log(`    ${verdictIcon} Full-DB Gemini verdict: ${finalResult.verdict}`);
console.log(`    30화 actual 가능: ${finalResult.whether_30ep_allowed}`);
if (fi === 0 && (finalResult.verdict === "PASS" || finalResult.verdict === "CONDITIONAL PASS")) {
  console.log(`    → Phase 4.8 READY 유지. clean 30화 actual 진행 가능.`);
} else if (fi > 0) {
  console.log(`    → fatal issue ${fi}건 수정 필요. 30화 진행 전 hotfix 검토.`);
} else {
  console.log(`    → 주의 이슈 있음. 판단은 사장 결정.`);
}

console.log("\n" + "═".repeat(W) + "\n");
