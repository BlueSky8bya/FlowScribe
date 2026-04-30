/**
 * verify_active_gen_book_return.mjs — Phase 4.20 R5A stabilization
 *
 * 본문 생성 중 다른 책으로 이동했다가 다시 돌아왔을 때:
 *   - DB의 stale 콘텐츠(재생성 직전 본문)가 일시 노출되면 안 됨
 *   - 진행 중 누적된 토큰이 있으면 그대로 표시 (hybrid streaming 대응)
 *   - 토큰이 없으면 loading UI로 복원
 *   - ep-end card 영역은 생성 중이므로 숨김
 *   - 토큰 누적은 책 전환 중에도 끊기지 않음 (rawText에 항상 누적)
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const gen  = readFileSync("public/js/generate.js", "utf8");
const auth = readFileSync("public/js/auth.js", "utf8");

console.log("── [1] token 핸들러 — 책 전환 중에도 rawText 누적 ──");
{
  const idx = gen.search(/else if \(json\.token\)/);
  const slice = idx >= 0 ? gen.slice(idx, idx + 700) : "";
  okIf("rawText += json.token이 stale check 이전에 위치 (항상 누적)",
    /rawText\s*\+=\s*json\.token[\s\S]{0,300}if\s*\(\s*bookId\s*!==\s*_genSession\.bookIdAtStart\s*\)/.test(slice));
  okIf("window._fsActiveGenText에 누적 (전역 buffer)",
    /window\._fsActiveGenText\s*=\s*rawText/.test(slice));
  okIf("stale 시 화면 반영 skip (return)",
    /if\s*\(\s*bookId\s*!==\s*_genSession\.bookIdAtStart\s*\)\s*\{[\s\S]{0,400}return\s*;/.test(slice));
  okIf("stale 시 toast 안내", /_staleMsgShown[\s\S]{0,200}showToast/.test(slice));
}

console.log("\n── [2] _fsRestoreActiveGenView helper ──");
okIf("window._fsRestoreActiveGenView 정의", /window\._fsRestoreActiveGenView\s*=\s*function/.test(gen));
okIf("status==='generating'에만 동작", /ag\.status\s*!==\s*['"]generating['"]/.test(gen));
okIf("누적 토큰 있으면 즉시 렌더 (renderProgressiveRaw)", /window\._fsActiveGenText[\s\S]{0,300}renderProgressiveRaw/.test(gen));
okIf("토큰 없으면 _makeLoadingHTML + _startLoadingAnim", /_makeLoadingHTML\(\)[\s\S]{0,200}_startLoadingAnim/.test(gen));
okIf("episode-end card 숨김 (이전 회차 카드 노출 차단)", /window\._fsRestoreActiveGenView[\s\S]{0,800}episodeEndCards[\s\S]{0,80}hidden\s*=\s*true/.test(gen));

console.log("\n── [3] 생성 시작 시 buffer 초기화 ──");
okIf("generate() 시작 시 _fsActiveGenText = '' 초기화", /window\._fsActiveGenText\s*=\s*['"]{2}/.test(gen));
okIf("_finishGeneration 완료 시 _fsActiveGenText cleanup", /window\._fsActiveGen\s*=\s*null[\s\S]{0,200}window\._fsActiveGenText\s*=/.test(gen));

console.log("\n── [4] selectBook 활성 생성 책 복귀 감지 ──");
okIf("_isReturnToActiveGen flag 정의 (status + bookId 일치)",
  /_isReturnToActiveGen[\s\S]{0,200}status\s*===\s*['"]generating['"][\s\S]{0,200}bookId\s*===\s*book\.id/.test(auth));
okIf("복귀 시 _renderLatestEpisode skip + restore helper 호출",
  /_isReturnToActiveGen[\s\S]{0,500}window\._fsRestoreActiveGenView/.test(auth) ||
  /if\s*\(\s*_isReturnToActiveGen\s*\)[\s\S]{0,400}_fsRestoreActiveGenView/.test(auth));
okIf("복귀 시 episodeCache는 채워둠 (다른 회차 탐색 가능)",
  /_isReturnToActiveGen[\s\S]{0,400}episodeCache\[ep\.episode_number\]/.test(auth));
okIf("복귀 시 'N화 불러왔습니다' toast 억제",
  /epCount\s*>\s*0\s*&&\s*!_isReturnToActiveGen/.test(auth));

console.log("\n── [5] 다른 책 이동 시 안내 (기존 동작 유지) ──");
okIf("다른 책 이동 toast", /진행 중 생성|생성 중입니다/.test(auth));

console.log("\n── [6] dist 빌드 (FE만 변경, build 영향 없음) ──");
okIf("public/js/generate.js exists", existsSync("public/js/generate.js"));
okIf("public/js/auth.js exists", existsSync("public/js/auth.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
