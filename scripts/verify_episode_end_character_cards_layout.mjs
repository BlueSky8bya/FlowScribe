/**
 * verify_episode_end_character_cards_layout.mjs — R5B-1.8C UI
 *
 * 정적 contract verifier:
 *   1. 본문 하단 인물 카드 wrapper class — 기본 open (.collapsed 안 붙음)
 *   2. wrapper에 ep-end-card 변종 클래스 부착
 *   3. 아이템 description은 .item-card-expandable.collapsed로 기본 hidden 유지
 *   4. ep-end-grid CSS — capture+ 계열 카드 톤 (background bg2, border, padding 18+ , vertical 리스트)
 *   5. ep-end-grid .item-card는 vertical 리스트 (left-border accent + transparent bg)
 *
 * 본 verify는 시각 회귀 detect 안 함 — DOM 구조 + CSS 클래스 contract만 검증.
 * 시각 회귀는 사용자 브라우저 검증으로.
 */
import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const generateJs = readFileSync("public/js/generate.js", "utf8");
const componentsCss = readFileSync("public/css/components.css", "utf8");

console.log("── [JS] _buildSceneCharDetailedCardHtml — wrapper open by default ──");
okIf("wrapper에 ep-end-card 변종 클래스 부착",
  /class="scene-char-item ep-end-card"/.test(generateJs));
okIf("wrapper에 .collapsed 클래스 미부착 (기본 open)",
  !/class="scene-char-item collapsed"/.test(generateJs));
okIf("scene-char-header onclick=toggleCharCard 유지 (사용자 접기 가능)",
  /scene-char-header"\s*onclick="toggleCharCard/.test(generateJs));
okIf("R5B-1.8C UI 주석 헤더",
  /R5B-1\.8C UI:\s*본문 하단 카드는 _기본 open_/.test(generateJs));

console.log("\n── [JS] item-card description collapsed by default ──");
okIf("item-card-expandable + collapsed 클래스 (description hidden)",
  /item-card-expandable collapsed/.test(generateJs));
okIf("hasDetail 시 onclick=toggleItemCard (펼치기 가능)",
  /hasDetail.*?onclick="toggleItemCard\(this\)/.test(generateJs));
okIf("toggleItemCard 함수 export",
  /function toggleItemCard/.test(generateJs));

console.log("\n── [CSS] ep-end-grid — capture+ 계열 카드 톤 ──");
okIf("ep-end-card padding 확대 (18+ 20+)",
  /\.ep-end-grid \.scene-char-item\.ep-end-card\s*\{[\s\S]*?padding:18px 20px 16px/.test(componentsCss));
okIf("ep-end-card background:bg2",
  /\.ep-end-grid \.scene-char-item\.ep-end-card\s*\{[\s\S]*?background:var\(--bg2\)/.test(componentsCss));
okIf("ep-end-card border:1px solid var(--border)",
  /\.ep-end-grid \.scene-char-item\.ep-end-card\s*\{[\s\S]*?border:1px solid var\(--border\)/.test(componentsCss));
okIf("ep-end-card 헤더 separator (border-bottom)",
  /\.ep-end-grid \.scene-char-item\.ep-end-card \.scene-char-header[\s\S]*?border-bottom:1px solid var\(--border\)/.test(componentsCss));

console.log("\n── [CSS] item-card vertical 리스트 (capture+ cap-item-row 스타일 계열) ──");
okIf("ep-end-grid item-card background:transparent (박스 제거)",
  /\.ep-end-grid \.item-card\s*\{[\s\S]*?background:transparent/.test(componentsCss));
okIf("ep-end-grid item-card border:none + border-left 강조",
  /\.ep-end-grid \.item-card\s*\{[\s\S]*?border:none;[\s\S]*?border-left:2px/.test(componentsCss));
okIf("ep-end-grid item-card grade별 border-left 색상 유지",
  /\.ep-end-grid \.item-card\[data-grade="S"\]\{border-left-color:/.test(componentsCss));
okIf("ep-end-grid item-card-body 분리선 (border-top dashed)",
  /\.ep-end-grid \.item-card-body[\s\S]*?border-top:1px dashed/.test(componentsCss));
okIf("ep-end-grid R5B-1.8C UI 주석 헤더",
  /R5B-1\.8C UI:.*본문 하단 카드/.test(componentsCss));

console.log("\n── [정책] 데이터 정책 회귀 없음 ──");
okIf("appearedFilter (_isAppearedForDisplay) 사용 유지",
  /_isAppearedForDisplay\(s,\s*outputText\)/.test(generateJs));
okIf("absent_in_body guard 유지 (pipeline 미수정 확인은 별 verify에서)",
  /renderEpisodeEndCharCards/.test(generateJs));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
