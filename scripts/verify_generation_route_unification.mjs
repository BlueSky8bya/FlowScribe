/**
 * verify_generation_route_unification.mjs
 * generate.ts (브라우저 경로)와 generate_v2.ts의 후처리 단계 동기화 검증
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}`); failed++; }
}

const genTs   = readFileSync(join(root, "src/api/generate.ts"),    "utf8");
const genV2Ts = readFileSync(join(root, "src/api/generate_v2.ts"), "utf8");
const pipeTs  = readFileSync(join(root, "src/pipeline/index.ts"),  "utf8");
const genJs   = readFileSync(join(root, "public/js/generate.js"),  "utf8");

console.log("\n═══════════════════════════════════════════════════════");
console.log(" VERIFY — Generation Route Unification");
console.log("═══════════════════════════════════════════════════════\n");

// ── 1. 브라우저 fetch 경로 확인 ──────────────────────────────
console.log("[1] Browser fetch route");
check("브라우저가 /api/generate (generate.ts) 사용",
  genJs.includes("/api/generate?") || genJs.includes("`/api/generate?"));
check("브라우저가 generate-v2 직접 호출 없음",
  !genJs.includes("/api/generate-v2"));

// ── 2. generate.ts planner 경로에 필수 후처리 존재 ───────────
console.log("\n[2] generate.ts planner path post-processing");
check("regen isolation: character_dynamic_states DELETE",
  genTs.includes("DELETE FROM character_dynamic_states"));
check("regen isolation: foreshadows DELETE",
  genTs.includes("DELETE FROM foreshadows"));
check("extractAndStoreForeshadow import",
  genTs.includes("extractAndStoreForeshadow"));
check("checkAndResolveForeshadows import",
  genTs.includes("checkAndResolveForeshadows"));
check("generateAndSaveArcSummary import",
  genTs.includes("generateAndSaveArcSummary"));
check("ARC_SIZE import",
  genTs.includes("ARC_SIZE"));
check("saveEpisodeSnapshot import",
  genTs.includes("saveEpisodeSnapshot"));
check("extractAndStoreForeshadow 호출",
  genTs.includes("await extractAndStoreForeshadow("));
check("checkAndResolveForeshadows 호출",
  genTs.includes("await checkAndResolveForeshadows("));
check("generateAndSaveArcSummary 호출",
  genTs.includes("await generateAndSaveArcSummary("));
check("saveEpisodeSnapshot 호출",
  genTs.includes("saveEpisodeSnapshot("));
check("setImmediate로 비동기 후처리",
  genTs.includes("setImmediate(async"));

// ── 3. generate_v2.ts planner 경로에도 동일 단계 존재 (기준) ─
console.log("\n[3] generate_v2.ts planner path (baseline)");
check("v2: extractAndStoreForeshadow",
  genV2Ts.includes("extractAndStoreForeshadow"));
check("v2: generateAndSaveArcSummary",
  genV2Ts.includes("generateAndSaveArcSummary"));
check("v2: regen isolation DELETE",
  genV2Ts.includes("DELETE FROM character_dynamic_states"));

// ── 4. pipeline이 공통 단계 처리 ──────────────────────────────
console.log("\n[4] pipeline/index.ts shared steps");
check("pipeline: sanitizeGeneratedBody",
  pipeTs.includes("sanitizeGeneratedBody"));
check("pipeline: language_guard normalizeStateUpdate",
  pipeTs.includes("normalizeStateUpdate"));
check("pipeline: item_ledger normalizeItems",
  pipeTs.includes("normalizeItems"));
check("pipeline: episode_delta_contract checkEpisodeDelta",
  pipeTs.includes("checkEpisodeDelta"));
check("pipeline: commitDynamicState",
  pipeTs.includes("commitDynamicState"));

// ── 5. route divergence 항목 없음 ────────────────────────────
console.log("\n[5] Route divergence check");
// generate.ts에 scheduleBackgroundAudit 있음
check("generate.ts: scheduleBackgroundAudit",
  genTs.includes("scheduleBackgroundAudit"));
// generate_v2.ts에서도 planner 경로에 scheduleBackgroundAudit 있음 (enable_trace 조건부)
check("generate_v2.ts: scheduleBackgroundAudit",
  genV2Ts.includes("scheduleBackgroundAudit"));

console.log("\n───────────────────────────────────────────────────────");
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error("❌ ROUTE UNIFICATION: FAIL"); process.exit(1); }
else              console.log("✅ ROUTE UNIFICATION: PASS");
