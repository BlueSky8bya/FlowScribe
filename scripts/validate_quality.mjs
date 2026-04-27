/**
 * FlowScribe Quality Validation Script
 * Phase 0 → Phase 5 자동 실행
 */
import http from "http";
import { createHmac } from "crypto";
import { execSync } from "child_process";

// ── Config ─────────────────────────────────────────────────────
const BOOK_ID    = "ccbad484-94e6-45c4-b88e-403a6369420b";
const USER_ID    = "0720b196-e456-474e-85d1-f51473af9f68";
const JWT_SECRET = "asdflidjsfoieflkasdfaALKSDJFDdfDFdf452";
const BASE_URL   = "http://localhost:3000";
const TOTAL_EP   = 20;

// ── JWT 생성 (HS256, 직접 구현) ────────────────────────────────
function makeJwt(payload) {
  const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body    = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig     = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}
const TOKEN = makeJwt({ id: USER_ID, email: "blackspace665@gmail.com", iat: Math.floor(Date.now()/1000) });

// ── DB 쿼리 (docker exec) ──────────────────────────────────────
// 기본 dbq: 단순 값 조회용 (JSON/텍스트 컬럼 미포함)
function dbq(sql) {
  try {
    const raw = execSync(
      `docker exec flowscribe_postgres psql -U flowscribe -d flowscribe -t -A -F"|||" -c "${sql.replace(/"/g, '\\"')}"`,
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
    ).trim();
    return raw ? raw.split("\n").filter(r => r.trim()).map(r => r.split("|||")) : [];
  } catch { return []; }
}

// dbqJson: JSON/텍스트 컬럼 포함 쿼리 — SQL에서 개행 제거해 split 안전화
// 사용 규칙: SELECT replace(col::text, chr(10), ' '), ... 형태로 SQL 작성
function dbqJson(sql) {
  try {
    const raw = execSync(
      `docker exec flowscribe_postgres psql -U flowscribe -d flowscribe -t -A -F"|||" -c "${sql.replace(/"/g, '\\"')}"`,
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    ).trim();
    return raw ? raw.split("\n").filter(r => r.trim()).map(r => r.split("|||")) : [];
  } catch { return []; }
}

