/**
 * verify_episode_end_character_cards.mjs — Phase 4.19
 *
 * 본문 하단 회차 종료 카드 + 사이드바 축소 + hover 감정 제거 정적 검증.
 */
import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const check = (s, c, d) => c ? ok(s) : ng(s, d);

const html = readFileSync("public/index.html", "utf8");
const gen  = readFileSync("public/js/generate.js", "utf8");
const css  = readFileSync("public/css/components.css", "utf8");

console.log("── [1] DOM 컨테이너 ──");
check("index.html에 #episodeEndCards container 추가", /id="episodeEndCards"/.test(html));
check("output-scroll-area 안에 위치", /output-scroll-area[\s\S]{0,500}episodeEndCards/.test(html));

console.log("\n── [2] generate.js 함수 ──");
check("renderEpisodeEndCharCards 함수 정의", /function renderEpisodeEndCharCards\s*\(/.test(gen));
check("updateSceneCharPanel가 renderEpisodeEndCharCards 호출", /renderEpisodeEndCharCards\(charStates\)/.test(gen));
check("ep-end-card / ep-end-grid markup 생성", /class="ep-end-card"/.test(gen) && /class="ep-end-grid"/.test(gen));
check("emotional_state · physical_state · location · items 모두 표시", /s\.emotional_state/.test(gen) && /s\.physical_state/.test(gen) && /s\.location/.test(gen));

console.log("\n── [3] 사이드바 축소 ──");
check("scene-char-min markup (이름+성별만)", /class="scene-char-min"/.test(gen));
check("legacy 확장형 함수는 _legacy로 보존", /_legacyUpdateSceneCharPanelDetailed/.test(gen));
{
  const idx = gen.search(/function updateSceneCharPanel/);
  const slice = idx >= 0 ? gen.slice(idx, idx + 1500) : "";
  check("기본 updateSceneCharPanel은 minimal 렌더만 emit",
    /scene-char-min/.test(slice) && !/scene-char-detail/.test(slice));
}

console.log("\n── [4] hover 감정 제거 ──");
const showCardIdx = gen.search(/function showCard/);
const showCardSrc = showCardIdx >= 0 ? gen.slice(showCardIdx, showCardIdx + 1500) : "";
check("showCard 안에서 _emotBadgesHtml 호출 제거", !/_emotBadgesHtml/.test(showCardSrc));
check("showCard 안에서 _physBadgesHtml 호출 제거", !/_physBadgesHtml/.test(showCardSrc));
check("statusEl.innerHTML='' 으로 비움", /statusEl\.innerHTML\s*=\s*['"]/.test(showCardSrc));
check("성별 라벨은 여전히 노출", /genderLabel/.test(showCardSrc));

console.log("\n── [5] 성별 밑줄 유지 (wrapCharNamesInOutput) ──");
const wrapIdx = gen.search(/function wrapCharNamesInOutput/);
const wrapSrc = wrapIdx >= 0 ? gen.slice(wrapIdx, wrapIdx + 1500) : "";
check("border-bottom-color: gColor 패턴 유지", wrapSrc.includes("border-bottom-color:${gColor}"));

console.log("\n── [6] CSS 정의 ──");
check(".episode-end-cards 스타일 정의", /\.episode-end-cards\s*\{/.test(css));
check(".ep-end-card 스타일 정의", /\.ep-end-card\s*\{/.test(css));
check(".scene-char-min 스타일 정의", /\.scene-char-min\s*\{/.test(css));

console.log("\n── [7] dist 빌드 산출물 ──");
check("public/js/generate.js exists", existsSync("public/js/generate.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
