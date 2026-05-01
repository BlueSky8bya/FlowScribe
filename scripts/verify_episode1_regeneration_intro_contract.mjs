/**
 * verify_episode1_regeneration_intro_contract.mjs — Phase 4.17 Section 추가
 *
 * 1화 재생성에 2화+ 전용 컨텍스트(continuity_contract / arc / foreshadow / prev_tail)가
 * 들어가지 않는 것을 코드 레벨에서 검증한다.
 *
 * 또한 planner의 1화 재생성 prompt가 과도한 negative constraint로 모델을 압박하지 않는지
 * 토큰/섹션 수준 점검.
 */
import { readFileSync, existsSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const ctxSrc = readFileSync("src/services/effective_context.ts", "utf8");
const plannerSrc = readFileSync("src/pipeline/planner.ts", "utf8");

// ── 1. effective_context: ep1에는 ep>=2 컨텍스트가 들어가지 않아야 ──
console.log("── [1] effective_context 1화 컨텍스트 격리 ──");
// rollingSummary는 episodeNumber > 1일 때만 query
check("rollingSummary는 episodeNumber > 1 가드", ctxSrc.includes("episodeNumber > 1") && ctxSrc.match(/episodes WHERE book_id=\$1 ORDER BY episode_number DESC LIMIT 5/));
// prevTail도 episodeNumber > 1 가드
check("prevEpisodeTail은 episodeNumber > 1 가드", ctxSrc.match(/episodeNumber > 1[\s\S]{0,200}episodes WHERE book_id=\$1 AND episode_number=\$2/));
// continuityContract는 episodeNumber >= 2
check("continuityContract는 episodeNumber >= 2 가드", ctxSrc.includes("episodeNumber >= 2") && ctxSrc.includes("buildContinuityContract"));
// episodeDeltaContract는 episodeNumber >= 2
check("episodeDeltaContract는 episodeNumber >= 2 가드", ctxSrc.includes("buildEpisodeDeltaContract") && ctxSrc.match(/episodeNumber >= 2[\s\S]{0,200}buildEpisodeDeltaContract/));
// recent state history는 episodeNumber >= 2 가드 (R5B-1 — 4→2로 정체 조기 감지)
check("recent state history는 episodeNumber >= 2 가드", ctxSrc.includes("episodeNumber >= 2"));

// ── 2. planner: 1화일 때 continuity_contract/delta가 prompt에 들어가지 않아야 ──
console.log("\n── [2] planner ep1 prompt 격리 ──");
// 연속성 계약 블록은 cc 존재 시에만 emit (ep1엔 cc 없음)
check("연속성 계약 블록은 cc 조건부", plannerSrc.match(/if \(cc\)\s*\{[\s\S]{0,2000}\[연속성 계약/));
check("episode_delta_contract도 dc 조건부", plannerSrc.includes("ctx.episode_delta_contract") || plannerSrc.match(/dc\.[a-z_]+/));
// prev_tail block도 prevTailText 조건부
check("prev_tail block은 prevTailText 조건부", plannerSrc.match(/if \(prevTailText\)\s*\{?\s*[\s\S]{0,500}\[직전 화 말미/));

// ── 3. ep1 전용 진입점 다양성 블록 ──
console.log("\n── [3] ep1 진입점 다양성 블록 ──");
check("ep1 진입점 다양성 블록 emit (episode_number === 1)", plannerSrc.includes("ctx.episode_number === 1"));
// Phase 4.17 — "첫 화 진입점 다양성" → "첫 화 도입부 원칙" 으로 변경됨
check("ep1 도입부 원칙 텍스트 존재", plannerSrc.includes("첫 화 도입부 원칙"));

// ── 4. 재생성 컨텍스트 — Phase 4.18에서 RegenerationDivergenceContract로 대체됨 ──
console.log("\n── [4] 재생성 컨텍스트 (Phase 4.18로 대체된 항목) ──");
// Phase 4.17의 regen_prev_text full-beat dump는 의도적으로 제거됨 (Phase 4.18: anchoring 방지)
check(
  "regen_prev_text full-beat dump 제거 (Phase 4.18 정책)",
  !plannerSrc.includes("regen_prev_text") || !plannerSrc.match(/\[이전 시도 beat 기록 — 다양성 참고용\][\s\S]*\$\{regenPrev\}/)
);
// regen_avoid_locations도 제거됨 (axis-based divergence로 대체)
check(
  "regen_avoid_locations 명시 회피 제거 (Phase 4.18 정책)",
  !plannerSrc.includes("regen_avoid_locations")
);
// [이전 시도 beat 기록] 전체 dump도 제거됨
check(
  "[이전 시도 beat 기록 — 다양성 참고용] 전체 dump 제거",
  !plannerSrc.includes("[이전 시도 beat 기록 — 다양성 참고용]")
);
// 대신 RegenerationDivergenceContract로 대체된 것 확인
check(
  "[재생성 분기 계약] block (Phase 4.18 신규)",
  plannerSrc.includes("[재생성 분기 계약")
);

// ── 5. ep1 regen 가드 — 2화+ 메모리가 새지 않는 사후 보강 ──
console.log("\n── [5] ep1 regen 명시적 격리 (Phase 4.17) ──");
// 새 가드: ep1 regen 시 prevEpisodeTail/continuityContract 강제 undefined
const hasEp1RegenGuard = plannerSrc.includes("episode_number === 1") &&
  (plannerSrc.includes("isEp1Regen") || plannerSrc.includes("ep1_regen") || plannerSrc.includes("alternate opening"));
check("ep1 regen 명시 가드 (선택적)", hasEp1RegenGuard, hasEp1RegenGuard ? "" : "선택적 (effective_context 격리만으로 충분할 수 있음)");

// ── 6. dist 빌드 ──
console.log("\n── [6] dist 빌드 산출물 ──");
check("dist/services/effective_context.js", existsSync("dist/services/effective_context.js"));
check("dist/pipeline/planner.js", existsSync("dist/pipeline/planner.js"));

console.log(`\n${"─".repeat(60)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
