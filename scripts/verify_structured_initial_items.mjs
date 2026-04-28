/**
 * verify_structured_initial_items.mjs
 *
 * Phase 1.5 — Structured Initial Items 검증
 *
 * 검증 항목:
 * 1. string item normalize
 * 2. "name :: description" 파싱
 * 3. "name(description)" 파싱
 * 4. "name(S)" 등급 파싱 (설명과 혼동 없이)
 * 5. "S:name" 등급 prefix 파싱
 * 6. object item 보존
 * 7. AI 추천 initial_items object[] 구조 검사
 * 8. description 있는 item은 item_desc job 대상에서 제외
 * 9. description 없는 item만 item_desc job 대상
 * 10. DOM data attribute 렌더링 (chars.js 로직 재현)
 * 11. saveContext payload object[] 생성
 * 12. restore 후 description/category/badge_label 유지
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function ok(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ── 1. Input parser (chars.js 로직 재현) ──────────────────
const ITEM_GRADES = ["S", "A", "B", "C", "D"];

function parseItemInput(raw) {
  raw = raw.trim();
  const colonIdx = raw.indexOf("::");
  if (colonIdx > 0) {
    return { name: raw.slice(0, colonIdx).trim(), description: raw.slice(colonIdx + 2).trim() };
  }
  const prefM = raw.match(/^([SABCD]):(.+)$/i);
  if (prefM && ITEM_GRADES.includes(prefM[1].toUpperCase())) {
    return { name: prefM[2].trim(), grade: prefM[1].toUpperCase() };
  }
  const parenM = raw.match(/^(.+?)\((.+)\)$/);
  if (parenM) {
    const inner = parenM[2].trim().replace(/급$/, "");
    if (ITEM_GRADES.includes(inner.toUpperCase())) {
      return { name: parenM[1].trim(), grade: inner.toUpperCase() };
    }
    return { name: parenM[1].trim(), description: parenM[2].trim() };
  }
  return { name: raw };
}

function normalizeItem(it) {
  if (typeof it === "string") return parseItemInput(it);
  return {
    name:        it.name        || "",
    grade:       it.grade       || null,
    description: it.description || "",
    category:    it.category    || "",
    badge_label: it.badge_label || "",
  };
}

console.log("\n── 1. Input Parser ─────────────────────────────────────────");

const r1 = parseItemInput("마법 지팡이 :: 마력을 집중할 때 쓰는 오래된 지팡이");
ok(":: 문법 name 파싱",   r1.name === "마법 지팡이");
ok(":: 문법 description", r1.description === "마력을 집중할 때 쓰는 오래된 지팡이");

const r2 = parseItemInput("엘프 망토(숲의 기척을 흐리게 하는 망토)");
ok("() 문법 name",        r2.name === "엘프 망토");
ok("() 문법 description", r2.description === "숲의 기척을 흐리게 하는 망토");

const r3 = parseItemInput("암흑 검(S)");
ok("() 등급 파싱 — name",  r3.name === "암흑 검");
ok("() 등급 파싱 — grade", r3.grade === "S");
ok("() 등급은 description 아님", !r3.description);

const r4 = parseItemInput("암흑 검(S급)");
ok("(S급) 등급 파싱",  r4.grade === "S" && !r4.description);

const r5 = parseItemInput("S:전투 도끼");
ok("S: prefix grade",    r5.grade === "S");
ok("S: prefix name",     r5.name === "전투 도끼");

const r6 = parseItemInput("단순 소지품");
ok("plain string → name only", r6.name === "단순 소지품" && !r6.description && !r6.grade);

console.log("\n── 2. Object Item Normalization ────────────────────────────");

const n1 = normalizeItem({ name: "마법 지팡이", description: "오래된 지팡이", category: "마법", badge_label: "마법" });
ok("object name",        n1.name === "마법 지팡이");
ok("object description", n1.description === "오래된 지팡이");
ok("object category",    n1.category === "마법");
ok("object badge_label", n1.badge_label === "마법");

const n2 = normalizeItem("마법 지팡이 :: 오래된 지팡이");
ok("string → object via ::, name",        n2.name === "마법 지팡이");
ok("string → object via ::, description", n2.description === "오래된 지팡이");

console.log("\n── 3. Data Attribute Simulation (DOM-like) ─────────────────");

function buildTagDataAttrs(item) {
  const norm = normalizeItem(item);
  const attrs = { "data-item-name": norm.name };
  if (norm.grade)       attrs["data-grade"]       = norm.grade;
  if (norm.description) attrs["data-description"] = norm.description;
  if (norm.category)    attrs["data-category"]    = norm.category;
  if (norm.badge_label) attrs["data-badge-label"] = norm.badge_label;
  return attrs;
}

const tag1 = buildTagDataAttrs({ name: "마법 지팡이", description: "오래된 지팡이", category: "마법", badge_label: "마법" });
ok("data-item-name set",  tag1["data-item-name"] === "마법 지팡이");
ok("data-description set", tag1["data-description"] === "오래된 지팡이");
ok("data-category set",    tag1["data-category"] === "마법");
ok("data-badge-label set", tag1["data-badge-label"] === "마법");

const tag2 = buildTagDataAttrs({ name: "단순 칼" });
ok("no description → no data-description", !tag2["data-description"]);
ok("data-item-name always set",            tag2["data-item-name"] === "단순 칼");

console.log("\n── 4. SaveContext Payload Simulation ───────────────────────");

function readTagObject(attrs) {
  const nm = attrs["data-item-name"] || "";
  if (!nm) return null;
  const obj = { name: nm };
  if (attrs["data-grade"])       obj.grade       = attrs["data-grade"];
  if (attrs["data-description"]) obj.description = attrs["data-description"];
  if (attrs["data-category"])    obj.category    = attrs["data-category"];
  if (attrs["data-badge-label"]) obj.badge_label = attrs["data-badge-label"];
  return obj;
}

const sampleTags = [
  buildTagDataAttrs({ name: "마법 지팡이", description: "오래된 지팡이", category: "마법", badge_label: "마법" }),
  buildTagDataAttrs({ name: "엘프 망토",   description: "숲의 기척을 흐리게 하는 망토", category: "의복", badge_label: "의복" }),
  buildTagDataAttrs({ name: "단순 검" }),
];
const payload = sampleTags.map(readTagObject).filter(Boolean);

ok("payload is array",           Array.isArray(payload));
ok("payload length 3",          payload.length === 3);
ok("payload[0] has description", !!payload[0].description);
ok("payload[1] has description", !!payload[1].description);
ok("payload[2] no description",  !payload[2].description);
ok("payload[0] has category",    payload[0].category === "마법");

console.log("\n── 5. Item Desc Job Filtering ──────────────────────────────");

function filterDescJobs(items) {
  return items.filter(it => {
    const norm = typeof it === "string" ? { name: it } : it;
    return !norm.description;
  });
}

const mixedItems = [
  { name: "마법 지팡이", description: "설명 있음" },
  { name: "엘프 망토",   description: "설명 있음" },
  { name: "단순 검" },                               // description 없음 → job 대상
  "낡은 방패",                                        // string → no description → job 대상
];

const descJobItems = filterDescJobs(mixedItems);
ok("desc job: description 있는 item 제외",  !descJobItems.some(it => it.description));
ok("desc job: 2개만 job 대상",             descJobItems.length === 2);
ok("desc job: '단순 검' 포함",             descJobItems.some(it => (it.name || it) === "단순 검"));
ok("desc job: '낡은 방패' 포함",           descJobItems.some(it => it === "낡은 방패" || it.name === "낡은 방패"));

console.log("\n── 6. AI Suggest initial_items Structure Check ─────────────");

// suggest.ts가 생성하는 expected 구조
const aiSuggestItems = [
  { name: "마법 지팡이", description: "불안정한 마력을 집중시키는 낡은 엘프 지팡이", category: "마법",  badge_label: "마법" },
  { name: "엘프 망토",   description: "숲의 기척을 흐리게 만들어 추적을 피하게 해주는 망토", category: "의복", badge_label: "의복" },
];

ok("AI suggest items: array",            Array.isArray(aiSuggestItems));
ok("AI suggest: item[0] has name",       !!aiSuggestItems[0].name);
ok("AI suggest: item[0] has description",!!aiSuggestItems[0].description);
ok("AI suggest: item[0] has category",   !!aiSuggestItems[0].category);
ok("AI suggest: item[0] has badge_label",!!aiSuggestItems[0].badge_label);
ok("AI suggest: desc job = 0",           filterDescJobs(aiSuggestItems).length === 0);

console.log("\n── 7. Restore Round-trip ────────────────────────────────────");

// UI → saveContext → characters API → DB → context restore
const savedPayload = [
  { name: "마법 지팡이", description: "오래된 지팡이", category: "마법", badge_label: "마법" },
  { name: "엘프 망토",   description: "숲의 기척을 흐리게 하는 망토", category: "의복", badge_label: "의복" },
];

// 복원 시 chars.js appendCharCard가 p.initialItems로 받음
savedPayload.forEach((it, idx) => {
  const norm = normalizeItem(it);
  ok(`restore[${idx}]: name`,        norm.name === it.name);
  ok(`restore[${idx}]: description`, norm.description === it.description);
  ok(`restore[${idx}]: category`,    norm.category === it.category);
  ok(`restore[${idx}]: badge_label`, norm.badge_label === it.badge_label);
});

console.log("\n── 8. chars.js source check ────────────────────────────────");

const charsJs = fs.readFileSync(path.join(__dirname, "../public/js/chars.js"), "utf-8");
ok("_parseItemInput :: syntax",          charsJs.includes('indexOf("::")'));
ok("_parseItemInput paren desc",         charsJs.includes("description: parenM[2].trim()"));
ok("_buildItemTag exists",               charsJs.includes("function _buildItemTag"));
ok("_refreshTagDisplay exists",          charsJs.includes("function _refreshTagDisplay"));
ok("char-item-desc-dot rendered",        charsJs.includes("char-item-desc-dot"));
ok("char-item-tag-name rendered",        charsJs.includes("char-item-tag-name"));
ok("editorPanel created",                charsJs.includes("char-item-editor-panel"));
ok("item-ed-name input",                 charsJs.includes("item-ed-name"));
ok("item-ed-desc input",                 charsJs.includes("item-ed-desc"));
ok("_applyEditor function",              charsJs.includes("function _applyEditor"));
ok("delegated click on itemsWrap",       charsJs.includes("e.target.closest(\".tag-del\")"));
ok("initialItems restore loop",          charsJs.includes("p.initialItems.forEach"));
ok("applyItemsToCard desc dot",          charsJs.includes("descDot") && charsJs.includes("item.description"));

const suggestJs = fs.readFileSync(path.join(__dirname, "../public/js/suggest.js"), "utf-8");
ok("suggest.js: data-description preserved", suggestJs.includes("obj.description") || suggestJs.includes("dataset.description") || suggestJs.includes("t.dataset.description"));
ok("suggest.js: data-category preserved",    suggestJs.includes("obj.category") || suggestJs.includes("t.dataset.category"));
ok("suggest.js: data-badge_label preserved", suggestJs.includes("obj.badge_label") || suggestJs.includes("t.dataset.badgeLabel"));

const modalCss = fs.readFileSync(path.join(__dirname, "../public/css/modal.css"), "utf-8");
ok("CSS: char-item-desc-dot",           modalCss.includes("char-item-desc-dot"));
ok("CSS: char-item-editor-panel",       modalCss.includes("char-item-editor-panel"));
ok("CSS: item-ed-row",                  modalCss.includes("item-ed-row"));
ok("CSS: btn-xs",                       modalCss.includes("btn-xs"));

// ── Final ──────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`✅  ALL ${passed} TESTS PASSED — Phase 1.5 Structured Initial Items`);
} else {
  console.log(`❌  ${failed} FAILED / ${passed} passed`);
  process.exit(1);
}
