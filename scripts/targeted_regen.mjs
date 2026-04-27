/**
 * targeted_regen.mjs — ep1, ep3, ep7, ep9, ep10 재생성
 *
 * 목적:
 *   - ep1: old story.ts 경로 prose에 "빅토리아" 남아 있음 → pipeline으로 재생성
 *   - ep3: prose에 "빅토리아" 남아 있음 → pipeline으로 재생성
 *   - ep7, ep9, ep10: char_states에 "낡은 교실/무너진 교실 잔해" 위치 남아 있음 → 재생성
 *
 * 실행 순서: ep1 → ep2 (ep1 tail 오염 제거) → ep3 → ep7 → ep9 → ep10
 * ep2는 ep1의 "빅토리아" tail을 받았을 수 있으므로 함께 재생성.
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

function dbq(sql) {
  try {
    return execSync(
      `docker exec flowscribe_postgres psql -U flowscribe -d flowscribe -t -A -F"|||" -c "${sql.replace(/"/g, '\\"')}"`,
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    ).trim().split("\n").filter(r => r.trim()).map(r => r.split("|||"));
  } catch { return []; }
}

function generateEpisode(episode, timeoutMs = 200000) {
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
            if (d.done) { clearTimeout(timer); resolve({ text: text.trim(), meta: d.episode_meta }); }
          } catch {}
        }
      });
      res.on("end", () => { if (!timedOut) { clearTimeout(timer); resolve({ text: text.trim(), meta: null }); } });
    });
    req.on("error", e => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

function getEpStats(ep) {
  const lenRows = dbq(`SELECT length(content) FROM episodes WHERE book_id='${BOOK_ID}' AND episode_number=${ep}`);
  const len = parseInt(lenRows[0]?.[0] || "0");

  const contentRows = dbq(`SELECT replace(content, chr(10), chr(32)) FROM episodes WHERE book_id='${BOOK_ID}' AND episode_number=${ep}`);
  const content = contentRows[0]?.[0] || "";
  const hasDrift = content.includes("빅토리아");

  const charRows = dbq(`SELECT character_name, location FROM character_dynamic_states WHERE book_id='${BOOK_ID}' AND episode_number=${ep} ORDER BY character_name`);
  const charStates = charRows.map(r => ({ name: r[0], location: r[1] }));

  const CLASSROOM = ["낡은 교실", "교실에서", "교실 안", "무너진 교실"];
  const classroomInChar = charStates.filter(s => CLASSROOM.some(p => (s.location||"").includes(p))).map(s => `${s.name}@${s.location}`);
  const classroomInContent = CLASSROOM.some(p => content.includes(p));

  return { len, hasDrift, charStates, classroomInChar, classroomInContent };
}

function log(msg) { const t = new Date().toISOString().slice(11,19); console.log(`[${t}] ${msg}`); }

// ep1 → ep2 → ep3 순서 필요 (prevEpisodeTail 오염 전파 차단)
const EPISODES_TO_REGEN = [1, 2, 3, 7, 9, 10];

(async () => {
  log("=== TARGETED REGEN START ===");
  log(`대상 화: ${EPISODES_TO_REGEN.join(", ")}`);
  log("ep2는 ep1의 빅토리아 tail 오염 방지를 위해 함께 재생성");

  const results = {};

  for (const ep of EPISODES_TO_REGEN) {
    log(`\nep${ep} 재생성 중...`);
    try {
      const r = await generateEpisode(ep);
      await new Promise(res => setTimeout(res, 2000));
      const stats = getEpStats(ep);

      log(`  ep${ep}: len=${stats.len} drift=${stats.hasDrift} classroom_content=${stats.classroomInContent}`);
      log(`         chars=[${stats.charStates.map(c => `${c.name}@${c.location||"?"}`).join(", ")}]`);
      if (stats.classroomInChar.length) log(`         !! CLASSROOM in char_states: ${stats.classroomInChar.join(", ")}`);
      if (stats.hasDrift) log(`         !! DRIFT: 빅토리아 still in prose`);

      results[`ep${ep}`] = {
        len: stats.len,
        drift: stats.hasDrift,
        classroomInChar: stats.classroomInChar,
        classroomInContent: stats.classroomInContent,
        fallback: r.meta?.plan_fallback_used ?? null,
      };
    } catch(e) {
      log(`  ep${ep} ERROR: ${e.message}`);
      results[`ep${ep}`] = { error: e.message };
    }
    await new Promise(res => setTimeout(res, 2000));
  }

  log("\n=== TARGETED REGEN 결과 요약 ===");
  for (const ep of EPISODES_TO_REGEN) {
    const r = results[`ep${ep}`];
    if (r.error) { log(`ep${ep}: ERROR — ${r.error}`); continue; }
    const driftOk = !r.drift ? "drift_ok" : "DRIFT_FAIL";
    const classroomOk = !r.classroomInChar.length ? "classroom_ok" : `CLASSROOM_FAIL(${r.classroomInChar.join(",")})`;
    log(`ep${ep}: len=${r.len} ${driftOk} ${classroomOk} fallback=${r.fallback}`);
  }

  // 전 구간 prose drift check
  log("\n=== 전 구간 prose drift check (ep1~ep20) ===");
  const driftEps = [];
  for (let ep = 1; ep <= 20; ep++) {
    const rows = dbq(`SELECT replace(content, chr(10), chr(32)) FROM episodes WHERE book_id='${BOOK_ID}' AND episode_number=${ep}`);
    const content = rows[0]?.[0] || "";
    if (content.includes("빅토리아")) driftEps.push(ep);
  }
  if (driftEps.length === 0) log("  prose drift: 0건 — CLEAN");
  else log(`  prose drift 남은 화: ${driftEps.join(", ")}`);

  // 전 구간 char_states classroom check
  log("\n=== 전 구간 char_states classroom check ===");
  const CLASSROOM = ["낡은 교실", "교실에서", "교실 안", "무너진 교실"];
  const classroomCharEps = [];
  for (let ep = 1; ep <= 20; ep++) {
    const charRows = dbq(`SELECT character_name, location FROM character_dynamic_states WHERE book_id='${BOOK_ID}' AND episode_number=${ep}`);
    const hits = charRows.filter(r => CLASSROOM.some(p => (r[1]||"").includes(p)));
    if (hits.length) classroomCharEps.push(`ep${ep}:[${hits.map(r=>`${r[0]}@${r[1]}`).join(",")}]`);
  }
  if (classroomCharEps.length === 0) log("  char_states classroom: 0건 — CLEAN");
  else log(`  classroom 잔재: ${classroomCharEps.join("; ")}`);

  // canonical check
  const CANONICAL = ["빅토리","리아","브론","카이렌"];
  log("\n=== char_states canonical check ===");
  const nonCanonRows = dbq(`SELECT DISTINCT character_name FROM character_dynamic_states WHERE book_id='${BOOK_ID}' AND character_name NOT IN ('빅토리','리아','브론','카이렌') ORDER BY character_name`);
  if (!nonCanonRows.length) log("  non-canonical: 0 — CLEAN");
  else log(`  non-canonical names: ${nonCanonRows.map(r=>r[0]).join(", ")}`);

  const allDriftOk = driftEps.length === 0;
  const allClassroomOk = classroomCharEps.length === 0;
  log(`\n최종: ${allDriftOk && allClassroomOk ? "PASS ✓" : "CONDITIONAL — 수동 확인 필요"}`);
  log("=== TARGETED REGEN END ===");
})();
