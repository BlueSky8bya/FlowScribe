/**
 * verify_item_category_source_priority.mjs — POST-1 §P1-A reopen-3 (C-lite)
 *
 * char-states API의 vocab > canonical category 우선 정책 + classify prompt 일관성을
 * 정적 검증.
 *
 * 검증:
 *   1. char-states 핸들러에서 vocab.category가 "기타"가 아니면 canonical it.category
 *      보다 우선해야 함 (source priority).
 *   2. vocab miss이거나 vocab "기타"인 경우 missingForClassify에 큐잉되어 다음 호출에
 *      vocab 누적 효과를 받음.
 *   3. classifyItemNamesViaLLM과 generateAndSaveItemDescriptions가 같은 _CATEGORY_GUIDE
 *      를 사용 — initial item 분류와 dynamic item 분류 기준 일관성.
 *   4. _CATEGORY_GUIDE에 식량·의료·도구 핵심 의미 정의 포함 (특히 "음식·식수는 식량")
 */
import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const check = (s, c, d) => c ? ok(s) : ng(s, d);

const generateApi = readFileSync("src/api/generate.ts", "utf8");
const itemDesc    = readFileSync("src/services/item_desc.ts", "utf8");

console.log("── [1] char-states vocab > canonical priority ──");
check(
  "vocab.category 'not 기타' 우선 분기 존재",
  /v\.category\s*!==\s*["']기타["']/.test(generateApi)
);
check(
  "vocab 우선 시 it.category 무시 — vocab 우선 return 패턴",
  /v\.category\s*!==\s*["']기타["'][\s\S]{0,200}return\s*\{[\s\S]{0,80}category:\s*v\.category/.test(generateApi)
);
check(
  "vocab miss 또는 vocab '기타' 시 missingForClassify 큐잉",
  /missingForClassify\.set\(/.test(generateApi)
);
check(
  "missingForClassify가 classifyAndSaveItemCategories에 전달",
  /classifyAndSaveItemCategories\(\{[\s\S]{0,300}items:\s*Array\.from\(missingForClassify\.values\(\)\)/.test(generateApi)
);

console.log("\n── [2] classify prompt 정합성 ──");
check(
  "_CATEGORY_GUIDE 정의 (item_desc.ts module-level)",
  /const\s+_CATEGORY_GUIDE\s*=/.test(itemDesc)
);
check(
  "classifyItemNamesViaLLM이 _CATEGORY_GUIDE 사용",
  /classifyItemNamesViaLLM[\s\S]{0,5000}_CATEGORY_GUIDE/.test(itemDesc)
);
check(
  "generateAndSaveItemDescriptions가 _CATEGORY_GUIDE 사용 (initial item 분류 일관성)",
  /generateAndSaveItemDescriptions[\s\S]{0,5000}_CATEGORY_GUIDE/.test(itemDesc)
);

console.log("\n── [3] _CATEGORY_GUIDE 핵심 분류 기준 ──");
const guideMatch = itemDesc.match(/const\s+_CATEGORY_GUIDE\s*=\s*`([\s\S]+?)`/);
const guide = guideMatch ? guideMatch[1] : "";
check(
  "식량 정의에 '영양 보충' 포함 (음식·물·생존용 식품)",
  /식량[^\n]{0,200}영양\s*보충/.test(guide)
);
check(
  "음식·식수는 반드시 식량 — 도구·소모품으로 보내지 말라는 명시",
  /음식[\s·]*식수[\s\S]{0,200}식량[\s\S]{0,200}(?:도구|소모품)/.test(guide)
);
check(
  "의료 정의 포함 (약품·치료)",
  /의료[\s\S]{0,200}(?:치료|약품|응급처치)/.test(guide)
);
check(
  "도구 정의 포함 (작업·수리·조작)",
  /도구[\s\S]{0,200}(?:작업|수리|조작)/.test(guide)
);

console.log("\n── [4] CATEGORY_BADGE map에 의료 추가 ──");
check(
  "CATEGORY_BADGE에 의료 enum 등록",
  /CATEGORY_BADGE[\s\S]{0,500}의료:\s*["']의료["']/.test(itemDesc)
);

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
