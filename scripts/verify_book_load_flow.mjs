/**
 * verify_book_load_flow.mjs
 * book list ↔ story content 분리 + selectBook 흐름 구조 검증
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, "..");
const read  = rel => readFileSync(resolve(root, rel), "utf8");

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`✓ ${label}`); passed++; }
  else      { console.error(`✗ ${label}`); failed++; }
}

const authJs    = read("public/js/auth.js");
const indexHtml = read("public/index.html");

// ── selectBook 단계 함수 존재 ─────────────────────────────
check("_setActiveBook 함수 존재",          authJs.includes("function _setActiveBook"));
check("_clearStorySurface 함수 존재",      authJs.includes("function _clearStorySurface"));
check("_loadEpisodes 함수 존재",           authJs.includes("async function _loadEpisodes"));
check("_renderLatestEpisode 함수 존재",    authJs.includes("function _renderLatestEpisode"));
check("_restoreContextSafely 함수 존재",   authJs.includes("async function _restoreContextSafely"));
check("_restoreCharsSafely 함수 존재",     authJs.includes("async function _restoreCharsSafely"));
check("_updateSidebarsSafely 함수 존재",   authJs.includes("async function _updateSidebarsSafely"));

// ── selectBook 오케스트레이션 ─────────────────────────────
// POST-3 (2026-05-02): 윈도우 길이 의존 정규식([\s\S]{0,N})은 selectBook 본문이 자라며 stale.
// 함수 본문을 정확히 추출 후 includes로 호출 여부 검증 → 의도(orchestration 단계가 selectBook
// 안에서 호출되는가)는 보존하면서 길이 변화에 강건.
const _selectBookMatch = authJs.match(/async function selectBook\b[\s\S]*?(?=\n(?:async\s+)?function\s|\nclass\s|$)/);
const selectBookBody = _selectBookMatch?.[0] ?? "";
check("selectBook 함수 추출 성공", selectBookBody.length > 0);
check("selectBook: _setActiveBook 호출",
  selectBookBody.includes("_setActiveBook"));
check("selectBook: _clearStorySurface 호출",
  selectBookBody.includes("_clearStorySurface"));
check("selectBook: _loadEpisodes 호출",
  selectBookBody.includes("_loadEpisodes"));
check("selectBook: _renderLatestEpisode 호출",
  selectBookBody.includes("_renderLatestEpisode"));
check("selectBook: _restoreContextSafely 호출",
  selectBookBody.includes("_restoreContextSafely"));
check("selectBook: [selectBook] debug 로그",
  authJs.includes('[selectBook] start'));

// ── book list ↔ story content 분리 ────────────────────────
check("toggleBookList: episodeCache 변경 없음",
  !authJs.match(/async function toggleBookList[\s\S]{0,800}episodeCache/));
check("toggleBookList: output 변경 없음",
  !authJs.match(/async function toggleBookList[\s\S]{0,800}output\.innerHTML/));
check("toggleBookList: currentEpisode 변경 없음",
  !authJs.match(/async function toggleBookList[\s\S]{0,800}currentEpisode\s*=/));
check("renderBookList: episode/output/context 함수 미호출",
  !authJs.match(/function renderBookList[\s\S]{0,1000}restoreContextUI/)
  && !authJs.match(/function renderBookList[\s\S]{0,1000}renderProgressive/));

// ── _clearStorySurface: bookList 영역 건드리지 않음 ────────
check("_clearStorySurface: bookListToggle 건드리지 않음",
  !authJs.match(/function _clearStorySurface[\s\S]{0,500}bookListToggle/));
check("_clearStorySurface: bookList\.innerHTML 건드리지 않음",
  !authJs.match(/function _clearStorySurface[\s\S]{0,500}bookList\.innerHTML/));
check("_clearStorySurface: bookListWrap 건드리지 않음",
  !authJs.match(/function _clearStorySurface[\s\S]{0,500}bookListWrap/));

// ── renderLatestEpisode: content fallback ─────────────────
check("_renderLatestEpisode: renderProgressive 호출",
  authJs.match(/function _renderLatestEpisode[\s\S]{0,2000}renderProgressive/));
check("_renderLatestEpisode: empty output fallback (outEl.textContent)",
  authJs.match(/function _renderLatestEpisode[\s\S]{0,3500}outEl\.textContent\s*=\s*content/));
check("_renderLatestEpisode: episodes 없으면 empty state 표시",
  authJs.match(/function _renderLatestEpisode[\s\S]{0,700}empty-state/));

// ── _loadEpisodes: 실패 시 [] 반환 ──────────────────────────
check("_loadEpisodes: 실패 시 [] 반환",
  authJs.match(/function _loadEpisodes[\s\S]{0,500}return\s*\[\]/));
check("_loadEpisodes: 에러 로그",
  authJs.includes('[selectBook] failed at episodes load'));

// ── context/char/sidebar 실패 격리 ─────────────────────────
check("_restoreContextSafely: try-catch 보호",
  authJs.match(/function _restoreContextSafely[\s\S]{0,600}catch/));
check("_updateSidebarsSafely: try-catch 보호",
  authJs.match(/function _updateSidebarsSafely[\s\S]{0,300}catch/));

// ── trace / assert ────────────────────────────────────────
check("_traceOutput 함수 존재",            authJs.includes("function _traceOutput"));
check("_assertEpisodeRendered 함수 존재",  authJs.includes("function _assertEpisodeRendered"));
check("_renderLatestEpisode: _assertEpisodeRendered 호출",
  authJs.match(/function _renderLatestEpisode[\s\S]{0,2200}_assertEpisodeRendered/));
check("_renderLatestEpisode: updateEpisodeUI 호출",
  authJs.match(/function _renderLatestEpisode[\s\S]{0,1400}updateEpisodeUI/));
check("selectBook: updateEpisodeUI 최종 무조건 호출",
  selectBookBody.includes("updateEpisodeUI"));
check("_clearStorySurface: bookList 건드리지 않음 (outEl 로컬 참조)",
  authJs.match(/function _clearStorySurface[\s\S]{0,400}getElementById.*"output"/));

// ── __fsDiag 전역 노출 ────────────────────────────────────
check("window.__fsDiag 존재",              authJs.includes("window.__fsDiag"));
check("__fsDiag: episodeCacheKeys 포함",   authJs.includes("episodeCacheKeys"));
check("__fsDiag: outputTextLen 포함",      authJs.includes("outputTextLen"));
check("__fsDiag: latestEpisode 포함",      authJs.includes("latestEpisode"));
check("__fsDiag: generateButtonText 포함", authJs.includes("generateButtonText"));
check("__fsDiag: episodeListText 포함",    authJs.includes("episodeListText"));

// ── auth.js 버전 v=12 이상 ─────────────────────────────────
const verMatch = indexHtml.match(/auth\.js\?v=(\d+)/);
const ver = verMatch ? parseInt(verMatch[1]) : 0;
check("auth.js 버전 v=12 이상",            ver >= 12);

console.log(`\n${"─".repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
