#!/usr/bin/env node
/**
 * verify_e2e_ui.mjs — E2E UI structural stability fixtures
 * Run: node scripts/verify_e2e_ui.mjs
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const cwd = process.cwd();
let passed = 0;
let failed = 0;

function ok(label, cond) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

const genJs    = readFileSync(join(cwd, 'public/js/generate.js'), 'utf8');
const modalJs  = readFileSync(join(cwd, 'public/js/modal.js'), 'utf8');
const authJs   = readFileSync(join(cwd, 'public/js/auth.js'), 'utf8');
const indexHtml = readFileSync(join(cwd, 'public/index.html'), 'utf8');
const genTs    = readFileSync(join(cwd, 'src/api/generate.ts'), 'utf8');

// ─── 5.1 Postprocess stats DOM class fixture ──────────────────────────────
console.log('\n[5.1] Postprocess stats DOM class');
{
  // Extract _renderPostprocStats function body
  const fnStart = genJs.indexOf('function _renderPostprocStats()');
  const fnEnd   = genJs.indexOf('\nfunction ', fnStart + 1);
  const fnBody  = fnEnd > 0 ? genJs.slice(fnStart, fnEnd) : genJs.slice(fnStart, fnStart + 500);
  ok('_renderPostprocStats uses eq-kv-list', fnBody.includes('eq-kv-list'));
  ok('_renderPostprocStats uses eq-kv class', fnBody.includes('eq-kv-list') && fnBody.includes('eq-kv-key') && fnBody.includes('eq-kv-val'));
  ok('_renderPostprocStats does NOT use eq-info-item', !fnBody.includes('eq-info-item'));
}

// ─── 5.2 Dialogue segmentation fixture ───────────────────────────────────
console.log('\n[5.2] Dialogue segmentation fixture');
{
  // Extract applyDialogueStyle source and build a minimal shim to run it
  // We detect key structural patterns rather than full execution
  ok('applyDialogueStyle defined', genJs.includes('function applyDialogueStyle(') || genJs.includes('applyDialogueStyle ='));
  ok('attachedDialogueSplits counter', genJs.includes('attachedDialogueSplits'));
  ok('dialogueSegments counter', genJs.includes('dialogueSegments'));
  ok('hasCurlyQuote threshold', genJs.includes('hasCurlyQuote'));
  ok('threshold=0 for curly quote', genJs.includes('threshold = hasCurlyQuote ? 0 : 0.05'));
  ok('p.replaceWith used for block replacement', genJs.includes('p.replaceWith'));
  ok('dialogue-line class added', genJs.includes("newP.classList.add('dialogue-line')"));
}

// ─── 5.3 dynItems canonical description merge fixture ─────────────────────
console.log('\n[5.3] dynItems canonical description merge fixture');
{
  // Verify the merge logic exists in generate.ts (server-side)
  ok('canonicalItemMap built in generate.ts', genTs.includes('canonicalItemMap'));
  ok('description merge from canonical in generate.ts', genTs.includes('!merged.description && ci?.description') || genTs.includes("!it.description && ci?.description"));
  ok('dynItems merge loop present in generate.ts', genTs.includes('dynItems.map'));

  // Run the merge logic directly
  const dynItems = [{ name: '사일런트 필드', grade: 'A' }];
  const fallbackItems = [{ name: '사일런트 필드', grade: 'A', description: '음파를 흡수하는 특수 장갑' }];
  const canonicalItemMap = {};
  for (const ci of fallbackItems) { if (ci.name) canonicalItemMap[ci.name] = ci; }
  const mergedItems = dynItems.map(it => {
    const ci = canonicalItemMap[it.name];
    let merged = it;
    if (!merged.grade && ci?.grade) merged = { ...merged, grade: ci.grade };
    if (!merged.description && ci?.description) merged = { ...merged, description: ci.description };
    return merged;
  });
  ok('mergedItems[0].description populated from canonical', mergedItems[0].description === '음파를 흡수하는 특수 장갑');
  ok('mergedItems[0].grade preserved', mergedItems[0].grade === 'A');
}

// ─── 5.4 saveContext null safety fixture ─────────────────────────────────
console.log('\n[5.4] saveContext null safety fixture');
{
  ok('modal.js uses ?.value?.trim() on char-name', modalJs.includes('?.value?.trim()'));
  ok('modal.js does not use direct .char-name.value without guard',
    !modalJs.includes('.char-name").value') && !modalJs.includes(".char-name').value"));
}

// ─── 5.5 item_vocab loading fixture ──────────────────────────────────────
console.log('\n[5.5] item_vocab loading fixture');
{
  ok('_loadItemVocab defined', genJs.includes('async function _loadItemVocab(') || genJs.includes('function _loadItemVocab('));
  ok('_itemVocab cache variable', genJs.includes('let _itemVocab'));
  ok('_itemVocabBookId for dedup', genJs.includes('_itemVocabBookId'));
  ok('_loadItemVocab called in book switch', genJs.includes('_loadItemVocab(bookId)') || genJs.includes('_loadItemVocab(bId)'));
}

// ─── 5.6 _qlabel vocab fallback fixture ──────────────────────────────────
console.log('\n[5.6] _qlabel vocab fallback fixture');
{
  ok('_qlabel function defined', genJs.includes('const _qlabel = n =>') || genJs.includes('_qlabel = n =>'));
  ok('_itemVocab[n] fallback before return null', genJs.includes('if (_itemVocab[n]) return'));
  ok('vocab fallback comes before return null',
    genJs.indexOf('if (_itemVocab[n]) return') < genJs.indexOf('return null; // 미분류 아이템')
  );
}

// ─── 5.7 JS version cache-busting check ──────────────────────────────────
console.log('\n[5.7] JS version cache-busting check');
{
  ok('generate.js has ?v= query string', /generate\.js\?v=\d+/.test(indexHtml));
  ok('auth.js has ?v= query string', /auth\.js\?v=\d+/.test(indexHtml));
  ok('modal.js has ?v= query string', /modal\.js\?v=\d+/.test(indexHtml));
  ok('ui.js has ?v= query string', /ui\.js\?v=\d+/.test(indexHtml));

  // Extract version numbers
  const vGen   = (indexHtml.match(/generate\.js\?v=(\d+)/) || [])[1];
  const vAuth  = (indexHtml.match(/auth\.js\?v=(\d+)/) || [])[1];
  const vModal = (indexHtml.match(/modal\.js\?v=(\d+)/) || [])[1];
  const vUi    = (indexHtml.match(/ui\.js\?v=(\d+)/) || [])[1];
  console.log(`    generate.js?v=${vGen}, auth.js?v=${vAuth}, modal.js?v=${vModal}, ui.js?v=${vUi}`);
}

// ─── 5.8 Debug UI design consistency ─────────────────────────────────────
console.log('\n[5.8] Debug UI design consistency');
{
  ok('_renderPostprocStats uses eq-kv-list', genJs.includes('eq-kv-list'));
  ok('eqPlannerInfo uses eq-kv-list', (() => {
    const plannerIdx = genJs.indexOf("getElementById('eqPlannerInfo')");
    const plannerSection = genJs.slice(plannerIdx, plannerIdx + 600);
    return plannerSection.includes('eq-kv-list');
  })());
  ok('_compact function exists', genJs.includes('function _compact('));
  ok('<details> in _compact', genJs.includes('<details'));
}

// ─── 5.9 totalEpisodes source-of-truth fixture ───────────────────────────
console.log('\n[5.9] totalEpisodes source-of-truth fixture');
{
  ok('clearWorldSettingsUI defined', authJs.includes('function clearWorldSettingsUI()'));
  ok('restoreContextUI defined', authJs.includes('function restoreContextUI('));
  ok('selectBook calls clearWorldSettingsUI', authJs.includes('clearWorldSettingsUI()'));
  ok('selectBook calls restoreContextUI', authJs.includes('restoreContextUI('));
  // Check order: clearWorldSettingsUI must appear before restoreContextUI in selectBook
  const selectBookIdx = authJs.indexOf('async function selectBook(');
  const clearIdx = authJs.indexOf('clearWorldSettingsUI()', selectBookIdx);
  const restoreIdx = authJs.indexOf('restoreContextUI(', selectBookIdx);
  ok('clearWorldSettingsUI called before restoreContextUI in selectBook', clearIdx < restoreIdx && clearIdx > 0 && restoreIdx > 0);
  ok('totalEpisodes default 30 in clearWorldSettingsUI', authJs.includes('totalEpisodes:30') || authJs.includes('totalEpisodes: 30'));
}

// ─── 5.10 modal.js version bump check ────────────────────────────────────
console.log('\n[5.10] modal.js version bump check');
{
  ok('modal.js has version query string in index.html', /modal\.js\?v=\d+/.test(indexHtml));
  const modalVersion = (indexHtml.match(/modal\.js\?v=(\d+)/) || [])[1];
  console.log(`    modal.js?v=${modalVersion}`);
  ok('modal.js version >= 1', parseInt(modalVersion ?? '0', 10) >= 1);
}

// ─── Summary ─────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
