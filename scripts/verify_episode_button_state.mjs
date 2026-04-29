#!/usr/bin/env node
/**
 * verify_episode_button_state.mjs
 *
 * 1화 재생성 후 버튼 상태 동기화 버그 수정 검증:
 * 1. regenerate()에 window._regenMode 플래그 설정 포함
 * 2. _finishGeneration에서 _regenMode 체크 후 currentEpisode++ 조건부 실행
 * 3. onerror 경로에도 동일 처리
 * 4. openModal() 에서 episodeCache 기반 잠금 재계산
 * 5. syncCharDeleteBtns 함수 존재
 */

import { readFileSync } from "fs";

let pass = 0, fail = 0;
const issues = [];

function check(label, passed) {
  if (passed) { console.log(`  ✓ ${label}`); pass++; }
  else { console.error(`  ✗ FAIL: ${label}`); fail++; issues.push(label); }
}

const genSrc = readFileSync("public/js/generate.js", "utf8");
const modalSrc = readFileSync("public/js/modal.js", "utf8");
const charsSrc = readFileSync("public/js/chars.js", "utf8");

// generate.js checks
check(
  "regenerate(): window._regenMode = regenEp 플래그 설정",
  genSrc.includes("window._regenMode = regenEp")
);

check(
  "_finishGeneration: _wasRegen 체크 후 currentEpisode++ 조건부",
  genSrc.includes("_wasRegen") && genSrc.includes("if (!_wasRegen) currentEpisode++")
);

check(
  "onerror 경로에도 _wasRegenErr 체크",
  genSrc.includes("_wasRegenErr") || genSrc.includes("window._regenMode === episodeNum")
);

check(
  "window._regenMode = null 클리어",
  genSrc.includes("window._regenMode = null")
);

// modal.js checks
check(
  "openModal(): episodeCache 기반 잠금 재계산",
  modalSrc.includes("Object.keys(episodeCache).some") && modalSrc.includes("applySettingsLock")
);

// chars.js checks
check(
  "chars.js: deleteCharCard 함수 존재",
  charsSrc.includes("function deleteCharCard")
);

check(
  "chars.js: syncCharDeleteBtns 함수 존재",
  charsSrc.includes("function syncCharDeleteBtns")
);

check(
  "chars.js: char-delete-btn HTML 포함",
  charsSrc.includes("char-delete-btn")
);

// charCount 상한선 5로 변경 확인
check(
  "chars.js: charCount 상한 5로 변경됨",
  charsSrc.includes("Math.min(5,") && charsSrc.includes(">= 5")
);

console.log(`\n───────────────────────────────────────────`);
console.log(`Result: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  issues.forEach(i => console.log(`  ✗ ${i}`));
  process.exit(1);
}
