/**
 * audit_story_integrity_30.mjs — 30화 통합 구조 감사
 *
 * 사용법: node scripts/audit_story_integrity_30.mjs --book-id <book_id>
 *
 * 검사 항목:
 * A. Alias — non-canonical dynamic rows, descriptive mention DB 저장
 * B. State — character_dynamic_states rows 누락, 영어/외국어 오염
 * C. Item/Location — item drift, condition-in-name, skill-like, canonical missing
 * D. Episode Delta — 반복 패턴, 개방형 유사도, delta contract 생성률
 * E. Memory — rolling_summary, arc_summary, character_arcs, foreshadow
 * F. Finalization — 30화 finalization 활성, 중심 갈등 회수
 */

import pg from "pg";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const bidIdx  = args.indexOf("--book-id");
const BOOK_ID = bidIdx !== -1 ? args[bidIdx + 1] : null;

if (!BOOK_ID) {
  console.error("Usage: node scripts/audit_story_integrity_30.mjs --book-id <book_id>");
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────
const SKILL_KW = ["스킬", "능력", "특성", "패시브", "Lv.", "레벨", "skill", "ability", "passive"];
function isSkillLike(n) {
  if (!n) return false;
  return SKILL_KW.some(k => n.includes(k)) ||
    /고유\s*(스킬|능력|특성)/.test(n) ||
    /[가-힣]+\s*(스킬|능력|이능|기술)$/.test(n);
}
function hasConditionInName(n) {
  if (!n) return false;
  return /[（(][^）)]+[）)]$/.test(n) ||
    /^(방전된?|파손된?|손상된?|고장난?|낡은|소진된?|분실된?)\s+/.test(n);
}
function isEnglish(s) {
  return s && /^[a-zA-Z]/.test(s);
}
function bigram(a, b) {
  const ngrams = s => {
    const chars = [...(s ?? "").replace(/\s+/g, "")];
    const set = new Set();
    for (let i = 0; i < chars.length - 1; i++) set.add(chars[i] + chars[i + 1]);
    return set;
  };
  const sa = ngrams(a), sb = ngrams(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  return (2 * inter) / (sa.size + sb.size);
}

const REPEAT_PATTERNS = [
  { re: /의식을?\s*(잃|잃어|상실)/, label: "의식 상실" },
  { re: /기절/, label: "기절" },
  { re: /쓰러|쓰러짐/, label: "쓰러짐" },
  { re: /처음\s*(만|발견|알게)/, label: "처음 만남" },
  { re: /다시\s*(처음|새롭게)/, label: "다시 처음" },
];

function section(title) {
  console.log(`\n${"─".repeat(65)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(65)}`);
}

async function main() {
  const bookRes = await pool.query("SELECT title FROM books WHERE id=$1", [BOOK_ID]);
  const title   = bookRes.rows[0]?.title ?? BOOK_ID;

  console.log(`\n${"═".repeat(65)}`);
  console.log(`30화 통합 구조 감사`);
  console.log(`book_id: ${BOOK_ID}`);
  console.log(`title:   ${title}`);
  console.log(`${"═".repeat(65)}`);

  // ── canonical 인물 ──
  const canonRes = await pool.query(
    "SELECT name, initial_items FROM canonical_characters WHERE book_id=$1 ORDER BY name",
    [BOOK_ID]
  );
  const canonMap = {};
  for (const r of canonRes.rows) {
    const items = Array.isArray(r.initial_items) ? r.initial_items
      : (typeof r.initial_items === "string" ? JSON.parse(r.initial_items) : []);
    canonMap[r.name] = items;
  }
  const canonNames = Object.keys(canonMap);
  console.log(`canonical: [${canonNames.join(", ")}]`);

  // ── episodes ──
  const epRes = await pool.query(
    "SELECT episode_number, content, summary FROM episodes WHERE book_id=$1 ORDER BY episode_number",
    [BOOK_ID]
  );
  const episodes = epRes.rows;
  const epCount  = episodes.length;
  console.log(`episodes generated: ${epCount}`);

  // ── dynamic states ──
  const dynRes = await pool.query(
    `SELECT episode_number, character_name, items, location, emotional_state, recent_goal
     FROM character_dynamic_states WHERE book_id=$1 ORDER BY episode_number, character_name`,
    [BOOK_ID]
  );
  const dynRows = dynRes.rows;

  // ── A. Alias ─────────────────────────────────────────────
  section("A. Alias");
  const nonCanon = dynRows.filter(r => !canonNames.includes(r.character_name));
  console.log(`  non-canonical dynamic rows: ${nonCanon.length}  ${nonCanon.length === 0 ? "✅" : "❌"}`);
  if (nonCanon.length > 0) {
    const samples = nonCanon.slice(0, 5).map(r => `ep${r.episode_number}:"${r.character_name}"`);
    console.log(`  samples: ${samples.join(" | ")}`);
  }

  const arcRes = await pool.query(
    "SELECT character_name FROM character_arcs WHERE book_id=$1",
    [BOOK_ID]
  );
  const arcNonCanon = arcRes.rows.filter(r => !canonNames.includes(r.character_name));
  console.log(`  character_arcs non-canonical: ${arcNonCanon.length}  ${arcNonCanon.length === 0 ? "✅" : "⚠️"}`);

  // ── B. State ──────────────────────────────────────────────
  section("B. State Completeness");

  const epGroups = {};
  for (const r of dynRows) {
    const ep = r.episode_number;
    if (!epGroups[ep]) epGroups[ep] = [];
    epGroups[ep].push(r);
  }

  let rowsMissingEps = 0;
  let englishStateCount = 0;
  let englishGoalCount  = 0;
  const rowsMissingDetail = [];

  for (let ep = 1; ep <= epCount; ep++) {
    const rows = epGroups[ep] ?? [];
    const present = new Set(rows.map(r => r.character_name));
    const missing = canonNames.filter(n => !present.has(n));
    if (missing.length > 0) {
      rowsMissingEps++;
      rowsMissingDetail.push(`ep${ep}:[${missing.join(",")}]`);
    }
    for (const r of rows) {
      if (isEnglish(r.emotional_state)) englishStateCount++;
      if (isEnglish(r.recent_goal))     englishGoalCount++;
    }
  }

  console.log(`  rows=0 episodes: ${rowsMissingEps}  ${rowsMissingEps === 0 ? "✅" : "❌"}`);
  if (rowsMissingDetail.length > 0)
    console.log(`  detail: ${rowsMissingDetail.slice(0, 5).join(" | ")}`);
  console.log(`  English emotional_state: ${englishStateCount}  ${englishStateCount === 0 ? "✅" : "❌"}`);
  console.log(`  English recent_goal:     ${englishGoalCount}  ${englishGoalCount  === 0 ? "✅" : "❌"}`);

  // ── C. Item/Location ──────────────────────────────────────
  section("C. Item/Location Ledger");

  let totalSkill = 0, totalCondInName = 0, totalDrift = 0;
  let totalMissingCanon = 0, totalEnglishLoc = 0;

  for (const r of dynRows) {
    const items = Array.isArray(r.items) ? r.items
      : (typeof r.items === "string" ? JSON.parse(r.items || "[]") : []);
    const charCanon = canonMap[r.character_name] ?? [];
    const itemNames = items.map(i => typeof i === "string" ? i : i?.name).filter(Boolean);

    for (const item of items) {
      const name = typeof item === "string" ? item : item?.name ?? "";
      if (!name) continue;
      if (isSkillLike(name))       totalSkill++;
      if (hasConditionInName(name)) totalCondInName++;
      if (charCanon.some(ci => {
        const cl = ci.name.toLowerCase(), nl = name.toLowerCase();
        return cl !== nl && (cl.includes(nl) || nl.includes(cl)) && nl.length > 2 && cl.length > 2;
      })) totalDrift++;
    }

    for (const ci of charCanon) {
      const found = itemNames.some(n => {
        const nl = n.toLowerCase(), cl = ci.name.toLowerCase();
        return nl === cl || nl.includes(cl) || cl.includes(nl);
      });
      if (!found) totalMissingCanon++;
    }

    if (isEnglish(r.location)) totalEnglishLoc++;
  }

  console.log(`  skill-like items:        ${totalSkill}  ${totalSkill === 0 ? "✅" : "❌"}`);
  console.log(`  condition-in-name:       ${totalCondInName}  ${totalCondInName === 0 ? "✅" : "⚠️"}`);
  console.log(`  item name drift:         ${totalDrift}  ${totalDrift === 0 ? "✅" : "⚠️"}`);
  console.log(`  missing canonical items: ${totalMissingCanon}  ${totalMissingCanon === 0 ? "✅" : "⚠️"}`);
  console.log(`  English location:        ${totalEnglishLoc}  ${totalEnglishLoc === 0 ? "✅" : "❌"}`);

  // ── D. Episode Delta ──────────────────────────────────────
  section("D. Episode Delta Contract");

  let consecutiveRepeat = 0;
  let highSimilarityRuns = 0;
  let simRunLen = 0;
  const patternStreaks = {};

  for (let i = 1; i < episodes.length; i++) {
    const prev = episodes[i - 1];
    const curr = episodes[i];
    const prevText = (prev.content ?? "").slice(0, 300);
    const currText = (curr.content ?? "").slice(0, 300);

    const sim = bigram(prevText, currText);
    if (sim >= 0.4) {
      simRunLen++;
      if (simRunLen >= 2) highSimilarityRuns++;
    } else {
      simRunLen = 0;
    }

    for (const { re, label } of REPEAT_PATTERNS) {
      if (re.test(prev.content ?? "") && re.test(curr.content ?? "")) {
        patternStreaks[label] = (patternStreaks[label] ?? 0) + 1;
        if (patternStreaks[label] >= 2) consecutiveRepeat++;
      } else {
        patternStreaks[label] = 0;
      }
    }
  }

  // episode_delta_check는 planner_trace JSONB 내부에 저장됨
  const runTraceRes = await pool.query(
    `SELECT episode_number FROM run_traces WHERE book_id=$1 AND planner_trace IS NOT NULL`,
    [BOOK_ID]
  ).catch(() => ({ rows: [] }));
  const deltaEps     = runTraceRes.rows.length;
  const expectedDelta = Math.max(0, epCount - 1); // ep2+ 부터
  const deltaCoverage = expectedDelta > 0 ? Math.round(deltaEps / expectedDelta * 100) : 100;

  console.log(`  consecutive repeat patterns: ${consecutiveRepeat}  ${consecutiveRepeat === 0 ? "✅" : "⚠️"}`);
  console.log(`  high-similarity runs (≥2):   ${highSimilarityRuns}  ${highSimilarityRuns === 0 ? "✅" : "⚠️"}`);
  console.log(`  delta contract coverage:     ${deltaEps}/${expectedDelta} (${deltaCoverage}%)  ${deltaCoverage >= 80 ? "✅" : "⚠️"}`);

  // ── E. Memory ─────────────────────────────────────────────
  section("E. Memory Structure");

  const emptySummaries = episodes.filter(e => !e.summary || e.summary.trim().length < 10).length;
  console.log(`  rolling_summary empty: ${emptySummaries}/${epCount}  ${emptySummaries === 0 ? "✅" : "⚠️"}`);

  const arcSumRes = await pool.query(
    "SELECT DISTINCT arc_number FROM character_arcs WHERE book_id=$1",
    [BOOK_ID]
  ).catch(() => ({ rows: [] }));
  // arc_number: 1=ep1-10, 2=ep11-20, 3=ep21-30
  const arcNums = arcSumRes.rows.map(r => r.arc_number).sort((a, b) => a - b);
  const arcEnds = arcNums.map(n => n * 10);
  const expectedArcEnds = [10, 20, 30].filter(n => n <= epCount);
  const arcMissing = expectedArcEnds.filter(n => !arcEnds.includes(n));
  console.log(`  arc_summary at ep${expectedArcEnds.join("/")}:  ${arcMissing.length === 0 ? `✅ [arc ${arcNums.join(",")}]` : `⚠️ missing [${arcMissing.join(",")}]`}`);

  const foreshadowRes = await pool.query(
    "SELECT status FROM foreshadows WHERE book_id=$1",
    [BOOK_ID]
  ).catch(() => ({ rows: [] }));
  const foOpen     = foreshadowRes.rows.filter(r => r.status === "open").length;
  const foResolved = foreshadowRes.rows.filter(r => r.status === "resolved").length;
  const foTotal    = foreshadowRes.rows.length;
  console.log(`  foreshadow open/resolved: ${foOpen} open, ${foResolved} resolved, ${foTotal} total  ${foTotal > 0 ? "✅" : "⚠️"}`);

  // ── F. Finalization ───────────────────────────────────────
  section("F. Finalization (ep30)");

  if (epCount >= 30) {
    const finalEp = episodes.find(e => e.episode_number === 30);
    const finalText = finalEp?.content ?? "";
    const hasEnd    = /\[END\]|\[끝\]|─{3,}|제30화|끝\.?\s*$/.test(finalText);
    const hasResolution = finalText.length > 500;
    const endsWithNewConflict = /새로운\s*(갈등|위협|사건|문제)만/.test(finalText);

    console.log(`  ep30 generated:          ${finalEp ? "✅" : "❌"}`);
    console.log(`  finalization marker:     ${hasEnd ? "✅" : "⚠️ (END 마커 없음)"}`);
    console.log(`  sufficient length:       ${hasResolution ? "✅" : "⚠️"} (${finalText.length}자)`);
    console.log(`  ends in new conflict:    ${endsWithNewConflict ? "❌ (새 갈등만 생성)" : "✅"}`);
  } else {
    console.log(`  ep30 미생성 — skip`);
  }

  // ── PASS 기준 평가 ────────────────────────────────────────
  const criticalFails = [
    nonCanon.length > 0,
    rowsMissingEps > 0,
    englishStateCount > 0,
    englishGoalCount  > 0,
    totalSkill > 0,
    totalEnglishLoc > 0,
  ];
  const warnings = [
    totalCondInName > 0,
    totalDrift > 0,
    totalMissingCanon > 0,
    consecutiveRepeat > 0,
    highSimilarityRuns > 0,
    arcMissing.length > 0,
    foTotal === 0,
    emptySummaries > epCount * 0.1,
  ];

  const failCount = criticalFails.filter(Boolean).length;
  const warnCount = warnings.filter(Boolean).length;

  console.log(`\n${"═".repeat(65)}`);
  console.log("VERDICT");
  console.log(`${"─".repeat(65)}`);
  console.log(`Critical fails: ${failCount}  |  Warnings: ${warnCount}`);

  let verdict;
  if (failCount === 0 && warnCount <= 2) {
    verdict = "✅  PASS — 50화 actual 또는 Gemini 품질 감사로 진행 가능";
  } else if (failCount === 0) {
    verdict = "⚠️   CONDITIONAL PASS — 경고 항목 확인 후 Gemini 감사 진행";
  } else {
    verdict = `❌  NOT READY — ${failCount}개 critical 문제 해결 후 재검증`;
  }
  console.log(verdict);
  console.log(`${"═".repeat(65)}\n`);

  await pool.end();
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
