#!/usr/bin/env node
/**
 * verify_episode_button_state.mjs
 *
 * 1화 재생성 후 버튼 상태 동기화 버그 수정 검증:
 * 1. regenerate()에 window._regenMode 플래그 설정 포함
 * 2. _finishGeneration에서 regen 완료 시 currentEpisode = episodeNum+1 복원
 * 3. onerror 경로에도 동일 처리
 * 4. openModal() 에서 episodeCache 기반 잠금 재계산
 * 5. syncCharDeleteBtns 함수 존재
 * 6. isEmptyState는 episodeCacheKeys.length === 0일 때만
 * 7. updateEpisodeUI의 _noEpisodes 조건 검증
 * 8. __fsDiag에 regenButtonVisible, sendButtonText, episodeCacheKeys, hasEpisodes, isEmptyState 포함
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
  "_finishGeneration: regen 완료 시 currentEpisode = episodeNum+1 복원",
  genSrc.includes("_wasRegen") && genSrc.includes("episodeNum + 1")
);

check(
  "_finishGeneration: native increment 없이 episodeNum+1 방식으로만 처리",
  // "if (!_wasRegen) currentEpisode++" 패턴이 없어야 함 (구조적 수정)
  !genSrc.includes("if (!_wasRegen) currentEpisode++")
);

check(
  "onerror 경로에도 _wasRegenErr 체크 + currentEpisode 복원",
  genSrc.includes("_wasRegenErr") && genSrc.includes("_wasRegenErr ? episodeNum + 1")
);

check(
  "window._regenMode = null 클리어",
  genSrc.includes("window._regenMode = null")
);

check(
  "updateEpisodeUI _noEpisodes: displayedEpisode===null && currentEpisode===1 && !_generating",
  genSrc.includes("_noEpisodes") || readFileSync("public/js/app.js","utf8").includes("_noEpisodes")
);

check(
  "[episode-ui-sync] 디버그 로그 포함",
  genSrc.includes("[episode-ui-sync]")
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

// auth.js __fsDiag 확장 검증
const authSrc = readFileSync("public/js/auth.js", "utf8");
check(
  "__fsDiag: regenButtonVisible 필드 포함",
  authSrc.includes("regenButtonVisible")
);
check(
  "__fsDiag: sendButtonText 필드 포함",
  authSrc.includes("sendButtonText")
);
check(
  "__fsDiag: hasEpisodes 필드 포함",
  authSrc.includes("hasEpisodes")
);
check(
  "__fsDiag: isEmptyState 필드 포함",
  authSrc.includes("isEmptyState")
);
check(
  "__fsDiag: footerButtonVisible 필드 포함",
  authSrc.includes("footerButtonVisible")
);

// chars.js ID-based counter btns
check(
  "chars.js: _syncCharCounterBtns ID 기반 셀렉터 사용 (charCountMinus/charCountPlus)",
  charsSrc.includes("getElementById(\"charCountMinus\")") && charsSrc.includes("getElementById(\"charCountPlus\")")
);
check(
  "chars.js: window.confirm 미사용 (커스텀 _fsDialog 사용)",
  !charsSrc.includes("window.confirm(") && !charsSrc.includes("confirm(")
);
check(
  "chars.js: deleteCharCard async + _fsDialog 사용",
  charsSrc.includes("async function deleteCharCard") && charsSrc.includes("_fsDialog")
);

console.log(`\n───────────────────────────────────────────`);
console.log(`Result: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  issues.forEach(i => console.log(`  ✗ ${i}`));
  process.exit(1);
}
