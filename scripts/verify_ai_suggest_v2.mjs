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

console.log(`\n${"─".repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
