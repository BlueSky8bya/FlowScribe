/**
 * verify_generation_session_guard.mjs
 * generation stream isolation 및 saveEpisode targetBookId 검증
 *
 * POST-2 P3-V1 refresh — token handler / onerror 안의 stale check를 정확한
 * 코드 anchor 기준으로 검증. 이전 fixed string ("token discarded (stale session)",
 * "onerror: session stale")이 실제 한국어 toast 흐름과 어긋나 stale fail이었음.
 * 실제 기능은 정상 — 사용자 면에서 토큰 오염 차단, 토스트 1회 표시, 원래 책 저장.
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const generateJs = readFileSync("public/js/generate.js", "utf-8");

// anchor-based slice helper — token handler / onerror 영역을 정확히 추출.
function sliceAround(src, anchor, len = 1500) {
  const idx = src.indexOf(anchor);
  return idx >= 0 ? src.slice(idx, idx + len) : "";
}

console.log("── generation session guard 검증 ──");
check("_genSession 선언 존재", generateJs.includes("const _genSession = {"));
check("bookIdAtStart 캡처", generateJs.includes("bookIdAtStart: bookId"));
check("SSE URL에 bookIdAtStart 사용", generateJs.includes("book_id=${_genSession.bookIdAtStart}"));
check("_finishGeneration: session stale check", generateJs.includes("bookId !== _genSession.bookIdAtStart"));
check("_finishGeneration: stale 시 saveEpisode to original book", generateJs.includes("saveEpisode(episodeNum, rawText, _genSession.bookIdAtStart)"));

// token handler stale check — `rawText += json.token` 라인 주변에 stale 차단 + 1회 toast.
{
  const tokSlice = sliceAround(generateJs, "rawText += json.token", 1800);
  check(
    "token handler: stale check (bookId !== _genSession.bookIdAtStart + early return)",
    /bookId\s*!==\s*_genSession\.bookIdAtStart/.test(tokSlice) && /return\s*;/.test(tokSlice)
  );
  check(
    "token handler: stale toast 1회만 (_staleMsgShown flag)",
    /_staleMsgShown/.test(tokSlice) && /showToast/.test(tokSlice)
  );
  check(
    "token handler: toast 메시지 contract (다른 책으로 이동 + 원래 책에 저장)",
    /다른\s*책으로\s*이동/.test(tokSlice) && /원래\s*책에\s*저장/.test(tokSlice)
  );
}

// onerror stale check — `es.onerror` 함수 본문 안에 sessionStale 변수.
{
  const onerrSlice = sliceAround(generateJs, "es.onerror", 1500);
  check(
    "onerror: sessionStale = bookId !== _genSession.bookIdAtStart",
    /const\s+sessionStale\s*=\s*bookId\s*!==\s*_genSession\.bookIdAtStart/.test(onerrSlice)
  );
}

console.log("\n── char panel stale guard 검증 ──");
check("_charPanelRequestSeq 선언", generateJs.includes("let _charPanelRequestSeq = 0"));
check("reqSeq 캡처", generateJs.includes("const reqSeq = ++_charPanelRequestSeq"));
check("stale check: reqSeq !== _charPanelRequestSeq", generateJs.includes("reqSeq !== _charPanelRequestSeq"));
check("stale debug log", generateJs.includes("[char-panel] stale response ignored"));
check("post-gen refresh (1s vocab wait)", generateJs.includes("_loadAndApplyCharStates(episodeNum)") && generateJs.includes("1000"));

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
