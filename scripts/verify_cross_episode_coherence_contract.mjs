/**
 * verify_cross_episode_coherence_contract.mjs — Phase 4.11 contract 검증
 */
import { readFileSync, existsSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

// ── 1. ContinuityContract 타입 확장 ─────────────────────────
const typesSrc = readFileSync("src/types/canonical.ts", "utf8");
console.log("── [1] ContinuityContract 타입 확장 ──");
check("character_position_state 필드 추가", typesSrc.includes("character_position_state"));
check("필드 구조: last_location/visibility/items", typesSrc.includes("last_location") && typesSrc.includes("visibility:") && typesSrc.includes("items_summary"));

// ── 2. effective_context 빌드 로직 ─────────────────────────
const ctxSrc = readFileSync("src/services/effective_context.ts", "utf8");
console.log("\n── [2] buildContinuityContract 빌드 ──");
check("character_position_state 빌드", ctxSrc.includes("character_position_state ="));
check("dynStates에서 추출", ctxSrc.includes("last_location: s.location") || ctxSrc.includes("last_location:"));
check("visibility_state 추출", ctxSrc.includes("visibility_state"));
check("items 3개 이하로 제한", ctxSrc.includes(".slice(0, 3)"));

// ── 3. planner 프롬프트 주입 ──────────────────────────────
const plannerSrc = readFileSync("src/pipeline/planner.ts", "utf8");
console.log("\n── [3] planner 프롬프트 주입 ──");
check("character_position_state 사용", plannerSrc.includes("character_position_state"));
check("이번 화 시작점 안내", plannerSrc.includes("이번 화 시작점") || plannerSrc.includes("종료 시점 인물 상태"));
check("transition reason 요구", plannerSrc.includes("transition reason"));
check("absent/cannot_act 등장 계기 요구", plannerSrc.includes("absent") && plannerSrc.includes("등장 계기"));

// ── 4. 신규 audit 스크립트 ─────────────────────────────────
console.log("\n── [4] 신규 audit 스크립트 ──");
check("audit_cross_episode_continuity.mjs 존재", existsSync("scripts/audit_cross_episode_continuity.mjs"));
const ceaSrc = existsSync("scripts/audit_cross_episode_continuity.mjs")
  ? readFileSync("scripts/audit_cross_episode_continuity.mjs", "utf8") : "";
check("audit: 위치 jump 검사", ceaSrc.includes("location_jump"));
check("audit: visibility revival 검사", ceaSrc.includes("absent_revival"));
check("audit: TRANSITION_RE 패턴", ceaSrc.includes("TRANSITION_RE"));

// ── 5. dist 빌드 확인 ─────────────────────────────────────
console.log("\n── [5] dist 빌드 산출물 ──");
check("dist/services/effective_context.js", existsSync("dist/services/effective_context.js"));
check("dist/pipeline/planner.js", existsSync("dist/pipeline/planner.js"));
if (existsSync("dist/services/effective_context.js")) {
  const distCtx = readFileSync("dist/services/effective_context.js", "utf8");
  check("dist character_position_state", distCtx.includes("character_position_state"));
}

// ── 결과 ────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
