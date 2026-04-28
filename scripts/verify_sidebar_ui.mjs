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

const authJs  = read("public/js/auth.js");
const indexHtml = read("public/index.html");

// ── DOM 구조 ────────────────────────────────────────────────
check("bookListToggle DOM 존재",         indexHtml.includes('id="bookListToggle"'));
check("bookListToggle 기본 display:none", indexHtml.includes('id="bookListToggle"') &&
  indexHtml.match(/id="bookListToggle"[^>]*style="display:none;"/));
check("bookListWrap DOM 존재",            indexHtml.includes('id="bookListWrap"'));
check("bookList DOM 존재",               indexHtml.includes('id="bookList"'));
check("arcSection DOM 존재",             indexHtml.includes('id="arcSection"'));

// ── 분리 함수 존재 ──────────────────────────────────────────
check("updateBookListToggleVisibility 함수 존재",
  authJs.includes("function updateBookListToggleVisibility"));
check("clearStoryProgressUI 함수 존재",
  authJs.includes("function clearStoryProgressUI"));

// ── updateBookListToggleVisibility 동작 ────────────────────
check("toggle visibility: .book-item 기준",
  authJs.includes(".book-item").length > 1 || authJs.includes('querySelectorAll(".book-item")'));
check("toggle visibility: hasBooks ? 'flex' : 'none'",
  authJs.includes('"flex"') && authJs.includes('"none"') &&
  authJs.includes("updateBookListToggleVisibility"));

// ── clearStoryProgressUI 분리 보장 ─────────────────────────
check("clearStoryProgressUI가 bookListToggle을 숨기지 않음",
  !authJs.match(/function clearStoryProgressUI[\s\S]{0,500}bookListToggle/));
check("clearStoryProgressUI가 bookList를 지우지 않음",
  !authJs.match(/function clearStoryProgressUI[\s\S]{0,500}bookList(?!Wrap|Toggle)/));
check("clearStoryProgressUI가 arcSection을 숨김",
  authJs.match(/function clearStoryProgressUI[\s\S]{0,600}arcSection.*display.*none/));
check("clearStoryProgressUI가 episodeList를 초기화함",
  authJs.match(/function clearStoryProgressUI[\s\S]{0,700}episodeList/));

// ── selectBook이 book list UI를 건드리지 않음 ──────────────
check("selectBook이 clearStoryProgressUI 사용",
  authJs.includes("clearStoryProgressUI()"));
check("selectBook 안에서 bookListToggle.style.display 직접 세팅 없음",
  !authJs.match(/async function selectBook[\s\S]{0,3000}bookListToggle\.style\.display/));

// ── renderBookList가 toggle visibility 업데이트 ────────────
check("renderBookList 끝에 updateBookListToggleVisibility 호출",
  authJs.match(/list\.appendChild\(item\)[\s\S]{0,30}\}\);[\s\S]{0,30}updateBookListToggleVisibility/));

// ── createNewBook 경로 ──────────────────────────────────────
check("createNewBook이 renderBookList 호출",
  authJs.match(/async function createNewBook[\s\S]{0,900}renderBookList/));

// ── _collapseBookList 유지 ──────────────────────────────────
check("_collapseBookList 함수 유지",
  authJs.includes("function _collapseBookList"));
check("selectBook 끝에 _collapseBookList 호출",
  authJs.match(/_collapseBookList\(book\.title\)/));

console.log(`\n${"─".repeat(55)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
