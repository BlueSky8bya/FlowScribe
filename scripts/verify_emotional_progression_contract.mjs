/**
 * verify_emotional_progression_contract.mjs — Phase 4.16 progression contract 검증
 */
import { readFileSync, existsSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

// ── 1. ContinuityContract type ──
const typesSrc = readFileSync("src/types/canonical.ts", "utf8");
console.log("── [1] ContinuityContract type ──");
check("emotional_progression_requirements 필드", typesSrc.includes("emotional_progression_requirements"));
check("streak_type union", typesSrc.includes('"emotion" | "goal" | "emotion_goal_pair"'));
check("allowed_progression_types 필드", typesSrc.includes("allowed_progression_types"));
check("instruction 필드", typesSrc.includes("instruction"));

// ── 2. effective_context build ──
const ctxSrc = readFileSync("src/services/effective_context.ts", "utf8");
console.log("\n── [2] buildContinuityContract progression build ──");
check("recentHistory 파라미터", ctxSrc.includes("recentHistory"));
check("recent 8화 query", ctxSrc.includes("episode_number >= $2 AND episode_number < $3"));
check("STREAK_TRIGGER 상수", ctxSrc.includes("STREAK_TRIGGER"));
check("streak 계산 (emotionStreak/goalStreak/pairStreak)", ctxSrc.includes("emotionStreak") && ctxSrc.includes("goalStreak") && ctxSrc.includes("pairStreak"));
check("emotional_progression_requirements emit", ctxSrc.includes("emotional_progression_requirements: NonNullable") || ctxSrc.includes("emotional_progression_requirements ="));
check("instruction 메시지 생성", ctxSrc.includes("결정/행동/관계 변화/새 정보/대가"));

// ── 3. planner injection ──
const plannerSrc = readFileSync("src/pipeline/planner.ts", "utf8");
console.log("\n── [3] planner 프롬프트 주입 ──");
check("emotional_progression_requirements 사용", plannerSrc.includes("emotional_progression_requirements"));
check("진전 필수 블록", plannerSrc.includes("감정·목표 진전 필수") || plannerSrc.includes("정체 인물"));
check("감정 단어만 바꾸지 말 것 명시", plannerSrc.includes("감정 단어만 바꾸지"));

// ── 4. language_guard sentence-to-label ──
const lgSrc = readFileSync("src/services/language_guard.ts", "utf8");
console.log("\n── [4] language_guard 감정 라벨 정규화 ──");
check("SENTENCE_HINT_RE 정의", lgSrc.includes("SENTENCE_HINT_RE"));
check("EMOTION_KEYWORDS 정의", lgSrc.includes("EMOTION_KEYWORDS"));
check("shortenEmotionalLabel 함수", lgSrc.includes("shortenEmotionalLabel"));
check("normalizeEmotionalState 문장형 감지", lgSrc.includes("isSentence"));
check("15자 초과 trigger", lgSrc.includes("trimmed.length > 15"));

// ── 5. item_ledger parenthetical split ──
const ilSrc = readFileSync("src/lib/item_ledger.ts", "utf8");
console.log("\n── [5] item_ledger description 분리 ──");
check("SHORT_CONDITION_RE 정의", ilSrc.includes("SHORT_CONDITION_RE"));
check("splitConditionFromName description 반환", ilSrc.includes("description?: string"));
check("긴 설명을 description으로 분리", ilSrc.includes("description = inner"));
check("resolveItemName splitDescription 사용", ilSrc.includes("splitDescription"));

// ── 6. UI scroll-top hotfix ──
const genJs = readFileSync("public/js/generate.js", "utf8");
const authJs = readFileSync("public/js/auth.js", "utf8");
console.log("\n── [6] UI scroll-top on episode change ──");
check("generate.js _scrollToTopOnEpisodeChange 함수", genJs.includes("_scrollToTopOnEpisodeChange"));
// viewPrev / viewNext 둘 다 scroll-top 호출 (각 함수 내 본문에 호출 명시)
const viewPrevBody = genJs.slice(genJs.indexOf("function viewPrev"), genJs.indexOf("function viewNext"));
const viewNextBody = genJs.slice(genJs.indexOf("function viewNext"), genJs.indexOf("function regenerate"));
check("viewPrev에 scroll-top 호출", viewPrevBody.includes("_scrollToTopOnEpisodeChange()"));
check("viewNext에 scroll-top 호출", viewNextBody.includes("_scrollToTopOnEpisodeChange()"));
check("auth.js episode list click scroll-top", authJs.includes("회차 변경 시 본문 상단으로 스크롤"));

// ── 7. dist build ──
console.log("\n── [7] dist 빌드 산출물 ──");
check("dist/services/effective_context.js", existsSync("dist/services/effective_context.js"));
check("dist/services/language_guard.js", existsSync("dist/services/language_guard.js"));
check("dist/lib/item_ledger.js", existsSync("dist/lib/item_ledger.js"));
check("dist/pipeline/planner.js", existsSync("dist/pipeline/planner.js"));
if (existsSync("dist/services/effective_context.js")) {
  const distCtx = readFileSync("dist/services/effective_context.js", "utf8");
  check("dist emotional_progression_requirements", distCtx.includes("emotional_progression_requirements"));
}

console.log(`\n${"─".repeat(60)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
