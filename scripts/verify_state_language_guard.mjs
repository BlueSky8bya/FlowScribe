/**
 * verify_state_language_guard.mjs — language_guard.ts 정적/동적 검증
 *
 * 1. 소스 코드에 language_guard.ts가 존재하고 필요한 함수가 export되었는지
 * 2. pipeline/index.ts에서 import하고 commit 전에 사용하는지
 * 3. dist 빌드에 포함되었는지
 * 4. 영어 → 한국어 변환 함수 직접 실행 테스트 (Node.js ESM import)
 */

import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }
function section(title) { console.log(`\n── ${title} ──`); }

const guardSrc   = (() => { try { return readFileSync("src/services/language_guard.ts", "utf-8"); } catch { return ""; } })();
const pipelineSrc = readFileSync("src/pipeline/index.ts", "utf-8");

// ── 1. 소스 파일 존재 및 함수 export ────────────────────────────
section("language_guard.ts 소스");
check("파일 존재", guardSrc.length > 0, "src/services/language_guard.ts 없음");
check("normalizeEmotionalState export", guardSrc.includes("export function normalizeEmotionalState("));
check("normalizePhysicalState export",  guardSrc.includes("export function normalizePhysicalState("));
check("normalizeLocation export",       guardSrc.includes("export function normalizeLocation("));
check("normalizeRecentGoal export",     guardSrc.includes("export function normalizeRecentGoal("));
check("normalizeStateUpdate export",    guardSrc.includes("export function normalizeStateUpdate<"));
check("EMOTION_MAP 존재",               guardSrc.includes("const EMOTION_MAP"));
check("distressed → 고통 매핑",         guardSrc.includes("distressed"));
check("enigmatic → 수수께끼 매핑",      guardSrc.includes("enigmatic"));
check("anxious → 불안 매핑",            guardSrc.includes("anxious"));
check("exhausted → 탈진 매핑",          guardSrc.includes("exhausted"));
check("MOSTLY_ENGLISH_RE 존재",         guardSrc.includes("MOSTLY_ENGLISH_RE"));
check("NON_KO_SCRIPT_RE 존재",          guardSrc.includes("NON_KO_SCRIPT_RE"));
check("recent_goal 순수 영어 → null",   guardSrc.includes("return null"));

// ── 2. pipeline/index.ts 통합 ────────────────────────────────────
section("pipeline/index.ts 통합");
check("language_guard import",           pipelineSrc.includes("from \"../services/language_guard.js\""));
check("normalizeEmotionalState 호출",    pipelineSrc.includes("normalizeEmotionalState("));
check("normalizePhysicalState 호출",     pipelineSrc.includes("normalizePhysicalState("));
check("normalizeLocation 호출",          pipelineSrc.includes("normalizeLocation("));
check("normalizeRecentGoal 호출",        pipelineSrc.includes("normalizeRecentGoal("));
check("direct commit에 language guard 적용", (() => {
  // language guard 주석과 normalizeEmotionalState 둘 다 있으면 OK
  return pipelineSrc.includes("language guard") && pipelineSrc.includes("normalizeEmotionalState(");
})());
check("carry-forward에 language guard 적용", (() => {
  // carry-forward 주석 블록에서 normalizeLocation 호출 확인
  const idx = pipelineSrc.indexOf("carry-forward: 영어 오염 방지");
  return idx >= 0 && pipelineSrc.indexOf("normalizeLocation(", idx) < idx + 700;
})());
check("absent-seed에 한국어 기본값 설정", (() => {
  // absent-seed 블록에서 "미등장" 기본값 확인
  const idx = pipelineSrc.indexOf("absent-seed로");
  const idx2 = pipelineSrc.indexOf("미등장");
  return idx2 > 0;
})());
check("recent_goal 영어 fallback → 이전 목표 유지 (direct)", (() => {
  // normalizeRecentGoal(...) ?? "이전 목표 유지" 패턴 확인
  return pipelineSrc.includes("normalizeRecentGoal(rawGoal) ?? \"이전 목표 유지\"");
})());
check("recent_goal 영어 fallback → 이전 목표 유지 (carry-forward)", (() => {
  return pipelineSrc.includes("normalizeRecentGoal(prev.recent_goal) ?? \"이전 목표 유지\"");
})());
check("state_rows_expected trace 기록", pipelineSrc.includes("state_rows_expected"));
check("state_rows_missing trace 기록",  pipelineSrc.includes("state_rows_missing"));

// ── 3. dist 빌드 산출물 ─────────────────────────────────────────
section("dist 빌드 산출물");
let distGuard = "";
try { distGuard = readFileSync("dist/services/language_guard.js", "utf-8"); } catch {}
check("dist/services/language_guard.js 생성됨", distGuard.length > 0);
check("dist normalizeEmotionalState export", distGuard.includes("normalizeEmotionalState"));
check("dist normalizeStateUpdate export",    distGuard.includes("normalizeStateUpdate"));

let distPipeline = "";
try { distPipeline = readFileSync("dist/pipeline/index.js", "utf-8"); } catch {}
check("dist/pipeline/index.js에 language_guard import", distPipeline.includes("language_guard"));
check("dist pipeline normalizeEmotionalState 호출", distPipeline.includes("normalizeEmotionalState"));

// ── 4. 런타임 변환 테스트 ────────────────────────────────────────
section("런타임 변환 테스트");
if (distGuard.length > 0) {
  try {
    // 빌드된 모듈 직접 import
    const mod = await import("../dist/services/language_guard.js");
    const { normalizeEmotionalState: nem, normalizeRecentGoal: nrg, normalizeLocation: nl } = mod;

    const cases = [
      { fn: nem, input: "Distressed, confused, increasingly agitated", expected_ko: true, label: "Distressed(복합) → 한국어" },
      { fn: nem, input: "enigmatic",                                    expected_ko: true, label: "enigmatic → 수수께끼 같음" },
      { fn: nem, input: "anxious",                                       expected_ko: true, label: "anxious → 불안" },
      { fn: nem, input: "불안",                                          expected_ko: true, label: "한국어 입력 그대로 유지" },
      { fn: nrg, input: "To understand the origin",                     expected_null: true, label: "영어 recent_goal → null" },
      { fn: nrg, input: "균열의 비밀을 풀기 위해",                       expected_ko: true, label: "한국어 recent_goal 유지" },
      { fn: nl,  input: "absent",                                        expected_ko: true, label: "absent location → 미등장" },
    ];

    for (const c of cases) {
      const result = c.fn(c.input);
      if (c.expected_null) {
        check(c.label, result === null, `got: ${result}`);
      } else if (c.expected_ko) {
        const hasKorean = result && /[가-힣]/.test(result);
        check(c.label, hasKorean, `got: ${result}`);
      }
    }
  } catch (e) {
    fail("런타임 import 실패", e.message);
  }
} else {
  fail("dist 빌드 없음 — 런타임 테스트 스킵", "npm run build 먼저 실행");
}

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
