/**
 * verify_empty_state_cta.mjs
 * empty state CTA 버튼 및 footer sendBtn 표시/숨김 검증
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const authJs = readFileSync("public/js/auth.js", "utf-8");
const appJs  = readFileSync("public/js/app.js", "utf-8");

console.log("── empty state 구조 검증 ──");
check("empty-state-wrap 마크업", authJs.includes("empty-state-wrap"));
check("empty-state-title 책 제목", authJs.includes("empty-state-title"));
check("아직 생성된 회차가 없습니다 메시지", authJs.includes("아직 생성된 회차가 없습니다"));
check("empty-state-cta 버튼 마크업", authJs.includes("empty-state-cta"));
check("empty-state-cta onclick generate()", authJs.includes("onclick=\"generate()\""));

console.log("\n── footer sendBtn 표시/숨김 검증 ──");
check("updateEpisodeUI에서 _noEpisodes 조건 처리", appJs.includes("_noEpisodes"));
check("_noEpisodes = displayedEpisode === null && currentEpisode === 1", appJs.includes("displayedEpisode === null && currentEpisode === 1"));
check("_noEpisodes 시 btn.style.display = \"none\"", appJs.includes('btn.style.display = _noEpisodes ? "none" : ""') || appJs.includes("display = _noEpisodes"));

console.log("\n── generation notice 검증 ──");
check("window._fsActiveGen 선언", authJs.includes("window._fsActiveGen") || readFileSync("public/js/generate.js","utf-8").includes("window._fsActiveGen = null"));
check("selectBook: active generation 감지 toast", authJs.includes("_ag.status === \"generating\"") || authJs.includes("_fsActiveGen"));

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
