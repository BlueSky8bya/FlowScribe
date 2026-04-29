/**
 * verify_suggest_actions.mjs
 * suggest.js / suggest.ts의 item 추천 관련 동작 검증
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const suggestJs = readFileSync("public/js/suggest.js", "utf-8");
const suggestTs = readFileSync("src/api/suggest.ts", "utf-8");

console.log("── suggest.js 검증 ──");
check("item_detail target 존재", suggestJs.includes(`target: "item_detail"`));
check("item_refine target 존재", suggestJs.includes(`target: "item_refine"`));
check("suggestItemDetail 함수 존재", suggestJs.includes("async function suggestItemDetail"));
check("suggestItemRefine 함수 존재", suggestJs.includes("async function suggestItemRefine"));
check("suggestItemDetail: API error logging", suggestJs.includes("[suggestItemDetail] API error"));
check("suggestItemRefine: API error logging", suggestJs.includes("[suggestItemRefine] API error"));
check("refinePersonality: length guard", suggestJs.includes("json.val.length < personality.length"));
check("refinePersonality: res.ok check", suggestJs.includes("[refine] API error"));
check("item_refine: description만 덮어씀 name 불변", suggestJs.includes("item-ed-desc") && !suggestJs.includes("item-ed-name.value = item.name"));

console.log("\n── suggest.ts 검증 ──");
check("item_detail prompt 존재", suggestTs.includes("getItemDetailPrompt"));
check("item_refine prompt 존재", suggestTs.includes("getItemRefinePrompt"));
check("_sanitizeItemDescription 함수 존재", suggestTs.includes("_sanitizeItemDescription"));
check("sanitize: 자 이내 제거", suggestTs.includes("자\\s*(이내|내외|이상|이하|정도)"));
check("item parsing uses cleaned (not raw)", suggestTs.includes("cleaned.match(/\\{[\\s\\S]*\\}/)"));
check("item name = req.item_name (요청 원본 우선)", suggestTs.includes("req.item_name || item.name"));
check("refine: callWorldSuggest 사용 (requestModel 대신)", suggestTs.includes("callWorldSuggest(prompt)") && suggestTs.includes("buildRefinePrompt"));
check("refine: sentence-bound trim 500자", suggestTs.includes("_trimToSentence") && suggestTs.includes("500"));
check("buildRefinePrompt: minLen 계산", suggestTs.includes("personality.length + 20"));
check("buildRefinePrompt: 5요소 포함", suggestTs.includes("결핍 또는 두려움"));

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
