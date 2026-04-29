/**
 * run_delta_smoke_3B.mjs — Phase 3B episode delta contract runtime 검증 생성
 *
 * 사용법: node scripts/run_delta_smoke_3B.mjs [--episodes N]
 *
 * 각 화 생성 후:
 * - episode_delta_contract 생성 여부
 * - episode_delta_check trace 결과
 * - character_dynamic_states rows
 * - alias contamination 여부
 * 를 DB + trace에서 확인한다.
 */

import pg from "pg";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BOOK_ID = "test_delta_smoke_3B";
const BASE_URL = "http://localhost:3000";

const args = process.argv.slice(2);
const epCountArg = args.indexOf("--episodes");
const TARGET_EPISODES = epCountArg !== -1 ? parseInt(args[epCountArg + 1] ?? "8") : 8;

// ── SSE 소비 ─────────────────────────────────────────────────────
async function generateEpisode(episode) {
  const res = await fetch(`${BASE_URL}/api/generate-v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      book_id: BOOK_ID,
      episode,
      use_planner: true,
      validate: false,
      revise: false,
      enable_trace: true,   // trace 활성화 — delta check 확인용
      gen_config: {
        totalEpisodes: 20,
        pov: "3인칭 관찰자",
        style: "묘사풍부",
        episodeLength: 900,
        episodeLengthVar: 200,
        conflict: 8,
        foreshadow: 7,
        emotion: 8,
        dialogue: 6,
        direction: 8,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let charCount = 0;
  let doneEvent = null;
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
        if (obj.done) { doneEvent = obj; if (obj.chars) charCount = obj.chars; }
      } catch {}
    }
  }
  return { charCount, doneEvent };
}

// ── DB 조회 ───────────────────────────────────────────────────────
async function getCanonicalNames() {
  const res = await pool.query(
    "SELECT name FROM canonical_characters WHERE book_id=$1 ORDER BY created_at",
    [BOOK_ID]
  );
  return res.rows.map(r => r.name);
}

async function getDynamicStates(episode) {
  const res = await pool.query(
    `SELECT DISTINCT character_name FROM character_dynamic_states
     WHERE book_id=$1 AND episode_number=$2 ORDER BY character_name`,
    [BOOK_ID, episode]
  );
  return res.rows.map(r => r.character_name);
}

async function getTraceInfo(episode) {
  try {
    const res = await pool.query(
      `SELECT planner_trace
       FROM run_traces
       WHERE book_id=$1 AND episode_number=$2
       ORDER BY created_at DESC LIMIT 1`,
      [BOOK_ID, episode]
    );
    if (!res.rows[0]) return null;
    const pt = res.rows[0].planner_trace;
    const plannerTrace = pt ? (typeof pt === "string" ? JSON.parse(pt) : pt) : null;
    return {
      input_contract: plannerTrace?.input_contract ?? {},
      episode_delta_check: plannerTrace?.episode_delta_check ?? null,
    };
  } catch {
    return null;
  }
}

async function getEpisodeContent(episode) {
  const res = await pool.query(
    "SELECT content FROM episodes WHERE book_id=$1 AND episode_number=$2",
    [BOOK_ID, episode]
  );
  return res.rows[0]?.content ?? "";
}

// ── 간단한 반복 패턴 감지 (audit_episode_delta.mjs와 동일 기준) ─
const REPEAT_PATTERNS = [
  { re: /의식을?\s*(잃|잃어|상실)/, label: "의식 상실" },
  { re: /기절/, label: "기절" },
  { re: /쓰러|쓰러짐/, label: "쓰러짐" },
  { re: /혼란|혼돈|혼수/, label: "혼란/혼수" },
  { re: /처음\s*(만|발견|알게)/, label: "처음 만남/발견" },
];

function bigramSim(a, b) {
  if (!a || !b) return 0;
  const ng = s => {
    const c = [...s.replace(/\s+/g, "")];
    const set = new Set();
    for (let i = 0; i < c.length - 1; i++) set.add(c[i] + c[i + 1]);
    return set;
  };
  const sa = ng(a), sb = ng(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  return (2 * inter) / (sa.size + sb.size);
}

// ── 메인 ─────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(65)}`);
  console.log(`Phase 3B Delta Smoke — ${TARGET_EPISODES}화 생성`);
  console.log(`book_id: ${BOOK_ID}`);
  console.log(`${"═".repeat(65)}`);

  const canonicalNames = await getCanonicalNames();
  console.log(`\ncanonical: ${canonicalNames.join(", ")}`);

  const results = [];
  const contentByEp = {};
  let totalNonCanon = 0;

  for (let ep = 1; ep <= TARGET_EPISODES; ep++) {
    process.stdout.write(`\n[ep${ep}] 생성 중...`);
    const t0 = Date.now();

    try {
      const { charCount } = await generateEpisode(ep);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      // DB 확인
      const dynNames = await getDynamicStates(ep);
      const nonCanon = dynNames.filter(n => !canonicalNames.includes(n));
      const content  = await getEpisodeContent(ep);
      contentByEp[ep] = content;
      totalNonCanon += nonCanon.length;

      // Trace 확인
      const trace = await getTraceInfo(ep);
      const ic  = trace?.input_contract ?? {};
      const hasDelta = ic.has_episode_delta_contract ?? false;
      const mustProgress = ic.delta_must_progress_count ?? 0;
      const mustNotRepeat = ic.delta_must_not_repeat_count ?? 0;
      const riskCount = ic.delta_repetition_risk_count ?? 0;
      const deltaCheck = trace?.episode_delta_check ?? null;

      // 반복 패턴 감지 (직전 화 tail과 이번 화 opening 비교)
      let simScore = 0;
      const prevContent = contentByEp[ep - 1] ?? "";
      if (prevContent) {
        simScore = bigramSim(prevContent.slice(-300), content.slice(0, 300));
      }
      const matchedPatterns = REPEAT_PATTERNS.filter(p => p.re.test(content)).map(p => p.label);

      const aliasTag = nonCanon.length === 0 ? "✅ alias OK" : `❌ non-canonical(${nonCanon.length})`;
      const deltaTag = ep >= 2 ? (hasDelta ? "✅ delta" : "❌ no delta") : "—(ep1)";
      const simTag   = simScore >= 0.4 ? `⚠️ sim=${(simScore*100).toFixed(0)}%` : `sim=${(simScore*100).toFixed(0)}%`;
      const checkTag = deltaCheck ? `delta_check=${deltaCheck.verdict}` : "no_check";

      console.log(` ${aliasTag} ${deltaTag} ${simTag} ${checkTag} — ${charCount}자, ${elapsed}s`);
      if (ep >= 2) {
        console.log(`   delta: progress=${mustProgress} norepeat=${mustNotRepeat} risk=${riskCount}`);
      }
      if (matchedPatterns.length) console.log(`   패턴: [${matchedPatterns.join(", ")}]`);
      if (nonCanon.length) console.log(`   non-canonical: [${nonCanon.join(", ")}]`);
      if (deltaCheck?.repeated_patterns?.length)
        console.log(`   repeated: ${deltaCheck.repeated_patterns.join(" / ")}`);

      results.push({
        ep, charCount, elapsed, dynNames, nonCanon,
        hasDelta, mustProgress, mustNotRepeat, riskCount,
        deltaCheck, simScore, matchedPatterns,
        status: nonCanon.length === 0 ? (hasDelta || ep === 1 ? "OK" : "NO_DELTA") : "ALIAS_FAIL",
      });

    } catch (e) {
      console.log(` ❌ ERROR: ${e.message}`);
      results.push({ ep, error: e.message, status: "ERROR" });
    }
  }

  // ── 최종 집계 ──────────────────────────────────────────────────
  console.log(`\n${"═".repeat(65)}`);
  console.log("SUMMARY");
  console.log(`${"─".repeat(65)}`);

  // alias 전체 확인
  const allDyn = await pool.query(
    "SELECT DISTINCT character_name FROM character_dynamic_states WHERE book_id=$1 ORDER BY character_name",
    [BOOK_ID]
  );
  const allDynNames = allDyn.rows.map(r => r.character_name);
  const allNonCanon = allDynNames.filter(n => !canonicalNames.includes(n));

  // 에피소드 row counts
  const epRows = await pool.query(
    `SELECT episode_number, COUNT(*) as cnt FROM character_dynamic_states
     WHERE book_id=$1 GROUP BY episode_number ORDER BY episode_number`,
    [BOOK_ID]
  );

  console.log(`\ncanonical: [${canonicalNames.join(", ")}]`);
  console.log(`all dynamic names: [${allDynNames.join(", ")}]`);
  console.log(`non-canonical overall: ${allNonCanon.length === 0 ? "0 ✅" : `❌ [${allNonCanon.join(", ")}]`}`);

  console.log(`\nepisode rows:`);
  for (const r of epRows.rows) {
    console.log(`  ep${r.episode_number}: ${r.cnt} rows ${r.cnt > 0 ? "✓" : "✗ MISSING"}`);
  }

  // delta contract 통계
  const ep2plus = results.filter(r => r.ep >= 2 && !r.error);
  const deltaGenRate = ep2plus.length > 0
    ? `${ep2plus.filter(r => r.hasDelta).length}/${ep2plus.length}`
    : "N/A";

  const warnEps = results.filter(r => r.deltaCheck?.verdict === "WARN");
  const highSimEps = results.filter(r => r.simScore >= 0.4);
  const repeatPatternEps = results.filter(r => r.matchedPatterns?.length > 0);

  console.log(`\ndelta contract 생성률 (ep2+): ${deltaGenRate}`);
  console.log(`delta_check WARN: ${warnEps.length}화 ${warnEps.map(r => `ep${r.ep}`).join(", ")}`);
  console.log(`opening similarity ≥40%: ${highSimEps.length}화 ${highSimEps.map(r => `ep${r.ep}(${(r.simScore*100).toFixed(0)}%)`).join(", ")}`);
  console.log(`반복 패턴 감지: ${repeatPatternEps.length}화`);
  for (const r of repeatPatternEps) {
    console.log(`  ep${r.ep}: [${r.matchedPatterns.join(", ")}]`);
  }

  // 연속 3화 같은 패턴 감지
  console.log(`\n연속 반복 패턴 분석:`);
  for (const { label, re } of REPEAT_PATTERNS.slice(0, 4)) {
    const matchEps = results.filter(r => r.matchedPatterns?.includes(label)).map(r => r.ep);
    if (matchEps.length >= 3) {
      // 연속 여부 확인
      let consecutive = 0;
      for (let i = 1; i < matchEps.length; i++) {
        if (matchEps[i] === matchEps[i - 1] + 1) consecutive++;
      }
      if (consecutive >= 2) {
        console.log(`  ❌ '${label}': ep${matchEps.join(",")} — 3화 이상 연속`);
      } else {
        console.log(`  ⚠️  '${label}': ep${matchEps.join(",")} — 비연속 반복 ${matchEps.length}회`);
      }
    } else if (matchEps.length > 0) {
      console.log(`  ✓  '${label}': ep${matchEps.join(",")} — ${matchEps.length}회 (허용 범위)`);
    }
  }

  const okEps = results.filter(r => r.status === "OK").length;
  const failEps = results.filter(r => r.status !== "OK" && !r.error).length;
  const errorEps = results.filter(r => r.error).length;

  const overallPass =
    allNonCanon.length === 0 &&
    ep2plus.every(r => r.hasDelta) &&
    highSimEps.length <= 1 &&
    errorEps === 0;

  console.log(`\n${"─".repeat(65)}`);
  console.log(`Results: ${okEps} OK / ${failEps} issue / ${errorEps} error`);
  console.log(overallPass
    ? "✅  PHASE 3B DELTA SMOKE PASS"
    : "⚠️   PHASE 3B DELTA SMOKE CONDITIONAL"
  );
  console.log(`${"═".repeat(65)}\n`);

  await pool.end();
  process.exit(overallPass ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
