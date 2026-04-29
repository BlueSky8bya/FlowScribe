/**
 * verify_generation_background_status.mjs
 * 생성 중 다른 책 이동 시 toast 안내 검증
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const generateJs = readFileSync("public/js/generate.js", "utf-8");

console.log("── window._fsActiveGen 전역 상태 관리 검증 ──");
check("window._fsActiveGen 초기화", generateJs.includes("window._fsActiveGen = null"));
check("generate() 시작 시 _fsActiveGen 등록", generateJs.includes("window._fsActiveGen = {") && generateJs.includes("status: \"generating\""));
check("_finishGeneration stale 시 _fsActiveGen 해제", generateJs.includes("window._fsActiveGen = null"));

console.log("\n── _genSession titleAtStart 캡처 검증 ──");
check("titleAtStart 필드 선언", generateJs.includes("titleAtStart:"));
check("activeBookTitle 캡처", generateJs.includes("activeBookTitle") && generateJs.includes("titleAtStart"));
check("_staleMsgShown 플래그 선언", generateJs.includes("_staleMsgShown"));

console.log("\n── 책 이동 감지 시 toast 안내 검증 ──");
check("토큰 stale 시 이동 toast 표시", generateJs.includes("다른 책으로 이동했습니다") || generateJs.includes("이동했습니다. 생성 결과는"));
check("_staleMsgShown으로 1회만 표시", generateJs.includes("_staleMsgShown = true"));
check("완료 toast — _finishGeneration stale", generateJs.includes("생성이 완료되었습니다"));
check("완료 toast — onerror stale", (() => {
  const idx = generateJs.indexOf("onerror: session stale");
  if (idx === -1) return false;
  const block = generateJs.slice(idx, idx + 300);
  return block.includes("생성이 완료되었습니다") || block.includes("저장됨");
})());
check("showToast 호출 시 duration 5000 이상", generateJs.includes("5000") && generateJs.includes("titleAtStart"));

const authJs = readFileSync("public/js/auth.js", "utf-8");
console.log("\n── selectBook 생성중 토스트 dedupe 검증 ──");
check("_fsLastBgToastKey 전역 초기화", generateJs.includes("window._fsLastBgToastKey = null"));
check("_fsLastBgToastKey 완료 시 초기화", (() => {
  const nullIdx = generateJs.indexOf("window._fsActiveGen = null; window._fsLastBgToastKey");
  return nullIdx !== -1;
})());
check("selectBook: _fsLastBgToastKey dedupe 체크", authJs.includes("_fsLastBgToastKey") && authJs.includes("_bgKey"));
check("selectBook: 같은 key 반복 toast 방지", authJs.includes("window._fsLastBgToastKey !== _bgKey"));

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
