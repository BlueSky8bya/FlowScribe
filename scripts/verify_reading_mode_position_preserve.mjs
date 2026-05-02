/**
 * verify_reading_mode_position_preserve.mjs — POST-4 §C2
 *
 * S4 KEEP 정책 정적 contract 검증 — 청독(eye) / 묵독(tts) / 낭독(aloud) 모드 전환 시
 * 현재 단락(viewport 상단 paragraph) 위치를 보존하고, 본문 처음으로 강제 이동하지 않는다.
 *
 * Phase 4.18에서 도입된 _captureReadingAnchor / _restoreReadingAnchor 흐름을 정적 검증.
 * UI 코드는 미터치 — 현재 구현이 S4 KEEP 정책에 부합하는지만 확인.
 *
 * 검증 contract:
 *   1. setReadMode 함수 존재
 *   2. setReadMode 안에서 모드 전환(prev !== mode) 시 _captureReadingAnchor 호출
 *   3. setReadMode 끝에서 _restoreReadingAnchor를 requestAnimationFrame 안에 호출
 *   4. _captureReadingAnchor 함수 정의 — viewport top paragraph index 추출
 *   5. _restoreReadingAnchor 함수 정의 — scrollBy로 같은 위치 복원
 *   6. setReadMode 안에 scrollTo({top:0}) 또는 본문 처음 이동 강제 패턴 없음
 *   7. setReadMode 안에 scrollIntoView({block: "start"}) 같은 강제 상단 이동 패턴 없음
 */
import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const check = (s, c, d) => c ? ok(s) : ng(s, d);

const uiJs = readFileSync("public/js/ui.js", "utf-8");

// brace-match로 setReadMode 함수 본문 정확 추출 (POST-2 verify_modal_save 패턴)
function extractFunctionBody(src, fnDecl) {
  const idx = src.indexOf(fnDecl);
  if (idx === -1) return "";
  const openIdx = src.indexOf("{", idx);
  if (openIdx === -1) return "";
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(idx, i + 1);
    }
  }
  return src.slice(idx);
}

const setReadModeBody = extractFunctionBody(uiJs, "function setReadMode");
const captureBody     = extractFunctionBody(uiJs, "function _captureReadingAnchor");
const restoreBody     = extractFunctionBody(uiJs, "function _restoreReadingAnchor");

console.log("── [1] 함수 정의 ──");
check("setReadMode 함수 정의",                setReadModeBody.length > 0);
check("_captureReadingAnchor 함수 정의",      captureBody.length > 0);
check("_restoreReadingAnchor 함수 정의",      restoreBody.length > 0);

console.log("\n── [2] setReadMode anchor 흐름 ──");
check(
  "모드 전환(prev !== mode) 시에만 anchor 캡처",
  /prev\s*!==\s*mode[\s\S]{0,200}_captureReadingAnchor\s*\(\s*\)/.test(setReadModeBody)
);
check(
  "DOM mutation 후 _restoreReadingAnchor를 requestAnimationFrame 안에서 호출",
  /requestAnimationFrame\s*\([\s\S]{0,80}_restoreReadingAnchor\s*\(\s*anchor\s*\)/.test(setReadModeBody)
);
check(
  "anchor가 truthy일 때만 복원 (조건 가드)",
  /if\s*\(\s*anchor\s*\)\s*\{[\s\S]{0,120}requestAnimationFrame/.test(setReadModeBody)
);

console.log("\n── [3] 강제 상단 이동 패턴 부재 (본문 처음으로 튕김 방지) ──");
check(
  "setReadMode 안에 scrollTo({top:0}) 패턴 없음",
  !/scrollTo\s*\(\s*\{\s*top\s*:\s*0/.test(setReadModeBody)
);
check(
  "setReadMode 안에 scrollIntoView({block:\"start\"}) 패턴 없음",
  !/scrollIntoView\s*\(\s*\{\s*[^}]*block\s*:\s*["']start["']/.test(setReadModeBody)
);
check(
  "setReadMode 안에 scrollTop = 0 직접 대입 없음",
  !/scrollTop\s*=\s*0/.test(setReadModeBody)
);

console.log("\n── [4] _captureReadingAnchor 동작 contract ──");
check(
  "viewport top paragraph 검출 — getBoundingClientRect().top 비교",
  /getBoundingClientRect\(\)/.test(captureBody) && /\.top/.test(captureBody)
);
check(
  "anchor 객체에 index + offsetWithin 포함",
  /\bindex\s*:/.test(captureBody) && /\boffsetWithin\s*:/.test(captureBody)
);

console.log("\n── [5] _restoreReadingAnchor 동작 contract ──");
check(
  "scrollBy로 같은 위치 복원 (강제 점프 아님)",
  /scrollBy\s*\(/.test(restoreBody)
);
check(
  "anchor.index로 paragraph 식별 + offsetWithin 보정",
  /anchor\.index/.test(restoreBody) && /anchor\.offsetWithin/.test(restoreBody)
);

console.log("\n── [6] Phase 4.18 정책 주석 ──");
check(
  "Phase 4.18 anchor capture/restore 정책 주석 유지",
  /Phase 4\.18[\s\S]{0,300}anchor/.test(uiJs)
);

console.log("\n── [7] 산출물 ──");
check("public/js/ui.js exists", existsSync("public/js/ui.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
