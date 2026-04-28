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

// ─── _qlabel (expanded) ──────────────────────────────────────────────────────
console.log('\n[A] Item quality badge (_qlabel)');

function _qlabel(n) {
  const t = n.toLowerCase();
  if (/폭탄|수류탄|지뢰|독가스|방사|폭발물|화염/.test(t)) return 'danger';
  if (/권총|소총|기관총|산탄총|저격|리볼버|피스톨|총기|도검|칼날|단검|장검|검|창|활|석궁|무기|병기|총|채찍|도끼|나이프/.test(t)) return 'weapon';
  if (/방패|갑옷|갑주|방탄|헬멧|투구|흉갑|보호복|방어/.test(t)) return 'shield';
  if (/주사기|의약|약품|약제|붕대|치료|치유|해독|진통|수혈|백신|혈청|농축액|수액|포션|엘릭서|의료|영양제|억제/.test(t)) return 'medical';
  if (/데이터|메모리|큐브|슬롯|칩|코드|디스크|파일|정보|수첩|서류|지도|사전|기록|문서|책|태블릿/.test(t)) return 'info';
  if (/장비|기기|장치|기계|전자|통신|송신|수신|센서|드론|로봇|컴퓨터|단말|스캐너|배양기|정화기|필터|마스크/.test(t)) return 'gear';
  if (/도구|공구|렌치|망치|드라이버|열쇠|자물쇠|가방|배낭|상자|음차|진동|로프|줄|채집/.test(t)) return 'tool';
  if (/고급|특제|개조|군용|정밀|희귀|커스텀|첨단|특수/.test(t)) return 'high';
  if (/파손|손상|고장|불량|망가|반파|부서/.test(t)) return 'broken';
  if (/낡은|낡아|오래된|아날로그|노후|녹슨|구식/.test(t)) return 'worn';
  if (/범용|표준|기본|일반|휴대용/.test(t)) return 'normal';
  return null;
}

const itemTests = [
  // 기존 케이스
  ['메모리 큐브 슬롯',          'info'],
  ['정전기 유도 소형 폭탄',      'danger'],
  ["리볼버 '저스터스'",          'weapon'],
  ['범용 데이터 책',             'info'],
  ['아날로그 수첩',              'info'],
  ['파손된 무전기',              'broken'],
  ['휴대용 송신기',              'gear'],
  ['고급 권총',                 'weapon'],
  ['전술 단검',                 'weapon'],
  ['아날로그 시계',              'worn'],
  ['전술 배낭',                 'tool'],
  ['기억 칩',                   'info'],
  // 녹색침묵(TEST) 실제 DB 아이템 — 비이세계
  ['가시 덩굴 채찍',             'weapon'],  // 채찍 → weapon
  ['억제용 영양제 주사기',        'medical'], // 영양제+주사기 → medical
  ['거대 나무 방패',             'shield'],  // 방패 → shield
  ['진동 음차',                  'tool'],    // 음차+진동 → tool
  ['방충용 수액 농축액',          'medical'], // 농축액+수액 → medical
  ['흑연 단검',                  'weapon'],  // 단검 → weapon
  ['휴대용 배양기',              'gear'],    // 배양기 → gear
  ['구시대의 태블릿(태양광 충전식)', 'info'], // 태블릿 → info
  ['정화용 마스크 리브리더',      'gear'],   // 마스크 → gear
];
for (const [name, expKey] of itemTests) {
  ok(`"${name}" → ${expKey}`, _qlabel(name) === expKey);
}

// ─── A2. 장르별 badge 체계 ──────────────────────────────────────────────────
console.log('\n[A2] Genre-aware grade badge');

const FANTASY_GENRES = /판타지|이세계|무협|헌터|게임|마법|던전|신화|RPG|다크/i;
const isFantasy = (genres) => genres.some(v => FANTASY_GENRES.test(v));

