/**
 * verify_empty_state_cta.mjs
 * empty state CTA 버튼, 세계관 설정 버튼, world setup gate 검증
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const authJs   = readFileSync("public/js/auth.js", "utf-8");
const appJs    = readFileSync("public/js/app.js", "utf-8");
const modalJs  = readFileSync("public/js/modal.js", "utf-8");
const generateJs = readFileSync("public/js/generate.js", "utf-8");

console.log("── empty state 구조 검증 ──");
check("empty-state-wrap id=emptyStateCTA", authJs.includes('id="emptyStateCTA"'));
check("empty-state-title 책 제목",        authJs.includes("empty-state-title"));
check("아직 생성된 회차가 없습니다 메시지", authJs.includes("아직 생성된 회차가 없습니다"));
check("emptyStateHint id 존재",           authJs.includes('id="emptyStateHint"'));

console.log("\n── 세계관 설정 버튼 검증 ──");
check("empty-state-cta-settings 버튼",   authJs.includes("empty-state-cta-settings"));
check("세계관 설정 버튼 onclick=openModal", authJs.includes('onclick="openModal()"') && authJs.includes("empty-state-cta-settings"));
check("1화 생성 전에 세계관 설정 버튼 배치 (먼저)", (() => {
  const idx = authJs.indexOf("empty-state-cta-settings");
  const idx2 = authJs.indexOf("emptyStateGenBtn");
  return idx !== -1 && idx2 !== -1 && idx < idx2;
})());

console.log("\n── 1화 생성 버튼 + world setup gate 검증 ──");
check("emptyStateGenBtn id 존재",         authJs.includes('id="emptyStateGenBtn"'));
check("초기 disabled 상태",               authJs.includes('id="emptyStateGenBtn" onclick="generate()" disabled'));
check("isWorldSetupReady 함수 정의",      appJs.includes("function isWorldSetupReady"));
check("settingVals.length > 0 조건",      appJs.includes("settingVals.length > 0"));
check("moodVals.length > 0 조건",         appJs.includes("moodVals.length > 0"));
check("bookId 체크",                      appJs.includes("if (!bookId) return false"));

console.log("\n── _syncEmptyStateCTA 동기화 검증 ──");
check("_syncEmptyStateCTA 함수 정의",     appJs.includes("function _syncEmptyStateCTA"));
check("window._syncEmptyStateCTA 노출",  appJs.includes("window._syncEmptyStateCTA = _syncEmptyStateCTA"));
check("완료 시 힌트 텍스트 갱신",         appJs.includes("이제 1화를 생성할 수 있습니다."));
check("미완료 힌트 텍스트",               appJs.includes("먼저 세계관을 설정한 뒤 1화를 생성하세요."));
check("genBtn.disabled 토글",            appJs.includes("genBtn.disabled = !ready"));
check("updateEpisodeUI에서 _syncEmptyStateCTA 호출", appJs.includes("_syncEmptyStateCTA()"));

console.log("\n── saveContext 후 버튼 상태 즉시 갱신 검증 ──");
check("saveContext 후 _syncEmptyStateCTA 호출", modalJs.includes("_syncEmptyStateCTA?.()") || modalJs.includes("_syncEmptyStateCTA()"));

console.log("\n── context restore 후 버튼 상태 갱신 검증 ──");
check("_restoreContextSafely 후 _syncEmptyStateCTA 호출", authJs.includes("_syncEmptyStateCTA?.()"));

console.log("\n── footer sendBtn 표시/숨김 검증 ──");
check("updateEpisodeUI에서 _noEpisodes 조건 처리", appJs.includes("_noEpisodes"));
check("_noEpisodes = displayedEpisode === null && currentEpisode === 1", appJs.includes("displayedEpisode === null && currentEpisode === 1"));
check("_noEpisodes 시 btn 숨김", appJs.includes('_noEpisodes ? "none" : ""') || appJs.includes("display = _noEpisodes"));

console.log("\n── generation notice 검증 ──");
check("window._fsActiveGen 등록 (generate)", generateJs.includes("window._fsActiveGen = {"));
check("selectBook: active generation 감지", authJs.includes("_fsActiveGen"));

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
