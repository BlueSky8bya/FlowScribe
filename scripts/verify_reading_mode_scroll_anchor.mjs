/**
 * verify_reading_mode_scroll_anchor.mjs — Phase 4.18
 *
 * public/js/ui.js에 다음 정책이 코드 레벨에서 살아있는지 정적 검사:
 *   1. setReadMode가 모드 전환 시 viewport anchor를 캡처한다 (_captureReadingAnchor 호출)
 *   2. setReadMode가 모드 전환 후 anchor를 복원한다 (_restoreReadingAnchor 호출)
 *   3. 청독/묵독→낭독 진입 시 _focusLineIndex를 anchor 기준으로 동기화한다
 *   4. applyFocusLine(true) — restoreOnly로 호출되어 강제 스크롤 점프가 일어나지 않는다
 *   5. _scrollToTopOnEpisodeChange는 episode navigation에만 호출되고 mode toggle에는 호출되지 않는다
 *
 * Usage: node scripts/verify_reading_mode_scroll_anchor.mjs
 * Exit code: 0 PASS, 1 FAIL
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const uiPath = path.join(root, "public", "js", "ui.js");
const generatePath = path.join(root, "public", "js", "generate.js");

const ui = fs.readFileSync(uiPath, "utf8");
const gen = fs.readFileSync(generatePath, "utf8");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

// 1. _captureReadingAnchor 함수가 정의되었는가
check(
  "1. _captureReadingAnchor 함수 정의",
  /function\s+_captureReadingAnchor\s*\(/.test(ui),
  ""
);

// 2. _restoreReadingAnchor 함수가 정의되었는가
check(
  "2. _restoreReadingAnchor 함수 정의",
  /function\s+_restoreReadingAnchor\s*\(/.test(ui),
  ""
);

// 3. setReadMode 함수 본문에서 _captureReadingAnchor 호출
const setReadModeMatch = ui.match(/function\s+setReadMode\s*\([^)]*\)\s*\{([\s\S]*?)\n\}\s*(?:\/\/[^\n]*\n|$|\n\s*function|\n\s*\/\/)/);
const setReadModeBody = setReadModeMatch?.[1] ?? "";
check(
  "3. setReadMode가 _captureReadingAnchor 호출",
  /_captureReadingAnchor\s*\(\s*\)/.test(setReadModeBody),
  setReadModeBody ? "" : "function body 추출 실패"
);

// 4. setReadMode가 _restoreReadingAnchor 호출
check(
  "4. setReadMode가 _restoreReadingAnchor 호출",
  /_restoreReadingAnchor\s*\(/.test(setReadModeBody),
  ""
);

// 5. 낭독 진입 시 _focusLineIndex를 anchor.index로 동기화
check(
  "5. 낭독 진입 시 _focusLineIndex = anchor.index 동기화",
  /_focusLineIndex\s*=\s*anchor\.index/.test(setReadModeBody),
  ""
);

// 6. applyFocusLine(true) 호출 — restoreOnly로 강제 스크롤 점프 방지
check(
  "6. applyFocusLine(true) — restoreOnly 호출",
  /applyFocusLine\s*\(\s*true\s*\)/.test(setReadModeBody),
  ""
);

// 7. _scrollToTopOnEpisodeChange는 generate.js에 있고, ui.js setReadMode에서는 호출되지 않음
check(
  "7. setReadMode가 _scrollToTopOnEpisodeChange를 호출하지 않음 (mode toggle ≠ episode change)",
  !/_scrollToTopOnEpisodeChange/.test(setReadModeBody),
  ""
);

// 8. _scrollToTopOnEpisodeChange는 viewPrev/viewNext에서만 호출됨
const viewPrevBody = (gen.match(/function\s+viewPrev\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1]) ?? "";
const viewNextBody = (gen.match(/function\s+viewNext\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1]) ?? "";
check(
  "8. viewPrev에서 _scrollToTopOnEpisodeChange 호출",
  /_scrollToTopOnEpisodeChange\s*\(\s*\)/.test(viewPrevBody),
  ""
);
check(
  "9. viewNext에서 _scrollToTopOnEpisodeChange 호출",
  /_scrollToTopOnEpisodeChange\s*\(\s*\)/.test(viewNextBody),
  ""
);

// 10. anchor에는 viewport 내 paragraph index와 offset이 모두 포함됨
check(
  "10. anchor 객체에 index + offsetWithin 포함",
  /index\s*:\s*\w+[\s\S]*offsetWithin\s*:/.test(ui) || /offsetWithin\s*:[\s\S]*index\s*:/.test(ui),
  ""
);

const W = 75;
console.log(`\n${"═".repeat(W)}`);
console.log(" Reading Mode Scroll Anchor — Static Verification");
console.log(`${"═".repeat(W)}`);
let pass = 0, fail = 0;
for (const c of checks) {
  if (c.ok) { pass++; console.log(`  ✅ ${c.name}`); }
  else      { fail++; console.log(`  ❌ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`); }
}
console.log(`${"─".repeat(W)}`);
console.log(`총 ${checks.length} | PASS ${pass} | FAIL ${fail}`);
console.log(`${"═".repeat(W)}\n`);
process.exit(fail > 0 ? 1 : 0);
