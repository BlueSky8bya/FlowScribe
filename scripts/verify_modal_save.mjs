// Tests for modal save behavior
import { readFileSync } from 'fs';

const modalJs = readFileSync('public/js/modal.js', 'utf-8');
const results = [];
let pass = 0, fail = 0;

function test(name, condition, detail = '') {
  const ok = !!condition;
  results.push({ name, ok, detail });
  if (ok) pass++; else fail++;
}

// Test 1: getCharCardName function exists
test('getCharCardName function exists', modalJs.includes('function getCharCardName'));

// Test 2: getCharCardName has try/catch
test('getCharCardName has try/catch',
  modalJs.includes('function getCharCardName') &&
  modalJs.slice(modalJs.indexOf('function getCharCardName'), modalJs.indexOf('function getCharCardName') + 500).includes('try {'));

// Test 3: saveContext has top-level try
const saveIdx = modalJs.indexOf('async function saveContext');
const saveBody = modalJs.slice(saveIdx, saveIdx + 6000);
test('saveContext has try block at top',
  saveBody.includes('try {') &&
  saveBody.indexOf('try {') < saveBody.indexOf('fetch('));

// Test 4: typeof guard for bookId
test('bookId accessed with typeof guard',
  saveBody.includes("typeof bookId") || saveBody.includes("typeof _bookId"));

// Test 5: typeof guard for settingVals
test('settingVals accessed with typeof guard',
  saveBody.includes("typeof settingVals") || saveBody.includes("_settingVals"));

// Test 6: closeModal called after context save, not in catch that returns
const contextFetchIdx = saveBody.indexOf('/api/context');
const closeModalIdx = saveBody.lastIndexOf('closeModal()');
test('closeModal called after /api/context fetch',
  contextFetchIdx > 0 && closeModalIdx > contextFetchIdx);

// Test 7: No eq-info-item in modal.js (already clean check)
test('no eq-info-item in modal.js', !modalJs.includes('eq-info-item'));

// Test 8: closeModal removes open class
const closeModalBody = modalJs.slice(modalJs.indexOf('function closeModal'), modalJs.indexOf('function closeModal') + 500);
test('closeModal removes "open" class', closeModalBody.includes('classList.remove("open")') || closeModalBody.includes("classList.remove('open')"));

// Test 9: closeModal handles computed display
test('closeModal handles display:none fallback',
  closeModalBody.includes('display') || closeModalBody.includes('style'));

// Test 10: openModal removes inline display
const openModalBody = modalJs.slice(modalJs.indexOf('function openModal'), modalJs.indexOf('function openModal') + 500);
test('openModal removes inline display override',
  openModalBody.includes('removeProperty') || openModalBody.includes('style.display'));

// Test 11: generateAndSaveItemDescriptions NOT awaited before res.json
const charsTs = readFileSync('src/api/characters.ts', 'utf-8');
const resJsonIdx = charsTs.lastIndexOf('res.json(');
const generateAwaitIdx = charsTs.lastIndexOf('await generateAndSaveItemDescriptions');
test('generateAndSaveItemDescriptions is NOT awaited before res.json',
  generateAwaitIdx === -1 || generateAwaitIdx > resJsonIdx,
  `await found at ${generateAwaitIdx}, res.json at ${resJsonIdx}`
);

// Test 12: background job has .catch() or setImmediate
test('background job has .catch() handler or setImmediate',
  !charsTs.includes('generateAndSaveItemDescriptions(') ||
  charsTs.includes('.catch(') ||
  charsTs.includes('setImmediate')
);

// Test 13: modal.js shows loading state on save button
test('saveContext disables save button during save',
  saveBody.includes('saveBtn.disabled = true') || saveBody.includes("disabled = true"));

// Test 14: modal.js restores button on failure
// Search the full modal.js for button restoration in the catch block of saveContext
const saveFuncStart = modalJs.indexOf('async function saveContext');
const saveFuncBody = modalJs.slice(saveFuncStart);
const catchIdx = saveFuncBody.lastIndexOf('} catch (err)');
const catchBody = saveFuncBody.slice(catchIdx);
test('saveContext restores button on failure',
  catchBody.includes('disabled = false') || catchBody.includes("disabled=false"));

results.forEach(r => console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
console.log(`\n${pass}/${pass+fail} PASS`);
if (fail > 0) process.exit(1);
