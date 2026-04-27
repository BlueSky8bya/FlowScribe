/**
 * preflight_check.mjs — ep1×3, ep2×2, ep3×1 빠른 재검증
 * 생성기 안정화 패치 후 핵심 지표만 확인
 */
import http from "http";
import { createHmac } from "crypto";
import { execSync } from "child_process";

const BOOK_ID    = "ccbad484-94e6-45c4-b88e-403a6369420b";
const USER_ID    = "0720b196-e456-474e-85d1-f51473af9f68";
const JWT_SECRET = "asdflidjsfoieflkasdfaALKSDJFDdfDFdf452";

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body   = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig    = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}
const TOKEN = makeJwt({ id: USER_ID, email: "blackspace665@gmail.com", iat: Math.floor(Date.now()/1000) });

// dbqJson: JSON/텍스트 컬럼 — 개행 제거로 split 안전화
function dbqJson(sql) {
  try {
    return execSync(
      `docker exec flowscribe_postgres psql -U flowscribe -d flowscribe -t -A -F"|||" -c "${sql.replace(/"/g, '\\"')}"`,
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    ).trim().split("\n").filter(r => r.trim()).map(r => r.split("|||"));
  } catch { return []; }
}

function dbq(sql) {
  try {
    return execSync(
      `docker exec flowscribe_postgres psql -U flowscribe -d flowscribe -t -A -F"|||" -c "${sql.replace(/"/g, '\\"')}"`,
      { encoding: "utf8" }
    ).trim().split("\n").filter(r => r.trim()).map(r => r.split("|||"));
  } catch { return []; }
}

