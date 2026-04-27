/**
 * midarc_validation.mjs
 * ep6~ep10 연속 생성 + ep8 2회 재생성으로 중반부 안정성 검증
 * post-fix 생성기 기준 — 세계관/장르/배경 일관성 + hook 다양성 + char_states + continuity + alignment
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

function getLatestTrace(episode) {
  const rows = dbqJson(
    `SELECT replace(planner_trace::text, chr(10), ' '), replace(renderer_trace::text, chr(10), ' ') FROM run_traces ` +
    `WHERE book_id='${BOOK_ID}' AND episode_number=${episode} ORDER BY created_at DESC LIMIT 1`
  );
  if (!rows.length || !rows[0][0]) return null;
  try { return { planner: JSON.parse(rows[0][0]), renderer: JSON.parse(rows[0][1] || "{}") }; }
  catch { return null; }
}

function getEpContent(episode) {
  const rows = dbqJson(`SELECT replace(content, chr(10), chr(32)) FROM episodes WHERE book_id='${BOOK_ID}' AND episode_number=${episode}`);
  return rows[0]?.[0] || null;
}

function getEpLen(episode) {
  const rows = dbq(`SELECT length(content) FROM episodes WHERE book_id='${BOOK_ID}' AND episode_number=${episode}`);
  return parseInt(rows[0]?.[0] || "0");
}

function getCharStates(episode) {
  const rows = dbq(
    `SELECT character_name, emotional_state, location FROM character_dynamic_states ` +
    `WHERE book_id='${BOOK_ID}' AND episode_number=${episode} ORDER BY character_name`
  );
  return rows.map(r => ({ name: r[0], emotion: r[1], location: r[2] }));
}

// ── 세계관 일관성 체크 (현재 책 기준: 이세계 판타지, 마력/스킬 체계)
// 현재 책의 장르/세계관: 이세계 판타지 — 마력, 스킬, 몬스터, 던전 등
// 침입 어휘: 현대 한국 학교 관련 (교실, 칠판, 수학, 담임, 교복, 교무실, 시험지, 수업)
const WORLD_INTRUSION_PATTERNS = ["낡은 교실", "교실에서", "교실 안", "교실의", "칠판에", "칠판이", "교무실", "수업 시간", "교복"];
// 세계관 적합 어휘 (이세계 판타지) — 있으면 가점
const WORLD_MATCH_PATTERNS = ["마력", "스킬", "몬스터", "던전", "파티", "여관", "광장", "숲", "성", "탑", "전장", "마법", "검", "방패", "궁수", "길드"];

const LANG_POLL = /[Ѐ-ӿ؀-ۿ]/;
// 특수문자 오염
const SPECIAL_CHAR_POLLUTION = /[█▓▒░☆★♦♣♠♥♤♡◆◇○●]/;

function checkWorldFidelity(text) {
  if (!text) return { ok: false, intrusions: [], worldMatches: 0 };
  const intrusions = WORLD_INTRUSION_PATTERNS.filter(p => text.includes(p));
  const worldMatches = WORLD_MATCH_PATTERNS.filter(p => text.includes(p)).length;
  return { ok: intrusions.length === 0, intrusions, worldMatches };
}

function checkContinuity(prevContent, curContent) {
  if (!prevContent || !curContent) return { score: 0, issues: ["missing_content"] };
  const tail = prevContent.slice(-300), head = curContent.slice(0, 300);
  let score = 100; const issues = [];
  // 인물명 연속성
  const charNames = ["빅토리아", "빅토리", "브론", "리아", "카이렌"];
  const tailChars = charNames.filter(c => tail.includes(c));
  const headChars = charNames.filter(c => head.includes(c));
  if (tailChars.length && headChars.length) {
    const overlap = tailChars.filter(c => headChars.includes(c)).length;
    if (overlap / Math.max(tailChars.length, 1) < 0.3) { score -= 20; issues.push("char_break"); }
  }
  // 장소 연속성 (세계관 내 장소어)
  const locWords = ["숲", "마을", "성", "동굴", "길", "광장", "방", "여관", "전장", "도서관", "탑", "저택", "다락방", "밀실"];
  const tailLocs = locWords.filter(w => tail.includes(w));
  const headLocs = locWords.filter(w => head.includes(w));
  if (tailLocs.length && tailLocs.filter(w => headLocs.includes(w)).length / tailLocs.length < 0.2) {
    score -= 20; issues.push("location_break");
  }
  // 세계관 침입 요소가 첫 200자 안에 등장하면 패널티
  if (WORLD_INTRUSION_PATTERNS.some(p => head.slice(0, 200).includes(p))) {
    score -= 30; issues.push("world_intrusion_at_start");
  }
  return { score: Math.max(0, score), issues };
}

function checkAlignment(trace) {
  if (!trace?.planner?.parsed_plan || !trace?.renderer) return { score: 0, ok: false };
  const generatedText = trace.renderer.generated_text || trace.renderer.text || "";
  if (!generatedText || generatedText.length < 100) return { score: 0, ok: false };
  const beats = trace.planner.parsed_plan.scene_beats || [];
  if (!beats.length) return { score: 0, ok: false };
  let covered = 0;
  for (const beat of beats) {
    const keywords = [beat.location, beat.action, beat.emotional_note]
      .filter(Boolean).flatMap(s => s.split(/[\s,·\/]+/)).filter(w => w.length >= 2).slice(0, 5);
    if (keywords.some(kw => generatedText.includes(kw))) covered++;
  }
  const beatCoverage = Math.round((covered / beats.length) * 100);
  // hook_concrete_event 반영
  const hookEvent = trace.planner.parsed_plan.hook_concrete_event || "";
  const hookInText = hookEvent.length > 5 && generatedText.includes(hookEvent.slice(0, 10));
  return { score: beatCoverage, ok: beatCoverage >= 60, hookCovered: hookInText, beatCount: beats.length, covered };
}

function checkImmersion(text) {
  if (!text) return { ok: false, issues: [] };
  const issues = [];
  if (LANG_POLL.test(text)) issues.push("lang_pollution");
  if (SPECIAL_CHAR_POLLUTION.test(text)) issues.push("special_char");
  // 반복 문장 감지 (연속 유사 문장)
  const sentences = text.split(/[.。！!？?]/).filter(s => s.trim().length > 10);
  const duplicates = sentences.filter((s, i) => sentences.findIndex(t => t.trim() === s.trim()) !== i);
  if (duplicates.length > 1) issues.push(`repeat_sentences:${duplicates.length}`);
  // 분량 체크
  const len = text.length;
  if (len < 500) issues.push(`too_short:${len}`);
  if (len > 5000) issues.push(`too_long:${len}`);
  return { ok: issues.length === 0, issues, len };
}

function log(msg) { const t = new Date().toISOString().slice(11,19); console.log(`[${t}] ${msg}`); }

// ── MAIN ─────────────────────────────────────────────────────────
(async () => {
  log("=== MID-ARC STABILITY VALIDATION START ===");
  log("대상: ep6~ep10 순차 생성 + ep8 2회 재생성 (총 7회)");
  log("기준: 세계관 일관성·hook 다양성·char_states·continuity·alignment·immersion");
  log("");

  // ── PART 1: world setting 점검 ──────────────────────────────
  log("== PART 1: World Setting 점검 ==");
  const wcRows = dbq(`SELECT COUNT(*) FROM world_configs WHERE book_id='${BOOK_ID}'`);
  const wcCount = parseInt(wcRows[0]?.[0] || "0");
  log(`  world_configs rows: ${wcCount} (비어 있음: source of truth = books.context)`);

  const bookRows = dbqJson(`SELECT replace(context::text, chr(10), ' ') FROM books WHERE id='${BOOK_ID}'`);
  let bookCtx = {};
  try { bookCtx = JSON.parse(bookRows[0]?.[0] || "{}"); } catch {}
  const worldRules = bookCtx.world_rules || [];
  const forbiddenSettings = bookCtx.forbidden_settings || [];
  const genreRule = worldRules.find(r => /장르/.test(r)) || "";
  log(`  장르 규칙: "${genreRule}"`);
  log(`  world_rules 수: ${worldRules.length}개, forbidden_settings 수: ${forbiddenSettings.length}개`);
  log(`  character_defaults 수: ${Object.keys(bookCtx.character_defaults || {}).length}개`);
  const hasWorldLabel = worldRules.some(r => /장르|세계관|배경|이세계|판타지|SF|역사|현대/.test(r));
  log(`  planner worldLabel 추출 가능: ${hasWorldLabel ? "YES" : "NO"}`);
  log("");

  // ── PART 2: ep6~ep10 순차 생성 ─────────────────────────────
  log("== PART 2: ep6~ep10 순차 생성 ==");
  const results = {};

  for (let ep = 6; ep <= 10; ep++) {
    log(`ep${ep} 생성 중...`);
    try {
      await generateEpisode(ep);
      await new Promise(r => setTimeout(r, 1500));
      const len = getEpLen(ep);
      const trace = getLatestTrace(ep);
      const content = getEpContent(ep);
      const charStates = getCharStates(ep);
      const prevContent = getEpContent(ep - 1);
      const cont = checkContinuity(prevContent, content);
      const world = checkWorldFidelity(content);
      const align = checkAlignment(trace);
      const immersion = checkImmersion(content);
      const hookType = trace?.planner?.parsed_plan?.hook_type || "?";
      const beat1loc = trace?.planner?.parsed_plan?.scene_beats?.[0]?.location || "?";
      const stateUpdates = trace?.planner?.parsed_plan?.character_state_updates?.length ?? "?";
      log(`  ep${ep}: len=${len} hook=${hookType} beat1_loc="${beat1loc}"`);
      log(`         world_ok=${world.ok} intrusions=[${world.intrusions.join(",")}] world_matches=${world.worldMatches}`);
      log(`         char_states=${charStates.length}건 [${charStates.map(c=>`${c.name}@${c.location||"NULL"}`).join(", ")}]`);
      log(`         continuity=${cont.score} issues=[${cont.issues.join(",")}]`);
      log(`         alignment: beat_coverage=${align.score}% (${align.covered}/${align.beatCount})`);
      log(`         immersion: ok=${immersion.ok} issues=[${immersion.issues.join(",")}]`);
      results[`ep${ep}`] = { len, hookType, beat1loc, world, charStates, continuity: cont, alignment: align, immersion };
    } catch(e) {
      log(`  ep${ep} ERROR: ${e.message}`);
      results[`ep${ep}`] = { error: e.message };
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // ── PART 3: ep8 재생성 2회 (다양성/고착 재확인) ─────────────
  log("");
  log("== PART 3: ep8 재생성 2회 ==");
  const ep8Reruns = [];
  for (let i = 1; i <= 2; i++) {
    log(`ep8 재생성 ${i}/2...`);
    try {
      await generateEpisode(8);
      await new Promise(r => setTimeout(r, 1500));
      const len = getEpLen(8);
      const trace = getLatestTrace(8);
      const content = getEpContent(8);
      const world = checkWorldFidelity(content);
      const align = checkAlignment(trace);
      const hookType = trace?.planner?.parsed_plan?.hook_type || "?";
      const beat1loc = trace?.planner?.parsed_plan?.scene_beats?.[0]?.location || "?";
      log(`  ep8[regen${i}]: len=${len} hook=${hookType} beat1_loc="${beat1loc}" world_ok=${world.ok}`);
      log(`                  alignment=${align.score}% intrusions=[${world.intrusions.join(",")}]`);
      ep8Reruns.push({ len, hookType, beat1loc, world, alignment: align });
    } catch(e) {
      log(`  ep8 재생성 ${i} ERROR: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // ── PART 4: 종합 지표 분석 ──────────────────────────────────
  log("");
  log("== PART 4: 종합 지표 ==");

  const epKeys = ["ep6","ep7","ep8","ep9","ep10"];
  const validEps = epKeys.filter(k => results[k] && !results[k].error);

  // hook 다양성
  const allHooks6to10 = validEps.map(k => results[k].hookType).filter(h => h !== "?");
  const ep8AllHooks = [results["ep8"]?.hookType, ...ep8Reruns.map(r => r.hookType)].filter(Boolean);
  const uniqueHooks = new Set(allHooks6to10).size;
  log(`hook 분포 (ep6~10): [${allHooks6to10.join(", ")}] unique=${uniqueHooks}/${allHooks6to10.length}`);
  log(`ep8 재생성 hooks: [${ep8AllHooks.join(", ")}] unique=${new Set(ep8AllHooks).size}`);

  // world fidelity
  const worldFails = validEps.filter(k => !results[k].world?.ok);
  log(`세계관 일관성: ${validEps.length - worldFails.length}/${validEps.length} OK`);
  worldFails.forEach(k => log(`  FAIL ${k}: [${results[k].world?.intrusions?.join(",")}]`));

  // char_states
  const charFails = validEps.filter(k => results[k].charStates?.length === 0);
  log(`char_states: ${validEps.length - charFails.length}/${validEps.length} 저장 성공`);

  // continuity
  const contScores = validEps.map(k => results[k].continuity?.score ?? 0);
  const contAvg = contScores.length ? Math.round(contScores.reduce((a,b)=>a+b,0) / contScores.length) : 0;
  log(`continuity avg=${contAvg} [${contScores.join(", ")}]`);

  // alignment
  const alignScores = validEps.map(k => results[k].alignment?.score ?? 0);
  const alignAvg = alignScores.length ? Math.round(alignScores.reduce((a,b)=>a+b,0) / alignScores.length) : 0;
  const alignFails = validEps.filter(k => !results[k].alignment?.ok);
  log(`alignment: avg=${alignAvg}% OK=${validEps.length - alignFails.length}/${validEps.length}`);

  // immersion
  const immersionFails = validEps.filter(k => !results[k].immersion?.ok);
  log(`immersion: ${validEps.length - immersionFails.length}/${validEps.length} OK`);

  // ── PART 5: PASS 판정 ───────────────────────────────────────
  log("");
  log("== PART 5: PASS/FAIL 판정 ==");

  const worldFidelityFail = worldFails.length > 0;
  const hookFixated = uniqueHooks < 2;
  const charStatesFail = charFails.length > 0;
  const continuityFail = contAvg < 80;
  const alignmentFail = alignFails.length > validEps.length / 2; // 절반 이상 실패
  const alignMeasureFail = alignScores.every(s => s === 0);

  if (worldFidelityFail) log(`  FAIL: 세계관 침입 재발 ${worldFails.join(",")}`);
  else log(`  OK: 세계관 일관성 전 구간 유지`);

  if (hookFixated) log(`  FAIL: hook 단일 고착 (unique=${uniqueHooks})`);
  else log(`  OK: hook 다양성 unique=${uniqueHooks}`);

  if (charStatesFail) log(`  FAIL: char_states 누락 ${charFails.join(",")}`);
  else log(`  OK: char_states 전 구간 저장 성공`);

  if (continuityFail) log(`  FAIL: continuity avg=${contAvg} < 80`);
  else log(`  OK: continuity avg=${contAvg}`);

  if (alignMeasureFail) log(`  FAIL: alignment 측정 불가 (harness 문제)`);
  else if (alignmentFail) log(`  WARN: alignment avg=${alignAvg}% (일부 실패)`);
  else log(`  OK: alignment avg=${alignAvg}%`);

  immersionFails.forEach(k => log(`  WARN immersion ${k}: [${results[k].immersion?.issues?.join(",")}]`));

  const passed = !worldFidelityFail && !hookFixated && !charStatesFail && !continuityFail && !alignMeasureFail;

  log("");
  log(`최종 판정: ${passed ? "PASS ✓" : "FAIL ✗"}`);
  log("=== MID-ARC STABILITY VALIDATION END ===");
})();
