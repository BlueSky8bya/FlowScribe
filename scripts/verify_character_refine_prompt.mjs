/**
 * verify_character_refine_prompt.mjs
 * 인물 성격 구체화 — buildRefinePrompt + callWorldSuggest 경로 검증
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const suggestTs = readFileSync("src/api/suggest.ts", "utf-8");

console.log("── buildRefinePrompt 검증 ──");
check("buildRefinePrompt 함수 정의", suggestTs.includes("buildRefinePrompt"));
check("minLen 계산 (personality.length + 20)", suggestTs.includes("personality.length + 20"));
check("plain text 출력 지시 (JSON 금지)", suggestTs.includes("JSON") && suggestTs.includes("금지"));
check("최대 1000자 이내 언급", suggestTs.includes("1000자 이내") || suggestTs.includes("최대 1000자"));
check("목록 형식 금지 언급", suggestTs.includes("목록 형식 금지"));

console.log("\n── /refine 엔드포인트 callWorldSuggest 사용 검증 ──");
check("callWorldSuggest import or 호출 존재", suggestTs.includes("callWorldSuggest"));
check("requestModel 대신 callWorldSuggest 사용", (() => {
  // /refine 블록에서 requestModel이 아닌 callWorldSuggest를 사용하는지 확인
  const idx = suggestTs.indexOf('"/refine"') > -1 ? suggestTs.indexOf('"/refine"') : suggestTs.indexOf("'/refine'");
  if (idx === -1) return false;
  const block = suggestTs.slice(idx, idx + 1500);
  return block.includes("callWorldSuggest") && !block.slice(0, 800).includes("requestModel(");
})());
check("응답 코드블록 제거 (.replace)", suggestTs.includes('replace(/^```[\\w]*\\n?/gm'));
check("20자 미만이면 원본 반환", suggestTs.includes("val.length < 20") || suggestTs.includes("length < 20"));

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
