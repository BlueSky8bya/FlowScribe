/**
 * verify_episode_end_character_cards_layout.mjs — POST-1 §S10 reopen
 *
 * 정적 contract verifier:
 *   1. 본문 하단 인물 카드 = 캡처와 동일 _buildCapStyleCharCardHtml (shared renderer).
 *   2. wrapper에 cap-char-card + scene-char-item ep-end-card 병합 클래스 부착.
 *   3. 항상 펼침 — toggle/chevron 없음, item-card-expandable.collapsed 미사용.
 *   4. 소지품 상세 (상태:/설명:/위치:) 기본 노출 (cap-item-row inline 구조).
 *   5. 캡처 flow도 동일 shared renderer 호출 — duplicated inline builder 제거.
 *
 * 본 verify는 시각 회귀 detect 안 함 — DOM 구조 + shared renderer contract만 검증.
 * 시각 회귀는 사용자 브라우저 검증으로.
 */
import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const generateJs = readFileSync("public/js/generate.js", "utf8");
const componentsCss = readFileSync("public/css/components.css", "utf8");

console.log("── [JS] shared cap-style renderer 정의 ──");
okIf("_buildCapStyleCharCardHtml 함수 정의 (shared renderer)",
  /function _buildCapStyleCharCardHtml\s*\(/.test(generateJs));
okIf("cap-char-card wrapper class + inline cap-style 시작",
  /class="\$\{cls\}"[\s\S]{0,400}background:var\(--bg2\)[\s\S]{0,160}border-radius:10px[\s\S]{0,80}padding:\.75rem 1rem/.test(generateJs));
okIf("opts.extraClass로 wrapper class 합성 (verify-호환)",
  /cap-char-card[\s\S]{0,80}opts\.extraClass/.test(generateJs));
okIf("opts.dataChar로 data-char 속성 토글",
  /opts\.dataChar[\s\S]{0,80}data-char="\$\{s\.character_name\}"/.test(generateJs));

console.log("\n── [JS] _buildSceneCharDetailedCardHtml = thin wrapper ──");
okIf("_buildSceneCharDetailedCardHtml은 _buildCapStyleCharCardHtml 호출",
  /function _buildSceneCharDetailedCardHtml[\s\S]{0,200}_buildCapStyleCharCardHtml\(s,\s*\{/.test(generateJs));
okIf("ep-end wrapper extraClass = 'scene-char-item ep-end-card'",
  /extraClass:\s*'scene-char-item ep-end-card'/.test(generateJs));
okIf("dataChar: true (출력 동기화 selector 유지)",
  /dataChar:\s*true/.test(generateJs));

console.log("\n── [JS] 항상 펼침 — toggle/chevron 미부착 ──");
okIf("wrapper에 .collapsed 클래스 미부착 (기본 open)",
  !/class="scene-char-item collapsed"/.test(generateJs));
okIf("item-card-expandable + collapsed 미사용 (구조 항상 펼침)",
  !/item-card-expandable collapsed/.test(generateJs));
okIf("scene-char-header onclick=toggleCharCard 제거 (cap-style은 단순 헤더)",
  !/scene-char-header"\s*onclick="toggleCharCard/.test(generateJs));

console.log("\n── [JS] 소지품 상세 항상 노출 (cap-item-row 구조) ──");
okIf("cap-item-row markup (inline border-left + padding)",
  /class="cap-item-row"\s+style="border-left:2px solid/.test(generateJs));
okIf("상태: 라벨 inline (cond 있을 때 항상)",
  />\s*상태:\s*<\/span>/.test(generateJs));
okIf("설명: 라벨 inline (effectiveDesc 있을 때 항상)",
  />\s*설명:\s*<\/span>/.test(generateJs));
okIf("위치: 라벨 inline (hiddenNote 있을 때 항상)",
  />\s*위치:\s*<\/span>/.test(generateJs));

console.log("\n── [JS] 캡처 flow도 shared renderer 호출 ──");
okIf("캡처 inline 빌더 제거 — appearing.map(s => _buildCapStyleCharCardHtml(s))",
  /appearing\.map\(s\s*=>\s*_buildCapStyleCharCardHtml\(s\)\)/.test(generateJs));
okIf("등장 인물 grid header 유지",
  /등장 인물[\s\S]{0,200}grid-template-columns:repeat\(auto-fill/.test(generateJs));

console.log("\n── [CSS] minimal contract — verify-호환 fallback ──");
okIf("ep-end-grid auto-fit grid 정의",
  /\.ep-end-grid\s*\{[\s\S]*?grid-template-columns:repeat\(auto-fit/.test(componentsCss));
okIf("ep-end-card fallback class rule (background:bg2, border, radius:10)",
  /\.ep-end-grid \.scene-char-item\.ep-end-card\s*\{[\s\S]*?background:var\(--bg2\)[\s\S]*?border:1px solid var\(--border\)[\s\S]*?border-radius:10px/.test(componentsCss));
okIf("POST-1 §S10 reopen 주석 헤더",
  /POST-1\s*§S10\s*reopen[\s\S]{0,200}_buildCapStyleCharCardHtml/.test(componentsCss));
okIf("obsolete .ep-end-grid .item-card 규칙 제거됨",
  !/\.ep-end-grid \.item-card\[data-grade=/.test(componentsCss));

console.log("\n── [정책] 데이터 정책 회귀 없음 ──");
okIf("appearedFilter (_isAppearedForDisplay) 사용 유지",
  /_isAppearedForDisplay\(s,\s*outputText\)/.test(generateJs));
okIf("renderEpisodeEndCharCards 함수 유지",
  /function renderEpisodeEndCharCards/.test(generateJs));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
