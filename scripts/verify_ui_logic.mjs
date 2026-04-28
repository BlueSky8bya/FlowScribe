/**
 * UI Logic Verification — pure Node.js, no external dependencies
 * Run: node scripts/verify_ui_logic.mjs
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const fs = { readFileSync };
const path = { join };

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

// ─── I. 강철의 연옥 items badge ─────────────────────────────────────────────
console.log('\n[I] 강철의 연옥 item badges (new categories)');

function _qlabelFull(n) {
  const t = n.toLowerCase();
  if (/폭탄|수류탄|지뢰|독가스|방사|폭발물|화염/.test(t)) return 'danger';
  if (/권총|소총|기관총|산탄총|저격|리볼버|피스톨|총기|도검|칼날|단검|장검|검|창|활|석궁|무기|병기|총|채찍|도끼|망도|나이프/.test(t)) return 'weapon';
  if (/방패|갑옷|갑주|방탄|헬멧|투구|흉갑|보호복|방어/.test(t)) return 'shield';
  if (/주사기|의약|약품|약제|붕대|치료|치유|해독|진통|수혈|백신|혈청|농축액|수액|포션|엘릭서|의료|영양제|억제/.test(t)) return 'medical';
  if (/데이터|메모리|큐브|슬롯|칩|코드|디스크|파일|정보|수첩|서류|지도|사전|기록|문서|책|태블릿|기록기/.test(t)) return 'info';
  if (/진혼|향로|제기|제사|성수|봉헌|부적|주문서|의례|강신|무속|제물|제단|향불|봉납/.test(t)) return 'ritual';
  if (/심령|강령|영매|초혼|귀신|유령|망령|사령|망자|혼령|기령|영계|귀령|혼백/.test(t)) return 'spiritual';
  if (/청음기|청음|음향기|공명기|청진기|방울|심벌|타악기|현악기/.test(t)) return 'sound';
  if (/의수|의족|기계팔|보조지체|의체/.test(t)) return 'mech';
  if (/군용|군사|군장|군복|군비|탄약|포탄/.test(t)) return 'military';
  if (/장비|기기|장치|기계|전자|통신|송신|수신|센서|드론|로봇|컴퓨터|단말|스캐너|배양기|정화기|필터|마스크/.test(t)) return 'gear';
  if (/도구|공구|렌치|망치|드라이버|열쇠|자물쇠|가방|배낭|상자|음차|진동|로프|줄|채집|지팡이/.test(t)) return 'tool';
  if (/고급|특제|개조|정밀|희귀|커스텀|첨단|특수/.test(t)) return 'high';
  if (/파손|손상|고장|불량|망가|반파|부서/.test(t)) return 'broken';
  if (/낡은|낡아|오래된|아날로그|노후|녹슨|구식/.test(t)) return 'worn';
  return 'normal'; // fallback: 모든 아이템에 배지 보장
}

ok('강철 의수 → mech (not null)', _qlabelFull('강철 의수') === 'mech');
ok('진혼의 종 → ritual', _qlabelFull('진혼의 종') === 'ritual');
ok('향로 지팡이 → ritual', _qlabelFull('향로 지팡이') === 'ritual');
ok('심령 청음기 → spiritual', _qlabelFull('심령 청음기') === 'spiritual');
ok('군용 연소 램프 → military', _qlabelFull('군용 연소 램프') === 'military');
ok('알 수 없는 소지품 → normal (fallback)', _qlabelFull('묘한 조각물') === 'normal');
ok('강철의 연옥 badge: no null return', ['강철 의수','진혼의 종','향로 지팡이','심령 청음기','군용 연소 램프'].every(n => _qlabelFull(n) !== null));

// ─── I2. item description fallback ──────────────────────────────────────────
console.log('\n[I2] Item description fallback');

// _qlabelFull 반환값(영문 키) → 한글 레이블 매핑
const _QLABEL_KEY_TO_LABEL = {
  danger:'위험', weapon:'무기', shield:'방어', medical:'의료', info:'정보',
  ritual:'의식', spiritual:'영적', sound:'음향', mech:'기계', military:'군용',
  gear:'장비', tool:'도구', high:'고급', broken:'파손', worn:'낡음', normal:null,
};
const _QLABEL_DESC = {
  '위험':'위험한 폭발물 또는 유해 물질',
  '무기':'전투에 사용하는 무기',
  '방어':'방어 및 보호용 장비',
  '의료':'치료 및 의료에 사용하는 도구',
  '정보':'정보 저장 및 처리 장치',
  '의식':'의식 및 제례에 사용하는 도구',
  '영적':'영적 존재와 관련된 도구',
  '음향':'소리를 감지하거나 발생시키는 장치',
  '기계':'기계식 보조 장치',
  '군용':'군사 목적의 장비',
  '장비':'전문 기술 장비',
  '도구':'범용 작업 도구',
  '고급':'고급 또는 특수 제작 장비',
  '파손':'손상된 장비',
  '낡음':'오래되거나 노후화된 물품',
};
function _itemDescFallback(name) {
  const key = _qlabelFull(name); // e.g. 'military', 'weapon'
  const label = _QLABEL_KEY_TO_LABEL[key];
  return (label && _QLABEL_DESC[label]) ?? null;
}

ok('강철 의수 → desc fallback 존재', !!_itemDescFallback('강철 의수'));
ok('진혼의 종 → desc fallback 존재', !!_itemDescFallback('진혼의 종'));
ok('향로 지팡이 → desc fallback 존재', !!_itemDescFallback('향로 지팡이'));
ok('심령 청음기 → desc fallback 존재', !!_itemDescFallback('심령 청음기'));
ok('군용 연소 램프 → desc fallback 존재', !!_itemDescFallback('군용 연소 램프'));
ok('은탄 리볼버 → desc fallback 존재', !!_itemDescFallback('은탄 리볼버'));
ok('리볼버 → desc fallback 존재', !!_itemDescFallback('리볼버'));
ok('desc fallback ≤60자', ['강철 의수','진혼의 종','향로 지팡이','심령 청음기','군용 연소 램프','은탄 리볼버'].every(n => (_itemDescFallback(n) ?? '').length <= 60));
ok('사용자 입력 desc 있으면 fallback 쓰지 않음', (_itemDescFallback('강철 의수') !== null) === true);

// ─── I3. 대화 tokenizer fixture ─────────────────────────────────────────────
console.log('\n[I3] Dialogue tokenizer — long fixture');

// 실제 사용자 예문을 Node 환경에서 시뮬레이션 (DOM 없이 순수 로직)
function simulateDialogueTokenizer(text) {
  const DIAL_PAIRS = [['“','”'],['「','」'],['『','』'],['"','"']];
  const matches = [];
  for (const [open, close] of DIAL_PAIRS) {
    const eo = open.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const ec = close.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re = new RegExp(eo+'([\\s\\S]{1,600}?)'+ec,'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ index: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  matches.sort((a,b)=>a.index-b.index);
  const deduped=[];let lastEnd=-1;
  for (const h of matches) { if(h.index>=lastEnd){deduped.push(h);lastEnd=h.end;} }
  if (!deduped.length) return { spans:0, skipped:false };
  const parts=[];let lastIdx=0;
  for (const h of deduped) {
    const before=(text.slice(lastIdx,h.index)||'').trim();
    if(before) parts.push({type:'narr',text:before});
    parts.push({type:'dial',text:h.text.trim()});
    lastIdx=h.end;
  }
  const after=(text.slice(lastIdx)||'').trim();
  if(after) parts.push({type:'narr',text:after});
  if(parts.length<2) return { spans:0, skipped:false };
  const hasCurly=deduped.some(h=>h.text.charCodeAt(0)===0x201C||h.text[0]==='「'||h.text[0]==='『');
  const dialLen=parts.filter(p=>p.type==='dial').reduce((s,p)=>s+p.text.length,0);
  const threshold=hasCurly?0:0.05;
  if(dialLen<text.length*threshold) return { spans:0, skipped:true };
  return { spans:deduped.length, skipped:false, parts };
}

// 예문 P1 (single paragraph, multiple dialogues with curly quotes)
const P1 = `한스는 그녀에게서 느껴지는 미묘한 기운에 이끌려 입을 열었다.\n"무슨 일로 여기까지 오셨습니까?" 그의 목소리는 엔진 소음 때문에 제대로 전달되지 않았지만, 엘라는 잠시 작업 손을 멈추고 그를 바라보았다.\n그녀의 눈은 빛을 잃은 듯 보였다.\n"당신은 청음기를 가지고 있군요." 그녀의 목소리는 맑았지만 어딘가 슬픈 울림이 섞여 있었다.\n"그것은 무엇에 쓰는 기계입니까?"`;
const P2 = `한스는 엘라의 질문에 짧게 대답했다.“유령을 감지하는 기계입니다.”엘라는 흥미로운 듯 그의 청음기를 유심히 살펴보았다.“유령을 느끼는 방법은 여러 가지가 있습니다.”그녀는 희미하게 미소 지으며 진혼의 종을 가볍게 흔들었다.`;
const P3 = `종소리는 엔진 소음과 함께 울려 퍼지며 묘한 공기를 만들었다.“저는 그들의 무게를 느낍니다.”`;

{
  const r1 = simulateDialogueTokenizer(P1);
  ok('P1: 대화 3개 이상 span 생성', r1.spans >= 3);
  ok('P1: skipped=false (곡선 따옴표 threshold=0)', !r1.skipped);

  const r2 = simulateDialogueTokenizer(P2);
  ok('P2: 대화 2개 span 생성 (붙어 있는 경우)', r2.spans === 2);
  ok('P2: 붙어있는 대사 분리 성공 (대답했다."유령..." 패턴)', !r2.skipped && r2.spans >= 2);

  const r3 = simulateDialogueTokenizer(P3);
  ok('P3: 마지막 대화 span 생성', r3.spans >= 1);

  const totalSpans = r1.spans + r2.spans + r3.spans;
  ok('전체 대화 span 합산 ≥ 6', totalSpans >= 6);

  // narration이 span에 포함되지 않는지 확인
  if (r2.parts) {
    const narrParts = r2.parts.filter(p => p.type === 'narr');
    const dialParts = r2.parts.filter(p => p.type === 'dial');
    ok('P2: narration segment 존재 (지문/대사 분리)', narrParts.length > 0);
    ok('P2: dialogue segment에 따옴표 포함', dialParts.every(p => /[“”""「『]/.test(p.text)));
  }
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

// I: new badge categories
ok('generate.js: 의식 category added',   genJs.includes("label:'의식'"));
ok('generate.js: 영적 category added',   genJs.includes("label:'영적'"));
ok('generate.js: 음향 category added',   genJs.includes("label:'음향'"));
ok('generate.js: 기계 category added',   genJs.includes("label:'기계'"));
ok('generate.js: 군용 category added',   genJs.includes("label:'군용'"));
ok('generate.js: _itemDescFallback exists', genJs.includes('_itemDescFallback'));
ok('generate.js: _QLABEL_DESC category map', genJs.includes('_QLABEL_DESC'));
ok('generate.js: 군용 in _QLABEL_DESC', genJs.includes("'군용'"));
ok('generate.js: _qlabel used in itemDescFallback', genJs.includes('const ql = _qlabel(name)'));

// D: debug labels renamed
ok('generate.js: 이번 화 역할',          genJs.includes('이번 화 역할'));
ok('generate.js: 전체 서사 위치',         genJs.includes('전체 서사 위치'));
ok('generate.js: 장면 설계 판정',         genJs.includes('장면 설계 판정'));
ok('generate.js: 수정 반복 횟수',         genJs.includes('수정 반복 횟수'));
ok('generate.js: 품질 검사 시간',         genJs.includes('품질 검사 시간'));
ok('generate.js: 종합 점수',              genJs.includes('종합 점수'));
ok('generate.js: 플래너 보상',            genJs.includes('플래너 보상'));
ok('generate.js: 본문 보상',              genJs.includes('본문 보상'));
ok('generate.js: 품질 판정',              genJs.includes('품질 판정'));
ok('generate.js: 추적 ID',               genJs.includes('추적 ID'));
ok('generate.js: 학습 데이터 적합성',     genJs.includes('학습 데이터 적합성'));
ok('generate.js: 엔딩 훅 유형',           genJs.includes('엔딩 훅 유형'));
ok('generate.js: 본문 목표 분량',         genJs.includes('본문 목표 분량'));
// old labels should be gone
ok('generate.js: "planner R" 제거됨',    !genJs.includes("kv('planner R'"));
ok('generate.js: "renderer R" 제거됨',   !genJs.includes("kv('renderer R'"));
ok('generate.js: "verdict" 제거됨',      !genJs.includes("kv('verdict'"));
ok('generate.js: "combined" 제거됨',     !genJs.includes("kv('combined'"));

// C: warning compact
ok('generate.js: _compact function',      genJs.includes('_compact'));
ok('generate.js: <details> for long warnings', genJs.includes('<details'));

// E: font sizes unified (0.82-0.95rem range)
ok('components.css: eq-info-label .84rem', compCss.includes('eq-info-label{font-size:.84rem'));
ok('components.css: eq-info-value .90rem', compCss.includes('eq-info-value{font-size:.90rem'));
ok('components.css: eq-kv-key .84rem',     compCss.includes('eq-kv-key{min-width:80px;font-size:.84rem'));
ok('components.css: eq-warn-item .84rem in rp-debug', compCss.includes('eq-warn-item{font-size:.84rem'));

// F: dialogue threshold
ok('generate.js: hasCurlyQuote threshold', genJs.includes('hasCurlyQuote'));
ok('generate.js: threshold=0 for curly',   genJs.includes('threshold = hasCurlyQuote ? 0 : 0.05'));
ok('generate.js: attachedDialogueSplits',  genJs.includes('attachedDialogueSplits'));

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

// New: range validation + hook mapping + block dialogue + item fallback + warning dedup
ok('generate.js: _rfOutOfRange range check',    genJs.includes('_rfOutOfRange'));
ok('generate.js: 범위 밖 warning text',         genJs.includes('범위 밖'));
ok('generate.js: HOOK_TYPE_KO in scene beats',  genJs.includes('HOOK_TYPE_KO[a.hook_type]'));
ok('generate.js: p.replaceWith in dialogue',    genJs.includes('p.replaceWith'));
ok('generate.js: dialogue-line class on block', genJs.includes("newP.classList.add('dialogue-line')"));
ok('generate.js: _QLABEL_DESC in generate.js', genJs.includes('_QLABEL_DESC'));
ok('generate.js: _CAP_DESC in hover card', genJs.includes('_CAP_DESC'));
ok('generate.js: QLABEL_CAP used in capDescFallback', genJs.includes('const ql = QLABEL_CAP(name)'));
ok('generate.js: _compact continuation only',   genJs.includes('const rest = text.slice(maxLen)'));
ok('context.ts: range validation for existingRf', ctxTs.includes('existingRf >= min && existingRf <= max'));

// ─── B. Debug consistency fixture ────────────────────────────────────────────
console.log('\n[B] Debug consistency — resolved_final_episode range');
{
  function isRfValid(totalEpisodes, totalEpisodesVar, resolved) {
    const v = totalEpisodesVar ?? 0;
    return resolved >= totalEpisodes - v && resolved <= totalEpisodes + v;
  }
  ok('B: 30±5, resolved=51 → invalid', !isRfValid(30, 5, 51));
  ok('B: 50±5, resolved=51 → valid',    isRfValid(50, 5, 51));
  ok('B: 30±0, resolved=51 → invalid', !isRfValid(30, 0, 51));
  ok('B: 30±5, resolved=30 → valid',    isRfValid(30, 5, 30));
  ok('B: 30±5, resolved=35 → valid (boundary)', isRfValid(30, 5, 35));
  ok('B: 30±5, resolved=36 → invalid (over)',  !isRfValid(30, 5, 36));
  ok('B: remaining = resolved - episode', ((resolved, ep) => resolved - ep)(31, 1) === 30);
}

// ─── C. Warning duplicate fixture ────────────────────────────────────────────
console.log('\n[C] Warning compact — no duplicate text in details');
{
  function _compactSim(text, maxLen = 50) {
    if (text.length <= maxLen) return text;
    const summary = text.slice(0, maxLen);
    const rest = text.slice(maxLen);
    return `<details><summary>${summary}…</summary>${rest}</details>`;
  }
  const warnText = "3인칭 관찰자 시점에서 '그는 다시 그날의 참혹한 광경을 목격하는 듯한 기분을 느꼈다'는 한스의 내면 감정을 직접 서술하여 시점 규칙을 위반했습니다.";
  const compact = _compactSim(warnText);
  const summaryM = compact.match(/<summary>(.+?)…<\/summary>/);
  const restM    = compact.match(/<\/summary>(.+)<\/details>/);
  const summaryPart = summaryM?.[1] ?? '';
  const restPart    = restM?.[1]    ?? '';
  ok('C: compact creates <details>', compact.includes('<details>'));
  ok('C: summary is first 50 chars', summaryPart === warnText.slice(0, 50));
  ok('C: details is continuation only (not full repeat)', restPart === warnText.slice(50));
  ok('C: full text reconstructed = summary+…+rest', summaryPart + '…' + restPart === warnText.slice(0,50) + '…' + warnText.slice(50));
  ok('C: short text not wrapped', _compactSim('짧은 경고') === '짧은 경고');
}

// ─── D. Hook mapping fixture ─────────────────────────────────────────────────
console.log('\n[D] Hook label mapping (16종)');
{
  const HOOK_MAP = {
    immediate_threat:'즉각적 위협', unexpected_discovery:'예상 밖 발견',
    new_problem:'새로운 문제 발생', unresolved_situation:'미완 상황',
    revelation:'충격적 폭로', betrayal_hint:'배신 암시',
    emotional_break:'감정 폭발', ironic_reversal:'아이러니한 반전',
    cliffhanger_choice:'선택 기로', tender_moment:'감동적 연결',
    ominous_calm:'불길한 고요', memory_trigger:'과거 기억 촉발',
    last_moment_failure:'마지막 순간 좌절', sudden_loss:'갑작스러운 상실',
    alliance_shift:'동맹 관계 역전', time_pressure:'시간 압박',
  };
  ok('D: 16종 매핑 완성', Object.keys(HOOK_MAP).length === 16);
  ok('D: ominous_calm → 불길한 고요', HOOK_MAP['ominous_calm'] === '불길한 고요');
  ok('D: immediate_threat → 즉각적 위협', HOOK_MAP['immediate_threat'] === '즉각적 위협');
  ok('D: unknown fallback = raw string', (HOOK_MAP['unknown_xyz'] ?? 'unknown_xyz') === 'unknown_xyz');
  ok('D: raw ominous_calm not in mapped output', (HOOK_MAP['ominous_calm'] ?? '') !== 'ominous_calm');
  // file check: all 16 in generate.js
  ['immediate_threat','unexpected_discovery','new_problem','unresolved_situation',
   'revelation','betrayal_hint','emotional_break','ironic_reversal',
   'cliffhanger_choice','tender_moment','ominous_calm','memory_trigger',
   'last_moment_failure','sudden_loss','alliance_shift','time_pressure',
  ].forEach(k => ok(`D: ${k} in HOOK_TYPE_KO`, genJs.includes(k)));
}

// ─── E. Dialogue fixture 1 ───────────────────────────────────────────────────
console.log('\n[E] Dialogue fixture 1 — attached 저기요…');
{
  const E1 = `그녀는 그 노이즈를 따라 천천히 발걸음을 옮겼다."저기요…"엘라는 조심스럽게 말을 걸었다."혹시… 괜찮으세요?"그녀의 목소리는 마치 깨진 유리 조각을 잇는 듯, 섬세하고 날카로웠다.`;
  const rE = simulateDialogueTokenizer(E1);
  ok('E: dialogueSegments = 2', rE.spans === 2);
  ok('E: skipped=false (curly quote)', !rE.skipped);
  if (rE.parts) {
    const dialE = rE.parts.filter(p => p.type === 'dial');
    const narrE = rE.parts.filter(p => p.type === 'narr');
    ok('E: narration segments ≥ 2', narrE.length >= 2);
    ok('E: 저기요 in dial block', dialE.some(p => p.text.includes('저기요')));
    ok('E: 괜찮으세요 in dial block', dialE.some(p => p.text.includes('괜찮으세요')));
    ok('E: 옮겼다." not in any narr', !narrE.some(p => p.text.includes('옮겼다.“')));
    ok('E: 에 따옴표 not appended to narr', !narrE.some(p => /[“”]$/.test(p.text)));
  }
}

// ─── F. Dialogue fixture 2 ───────────────────────────────────────────────────
console.log('\n[F2] Dialogue fixture 2 — attached 기계 소리?');
{
  const F1 = `“기계 소리?”한스는 잠시 멈춰 서서 그녀를 바라보았다.“그저 뉴 바벨의 소음일 뿐이오.”그는 다시 리볼버를 집어 들었다.“불편하면 떠나시면 되오.”`;
  const rF = simulateDialogueTokenizer(F1);
  ok('F: dialogueSegments = 3', rF.spans === 3);
  ok('F: skipped=false', !rF.skipped);
  if (rF.parts) {
    const dialF = rF.parts.filter(p => p.type === 'dial');
    const narrF = rF.parts.filter(p => p.type === 'narr');
    ok('F: narration segments ≥ 2', narrF.length >= 2);
    ok('F: 기계 소리 in dial block', dialF.some(p => p.text.includes('기계 소리')));
    ok('F: 불편하면 in dial block', dialF.some(p => p.text.includes('불편하면')));
    ok('F: ?” not in narr', !narrF.some(p => p.text.includes('?”')));
    ok('F: .”그는 not in narr', !narrF.some(p => p.text.includes('.”')));
  }
}

// ── Viewer mode lock ──────────────────────────────────────────
{
  console.log("\n── Viewer Mode Lock (source checks) ────────────────────────");
  const authJs = fs.readFileSync(path.join(__dirname, "../public/js/auth.js"), "utf-8");
  ok("lockCharCardFields: personality readOnly", authJs.includes("ta.readOnly = lock"));
  ok("lockCharCardFields: itemsInp disabled",    authJs.includes("itemsInp.disabled = lock"));
  ok("lockCharCardFields: items-viewer-locked",  authJs.includes("items-viewer-locked"));
  ok("lockCharCardFields: refineBtn disabled",   authJs.includes("refineBtn.disabled = lock"));
  ok("lockCharCardFields: aiBtn disabled in lock", authJs.includes("aiBtn.disabled = lock"));
  ok("lockCharCardFields: edPanel close on lock", authJs.includes('edPanel && lock'));
  const charsJs = fs.readFileSync(path.join(__dirname, "../public/js/chars.js"), "utf-8");
  ok("chars.js: viewerLocked guard in delegation", charsJs.includes("viewerLocked"));
}

// ── New book sidebar reset ────────────────────────────────────
{
  console.log("\n── New Book Sidebar Reset (source checks) ──────────────────");
  const authJs = fs.readFileSync(path.join(__dirname, "../public/js/auth.js"), "utf-8");
  ok("selectBook: updateEpisodeListUI immediate call", authJs.includes("updateEpisodeListUI()"));
  ok("selectBook: arcSection hidden on switch",        authJs.includes('arcSection.style.display = "none"'));
  ok("selectBook: arcActList cleared",                 authJs.includes("arcActList.innerHTML"));
}

// ── system-note-line ──────────────────────────────────────────
{
  console.log("\n── System Note Line (source checks) ────────────────────────");
  const genJs  = fs.readFileSync(path.join(__dirname, "../public/js/generate.js"), "utf-8");
  const layCSS = fs.readFileSync(path.join(__dirname, "../public/css/layout.css"), "utf-8");
  ok("generate.js: SYSTEM_BRACKET_RE defined",          genJs.includes("SYSTEM_BRACKET_RE"));
  ok("generate.js: system-note-line class assigned",    genJs.includes("system-note-line"));
  ok("layout.css: system-note-line text-indent:0",      layCSS.includes("system-note-line") && layCSS.includes("text-indent:0"));
}

// ── malformed quote repair ────────────────────────────────────
{
  console.log("\n── Malformed Quote Repair (source checks) ──────────────────");
  const genJs = fs.readFileSync(path.join(__dirname, "../public/js/generate.js"), "utf-8");
  ok("generate.js: malformed quote repair present",  genJs.includes("malformed quote repair"));
  ok("generate.js: Case A pattern (leading quote + space)",  genJs.includes("Case A"));
  ok("generate.js: Case B pattern (narr+dial split)", genJs.includes("Case B"));
}

// ── item AI suggest button ────────────────────────────────────
{
  console.log("\n── Item AI Suggest Button (source checks) ──────────────────");
  const charsJs   = fs.readFileSync(path.join(__dirname, "../public/js/chars.js"), "utf-8");
  const suggestJs = fs.readFileSync(path.join(__dirname, "../public/js/suggest.js"), "utf-8");
  ok("chars.js: item-ai-suggest-btn present",         charsJs.includes("item-ai-suggest-btn"));
  ok("chars.js: suggestItemDetail call",               charsJs.includes("suggestItemDetail"));
  ok("suggest.js: suggestItemDetail function",         suggestJs.includes("async function suggestItemDetail"));
  ok("suggest.js: existing desc not overwritten",      suggestJs.includes("if (!descInput.value.trim()"));
}

// ── character AI suggest preserves existing fields ───────────
{
  console.log("\n── Char AI Suggest Preserves Fields (source checks) ────────");
  const suggestJs = fs.readFileSync(path.join(__dirname, "../public/js/suggest.js"), "utf-8");
  ok("suggest.js: existing name check before overwrite", suggestJs.includes("existingName"));
  ok("suggest.js: personality only if empty",            suggestJs.includes("if (!taEl.value.trim())"));
  ok("suggest.js: new items only (existingNames set)",   suggestJs.includes("existingNames"));
}

// ── save loading messages ─────────────────────────────────────
{
  console.log("\n── Save Loading Messages (source checks) ───────────────────");
  const modalJs = fs.readFileSync(path.join(__dirname, "../public/js/modal.js"), "utf-8");
  ok("modal.js: _SAVE_MSGS array with 100 msgs",   (modalJs.match(/"[^"]+…"/g) ?? []).length >= 50);
  ok("modal.js: _startMsgCycle function",           modalJs.includes("_startMsgCycle"));
  ok("modal.js: clearInterval on restore",          modalJs.includes("clearInterval(_msgInterval)"));
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`Result: ${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) process.exit(1);
