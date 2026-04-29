/**
 * verify_char_panel_loading_state.mjs
 * 책 전환 시 char panel 로딩 상태 즉시 표시 검증
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const authJs = readFileSync("public/js/auth.js", "utf-8");

console.log("── _showCharPanelLoading 검증 ──");
check("_showCharPanelLoading 함수 정의", authJs.includes("function _showCharPanelLoading"));
check("sceneCharPanel hidden=false", authJs.includes('panel.hidden = false'));
check("인물 정보 로딩 중 메시지", authJs.includes("인물 정보를 불러오는 중입니다"));
check("_clearStorySurface에서 _showCharPanelLoading 호출", (() => {
  const clearIdx = authJs.indexOf("function _clearStorySurface");
  if (clearIdx === -1) return false;
  const block = authJs.slice(clearIdx, clearIdx + 800);
  return block.includes("_showCharPanelLoading");
})());

console.log("\n── empty state 책 제목 표시 검증 ──");
check("empty-state-wrap 마크업", authJs.includes("empty-state-wrap"));
check("empty-state-title (책 제목)", authJs.includes("empty-state-title"));
check("아직 생성된 회차가 없습니다 메시지", authJs.includes("아직 생성된 회차가 없습니다"));
check("1화 생성 안내 메시지", authJs.includes("1화 생성을 눌러 시작하세요"));
check("activeBookTitle 조건부 표시", authJs.includes("activeBookTitle") && authJs.includes("empty-state-title"));

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
