/**
 * verify_generation_session_guard.mjs
 * generation stream isolation 및 saveEpisode targetBookId 검증
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const generateJs = readFileSync("public/js/generate.js", "utf-8");

console.log("── generation session guard 검증 ──");
check("_genSession 선언 존재", generateJs.includes("const _genSession = {"));
check("bookIdAtStart 캡처", generateJs.includes("bookIdAtStart: bookId"));
check("SSE URL에 bookIdAtStart 사용", generateJs.includes("book_id=${_genSession.bookIdAtStart}"));
check("_finishGeneration: session stale check", generateJs.includes("bookId !== _genSession.bookIdAtStart"));
check("_finishGeneration: stale 시 saveEpisode to original book", generateJs.includes("saveEpisode(episodeNum, rawText, _genSession.bookIdAtStart)"));
check("token handler: stale check", generateJs.includes("token discarded (stale session)"));
check("onerror: stale check", generateJs.includes("onerror: session stale"));

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
