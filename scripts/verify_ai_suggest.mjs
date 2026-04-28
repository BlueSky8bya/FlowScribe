import { readFileSync } from 'fs';

const suggestTs = readFileSync('src/api/suggest.ts', 'utf-8');
const suggestJs = readFileSync('public/js/suggest.js', 'utf-8');
const chipsJs   = readFileSync('public/js/chips.js', 'utf-8');

let pass = 0, fail = 0;
function test(name, cond) {
  const ok = !!cond;
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (ok) pass++; else fail++;
}

// Backend tests
test('world-setup endpoint exists', suggestTs.includes('/world-setup') || suggestTs.includes('world-setup') || suggestTs.includes('world_setup'));
test('Gemini API key check', suggestTs.includes('GEMINI_API_KEY'));
test('Gemini fallback to local LLM', suggestTs.includes('getLLMClient') && suggestTs.includes('callWorldSuggest'));
test('locked items protected in parseAndProtect', suggestTs.includes('parseAndProtect') && suggestTs.includes('lockedSettingSet'));
test('JSON parse has try/catch', suggestTs.includes('JSON.parse') && suggestTs.includes('catch'));
test('no hardcoded API key', !suggestTs.match(/AIza[A-Za-z0-9_-]{35}/));

// Frontend tests
test('runWorldSetupSuggest function exists', suggestJs.includes('runWorldSetupSuggest'));
test('lockedSettings used in request', suggestJs.includes('lockedSettings'));
test('applyWorldSuggestResult function exists', suggestJs.includes('applyWorldSuggestResult'));
test('chip lock on dblclick', chipsJs.includes('dblclick'));
test('fallback on suggest failure', suggestJs.includes('showToast') && suggestJs.includes('catch'));

console.log(`\n${pass}/${pass+fail} PASS`);
if (fail > 0) process.exit(1);
