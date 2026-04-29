/**
 * verify_suggest_runtime_paths.mjs
 * item_detail/item_refine API 전체 경로 검증
 * - parseResponseByTarget req.locked null guard
 * - item_detail/refine 응답 sanitize
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const suggestTs = readFileSync("src/api/suggest.ts", "utf-8");

console.log("── parseResponseByTarget null guard 검증 ──");
check("req.locked null guard 선언", suggestTs.includes("req.locked ??"));
check("lockedSettingSet via _locked", suggestTs.includes("new Set(_locked.settings)"));
check("lockedMoodSet via _locked",    suggestTs.includes("new Set(_locked.moods)"));
check("lockedCharSet via _locked",    suggestTs.includes("new Set(_locked.characters)"));

console.log("\n── item_detail/refine sanitize 검증 ──");
check("_sanitizeItemDescription 함수 정의", suggestTs.includes("function _sanitizeItemDescription") || suggestTs.includes("_sanitizeItemDescription ="));
check("지시문 제거: 숫자+자+이내", suggestTs.includes("이내|내외|이상|이하"));
check("item_detail case 존재", suggestTs.includes("case \"item_detail\"") || suggestTs.includes("item_detail:"));
check("item_refine case 존재",  suggestTs.includes("case \"item_refine\"")  || suggestTs.includes("item_refine:"));
check("item.name 원본 보존 (item_name || item.name)", suggestTs.includes("req.item_name") && suggestTs.includes("item.name"));

console.log("\n── /refine endpoint (callWorldSuggest) 검증 ──");
check("buildRefinePrompt 함수 정의", suggestTs.includes("function buildRefinePrompt") || suggestTs.includes("buildRefinePrompt"));
check("/refine에 callWorldSuggest 사용", (() => {
  const refineBlock = suggestTs.slice(suggestTs.indexOf('"/refine"') > -1 ? suggestTs.indexOf('"/refine"') : suggestTs.indexOf("'/refine'"));
  return refineBlock.includes("callWorldSuggest");
})());
check("refine 응답 plain text 파싱 (replace JSON 제거)", suggestTs.includes('replace(/^```'));
check("refine: sentence-bound trim 500자", suggestTs.includes("_trimToSentence") && suggestTs.includes("500"));

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
