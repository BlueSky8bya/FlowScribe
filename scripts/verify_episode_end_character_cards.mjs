/**
 * verify_episode_end_character_cards.mjs — Phase 4.19
 *
 * 본문 하단 회차 종료 카드(detailed, 2열) + 사이드바 minimal + hover 완전 제거 정적 검증.
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

console.log("\n── [2] generate.js 함수 + 디자인 재사용 ──");
check("renderEpisodeEndCharCards 함수 정의", /function renderEpisodeEndCharCards\s*\(/.test(gen));
check("updateSceneCharPanel가 renderEpisodeEndCharCards 호출", /renderEpisodeEndCharCards\(charStates\)/.test(gen));
check("_buildSceneCharDetailedCardHtml helper 정의", /function _buildSceneCharDetailedCardHtml\s*\(/.test(gen));
check("ep-end-grid container 생성", /class="ep-end-grid"/.test(gen));
check("ep-end가 _buildSceneCharDetailedCardHtml 호출 (사이드바와 동일 markup)",
  /ep-end-grid[\s\S]{0,300}_buildSceneCharDetailedCardHtml/.test(gen));
check("legacy 사이드바도 같은 helper 호출",
  /_legacyUpdateSceneCharPanelDetailed[\s\S]{0,800}_buildSceneCharDetailedCardHtml/.test(gen));
check("scene-char-item / item-card markup 정의 (helper 안)",
  /class="scene-char-item collapsed"/.test(gen) && /class="item-card/.test(gen));

console.log("\n── [3] 사이드바 minimal ──");
check("scene-char-min markup (이름+성별만)", /class="scene-char-min"/.test(gen));
{
  const idx = gen.search(/function updateSceneCharPanel/);
  const slice = idx >= 0 ? gen.slice(idx, idx + 1500) : "";
  check("기본 updateSceneCharPanel은 minimal 렌더만 emit",
    /scene-char-min/.test(slice) && !/scene-char-detail/.test(slice));
}

console.log("\n── [4] hover 메커니즘 완전 제거 ──");
{
  const idx = gen.search(/function _ensureHoverListener/);
  const slice = idx >= 0 ? gen.slice(idx, idx + 600) : "";
  check("_ensureHoverListener는 단순 hidden 처리만",
    /card\.hidden\s*=\s*true/.test(slice));
  check("_ensureHoverListener에서 mouseover 리스너 제거",
    !/addEventListener\(['"]mouseover/.test(slice));
  check("_ensureHoverListener에서 _emotBadgesHtml 미호출",
    !/_emotBadgesHtml/.test(slice));
}
check("wrapCharNamesInOutput에서 _ensureHoverListener 호출 제거",
  !/_ensureHoverListener\(\);[\s\S]{0,80}\}\s*$/m.test(gen.slice(gen.search(/function wrapCharNamesInOutput/), gen.search(/function wrapCharNamesInOutput/) + 800)));

console.log("\n── [5] 성별 밑줄 색만 유지 ──");
const wrapIdx = gen.search(/function wrapCharNamesInOutput/);
const wrapSrc = wrapIdx >= 0 ? gen.slice(wrapIdx, wrapIdx + 1500) : "";
check("border-bottom-color: gColor 패턴 유지", wrapSrc.includes("border-bottom-color:${gColor}"));
check("char-name-ref CSS의 cursor:help 제거", !/span\.char-name-ref\{[^}]*cursor:help/.test(css));
check("char-name-ref :hover 효과 제거", !/span\.char-name-ref:hover/.test(css));

console.log("\n── [6] CSS 정의 (2열 grid) ──");
check(".episode-end-cards 스타일 정의", /\.episode-end-cards\s*\{/.test(css));
check(".ep-end-grid 2열 grid", /\.ep-end-grid\s*\{[^}]*grid-template-columns:repeat\(2/.test(css));
check(".scene-char-min 스타일 정의 (사이드바)", /\.scene-char-min\s*\{/.test(css));

console.log("\n── [7] 산출물 ──");
check("public/js/generate.js exists", existsSync("public/js/generate.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
