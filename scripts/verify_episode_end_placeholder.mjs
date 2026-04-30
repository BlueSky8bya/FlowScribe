/**
 * verify_episode_end_placeholder.mjs — Phase 4.19C
 *
 * "이번 화의 인물 상태를 정리하고 있습니다…" placeholder UX 정적 검증.
 *   1. 본문 token 첫 도착 시 placeholder 표시
 *   2. 생성 시작 시 (재생성·다음화 모두) 이전 화 카드 즉시 hide
 *   3. char-states 도착 시 renderEpisodeEndCharCards가 placeholder를 통째로 교체
 *   4. CSS .ep-end-pending + spinner 정의
 */
import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const check = (s, c, d) => c ? ok(s) : ng(s, d);

const gen = readFileSync("public/js/generate.js", "utf8");
const css = readFileSync("public/css/components.css", "utf8");

console.log("── [1] 생성 시작 시 이전 카드 즉시 hide ──");
{
  const idx = gen.search(/function _clearDebugPanels/);
  const slice = idx >= 0 ? gen.slice(idx, idx + 1500) : "";
  check("_clearDebugPanels에서 episodeEndCards hide + innerHTML 클리어",
    /episodeEndCards/.test(slice) && /hidden\s*=\s*true/.test(slice));
}

console.log("\n── [2] token 첫 도착 시 placeholder 표시 ──");
{
  // SSE token 핸들러 안에서 placeholder DOM 삽입 패턴
  const tokenIdx = gen.search(/json\.token/);
  const slice = tokenIdx >= 0 ? gen.slice(tokenIdx, tokenIdx + 2000) : "";
  check("token 핸들러에서 #episodeEndCards 참조",
    /document\.getElementById\(['"]episodeEndCards/.test(slice));
  check("placeholder 텍스트 (정리하고 있습니다)",
    /정리하고\s*있습니다/.test(slice));
  check("ep-end-pending wrapper 마크업",
    /ep-end-pending/.test(slice) && /ep-end-pending-spinner/.test(slice));
  check("placeholder 한 번만 표시 (already visible 시 skip)",
    /_epEnd\.hidden/.test(slice) && /if\s*\(_epEnd\s*&&\s*_epEnd\.hidden\)/.test(slice));
}

console.log("\n── [3] char-states 도착 시 카드로 교체 ──");
{
  const idx = gen.search(/function renderEpisodeEndCharCards/);
  const slice = idx >= 0 ? gen.slice(idx, idx + 1500) : "";
  check("renderEpisodeEndCharCards가 wrap.innerHTML 통째로 교체",
    /wrap\.innerHTML\s*=/.test(slice));
  check("renderEpisodeEndCharCards가 _generating 가드",
    /_generating/.test(slice));
  check("renderEpisodeEndCharCards가 _buildSceneCharDetailedCardHtml 호출",
    /_buildSceneCharDetailedCardHtml/.test(slice));
}

console.log("\n── [4] CSS .ep-end-pending 스타일 ──");
check(".ep-end-pending 스타일", /\.ep-end-pending\s*\{/.test(css));
check(".ep-end-pending-spinner 스타일", /\.ep-end-pending-spinner\s*\{/.test(css));
check("@keyframes ep-end-spin 애니메이션", /@keyframes\s+ep-end-spin/.test(css));

console.log("\n── [5] 실패 fallback (조용한 무시) ──");
{
  // updateSceneCharPanel가 try/catch로 감싸여 있는지
  const idx = gen.search(/function updateSceneCharPanel/);
  const slice = idx >= 0 ? gen.slice(idx, idx + 800) : "";
  check("updateSceneCharPanel가 renderEpisodeEndCharCards 호출을 try로 감쌈",
    /try\s*\{[\s\S]{0,200}renderEpisodeEndCharCards/.test(slice));
}

console.log("\n── [6] 산출물 ──");
check("public/js/generate.js exists", existsSync("public/js/generate.js"));
check("public/css/components.css exists", existsSync("public/css/components.css"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
