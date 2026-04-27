/**
 * fresh_gen_all.mjs
 * ep4~5, ep11~20 순차 생성 + 이름 drift 검증
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

function getCharStates(episode) {
  const rows = dbq(
    `SELECT character_name, location FROM character_dynamic_states ` +
    `WHERE book_id='${BOOK_ID}' AND episode_number=${episode} ORDER BY character_name`
  );
  return rows.map(r => ({ name: r[0], location: r[1] }));
}

function getTrace(episode) {
  const rows = dbqJson(
    `SELECT replace(planner_trace::text, chr(10), ' ') FROM run_traces ` +
    `WHERE book_id='${BOOK_ID}' AND episode_number=${episode} ORDER BY created_at DESC LIMIT 1`
  );
  if (!rows.length) return null;
  try { return JSON.parse(rows[0][0]); } catch { return null; }
}

function getEpLen(episode) {
  const rows = dbq(`SELECT length(content) FROM episodes WHERE book_id='${BOOK_ID}' AND episode_number=${episode}`);
  return parseInt(rows[0]?.[0] || "0");
}

const WORLD_INTRUSION = ["낡은 교실", "교실에서", "교실 안", "교실의", "칠판에", "칠판이", "교무실"];
const CANONICAL_NAMES = ["빅토리", "리아", "브론", "카이렌"];
const ORPHAN_PATTERNS = [/[A-Za-z]/, /[一-鿿㐀-䶿]/];

function checkNameDrift(charStates) {
  const drifted = charStates.filter(s => !CANONICAL_NAMES.includes(s.name));
  const orphans = drifted.filter(s => ORPHAN_PATTERNS.some(p => p.test(s.name)));
  const newChars = drifted.filter(s => !ORPHAN_PATTERNS.some(p => p.test(s.name)));
  return { drifted, orphans, newChars };
}

function getEpContent(ep) {
  const rows = dbqJson(`SELECT replace(content, chr(10), chr(32)) FROM episodes WHERE book_id='${BOOK_ID}' AND episode_number=${ep}`);
  return rows[0]?.[0] || null;
}

function checkContinuity(prevC, curC) {
  if (!prevC || !curC) return 0;
  const tail = prevC.slice(-300), head = curC.slice(0, 300);
  let score = 100;
  const charNames = ["빅토리", "브론", "리아", "카이렌"];
  const tailChars = charNames.filter(c => tail.includes(c));
  const headChars = charNames.filter(c => head.includes(c));
  if (tailChars.length && headChars.length) {
    const overlap = tailChars.filter(c => headChars.includes(c)).length;
    if (overlap / Math.max(tailChars.length, 1) < 0.3) score -= 20;
  }
  if (WORLD_INTRUSION.some(p => head.slice(0,200).includes(p))) score -= 30;
  return Math.max(0, score);
}

function log(msg) { const t = new Date().toISOString().slice(11,19); console.log(`[${t}] ${msg}`); }

(async () => {
  log("=== FRESH GENERATION START ===");

  const EPISODES_TO_GEN = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const results = {};

  for (const ep of EPISODES_TO_GEN) {
    log(`ep${ep} 생성 중...`);
    try {
      await generateEpisode(ep);
      await new Promise(r => setTimeout(r, 1500));
      const len = getEpLen(ep);
      const trace = getTrace(ep);
      const charStates = getCharStates(ep);
      const content = getEpContent(ep);
      const prevContent = getEpContent(ep - 1);
      const hookType = trace?.parsed_plan?.hook_type || (trace?.fallback_used ? "FALLBACK" : "?");
      const beat1loc = trace?.parsed_plan?.scene_beats?.[0]?.location || "?";
      const worldOk = !WORLD_INTRUSION.some(p => (content || "").includes(p));
      const cont = checkContinuity(prevContent, content);
      const drift = checkNameDrift(charStates);
      const fallback = trace?.fallback_used ? "FALLBACK" : "ok";

      log(`  ep${ep}: len=${len} hook=${hookType} plan=${fallback}`);
      log(`         beat1="${beat1loc}" world_ok=${worldOk} cont=${cont}`);
      log(`         chars=[${charStates.map(c=>`${c.name}@${c.location||"??"}`).join(", ")}]`);
      if (drift.orphans.length) log(`         !! ORPHAN: ${drift.orphans.map(c=>c.name).join(",")}`);
      if (drift.newChars.length) log(`         new_chars: ${drift.newChars.map(c=>c.name).join(",")}`);
      results[`ep${ep}`] = { len, hookType, worldOk, cont, charCount: charStates.length, drift, fallback };
    } catch(e) {
      log(`  ep${ep} ERROR: ${e.message}`);
      results[`ep${ep}`] = { error: e.message };
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // ── 요약 ──
  log("\n=== 요약 ===");
  const valid = EPISODES_TO_GEN.filter(ep => !results[`ep${ep}`]?.error);
  const worldFails = valid.filter(ep => !results[`ep${ep}`]?.worldOk);
  const fallbackFails = valid.filter(ep => results[`ep${ep}`]?.fallback === "FALLBACK");
  const orphanFails = valid.filter(ep => results[`ep${ep}`]?.drift?.orphans?.length > 0);
  const charFails = valid.filter(ep => results[`ep${ep}`]?.charCount === 0);
  const allHooks = valid.map(ep => results[`ep${ep}`]?.hookType).filter(h => h && h !== "?" && h !== "FALLBACK");
  const uniqueHooks = new Set(allHooks).size;

  log(`생성 완료: ${valid.length}/${EPISODES_TO_GEN.length}`);
  log(`world_ok: ${valid.length - worldFails.length}/${valid.length}  fails=[${worldFails.join(",")}]`);
  log(`fallback: ${fallbackFails.length}건  [${fallbackFails.join(",")}]`);
  log(`orphan chars: ${orphanFails.length}건  [${orphanFails.join(",")}]`);
  log(`char_states 0건: ${charFails.length}건  [${charFails.join(",")}]`);
  log(`hook unique: ${uniqueHooks} / ${allHooks.length}  [${allHooks.join(", ")}]`);

  // canonical check
  log("\n=== Canonical Name Check (전 구간) ===");
  for (let ep = 1; ep <= 20; ep++) {
    const cs = getCharStates(ep);
    const drift = checkNameDrift(cs);
    if (drift.orphans.length || drift.drifted.length) {
      log(`  ep${ep}: DRIFT=[${drift.drifted.map(c=>c.name).join(",")}] ORPHAN=[${drift.orphans.map(c=>c.name).join(",")}]`);
    }
  }
  log("  (위 출력 없으면 전 구간 canonical 유지)");

  const allPass = worldFails.length === 0 && orphanFails.length === 0;
  log(`\n최종: ${allPass ? "PASS ✓" : "FAIL ✗"}`);
  log("=== FRESH GENERATION END ===");
})();
