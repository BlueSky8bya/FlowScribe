/**
 * verify_language_guard.mjs
 * 영어 감정 레이블 normalize, 비한국어 감지 검증
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

const generateTs = readFileSync("src/api/generate.ts", "utf-8");

console.log("── generate.ts 언어 guard 검증 ──");
check("_EMOTION_NORMALIZE 맵 정의", generateTs.includes("_EMOTION_NORMALIZE"));
check("unreadable → 알 수 없음", generateTs.includes(`unreadable: "알 수 없음"`));
check("enigmatic → 수수께끼 같음", generateTs.includes(`enigmatic: "수수께끼 같음"`));
check("anxious → 불안", generateTs.includes(`anxious: "불안"`));
check("suspicious → 의심", generateTs.includes(`suspicious: "의심"`));
check("confused → 혼란", generateTs.includes(`confused: "혼란"`));
check("_NON_KOREAN_RE 정의 (CJK/Cyrillic 등)", generateTs.includes("_NON_KOREAN_RE"));
check("_normalizeEmotionalState 함수 정의", generateTs.includes("function _normalizeEmotionalState"));
check("freshCharStates에 normalize 적용", generateTs.includes("_normalizeEmotionalState(s.emotional_state)"));
check("charStateSnapshot에 normalize 적용", generateTs.includes("_normalizeEmotionalState(s.emotional_state)"));
check("non-Korean detected → logWarn", generateTs.includes("non-Korean emotional_state detected"));

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
