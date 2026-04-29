/**
 * verify_item_name_integrity.mjs
 * item name 보존, canonical 우선, condition 분리 검증
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const rendererTs = readFileSync("src/pipeline/renderer.ts", "utf-8");
const stateExtTs = readFileSync("src/pipeline/state_extractor.ts", "utf-8");
const generateTs = readFileSync("src/api/generate.ts", "utf-8");

console.log("── renderer.ts item name 보존 검증 ──");
check("SKILL_PATTERNS 정의", rendererTs.includes("const SKILL_PATTERNS"));
check("canonical canonNameMap 구성", rendererTs.includes("canonNameMap"));
check("item name 변경 금지 지시", rendererTs.includes("이름 변경 금지"));
check("축약 금지 예시", rendererTs.includes("고성능 손전등"));
check("condition 괄호 표시 방식", rendererTs.includes("상태: ${cond}"));

console.log("\n── state_extractor.ts SKILL_RE 검증 ──");
check("SKILL_RE 정의", stateExtTs.includes("const SKILL_RE"));
check("must_keep_items SKILL_RE 필터", stateExtTs.includes("SKILL_RE.test(itemName)"));
check("char_summary SKILL_RE 필터", stateExtTs.includes("SKILL_RE.test(typeof i"));

console.log("\n── generate.ts canonical description 우선 검증 ──");
check("GENERIC_DESC_PATTERNS 정의", generateTs.includes("const GENERIC_DESC_PATTERNS"));
check("isGenericDesc 함수", generateTs.includes("isGenericDesc"));
check("canonical description wins over generic", generateTs.includes("ci?.description && isGenericDesc"));

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
