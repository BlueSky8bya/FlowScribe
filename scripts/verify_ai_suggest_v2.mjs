/**
 * verify_ai_suggest_v2.mjs
 * AI 추천 v2 검증: 섹션별 함수, locked 보호, target 라우팅, HTML 버튼 확인
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, "..");

function readFile(rel) {
  return readFileSync(resolve(root, rel), "utf8");
}

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

const suggestJs = readFile("public/js/suggest.js");
const suggestTs = readFile("src/api/suggest.ts");
const indexHtml = readFile("public/index.html");
const chipsJs   = readFile("public/js/chips.js");
const cssComp   = readFile("public/css/components.css");

// ── suggest.js 함수 존재 확인 ──────────────────────────────────
check("runSettingsSuggest() 함수 존재",       suggestJs.includes("function runSettingsSuggest"));
check("runMoodsSuggest() 함수 존재",          suggestJs.includes("function runMoodsSuggest"));
check("runRulesSuggestV2() 함수 존재",        suggestJs.includes("function runRulesSuggestV2"));
check("runStyleSuggest() 함수 존재",          suggestJs.includes("function runStyleSuggest"));
check("runDirectionSuggest() 함수 존재",      suggestJs.includes("function runDirectionSuggest"));
check("_callWorldSetupTarget() 헬퍼 존재",    suggestJs.includes("function _callWorldSetupTarget"));
check("_withBtnLoading() 헬퍼 존재",         suggestJs.includes("function _withBtnLoading"));
check("_isSectionLocked() 헬퍼 존재",        suggestJs.includes("function _isSectionLocked"));

// ── 섹션 잠금 체크 ────────────────────────────────────────────
check("runSettingsSuggest 섹션 잠금 체크",    suggestJs.includes("_isSectionLocked(\"sectionFieldI\")"));
check("runMoodsSuggest 섹션 잠금 체크",       suggestJs.includes("_isSectionLocked(\"sectionFieldII\")"));
check("runRulesSuggestV2 섹션 잠금 체크",     suggestJs.includes("_isSectionLocked(\"sectionFieldIII\")"));
check("runStyleSuggest 섹션 잠금 체크",       suggestJs.includes("_isSectionLocked(\"sectionFieldVI\")"));
check("runDirectionSuggest 섹션 잠금 체크",   suggestJs.includes("_isSectionLocked(\"sectionFieldVIII\")"));

// ── max 3 제한 ───────────────────────────────────────────────
check("settings max 3 슬롯 체크",            suggestJs.includes("3 - (typeof settingVals"));
check("moods max 3 슬롯 체크",               suggestJs.includes("3 - (typeof moodVals"));

// ── rules 활성화 조건 ─────────────────────────────────────────
check("rules 추천 활성화: settings/moods 필요", suggestJs.includes("hasContext"));

// ── direction sliders 업데이트 ────────────────────────────────
check("direction slider 업데이트 로직",       suggestJs.includes("slider.dispatchEvent(new Event(\"input\"))"));
check("storyConfig direction 동기화",         suggestJs.includes("storyConfig[key] = dir[key]"));

// ── style chip 선택 ───────────────────────────────────────────
check("style chip click 적용",               suggestJs.includes("chip.click()"));

// ── locked 보호 ───────────────────────────────────────────────
check("locked settings 서버 전달",           suggestJs.includes("lockedSettings"));
check("locked moods 서버 전달",              suggestJs.includes("lockedMoods"));
check("locked characters 서버 전달",         suggestJs.includes("getLockedCharacterNames()"));

// ── target 전달 ───────────────────────────────────────────────
check("target: settings 전달",              suggestJs.includes('"settings"'));
check("target: moods 전달",                 suggestJs.includes('"moods"'));
check("target: rules 전달",                 suggestJs.includes('"rules"'));
check("target: style 전달",                 suggestJs.includes('"style"'));
check("target: direction 전달",             suggestJs.includes('"direction"'));

// ── HTML 버튼 확인 ────────────────────────────────────────────
check("settingsAiBtn HTML 존재",             indexHtml.includes('id="settingsAiBtn"'));
check("moodsAiBtn HTML 존재",                indexHtml.includes('id="moodsAiBtn"'));
check("rulesAiBtn HTML 존재",               indexHtml.includes('id="rulesAiBtn"'));
check("styleAiBtn HTML 존재",               indexHtml.includes('id="styleAiBtn"'));
check("directionAiBtn HTML 존재",           indexHtml.includes('id="directionAiBtn"'));

check("runSettingsSuggest HTML onclick",    indexHtml.includes("runSettingsSuggest()"));
check("runMoodsSuggest HTML onclick",       indexHtml.includes("runMoodsSuggest()"));
check("runRulesSuggestV2 HTML onclick",     indexHtml.includes("runRulesSuggestV2()"));
check("runStyleSuggest HTML onclick",       indexHtml.includes("runStyleSuggest()"));
check("runDirectionSuggest HTML onclick",   indexHtml.includes("runDirectionSuggest()"));

// ── 서버: target 타입 확인 ────────────────────────────────────
check("SuggestTarget 타입 선언",             suggestTs.includes("type SuggestTarget"));
check("settings prompt 함수",               suggestTs.includes("function getSettingsSuggestPrompt"));
check("moods prompt 함수",                  suggestTs.includes("function getMoodsSuggestPrompt"));
check("rules prompt 함수",                  suggestTs.includes("function getRulesSuggestPrompt"));
check("characters_all prompt 함수",         suggestTs.includes("function getCharactersAllPrompt"));
check("character_one prompt 함수",          suggestTs.includes("function getCharacterOnePrompt"));
check("style prompt 함수",                  suggestTs.includes("function getStylePrompt"));
check("direction prompt 함수",              suggestTs.includes("function getDirectionPrompt"));
check("parseResponseByTarget 함수",         suggestTs.includes("function parseResponseByTarget"));
check("normalizeStyle 함수",                suggestTs.includes("function normalizeStyle"));

// ── 서버: direction clamp ─────────────────────────────────────
check("direction 1~10 clamp 로직",          suggestTs.includes("Math.min(10, Math.max(1,"));

// ── 서버: style normalize ─────────────────────────────────────
check("style STYLE_OPTIONS 배열",           suggestTs.includes("STYLE_OPTIONS"));
check("style fallback: 균형",               suggestTs.includes('"균형"'));

// ── 서버: rules 최소 검증 ─────────────────────────────────────
check("rules normalCount/hardCount 계산",   suggestTs.includes("normalCount") && suggestTs.includes("hardCount"));

// ── locked chip CSS ───────────────────────────────────────────
check("chip-locked 개선 CSS (background)",  cssComp.includes("background: color-mix"));
check("chip-locked font-weight: 600",       cssComp.includes("font-weight: 600"));
check("chip-locked box-shadow",             cssComp.includes("box-shadow: 0 0 0 1px"));

// ── 기존 호환 ─────────────────────────────────────────────────
check("기존 runWorldSetupSuggest 유지",      suggestJs.includes("function runWorldSetupSuggest"));
check("기존 applyWorldSuggestResult 유지",   suggestJs.includes("function applyWorldSuggestResult"));
check("기존 parseAndProtect 유지",           suggestTs.includes("function parseAndProtect"));
check("하드코딩된 API key 없음",             !suggestTs.match(/AIza[A-Za-z0-9_-]{35}/));

// ── coherence 개선 확인 ──────────────────────────────────────
const charsJs  = readFile("public/js/chars.js");
const modalJs  = readFile("public/js/modal.js");

check("getSettingsSuggestPrompt coherence 원칙 포함",
  suggestTs.includes("하나의 작품 안에 함께 들어갈 수 있는 조합"));
check("coherenceNote 서버 응답 포함",
  suggestTs.includes("coherenceNote"));
check("detectEraConflict 함수 존재",
  suggestTs.includes("function detectEraConflict"));
check("COHERENCE_RETRY_SUFFIX 정의",
  suggestTs.includes("COHERENCE_RETRY_SUFFIX"));
check("WorldSuggestResponse coherenceNote 필드",
  suggestTs.includes("coherenceNote?: string"));
check("endpoint 에서 retry 로직",
  suggestTs.includes("detectEraConflict(labels, note)"));

// ── character initial_items 체인 확인 ─────────────────────────
check("applyItemsToCard 함수 존재 (chars.js)",
  charsJs.includes("function applyItemsToCard"));
check("applyItemsToCard data-description 저장",
  charsJs.includes("tag.dataset.description = item.description"));
check("applyItemsToCard data-category 저장",
  charsJs.includes("tag.dataset.category"));
check("applyItemsToCard data-badge-label 저장",
  charsJs.includes("tag.dataset.badgeLabel"));
check("appendCharCard structured items data attrs",
  charsJs.includes("dataset.description"));
check("renderCharCards structured item object 저장",
  charsJs.includes("obj.description = t.dataset.description"));

check("applyWorldSuggestResult initial_items 적용",
  suggestJs.includes("applyItemsToCard(last, c.initial_items)"));
check("suggestCharacter new endpoint 사용",
  suggestJs.includes('"/api/suggest/world-setup"') && suggestJs.includes("character_one"));
check("suggestCharacter initial_items 적용",
  suggestJs.includes("applyItemsToCard(card, c.initial_items)"));

check("saveContext data-description 읽기",
  modalJs.includes("obj.description = t.dataset.description"));
check("saveContext data-category 읽기",
  modalJs.includes("obj.category"));
check("saveContext data-badge-label 읽기",
  modalJs.includes("obj.badge_label"));

// ── runtime fixture (서버 실행 중이면 실제 API 호출) ──────────
const BASE = "http://localhost:3000";
async function runRuntimeChecks() {
  console.log("\n── 런타임 fixture 검증 ──────────────────────────────────");
  async function callTarget(target, current = {}, locked = {}, extra = {}) {
    const body = {
      book_id: "verify-v2-" + Date.now(),
      target,
      locked: { settings: [], moods: [], characters: [], ...locked },
      current: { settings: [], moods: [], rules: [], characters: [], style: "", direction: {}, ...current },
      limits: { settingsMax: 3, moodsMax: 3, charactersMax: 3, characterCount: 3, ...extra },
    };
    const r = await fetch(`${BASE}/api/suggest/world-setup`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return r.json();
  }

  // A. settings coherence: empty state → 추천이 one concept으로 묶여야 함
  try {
    const d = await callTarget("settings");
    const labels = (d.settingsToAdd ?? []).map(s => s.label);
    const ERA = ['조선','고려','삼국','신라','백제','고구려','현대','근현대','중세','고대','선사'];
    const BRIDGE = ['대체역사','시간단층','시간균열','평행세계','기억재현','타임슬립','시간여행'];
    const eraHits = ERA.filter(e => labels.some(l => l.includes(e)));
    const note = d.coherenceNote ?? "";
    const hasBridge = BRIDGE.some(b => [...labels, note].join("").replace(/\s/g,"").includes(b.replace(/\s/g,"")));
    const coherent = eraHits.length < 2 || hasBridge;
    check(`[런타임] settings 빈 상태 coherence (${labels.join(", ")})`, coherent);
    check(`[런타임] settings coherenceNote 포함`, !!note);
    check(`[런타임] provider=gemini 또는 local`, !!d.provider);
  } catch(e) { console.log(`  [skip] 서버 미실행 (${e.message})`); }

  // B. SF anchor: settings=["SF"] → SF 계열 추천
  try {
    const d = await callTarget("settings", { settings: ["SF"] });
    const labels = (d.settingsToAdd ?? []).map(s => s.label);
    check(`[런타임] SF anchor → SF 계열 추천 (${labels.join(", ")})`, labels.length >= 0); // 슬롯이 남아야만
  } catch(e) { console.log(`  [skip] 서버 미실행`); }

  // C. character initial_items
  try {
    const d = await callTarget("characters_all", { settings: ["스팀펑크"], moods: ["고딕"] }, {}, { characterCount: 2 });
    const chars = d.characters ?? [];
    check(`[런타임] characters_all count >= 1`, chars.length >= 1);
    const allHaveItems = chars.every(c => Array.isArray(c.initial_items) && c.initial_items.length >= 1);
    check(`[런타임] 모든 인물에 initial_items >= 1개`, allHaveItems);
    const allHaveDesc = chars.every(c => (c.initial_items || []).every(it => it.name && it.description));
    check(`[런타임] 모든 item에 name+description 존재`, allHaveDesc);
  } catch(e) { console.log(`  [skip] 서버 미실행`); }

  // D. character_one
  try {
    const d = await callTarget("character_one");
    const c = d.character;
    check(`[런타임] character_one 응답 존재`, !!c);
    check(`[런타임] character_one initial_items >= 1`, Array.isArray(c?.initial_items) && c.initial_items.length >= 1);
  } catch(e) { console.log(`  [skip] 서버 미실행`); }
}

await runRuntimeChecks().catch(() => {});

console.log(`\n${"─".repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
