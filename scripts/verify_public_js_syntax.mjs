/**
 * verify_public_js_syntax.mjs
 * public/js/*.js syntax check — generate.js regex 사고 재발 방지
 * 신뢰할 수 있는 게이트: node --check (Node.js 파서가 직접 검증)
 */
import { execSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, "..");
const jsDir = resolve(root, "public/js");
const read  = rel => readFileSync(resolve(root, rel), "utf8");

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`✓ ${label}`); passed++; }
  else      { console.error(`✗ ${label}`); failed++; }
}

// ── node --check for every public/js/*.js ─────────────────────
const jsFiles = readdirSync(jsDir).filter(f => f.endsWith(".js")).sort();
for (const f of jsFiles) {
  const abs = resolve(jsDir, f);
  let ok = true, errLine = "";
  try { execSync(`node --check "${abs}"`, { stdio: "pipe" }); }
  catch (e) {
    ok = false;
    errLine = (e.stderr?.toString() || e.message).split("\n").slice(0, 3).join(" | ");
  }
  check(`syntax OK: public/js/${f}${ok ? "" : " — " + errLine}`, ok);
}

// ── Critical function existence in generate.js ───────────────
const gen  = read("public/js/generate.js");
const auth = read("public/js/auth.js");
const app  = read("public/js/app.js");

check("generate.js: renderProgressive",    gen.includes("function renderProgressive"));
check("generate.js: renderProgressiveRaw", gen.includes("function renderProgressiveRaw"));
check("generate.js: _nextEpNum",           gen.includes("_nextEpNum"));
check("generate.js: _prevEpNum",           gen.includes("_prevEpNum"));
check("generate.js: toggleDebugDrawer",    gen.includes("toggleDebugDrawer"));
check("generate.js: generate 함수",        /\bfunction generate\b/.test(gen));
check("generate.js: regenerate",           gen.includes("regenerate"));
check("generate.js: viewPrev",             gen.includes("viewPrev"));
check("generate.js: viewNext",             gen.includes("viewNext"));

check("auth.js: selectBook",               auth.includes("async function selectBook"));
check("app.js: updateEpisodeUI",           app.includes("function updateEpisodeUI"));

console.log(`\n${"─".repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
