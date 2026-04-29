/**
 * run_alias_smoke_generation.mjs — Phase 2C clean alias smoke test 생성 실행
 *
 * test_alias_smoke_2C 테스트북으로 10화를 생성하고
 * 각 화 완료 후 character_dynamic_states를 확인한다.
 *
 * 사용법: node scripts/run_alias_smoke_generation.mjs [--episodes N]
 */

import pg from "pg";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BOOK_ID = "test_alias_smoke_2C";
const BASE_URL = "http://localhost:3000";

const args = process.argv.slice(2);
const epCountArg = args.indexOf("--episodes");
const TARGET_EPISODES = epCountArg !== -1 ? parseInt(args[epCountArg + 1] ?? "10") : 10;

// ── SSE 소비 헬퍼 ─────────────────────────────────────────────
async function generateEpisode(episode) {
  const res = await fetch(`${BASE_URL}/api/generate-v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      book_id:    BOOK_ID,
      episode,
      use_planner: true,
      validate:    false,
      revise:      false,
      enable_trace: false,
      gen_config: {
        totalEpisodes: 20,
        pov: "3인칭 관찰자",
        style: "묘사풍부",
        episodeLength: 900,
        episodeLengthVar: 200,
        conflict: 7,
        foreshadow: 8,
        emotion: 7,
        dialogue: 6,
        direction: 8,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  // SSE 소비
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let doneEvent = null;
  let charCount = 0;
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const obj = JSON.parse(line.slice(6));
        if (obj.error) throw new Error(obj.error);
        if (obj.token) charCount += obj.token.length;
        if (obj.done) { doneEvent = obj; }
      } catch {}
    }
  }
  return { charCount, doneEvent };
}

// ── DB 확인 ───────────────────────────────────────────────────
async function checkDynamicStates(episode) {
  const res = await pool.query(
    `SELECT DISTINCT character_name FROM character_dynamic_states
     WHERE book_id=$1 AND episode_number=$2 ORDER BY character_name`,
    [BOOK_ID, episode]
  );
  return res.rows.map(r => r.character_name);
}

async function getCanonicalNames() {
  const res = await pool.query(
    "SELECT name FROM canonical_characters WHERE book_id=$1 ORDER BY created_at",
    [BOOK_ID]
  );
  return res.rows.map(r => r.name);
}

// ── 묘사형 패턴 (entity_resolver와 동일 기준) ─────────────────
const GENERIC_NOUNS = new Set([
  "아이", "어린아이", "아기", "소년", "소녀", "청년",
  "남자", "여자", "남성", "여성", "사내", "여인",
  "노인", "누군가", "사람", "인물",
  "기사", "병사", "경비", "상인", "마법사",
  "목소리", "그림자", "존재", "형체", "형상", "그것", "무언가",
]);
const DESCRIPTIVE_PREFIXES = ["낯선", "검은", "붉은", "흰", "어린", "늙은", "그림자 속", "어둠 속", "수수께끼의", "정체불명의"];

function isDescriptive(name) {
  if (GENERIC_NOUNS.has(name)) return true;
  for (const p of DESCRIPTIVE_PREFIXES) if (name.startsWith(p)) return true;
  const tokens = name.split(/\s+/);
  if (tokens.length >= 2 && GENERIC_NOUNS.has(tokens[tokens.length - 1])) return true;
  return false;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Phase 2C Clean Alias Smoke — ${TARGET_EPISODES}화 생성`);
  console.log(`book_id: ${BOOK_ID}`);
  console.log(`${"═".repeat(60)}`);

  const canonicalNames = await getCanonicalNames();
  console.log(`\ncanonical: ${canonicalNames.join(", ")}`);

  const results = [];
  let totalNonCanonCount = 0;

  for (let ep = 1; ep <= TARGET_EPISODES; ep++) {
    process.stdout.write(`\n[ep${ep}] 생성 중...`);
    const t0 = Date.now();

    try {
      const { charCount, doneEvent } = await generateEpisode(ep);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const dynNames = await checkDynamicStates(ep);
      const nonCanon = dynNames.filter(n => !canonicalNames.includes(n));
      const descriptive = nonCanon.filter(isDescriptive);
      const possibleNew = nonCanon.filter(n => !isDescriptive(n));

      const status = nonCanon.length === 0 ? "✅ CLEAN" : `❌ NON-CANONICAL(${nonCanon.length})`;
      console.log(` ${status} — ${charCount}자, ${elapsed}s`);
      if (dynNames.length > 0) console.log(`   dynamic: [${dynNames.join(", ")}]`);
      if (nonCanon.length > 0) {
        console.log(`   ✗ non-canonical: [${nonCanon.join(", ")}]`);
        if (descriptive.length > 0) console.log(`     → descriptive: [${descriptive.join(", ")}]`);
        if (possibleNew.length > 0) console.log(`     → possible new: [${possibleNew.join(", ")}]`);
      }

      totalNonCanonCount += nonCanon.length;
      results.push({ ep, charCount, dynNames, nonCanon, descriptive, possibleNew, status: nonCanon.length === 0 ? "CLEAN" : "CONTAMINATED" });

    } catch (e) {
      console.log(` ❌ ERROR: ${e.message}`);
      results.push({ ep, error: e.message, status: "ERROR" });
    }
  }

  // ── 최종 집계 ─────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log("SUMMARY");
  console.log(`${"─".repeat(60)}`);

  const allDynNamesRes = await pool.query(
    "SELECT DISTINCT character_name FROM character_dynamic_states WHERE book_id=$1 ORDER BY character_name",
    [BOOK_ID]
  );
  const allDynNames = allDynNamesRes.rows.map(r => r.character_name);
  const allNonCanon = allDynNames.filter(n => !canonicalNames.includes(n));

  const arcRes = await pool.query(
    "SELECT DISTINCT character_name FROM character_arcs WHERE book_id=$1",
    [BOOK_ID]
  );
  const arcNames = arcRes.rows.map(r => r.character_name);
  const nonCanonArcs = arcNames.filter(n => !canonicalNames.includes(n));

  const epRowsRes = await pool.query(
    `SELECT episode_number, COUNT(*) as cnt
     FROM character_dynamic_states WHERE book_id=$1
     GROUP BY episode_number ORDER BY episode_number`,
    [BOOK_ID]
  );

  console.log(`\ncanonical names: [${canonicalNames.join(", ")}]`);
  console.log(`all dynamic names: [${allDynNames.join(", ")}]`);
  console.log(`non-canonical dynamic rows overall: ${allNonCanon.length === 0 ? "0 ✅" : `${allNonCanon.length} ❌ [${allNonCanon.join(", ")}]`}`);
  console.log(`character_arcs non-canonical: ${nonCanonArcs.length === 0 ? "0 ✅" : `❌ [${nonCanonArcs.join(", ")}]`}`);

  console.log(`\nepisode row counts:`);
  const missingEps = [];
  for (const r of epRowsRes.rows) {
    const tag = r.cnt > 0 ? "✓" : "✗";
    console.log(`  ep${r.episode_number}: ${r.cnt} rows [${tag}]`);
    if (r.cnt === 0) missingEps.push(r.episode_number);
  }

  const cleanEps = results.filter(r => r.status === "CLEAN").length;
  const contaminatedEps = results.filter(r => r.status === "CONTAMINATED").length;
  const errorEps = results.filter(r => r.status === "ERROR").length;

  console.log(`\nResults: ${cleanEps} clean / ${contaminatedEps} contaminated / ${errorEps} error`);
  console.log(`Total non-canonical cumulative: ${totalNonCanonCount}`);

  const overallPass = allNonCanon.length === 0 && nonCanonArcs.length === 0 && contaminatedEps === 0 && errorEps === 0;
  console.log(`\n${"─".repeat(60)}`);
  console.log(overallPass
    ? "✅  ALIAS SMOKE PASS — Phase 2 resolver working correctly"
    : "❌  ALIAS SMOKE FAIL — non-canonical names found in DB"
  );
  console.log(`${"═".repeat(60)}\n`);

  await pool.end();
  process.exit(overallPass ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