// ── SSE 생성 호출 ──────────────────────────────────────────────
function generateEpisode(episode, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const url = `/api/generate?use_planner=true&book_id=${BOOK_ID}&episode=${episode}`;
    const req = http.request({
      hostname: "localhost", port: 3000, path: url, method: "GET",
      headers: { Cookie: `fs_token=${TOKEN}`, Accept: "text/event-stream" },
    });
    let text = ""; let status = ""; let charStates = null; let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true; req.destroy();
      reject(new Error(`Timeout ep${episode}`));
    }, timeoutMs);

    req.on("response", (res) => {
      let buf = "";
      res.on("data", chunk => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.token)      text += d.token;
            if (d.status)     status = d.status;
            if (d.char_states) charStates = d.char_states;
            if (d.done) {
              clearTimeout(timer);
              resolve({ text: text.trim(), charStates, lastStatus: status });
            }
          } catch {}
        }
      });
      res.on("end", () => {
        if (!timedOut) { clearTimeout(timer); resolve({ text: text.trim(), charStates, lastStatus: status }); }
      });
    });
    req.on("error", e => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

// ── 분석 유틸 ──────────────────────────────────────────────────
const FIXED_PATTERNS = ["낯선 숲에서 깨어", "기억을 잃", "기억이 나지", "짐승의 울음", "눈을 뜨", "의식을 잃", "바닥에 쓰러"];
const LANG_POLLUTION = /[Ѐ-ӿ؀-ۿ぀-ヿ一-鿿]/;
const SPECIAL_CHARS  = /[◉◆◇■□●○▶▷◀◁★☆]/;
const QUOTE_OPEN     = /“/g;  // "
const QUOTE_CLOSE    = /”/g;  // "

function analyzeText(text) {
  const openCount  = (text.match(QUOTE_OPEN)  || []).length;
  const closeCount = (text.match(QUOTE_CLOSE) || []).length;
  return {
    length:          text.length,
    lang_pollution:  LANG_POLLUTION.test(text),
    special_chars:   SPECIAL_CHARS.test(text),
    quote_mismatch:  Math.abs(openCount - closeCount),
    has_end:         text.includes("[END]"),
    has_cliff:       text.includes("[CLIFF]"),
    pov_violation:   /나는\s|나도\s|내가\s/.test(text) && !/["'"]/g.test(text.slice(0,5)),
  };
}

function getLatestTrace(episode) {
  const rows = dbqJson(
    `SELECT replace(planner_trace::text, chr(10), ' '), replace(renderer_trace::text, chr(10), ' ') FROM run_traces ` +
    `WHERE book_id='${BOOK_ID}' AND episode_number=${episode} ` +
    `ORDER BY created_at DESC LIMIT 1`
  );
  if (!rows.length || !rows[0][0]) return null;
  try { return { planner: JSON.parse(rows[0][0]), renderer: JSON.parse(rows[0][1] || "{}") }; }
  catch { return null; }
}

function getTracesForEp(episode, limit = 10) {
  const rows = dbqJson(
    `SELECT replace(planner_trace::text, chr(10), ' ') FROM run_traces ` +
    `WHERE book_id='${BOOK_ID}' AND episode_number=${episode} ` +
    `ORDER BY created_at DESC LIMIT ${limit}`
  );
  return rows.map(r => { try { return JSON.parse(r[0]); } catch { return null; } }).filter(Boolean);
}

function checkBeatDiversity(traces) {
  const beat1Summaries = traces
    .map(t => t?.parsed_plan?.scene_beats?.[0]?.summary?.slice(0,30) || "")
    .filter(Boolean);
  const hookTypes = traces.map(t => t?.parsed_plan?.hook_type || "").filter(Boolean);
  const locations = traces.map(t => t?.parsed_plan?.scene_beats?.[0]?.location || "").filter(Boolean);

  const fixedCount = beat1Summaries.filter(s => FIXED_PATTERNS.some(p => s.includes(p))).length;
  const uniqueBeats = new Set(beat1Summaries).size;
  const uniqueHooks = new Set(hookTypes).size;
  const uniqueLocs  = new Set(locations).size;

  // 연속 동일 hook 체크
  let maxConsecHook = 1, cur = 1;
  for (let i = 1; i < hookTypes.length; i++) {
    cur = hookTypes[i] === hookTypes[i-1] ? cur+1 : 1;
    maxConsecHook = Math.max(maxConsecHook, cur);
  }

  return {
    total:           traces.length,
    beat1_fixed_cnt: fixedCount,
    beat1_fixed_pct: traces.length ? Math.round(fixedCount/traces.length*100) : 0,
    unique_beat1:    uniqueBeats,
    unique_hooks:    uniqueHooks,
    unique_locs:     uniqueLocs,
    max_consec_hook: maxConsecHook,
    hook_types:      hookTypes,
    beat1_summaries: beat1Summaries,
  };
}

function checkAlignment(trace) {
  if (!trace) return { score: 0, issues: ["no_trace"] };
  const plan = trace.planner?.parsed_plan;
  const text = trace.renderer?.generated_text || trace.renderer?.text || "";
  if (!plan || !text) return { score: 0, issues: ["missing_plan_or_text"] };

  const issues = [];
  let score = 100;

  // Beat 커버리지
  const beats = plan.scene_beats || [];
  let coveredBeats = 0;
  for (const b of beats) {
    const kws = [b.location, ...(b.characters_involved || [])].filter(Boolean);
    const hit = kws.some(k => text.includes(k));
    if (hit) coveredBeats++;
    else issues.push(`beat${b.beat_number}_missing:${b.location}`);
  }
  const beatCov = beats.length ? coveredBeats/beats.length : 1;
  if (beatCov < 0.8) { score -= 30; issues.push(`beat_coverage:${Math.round(beatCov*100)}%`); }

  // carryover must_appear_in_opening
  const opening = text.slice(0, 400);
  for (const co of plan.carryover_effects || []) {
    if (co.must_appear_in_opening) {
      const kw = co.character_name;
      if (!opening.includes(kw)) { score -= 15; issues.push(`carryover_missing:${kw}`); }
    }
  }

  // hook_concrete_event in last 300 chars
  const tail = text.slice(-300);
  const hookEvent = plan.hook_concrete_event || "";
  if (hookEvent) {
    const hookKws = hookEvent.split(/[\s,。.!?]+/).filter(w => w.length > 2).slice(0, 4);
    const hookHit = hookKws.filter(k => tail.includes(k)).length / (hookKws.length || 1);
    if (hookHit < 0.5) { score -= 20; issues.push(`hook_event_coverage:${Math.round(hookHit*100)}%`); }
  }

  return { score: Math.max(0, score), beatCoverage: Math.round(beatCov*100), issues };
}

function checkContinuity(ep1Content, ep2Content) {
  if (!ep1Content || !ep2Content) return { score: 0, issues: ["missing_content"] };
  const tail = ep1Content.slice(-200);
  const head = ep2Content.slice(0, 200);
  const issues = [];
  let score = 100;

  // 위치 연속성: tail에 등장한 장소어가 head에도 있는지
  const locWords = ["숲", "마을", "성", "동굴", "길", "광장", "방", "여관", "전장"];
  const tailLocs = locWords.filter(w => tail.includes(w));
  const headLocs = locWords.filter(w => head.includes(w));
  const locCont = tailLocs.length ? tailLocs.filter(w => headLocs.includes(w)).length / tailLocs.length : 1;
  if (locCont < 0.3) { score -= 25; issues.push("location_break"); }

  // 어조 연속성: ep2가 "기억을 잃었다", "눈을 뜨" 등 새 시작 패턴으로 시작하는지
  const freshStart = FIXED_PATTERNS.some(p => head.includes(p));
  if (freshStart) { score -= 30; issues.push("fresh_start_detected"); }

  // 인물 연속성: tail에 나온 이름이 head에도 등장
  const names = ["빅토리", "리아", "브론", "카이렌"];
  const tailNames = names.filter(n => tail.includes(n));
  const headNames = names.filter(n => head.includes(n));
  if (tailNames.length && !tailNames.some(n => headNames.includes(n))) {
    score -= 20; issues.push("character_break");
  }

  return { score: Math.max(0, score), issues };
}

function checkCharStates(episode) {
  const rows = dbq(
    `SELECT character_name, items, physical_state, emotional_state, location ` +
    `FROM character_dynamic_states ` +
    `WHERE book_id='${BOOK_ID}' AND episode_number=${episode} ` +
    `ORDER BY character_name`
  );
  return rows.map(r => ({
    name:     r[0],
    items:    (() => { try { return JSON.parse(r[1]||"[]"); } catch { return []; } })(),
    physical: r[2],
    emotion:  r[3],
    location: r[4],
  }));
}

function getEpContent(episode) {
  // chr(10) → chr(32) : 본문 내 개행을 공백으로 치환해 split 안전화 (연속성 검사 영향 없음)
  const rows = dbqJson(
    `SELECT replace(content, chr(10), chr(32)), length(content) FROM episodes ` +
    `WHERE book_id='${BOOK_ID}' AND episode_number=${episode}`
  );
  if (!rows[0]?.[0]) return null;
  return rows[0][0];
}

// ── 로그 ──────────────────────────────────────────────────────
const LOG = [];
const BUGS = [];
function log(msg) { const t = new Date().toISOString().slice(11,19); console.log(`[${t}] ${msg}`); LOG.push(msg); }
function bug(severity, phase, issue, cause, fix) {
  BUGS.push({ severity, phase, issue, cause, fix });
  log(`  [${severity}] BUG: ${issue}`);
}

// ── Phase 0: Preflight Gate ─────────────────────────────────────
async function runPreflight() {
  log("=== PHASE 0: PREFLIGHT GATE ===");

  // ep1 초기화 — 기존 traces 수 기록
  const ep1TraceBefore = dbq(`SELECT COUNT(*) FROM run_traces WHERE book_id='${BOOK_ID}' AND episode_number=1`);
  log(`ep1 existing traces: ${ep1TraceBefore[0]?.[0]}`);

  const pf = { ep1: [], ep2: [], ep3: null, passed: true, failReasons: [] };

  // ep1 3회 재생성
  for (let i = 1; i <= 3; i++) {
    log(`Preflight: generating ep1 attempt ${i}/3...`);
    try {
      const r = await generateEpisode(1);
      const analysis = analyzeText(r.text);
      const trace = getLatestTrace(1);
      const align = checkAlignment(trace);
      pf.ep1.push({ attempt: i, length: analysis.length, ...analysis, align });
      log(`  ep1[${i}] len=${analysis.length} quote_err=${analysis.quote_mismatch} align=${align.score} lang_ok=${!analysis.lang_pollution}`);
      if (analysis.lang_pollution) bug("P0","preflight","lang_pollution_ep1","renderer output contains non-Korean","check LLM lang constraint");
      if (analysis.special_chars)  bug("P2","preflight","special_chars_ep1","renderer not stripping symbols","add post-process filter");
    } catch(e) { log(`  ep1[${i}] ERROR: ${e.message}`); pf.failReasons.push(`ep1[${i}]: ${e.message}`); }
    await new Promise(r => setTimeout(r, 2000));
  }

  // ep1 다양성 체크
  const ep1Traces = getTracesForEp(1, 6);
  const ep1Div = checkBeatDiversity(ep1Traces);
  log(`ep1 diversity: fixed_beat1=${ep1Div.beat1_fixed_pct}% unique_hooks=${ep1Div.unique_hooks}/${ep1Div.total} max_consec_hook=${ep1Div.max_consec_hook}`);
  log(`  beat1 summaries: ${ep1Div.beat1_summaries.join(" | ")}`);
  log(`  hooks: ${ep1Div.hook_types.join(", ")}`);

  if (ep1Div.beat1_fixed_pct > 60) {
    pf.passed = false;
    pf.failReasons.push(`beat1 fixation ${ep1Div.beat1_fixed_pct}% > 60%`);
    bug("P1","preflight","beat1_fixation",`${ep1Div.beat1_fixed_pct}% of ep1 beat1 matches fixed patterns`,"strengthen regen_prev_text injection + add beat1 forbidden list");
  }
  if (ep1Div.max_consec_hook >= 3) {
    pf.passed = false; pf.failReasons.push(`hook_type 3 consecutive identical`);
    bug("P1","preflight","hook_type_fixation","hook_type repeats 3+ times consecutively","add hook diversity enforcement in planner prompt");
  }

  // ep2 2회
  for (let i = 1; i <= 2; i++) {
    log(`Preflight: generating ep2 attempt ${i}/2...`);
    try {
      const r = await generateEpisode(2);
      const analysis = analyzeText(r.text);
      const trace = getLatestTrace(2);
      const align = checkAlignment(trace);
      const ep1c = getEpContent(1);
      const ep2c = getEpContent(2);
      const cont = checkContinuity(ep1c, ep2c);
      pf.ep2.push({ attempt: i, length: analysis.length, ...analysis, align, continuity: cont });
      log(`  ep2[${i}] len=${analysis.length} align=${align.score} continuity=${cont.score} issues=${cont.issues.join(",")}`);
      if (cont.issues.includes("fresh_start_detected")) bug("P1","preflight","ep2_fresh_start","ep2 starts like a new story despite prev_tail","check prev_tail injection and opening forbidden patterns");
    } catch(e) { log(`  ep2[${i}] ERROR: ${e.message}`); }
    await new Promise(r => setTimeout(r, 2000));
  }

  // ep3 1회
  log("Preflight: generating ep3...");
  try {
    const r = await generateEpisode(3);
    const analysis = analyzeText(r.text);
    const trace = getLatestTrace(3);
    const align = checkAlignment(trace);
    const ep2c = getEpContent(2); const ep3c = getEpContent(3);
    const cont = checkContinuity(ep2c, ep3c);
    pf.ep3 = { length: analysis.length, ...analysis, align, continuity: cont };
    log(`  ep3 len=${analysis.length} align=${align.score} continuity=${cont.score}`);
  } catch(e) { log(`  ep3 ERROR: ${e.message}`); pf.failReasons.push(`ep3: ${e.message}`); }

  // char states 확인
  const cs = checkCharStates(1);
  log(`char_states ep1: ${cs.map(c => `${c.name}(items=${c.items.length},phys=${c.physical||'?'})`).join(" ")}`);
  if (cs.length === 0) { pf.passed = false; pf.failReasons.push("char_states empty"); bug("P0","preflight","char_states_empty","no dynamic states committed for ep1","check commitDynamicState in pipeline/index.ts"); }

  pf.ep1Diversity = ep1Div;
  log(`\nPreflight Gate: ${pf.passed ? "PASSED ✓" : "FAILED ✗"}`);
  if (!pf.passed) log(`  Reasons: ${pf.failReasons.join("; ")}`);
  return pf;
}

// ── Phase 1: Diversity Baseline ─────────────────────────────────
async function runDiversityBaseline(skipIfPreflightFailed) {
  log("\n=== PHASE 1: DIVERSITY BASELINE ===");
  if (skipIfPreflightFailed) { log("  SKIPPED (preflight failed)"); return null; }

  const results = { ep1: [], ep2: [] };

  // ep1 5회 재생성
  for (let i = 1; i <= 5; i++) {
    log(`Phase1: ep1 regen ${i}/5...`);
    try {
      const r = await generateEpisode(1);
      const analysis = analyzeText(r.text);
      const trace = getLatestTrace(1);
      const align = checkAlignment(trace);
      results.ep1.push({ attempt: i, length: analysis.length, ...analysis, align,
        beat1: trace?.planner?.parsed_plan?.scene_beats?.[0]?.summary?.slice(0,40),
        hook: trace?.planner?.parsed_plan?.hook_type,
        loc: trace?.planner?.parsed_plan?.scene_beats?.[0]?.location,
      });
      log(`  ep1[${i}] beat1="${results.ep1[i-1].beat1}" hook=${results.ep1[i-1].hook} loc=${results.ep1[i-1].loc} align=${align.score}`);
    } catch(e) { log(`  ep1[${i}] ERROR: ${e.message}`); }
    await new Promise(r => setTimeout(r, 2000));
  }

  // ep2 3회 재생성
  for (let i = 1; i <= 3; i++) {
    log(`Phase1: ep2 regen ${i}/3...`);
    try {
      const r = await generateEpisode(2);
      const analysis = analyzeText(r.text);
      const trace = getLatestTrace(2);
      const align = checkAlignment(trace);
      const ep1c = getEpContent(1); const ep2c = getEpContent(2);
      const cont = checkContinuity(ep1c, ep2c);
      results.ep2.push({ attempt: i, length: analysis.length, align, continuity: cont,
        beat1: trace?.planner?.parsed_plan?.scene_beats?.[0]?.summary?.slice(0,40),
        hook: trace?.planner?.parsed_plan?.hook_type,
      });
      log(`  ep2[${i}] beat1="${results.ep2[i-1].beat1}" continuity=${cont.score} align=${align.score}`);
    } catch(e) { log(`  ep2[${i}] ERROR: ${e.message}`); }
    await new Promise(r => setTimeout(r, 2000));
  }

  // 다양성 집계
  const allEp1Traces = getTracesForEp(1, 8);
  const div = checkBeatDiversity(allEp1Traces);
  log(`\nPhase1 ep1 diversity summary:`);
  log(`  beat1_fixed: ${div.beat1_fixed_pct}% | unique_beat1: ${div.unique_beat1} | unique_hooks: ${div.unique_hooks} | max_consec_hook: ${div.max_consec_hook}`);

  if (div.beat1_fixed_pct > 60) bug("P1","phase1","beat1_high_fixation",`${div.beat1_fixed_pct}% fixed beats even after 8 samples`,"planner: beat1 pattern forbidden list must be expanded");
  if (div.unique_hooks < 3) bug("P1","phase1","hook_low_variety",`only ${div.unique_hooks} unique hook types in 8 samples`,"planner hook guide must be reinforced");

  // Best ep1 선택 기준
  const scored = results.ep1.map((r,i) => ({
    ...r,
    score: (r.align?.score||0)*0.4
      + (r.length > 800 && r.length < 2000 ? 20 : 0)
      + (r.quote_mismatch === 0 ? 15 : 0)
      + (!r.lang_pollution ? 15 : 0)
      + (!r.special_chars ? 10 : 0)
  }));
  scored.sort((a,b) => b.score - a.score);
  log(`Best ep1 candidate: attempt ${scored[0]?.attempt} score=${scored[0]?.score.toFixed(1)}`);

  return { results, diversity: div };
}

// ── Phase 2: Early Continuity ep2~ep5 ──────────────────────────
async function runEarlyContinuity() {
  log("\n=== PHASE 2: EARLY CONTINUITY (ep2~ep5) ===");
  const contScores = [];

  for (let ep = 2; ep <= 5; ep++) {
    log(`Phase2: generating ep${ep}...`);
    try {
      await generateEpisode(ep);
      const prev = getEpContent(ep-1);
      const curr = getEpContent(ep);
      const cont = checkContinuity(prev, curr);
      const trace = getLatestTrace(ep);
      const align = checkAlignment(trace);
      const cs = checkCharStates(ep);
      contScores.push({ ep, continuity: cont.score, alignment: align.score, char_count: cs.length });
      log(`  ep${ep}: continuity=${cont.score} align=${align.score} char_states=${cs.length} issues=${cont.issues.join(",")}`);
      if (cont.score < 60) bug("P1","phase2",`ep${ep}_continuity_fail`,`continuity score ${cont.score}<60: ${cont.issues.join(",")}`, "check prev_tail injection + carryover_effects");
      if (align.score < 60) bug("P1","phase2",`ep${ep}_alignment_fail`,`alignment ${align.score}<60: ${align.issues?.join(",")}`, "check planner beat vs renderer output");
    } catch(e) { log(`  ep${ep} ERROR: ${e.message}`); }
    await new Promise(r => setTimeout(r, 2000));
  }

  const avgCont = contScores.reduce((s,r) => s+r.continuity, 0) / (contScores.length||1);
  const avgAlign = contScores.reduce((s,r) => s+r.alignment, 0) / (contScores.length||1);
  log(`Phase2 avg: continuity=${avgCont.toFixed(1)} alignment=${avgAlign.toFixed(1)}`);
  return contScores;
}

// ── Phase 3: Mid-Arc ep6~ep10 ───────────────────────────────────
async function runMidArc() {
  log("\n=== PHASE 3: MID-ARC STABILITY (ep6~ep10) ===");
  const results = [];

  for (let ep = 6; ep <= 10; ep++) {
    log(`Phase3: generating ep${ep}...`);
    try {
      await generateEpisode(ep);
      const prev = getEpContent(ep-1); const curr = getEpContent(ep);
      const cont = checkContinuity(prev, curr);
      const trace = getLatestTrace(ep);
      const align = checkAlignment(trace);
      const analysis = analyzeText(curr||"");
      results.push({ ep, continuity: cont.score, alignment: align.score, length: analysis.length });
      log(`  ep${ep}: cont=${cont.score} align=${align.score} len=${analysis.length}`);
    } catch(e) { log(`  ep${ep} ERROR: ${e.message}`); }
    await new Promise(r => setTimeout(r, 3000));
  }

  // ep8 3회 재생성
  log("Phase3: ep8 regen x3 for diversity check...");
  for (let i = 1; i <= 3; i++) {
    try {
      await generateEpisode(8);
      const t = getLatestTrace(8);
      log(`  ep8[${i}] beat1="${t?.planner?.parsed_plan?.scene_beats?.[0]?.summary?.slice(0,35)}" hook=${t?.planner?.parsed_plan?.hook_type}`);
    } catch(e) { log(`  ep8[${i}] ERROR: ${e.message}`); }
    await new Promise(r => setTimeout(r, 2000));
  }
  const ep8Div = checkBeatDiversity(getTracesForEp(8, 4));
  log(`ep8 diversity: fixed=${ep8Div.beat1_fixed_pct}% unique_hooks=${ep8Div.unique_hooks}`);

  return results;
}

// ── Phase 4: Ending Convergence ep11~ep20 ──────────────────────
async function runEndingConvergence() {
  log("\n=== PHASE 4: ENDING CONVERGENCE (ep11~ep20) ===");
  const results = [];

  for (let ep = 11; ep <= TOTAL_EP; ep++) {
    log(`Phase4: generating ep${ep}...`);
    try {
      await generateEpisode(ep);
      const curr = getEpContent(ep)||"";
      const prev = getEpContent(ep-1);
      const cont = checkContinuity(prev, curr);
      const trace = getLatestTrace(ep);
      const analysis = analyzeText(curr);
      const hook = trace?.planner?.parsed_plan?.hook_type;
      const isFinal = ep === TOTAL_EP;
      const endOk = isFinal ? (analysis.has_end && !analysis.has_cliff) : true;
      results.push({ ep, continuity: cont.score, length: curr.length, hook, end_ok: endOk });
      log(`  ep${ep}: cont=${cont.score} hook=${hook} len=${curr.length}${isFinal ? ` END_ok=${endOk}` : ""}`);
      if (isFinal && !endOk) bug("P1","phase4","final_ep_missing_end",`ep${ep} is final but [END] missing or [CLIFF] present`,"renderer prompt final rule check");
      if (ep >= 18 && hook && ["immediate_threat","new_problem"].includes(hook) && ep === TOTAL_EP)
        bug("P2","phase4",`ep${ep}_wrong_final_hook`,`final episode has hook_type=${hook}`,"arc_phase logic in planner should force finale hook types");
    } catch(e) { log(`  ep${ep} ERROR: ${e.message}`); }
    await new Promise(r => setTimeout(r, 3000));
  }

  return results;
}

// ── Phase 5: Cross-World ────────────────────────────────────────
async function runCrossWorld() {
  log("\n=== PHASE 5: CROSS-WORLD UNIQUENESS ===");

  // 새 세계관 2개 생성은 UI에서만 가능 (book 생성 API 필요)
  // 기존 다른 책들과 ep1 비교
  const otherBooks = dbq(
    `SELECT id, title FROM books WHERE title NOT LIKE '[%' AND id != '${BOOK_ID}' ORDER BY created_at DESC LIMIT 3`
  );
  log(`Other books for comparison: ${otherBooks.map(r => `${r[1]}(${r[0].slice(0,8)})`).join(", ")}`);

  const hkwEp1 = getEpContent(1)||"";
  const results = [];

  for (const [bid, btitle] of otherBooks) {
    const rows = dbq(`SELECT content FROM episodes WHERE book_id='${bid}' AND episode_number=1`);
    const otherEp1 = rows[0]?.[0]||"";
    if (!otherEp1) continue;

    // 간단한 키워드 Jaccard 유사도
    const wordsA = new Set(hkwEp1.match(/[가-힣]{2,}/g)||[]);
    const wordsB = new Set(otherEp1.match(/[가-힣]{2,}/g)||[]);
    const intersect = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    const jaccard = union ? (intersect/union) : 0;

    // 구조 패턴 겹침: FIXED_PATTERNS 사용 여부
    const fixedA = FIXED_PATTERNS.filter(p => hkwEp1.includes(p)).length;
    const fixedB = FIXED_PATTERNS.filter(p => otherEp1.includes(p)).length;

    results.push({ title: btitle, jaccard: jaccard.toFixed(3), fixedA, fixedB });
    log(`  vs [${btitle}]: jaccard=${jaccard.toFixed(3)} fixed_patterns_target=${fixedA} other=${fixedB}`);
    if (jaccard > 0.3) bug("P2","phase5",`cross_world_high_similarity:${btitle}`,`Jaccard ${jaccard.toFixed(3)}>0.3`,"world generation diversity insufficient");
  }

  return results;
}

// ── 최종 보고서 ────────────────────────────────────────────────
function printReport(data) {
  const { preflight, phase1, phase2, phase3, phase4, phase5 } = data;

  console.log("\n\n" + "=".repeat(60));
  console.log("[FLOWSCRIBE QUALITY VALIDATION EXECUTION REPORT]");
  console.log("=".repeat(60));

  // 1. 실행 범위
  console.log("\n1. 실행 범위");
  const eps = [
    `ep1: 3(preflight)+5(phase1)회 재생성`,
    `ep2: 2(preflight)+3(phase1)회 재생성`,
    `ep3~5: phase2 각 1회`,
    `ep6~10: phase3 (ep8 추가 3회)`,
    `ep11~20: phase4 1회씩`,
    `cross-world: phase5 기존 세계관 비교`,
  ];
  eps.forEach(e => console.log(`  - ${e}`));
  console.log("  방법: API 자동 호출 + DB 분석");

  // 2. Preflight Gate
  console.log("\n2. Preflight Gate");
  console.log(`  결과: ${preflight?.passed ? "PASSED ✓" : "FAILED ✗"}`);
  if (preflight?.failReasons?.length) console.log(`  실패 사유: ${preflight.failReasons.join("; ")}`);
  if (preflight?.ep1Diversity) {
    const d = preflight.ep1Diversity;
    console.log(`  ep1 beat1 고착률: ${d.beat1_fixed_pct}%`);
    console.log(`  ep1 unique hooks: ${d.unique_hooks}/${d.total}`);
    console.log(`  최대 연속 동일 hook: ${d.max_consec_hook}회`);
  }

  // 3. 라운드별 핵심 결과
  console.log("\n3. 라운드별 핵심 결과");

  // Diversity
  if (phase1) {
    const d = phase1.diversity;
    const status = d.beat1_fixed_pct <= 40 && d.unique_hooks >= 3 ? "✓ OK" : "✗ FAIL";
    console.log(`  [Diversity]        beat1_fixed=${d.beat1_fixed_pct}% unique_hooks=${d.unique_hooks} max_consec=${d.max_consec_hook} → ${status}`);
  }

  // Hook Adequacy
  const allTraces = getTracesForEp(1, 10);
  const allHooks = allTraces.map(t => t?.parsed_plan?.hook_type).filter(Boolean);
  const uniqueHookSet = new Set(allHooks);
  console.log(`  [Hook Adequacy]    hook types used: [${[...uniqueHookSet].join(", ")}]`);

  // Continuity
  if (phase2) {
    const avgC = phase2.reduce((s,r) => s+r.continuity, 0)/(phase2.length||1);
    const avgA = phase2.reduce((s,r) => s+r.alignment, 0)/(phase2.length||1);
    const status = avgC >= 80 ? "✓ OK" : avgC >= 60 ? "⚠ WARN" : "✗ FAIL";
    console.log(`  [Continuity]       ep2~5 avg=${avgC.toFixed(1)} ${status}`);
    console.log(`  [Plan-Prose Align] ep2~5 avg=${avgA.toFixed(1)} ${avgA>=70?"✓ OK":"✗ FAIL"}`);
  }

  // Ending
  if (phase4) {
    const finalEp = phase4.find(r => r.ep === TOTAL_EP);
    const midAvgC = phase4.slice(0,5).reduce((s,r)=>s+r.continuity,0)/Math.min(5,phase4.length||1);
    console.log(`  [Ending]           final ep${TOTAL_EP} end_ok=${finalEp?.end_ok} hook=${finalEp?.hook}`);
    console.log(`  [Mid-Arc Cont]     ep11~15 avg continuity=${midAvgC.toFixed(1)}`);
  }

  // Cross-World
  if (phase5?.length) {
    const maxJ = Math.max(...phase5.map(r => parseFloat(r.jaccard)));
    console.log(`  [Cross-World]      max Jaccard=${maxJ.toFixed(3)} ${maxJ<=0.3?"✓ OK":"✗ FAIL"}`);
  }

  // 4. 버그 목록
  console.log("\n4. 버그 목록");
  const bySev = { P0:[], P1:[], P2:[], P3:[] };
  for (const b of BUGS) (bySev[b.severity]||bySev.P3).push(b);
  for (const sev of ["P0","P1","P2","P3"]) {
    for (const b of bySev[sev]) {
      console.log(`  [${sev}] ${b.issue}`);
      console.log(`       원인: ${b.cause}`);
      console.log(`       수정: ${b.fix}`);
    }
  }
  if (BUGS.length === 0) console.log("  없음 ✓");

  // 5. 가장 심각한 구조 문제 3개
  console.log("\n5. 가장 심각한 구조 문제 TOP 3");
  const p0p1 = BUGS.filter(b => b.severity === "P0" || b.severity === "P1").slice(0, 3);
  p0p1.forEach((b,i) => console.log(`  ${i+1}. [${b.severity}] ${b.issue} — ${b.fix}`));
  if (!p0p1.length) console.log("  P0/P1 버그 없음 ✓");

  // 6. 최종 판단
  console.log("\n6. 최종 판단");
  const p0Count = BUGS.filter(b => b.severity === "P0").length;
  const p1Count = BUGS.filter(b => b.severity === "P1").length;
  let verdict;
  if (p0Count > 0)      verdict = "NOT READY";
  else if (p1Count > 2) verdict = "CONDITIONAL";
  else if (p1Count > 0) verdict = "CONDITIONAL";
  else                  verdict = "READY";
  console.log(`  판정: ${verdict}`);
  if (verdict === "NOT READY")    console.log("  → P0 버그 수정 후 재검증 필요");
  if (verdict === "CONDITIONAL")  console.log("  → P1 버그 수정 후 제한적 DPO 진행 가능 (고품질 샘플만 선택)");
  if (verdict === "READY")        console.log("  → DPO 데이터 수집 시작 가능");

  // 7. 다음 단계
  console.log("\n7. 다음 단계");
  if (p0Count > 0) {
    console.log("  [즉시 수정] P0 버그 해결 후 Preflight 재실행");
  } else if (p1Count > 0) {
    console.log("  [즉시 수정] P1 버그 목록 처리:");
    BUGS.filter(b=>b.severity==="P1").forEach(b => console.log(`    - ${b.issue}: ${b.fix}`));
    console.log("  [추가 검증] P1 수정 후 Phase 0~2 재실행으로 개선 확인");
    console.log("  [DPO] 고품질 trace만 선택적 수집 시작 (final_score >= 70 필터)");
  } else {
    console.log("  [DPO] DPO pair 수집 시작 가능");
    console.log("  [모니터링] P2 항목 장기 추적");
  }

  console.log("\n" + "=".repeat(60));
  console.log("LOG SUMMARY:");
  LOG.forEach(l => console.log("  " + l));
}

// ── MAIN ────────────────────────────────────────────────────────
(async () => {
  log("FlowScribe Quality Validation START");
  log(`book_id: ${BOOK_ID} | target: ep1~${TOTAL_EP}`);

  const preflight = await runPreflight();
  const skipLong  = !preflight.passed && preflight.failReasons.some(r => r.includes("P0"));

  const phase1 = await runDiversityBaseline(!preflight.passed && preflight.failReasons.length > 2);
  const phase2 = preflight.passed ? await runEarlyContinuity() : null;
  const phase3 = preflight.passed ? await runMidArc() : null;
  const phase4 = preflight.passed ? await runEndingConvergence() : null;
  const phase5 = await runCrossWorld();

  printReport({ preflight, phase1, phase2, phase3, phase4, phase5 });
})();
