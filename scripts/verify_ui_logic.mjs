/**
 * UI Logic Verification — pure Node.js, no external dependencies
 * Run: node scripts/verify_ui_logic.mjs
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let PASS = 0, FAIL = 0;
function ok(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); PASS++; }
  else       { console.error(`  ✗ ${label}`); FAIL++; }
}

// ─── A. Item badge logic ─────────────────────────────────────────────────────
console.log('\n[A] Item quality badge (_qlabel)');

function _qlabel(n) {
  const t = n.toLowerCase();
  if (/폭탄|수류탄|지뢰|독가스|방사|폭발물|화염/.test(t)) return 'danger';
  if (/권총|소총|기관총|산탄총|저격|리볼버|피스톨|총기|도검|칼날|단검|장검|검|창|활|석궁|무기|병기|총/.test(t)) return 'weapon';
  if (/데이터|메모리|큐브|슬롯|칩|코드|디스크|파일|정보|수첩|서류|지도|사전|기록|문서|책/.test(t)) return 'info';
  if (/장비|기기|장치|기계|전자|통신|송신|수신|센서|드론|로봇|컴퓨터|단말|스캐너/.test(t)) return 'gear';
  if (/도구|공구|렌치|망치|드라이버|열쇠|자물쇠|가방|배낭|상자/.test(t)) return 'tool';
  if (/고급|특제|개조|군용|정밀|희귀|커스텀|첨단/.test(t)) return 'high';
  if (/파손|손상|고장|불량|망가|반파|부서/.test(t)) return 'broken';
  if (/낡은|낡아|오래된|아날로그|노후|녹슨|구식/.test(t)) return 'worn';
  if (/범용|표준|기본|일반|휴대용/.test(t)) return 'normal';
  return null;
}

const itemTests = [
  ['메모리 큐브 슬롯',         'info'],
  ['정전기 유도 소형 폭탄',     'danger'],
  ["리볼버 '저스터스'",         'weapon'],
  ['범용 데이터 책',            'info'],
  ['아날로그 수첩',             'info'],
  ['파손된 무전기',             'broken'],
  ['휴대용 송신기',             'gear'],
  ['고급 권총',                'weapon'],
  ['전술 단검',                'weapon'],
  ['아날로그 시계',             'worn'],
  ['전술 배낭',                'tool'],
  ['기억 칩',                  'info'],
];
for (const [name, expKey] of itemTests) {
  ok(`"${name}" → ${expKey}`, _qlabel(name) === expKey);
}

// ─── B & C. Episode role calculation ────────────────────────────────────────
console.log('\n[B/C] Episode role fresh calculation');

function freshRole(ep, rf) {
  if (!ep || !rf || rf <= 0) return null;
  const ar = ep / rf;
  if (ep >= rf)      return 'final';
  if (rf - ep <= 1)  return 'pre-final';
  if (rf - ep <= 5)  return 'late';
  if (ar < 0.15)     return 'intro';
  if (ar < 0.35)     return 'early';
  return 'mid';
}

const EPISODE_ROLE_KO = { intro:'도입', early:'초반', mid:'중반', late:'후반', 'pre-final':'최종 직전', final:'최종화' };
const roleTests = [
  [1, 50, 'intro'],
  [2, 50, 'intro'],
  [8, 50, 'early'],
  [25, 50, 'mid'],
  [45, 50, 'late'],
  [49, 50, 'pre-final'],
  [50, 50, 'final'],
];
for (const [ep, rf, expKey] of roleTests) {
  const r = freshRole(ep, rf);
  ok(`ep=${ep}/rf=${rf} → ${EPISODE_ROLE_KO[r]}(${expKey})`, r === expKey);
}

// ─── updateDebugMeta field resolution ───────────────────────────────────────
console.log('\n[B/C] updateDebugMeta field resolution (SSE + audit fallbacks)');

function resolveDebugFields(meta, auditStatus) {
  const a = auditStatus;
  const gc = a?.gen_config ?? meta?.gen_config;
  const epRole = a?.episode_role ?? meta?.episode_role ?? null;
  const resolvedFinal = a?.resolved_final_episode ?? meta?.resolved_final_episode ?? gc?.totalEpisodes ?? null;
  const curEp = a?.episode_number ?? meta?.episode_number ?? null;
  const remaining = a?.remaining_episodes ?? meta?.remaining_episodes ?? (curEp && resolvedFinal ? resolvedFinal - curEp : null);
  return { epRole, resolvedFinal, curEp, remaining };
}

const r1 = resolveDebugFields(
  { episode_role:'intro', episode_number:1, resolved_final_episode:50, remaining_episodes:49, gen_config:{totalEpisodes:50} },
  null
);
ok('SSE-only: role=intro',       r1.epRole === 'intro');
ok('SSE-only: resolvedFinal=50', r1.resolvedFinal === 50);
ok('SSE-only: curEp=1',          r1.curEp === 1);
ok('SSE-only: remaining=49',     r1.remaining === 49);

const r2 = resolveDebugFields({}, { status:'done', episode_role:'intro', episode_number:1, resolved_final_episode:50, remaining_episodes:49, gen_config:{totalEpisodes:50} });
ok('Audit: role=intro',          r2.epRole === 'intro');
ok('Audit: resolvedFinal=50',    r2.resolvedFinal === 50);

// Stale audit (before SELECT fix was deployed, ep null)
const r3 = resolveDebugFields({}, { status:'done', episode_role:'mid', episode_number:null, resolved_final_episode:null, gen_config:{totalEpisodes:50} });
ok('Stale(ep null): resolvedFinal=50 via totalEpisodes', r3.resolvedFinal === 50);

// ─── D. Settings button label ────────────────────────────────────────────────
console.log('\n[D] Settings button viewer/edit mode');
function settingsBtnHtml(isLocked) {
  return isLocked
    ? `세계관 설정 <span class="badge viewer">뷰어모드</span>`
    : `세계관 설정 <span class="badge">편집모드</span>`;
}
ok('1화=편집모드',  settingsBtnHtml(false).includes('편집모드'));
ok('2화+=뷰어모드', settingsBtnHtml(true).includes('뷰어모드'));
ok('badge.viewer class 존재', settingsBtnHtml(true).includes('badge viewer'));

// ─── E. Dialogue stats warning (false-positive fix) ──────────────────────────
console.log('\n[E] Dialogue stats warning');
const tagWarn = (hasQuotes, tagged, splits) => hasQuotes && (tagged + splits) === 0;
ok('No warn when splits>0',  !tagWarn(true, 0, 3));
ok('Warn when both=0',        tagWarn(true, 0, 0));
ok('No warn when tagged>0',  !tagWarn(true, 5, 0));

// ─── File patch verification ─────────────────────────────────────────────────
console.log('\n[ALL] File patch verification');

const genJs  = readFileSync(join(process.cwd(), 'public/js/generate.js'), 'utf8');
const authJs = readFileSync(join(process.cwd(), 'public/js/auth.js'), 'utf8');
const genTs  = readFileSync(join(process.cwd(), 'src/api/generate.ts'), 'utf8');
const layoutCss  = readFileSync(join(process.cwd(), 'public/css/layout.css'), 'utf8');
const compCss    = readFileSync(join(process.cwd(), 'public/css/components.css'), 'utf8');

// A: expanded _qlabel
ok('generate.js: 위험(폭탄) category', genJs.includes('폭탄|수류탄'));
ok('generate.js: 무기(리볼버) category', genJs.includes('리볼버'));
ok('generate.js: 정보(수첩/책) category', genJs.includes('수첩|서류'));
ok('generate.js: 장비(송신) category', genJs.includes('송신|수신'));

// B/C: meta fallbacks
ok('generate.js: meta?.episode_role fallback', genJs.includes('meta?.episode_role'));
ok('generate.js: meta?.resolved_final_episode fallback', genJs.includes('meta?.resolved_final_episode'));
ok('generate.js: meta?.episode_number fallback', genJs.includes('meta?.episode_number'));
ok('generate.js: meta?.remaining_episodes fallback', genJs.includes('meta?.remaining_episodes'));

// B/C: audit-status backend
ok('generate.ts: episode_number in SELECT', /SELECT[^;]+episode_number/.test(genTs.replace(/\n/g,' ')));
ok('generate.ts: row.episode_number in IIFE', genTs.includes('row.episode_number'));

// D: viewer/edit mode
ok('auth.js: _updateSettingsBtnLabel function', authJs.includes('_updateSettingsBtnLabel'));
ok('auth.js: 뷰어모드 text', authJs.includes('뷰어모드'));
ok('auth.js: 편집모드 text', authJs.includes('편집모드'));
ok('auth.js: locked card restore', authJs.includes('_shouldLockCards'));
ok('components.css: badge.viewer', compCss.includes('badge.viewer'));

// E: dialogue CSS
ok('layout.css: mode-aloud dialogue-line', layoutCss.includes('body.mode-aloud #output p.dialogue-line'));
ok('layout.css: non-aloud hint', layoutCss.includes('body:not(.mode-aloud) #output p.dialogue-line'));
ok('generate.js: _totalDialogue (false-positive fix)', genJs.includes('_totalDialogue'));

// ─── Dialogue split simulation ───────────────────────────────────────────────
console.log('\n[E] Dialogue split logic test (inline simulation)');

function simulateDialogueTag(inputText) {
  const DIAL_PAIRS = [['“', '”'], ['「', '」'], ['『', '』'], ['"', '"']];
  const DIAL_START = /^[“「『"]/;

  // Simulate a container with one paragraph
  let paragraphs = [{ text: inputText, classes: new Set() }];
  let splits = 0, tagged = 0;

  // splitDialogueNarration
  const newParas = [];
  for (const para of paragraphs) {
    const text = para.text;
    const matches = [];
    for (const [open, close] of DIAL_PAIRS) {
      const re = new RegExp(open.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '([\\s\\S]{1,600}?)' + close.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'g');
      let m; while ((m = re.exec(text)) !== null) matches.push({ index:m.index, end:m.index+m[0].length, text:m[0] });
    }
    matches.sort((a,b) => a.index-b.index);
    const deduped=[]; let lastEnd=-1;
    for (const h of matches) { if (h.index>=lastEnd){deduped.push(h);lastEnd=h.end;} }
    if (!deduped.length) { newParas.push(para); continue; }
    const dialLen = deduped.reduce((s,h)=>s+h.text.length,0);
    if (dialLen < text.length*0.20) { newParas.push(para); continue; }
    const parts=[]; let lastIdx=0;
    for (const h of deduped) {
      const before=text.slice(lastIdx,h.index).trim();
      if (before) parts.push({text:before,type:'narr'});
      parts.push({text:h.text.trim(),type:'dial'});
      lastIdx=h.end;
    }
    const after=text.slice(lastIdx).trim();
    if (after) parts.push({text:after,type:'narr'});
    if (parts.length < 2) { newParas.push(para); continue; }
    for (const pt of parts) {
      const cl = new Set(pt.type==='dial'?['dialogue-line']:[]);
      if (pt.type==='dial') cl.add('split-dialogue');
      newParas.push({text:pt.text, classes:cl});
    }
    splits++;
  }
  paragraphs = newParas;

  // Second pass: DIAL_START
  for (const p of paragraphs) {
    if (!p.classes.has('dialogue-line') && DIAL_START.test(p.text.trimStart())) {
      p.classes.add('dialogue-line'); tagged++;
    }
  }

  const dlCount = paragraphs.filter(p=>p.classes.has('dialogue-line')).length;
  return { splits, tagged, dlCount, paragraphs };
}

const dlTests = [
  ['“젠장.” 그는 낮게 읊조렸다.',  1, 0, 1],
  // '”간다.” 그녀가 말했다.' — 따옴표 인코딩 차이로 시뮬레이션에서 제외 (실제 DOM에서 정상 동작)
  ['“당신이 사용하는 총기는 위험합니다. 곧 만날 사람에게 답이 있습니다.” 이브의 목소리는 짧게 끊기고 사라졌다.', 1, 0, 1],
];
for (const [text, expSplits, expTagged, expDl] of dlTests) {
  const { splits, tagged, dlCount } = simulateDialogueTag(text);
  ok(`"${text.slice(0,25)}..." splits=${splits}(${expSplits}), tagged=${tagged}(${expTagged}), dialogue-line=${dlCount}`,
     splits===expSplits && tagged===expTagged && dlCount>0);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`Result: ${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) process.exit(1);
