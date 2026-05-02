/**
 * verify_capture_title_format.mjs — POST-2 P3-V2
 *
 * 캡처 헤더 포맷 정책(FINAL §5.2) 회귀 방지 정적 verify.
 *
 * 정책:
 *   1. ep 줄은 `${epLabel} ${epTitle}` 단일 공백 결합 (괄호 절대 사용 금지).
 *      이전 포맷 `1화 ([화 제목])`에서 괄호를 제거한 결과를 유지해야 한다.
 *   2. 책 제목은 별도 줄(`cap-book-title`)에 단독 표시.
 *   3. ep 줄은 `cap-ep-line` 컨테이너로 분리.
 *   4. epLabel / epTitle 한쪽만 있어도 자연스럽게 출력 (둘 다 없으면 ep 줄 자체 생략).
 *   5. charsOnly 모드(인물 카드 단독 캡처)에서는 헤더 영역 자체를 출력하지 않는다.
 *
 * 본 verify는 시각 회귀 detect 안 함 — DOM 구조 + 포맷 contract만 검증.
 */
import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const check = (s, c, d) => c ? ok(s) : ng(s, d);

const generateJs = readFileSync("public/js/generate.js", "utf8");

// 캡처 헤더 영역 — `cap-header` 가 anchor.
const capHeaderIdx = generateJs.indexOf("cap-header");
const capSlice = capHeaderIdx >= 0 ? generateJs.slice(Math.max(0, capHeaderIdx - 1500), capHeaderIdx + 1500) : "";

console.log("── [1] DOM 구조 ──");
check(
  "cap-header / cap-book-title / cap-ep-line 컨테이너 정의",
  /class="cap-header"/.test(capSlice) &&
  /class="cap-book-title"/.test(capSlice) &&
  /class="cap-ep-line"/.test(capSlice)
);
check(
  "outputBookTitle / outputEpLabel / outputEpTitle DOM source 사용",
  /outputBookTitle/.test(capSlice) &&
  /outputEpLabel/.test(capSlice) &&
  /outputEpTitle/.test(capSlice)
);

console.log("\n── [2] ep 줄 결합 포맷 — 괄호 제거 ──");
check(
  "epLineText 결합 패턴 — `${epLabel} ${epTitle}` (단일 공백, 괄호 없음)",
  /\$\{epLabel\}\s+\$\{epTitle\}/.test(capSlice) &&
  !/\$\{epLabel\}[^`]*\(\$\{epTitle\}\)/.test(capSlice)
);
check(
  "epLineText 합성에서 괄호 wrapping 미사용",
  !/`\$\{epLabel\}\s*\(\$\{epTitle\}\)`/.test(capSlice) &&
  !/`\(\$\{epTitle\}\)`/.test(capSlice)
);
check(
  "ep label / title 한쪽만 있어도 fallback 처리",
  /epLabel\s*\?[\s\S]{0,200}epTitle/.test(capSlice)
);

console.log("\n── [3] charsOnly 모드 — 헤더 생략 ──");
check(
  "charsOnly true이면 wrap.innerHTML이 빈 문자열 (헤더 없음)",
  /wrap\.innerHTML\s*=\s*charsOnly\s*\?\s*['"]['"]/.test(capSlice)
);

console.log("\n── [4] FINAL §5.2 정책 헤더 주석 ──");
check(
  "FINAL: 괄호 제거 정책 주석 유지",
  /FINAL[\s\S]{0,80}괄호\s*제거/.test(capSlice)
);

console.log("\n── [5] 산출물 ──");
check("public/js/generate.js exists", existsSync("public/js/generate.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
