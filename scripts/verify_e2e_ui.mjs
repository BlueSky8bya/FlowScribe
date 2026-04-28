// scripts/verify_e2e_ui.mjs
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const results = [];

function check(name, condition, detail='') {
  if (condition) { pass++; results.push(`  PASS: ${name}`); }
  else { fail++; results.push(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

const genJs = readFileSync('public/js/generate.js', 'utf-8');
const modalJs = readFileSync('public/js/modal.js', 'utf-8');
const indexHtml = readFileSync('public/index.html', 'utf-8');
const modalCss = readFileSync('public/css/modal.css', 'utf-8');
const compCss = readFileSync('public/css/components.css', 'utf-8');

console.log('\n[GROUP 1] Modal saveContext fixes');
check('optional chaining on .char-name in filter',
  modalJs.includes("querySelector('.char-name')?.value?.trim()") ||
  modalJs.includes('querySelector(".char-name")?.value?.trim()'));
check('closeModal in finally block', (() => {
  const fn = modalJs.match(/async function saveContext\(\)([\s\S]*?)^}/m)?.[1] || '';
  return fn.includes('finally {') && fn.lastIndexOf('closeModal()') > fn.lastIndexOf('finally {');
})());
check('settingsBtn null-guarded', (() => {
  const fn = modalJs.match(/finally\s*\{([\s\S]*?)\}/)?.[1] || '';
  return fn.includes('if (sb)') || fn.includes('if(sb)');
})());
check('modal.js versioned in index.html', indexHtml.match(/modal\.js\?v=\d+/) !== null);
check('bible-footer z-index > overlay z-index', (() => {
  const footerZ = parseInt(modalCss.match(/\.bible-footer\s*\{[^}]+z-index:\s*(\d+)/s)?.[1] || '0');
  const overlayZ = parseInt(modalCss.match(/\.page-loading-overlay\s*\{[^}]+z-index:\s*(\d+)/s)?.[1] || '0');
  return footerZ > overlayZ;
})());
check('page-loading-overlay base has pointer-events:none',
  modalCss.match(/\.page-loading-overlay\s*\{[^}]+pointer-events\s*:\s*none/s) !== null);

console.log('\n[GROUP 2] Item badges and vocab');
check('_loadItemVocab function defined', genJs.includes('async function _loadItemVocab'));
check('_itemVocab global defined', /^let _itemVocab\s*=\s*\{\}/m.test(genJs));
check('_qlabel uses _itemVocab fallback', genJs.includes('_itemVocab[n]'));
check('_loadAndApplyCharStates is async and awaits vocab', (() => {
  const fnMatch = genJs.match(/async function _loadAndApplyCharStates[\s\S]*?^}/m);
  return fnMatch !== null && fnMatch[0].includes('await _loadItemVocab');
})());
check('CAT_COLOR map defined', genJs.includes('CAT_COLOR'));
check('vocab color assigned from CAT_COLOR', genJs.includes('CAT_COLOR[v.category]'));

console.log('\n[GROUP 3] Postprocess stats DOM structure');
// Use line 92 direct search (eq-kv-list IS in the function)
check('_renderPostprocStats uses eq-kv-list', (() => {
  const startIdx = genJs.indexOf('function _renderPostprocStats()');
  const endIdx = genJs.indexOf('\nfunction ', startIdx + 1);
  const fn = genJs.substring(startIdx, endIdx > 0 ? endIdx : startIdx + 2000);
  return fn.includes('eq-kv-list');
})());
check('kv helper uses eq-kv not eq-info-item', (() => {
  const kvIdx = genJs.indexOf('const kv = (k, v, cls)');
  const snippet = genJs.substring(kvIdx, kvIdx + 250);
  return snippet.includes('eq-kv') && !snippet.includes('eq-info-item');
})());
check('no eq-info-item in generate.js', !genJs.includes('eq-info-item'));
check('eq-kv-list CSS defined', compCss.includes('.eq-kv-list'));
check('eq-kv CSS defined', compCss.includes('.eq-kv{') || compCss.includes('.eq-kv '));
check('eq-kv ok/warn/bad defined', compCss.includes('.eq-kv-val.ok'));

console.log('\n[GROUP 4] Cache busting');
const genVer = indexHtml.match(/generate\.js\?v=(\d+)/)?.[1];
const modalVer = indexHtml.match(/modal\.js\?v=(\d+)/)?.[1];
check('generate.js versioned', !!genVer, `v=${genVer}`);
check('modal.js versioned', !!modalVer, `v=${modalVer}`);

console.log('\n' + '='.repeat(50));
results.forEach(r => console.log(r));
console.log('='.repeat(50));
console.log(`\nTotal: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) { process.exit(1); }
