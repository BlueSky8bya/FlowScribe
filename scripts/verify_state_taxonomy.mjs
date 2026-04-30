/**
 * verify_state_taxonomy.mjs — Phase 4.20 R3
 *
 * normalizeEmotionalState가 emotion이 아닌 카테고리(성격·역할·관계·목표) 단어를
 * emotional_state 칸에 통과시키지 않는지 확인.
 *
 * R3 정책:
 *   - emotion 어근(불안·결의·두려움 등) 입력 → 그대로 또는 단축 라벨
 *   - non-emotion 단어("친절한", "신입", "팀워크", "분석적", "전문가") → "알 수 없음"
 *   - 혼합("친절한 결의", "차가운 결의") → emotion 우선 추출 → "결의"
 *   - 단순 단어 매칭이 아니라 stem-based blacklist (taxonomy 분리 구조)
 */
import { existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };

const dist = await import("../dist/services/language_guard.js");
const { normalizeEmotionalState } = dist;

console.log("── R3 emotion taxonomy guard test ──");

// (input, expected, label)
const cases = [
  // PERSONALITY blacklist
  ["친절한",     "알 수 없음", "personality:친절"],
  ["분석적",     "알 수 없음", "personality:분석적"],
  ["내성적",     "알 수 없음", "personality:내성적"],
  ["외향적",     "알 수 없음", "personality:외향적"],
  ["고집",       "알 수 없음", "personality:고집"],
  ["책임감",     "알 수 없음", "personality:책임감"],
  // ROLE blacklist
  ["신입",       "알 수 없음", "role:신입"],
  ["리더",       "알 수 없음", "role:리더"],
  ["보호자",     "알 수 없음", "role:보호자"],
  ["초보",       "알 수 없음", "role:초보"],
  ["전문가",     "알 수 없음", "role:전문가"],
  ["베테랑",     "알 수 없음", "role:베테랑"],
  // RELATIONSHIP blacklist
  ["팀워크",     "알 수 없음", "relationship:팀워크"],
  ["협력",       "알 수 없음", "relationship:협력"],
  ["동료",       "알 수 없음", "relationship:동료"],
  // emotion 통과
  ["결의",       "결의",       "emotion:결의"],
  ["불안",       "불안",       "emotion:불안"],
  ["두려움",     "두려움",     "emotion:두려움"],
  ["혼란",       "혼란",       "emotion:혼란"],
  ["안도",       "안도",       "emotion:안도"],
  ["희망",       "희망",       "emotion:희망"],
  ["호기심",     "호기심",     "emotion:호기심"],
  // 혼합 — emotion 우선 추출
  ["친절한 결의",     "결의",   "mixed: personality + emotion → emotion"],
  ["차가운 결의",     "결의",   "mixed: personality + emotion → emotion"],
  ["신입의 결단",     "결의",   "mixed: role + emotion → emotion (결의)"],
  ["팀워크와 두려움",  "두려움", "mixed: relationship + emotion → emotion"],
  // 어미가 붙은 non-emotion
  ["친절하게",   "알 수 없음", "personality with verb-ending"],
  ["분석적인",   "알 수 없음", "personality with adj-ending"],
];

for (const [input, expected, label] of cases) {
  const result = normalizeEmotionalState(input);
  if (result === expected) ok(`${label}: ${JSON.stringify(input)} → ${JSON.stringify(result)}`);
  else ng(`${label}: ${JSON.stringify(input)} → ${JSON.stringify(result)} (expected ${JSON.stringify(expected)})`);
}

console.log("\n── 정적 코드 검증 ──");
const { readFileSync } = await import("fs");
const src = readFileSync("src/services/language_guard.ts", "utf8");
const okStatic = (s, c, d) => c ? ok(s) : ng(s, d);
okStatic("PERSONALITY_STEMS 정의됨", /PERSONALITY_STEMS\s*:\s*RegExp\s*=/.test(src));
okStatic("ROLE_STEMS 정의됨", /ROLE_STEMS\s*:\s*RegExp\s*=/.test(src));
okStatic("RELATIONSHIP_STEMS 정의됨", /RELATIONSHIP_STEMS\s*:\s*RegExp\s*=/.test(src));
okStatic("GOAL_STEMS 정의됨", /GOAL_STEMS\s*:\s*RegExp\s*=/.test(src));
okStatic("isNonEmotionLabel 함수 정의됨", /function isNonEmotionLabel/.test(src));
okStatic("normalizeEmotionalState가 isNonEmotionLabel 호출", /isNonEmotionLabel\s*\(/.test(src));
okStatic("planner.ts에 emotion taxonomy 안내문", /성격\(친절|성격.{0,5}친절/.test(readFileSync("src/pipeline/planner.ts", "utf8")));
okStatic("dist 빌드", existsSync("dist/services/language_guard.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
