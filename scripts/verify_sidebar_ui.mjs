/**
 * verify_sidebar_ui.mjs
 * 사이드바 book list toggle / story progress clear 분리 검증
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
const layoutCss = read("public/css/layout.css");

// ── DOM 구조 ────────────────────────────────────────────────
check("bookListToggle DOM 존재",           indexHtml.includes('id="bookListToggle"'));
check("bookListToggle inline display:none 없음",
  !indexHtml.match(/id="bookListToggle"[^>]*style="[^"]*display\s*:\s*none/));
check("bookListWrap DOM 존재",             indexHtml.includes('id="bookListWrap"'));
check("bookList DOM 존재",                indexHtml.includes('id="bookList"'));
check("arcSection DOM 존재",              indexHtml.includes('id="arcSection"'));

// ── CSS 기본 표시 ──────────────────────────────────────────
check("CSS .book-list-toggle 기본 display:flex",
  layoutCss.match(/\.book-list-toggle\s*\{[^}]*display\s*:\s*flex/));

// ── auth.js 버전 v=8 이상 ─────────────────────────────────
const authVerMatch = indexHtml.match(/auth\.js\?v=(\d+)/);
const authVer = authVerMatch ? parseInt(authVerMatch[1]) : 0;
check("auth.js 버전 v=9 이상",             authVer >= 9);

// ── showBookListToggle 조건 없음 ───────────────────────────
check("showBookListToggle 함수 존재",      authJs.includes("function showBookListToggle"));
check("showBookListToggle: _allBooks 조건 없음",
  !authJs.match(/function showBookListToggle[\s\S]{0,300}_allBooks/));
check("showBookListToggle: .book-item 개수 조건 없음",
  !authJs.match(/function showBookListToggle[\s\S]{0,300}book-item/));
check("showBookListToggle: style.removeProperty 사용",
  authJs.match(/function showBookListToggle[\s\S]{0,300}removeProperty/));
check("showBookListToggle: toggle.hidden=false",
  authJs.match(/function showBookListToggle[\s\S]{0,300}hidden\s*=\s*false/));

// ── renderBookList fail-safe ───────────────────────────────
check("renderBookList: showBookListToggle 호출",
  authJs.match(/function renderBookList[\s\S]{0,200}showBookListToggle/));
check("renderBookList: 빈 books 처리 (book-list-empty)",
  authJs.includes("book-list-empty"));
check("renderBookList: _SYS_BOOK_RE 필터 없음 (검증용 제거)",
  !authJs.includes("_SYS_BOOK_RE"));

// ── initBooks / createNewBook 경로 ────────────────────────
check("initBooks: renderBookList 후 showBookListToggle 호출",
  authJs.match(/renderBookList\([^)]+\);\s*\n\s*showBookListToggle\(\)/));
check("createNewBook: renderBookList 후 showBookListToggle 호출",
  authJs.match(/async function createNewBook[\s\S]{0,900}showBookListToggle/));

// ── clearStoryProgressUI 분리 ─────────────────────────────
check("clearStoryProgressUI 함수 존재",    authJs.includes("function clearStoryProgressUI"));
check("clearStoryProgressUI: bookListToggle 건드리지 않음",
  !authJs.match(/function clearStoryProgressUI[\s\S]{0,600}bookListToggle/));
check("clearStoryProgressUI: bookList 건드리지 않음",
  !authJs.match(/function clearStoryProgressUI[\s\S]{0,600}\bbookList\b(?!Wrap|Toggle)/));
check("clearStoryProgressUI: arcSection 숨김",
  !!authJs.match(/function clearStoryProgressUI[\s\S]{0,700}arcSection[\s\S]{0,60}none/));
check("clearStoryProgressUI: episodeList 초기화",
  !!authJs.match(/function clearStoryProgressUI[\s\S]{0,800}episodeList/));

// ── selectBook 독립성 ─────────────────────────────────────
check("selectBook: clearStoryProgressUI 사용",
  authJs.includes("clearStoryProgressUI()"));
check("selectBook: bookListToggle.style.display 직접 세팅 안 함",
  !authJs.match(/async function selectBook[\s\S]{0,3500}bookListToggle\.style\.display/));
check("_collapseBookList 함수 유지",       authJs.includes("function _collapseBookList"));
check("selectBook에서 자동 접기 제거됨 (_collapseBookList 미호출)",
  !authJs.match(/async function selectBook[\s\S]{0,600}_collapseBookList\(/));
check("showBookListToggle이 wrap.classList.remove(collapsed) 포함",
  authJs.match(/function showBookListToggle[\s\S]{0,400}wrap\.classList\.remove/));

// ── ensureBookListLoaded / async toggleBookList ───────────
check("ensureBookListLoaded 함수 존재",      authJs.includes("async function ensureBookListLoaded"));
check("toggleBookList: ensureBookListLoaded 호출",
  authJs.match(/async function toggleBookList[\s\S]{0,600}ensureBookListLoaded/));
check("toggleBookList: async 선언",         authJs.includes("async function toggleBookList"));

// ── renderBookList fail-safe ───────────────────────────────
check("renderBookList: book-item 없을 때 경고",
  authJs.includes("book-item rendered"));
check("renderBookList: 표시할 책이 없습니다 fallback",
  authJs.includes("표시할 책이 없습니다"));

// ── 전역 함수 노출 ────────────────────────────────────────
check("window.toggleBookList 노출",         /window\.toggleBookList\s*=\s*toggleBookList/.test(authJs));
check("window.renderBookList 노출",         /window\.renderBookList\s*=\s*renderBookList/.test(authJs));
check("window.ensureBookListLoaded 노출",   /window\.ensureBookListLoaded\s*=\s*ensureBookListLoaded/.test(authJs));
check("window.showBookListToggle 노출",     /window\.showBookListToggle\s*=\s*showBookListToggle/.test(authJs));

// ── auth.js 버전 v=10 이상 ────────────────────────────────
const authVerMatch2 = indexHtml.match(/auth\.js\?v=(\d+)/);
const authVer2 = authVerMatch2 ? parseInt(authVerMatch2[1]) : 0;
check("auth.js 버전 v=10 이상",             authVer2 >= 10);

// ── CSS 열린/접힘 분리 ────────────────────────────────────
check("CSS .book-list-wrap 기본 display:block",
  layoutCss.includes("display:block"));
check("CSS .book-list-wrap.collapsed max-height:0 !important",
  layoutCss.includes("max-height:0 !important"));
check("CSS .book-list-wrap overflow:visible 제거됨",
  !layoutCss.match(/\.book-list-wrap\s*\{[^}]*overflow\s*:\s*visible/));
check("CSS .book-list-wrap.collapsed overflow:hidden 유지",
  layoutCss.includes("overflow:hidden !important"));

// ── 초기 접힘 동작 ────────────────────────────────────────
check("_collapseBookListForced 함수 존재",    authJs.includes("function _collapseBookListForced"));
check("initBooks: _collapseBookListForced 호출",
  authJs.match(/initBooks[\s\S]{0,400}_collapseBookListForced\(\)/));
check("_collapseBookListForced: _bookListManuallyOpen=false 설정",
  authJs.match(/function _collapseBookListForced[\s\S]{0,200}_bookListManuallyOpen\s*=\s*false/));
check("_collapseBookListForced: collapsed class 추가",
  authJs.match(/function _collapseBookListForced[\s\S]{0,200}classList\.add\("collapsed"\)/));
check("_collapseBookListForced: 서재 펼치기 라벨 설정", (() => {
  const idx = authJs.indexOf("function _collapseBookListForced");
  return idx >= 0 && authJs.indexOf("서재 펼치기", idx) < idx + 400;
})());
check("toggleBookList: _bookListManuallyOpen 갱신", (() => {
  const idx = authJs.indexOf("async function toggleBookList");
  return idx >= 0 && authJs.indexOf("_bookListManuallyOpen", idx) < idx + 1200;
})());

console.log(`\n${"─".repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
