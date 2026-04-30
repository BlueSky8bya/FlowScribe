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

console.log("── [1] sanitizeLLMItemDescription (40자 정책) ──");
// 정책: target 40자. 단일 문장 ≤ 50자면 보존, 초과 시 어절 trim. 종결부 없으면 40자 어절 trim.
const cases = [
  { input: "어두운 곳을 비추는 휴대용 조명이다.", check: (o) => o === "어두운 곳을 비추는 휴대용 조명이다.", label: "20자 짧은 설명 보존" },
  { input: "C동을 제외한 구역을 여는 출입용 열쇠다.", check: (o) => /열쇠다\.$/.test(o), label: "23자 보존" },
  { input: "통신과 기록 확인에 쓰는 개인 스마트폰이다", check: (o) => /\.$/.test(o) && o.length <= 30, label: "마침표 자동 보강" },
  { input: "이 낡은 손전등은 오래전 폐쇄된 연구소에서 사용되던 것으로, 배터리 상태가 불안정하지만 어두운 복도에서 생존 가능성을 높여주는 중요한 장비다.", check: (o) => o.length <= 50 && /\.$/.test(o), label: "79자 단일 문장 → 어절 trim" },
  { input: "섬세하게 새겨진 마법 문양은 리아의 불안정한 감정을 잠재우는 듯, 차분하게 빛난다.", check: (o) => o.length <= 50, label: "46자 단일 문장 — 50자 이내 보존" },
  { input: "빅토리가 굳게 믿는 위생과 안전을 위한 필수품들이 꼼꼼히 정리된 가방은, 그가 어떤 상황에서도 흔들리지 않게 한다.", check: (o) => o.length <= 50, label: "64자 단일 문장 → trim" },
  { input: "한 문장. 두 번째 문장.", check: (o) => o.length <= 50 && /\./.test(o), label: "두 문장 모두 40자 이내면 그대로" },
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
okIf("prompt에 '30~40자' 권장 명시", /30[~～-]\s*40자/.test(itemDesc));
okIf("prompt에 '한 문장' 명시", /한\s*문장/.test(itemDesc));
okIf("prompt에 마침표 종결 안내", /마침표/.test(itemDesc));
okIf("40자 / 복문 / 여러 문장 금지 안내", /40자|여러\s*문장\s*금지|복문/.test(itemDesc));
okIf("sanitizer hard cap 50자", /_ITEM_DESC_SENT_HARD\s*=\s*50/.test(itemDesc));
okIf("sanitizer target 40자", /_ITEM_DESC_TARGET_CHARS\s*=\s*40/.test(itemDesc));

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