function generateEpisode(episode, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const url = `/api/generate?use_planner=true&book_id=${BOOK_ID}&episode=${episode}`;
    const req = http.request({
      hostname: "localhost", port: 3000, path: url, method: "GET",
      headers: { Cookie: `fs_token=${TOKEN}`, Accept: "text/event-stream" },
    });
    let text = ""; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; req.destroy(); reject(new Error(`Timeout ep${episode}`)); }, timeoutMs);
    req.on("response", (res) => {
      let buf = "";
      res.on("data", chunk => {
        buf += chunk.toString();
        const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.token) text += d.token;
            if (d.done) { clearTimeout(timer); resolve({ text: text.trim() }); }
          } catch {}
        }
      });
      res.on("end", () => { if (!timedOut) { clearTimeout(timer); resolve({ text: text.trim() }); } });
    });
    req.on("error", e => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

function getLatestTrace(episode) {
  const rows = dbqJson(
    `SELECT replace(planner_trace::text, chr(10), ' '), replace(renderer_trace::text, chr(10), ' ') FROM run_traces ` +
    `WHERE book_id='${BOOK_ID}' AND episode_number=${episode} ORDER BY created_at DESC LIMIT 1`
  );
  if (!rows.length || !rows[0][0]) return null;
  try { return { planner: JSON.parse(rows[0][0]), renderer: JSON.parse(rows[0][1] || "{}") }; }
  catch (e) { return null; }
}

function getTracesForEp(episode, limit = 10) {
  const rows = dbqJson(
    `SELECT replace(planner_trace::text, chr(10), ' ') FROM run_traces ` +
    `WHERE book_id='${BOOK_ID}' AND episode_number=${episode} ORDER BY created_at DESC LIMIT ${limit}`
  );
  return rows.map(r => { try { return JSON.parse(r[0]); } catch { return null; } }).filter(Boolean);
}

function getEpLen(episode) {
  const rows = dbq(`SELECT length(content) FROM episodes WHERE book_id='${BOOK_ID}' AND episode_number=${episode}`);
  return parseInt(rows[0]?.[0] || "0");
}

function getEpContent(episode) {
  const rows = dbqJson(`SELECT replace(content, chr(10), chr(32)) FROM episodes WHERE book_id='${BOOK_ID}' AND episode_number=${episode}`);
  return rows[0]?.[0] || null;
}

function getCharStates(episode) {
  const rows = dbq(`SELECT character_name, emotional_state, location FROM character_dynamic_states WHERE book_id='${BOOK_ID}' AND episode_number=${episode} ORDER BY character_name`);
  return rows.map(r => ({ name: r[0], emotion: r[1], location: r[2] }));
}

const FIXED_PATTERNS = ["낯선 숲에서 깨어", "기억을 잃", "기억이 나지", "짐승의 울음", "눈을 떠", "의식을 잃", "바닥에 쓰러"];
const CLASSROOM_PATTERNS = ["낡은 교실", "교실에서", "교실 안", "칠판에", "칠판이", "교무실"];
const LANG_POLL = /[Ѐ-ӿ؀-ۿ]/;

function checkContinuity(ep1c, ep2c) {
  if (!ep1c || !ep2c) return { score: 0, issues: ["missing_content"] };
  const tail = ep1c.slice(-200), head = ep2c.slice(0, 200);
  let score = 100; const issues = [];
  const locWords = ["숲", "마을", "성", "동굴", "길", "광장", "방", "여관", "전장"];
  const tailLocs = locWords.filter(w => tail.includes(w));
  const headLocs = locWords.filter(w => head.includes(w));
  if (tailLocs.length && tailLocs.filter(w => headLocs.includes(w)).length / tailLocs.length < 0.3) {
    score -= 25; issues.push("location_break");
  }
  if (FIXED_PATTERNS.some(p => head.includes(p))) { score -= 30; issues.push("fresh_start"); }
  return { score: Math.max(0, score), issues };
}

function log(msg) { const t = new Date().toISOString().slice(11,19); console.log(`[${t}] ${msg}`); }

// ── MAIN ─────────────────────────────────────────────────────────
(async () => {
  log("=== PREFLIGHT REVALIDATION START ===");
  const results = { ep1: [], ep2: [], ep3: null };

  // ep1 × 3
  for (let i = 1; i <= 3; i++) {
    log(`ep1 attempt ${i}/3...`);
    try {
      const r = await generateEpisode(1);
      const len = r.text.length;
      const langOk = !LANG_POLL.test(r.text);
      const classroomHit = CLASSROOM_PATTERNS.some(p => r.text.includes(p));
      const trace = getLatestTrace(1);
      const beat1loc = trace?.planner?.parsed_plan?.scene_beats?.[0]?.location || "?";
      const hook = trace?.planner?.parsed_plan?.hook_type || "?";
      const stateUpdatesCount = trace?.planner?.parsed_plan?.character_state_updates?.length ?? "trace_null";
      log(`  ep1[${i}] len=${len} lang_ok=${langOk} classroom_hit=${classroomHit}`);
      log(`         beat1_loc="${beat1loc}" hook="${hook}" state_updates=${stateUpdatesCount}`);
      results.ep1.push({ len, langOk, classroomHit, beat1loc, hook, stateUpdatesCount });
    } catch(e) { log(`  ep1[${i}] ERROR: ${e.message}`); }
    await new Promise(r => setTimeout(r, 2000));
  }

  // ep2 × 2
  for (let i = 1; i <= 2; i++) {
    log(`ep2 attempt ${i}/2...`);
    try {
      const r = await generateEpisode(2);
      const len = r.text.length;
      const ep1c = getEpContent(1); const ep2c = getEpContent(2);
      const cont = checkContinuity(ep1c, ep2c);
      const trace = getLatestTrace(2);
      const hook = trace?.planner?.parsed_plan?.hook_type || "?";
      const beat1loc = trace?.planner?.parsed_plan?.scene_beats?.[0]?.location || "?";
      const stateUpdatesCount = trace?.planner?.parsed_plan?.character_state_updates?.length ?? "trace_null";
      log(`  ep2[${i}] len=${len} continuity=${cont.score} issues=${cont.issues.join(",")}`);
      log(`         beat1_loc="${beat1loc}" hook="${hook}" state_updates=${stateUpdatesCount}`);
      results.ep2.push({ len, continuity: cont.score, hook, beat1loc, stateUpdatesCount });
    } catch(e) { log(`  ep2[${i}] ERROR: ${e.message}`); }
    await new Promise(r => setTimeout(r, 2000));
  }

  // ep3 × 1
  log("ep3 attempt 1/1...");
  try {
    const r = await generateEpisode(3);
    const len = r.text.length;
    const ep2c = getEpContent(2); const ep3c = getEpContent(3);
    const cont = checkContinuity(ep2c, ep3c);
    const trace = getLatestTrace(3);
    const hook = trace?.planner?.parsed_plan?.hook_type || "?";
    const beat1loc = trace?.planner?.parsed_plan?.scene_beats?.[0]?.location || "?";
    const charStates = getCharStates(3);
    const stateUpdatesCount = trace?.planner?.parsed_plan?.character_state_updates?.length ?? "trace_null";
    const classroomHit = CLASSROOM_PATTERNS.some(p => r.text.includes(p));
    log(`  ep3 len=${len} continuity=${cont.score} issues=${cont.issues.join(",")}`);
    log(`       beat1_loc="${beat1loc}" hook="${hook}" state_updates=${stateUpdatesCount} classroom_hit=${classroomHit}`);
    log(`       char_states: ${charStates.map(c => `${c.name}@${c.location||"?"}`).join(", ")}`);
    results.ep3 = { len, continuity: cont.score, hook, beat1loc, stateUpdatesCount, classroomHit, charStates };
  } catch(e) { log(`  ep3 ERROR: ${e.message}`); }

  // Hook diversity 요약 (최근 6개 trace)
  const recentTraces = getTracesForEp(1, 6);
  const hooks1 = recentTraces.map(t => t?.parsed_plan?.hook_type).filter(Boolean);
  const uniqueHooks1 = new Set(hooks1).size;
  log(`\nep1 hook diversity (last 6): [${hooks1.join(", ")}] unique=${uniqueHooks1}/6`);

  // char states ep1~ep3 요약
  const cs1 = getCharStates(1); const cs2 = getCharStates(2); const cs3 = getCharStates(3);
  log(`char_states summary: ep1=${cs1.length}건, ep2=${cs2.length}건, ep3=${cs3.length}건`);

  log("\n=== PASS 판단 ===");
  const ep3ClassroomFail = results.ep3?.classroomHit;
  const hookFixated = uniqueHooks1 < 2;
  const charStatesFail = cs3.length === 0;
  const ep3ContFail = (results.ep3?.continuity ?? 100) < 70;

  if (ep3ClassroomFail) log("  FAIL: ep3 교실 패턴 재발");
  else log("  OK: ep3 교실 패턴 없음");

  if (hookFixated) log(`  FAIL: hook 단일 고착 (unique=${uniqueHooks1})`);
  else log(`  OK: hook 다양성 unique=${uniqueHooks1}`);

  if (charStatesFail) log("  FAIL: ep3 char_states 저장 실패");
  else log(`  OK: ep3 char_states ${cs3.length}건 저장됨`);

  if (ep3ContFail) log(`  FAIL: ep3 continuity=${results.ep3?.continuity} < 70`);
  else log(`  OK: ep3 continuity=${results.ep3?.continuity}`);

  const allPass = !ep3ClassroomFail && !hookFixated && !charStatesFail && !ep3ContFail;
  log(`\n최종: ${allPass ? "PASS ✓" : "FAIL ✗"}`);
  log("=== PREFLIGHT REVALIDATION END ===");
})();
