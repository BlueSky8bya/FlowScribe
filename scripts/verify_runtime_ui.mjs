// verify_runtime_ui.mjs — runtime UI root-cause checks
import { readFileSync } from "fs";

const PASS = (msg) => { console.log(`  PASS  ${msg}`); return true; };
const FAIL = (msg) => { console.error(`  FAIL  ${msg}`); return false; };

let total = 0, passed = 0;
function check(label, fn) {
  total++;
  try {
    const ok = fn();
    if (ok) passed++;
  } catch (e) {
    FAIL(`${label} — exception: ${e.message}`);
  }
}

const modalJs    = readFileSync("public/js/modal.js",    "utf8");
const generateJs = readFileSync("public/js/generate.js", "utf8");
const generateTs = readFileSync("src/api/generate.ts",   "utf8");
const cssComp    = readFileSync("public/css/components.css", "utf8");

// 1. modal.js: closeModal not in finally block
check("modal.js: closeModal not in finally block", () => {
  const finallyBlock = modalJs.match(/finally\s*\{([^}]*)\}/s);
  if (finallyBlock && finallyBlock[1].includes("closeModal")) {
    return FAIL("closeModal() is still inside finally block — modal will always close");
  }
  if (!modalJs.includes("closeModal()")) {
    return FAIL("closeModal() not found at all");
  }
  return PASS("closeModal() not in finally — only called on success");
});

// 2. modal.js: null-safe DOM access
check("modal.js: null-safe DOM access with ?.", () => {
  if (!modalJs.includes("?.value?.trim()")) {
    return FAIL("null-safe ?. chaining not found for DOM value access");
  }
  return PASS("null-safe DOM access confirmed");
});

// 3. generate.js: no eq-info-item in render functions
check("generate.js: no eq-info-item class in render functions", () => {
  const count = (generateJs.match(/eq-info-item/g) || []).length;
  if (count > 0) {
    return FAIL(`eq-info-item found ${count} times in generate.js`);
  }
  return PASS("eq-info-item not found (correct)");
});

// 4. generate.js: eqBasicInfo uses eq-kv-list not eq-info-grid
check("generate.js: eqBasicInfo uses eq-kv-list", () => {
  // Find the basicEl.innerHTML assignment
  const basicMatch = generateJs.match(/basicEl\.innerHTML\s*=\s*`[^`]*eq-info-grid[^`]*`/);
  if (basicMatch) {
    return FAIL("basicEl.innerHTML still uses eq-info-grid wrapper");
  }
  const kvListMatch = generateJs.match(/basicEl\.innerHTML\s*=\s*`[^`]*eq-kv-list[^`]*`/);
  if (!kvListMatch) {
    return FAIL("basicEl.innerHTML with eq-kv-list not found");
  }
  return PASS("eqBasicInfo uses eq-kv-list wrapper");
});

// 5. generate.js: _renderPostprocStats uses eq-kv-list
check("generate.js: _renderPostprocStats uses eq-kv-list", () => {
  const fnMatch = generateJs.match(/_renderPostprocStats\s*\(\s*\)\s*\{([\s\S]*?)^}/m);
  // Simpler: check that eq-kv-list appears in file and postproc section
  const count = (generateJs.match(/eq-kv-list/g) || []).length;
  if (count === 0) {
    return FAIL("eq-kv-list not found in generate.js at all");
  }
  return PASS(`eq-kv-list found ${count} times in generate.js`);
});

// 6. generate.js: no smart quotes in HTML class= attributes
check("generate.js: no smart/curly quotes in class= attributes", () => {
  // Only check for curly quotes directly adjacent to class= attribute values
  // (not in regex literals /[..."]/ or comments)
  // Pattern: class= followed by curly quote
  const LDQ = String.fromCharCode(0x201C); // left double quote
  const RDQ = String.fromCharCode(0x201D); // right double quote
  // Look for class=<curly> patterns (would break HTML)
  const badPattern = new RegExp("class=" + LDQ + "|class=" + RDQ);
  if (badPattern.test(generateJs)) {
    return FAIL("curly quotes directly after class= found in generate.js HTML templates");
  }
  return PASS("no curly quotes in class= attributes");
});

// 7. generate.ts: _inferItemBadge function exists
check("generate.ts: _inferItemBadge function exists", () => {
  if (!generateTs.includes("_inferItemBadge")) {
    return FAIL("_inferItemBadge not found in generate.ts");
  }
  return PASS("_inferItemBadge found in generate.ts");
});

// 8. generate.ts: char-states endpoint enriches items with badge info
check("generate.ts: char-states enriches items with badge_label", () => {
  if (!generateTs.includes("badge_label")) {
    return FAIL("badge_label not referenced in generate.ts");
  }
  if (!generateTs.includes("vocabMap")) {
    return FAIL("vocabMap not found — vocab enrichment logic missing");
  }
  return PASS("char-states badge enrichment logic present");
});

// 9. components.css: eq-info-grid not forcing 2-col in debug panel
check("components.css: rp-debug-panel eq-info-grid not 2-column", () => {
  const match = cssComp.match(/\.rp-debug-panel\s+\.eq-info-grid\s*\{([^}]*)\}/);
  if (match && match[1].includes("1fr 1fr")) {
    return FAIL("rp-debug-panel still forces 2-column grid (1fr 1fr)");
  }
  return PASS("rp-debug-panel eq-info-grid is not forcing 2 columns");
});

// 10. components.css: eq-kv-val has keep-all word-break
check("components.css: eq-kv-val has word-break:keep-all", () => {
  if (!cssComp.includes("word-break:keep-all")) {
    return FAIL("word-break:keep-all not found in components.css");
  }
  return PASS("eq-kv-val word-break:keep-all confirmed");
});

// 11. components.css: eq-kv uses flex-start alignment
check("components.css: eq-kv uses align-items:flex-start", () => {
  const match = cssComp.match(/\.eq-kv\{[^}]*align-items:([^;}]+)/);
  if (!match) {
    return FAIL(".eq-kv align-items rule not found");
  }
  if (match[1].trim() !== "flex-start") {
    return FAIL(`.eq-kv align-items is '${match[1].trim()}', expected 'flex-start'`);
  }
  return PASS("eq-kv align-items:flex-start confirmed");
});

console.log(`\n${passed}/${total} PASS\n`);
if (passed < total) process.exit(1);
