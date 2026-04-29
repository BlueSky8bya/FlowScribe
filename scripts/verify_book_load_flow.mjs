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
check("selectBook: _setActiveBook 호출",
  authJs.match(/async function selectBook[\s\S]{0,200}_setActiveBook/));
check("selectBook: _clearStorySurface 호출",
  authJs.match(/async function selectBook[\s\S]{0,200}_clearStorySurface/));
check("selectBook: _loadEpisodes 호출",
  authJs.match(/async function selectBook[\s\S]{0,300}_loadEpisodes/));
check("selectBook: _renderLatestEpisode 호출",
  authJs.match(/async function selectBook[\s\S]{0,400}_renderLatestEpisode/));
check("selectBook: _restoreContextSafely 호출",
  authJs.match(/async function selectBook[\s\S]{0,500}_restoreContextSafely/));
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
  authJs.match(/function _renderLatestEpisode[\s\S]{0,1000}renderProgressive/));
check("_renderLatestEpisode: empty output fallback",
  authJs.match(/function _renderLatestEpisode[\s\S]{0,1200}output\.textContent\s*=\s*content/));
check("_renderLatestEpisode: episodes 없으면 output 비움",
  authJs.match(/function _renderLatestEpisode[\s\S]{0,300}output\.innerHTML\s*=\s*""/));

// ── _loadEpisodes: 실패 시 [] 반환 ──────────────────────────
check("_loadEpisodes: 실패 시 [] 반환",
  authJs.match(/function _loadEpisodes[\s\S]{0,500}return\s*\[\]/));
check("_loadEpisodes: 에러 로그",
  authJs.includes('[selectBook] failed at episodes load'));

// ── context/char/sidebar 실패 격리 ─────────────────────────
check("_restoreContextSafely: try-catch 보호",
  authJs.match(/function _restoreContextSafely[\s\S]{0,300}catch/));
check("_updateSidebarsSafely: try-catch 보호",
  authJs.match(/function _updateSidebarsSafely[\s\S]{0,300}catch/));

// ── __fsDiag 전역 노출 ────────────────────────────────────
check("window.__fsDiag 존재",              authJs.includes("window.__fsDiag"));
check("__fsDiag: episodeCacheKeys 포함",   authJs.includes("episodeCacheKeys"));
check("__fsDiag: outputTextLen 포함",      authJs.includes("outputTextLen"));
check("__fsDiag: latestEpisode 포함",      authJs.includes("latestEpisode"));

// ── auth.js 버전 v=11 이상 ─────────────────────────────────
const verMatch = indexHtml.match(/auth\.js\?v=(\d+)/);
const ver = verMatch ? parseInt(verMatch[1]) : 0;
check("auth.js 버전 v=11 이상",            ver >= 11);

console.log(`\n${"─".repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