ok('비이세계(바이오펑크): isFantasy=false', !isFantasy(['바이오펑크', '호러', '액션', '서바이벌 미스터리']));
ok('이세계: isFantasy=true',                isFantasy(['이세계', '액션']));
ok('판타지: isFantasy=true',               isFantasy(['판타지', '로맨스']));
ok('무협: isFantasy=true',                 isFantasy(['무협']));
ok('SF 스릴러: isFantasy=false',           !isFantasy(['SF', '스릴러', '미스터리']));
ok('다크 판타지: isFantasy=true',          isFantasy(['다크 판타지']));

// 비이세계에서 grade "A" → _qlabel로 폴백 (흑연 단검)
const gradeHtmlNonFan = (name, grade, genres) => {
  const fantasy = isFantasy(genres);
  if (fantasy && grade) return `GRADE:${grade}`;
  const q = _qlabel(name);
  return q ? `QLABEL:${q}` : 'NONE';
};
ok('비이세계 grade A 흑연 단검 → QLABEL:weapon', gradeHtmlNonFan('흑연 단검', 'A', ['바이오펑크']) === 'QLABEL:weapon');
ok('이세계 grade A 흑연 단검 → GRADE:A',         gradeHtmlNonFan('흑연 단검', 'A', ['이세계', '판타지']) === 'GRADE:A');
ok('비이세계 grade null 채찍 → QLABEL:weapon',   gradeHtmlNonFan('가시 덩굴 채찍', null, ['바이오펑크']) === 'QLABEL:weapon');

// ─── A3. 아이템 이름 파싱 ──────────────────────────────────────────────────
console.log('\n[A3] Item name / description parse');

function parseItemName(rawName) {
  const m = rawName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return { displayName: rawName, inferredDesc: null };
  const inside = m[2];
  if (/^[SABCD]$|^[SABCD][급등]\b/.test(inside.trim())) return { displayName: rawName, inferredDesc: null };
  if (/있음|됨|있는|된|숨겨|보관|파손|고장|작동|꺼|켜|잠|열|닫/.test(inside)) {
    return { displayName: m[1].trim(), inferredDesc: inside.trim() };
  }
  return { displayName: rawName, inferredDesc: null };
}

{
  const r1 = parseItemName("리볼버 '저스터스' (수첩 아래 숨겨져 있음)");
  ok("리볼버(수첩 아래 숨겨져 있음) → split", r1.displayName === "리볼버 '저스터스'" && r1.inferredDesc === '수첩 아래 숨겨져 있음');
  const r2 = parseItemName('마검(S)');
  ok('마검(S) → no split (grade)', r2.displayName === '마검(S)' && r2.inferredDesc === null);
  const r3 = parseItemName('구시대의 태블릿(태양광 충전식)');
  ok('태블릿(태양광 충전식) → no split (spec)', r3.displayName === '구시대의 태블릿(태양광 충전식)' && r3.inferredDesc === null);
  const r4 = parseItemName('단검(파손됨)');
  ok('단검(파손됨) → split', r4.displayName === '단검' && r4.inferredDesc === '파손됨');
}

// ─── B/C. Episode role ───────────────────────────────────────────────────────
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
  [1, 30, 'intro'],  // 녹색침묵 실제: ep=1, resolved=30 → intro
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

// ─── B/C. Debug fixture ──────────────────────────────────────────────────────
console.log('\n[B/C] Debug fixture: totalEpisodes=30 book + stale audit mid');

// 녹색침묵 실제 DB 데이터 기반 fixture
const gcFixture = { totalEpisodes: 30, totalEpisodesVar: 5, pov: '3인칭 관찰자' };
const auditFixture = {
  status: 'done',
  episode_role: 'intro',      // fresh calc: ep=1, rf=30 → intro
  episode_number: 1,
  resolved_final_episode: 30,
  remaining_episodes: 29,
  gen_config: gcFixture,
};
const metaFixture = {
  episode_role: 'intro',
  episode_number: 1,
  resolved_final_episode: 30,
  remaining_episodes: 29,
  gen_config: gcFixture,
};

