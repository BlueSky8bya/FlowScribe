// Tests for modal save behavior — POST-1 P3 refresh (stale slice 의존 제거)
import { readFileSync } from 'fs';

const modalJs = readFileSync('public/js/modal.js', 'utf-8');
const charsTs = readFileSync('src/api/characters.ts', 'utf-8');

const results = [];
let pass = 0, fail = 0;
function test(name, condition, detail = '') {
  const ok = !!condition;
  results.push({ name, ok, detail });
  if (ok) pass++; else fail++;
}

// ── helper: 함수 선언부터 본문 끝(brace match)까지 정확히 추출 ──
// brace 카운팅 (문자열·주석 안 brace는 modal.js 평범한 JS 흐름에서 문제 없음).
function extractFunctionBody(src, fnDecl) {
  const idx = src.indexOf(fnDecl);
  if (idx === -1) return '';
  const openIdx = src.indexOf('{', idx);
  if (openIdx === -1) return '';
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(idx, i + 1);
    }
  }
  return src.slice(idx);
}

// ── 함수 본문 미리 추출 ──
const saveBody    = extractFunctionBody(modalJs, 'async function saveContext');
const closeBody   = extractFunctionBody(modalJs, 'function closeModal()');
const openBody    = extractFunctionBody(modalJs, 'function openModal()');
const getCharBody = extractFunctionBody(modalJs, 'function getCharCardName');
// _restoreBtn은 saveContext 내부 inner function — saveBody 안에서 추출.
const restoreBody = extractFunctionBody(saveBody, 'function _restoreBtn');

// ── Test 1: getCharCardName function exists ──
test('getCharCardName function exists', getCharBody.length > 0);

// ── Test 2: getCharCardName has try/catch ──
test('getCharCardName has try/catch', getCharBody.includes('try {'));

// ── Test 3: saveContext has top-level try ──
test('saveContext has try block at top',
  saveBody.includes('try {') &&
  saveBody.indexOf('try {') < saveBody.indexOf('fetch('));

// ── Test 4: typeof guard for bookId ──
test('bookId accessed with typeof guard',
  saveBody.includes('typeof bookId') || saveBody.includes('typeof _bookId'));

// ── Test 5: typeof guard for settingVals ──
test('settingVals accessed with typeof guard',
  saveBody.includes('typeof settingVals') || saveBody.includes('_settingVals'));

// ── Test 6: closeModal called after /api/context fetch ──
// Refresh: 6000자 fixed window 제거. saveContext 함수 본문 전체에서 위치 비교.
{
  const ctxIdx   = saveBody.indexOf('/api/context');
  const closeIdx = saveBody.lastIndexOf('closeModal()');
  test('closeModal called after /api/context fetch',
    ctxIdx > 0 && closeIdx > ctxIdx,
    `ctx=${ctxIdx} close=${closeIdx} bodyLen=${saveBody.length}`);
}

// ── Test 7: No eq-info-item in modal.js (clean check) ──
test('no eq-info-item in modal.js', !modalJs.includes('eq-info-item'));

// ── Test 8: closeModal removes "open" class ──
// Refresh: 500자 slice 제거. closeModal 함수 본문 전체에서 검사.
test('closeModal removes "open" class',
  closeBody.includes('classList.remove("open")') ||
  closeBody.includes("classList.remove('open')"));

// ── Test 9: closeModal handles display:none fallback ──
// Refresh: display:none 처리(또는 removeProperty)도 함수 본문 전체에서 검사.
test('closeModal handles display:none fallback',
  closeBody.includes('style.display = "none"') ||
  closeBody.includes("style.display = 'none'") ||
  closeBody.includes('removeProperty("display")') ||
  closeBody.includes("removeProperty('display')"));

// ── Test 10: openModal removes inline display override ──
test('openModal removes inline display override',
  openBody.includes('removeProperty') || openBody.includes('style.display'));

// ── Test 11: generateAndSaveItemDescriptions NOT awaited before res.json ──
{
  const resJsonIdx        = charsTs.lastIndexOf('res.json(');
  const generateAwaitIdx  = charsTs.lastIndexOf('await generateAndSaveItemDescriptions');
  test('generateAndSaveItemDescriptions is NOT awaited before res.json',
    generateAwaitIdx === -1 || generateAwaitIdx > resJsonIdx,
    `await found at ${generateAwaitIdx}, res.json at ${resJsonIdx}`);
}

// ── Test 12: background job has .catch() or setImmediate ──
test('background job has .catch() handler or setImmediate',
  !charsTs.includes('generateAndSaveItemDescriptions(') ||
  charsTs.includes('.catch(') ||
  charsTs.includes('setImmediate'));

// ── Test 13: saveContext disables save button during save ──
test('saveContext disables save button during save',
  saveBody.includes('saveBtn.disabled = true') ||
  saveBody.includes('disabled = true'));

// ── Test 14: saveContext restores button on failure ──
// Refresh: catch 블록에 disabled=false 직접 문자열만 보지 않고, _restoreBtn() 위임 패턴도
// 의미있게 통과시킴. _restoreBtn 함수 본문에 saveBtn.disabled = false + 버튼 텍스트 복원
// (innerHTML = origText 또는 textContent 복원)이 모두 있어야 위임 패턴 인정.
{
  const catchIdx = saveBody.lastIndexOf('} catch (err)');
  const catchBody = catchIdx >= 0 ? saveBody.slice(catchIdx) : '';
  const directRestore =
    catchBody.includes('disabled = false') ||
    catchBody.includes('disabled=false');
  const helperCalled = /\b_restoreBtn\s*\(\s*\)/.test(catchBody);
  const helperSound =
    restoreBody.length > 0 &&
    /saveBtn\.disabled\s*=\s*false/.test(restoreBody) &&
    (restoreBody.includes('innerHTML = origText') ||
     restoreBody.includes('textContent'));
  test('saveContext restores button on failure',
    directRestore || (helperCalled && helperSound),
    helperCalled
      ? `via _restoreBtn (helperSound=${helperSound}, restoreBodyLen=${restoreBody.length})`
      : `direct=${directRestore}`);
}

// ── Test 15: closeModal sets aria-hidden on close (POST-1 §S17 a11y) ──
test('closeModal sets aria-hidden="true" on close',
  closeBody.includes('setAttribute("aria-hidden", "true")') ||
  closeBody.includes("setAttribute('aria-hidden', 'true')"));

// ── Test 16: closeModal sets inert on close (POST-1 §S17 focus block) ──
test('closeModal sets inert attribute on close',
  closeBody.includes('setAttribute("inert"') ||
  closeBody.includes("setAttribute('inert'"));

results.forEach(r => console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
console.log(`\n${pass}/${pass+fail} PASS`);
if (fail > 0) process.exit(1);
