#!/usr/bin/env node
/**
 * verify_world_bible_limits.mjs
 *
 * World Bible 상한선 및 AI 추천 제한 정적 검증:
 * 1. characters max = 5 (JS + suggest)
 * 2. + 버튼 비활성 기준 = charCount >= 5
 * 3. - 버튼 비활성 기준 = charCount <= 1 (5에서 비활성화 안 됨)
 * 4. _syncCharCounterBtns ID 기반 셀렉터 사용
 * 5. rules max = 10 (rules.js addRuleTagDirect)
 * 6. 수동 입력 rules 10개 초과 차단
 * 7. AI 추천 rules 남은 슬롯 기준 제한 (_remainingRuleSlots)
 * 8. AI 추천 반복 시 10개 초과 방지 (runRulesSuggestV2 remaining 체크)
 * 9. rule 문장 중간 자르기 없이 완성 문장 단위로 추가
 * 10. window.confirm 미사용 (deleteCharCard)
 * 11. 커스텀 _fsDialog 사용
 */

import { readFileSync } from "fs";

let pass = 0, fail = 0;
const issues = [];

function check(label, passed) {
  if (passed) { console.log(`  ✓ ${label}`); pass++; }
  else { console.error(`  ✗ FAIL: ${label}`); fail++; issues.push(label); }
}

const rulesSrc    = readFileSync("public/js/rules.js",   "utf8");
const charsSrc    = readFileSync("public/js/chars.js",   "utf8");
const suggestSrc  = readFileSync("public/js/suggest.js", "utf8");
const authSrc     = readFileSync("public/js/auth.js",    "utf8");
const uiSrc       = readFileSync("public/js/ui.js",      "utf8");
const indexSrc    = readFileSync("public/index.html",    "utf8");

// ── 토스트 dedupe ─────────────────────────────────────────────
check(
  "ui.js showToast: _toastShownAt dedupe 맵 존재",
  uiSrc.includes("_toastShownAt")
);
check(
  "ui.js showToast: 2000ms 내 중복 차단",
  uiSrc.includes("< 2000")
);
check(
  "rules.js addRuleTagDirect: silent 파라미터 존재",
  rulesSrc.includes("silent = false") || rulesSrc.includes("silent=false")
);
check(
  "rules.js addRuleTagDirect: silent 시 toast 생략",
  rulesSrc.includes("if (!silent)")
);
check(
  "auth.js restoreContextUI: addRuleTagDirect silent=true 로 호출",
  authSrc.includes("addRuleTagDirect(r, false, true)") &&
  authSrc.includes("addRuleTagDirect(r, true, true)")
);

// ── 뷰어모드 삭제 버튼 잠금 ──────────────────────────────────
check(
  "index.html: sectionFieldIV ID 존재",
  indexSrc.includes('id="sectionFieldIV"')
);
check(
  "modal.css: section-locked 시 char-delete-btn 숨김 CSS 존재",
  readFileSync("public/css/modal.css", "utf8").includes("sectionFieldIV.section-locked .char-delete-btn")
);

// ── 규칙 상한선 ───────────────────────────────────────────────
check(
  "rules.js addRuleTagDirect: >= 10 으로 상한 체크",
  rulesSrc.includes("ruleEntries.length >= 10")
);
check(
  "rules.js addRuleTagDirect: 10개 초과 시 toast 안내",
  rulesSrc.includes("세계관 규칙은 최대 10개까지")
);
check(
  "rules.js addRuleTagDirect: >= 20 구버전 코드 제거됨",
  !rulesSrc.includes("ruleEntries.length >= 20")
);
check(
  "rules.js makeTagInput: >= 10 수동 입력 차단",
  rulesSrc.includes("ruleEntries.length >= 10") && rulesSrc.includes("showToast")
);
check(
  "rules.js _remainingRuleSlots 헬퍼 존재",
  rulesSrc.includes("_remainingRuleSlots")
);

// ── AI 추천 규칙 슬롯 제한 ────────────────────────────────────
check(
  "suggest.js runRulesSuggestV2: 시작 전 remaining <= 0 → 즉시 안내 후 return",
  suggestSrc.includes("remaining <= 0") && suggestSrc.includes("세계관 규칙은 최대 10개까지")
);
check(
  "suggest.js runRulesSuggestV2: apply 단계에서 curRemaining 기준으로 추가 개수 제한",
  suggestSrc.includes("curRemaining") && suggestSrc.includes("added >= curRemaining")
);
check(
  "suggest.js rulesMax: 10으로 설정",
  suggestSrc.includes("rulesMax: 10")
);

// ── 인물 상한선 ───────────────────────────────────────────────
check(
  "chars.js changeCharCount: Math.min(5, ...) 상한",
  charsSrc.includes("Math.min(5,")
);
check(
  "chars.js _syncCharCounterBtns: + 버튼 charCount >= 5 비활성",
  charsSrc.includes("charCount >= 5")
);
check(
  "chars.js _syncCharCounterBtns: - 버튼 charCount <= 1 비활성 (5가 아님)",
  charsSrc.includes("charCount <= 1")
);
check(
  "chars.js _syncCharCounterBtns: ID 기반 셀렉터 (charCountMinus / charCountPlus)",
  charsSrc.includes("getElementById(\"charCountMinus\")") &&
  charsSrc.includes("getElementById(\"charCountPlus\")")
);
check(
  "chars.js _syncCharCounterBtns: onclick*='1' 셀렉터 미사용 (버그 원인)",
  !charsSrc.includes("onclick*='1'")
);
check(
  "suggest.js charactersMax: 5로 설정",
  suggestSrc.includes("charactersMax: 5")
);

// ── 삭제 confirm ─────────────────────────────────────────────
check(
  "chars.js deleteCharCard: window.confirm / confirm() 미사용",
  !charsSrc.includes("window.confirm(") && !charsSrc.includes(" confirm(")
);
check(
  "chars.js deleteCharCard: async + _fsDialog 커스텀 확인 사용",
  charsSrc.includes("async function deleteCharCard") &&
  charsSrc.includes("_fsDialog")
);
check(
  "chars.js deleteCharCard: 삭제 버튼 danger 스타일",
  charsSrc.includes("danger")
);
check(
  "chars.js deleteCharCard: 최소 1명 방지 로직 유지",
  charsSrc.includes("cards.length <= 1")
);

console.log(`\n───────────────────────────────────────────`);
console.log(`Result: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("Failed checks:");
  issues.forEach(i => console.log(`  ✗ ${i}`));
  process.exit(1);
}