function resolveDebugFields(meta, a) {
  const gc = a?.gen_config ?? meta?.gen_config;
  const epRole = a?.episode_role ?? meta?.episode_role ?? null;
  const resolvedFinal = a?.resolved_final_episode ?? meta?.resolved_final_episode ?? gc?.totalEpisodes ?? null;
  const curEp = a?.episode_number ?? meta?.episode_number ?? null;
  const remaining = a?.remaining_episodes ?? meta?.remaining_episodes ?? (curEp && resolvedFinal ? resolvedFinal - curEp : null);
  const settingRange = gc?.totalEpisodes != null
    ? (gc.totalEpisodesVar ? `${gc.totalEpisodes} ± ${gc.totalEpisodesVar}화` : `${gc.totalEpisodes}화`)
    : null;
  return { epRole, resolvedFinal, curEp, remaining, settingRange };
}

const f1 = resolveDebugFields(metaFixture, auditFixture);
ok('녹색침묵 1화: role=intro',           f1.epRole === 'intro');
ok('녹색침묵 1화: resolvedFinal=30',     f1.resolvedFinal === 30);
ok('녹색침묵 1화: remaining=29',         f1.remaining === 29);
ok('녹색침묵 1화: 설정범위 30 ± 5화',    f1.settingRange === '30 ± 5화');

// stale audit (mid stored) — fresh overrides
const staleAudit = { status:'done', episode_role:'mid', episode_number:null, resolved_final_episode:null, gen_config:gcFixture };
const f2 = resolveDebugFields({}, staleAudit);
ok('Stale audit(mid,ep null): resolvedFinal via totalEpisodes=30', f2.resolvedFinal === 30);

// ─── D. Settings button ──────────────────────────────────────────────────────
console.log('\n[D] Settings button viewer/edit mode');
function settingsBtnHtml(isLocked) {
  return isLocked
    ? `세계관 설정 <span class="badge viewer">뷰어모드</span>`
    : `세계관 설정 <span class="badge">편집모드</span>`;
}
ok('1화=편집모드',  settingsBtnHtml(false).includes('편집모드'));
ok('2화+=뷰어모드', settingsBtnHtml(true).includes('뷰어모드'));
ok('badge.viewer class 존재', settingsBtnHtml(true).includes('badge viewer'));

// ─── E. Dialogue stats warning ───────────────────────────────────────────────
console.log('\n[E] Dialogue stats warning');
const tagWarn = (hasQuotes, segments, tagged, splits) => hasQuotes && (segments + tagged + splits) === 0;
ok('No warn when segments>0', !tagWarn(true, 3, 0, 0));
ok('No warn when splits>0',   !tagWarn(true, 0, 0, 3));
ok('Warn when all=0',          tagWarn(true, 0, 0, 0));
ok('No warn when tagged>0',   !tagWarn(true, 0, 5, 0));

// ─── F. Dialogue split simulation (inline span) ──────────────────────────────
console.log('\n[F] Dialogue span tokenizer (inline simulation)');

