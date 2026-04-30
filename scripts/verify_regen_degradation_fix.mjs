/**
 * verify_regen_degradation_fix.mjs — Phase 4.20 R5A-C
 *
 * forensic 분석에 따른 Fix A~F의 정적 contract 검증.
 * (Fix B의 동적 동작은 verify_regen_attempt_count_filter.mjs에서 별도 검증)
 *
 * Fix A: recurring threshold 2 → 3
 * Fix C: minDivergent cap 4 → 3
 * Fix D: planner cap 0.88, renderer cap 0.90
 * Fix E: attempt_count 정확 숫자 노출 안 함 + "여러 번" 압축, 강한 경고문 제거
 * Fix F: foreign contamination 검출 시 lower-temp retry 1회 (hybrid 제외, batch만)
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const regen   = readFileSync("src/services/regen_divergence.ts", "utf8");
const planner = readFileSync("src/pipeline/planner.ts", "utf8");
const renderer = readFileSync("src/pipeline/renderer.ts", "utf8");
const pipeline = readFileSync("src/pipeline/index.ts", "utf8");

console.log("── [Fix A] recurring threshold 3 ──");
okIf("recurring threshold 3 (이전 2)", /if\s*\(\s*n\s*>=\s*3\s*\)/.test(regen) && !/if\s*\(\s*n\s*>=\s*2\s*\)/.test(regen));
okIf("recurring 메시지에 '자주 반복됨' 형식 사용 (정확 숫자 미노출)", /자주\s*반복됨/.test(regen));
okIf("recurring 메시지에 '(N회 반복)' 정확 숫자 미사용", !/\(\$\{n\}회\s*반복\)/.test(regen));
okIf("plannerTraces.length < 3 일 때 빈 배열 반환", /if\s*\(plannerTraces\.length\s*<\s*3\)\s*return\s*\[\]/.test(regen));

console.log("\n── [Fix B] usable trace filter ──");
okIf("_isUsableTrace 함수 정의", /function _isUsableTrace/.test(regen));
okIf("FAIL verdict 제외", /verdict\s*===\s*["']FAIL["']/.test(regen));
okIf("WARN + score < 60 제외", /verdict\s*===\s*["']WARN["']\s*&&\s*score\s*<\s*60/.test(regen));
okIf("fallback_used true 제외", /fallback_used\s*===\s*true/.test(regen));
okIf("foreign_contamination 검출 (CJK/베트남어 등)", /foreign_contamination/.test(regen));
okIf("buildRegenDivergenceContract에서 usable filter 적용", /usableRows\s*=\s*allRows\.filter/.test(regen));
okIf("usable 0건이면 soft contract (signature 없음, axes 권고 2)", /usable trace 없음[\s\S]{0,200}soft contract/.test(regen));

console.log("\n── [Fix C] minDivergent cap 3 ──");
{
  const idx = regen.search(/function _pickAxes/);
  const slice = idx >= 0 ? regen.slice(idx, idx + 1500) : "";
  okIf("minDivergent 4 → 3 cap (Math.min(... 3 ...))",
    /attemptCount\s*>=\s*2\s*\?\s*3\s*:\s*2/.test(slice) && !/attemptCount\s*>=\s*4\s*\?\s*4/.test(slice));
}

console.log("\n── [Fix D] temperature cap ──");
okIf("planner temperature cap 0.88 (이전 0.95)",
  /Math\.min\(0\.88,\s*0\.75\s*\+\s*Math\.min\([\w._]*attempt[\w._]*,\s*3\)/.test(planner));
okIf("renderer temperature cap 0.90 (이전 0.95)",
  /Math\.min\(0\.90,\s*0\.85\s*\+\s*Math\.min\([\w._]*attempt[\w._]*,\s*3\)/.test(renderer));
okIf("planner에 0.95 cap 흔적 없음", !/Math\.min\(0\.95,\s*0\.75/.test(planner));
okIf("renderer에 0.95 cap 흔적 없음", !/Math\.min\(0\.95,\s*0\.85/.test(renderer));

console.log("\n── [Fix E] attempt_count 노출 압축 ──");
okIf("'여러 번의 이전 시도' label 사용 (4+)", /여러\s*번의\s*이전\s*시도/.test(planner));
okIf("'N번째 재생성' label (2-3)", /번째\s*재생성/.test(planner));
okIf("planner prompt에 'attempt N' 정확 숫자 직접 노출 안 함",
  !/\[재생성 분기 계약 — \$\{regenContract\.mode\}, attempt \$\{regenContract\.attempt_count\}\]/.test(planner));
okIf("attempt_count >= 4 강한 경고문 (avoidLines push) 제거",
  !/attempt_count\s*>=\s*4[\s\S]{0,300}avoidLines\.push/.test(planner));
okIf("\"이미 ... 회 시도되었다\" 강한 경고문 제거",
  !/이미\s*\$\{regenContract\.attempt_count\}회\s*시도되었다/.test(planner));

console.log("\n── [Fix F] foreign contamination retry ──");
okIf("renderer temperatureOverride 파라미터", /temperatureOverride\?\s*:\s*number/.test(renderer));
okIf("renderer가 temperatureOverride 우선 사용", /typeof\s*temperatureOverride\s*===\s*["']number["']/.test(renderer));
okIf("pipeline foreign contamination 임계 (>= 3)", /_foreignContamThreshold\s*=\s*3/.test(pipeline));
okIf("hybrid streaming 중 retry 안 함 (!onRendererChunk)", /!onRendererChunk/.test(pipeline));
okIf("retry 시 lower temp 0.7", /temperatureOverride.*0\.7|0\.7,\s*\)/.test(pipeline));
okIf("retry 1회만 (loop 없음)", !/while\s*\([^)]*foreign|for\s*\([^)]*retry/.test(pipeline));
okIf("retry 결과 contamination 검사 후 적용", /retryContam\s*<\s*_foreignContamThreshold/.test(pipeline));

console.log("\n── [build] dist 산출물 ──");
okIf("dist/services/regen_divergence.js", existsSync("dist/services/regen_divergence.js"));
okIf("dist/pipeline/planner.js", existsSync("dist/pipeline/planner.js"));
okIf("dist/pipeline/renderer.js", existsSync("dist/pipeline/renderer.js"));
okIf("dist/pipeline/index.js", existsSync("dist/pipeline/index.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
