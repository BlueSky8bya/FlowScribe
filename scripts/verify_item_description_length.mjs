/**
 * verify_item_description_length.mjs — Phase 4.20 R5A stabilization
 *
 * 소지품 설명 길이 정책: 1문장, 20~45자 권장, 최대 60자, 마침표 종료.
 * LLM 자동 생성 description만 sanitize, user 입력은 보존.
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const m = await import("../dist/services/item_desc.js");
const { sanitizeLLMItemDescription } = m;

console.log("── [1] sanitizeLLMItemDescription ──");
// (input, expected_predicate, label)
const cases = [
  { input: "어두운 곳을 비추는 휴대용 조명이다.", check: (o) => o.length <= 60 && o === "어두운 곳을 비추는 휴대용 조명이다.", label: "정상 짧은 설명 보존" },
  { input: "C동을 제외한 구역을 여는 출입용 열쇠다.", check: (o) => o.length <= 60 && /열쇠다.$/.test(o), label: "정상 보존" },
  { input: "통신과 기록 확인에 쓰는 개인 스마트폰이다", check: (o) => o.length <= 60 && /\.$/.test(o), label: "마침표 자동 보강" },
  { input: "이 낡은 손전등은 오래전 폐쇄된 연구소에서 사용되던 것으로, 배터리 상태가 불안정하지만 어두운 복도에서 생존 가능성을 높여주는 중요한 장비다.", check: (o) => o.length <= 60 && /\.$/.test(o), label: "60자 초과 → trim" },
  { input: "한 문장. 두 번째 문장.", check: (o) => o === "한 문장.", label: "여러 문장 → 첫 문장만" },
  { input: "[설명] 이건 짧은 한 줄.", check: (o) => o === "이건 짧은 한 줄.", label: "[설명] prefix 제거" },
  { input: "", check: (o) => o === "", label: "빈 입력" },
  { input: null, check: (o) => o === "", label: "null 입력" },
];
for (const c of cases) {
  const out = sanitizeLLMItemDescription(c.input);
  if (c.check(out)) ok(`${c.label}: ${JSON.stringify(c.input).slice(0, 60)} → ${JSON.stringify(out)} (len=${out.length})`);
  else ng(`${c.label}: ${JSON.stringify(c.input)} → ${JSON.stringify(out)} (len=${out.length})`);
}

console.log("\n── [2] LLM prompt 정책 명시 ──");
const itemDesc = readFileSync("src/services/item_desc.ts", "utf8");
okIf("prompt에 '20~45자' 또는 '최대 60자' 명시", /20[~～-]\s*45자|최대\s*60자/.test(itemDesc));
okIf("prompt에 '한 문장' 명시", /한\s*문장/.test(itemDesc));
okIf("prompt에 마침표 종결 안내", /마침표/.test(itemDesc));
okIf("60자 초과 / 복문 / 여러 문장 금지 안내", /60자\s*초과|여러\s*문장\s*금지|복문/.test(itemDesc));

console.log("\n── [3] sanitizer 적용 위치 ──");
okIf("LLM 결과 description에 sanitize 호출", /sanitizeLLMItemDescription\s*\(\s*d\.description\s*\)/.test(itemDesc));
okIf("user_desc는 sanitize 대상 아님 (prompt source로만 사용)", /\[사용자 입력 설명\]/.test(itemDesc));
okIf("이전 slice(0, 140) 호출 제거", !/d\.description\.slice\s*\(\s*0\s*,\s*140\s*\)/.test(itemDesc));

console.log("\n── [4] export ──");
okIf("sanitizeLLMItemDescription export됨", /export function sanitizeLLMItemDescription/.test(itemDesc));

console.log("\n── [5] dist 빌드 ──");
okIf("dist/services/item_desc.js", existsSync("dist/services/item_desc.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
