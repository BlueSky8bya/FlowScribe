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

// ── DOM 구조 ────────────────────────────────────────────────
check("bookListToggle DOM 존재",          indexHtml.includes('id="bookListToggle"'));
check("bookListToggle 기본 display:none", !!indexHtml.match(/id="bookListToggle"[^>]*style="display:none;"/));
check("bookListWrap DOM 존재",            indexHtml.includes('id="bookListWrap"'));
check("bookList DOM 존재",               indexHtml.includes('id="bookList"'));
check("arcSection DOM 존재",             indexHtml.includes('id="arcSection"'));

// ── auth.js 버전 bump ──────────────────────────────────────
const authVerMatch = indexHtml.match(/auth\.js\?v=(\d+)/);
const authVer = authVerMatch ? parseInt(authVerMatch[1]) : 0;
check("auth.js 버전 v=7 이상",           authVer >= 7);

// ── 핵심 함수 존재 ─────────────────────────────────────────
check("showBookListToggle 함수 존재",     authJs.includes("function showBookListToggle"));
check("clearStoryProgressUI 함수 존재",  authJs.includes("function clearStoryProgressUI"));
check("updateBookListToggleVisibility alias 존재",
  authJs.includes("function updateBookListToggleVisibility"));

// ── showBookListToggle 구현 강건성 ─────────────────────────
check("showBookListToggle: _allBooks 기준 포함",  authJs.includes("window._allBooks"));
check("showBookListToggle: toggle.hidden=false",  authJs.includes("toggle.hidden = false"));
check("showBookListToggle: force 파라미터 지원",  authJs.includes("force === true") || authJs.includes("force=true"));
check("showBookListToggle: flex/none 설정",
  authJs.includes('"flex"') && authJs.includes('"none"'));

// ── renderBookList 끝에 showBookListToggle 호출 ────────────
check("renderBookList에서 showBookListToggle 호출",
  authJs.match(/function renderBookList[\s\S]{0,5000}showBookListToggle/));

// ── initBooks에서 renderBookList 직후 showBookListToggle 호출 ─
check("initBooks: renderBookList 후 showBookListToggle 명시 호출",
  authJs.match(/renderBookList\(books.*\);\s*\n\s*showBookListToggle/));

// ── createNewBook에서도 showBookListToggle 호출 ────────────
check("createNewBook: renderBookList 후 showBookListToggle 호출",
  authJs.match(/async function createNewBook[\s\S]{0,900}showBookListToggle/));

// ── clearStoryProgressUI 분리 보장 ─────────────────────────
check("clearStoryProgressUI가 bookListToggle 건드리지 않음",
  !authJs.match(/function clearStoryProgressUI[\s\S]{0,600}bookListToggle/));
check("clearStoryProgressUI가 bookList 건드리지 않음",
  !authJs.match(/function clearStoryProgressUI[\s\S]{0,600}(?<!Wrap|Toggle)\bbookList\b/));
check("clearStoryProgressUI가 arcSection 숨김",
  !!authJs.match(/function clearStoryProgressUI[\s\S]{0,700}arcSection[\s\S]{0,50}none/));
check("clearStoryProgressUI가 episodeList 초기화",
  !!authJs.match(/function clearStoryProgressUI[\s\S]{0,800}episodeList/));

// ── selectBook이 book list UI를 건드리지 않음 ──────────────
check("selectBook이 clearStoryProgressUI 사용",
  authJs.includes("clearStoryProgressUI()"));
check("selectBook이 bookListToggle.style.display 직접 세팅 안 함",
  !authJs.match(/async function selectBook[\s\S]{0,3500}bookListToggle\.style\.display/));

// ── _collapseBookList 유지 ──────────────────────────────────
check("_collapseBookList 함수 유지",
  authJs.includes("function _collapseBookList"));
check("selectBook 끝에 _collapseBookList 호출",
  !!authJs.match(/_collapseBookList\(book\.title\)/));

console.log(`\n${"─".repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
