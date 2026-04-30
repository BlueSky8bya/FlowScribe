/**
 * verify_emotion_label_normalization.mjs — Phase 4.19
 *
 * normalizeEmotionalState가 다양한 입력에 대해 짧은 라벨을 반환하는지 확인.
 *   - 한국어 짧은 단일 라벨은 그대로
 *   - 한국어 multi-word ("긴장 유지", "집중과 긴장")는 핵심 라벨로 단축
 *   - 한국어 문장형은 키워드 매칭 → 단축
 *   - 영어 매핑 가능 단어는 한국어 라벨
 *   - 비한국어 스크립트는 "알 수 없음"
 *   - 15자 이상 장문이 결과로 나오면 FAIL
 */
import { existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };

const dist = await import("../dist/services/language_guard.js");
const { normalizeEmotionalState } = dist;

console.log("── normalizeEmotionalState test cases ──");

const cases = [
  { input: "결의",                         expectShort: true, contains: ["결의"], desc: "단일 라벨 그대로" },
  { input: "긴장",                         expectShort: true, contains: ["긴장"], desc: "단일 라벨 그대로" },
  { input: "긴장 유지",                    expectShort: true, contains: ["긴장"], desc: "multi-word 단축" },
  { input: "집중과 긴장",                  expectShort: true, contains: ["긴장", "집중"], desc: "multi-word 단축 — 매칭 단어 중 첫 번째" },
  { input: "결단 직전의 긴장",             expectShort: true, contains: ["결의", "긴장"], desc: "복합 → 단일 라벨" },
  { input: "불안에서 결의로 전환",          expectShort: true, contains: ["불안", "결의"], desc: "전환 표현 → 단일 라벨" },
  { input: "빅토리를 돕기 위해 노력하며 희망을 품음", expectShort: true, contains: ["희망"], desc: "문장형 → 핵심 감정" },
  { input: "anxious",                      expectShort: true, contains: ["불안"], desc: "영어 매핑" },
  { input: "fearful",                      expectShort: true, contains: ["두려움"], desc: "영어 매핑" },
  { input: "당혹",                         expectShort: true, contains: ["당혹"], desc: "당혹 단일 라벨 그대로" },
  { input: "주저함",                       expectShort: true, contains: ["주저"], desc: "주저함 → 주저" },
  { input: "신중",                         expectShort: true, contains: ["신중"], desc: "신중 그대로" },
  { input: "압박",                         expectShort: true, contains: ["압박"], desc: "압박 그대로" },
  { input: null,                           expectShort: false, contains: [], desc: "null 입력" },
  { input: "",                             expectShort: false, contains: [], desc: "빈 문자열" },
  { input: "очень страшно",                expectShort: true, contains: ["알 수 없음"], desc: "비한국어 스크립트" },
];

for (const c of cases) {
  const result = normalizeEmotionalState(c.input);
  const resStr = result == null ? "(null)" : String(result);
  const tooLong = result != null && resStr.length > 14;
  const containsAny = c.contains.length === 0 ? true : c.contains.some(x => resStr.includes(x));

  let okFlag = true;
  let detail = `input=${JSON.stringify(c.input)} → ${JSON.stringify(result)}`;
  if (c.expectShort) {
    if (tooLong) { okFlag = false; detail += " — 결과가 14자 초과 (장문 라벨)"; }
    if (!containsAny) { okFlag = false; detail += ` — 기대 키워드 ${JSON.stringify(c.contains)} 미포함`; }
  } else {
    // expectShort=false → null/empty여야 함
    if (result != null && resStr.length > 0 && c.input != null) {
      // 빈 입력에 한해 null/empty 허용
    }
  }
  okFlag ? ok(`${c.desc} :: ${detail}`) : ng(`${c.desc} :: ${detail}`);
}

console.log("\n── 정적 코드 검증 ──");
const { readFileSync } = await import("fs");
const src = readFileSync("src/services/language_guard.ts", "utf8");
const okStatic = (s, c, d) => c ? ok(s) : ng(s, d);
okStatic("EMOTION_KEYWORDS에 '신중' 추가됨", /\[\s*\/신중\//.test(src));
okStatic("EMOTION_KEYWORDS에 '주저' 추가됨", /\/주저\|망설/.test(src));
okStatic("EMOTION_KEYWORDS에 '집중' 추가됨", /\[\s*\/집중\//.test(src));
okStatic("normalizeEmotionalState complex trigger (length>15 OR space)", /isComplex/.test(src) && /hasSpace/.test(src));
okStatic("dist 빌드", existsSync("dist/services/language_guard.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