function simulateDialogueSpan(inputText) {
  const DIAL_PAIRS = [['“', '”'], ['「', '」'], ['『', '』'], ['"', '"']];
  const DIAL_START = /^[“「『"]/;

  // 단일 단락 시뮬레이션
  const text = inputText;
  const matches = [];
  for (const [open, close] of DIAL_PAIRS) {
    const re = new RegExp(open.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '([\\s\\S]{1,600}?)' + close.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'g');
    let m; while ((m = re.exec(text)) !== null) matches.push({ index:m.index, end:m.index+m[0].length, text:m[0] });
  }
  matches.sort((a,b)=>a.index-b.index);
  const deduped=[]; let lastEnd=-1;
  for (const h of matches) { if (h.index>=lastEnd){deduped.push(h);lastEnd=h.end;} }

  let dialogueSpans = 0, splits = 0;
  let resultHtml = '';

  if (deduped.length) {
    const dialLen = deduped.reduce((s,h)=>s+h.text.length,0);
    if (dialLen >= text.length * 0.20) {
      const parts=[]; let lastIdx=0;
      for (const h of deduped) {
        const before=text.slice(lastIdx,h.index).trim();
        if (before) parts.push({type:'narr',text:before});
        parts.push({type:'dial',text:h.text.trim()});
        lastIdx=h.end;
      }
      const after=text.slice(lastIdx).trim();
      if (after) parts.push({type:'narr',text:after});
      if (parts.length >= 2) {
        resultHtml = parts.map(pt => pt.type==='dial'
          ? `<span class="dialogue-span">${pt.text}</span>`
          : pt.text
        ).join('');
        dialogueSpans = parts.filter(pt=>pt.type==='dial').length;
        splits = 1;
      }
    }
  }

  // DIAL_START fallback
  if (!dialogueSpans && DIAL_START.test(text.trimStart())) {
    resultHtml = `<span class="dialogue-span">${text}</span>`;
    dialogueSpans = 1;
  }

  const hasSpan = resultHtml.includes('dialogue-span');
  const narrationInSpan = hasSpan ? (() => {
    // 확인: dialogue-span 바깥에 지문이 남아있는지
    const outside = resultHtml.replace(/<span class="dialogue-span">[^<]*<\/span>/g, '').trim();
    return outside.length > 0;
  })() : false;
  return { dialogueSpans, splits, hasSpan, narrationInSpan, resultHtml };
}

const dlTests = [
  // 인라인 혼합 케이스
  ['“젠장.” 렌은 짧게 내뱉었다.', 1, true, true],
  // 순수 대사 케이스 (DIAL_START)
  ['“나는 갈 것이다.”', 1, true, false],
  // 지문만
  ['렌은 조용히 고개를 끄덕였다.', 0, false, false],
  // 긴 대사 혼합
  ['“당신이 사용하는 총기는 위험합니다. 곧 만날 사람에게 답이 있습니다.” 이브의 목소리는 짧게 끊기고 사라졌다.', 1, true, true],
];

for (const [text, expSpans, expHasSpan, expNarrOutside] of dlTests) {
  const { dialogueSpans, hasSpan, narrationInSpan } = simulateDialogueSpan(text);
  ok(`"${text.slice(0,28)}..." spans=${dialogueSpans}(${expSpans}), hasSpan=${hasSpan}`,
     dialogueSpans === expSpans && hasSpan === expHasSpan);
  if (expNarrOutside) {
    ok(`  → narration outside span`, narrationInSpan);
  }
}

// ─── G. resolved_final_episode 랜덤 확정 로직 ───────────────────────────────
console.log('\n[G] resolved_final_episode fixture');

function sampleResolvedFinal(totalEpisodes, totalEpisodesVar, existingRf) {
  // context.ts POST 핸들러와 동일한 로직
  if (existingRf != null) return existingRf;
  const variance = totalEpisodesVar ?? 0;
  const delta = variance > 0 ? Math.round((Math.random() * 2 - 1) * variance) : 0;
  return totalEpisodes + delta;
}

{
  // var=0 → 중앙값 고정
  ok('var=0: resolved_final === totalEpisodes', sampleResolvedFinal(30, 0, null) === 30);

  // 이미 resolved 값 존재 → 유지 (100회 반복해도 동일)
  let preserved = true;
  for (let i = 0; i < 100; i++) {
    if (sampleResolvedFinal(30, 5, 48) !== 48) { preserved = false; break; }
  }
  ok('existing resolved_final → preserved across 100 calls', preserved);

  // 50±5 → 45~55 범위 (1000 샘플)
  let inRange50 = true;
  for (let i = 0; i < 1000; i++) {
    const r = sampleResolvedFinal(50, 5, null);
    if (r < 45 || r > 55) { inRange50 = false; break; }
  }
  ok('50±5: 1000 samples all in [45,55]', inRange50);

  // 30±5 → 25~35 범위 (1000 샘플)
  let inRange30 = true;
  for (let i = 0; i < 1000; i++) {
    const r = sampleResolvedFinal(30, 5, null);
    if (r < 25 || r > 35) { inRange30 = false; break; }
  }
  ok('30±5: 1000 samples all in [25,35]', inRange30);

  // 분포 확인 (±5 범위에서 다양성 있는지)
  const samples = new Set();
  for (let i = 0; i < 200; i++) samples.add(sampleResolvedFinal(50, 5, null));
  ok('50±5: 200 samples produce ≥3 distinct values (not fixed)', samples.size >= 3);

  // episode=1, resolved=48 → remaining=47
  const rf = sampleResolvedFinal(50, 5, 48);
  ok('episode=1, resolved=48 → remaining=47', rf - 1 === 47);
}

// ─── H. 소지품 괄호 파싱 (parseItemEntry 동일 로직) ──────────────────────
console.log('\n[H] Item bracket parsing');

function parseItemEntry(raw) {
  const obj = typeof raw === 'string' ? { name: raw } : { ...raw };
  const fullName = obj.name ?? '';
  if (obj.condition != null || obj.description != null || obj.hidden_note != null) return obj;
  const m = fullName.match(/^(.+?)\((.+)\)\s*$/);
  if (!m) return obj;
  const baseName = m[1].trim();
  const bracket  = m[2].trim();
  if (/^[SABCD]$/.test(bracket) || /^[SABCD]급$/.test(bracket)) {
    return { ...obj, name: baseName, grade: bracket.replace('급', '') };
  }
  if (/파손|고장|손상|녹슨|낡은|반파|망가|부서/.test(bracket)) {
    return { ...obj, name: baseName, condition: bracket };
  }
  if (/숨겨|있음|위치|넣어|보관|숨긴|안에|속에|밑에|아래/.test(bracket)) {
    return { ...obj, name: baseName, hidden_note: bracket };
  }
  return { ...obj, name: baseName, description: bracket };
}

{
  const t1 = parseItemEntry('구시대의 태블릿(태양광 충전식)');
  ok('태블릿(태양광 충전식) → name분리, description=태양광 충전식', t1.name === '구시대의 태블릿' && t1.description === '태양광 충전식');

  const t2 = parseItemEntry('방독면(파손)');
  ok('방독면(파손) → name=방독면, condition=파손', t2.name === '방독면' && t2.condition === '파손');

  const t3 = parseItemEntry('통신기(고장)');
  ok('통신기(고장) → condition=고장', t3.name === '통신기' && t3.condition === '고장');

  const t4 = parseItemEntry("리볼버 '저스터스'(수첩 아래 숨겨져 있음)");
  ok("리볼버(수첩 아래 숨겨져 있음) → hidden_note", t4.hidden_note === '수첩 아래 숨겨져 있음');

  const t5 = parseItemEntry('마검(S)');
  ok('마검(S) → grade=S, name=마검', t5.name === '마검' && t5.grade === 'S');

  const t6 = parseItemEntry('검(S급)');
  ok('검(S급) → grade=S', t6.name === '검' && t6.grade === 'S');

  const t7 = parseItemEntry('메모리 큐브 슬롯');
  ok('메모리 큐브 슬롯 → no bracket, name unchanged', t7.name === '메모리 큐브 슬롯' && !t7.description);

  const t8 = parseItemEntry({ name: '정전기 유도 소형 폭탄' });
  ok('object input: name unchanged', t8.name === '정전기 유도 소형 폭탄');

  // 이미 구조화된 경우 덮어쓰기 금지
  const t9 = parseItemEntry({ name: '마검(S)', description: '사용자가 직접 입력한 설명' });
  ok('already structured → not overwritten', t9.description === '사용자가 직접 입력한 설명');
}

// ─── File patch verification ─────────────────────────────────────────────────
console.log('\n[ALL] File patch verification');

const genJs  = readFileSync(join(process.cwd(), 'public/js/generate.js'), 'utf8');
const authJs = readFileSync(join(process.cwd(), 'public/js/auth.js'), 'utf8');
const genTs  = readFileSync(join(process.cwd(), 'src/api/generate.ts'), 'utf8');
const layoutCss  = readFileSync(join(process.cwd(), 'public/css/layout.css'), 'utf8');
const compCss    = readFileSync(join(process.cwd(), 'public/css/components.css'), 'utf8');

// A: expanded _qlabel
ok('generate.js: 채찍 in weapon regex',     genJs.includes('채찍'));
ok('generate.js: 방패 in shield regex',     genJs.includes('방패'));
ok('generate.js: 영양제|억제 in medical',  genJs.includes('영양제|억제'));
ok('generate.js: 배양기 in gear',          genJs.includes('배양기'));
ok('generate.js: 마스크 in gear',          genJs.includes('마스크'));

// A2: genre-aware
ok('generate.js: FANTASY_GENRES regex',    genJs.includes('FANTASY_GENRES'));
ok('generate.js: isFantasyGenre check',    genJs.includes('isFantasyGenre'));
ok('generate.js: _parseItemName',          genJs.includes('_parseItemName'));

// B/C: meta fallbacks
ok('generate.js: meta?.episode_role fallback',            genJs.includes('meta?.episode_role'));
ok('generate.js: meta?.resolved_final_episode fallback',  genJs.includes('meta?.resolved_final_episode'));
ok('generate.js: 설정 범위 totalEpisodes',                genJs.includes('설정 범위'));
ok('generate.js: totalEpisodesVar',                       genJs.includes('totalEpisodesVar'));

// B/C: audit backend
ok('generate.ts: episode_number in SELECT', /SELECT[^;]+episode_number/.test(genTs.replace(/\n/g,' ')));
ok('generate.ts: row.episode_number in IIFE', genTs.includes('row.episode_number'));

// D: viewer/edit mode
ok('auth.js: _updateSettingsBtnLabel function', authJs.includes('_updateSettingsBtnLabel'));
ok('auth.js: 뷰어모드 text',   authJs.includes('뷰어모드'));
ok('auth.js: 편집모드 text',   authJs.includes('편집모드'));
ok('components.css: badge.viewer', compCss.includes('badge.viewer'));

// F: dialogue span approach
ok('generate.js: dialogue-span in splitDialogueNarration', genJs.includes('dialogue-span'));
ok('generate.js: dialogueSegments counter',               genJs.includes('dialogueSegments'));
ok('generate.js: mergeUnclosedQuotes uses innerHTML',     genJs.includes('p.innerHTML.trimEnd()'));
ok('layout.css: .dialogue-span style',                    layoutCss.includes('.dialogue-span'));
ok('layout.css: mode-aloud .dialogue-span',               layoutCss.includes('mode-aloud #output .dialogue-span'));
ok('layout.css: box-decoration-break',                    layoutCss.includes('box-decoration-break'));

// G: resolved_final_episode in context.ts
const ctxTs = readFileSync(join(process.cwd(), 'src/api/context.ts'), 'utf8');
ok('context.ts: resolved_final_episode generation',       ctxTs.includes('resolved_final_episode'));
ok('context.ts: totalEpisodesVar randomization',          ctxTs.includes('Math.round'));
ok('context.ts: existing rf preservation from Redis',     ctxTs.includes('existingRf'));
ok('context.ts: parseItemEntry exported',                 ctxTs.includes('export function parseItemEntry'));

// H: item bracket parsing in characters.ts
const charsTs = readFileSync(join(process.cwd(), 'src/api/characters.ts'), 'utf8');
ok('characters.ts: imports parseItemEntry',               charsTs.includes('parseItemEntry'));
ok('characters.ts: applies parseItemEntry to items',      charsTs.includes('.map((it: any) => parseItemEntry(it))'));

// G/H: hidden_note in generate.js item render
ok('generate.js: hidden_note in sidebar item render',     genJs.includes('hidden_note'));
ok('generate.js: 위치 label in item body rows',           genJs.includes('위치'));

// G: debug panel shows 확정 최종화
ok('generate.js: 확정 최종화 in debug',  genJs.includes('확정 최종화'));
ok('generate.js: 설정 범위 in debug',    genJs.includes('설정 범위'));

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`Result: ${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) process.exit(1);
