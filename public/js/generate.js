// ── 에피소드 생성 & SSE 스트리밍 ─────────────────────────────

// 진행 중 생성 세션 전역 상태 — selectBook에서 즉시 안내에 사용
// { bookId, title, episode, status: "generating"|"completed"|"failed" }
window._fsActiveGen = null;
window._fsLastBgToastKey = null; // 생성중 이동 토스트 dedupe key

// 소지품 vocab 캐시 { [itemName]: { category, badge_label, color } }
let _itemVocab = {};
let _itemVocabBookId = null;

// book 전환 시 vocab 로드 (book_id가 바뀔 때만 재요청)
async function _loadItemVocab(bId) {
  if (!bId || bId === _itemVocabBookId) return;
  _itemVocabBookId = bId;
  _itemVocab = {};
  try {
    const res = await fetch(`/api/generate/item-vocab?book_id=${encodeURIComponent(bId)}`);
    if (!res.ok) return;
    const { vocab } = await res.json();
    // category → color 매핑
    const CAT_COLOR = {
      무기:'#a04060', 방어구:'#8060a0', 도구:'#607040', 소모품:'#40a060',
      문서:'#5060a0', 마법:'#9060a0', 통신:'#307080', 전자:'#307080',
      의복:'#7060a0', 식량:'#60a060', 귀중품:'#c08030', 악기:'#4070a0',
      탈것:'#506070', 기타:'#888',
    };
    for (const [name, v] of Object.entries(vocab)) {
      _itemVocab[name] = {
        category:    v.category,
        badge_label: v.badge_label,
        color:       CAT_COLOR[v.category] ?? '#888',
      };
    }
  } catch { /* vocab 로드 실패는 무시 */ }
}

// 현재 로드된 캐릭터 상태 — 화 전환 시에도 재사용
let _currentCharStates = [];
// 단일 hover 리스너 마운트 여부 (중복 방지)
let _hoverListenerMounted = false;
// 이름 → 상태 맵 (O(1) 조회)
let _charStateMap = {};
// char panel 요청 시퀀스 (stale response 감지)
let _charPanelRequestSeq = 0;

// 낭독 포맷 재적용 후 char-name-ref 재래핑 (applyAloudFormat이 innerHTML 교체 후 호출)
window._rewrapCharNamesIfNeeded = function() {
  const el = document.getElementById("output");
  if (!el || !_currentCharStates.length) return;
  if (!el.querySelector(".char-name-ref")) wrapCharNamesInOutput(_currentCharStates);
};

// 화 전환 후 이름 wrapping + 패널 재적용
function _reapplyCharUI() {
  if (!_currentCharStates.length) return;
  // output이 새로 렌더링됐으므로 .char-name-ref 없음 → wrapCharNamesInOutput 재실행
  const outputEl = document.getElementById('output');
  if (outputEl) outputEl.querySelectorAll('.char-name-ref').forEach(el => {
    el.outerHTML = el.textContent; // span 제거해서 wrapCharNamesInOutput 재진입 허용
  });
  updateSceneCharPanel(_currentCharStates);
  wrapCharNamesInOutput(_currentCharStates);
}

// ── 후처리 통계 카운터 ────────────────────────────────────────
const _ppStats = {
  quoteMerges: 0,             // 미닫힌 따옴표 병합 횟수
  bracketMerges: 0,           // 미닫힌 대괄호 병합 횟수
  dialogueSplits: 0,          // 대화/지문 혼합 단락 처리 횟수
  attachedDialogueSplits: 0,  // splitDialogueNarration에서 처리된 단락 수
  dialogueLinesTagged: 0,     // DIAL_START로 전체-대화 단락 태깅 수
  dialogueSegments: 0,        // 실제 생성된 dialogue-span 개수
  foreignCharsRemoved: 0,     // 외국어 문자 제거 횟수
  dialogueSkipped: 0,         // threshold로 처리 건너뜀
};
function _ppReset() { Object.keys(_ppStats).forEach(k => _ppStats[k] = 0); }

function _renderPostprocStats() {
  const el = document.getElementById('eqPostproc');
  const sec = document.getElementById('eqPostprocSection');
  if (!el) return;
  const _outputText = document.getElementById('output')?.textContent ?? '';
  const _hasQuotes = /[“「『”]/.test(_outputText);
  const _tagWarn = _hasQuotes && _ppStats.dialogueLinesTagged === 0 && _ppStats.dialogueSegments === 0;
  // 0이 아닌 항목 + 경고만 표시 (0 항목은 불필요한 노이즈)
  const rows = [];
  if (_ppStats.quoteMerges)         rows.push({ k:'따옴표 병합',   v:_ppStats.quoteMerges+'회',    cls:'warn' });
  if (_ppStats.bracketMerges)       rows.push({ k:'대괄호 병합',   v:_ppStats.bracketMerges+'회',  cls:'warn' });
  if (_ppStats.attachedDialogueSplits) rows.push({ k:'대화 분리',  v:_ppStats.attachedDialogueSplits+'단락', cls:'' });
  if (_ppStats.dialogueSegments)    rows.push({ k:'대화 span',     v:_ppStats.dialogueSegments+'개', cls:'' });
  if (_ppStats.dialogueSkipped)     rows.push({ k:'분리 건너뜀',   v:_ppStats.dialogueSkipped+'회', cls:'warn' });
  if (_ppStats.dialogueLinesTagged) rows.push({ k:'순수 대화줄',   v:_ppStats.dialogueLinesTagged+'줄', cls:'' });
  if (_ppStats.foreignCharsRemoved) rows.push({ k:'외국어 제거',   v:_ppStats.foreignCharsRemoved+'회', cls:'bad' });
  if (_tagWarn)                     rows.push({ k:'⚠ 대화 미탐지', v:'따옴표 있음', cls:'warn' });
  if (!rows.length) {
    el.innerHTML = '<div class="eq-empty">이상 없음</div>';
  } else {
    el.innerHTML = '<div class="eq-kv-list">' + rows.map(r =>
      `<div class="eq-kv"><span class="eq-kv-key">${r.k}</span><span class="eq-kv-val${r.cls ? ' '+r.cls : ''}">${r.v}</span></div>`
    ).join('') + '</div>';
  }
  if (sec) sec.hidden = false;
  // 후처리 완료 후 실제 화면 글자 수로 “실제 분량” 업데이트
  const _actualEl = document.getElementById('eqActualChars');
  if (_actualEl && _outputText.trim()) _actualEl.textContent = _outputText.trim().length + '자';
}

let _sessionStart = null;
let _rewindCount = 0;
let _speedChanges = 0;
let _generating = false; // 소리내어 읽기 등 독립 기능이 생성 중 상태를 파악하기 위한 플래그

function _trackRewind() { _rewindCount++; }
function _trackSpeedChange() { _speedChanges++; }

async function _sendLog(episodeNumber, completionRate, dropoutPosition) {
  const dwell_ms = _sessionStart ? Date.now() - _sessionStart : null;
  try {
    await fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        book_id: bookId,
        episode_number: episodeNumber,
        dwell_ms,
        dropout_position: dropoutPosition ?? null,
        rewind_count: _rewindCount,
        speed_changes: _speedChanges,
        completion_rate: completionRate,
      }),
    });
  } catch (e) { console.error(e); }
  _rewindCount = 0;
  _speedChanges = 0;
}

// ── Visual Pacing Engine (SOP §14) ───────────────────────
// 부호 기반 딜레이: 인지 부하를 시뮬레이션해 자연스러운 독서 리듬을 만든다
const PACING = [
  { re: /\.{3}/, ms: 380 },   // 말줄임표 — 긴 호흡
  { re: /[！？!?]/, ms: 120 }, // 감탄·의문 — 짧은 강세
  { re: /[。.]\s*$/, ms: 80 }, // 문장 끝 마침표
  { re: /，|,\s*$/, ms: 40 },  // 쉼표
];
let _pacingUntil = 0;
let _renderQueue = "";
let _renderTimer = null;

function _flushRender(done) {
  renderProgressiveRaw(_renderQueue, done);
}

function pacingAppend(token) {
  _renderQueue += token;
  const now = Date.now();
  const delay = PACING.reduce((d, rule) => rule.re.test(token) ? Math.max(d, rule.ms) : d, 0);

  if (delay > 0) {
    _pacingUntil = now + delay;
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(() => _flushRender(false), delay);
  } else if (now >= _pacingUntil) {
    clearTimeout(_renderTimer);
    _flushRender(false);
  }
}

// 에피소드 제목 추출: "# N화 - 제목" 첫 줄을 헤더로 분리
function extractEpTitle(text) {
  const m = text.match(/^#\s*(\d+화\s*[-–—]\s*.+)/m);
  if (!m) return { title: null, body: text };
  const title = m[1].trim();
  const body  = text.replace(/^#+\s*\d+화\s*[-–—]\s*.+\n?/m, "").trimStart();
  return { title, body };
}

// 미닫힌 따옴표 단락 병합: 모델이 따옴표를 닫지 않고 단락을 나눈 경우 다음 단락과 합침
function mergeUnclosedQuotes(container) {
  const OPEN_Q  = '\u201C\u2018\u300C\u300E"\'';
  const CLOSE_Q = '\u201D\u2019\u300D\u300F"\'';
  const openRE  = new RegExp('[' + OPEN_Q  + ']', 'g');
  const closeRE = new RegExp('[' + CLOSE_Q + ']', 'g');

  const paras = Array.from(container.querySelectorAll("p"));
  let i = 0;
  while (i < paras.length - 1) {
    const p = paras[i];
    const text = p.textContent;
    const opens  = (text.match(openRE)  || []).length;
    const closes = (text.match(closeRE) || []).length;
    if (opens > closes) {
      const next = paras[i + 1];
      // innerHTML 병합 — <br> 유지해서 다중 줄 대사 구조 보존
      const nextHtml = next.innerHTML.trimStart();
      p.innerHTML = p.innerHTML.trimEnd() + '<br>' + nextHtml;
      next.remove();
      paras.splice(i + 1, 1);
      _ppStats.quoteMerges++;
    } else {
      i++;
    }
  }
}

// 미닫힌 대괄호 단락 병합: [상태창] 등 [] 안에 \n\n이 끼어 단락이 쪼개진 경우 합침
function mergeUnclosedBrackets(container) {
  const paras = Array.from(container.querySelectorAll("p"));
  let i = 0;
  while (i < paras.length - 1) {
    const p = paras[i];
    const text = p.textContent;
    const opens  = (text.match(/\[/g) || []).length;
    const closes = (text.match(/\]/g) || []).length;
    if (opens > closes) {
      const next = paras[i + 1];
      p.textContent = text.trimEnd() + " " + next.textContent.trimStart();
      next.remove();
      paras.splice(i + 1, 1);
      _ppStats.bracketMerges++;
    } else {
      i++;
    }
  }
}

// 대사와 지문이 섞인 단락을 분리: 인용 기호 쌍 기준으로 대사/지문 교대 분리
function splitDialogueNarration(container) {
  // 한국 소설 대화 인용 기호 체계:
  //   주 대화: " " (U+201C/D) — 곡선 이중 따옴표, 가장 일반적
  //   전각:    「 」(U+300C/D)  『 』(U+300E/F) — 일부 소설
  //   직선 " (U+0022): 단락 중간의 "지문. "대사."" 패턴도 분리 대상으로 포함
  //     → 40% 임계값이 단어 강조("기술명" 등) 오탐 방지
  //   곡선 ' ' (U+2018/9): 단어 강조에도 쓰여 오탐 많음 → 제외
  const DIAL_PAIRS = [
    ['“', '”'],  // " "
    ['「', '」'],  // 「 」
    ['『', '』'],  // 『 』
    ['"',      '"'],       // " " (직선)
  ];

  container.querySelectorAll("p").forEach(p => {
    const text = p.textContent;
    const matches = [];

    for (const [open, close] of DIAL_PAIRS) {
      const escapedO = open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedC = close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // [\s\S]{1,600}: 멀티라인 대사 허용 (최대 600자)
      const re = new RegExp(escapedO + '([\\s\\S]{1,600}?)' + escapedC, 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.push({ index: m.index, end: m.index + m[0].length, text: m[0] });
      }
    }

    matches.sort((a, b) => a.index - b.index);
    // 겹치는 매치 제거
    const deduped = [];
    let lastEnd = -1;
    for (const hit of matches) {
      if (hit.index >= lastEnd) { deduped.push(hit); lastEnd = hit.end; }
    }

    if (!deduped.length) return;

    // 브래킷 전용 문자 제거 헬퍼 (LLM이 [대화] 형태로 단락 감쌀 때 생기는 [ ] 잔여 프래그먼트 제거)
    const stripBracketNoise = s => s.replace(/^[\[\]【】「」『』\s]+$/, '').trim();
    const parts = [];
    let lastIdx = 0;
    for (const hit of deduped) {
      const beforeRaw = text.slice(lastIdx, hit.index).trim();
      const before = stripBracketNoise(beforeRaw);
      if (before) parts.push({ type: "narr", text: before });
      parts.push({ type: "dial", text: hit.text.trim() });
      lastIdx = hit.end;
    }
    const afterRaw = text.slice(lastIdx).trim();
    const after = stripBracketNoise(afterRaw);
    if (after) parts.push({ type: "narr", text: after });

    // 순수 대사 or 순수 지문은 그대로
    if (parts.length < 2) return;
    // 곡선 따옴표(" ")는 항상 진짜 대화 → threshold 없음
    // 직선 따옴표(" ")는 기술명 오탐 방지를 위해 5% threshold 적용
    const hasCurlyQuote = deduped.some(h => h.text.charCodeAt(0) === 0x201C || h.text[0] === '「' || h.text[0] === '『');
    const dialLen = parts.filter(pt => pt.type === "dial").reduce((s, pt) => s + pt.text.length, 0);
    const threshold = hasCurlyQuote ? 0 : 0.05;
    if (dialLen < text.length * threshold) { _ppStats.dialogueSkipped++; return; }
    _ppStats.attachedDialogueSplits = (_ppStats.attachedDialogueSplits || 0) + 1;

    // 블록 분리 방식: 대사/지문 각각 별도 <p>로 분리 — 인라인 혼합 방지
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const newNodes = [];
    for (const pt of parts) {
      const newP = document.createElement('p');
      if (pt.type === 'dial') {
        newP.classList.add('dialogue-line');
        newP.innerHTML = `<span class="dialogue-span">${esc(pt.text)}</span>`;
        _ppStats.dialogueSegments++;
      } else {
        newP.textContent = pt.text;
      }
      newNodes.push(newP);
    }
    p.replaceWith(...newNodes);
    _ppStats.dialogueSplits++;
  });
}
// 대사 단락 강조: " " " " 로 시작하는 <p>에 클래스 부여
function applyDialogueStyle(container) {
  mergeUnclosedBrackets(container);
  mergeUnclosedQuotes(container);
  splitDialogueNarration(container);
  // splitDialogueNarration이 이미 dialogue-line을 부여한 <p>는 재판정하지 않음
  // (분리된 대화 <p>를 다시 보면 첫 글자가 따옴표라 중복 추가되는 문제 방지)
  // 단락 첫 글자 기준 dialogue-line 부여
  // 직선 " (U+0022)도 포함 — 모델이 직선 따옴표로 대화를 시작하는 경우 대응
  // 곡선 작은따옴표 ' (U+2018)는 제외 — '스킬명' 등 단어 강조 오탐 방지
  const DIAL_START = /^[\u201C\u300C\u300E"]/;
  // 순수 대사 단락 (전체가 대화인 경우): dialogue-line + 내용 전체를 dialogue-span으로 감쌈
  container.querySelectorAll("p:not(.dialogue-line)").forEach(p => {
    if (!p.querySelector('.dialogue-span') && DIAL_START.test(p.textContent.trimStart())) {
      p.classList.add("dialogue-line");
      const esc2 = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      p.innerHTML = `<span class="dialogue-span">${esc2(p.textContent)}</span>`;
      _ppStats.dialogueLinesTagged++;
      _ppStats.dialogueSegments++;
    }
  });
  // 지문 단락에 잘못 붙은 dialogue-line 제거 (내부 dialogue-span 없고 따옴표 시작도 아닌 경우)
  container.querySelectorAll("p.dialogue-line").forEach(p => {
    if (!p.querySelector('.dialogue-span') && !DIAL_START.test(p.textContent.trimStart())) {
      p.classList.remove("dialogue-line");
    }
  });

  // 시스템/스킬/상태 대괄호 문구 처리: [고유 스킬:], [상태:], [알림:] 등
  // → .system-note-line 클래스 부여 (text-indent 없는 별도 스타일)
  const SYSTEM_BRACKET_RE = /^\[(?:고유\s*스킬|스킬|상태|알림|시스템|System|STATUS|SKILL|NOTICE)\s*:/i;
  container.querySelectorAll("p:not(.dialogue-line)").forEach(p => {
    const txt = p.textContent.trimStart();
    if (SYSTEM_BRACKET_RE.test(txt)) p.classList.add("system-note-line");
  });
}

function renderProgressiveRaw(text, done) {
  // [CLIFF] 구분자 제거 (서버가 스트리밍 중 전송하는 마커, 저장 텍스트에서 제거)
  // [CLIFF] 또는 [CLIFF (미닫힘) 제거 — 모델이 ] 없이 쓰는 경우 대응
  text = text.replace(/\[CLIFF[\]\n]?/g, "").replace(/\[END\]/gi, "").replace(/\n{3,}/g, "\n\n");
  // 단일 \n → \n\n: LLM이 문장별 단일 줄바꿈 출력 시 marked.parse가 하나의 <p>로 묶는 문제 방지
  // "글자\n글자" 패턴만 확장. 이미 \n\n인 곳은 건드리지 않음.
  text = text.replace(/([^\n])\n([^\n])/g, '$1\n\n$2');
  // 키릴·아랍·가나 등 비한국어 문자 제거 (qwen2.5 다국어 모델 오탐 방지)
  text = text.replace(/[Ѐ-ӿ؀-ۿ぀-ゟ゠-ヿ]/g, m => { _ppStats.foreignCharsRemoved++; return ""; });
  // LLM 오탐 특수문자 제거 (◉ ◆ ◇ ■ □ 등 서술에 불필요한 기호)
  text = text.replace(/[◉◆◇■□●○▶▷◀◁★☆]/g, "");
  // 문장 끝 부호 바로 뒤에 공백 없이 한글·영문자가 이어지는 경우 공백 삽입
  text = text.replace(/([.!?。!?])([가-힣A-Za-z])/g, '$1 $2');
  // malformed quote repair:
  // Case A: 줄 시작 '” 지문' — 여는 따옴표 뒤 공백+지문, 닫는 따옴표 없는 줄 → 따옴표 제거 (지문 간주)
  text = text.replace(/^[“””“”]\s+([^”””“”\n]{3,})$/mg, (m, body) => {
    if (/[“””“”]/.test(body)) return m;
    return body.trim();
  });
  // Case B: '지문.”대사”' 형태로 붙어있는 경우 → 단락 분리
  text = text.replace(/([가-힣.!?]{2,})([“”“])([^”””“”\n]+[“””“”])/g, (_m, narr, oq, dial) => {
    return narr + '\n\n' + oq + dial;
  });
  // 직선 따옴표 → 곡선 따옴표 변환 (모델이 " 사용 시 교정)
  // 1단계: 완전한 쌍 변환 (straight-straight 또는 straight-curlyclose)
  text = text.replace(/^"([^"\u201D\n]+)[\u201D"]$/mg, "\u201C$1\u201D")  // 단락 전체
             .replace(/"([^"\u201D\n]*[가-힣][^"\u201D\n]*)[\u201D"]/g, "\u201C$1\u201D"); // 인라인
  // 2단계: 쌍 변환 후 남은 단독 직선따옴표 교정 (단락 경계 기준)
  text = text.replace(/^"/mg, "\u201C")   // 단락 시작 직선 → 곡선 열림
             .replace(/"$/mg, "\u201D");  // 단락 끝 직선 → 곡선 닫힘
  const { title, body } = extractEpTitle(text);

  // 출력 헤더: 스트리밍 중에도 즉시 표시
  const header   = document.getElementById("outputHeader");
  const labelEl  = document.getElementById("outputEpLabel");
  const titleEl  = document.getElementById("outputEpTitle");
  const bookTitleEl = document.getElementById("outputBookTitle");
  const epSepEl  = document.getElementById("outputEpSep");
  if (header && displayedEpisode) header.style.display = "flex";
  if (labelEl && displayedEpisode) labelEl.textContent = `${displayedEpisode}화`;
  if (titleEl) titleEl.textContent = title ? title.replace(/^\d+화\s*[-–—]\s*/, "") : "";
  if (bookTitleEl) bookTitleEl.textContent = (typeof activeBookTitle !== "undefined" ? activeBookTitle : "") || "";
  // POST-1: separator 완전 제거 — 좌(N화 화 제목) / 우(책 제목) 좌우 정렬만 사용
  if (epSepEl) epSepEl.style.display = "none";

  const parts = body.split(/\n\n/);
  if (done || parts.length === 1) {
    output.innerHTML = marked.parse(body);
  } else {
    // 마지막 불완전 단락도 <p>로 감싸 낭독 핸들러가 일관되게 부착되도록 함
    output.innerHTML = marked.parse(parts.slice(0,-1).join("\n\n")) +
      `<p class="streaming-tail" style="color:var(--text2);">${parts[parts.length-1]}</p>`;
  }
  if (done) {
    applyDialogueStyle(output);
    if (typeof updateGenderFromContext !== "undefined") updateGenderFromContext();
    if (typeof readMode !== "undefined" && readMode === "aloud") applyFocusLine();
  } else if (typeof readMode !== "undefined" && readMode === "aloud") {
    // 스트리밍 중에도 클릭 핸들러 재부착 + 포커스 인덱스 복원 (스크롤 없이)
    applyFocusLine(true);
  }
}

function renderProgressive(text, done) {
  if (done) { clearTimeout(_renderTimer); _renderQueue = text; _flushRender(true); return; }
  renderProgressiveRaw(text, false);
}

async function _loadAndApplyCharStates(episodeNum) {
  if (!bookId) return;
  const reqBookId = bookId;
  const reqSeq = ++_charPanelRequestSeq;
  await _loadItemVocab(reqBookId);
  // vocab 로드 후 bookId가 바뀌었으면 stale
  if (reqSeq !== _charPanelRequestSeq || reqBookId !== bookId) {
    console.debug("[char-panel] stale after vocab load", reqSeq, reqBookId);
    return;
  }
  try {
    const [charData, auditData] = await Promise.all([
      fetch(`/api/generate/char-states?book_id=${reqBookId}&episode=${episodeNum}`).then(r => r.json()),
      fetch(`/api/generate/audit-status?book_id=${reqBookId}&episode=${episodeNum}`).then(r => r.json()),
    ]);
    // stale check: 응답 도착 시점에 book이 바뀌었으면 무시
    if (reqSeq !== _charPanelRequestSeq || reqBookId !== bookId) {
      console.debug("[char-panel] stale response ignored", reqSeq, reqBookId);
      return;
    }
    // 생성 중이면 패널을 건드리지 않음 — _clearDebugPanels 효과 보존
    if (_generating) return;
    if (charData.char_states) {
      updateSceneCharPanel(charData.char_states);
      wrapCharNamesInOutput(charData.char_states);
      updateDebugCharStates(charData.char_states);
    }
    if (auditData.status === 'done') {
      window._lastAuditStatus = auditData;
      window._lastEpisodeMeta = window._lastEpisodeMeta || {};
      updateDebugMeta(window._lastEpisodeMeta, auditData);
    }
  } catch { /* 조용히 무시 */ }
}

function _prevEpNum(from) {
  // 캐시 내에서 from보다 작은 가장 큰 화 번호 (gap-safe)
  return Object.keys(episodeCache)
    .map(Number).filter(n => n < from).sort((a, b) => b - a)[0] ?? null;
}
function _nextEpNum(from) {
  // 캐시 내에서 from보다 큰 가장 작은 화 번호 (gap-safe)
  return Object.keys(episodeCache)
    .map(Number).filter(n => n > from).sort((a, b) => a - b)[0] ?? null;
}

// Phase 4.16 — 회차 navigation 후 본문 상단으로 scroll. 1회 적용.
function _scrollToTopOnEpisodeChange() {
  try {
    const out = document.getElementById("output");
    if (out) out.scrollTop = 0;
    const reader = document.querySelector(".reader") || document.querySelector("main");
    if (reader) reader.scrollTop = 0;
    // 페이지 자체도 상단으로 (모바일 등)
    if (typeof window !== "undefined" && window.scrollTo) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  } catch {}
}

function viewPrev() {
  const prev = displayedEpisode !== null ? _prevEpNum(displayedEpisode) : _prevEpNum(currentEpisode);
  if (prev === null) return;
  displayedEpisode = prev;
  _ppReset();
  renderProgressive(episodeCache[displayedEpisode], true);
  _renderPostprocStats();
  updateEpisodeUI();
  _loadAndApplyCharStates(displayedEpisode);
  _scrollToTopOnEpisodeChange();
}

function viewNext() {
  const next = displayedEpisode !== null ? _nextEpNum(displayedEpisode) : _nextEpNum(currentEpisode - 1);
  if (next === null || !episodeCache[next]) return;
  displayedEpisode = next;
  _ppReset();
  renderProgressive(episodeCache[displayedEpisode], true);
  _renderPostprocStats();
  updateEpisodeUI();
  _loadAndApplyCharStates(displayedEpisode);
  _scrollToTopOnEpisodeChange();
}

function regenerate() {
  if (_generating) return;
  if (displayedEpisode == null) return;
  // 현재 화를 캐시에서 제거하고 동일 번호로 재생성
  const regenEp = displayedEpisode;
  delete episodeCache[regenEp];
  currentEpisode = regenEp;
  displayedEpisode = null;
  document.getElementById("output").textContent = "";
  // 1화 재생성: regen_nonce로 플랜 다양성 유도
  window._regenNonce = (regenEp === 1) ? Date.now().toString(36) : null;
  // 재생성 플래그: _finishGeneration에서 currentEpisode++ 방지
  window._regenMode = regenEp;
  generate();
}

async function saveEpisode(episodeNum, content, targetBookId) {
  const bid = targetBookId || bookId;
  const clean = content.replace(/\[CLIFF[\]\n]?/g, "").replace(/\[END\]/gi, "").trim();
  await fetch("/api/episodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: bid, episode_number: episodeNum, content: clean }),
  });
}

function generate() {
  // 세계관 설정 사전 검사
  if (!settingVals.length && !moodVals.length) {
    showToast("세계관 설정을 먼저 완료해주세요. 배경·세계관 또는 장르·분위기를 선택하세요.", "warn", 4000);
    openModal();
    return;
  }
  if (!ruleEntries.length) {
    showToast("세계관 규칙을 최소 1개 이상 추가해주세요. AI 추천을 사용하셔도 됩니다.", "warn", 4000);
    openModal();
    return;
  }

  let rawText = "";
  _renderQueue = ""; _pacingUntil = 0; clearTimeout(_renderTimer);
  // Phase 4.20 R5A — 진행 중 텍스트 전역 buffer 초기화 (이전 세션 잔재 방지).
  window._fsActiveGenText = "";
  _ppReset();
  output.innerHTML = _makeLoadingHTML();
  _startLoadingAnim();
  _sessionStart = Date.now();
  _generating = true;
  _clearDebugPanels();
  _markAuditPending(null);

  // generation session — capture bookId at start to prevent cross-book save
  const _titleAtStart = (typeof activeBookTitle !== "undefined" ? activeBookTitle : "") || "이전 책";
  const _genSession = {
    id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
    bookIdAtStart: bookId,
    episodeAtStart: currentEpisode,
    titleAtStart: _titleAtStart,
  };
  const episodeNum = currentEpisode;
  // 전역 생성 상태 등록 — 책 이동 시 즉시 안내에 사용
  window._fsActiveGen = { bookId, title: _titleAtStart, episode: episodeNum, status: "generating" };
  let _staleMsgShown = false;  // 책 이동 안내 toast 1회만 표시
  displayedEpisode = episodeNum;
  btn.disabled = true; prevBtn.disabled = true;
  updateEpisodeUI();
  let _pendingCharStates = null;
  let _doneReceived = false;

  function _finishGeneration() {
    if (_generateFinished) return;
    _generateFinished = true;
    es.close();
    _generating = false;
    clearInterval(_loadingInterval);
    // session stale check — if active book changed, skip render/save to current view
    const sessionStale = bookId !== _genSession.bookIdAtStart;
    if (sessionStale) {
      console.warn("[generate] session stale — saving to original book only, skipping UI update", _genSession);
      saveEpisode(episodeNum, rawText, _genSession.bookIdAtStart);
      window._fsActiveGen = null; window._fsLastBgToastKey = null;
      showToast?.(`《${_genSession.titleAtStart}》 ${episodeNum}화 생성이 완료되었습니다.`, "success", 5000);
      btn.disabled = false;
      return;
    }
    window._fsActiveGen = null; window._fsLastBgToastKey = null;
    window._fsActiveGenText = "";
    renderProgressive(rawText, true);
    _renderPostprocStats();
    if (_pendingCharStates) { updateSceneCharPanel(_pendingCharStates); wrapCharNamesInOutput(_pendingCharStates); }
    applyFocusLine?.();
    episodeCache[episodeNum] = rawText;
    saveEpisode(episodeNum, rawText, _genSession.bookIdAtStart);
    _sendLog(episodeNum, 1.0, null);
    displayedEpisode = episodeNum;
    const _wasRegen = window._regenMode === episodeNum;
    window._regenMode = null;
    // 재생성: episodeNum+1이 next — regenerate()에서 currentEpisode=regenEp으로 되돌렸으므로 복원
    // 신규 생성: 그냥 +1
    currentEpisode = _wasRegen ? episodeNum + 1 : currentEpisode + 1;
    console.log("[episode-ui-sync]", {
      reason: _wasRegen ? "regen-complete" : "new-episode",
      episodeNum,
      currentEpisode,
      displayedEpisode,
      episodeCacheKeys: Object.keys(episodeCache || {}),
    });
    updateEpisodeUI();
    syncBookEpisode?.();
    if (episodeNum >= 2) applySettingsLock?.(true);
    // vocab 로드 후 패널 재렌더 — _pendingCharStates 직접 렌더 시 _itemVocab이
    // 아직 비어 있어 배지가 누락될 수 있음. 1초 후 재갱신으로 보정.
    // 소지품 설명 background job 완료 대기도 겸함 (기존 3.5초 → 1초로 단축).
    setTimeout(() => { if (!_generating) _loadAndApplyCharStates(episodeNum); }, 1000);
    btn.disabled = false;
  }
  let _generateFinished = false;

  const _regenParam = window._regenNonce ? `&regen_nonce=${encodeURIComponent(window._regenNonce)}` : "";
  // Phase 4.20 R5A — feature flag toggle. localStorage.fs_stream_mode = 'hybrid' 또는 'batch'.
  // 기본값은 batch (기존 동작). 개발자 콘솔: localStorage.setItem('fs_stream_mode','hybrid')
  const _streamMode = (typeof localStorage !== 'undefined' && localStorage.getItem('fs_stream_mode')) || '';
  const _streamParam = _streamMode === 'hybrid' || _streamMode === 'batch' ? `&stream_mode=${_streamMode}` : '';
  const es = new EventSource(`/api/generate?episode=${currentEpisode}&book_id=${_genSession.bookIdAtStart}&use_planner=true${_regenParam}${_streamParam}`);
  es.onmessage = e => {
    if (e.data === "[DONE]") { _finishGeneration(); return; }
    try {
      const json = JSON.parse(e.data);
      if (json.status) {
        clearInterval(_loadingInterval); // 자동 순환 정지 — 실제 상태 메시지 고정
        const el = document.getElementById('genLoadingMsg');
        if (el) {
          el.style.opacity = '0';
          setTimeout(() => { if (el) { el.textContent = json.status; el.style.opacity = '1'; } }, 200);
        }
      } else if (json.phase) {
        // Phase 4.20 R5A — hybrid streaming phase 이벤트 (개발자 추적용).
        // UI 변화는 token 도착으로 처리됨. 여기선 dev 로깅만.
        console.debug("[generate] phase:", json.phase, json);
      } else if (json.sanitized_correction) {
        // chunk vs DB 차이 알림 (R5A 프로토타입은 본문 교체 안 함). 로그만.
        console.debug("[generate] sanitized_correction:", json);
      } else if (json.error) {
        _generating = false;
        window._fsActiveGen = null; window._fsLastBgToastKey = null;
        output.textContent = "오류가 발생했습니다.";
        es.close(); btn.disabled = false; prevBtn.disabled = false;
      } else if (json.done) {
        _doneReceived = true;  // onerror 이중 처리 방지 (SSE 종료 시 onerror 발생할 수 있음)
        if (json.char_states) { _pendingCharStates = json.char_states; updateDebugCharStates(json.char_states); }
        if (json.episode_meta) {
          window._lastEpisodeMeta = json.episode_meta;
          updateDebugMeta(json.episode_meta, null);   // 임시 (감사 대기 중)
          _markAuditPending(null);                    // 즉시 "분석 중…" 표시
          _startAuditPolling(episodeNum);             // 실제 audit 결과 폴링 시작
        }
        // done JSON 수신 후 짧은 지연으로 스트림 종료 대기
        setTimeout(_finishGeneration, 300);
      } else if (json.token) {
        // 항상 rawText에 누적 — 책 전환 후 복귀 시 정확한 본문 복원 + 정확한 saveEpisode 보장.
        rawText += json.token;
        // 전역 buffer — selectBook 복귀 시 stale DB 콘텐츠 대신 in-progress 텍스트 복원에 사용.
        window._fsActiveGenText = rawText;
        // stale check — 책이 바뀌었으면 화면에는 반영하지 않고 toast만.
        if (bookId !== _genSession.bookIdAtStart) {
          if (!_staleMsgShown) {
            _staleMsgShown = true;
            showToast?.(`《${_genSession.titleAtStart}》 ${episodeNum}화 생성 중입니다. 다른 책으로 이동했습니다. 생성 결과는 원래 책에 저장됩니다.`, "info", 6000);
          }
          return;
        }
        _renderQueue = rawText; pacingAppend(json.token);
        // Phase 4.19 — 본문 token이 도착하면 ep-end에 placeholder 표시.
        // char-states가 done event에 함께 도착 시 renderEpisodeEndCharCards가 교체.
        const _epEnd = document.getElementById('episodeEndCards');
        if (_epEnd && _epEnd.hidden) {
          _epEnd.innerHTML = `
            <div class="ep-end-title">현재 인물 상태</div>
            <div class="ep-end-pending">
              <span class="ep-end-pending-spinner"></span>
              이번 화의 인물 상태를 정리하고 있습니다…
            </div>`;
          _epEnd.hidden = false;
        }
      }
    } catch (err) { console.error(err); }
  };
  es.onerror = () => {
    if (_generateFinished || _doneReceived) return;
    es.close();
    _generating = false;
    const sessionStale = bookId !== _genSession.bookIdAtStart;
    if (rawText) {
      const approxCompletion = Math.min(rawText.length / 900, 1.0);
      _sendLog(episodeNum, approxCompletion, approxCompletion < 0.95 ? approxCompletion : null);
      saveEpisode(episodeNum, rawText, _genSession.bookIdAtStart);
      if (!sessionStale) {
        renderProgressive(rawText, true);
        if (_pendingCharStates) { updateSceneCharPanel(_pendingCharStates); wrapCharNamesInOutput(_pendingCharStates); }
        applyFocusLine?.();
        episodeCache[episodeNum] = rawText;
        displayedEpisode = episodeNum;
        const _wasRegenErr = window._regenMode === episodeNum;
        window._regenMode = null;
        currentEpisode = _wasRegenErr ? episodeNum + 1 : currentEpisode + 1;
        console.log("[episode-ui-sync]", {
          reason: _wasRegenErr ? "regen-onerror" : "new-onerror",
          episodeNum,
          currentEpisode,
          displayedEpisode,
          episodeCacheKeys: Object.keys(episodeCache || {}),
        });
        updateEpisodeUI();
      } else {
        console.warn("[generate] onerror: session stale — saved to original book, skipping UI update", _genSession);
        window._fsActiveGen = null; window._fsLastBgToastKey = null;
        showToast?.(`《${_genSession.titleAtStart}》 ${episodeNum}화 생성이 완료되었습니다. (저장됨)`, "success", 5000);
      }
    }
    btn.disabled = false; prevBtn.disabled = false;
  };
}

// ══════════════════════════════════════════════════════════════
// 몰입형 UI — Scene Character Panel + Hover Card + Debug Drawer
// ══════════════════════════════════════════════════════════════

const _PHYS_HIDDEN = [];
const _GENDER_COLOR = { '남성': '#5a8fd4', '여성': '#d47090', '해당없음': 'var(--text4)', '기타': 'var(--text4)' };

// 감정 → 배지 색상 클래스
function _emotionClass(e) {
  if (!e) return 'emotion-unknown';
  const pos    = ['기쁨','설렘','만족','안도','평온','희망','흥분','행복','들뜸','유쾌','충만'];
  const angry  = ['분노','분개','적대','화','격분','원망','증오'];
  const sad    = ['슬픔','우울','절망','상실','외로움','고독','허탈','비통'];
  const tense  = ['경계','긴장','불안','초조','두려움','공포','위협','혼란','당혹'];
  if (pos.some(k => e.includes(k)))   return 'emotion-positive';
  if (angry.some(k => e.includes(k))) return 'emotion-angry';
  if (sad.some(k => e.includes(k)))   return 'emotion-sad';
  if (tense.some(k => e.includes(k))) return 'emotion-tense';
  return 'emotion-neutral';
}

// 감정 문자열 → 키워드 배열 분리
function _splitEmotState(e) {
  if (!e) return ['미파악'];
  // 쉼표·마침표·줄바꿈으로 분리, 각 토큰 12자 초과 시 추가 분리 없이 그대로 유지
  return e.split(/[,，、.。\n]+/).map(s => s.trim()).filter(Boolean);
}

// 감정 키워드 배열 → 배지 HTML — 같은 색상 클래스끼리 연속 정렬
function _emotBadgesHtml(e) {
  const keywords = _splitEmotState(e);
  // 색상 클래스 기준 정렬 (같은 계열 연속)
  const order = ['emotion-positive','emotion-tense','emotion-angry','emotion-sad','emotion-neutral','emotion-unknown'];
  const sorted = [...keywords].sort((a, b) => order.indexOf(_emotionClass(a)) - order.indexOf(_emotionClass(b)));
  return sorted.map(k => {
    if (k.length > 16) {
      return `<span class="emot-text-box ${_emotionClass(k)}">${k.length > 24 ? k.slice(0, 24) + '…' : k}</span>`;
    }
    return `<span class="state-badge ${_emotionClass(k)}">${k}</span>`;
  }).join('');
}

// 신체 상태 → 배지 색상 클래스
function _physClass(p) {
  if (!p || p === '정상' || p === '양호') return 'phys-normal';
  const tired = ['피로','지침','탈진','소진','졸음','체력 고갈','기력 고갈','체력 소진','기력 소진','호흡 곤란','숨가쁨','숨막힘'];
  const hurt  = ['부상','상처','출혈','골절','타박','찰과상','피 흘림','열상','자상'];
  const crit  = ['중상','의식불명','사경','빈사','혼수','심각','위중'];
  const spec  = ['봉인','마비','중독','저주','변이','석화','빙결'];
  if (crit.some(k => p.includes(k)))  return 'phys-critical';
  if (hurt.some(k => p.includes(k)))  return 'phys-hurt';
  if (tired.some(k => p.includes(k))) return 'phys-tired';
  if (spec.some(k => p.includes(k)))  return 'phys-special';
  return 'phys-other';
}

// 신체 상태 문자열 → 개별 항목 배열 분리 (쉼표·중점·슬래시 구분)
function _splitPhysState(p) {
  if (!p || p === '정상' || p === '양호') return [p || '정상'];
  return p.split(/[,、·\/]/).map(s => s.trim()).filter(Boolean);
}

// 신체 상태 items → badge HTML — 같은 색상 클래스끼리 연속 정렬
function _physBadgesHtml(p) {
  const items = _splitPhysState(p);
  const physOrder = ['phys-critical','phys-hurt','phys-special','phys-tired','phys-normal','phys-other'];
  const sorted = [...items].sort((a, b) => physOrder.indexOf(_physClass(a)) - physOrder.indexOf(_physClass(b)));
  if (sorted.length === 1) {
    return `<span class="state-badge ${_physClass(sorted[0])}">${sorted[0]}</span>`;
  }
  return `<div class="state-badge-wrap">${
    sorted.map(item => `<span class="state-badge state-badge-sm ${_physClass(item)}">${item}</span>`).join('')
  }</div>`;
}

// ── 캡처+ 스타일 인물 카드 — 본문 하단 ep-end-card와 캡처 양쪽에서 공유 ──
// POST-1 §S10 reopen — 단일 presentational renderer. inline-style 우선 (clipboard-safe),
// 항상 펼침, toggle/chevron 없음. 외부 wrapper는 호출부에서 attach.
const _CAP_GENDER_COLOR = { '남성': '#7090c8', '여성': '#c07090', '기타': '#70a878', '해당없음': 'var(--text4)' };
const _CAP_GRADE_COLOR  = { S:'#d4a000', A:'#9b5de0', B:'#3b82c8', C:'#2e8a55', D:'#888' };
const _CAP_PHYS_COLOR = {
  'phys-normal':   { bg: 'rgba(34,197,94,.12)',   color: 'rgba(34,197,94,.9)',   border: 'rgba(34,197,94,.3)'  },
  'phys-tired':    { bg: 'rgba(234,179,8,.12)',   color: 'rgba(234,179,8,.9)',   border: 'rgba(234,179,8,.3)'  },
  'phys-hurt':     { bg: 'rgba(249,115,22,.12)',  color: 'rgba(249,115,22,.9)',  border: 'rgba(249,115,22,.3)' },
  'phys-critical': { bg: 'rgba(239,68,68,.14)',   color: 'rgba(239,68,68,.95)',  border: 'rgba(239,68,68,.35)' },
  'phys-special':  { bg: 'rgba(139,92,246,.12)',  color: 'rgba(139,92,246,.9)',  border: 'rgba(139,92,246,.3)' },
  'phys-other':    { bg: 'rgba(128,128,128,.08)', color: 'rgba(180,180,180,.9)', border: 'rgba(128,128,128,.2)'},
};
const _CAP_EMOT_COLOR = {
  'emotion-positive': { bg: 'rgba(99,179,104,.12)',  color: 'rgba(99,179,104,.9)',  border: 'rgba(99,179,104,.3)'  },
  'emotion-tense':    { bg: 'rgba(245,158,11,.12)',  color: 'rgba(245,158,11,.9)',  border: 'rgba(245,158,11,.3)'  },
  'emotion-angry':    { bg: 'rgba(239,68,68,.12)',   color: 'rgba(239,68,68,.9)',   border: 'rgba(239,68,68,.3)'   },
  'emotion-sad':      { bg: 'rgba(167,139,250,.12)', color: 'rgba(167,139,250,.9)', border: 'rgba(167,139,250,.3)' },
  'emotion-neutral':  { bg: 'rgba(128,128,128,.08)', color: 'rgba(180,180,180,.9)', border: 'rgba(128,128,128,.2)' },
  'emotion-unknown':  { bg: 'rgba(128,128,128,.06)', color: 'rgba(160,160,160,.7)', border: 'rgba(128,128,128,.15)'},
};
const _CAP_QLABEL_DESC = {
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
  '기기':'개인용 디지털 디바이스(스마트폰·태블릿·노트북 등)',
  '도구':'범용 작업 도구',
  '고급':'고급 또는 특수 제작 장비',
  '파손':'손상된 장비',
  '낡음':'오래되거나 노후화된 물품',
};
function _capQlabel(name) {
  const t = name.toLowerCase();
  if (/폭탄|수류탄|지뢰|독가스|방사|폭발물|화염/.test(t)) return { label:'위험', color:'#c06040' };
  if (/권총|소총|기관총|산탄총|저격|리볼버|피스톨|총기|도검|칼날|단검|장검|검|창|활|석궁|무기|병기|총|채찍|도끼|망도|나이프|대거|블레이드|도\b/.test(t)) return { label:'무기', color:'#a04060' };
  if (/방패|갑옷|갑주|방탄|헬멧|투구|흉갑|보호복|방어/.test(t)) return { label:'방어', color:'#8060a0' };
  if (/주사기|의약|약품|약제|붕대|치료|치유|해독|진통|수혈|백신|혈청|농축액|수액|포션|엘릭서|의료|영양제|억제/.test(t)) return { label:'의료', color:'#40a060' };
  if (/데이터|메모리|큐브|슬롯|칩|코드|디스크|파일|정보|수첩|서류|지도|사전|기록|문서|책|태블릿|기록기/.test(t)) return { label:'정보', color:'#5060a0' };
  if (/진혼|향로|제기|제사|성수|봉헌|부적|주문서|의례|강신|무속|제물|제단|향불|봉납/.test(t)) return { label:'의식', color:'#9060a0' };
  if (/심령|강령|영매|초혼|귀신|유령|망령|사령|망자|혼령|기령|영계|귀령|혼백/.test(t)) return { label:'영적', color:'#7050a0' };
  if (/청음기|청음|음향기|공명기|청진기|방울|심벌|타악기|현악기/.test(t)) return { label:'음향', color:'#4070a0' };
  if (/의수|의족|기계팔|보조지체|의체/.test(t)) return { label:'기계', color:'#507080' };
  if (/군용|군사|군장|군복|군비|탄약|포탄/.test(t)) return { label:'군용', color:'#5080a0' };
  if (/스마트폰|휴대폰|핸드폰|태블릿|노트북|패드|아이폰|갤럭시|아이패드|랩탑|랩톱|폰\b/.test(t)) return { label:'기기', color:'#3a6a80' };
  if (/장비|기기|장치|기계|전자|통신|송신|수신|센서|드론|로봇|컴퓨터|단말|스캐너|배양기|정화기|필터|마스크|안대|렌즈|고글|바이저/.test(t)) return { label:'장비', color:'#307080' };
  if (/도구|공구|렌치|망치|드라이버|열쇠|자물쇠|가방|배낭|상자|음차|진동|로프|줄|채집|지팡이|테더|케이블|와이어|줄|묶/.test(t)) return { label:'도구', color:'#607040' };
  if (/고급|특제|개조|정밀|희귀|커스텀|첨단|특수/.test(t)) return { label:'고급', color:'#5080c8' };
  if (/파손|손상|고장|불량|망가|반파|부서/.test(t)) return { label:'파손', color:'#888' };
  if (/낡은|낡아|오래된|아날로그|노후|녹슨|구식/.test(t)) return { label:'낡음', color:'#8a7a50' };
  if (typeof _itemVocab !== 'undefined' && _itemVocab[name]) return { label: _itemVocab[name].badge_label, color: _itemVocab[name].color };
  return null;
}
function _capBadge(text, colors) {
  return `<span style="display:inline-block;border-radius:8px;padding:.06em .5em;font-size:.8em;font-weight:500;line-height:1.5;white-space:nowrap;background:${colors.bg};color:${colors.color};border:1px solid ${colors.border};">${text}</span>`;
}
function _capPhysBadgesHtml(p) {
  const its = _splitPhysState(p || '정상');
  if (its.length === 1) return _capBadge(its[0], _CAP_PHYS_COLOR[_physClass(its[0])] ?? _CAP_PHYS_COLOR['phys-other']);
  return `<span style="display:flex;flex-wrap:wrap;gap:3px 4px;align-items:flex-start;">${
    its.map(item => _capBadge(item, _CAP_PHYS_COLOR[_physClass(item)] ?? _CAP_PHYS_COLOR['phys-other'])).join('')
  }</span>`;
}
function _capEmotBadgesHtml(e) {
  const keywords = _splitEmotState(e);
  return `<span style="display:inline-flex;flex-wrap:wrap;gap:3px 4px;">${
    keywords.map(k => {
      const ec = _CAP_EMOT_COLOR[_emotionClass(k)] ?? _CAP_EMOT_COLOR['emotion-neutral'];
      return _capBadge(k, ec);
    }).join('')
  }</span>`;
}

// 캡처+ 스타일 인물 카드 — 본문 하단 ep-end + 캡처 양쪽 공유.
// opts.extraClass: 추가 wrapper class (예: 'scene-char-item ep-end-card')
// opts.dataChar:   true이면 data-char 속성 추가 (출력 동기화)
// opts.fontScale:  outer font-size 배율 (rem 단위). 기본 1, 본문 하단은 1.15로 키움.
//                  내부는 모두 em 단위라 outer font-size에 비례 스케일.
function _buildCapStyleCharCardHtml(s, opts = {}) {
  const gColor = _CAP_GENDER_COLOR[s.gender] ?? 'var(--text4)';
  const gLabel = s.gender && s.gender !== '해당없음' ? s.gender : '';
  const nameDisplay = s.is_new_character
    ? `${s.character_name} <span class="scene-char-new-tag">???</span>`
    : s.character_name;

  const isFantasyGenre = (typeof settingVals !== 'undefined' && settingVals.some(v => /판타지|이세계|무협|헌터|게임|마법|던전|신화|RPG|다크/i.test(v)));

  const stateRow = (lbl, valHtml) =>
    `<div style="display:flex;gap:.35em;font-size:.78em;margin-top:3px;align-items:flex-start;">
      <span style="color:var(--text4);min-width:1.6em;flex-shrink:0;">${lbl}</span>
      <span>${valHtml}</span>
    </div>`;

  const _capDescFallback = name => {
    const ql = _capQlabel(name);
    return (ql && _CAP_QLABEL_DESC[ql.label]) ?? null;
  };

  const itemsHtml = (s.items ?? []).map(it => {
    const rawName    = typeof it === 'string' ? it : (it.name ?? '');
    const grade      = typeof it === 'object' ? it.grade       : null;
    const cond       = typeof it === 'object' ? it.condition   : null;
    const desc       = typeof it === 'object' ? it.description : null;
    const hiddenNote = typeof it === 'object' ? it.hidden_note : null;
    // POST-1 §S10 reopen-4 — server LLM 분류 결과(it.category / it.badge_label) 우선.
    // 사장 정책: 키워드 if문 추가 금지. 미매칭은 LLM 분류 + vocab 누적으로 처리.
    const itemBadgeLabel = typeof it === 'object' ? (it.badge_label ?? null) : null;
    const itemCategory   = typeof it === 'object' ? (it.category   ?? null) : null;
    const _pm = rawName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    let displayName = rawName, inferredDesc = null;
    if (_pm && !/^[SABCD]$|^[SABCD][급등]\b/.test(_pm[2].trim()) && /있음|됨|있는|된|숨겨|보관|파손|고장|작동|꺼|켜|잠|열|닫/.test(_pm[2])) {
      displayName = _pm[1].trim(); inferredDesc = _pm[2].trim();
    }
    const effectiveDesc = desc || inferredDesc || _capDescFallback(displayName);
    const showGrade = isFantasyGenre && grade;
    const gc2 = showGrade ? (_CAP_GRADE_COLOR[grade] ?? '#888') : null;
    // 카테고리 결정 우선순위:
    //   1. server item.badge_label / item.category (LLM이 item_desc.ts에서 분류한 결과,
    //      char_states emit 시 함께 전달되거나 canonical_characters.initial_items에 보존)
    //   2. _capQlabel(displayName) — 안에 _itemVocab DB lookup + 키워드 fallback 포함
    //   3. 그래도 없으면 ql=null → 배지 미표시
    let ql = null;
    if (!showGrade) {
      const serverLabel = itemBadgeLabel ?? itemCategory;
      if (serverLabel && serverLabel !== '기타') {
        const CAT_COLOR = {
          무기:'#a04060', 방어구:'#8060a0', 도구:'#607040', 소모품:'#40a060',
          문서:'#5060a0', 마법:'#9060a0', 통신:'#307080', 전자:'#307080',
          기기:'#3a6a80', 의복:'#7060a0', 식량:'#60a060', 귀중품:'#c08030',
          악기:'#9060a0', 탈것:'#5080a0', 기타:'#888',
        };
        ql = { label: serverLabel, color: CAT_COLOR[itemCategory] ?? CAT_COLOR[itemBadgeLabel] ?? '#888' };
      } else {
        ql = _capQlabel(displayName);
      }
    }
    const borderColor = showGrade ? gc2 : (ql?.color ?? 'rgba(128,128,128,.3)');
    return `<div class="cap-item-row" style="border-left:2px solid ${borderColor};padding:2px 0 2px 6px;margin-top:3px;">
      <div style="font-size:.78em;font-weight:600;color:var(--text);display:flex;align-items:center;gap:.3em;">
        ${showGrade ? `<span style="font-size:.85em;font-weight:700;color:${gc2};border:1px solid ${gc2};border-radius:3px;padding:0 .3em;">${grade}</span>` : (ql ? `<span style="font-size:.85em;font-weight:600;color:${ql.color};border:1px solid ${ql.color}44;border-radius:3px;padding:0 .3em;background:${ql.color}18;">${ql.label}</span>` : '')}
        ${displayName}
      </div>
      ${cond       ? `<div style="font-size:.72em;display:flex;gap:.4em;align-items:flex-start;"><span style="color:var(--text4);letter-spacing:.04em;white-space:nowrap;flex-shrink:0;">상태:</span><span style="color:var(--text2);font-size:.95em;word-break:keep-all;overflow-wrap:break-word;">${cond}</span></div>` : ''}
      ${effectiveDesc ? `<div style="font-size:.72em;display:flex;gap:.4em;align-items:flex-start;"><span style="color:var(--text4);letter-spacing:.04em;white-space:nowrap;flex-shrink:0;">설명:</span><span style="color:var(--text2);font-size:.95em;word-break:keep-all;overflow-wrap:break-word;">${effectiveDesc}</span></div>` : ''}
      ${hiddenNote ? `<div style="font-size:.72em;display:flex;gap:.4em;align-items:flex-start;"><span style="color:var(--text4);letter-spacing:.04em;white-space:nowrap;flex-shrink:0;">위치:</span><span style="color:var(--text2);font-size:.95em;word-break:keep-all;overflow-wrap:break-word;">${hiddenNote}</span></div>` : ''}
    </div>`;
  }).join('');

  const rows = [
    stateRow('감정', _capEmotBadgesHtml(s.emotional_state)),
    stateRow('신체', _capPhysBadgesHtml(s.physical_state || '정상')),
    (s.items?.length
      ? `<div style="margin-top:4px;"><div style="font-size:.72em;color:var(--text4);">소지</div>${itemsHtml}</div>`
      : stateRow('소지', '<span style="color:var(--text4);font-style:italic;">빈손</span>')),
  ].join('');

  const cls       = `cap-char-card${opts.extraClass ? ' ' + opts.extraClass : ''}`;
  const dataAttr  = opts.dataChar ? ` data-char="${s.character_name}"` : '';
  // POST-1 §S10 reopen-2:
  //   - outer font-size = ${fsRoot}rem로 설정 → 내부 em 단위 폰트 비례 스케일.
  //   - height:100%; box-sizing:border-box → grid align-items:stretch와 호환,
  //     같은 row 카드들이 가장 큰 카드 높이에 맞춰 통일.
  const fsRoot = `${opts.fontScale ?? 1}rem`;
  return `<div class="${cls}"${dataAttr} style="background:var(--bg2);border-radius:10px;padding:.75rem 1rem;border:1px solid var(--border);font-size:${fsRoot};height:100%;box-sizing:border-box;">
    <div style="font-size:.95em;font-weight:700;color:${gColor};margin-bottom:.5em;">${nameDisplay}${gLabel ? ` <span style="font-size:.78em;opacity:.6;font-weight:400;">${gLabel}</span>` : ''}</div>
    ${rows}
  </div>`;
}

// Phase 4.20 R5A — 등장 인물 표시 정책. server appeared_in_episode 우선, fallback은 본문 substring + 명시 미등장 제외.
function _isAppearedForDisplay(s, outputText) {
  if (!s || !s.character_name) return false;
  if (typeof s.appeared_in_episode === 'boolean') return s.appeared_in_episode;
  if (s.visibility_state === 'absent') return false;
  if (s.location === '미등장') return false;
  return (outputText || '').includes(s.character_name);
}

function updateSceneCharPanel(charStates) {
  // 전역 상태 갱신
  _currentCharStates = charStates;
  _charStateMap = Object.fromEntries(charStates.map(s => [s.character_name, s]));

  // Phase 4.19 — 본문 하단 회차 종료 카드도 함께 갱신
  try { renderEpisodeEndCharCards(charStates); } catch (e) { console.debug('[ep-end-cards] render error', e); }

  const panel = document.getElementById('sceneCharPanel');
  const list  = document.getElementById('sceneCharList');
  if (!panel || !list) return;

  // Phase 4.20 R5A — appeared_in_episode 우선, 없으면 기존 fallback.
  const outputText = document.getElementById('output')?.textContent ?? '';
  const visible = charStates.filter(s => _isAppearedForDisplay(s, outputText));
  if (!visible.length) {
    panel.hidden = false;
    list.innerHTML = '<div class="scene-char-empty" style="opacity:.55;font-size:.85em;padding:6px 4px;">이번 화에 표시할 인물 정보가 없습니다.</div>';
    return;
  }

  // Phase 4.19 — 사이드바는 이름 + 성별만 표시 (감정·신체·소지품·위치는 본문 하단 카드로 이동)
  // 독서 중 미래 시점 정보가 노출되어 발생하는 스포일러/몰입 저하를 방지한다.
  list.innerHTML = visible.map(s => {
    const gColor = _GENDER_COLOR[s.gender] ?? 'var(--text4)';
    const gLabel = s.gender && s.gender !== '해당없음' ? s.gender : '';
    const nameDisplay = s.is_new_character
      ? `${s.character_name} <span class="scene-char-new-tag">???</span>`
      : s.character_name;
    return `<div class="scene-char-min" data-char="${s.character_name}">
      <span class="scene-char-dot" style="background:${gColor}"></span>
      <span class="scene-char-name" style="color:${gColor}">${nameDisplay}</span>
      ${gLabel ? `<span class="scene-char-gender" style="color:${gColor};opacity:.65">${gLabel}</span>` : ''}
    </div>`;
  }).join('');
  panel.hidden = false;
}

// Phase 4.19 — 본문 하단 회차 종료 인물 카드 렌더
// 사이드바에서 쓰던 확장/축소형 detailed 카드(소지품 카드 포함)를 그대로 사용,
// auto-fit grid (2~3열). 생성 중에는 절대 노출하지 않는다 — 재생성·다음화 생성 모두.
function renderEpisodeEndCharCards(charStates) {
  const wrap = document.getElementById('episodeEndCards');
  if (!wrap) return;
  // 재생성 / N화 생성 진행 중이면 카드 영역을 비워두고 종료
  if (_generating) { wrap.hidden = true; wrap.innerHTML = ''; return; }

  const outputText = document.getElementById('output')?.textContent ?? '';
  // Phase 4.20 R5A — appeared_in_episode 우선. carry-forward는 미표시.
  const visible = (charStates || []).filter(s => _isAppearedForDisplay(s, outputText));
  if (!visible.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }

  // R5A-C v5 — 인물 수 기반 명시적 grid columns. 모든 인원수에서 카드 350px 보장.
  //   1명  → 1 column 350px (가운데)
  //   2명  → 2 columns × 350px (가운데)
  //   3+   → 3 columns × 350px (본문보다 넓지만 카드 가독성 우선). 4명이면 3+1.
  const n = visible.length;
  let gridStyle;
  if (n === 1) {
    gridStyle = 'grid-template-columns:350px;';
  } else if (n === 2) {
    gridStyle = 'grid-template-columns:repeat(2,350px);';
  } else {
    gridStyle = 'grid-template-columns:repeat(3,350px);';
  }

  // 마지막 row에 단독 카드(예: 4명 시 4번째)는 가운데 column으로 보내 비대칭 방지.
  const cardsHtml = visible.map((s, idx) => {
    const html = _buildSceneCharDetailedCardHtml(s);
    // 3-col layout에서 마지막 카드가 row의 첫 cell에만 위치하면 빈 column이 우측에 보임 → 가운데로.
    if (n >= 3 && (idx === n - 1) && (n % 3 === 1)) {
      // 마지막 단독 카드 → 2번째 column에 배치. reopen-2: 카드의 inline style 안에
      // 직접 grid-column을 추가 (별도 style attr 추가 시 동일 attr 중복으로 background/border가 무시됨).
      return html.replace('style="background:var(--bg2)', 'style="grid-column:2;background:var(--bg2)');
    }
    return html;
  }).join('');

  wrap.innerHTML = `
    <div class="ep-end-title">현재 인물 상태</div>
    <div class="ep-end-grid" style="${gridStyle}">${cardsHtml}</div>
  `;
  wrap.hidden = false;
}

// POST-1 §S10 reopen — 본문 하단 ep-end-card는 캡처와 동일 presentational renderer 사용.
// _buildCapStyleCharCardHtml에 verify-호환 wrapper class만 추가로 부여.
// 항상 펼침, toggle/chevron 없음, 소지품 상세(상태·설명·위치) 기본 노출.
// reopen-3: fontScale 1.3 — 사장 피드백 "글씨 크기 좀 더 키워줘".
function _buildSceneCharDetailedCardHtml(s) {
  return _buildCapStyleCharCardHtml(s, {
    extraClass: 'scene-char-item ep-end-card',
    dataChar:   true,
    fontScale:  1.3,
  });
}

// Phase 4.19 — legacy 확장형 사이드바 본문은 _buildSceneCharDetailedCardHtml로 위임.
// 이후 다른 흐름에서 사이드바를 detailed로 되돌리고 싶을 때 그대로 사용 가능.
function _legacyUpdateSceneCharPanelDetailed(charStates) {
  _currentCharStates = charStates;
  _charStateMap = Object.fromEntries(charStates.map(s => [s.character_name, s]));
  const panel = document.getElementById('sceneCharPanel');
  const list  = document.getElementById('sceneCharList');
  if (!panel || !list) return;
  const outputText = document.getElementById('output')?.textContent ?? '';
  const visible = charStates.filter(s => {
    if (s.visibility_state === 'absent') return outputText.includes(s.character_name);
    return true;
  });
  if (!visible.length) { panel.hidden = true; return; }
  list.innerHTML = visible.map(_buildSceneCharDetailedCardHtml).join('');
  panel.hidden = false;
}
// 소지품 카드 확장/축소 — 기본 펼침, 클릭으로 접기
function toggleItemCard(card) {
  card.classList.toggle('collapsed');
}

// [8] 카드 확장/압축 토글 — 기본 펼침, 클릭 시 접힘
function toggleCharCard(header) {
  const item = header.closest('.scene-char-item');
  if (!item) return;
  item.classList.toggle('collapsed');
}

function wrapCharNamesInOutput(charStates) {
  const outputEl = document.getElementById('output');
  if (!outputEl) return;
  // 이미 wrapping 되어 있으면 재진입 금지
  if (outputEl.querySelector('.char-name-ref')) return;
  const names = charStates.map(s => s.character_name).filter(n => n && n.length >= 2);
  if (!names.length) return;
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'g');
  // Phase 4.19 — hover 카드 기능 제거. 성별별 밑줄 색만 유지.
  // border-bottom-color: 성별 색상 + 20 (alpha)으로 은은한 밑줄.
  outputEl.querySelectorAll('p, li, blockquote, h1, h2, h3').forEach(el => {
    el.innerHTML = el.innerHTML.replace(regex, m => {
      const s = _charStateMap[m];
      const gColor = s ? (_GENDER_COLOR[s.gender] ?? '') : '';
      const style = gColor ? ` style="border-bottom-color:${gColor}cc"` : '';
      return `<span class="char-name-ref" data-char="${m}"${style}>${m}</span>`;
    });
  });
}

// 기존 책 로드 시 char_states 없을 때 맵만 채움 (패널 표시 없이)
function seedCharStateMapFromGenderMap(charStates) {
  charStates.forEach(s => { _charStateMap[s.character_name] = s; });
  _currentCharStates = charStates;
  wrapCharNamesInOutput(charStates);
}

// Phase 4.19 — hover 리스너 완전 제거. 본문 인물명은 성별 밑줄 색만 갖고,
// 인물 상세는 본문 하단 Episode End Character Cards에서 확인한다.
// charHoverCard DOM은 남아 있을 수 있으나 영구 hidden 처리.
function _ensureHoverListener() {
  const card = document.getElementById('charHoverCard');
  if (card) card.hidden = true;
}

let _auditPollTimer = null;
let _auditCurrentEpisode = null;

// ── 품질 리포트 업데이트 (사이드바 패널) ──────────────────────
function updateDebugMeta(meta, auditStatus = null) {
  if (!_debugMode) return;
  const a = auditStatus; // 단축
  // null = 아직 감사 결과 없음, {} = 복원 중이지만 audit 미완료
  const isPending = a === null || (a != null && Object.keys(a).length === 0 && !a.status);

  // 배지 & 감사 상태
  const scoreBadge  = document.getElementById('rpDebugBadge');
  const auditStatEl = document.getElementById('eqAuditStatus');
  if (auditStatEl) auditStatEl.textContent = isPending ? '⏳ 감사 진행 중…' : '';
  if (scoreBadge) {
    if (a?.score != null) {
      scoreBadge.textContent = a.score + '점';
      scoreBadge.className = 'rp-debug-badge ' + (a.score >= 70 ? 'good' : a.score >= 40 ? 'warn' : 'bad');
    } else {
      scoreBadge.textContent = isPending ? '…' : '';
      scoreBadge.className = 'rp-debug-badge';
    }
  }

  // 헬퍼
  const rc = r => r == null ? '' : r >= 0.7 ? 'ok' : r >= 0.4 ? 'warn' : 'bad';
  const sc = s => s == null ? '' : s >= 70 ? 'ok' : s >= 40 ? 'warn' : 'bad';
  const ms = v => v != null ? (Math.round(v / 100) / 10) + 's' : null;
  const kv = (k, v, cls) => v != null && v !== ''
    ? `<div class="eq-kv"><span class="eq-kv-key">${k}</span><span class="eq-kv-val${cls ? ' '+cls : ''}">${v}</span></div>` : '';
  const kv2 = (k, v, cls) => v != null && v !== ''
    ? `<div class="eq-kv"><span class="eq-kv-key">${k}</span><span class="eq-kv-val${cls ? ' '+cls : ''}">${v}</span></div>` : '';
  const show = id => { const el = document.getElementById(id); if (el) el.hidden = false; };
  const pill = (txt, cls) => `<span class="eq-pill${cls ? ' '+cls : ''}">${txt}</span>`;

  // ── 기본 정보 ──────────────────────────────────────────────
  const basicEl = document.getElementById('eqBasicInfo');
  if (basicEl) {
    const gc = a?.gen_config ?? meta?.gen_config;
    // 사용자가 설정한 값 (episodeLength ±episodeLengthVar)
    const userRange = gc && gc.episodeLength != null
      ? (gc.episodeLengthVar != null
          ? `${gc.episodeLength}자 ±${gc.episodeLengthVar}자`
          : `${gc.episodeLength}자 (±미설정)`)
      : null;
    // 렌더러에 실제 전달된 목표값 (= episodeLength + round(var/2))
    const rendererTarget = a?.target_length ? a.target_length + '자' : null;
    // 평가 허용 범위 (min~max)
    const budgetRange = a?.char_budget
      ? `${a.char_budget.min}~${a.char_budget.max}자`
      : null;
    let rows = '';
    rows += kv('커스텀 분량 설정', userRange);
    rows += kv('본문 목표 분량', rendererTarget);   // 범위 중간점, 실제 프롬프트 전달값
    rows += kv('허용 범위', budgetRange);              // min~max
    rows += `<div class="eq-kv"><span class="eq-kv-key">실제 분량</span><span class="eq-kv-val" id="eqActualChars">${a?.actual_chars ? a.actual_chars + '자 (후처리 전)' : '—'}</span></div>`;
    rows += kv('생성 모델', a?.renderer_model ?? null);
    rows += kv('플래너 모델', a?.planner_model ?? null);
    // 회차 역할 / 서사 국면 한글 레이블 매핑
    const EPISODE_ROLE_KO = { intro:'도입', early:'초반', mid:'중반', late:'후반', 'pre-final':'최종 직전', final:'최종화' };
    const ARC_PHASE_KO    = { intro:'도입', early:'초반', mid:'중반', late:'후반', pre_final:'클라이맥스 직전', final:'결말', unknown:'미정' };
    const HOOK_TYPE_KO = {
      immediate_threat:    '즉각적 위협',
      unexpected_discovery:'예상 밖 발견',
      new_problem:         '새로운 문제 발생',
      unresolved_situation:'미완 상황',
      revelation:          '충격적 폭로',
      betrayal_hint:       '배신 암시',
      emotional_break:     '감정 폭발',
      ironic_reversal:     '아이러니한 반전',
      cliffhanger_choice:  '선택 기로',
      tender_moment:       '감동적 연결',
      ominous_calm:        '불길한 고요',
      memory_trigger:      '과거 기억 촉발',
      last_moment_failure: '마지막 순간 좌절',
      sudden_loss:         '갑작스러운 상실',
      alliance_shift:      '동맹 관계 역전',
      time_pressure:       '시간 압박',
    };
    rows += kv('POV', gc?.pov ?? null);
    rows += kv('문체', gc?.style ?? null);
    const _epRole = a?.episode_role ?? meta?.episode_role ?? null;
    rows += kv('이번 화 역할', _epRole ? (EPISODE_ROLE_KO[_epRole] ?? _epRole) : null);
    // 확정 최종화: SSE meta(신규 샘플) > audit(DB 저장값) > gen_config.totalEpisodes 순서
    const _resolvedFinal = meta?.resolved_final_episode ?? a?.resolved_final_episode ?? gc?.totalEpisodes;
    // 설정 범위 (totalEpisodes ± totalEpisodesVar)
    if (gc?.totalEpisodes != null) {
      const _var = gc.totalEpisodesVar ?? 0;
      rows += kv('설정 범위', _var ? `${gc.totalEpisodes} ± ${_var}화` : `${gc.totalEpisodes}화`);
    }
    if (_resolvedFinal != null) {
      const _curEp = a?.episode_number ?? meta?.episode_number ?? null;
      const _remaining = (_curEp && _resolvedFinal) ? _resolvedFinal - _curEp : (meta?.remaining_episodes ?? a?.remaining_episodes ?? null);
      const _rfMin = gc?.totalEpisodes != null ? (gc.totalEpisodes - (gc.totalEpisodesVar ?? 0)) : null;
      const _rfMax = gc?.totalEpisodes != null ? (gc.totalEpisodes + (gc.totalEpisodesVar ?? 0)) : null;
      const _rfOutOfRange = _rfMin != null && (_resolvedFinal < _rfMin || _resolvedFinal > _rfMax);
      let _finalTxt = `${_resolvedFinal}화`;
      if (_rfOutOfRange) _finalTxt += ` ⚠ 범위 밖 (허용: ${_rfMin}~${_rfMax}화)`;
      if (_curEp != null) _finalTxt += ` (현재 ${_curEp}화)`;
      rows += kv('확정 최종화', _finalTxt, _rfOutOfRange ? 'warn' : '');
      if (_remaining != null) rows += kv('남은 화수', _remaining + '화');
    } else {
      rows += kv('남은 화수', a?.remaining_episodes != null ? a.remaining_episodes + '화' : null);
    }
    const _arcPhase = a?.planner_arc_phase ?? null;
    rows += kv('전체 서사 위치', _arcPhase
      ? `${ARC_PHASE_KO[_arcPhase] ?? _arcPhase}${a?.planner_arc_ratio != null ? ' (' + a.planner_arc_ratio + '%)' : ''}` : null);
    rows += kv('엔딩 유형', a?.ending_constraint ?? null);
    if (a?.is_regen) rows += kv('재생성', '✓ regen_prev 주입됨', 'warn');
    const _hookRaw = a?.hook_type ?? meta?.hook_type ?? null;
    rows += kv('엔딩 훅 유형', _hookRaw ? (HOOK_TYPE_KO[_hookRaw] ?? _hookRaw) : null);
    rows += kv('장면 수', (a?.scene_beats_count ?? meta?.scene_beats_count) != null ? (a?.scene_beats_count ?? meta?.scene_beats_count) + '개' : null);
    rows += kv('장면 설계 판정', a?.plan_verdict ?? null);
    rows += kv('플랜 폴백', a?.fallback_used != null ? (a.fallback_used ? `있음${a.fallback_reason ? ': '+a.fallback_reason : ''}` : '없음') : null, a?.fallback_used ? 'warn' : '');
    rows += kv('수정 반복 횟수', a?.revision_count != null ? a.revision_count + '회' : meta?.revision_count != null ? meta.revision_count + '회' : null, (a?.revision_count ?? meta?.revision_count) > 0 ? 'warn' : '');
    rows += kv('생성 시간', ms(a?.renderer_ms));
    rows += kv('플래너 시간', ms(a?.planner_ms ?? meta?.planner_ms));
    rows += kv('품질 검사 시간', ms(a?.audit_ms));
    if (a?.combined_reward != null) rows += kv('종합 점수', a.combined_reward.toFixed(3), rc(a.combined_reward));
    if (a?.planner_reward != null)  rows += kv('플래너 보상', a.planner_reward.toFixed(3), rc(a.planner_reward));
    if (a?.renderer_reward != null) rows += kv('본문 보상', a.renderer_reward.toFixed(3), rc(a.renderer_reward));
    rows += kv('품질 판정', a?.verdict ?? null, a?.verdict === 'PASS' ? 'ok' : a?.verdict === 'WARN' ? 'warn' : a?.verdict === 'FAIL' ? 'bad' : '');
    if (a?.sft_eligible_renderer != null) {
      // episode_extended가 null이면 hard_gate 결과 미확정 — pending으로 표시 (오판 방지)
      const ee = a?.episode_extended;
      const gateKnown = ee != null;
      const gateFailed = gateKnown && ee.hard_gate_failed === true;
      let sftText, sftCls;
      if (!gateKnown) {
        sftText = '⏳ hard_gate 미확정 (audit 대기)';
        sftCls = 'warn';
      } else if (gateFailed) {
        sftText = '⛔ 부적합 (hard gate fail)';
        sftCls = 'bad';
      } else {
        sftText = (a.sft_eligible_renderer ? '✓ 렌더러' : '—') + (a.sft_eligible_planner ? ' ✓ 플래너' : '');
        sftCls = a.sft_eligible_renderer ? 'ok' : '';
      }
      rows += kv('학습 데이터 적합성', sftText, sftCls);
    }
    if (a?.has_rolling_summary != null) rows += kv('롤링요약', a.has_rolling_summary ? '있음' : '없음');
    if (a?.arc_summaries_count != null) rows += kv('아크 요약', a.arc_summaries_count + '개');
    if (a?.foreshadow_count != null)    rows += kv('복선 메모리', a.foreshadow_count + '개');
    if (a?.absent_characters?.length)  rows += kv('미등장 인물', a.absent_characters.join(', '));
    if (a?.trace_id) rows += kv('추적 ID', a.trace_id);
    if (a?.created_at) rows += kv('생성일시', new Date(a.created_at).toLocaleString('ko-KR'));
    basicEl.innerHTML = `<div class="eq-kv-list">${rows || '<span class="eq-empty">에피소드 생성 후 표시됩니다</span>'}</div>`;
    // 후처리 완료 텍스트 길이로 실제 분량 업데이트 (innerHTML 재생성 후 요소 접근)
    const _postText = document.getElementById('output')?.textContent?.trim() ?? '';
    const _actualEl2 = document.getElementById('eqActualChars');
    if (_actualEl2 && _postText) _actualEl2.textContent = _postText.length + '자';
  }

  // ── 품질 점수 바 ───────────────────────────────────────────
  const scoresEl = document.getElementById('eqQualityScores');
  if (scoresEl && a?.quality_scores && Object.keys(a.quality_scores).length) {
    const labels = {
      ending_hook:'엔딩 훅', plot_momentum:'플롯 모멘텀', prose_density:'산문 밀도',
      scene_clarity:'장면 명확성', pov_consistency:'POV 일관성', style_adherence:'문체 준수',
      world_rule_usage:'세계관 규칙', exposition_control:'설명 절제',
      character_consistency:'캐릭터 일관', intervention_adherence:'작가 개입 준수',
    };
    scoresEl.innerHTML = Object.entries(a.quality_scores).map(([k, v]) => {
      if (v == null) return `<div class="eq-score-row">
        <span class="eq-score-name">${labels[k] ?? k}</span>
        <div class="eq-score-bar-wrap"></div>
        <span class="eq-score-num" style="color:var(--text4)">—</span>
      </div>`;
      // quality_scores values are 0-100 (not 0-1); no scale conversion needed
      const pct = Math.min(100, Math.max(0, Number(v)));
      const cls = pct >= 70 ? 'good' : pct >= 40 ? 'warn' : 'bad';
      return `<div class="eq-score-row">
        <span class="eq-score-name">${labels[k] ?? k}</span>
        <div class="eq-score-bar-wrap"><div class="eq-score-bar ${cls}" style="width:${pct}%"></div></div>
        <span class="eq-score-num">${Math.round(pct)}</span>
      </div>`;
    }).join('');
    show('eqScoreSection');
  }

  // ── 플래너 breakdown ───────────────────────────────────────
  const plannerEl = document.getElementById('eqPlannerInfo');
  if (plannerEl && (a?.breakdown || a?.plan_issues?.length || a?.plan_passed_checks?.length)) {
    const bd = a.breakdown ?? {};
    let html = '<div class="eq-kv-list">';
    [['plan_structure', bd.plan_structure], ['hook_구체성', bd.hook_concreteness],
     ['ending_hook', bd.ending_hook], ['세계관 규칙', bd.world_rule_usage],
     ['작가개입 준수', bd.intervention_adherence], ['절대금지 페널티', bd.absolute_forbidden],
     ['hard_violation', bd.hard_violation], ['리비전 페널티', bd.revision_penalty],
    ].forEach(([k, v]) => { if (v != null) html += kv2(k, typeof v === 'number' ? v.toFixed(3) : v, rc(v)); });
    if (a.pov_violations?.length) {
      const povText = a.pov_violations.map(v => typeof v === 'string' ? v : (v.description ?? v.rule ?? JSON.stringify(v))).join(', ');
      html += kv2('POV 위반', povText, 'warn');
    }
    if (a.hard_violations?.length) {
      const hvItems = a.hard_violations.slice(0,5).map(v => {
        if (typeof v === 'string') return `<div class="eq-viol-item">${v}</div>`;
        const sev = v.severity ? `<span class="eq-pill bad">${v.severity}</span> ` : '';
        const loc = v.location ? ` <span style="color:var(--text4);font-size:.85em;">(${v.location})</span>` : '';
        return `<div class="eq-viol-item">${sev}${v.description ?? v.rule ?? ''}${loc}</div>`;
      }).join('');
      html += kv2('절대금지 위반', hvItems, 'bad');
    }
    // plan_issues
    if (a.plan_issues?.length) {
      html += `<div class="eq-kv" style="margin-top:.4rem;"><span class="eq-kv-key" style="font-weight:700">플랜 이슈</span></div>`;
      a.plan_issues.forEach(issue => {
        const cls = issue.severity === 'critical' ? 'bad' : issue.severity === 'major' ? 'warn' : '';
        html += kv2(`${issue.severity} · ${issue.field}`, issue.description, cls);
      });
    }
    if (a.plan_passed_checks?.length) {
      html += kv2('통과 체크', a.plan_passed_checks.length + '개', 'ok');
    }
    html += '</div>';
    plannerEl.innerHTML = html;
    show('eqPlannerSection');
  }

  // ── 경고 & 힌트 ─────────────────────────────────────────────
  const warnEl = document.getElementById('eqWarnings');
  if (warnEl && (a?.soft_warnings?.length || a?.revision_hints?.length)) {
    const _warnCard = (icon, cls, sev, text) => {
      const badge = sev ? `<span class="eq-sev-badge">[${sev}]</span> ` : '';
      const inner = `<span class="eq-warn-content">${icon} ${badge}${text}</span>`;
      return `<div class="eq-warn-item ${cls}">${inner}</div>`;
    };
    let items = '';
    (a.soft_warnings || []).forEach(w => {
      const text = typeof w === 'string' ? w
        : [w.description, w.suggestion ? `→ ${w.suggestion}` : null].filter(Boolean).join(' ');
      const sev = (typeof w === 'object' && w.severity) ? w.severity : '';
      items += _warnCard('⚠', 'soft', sev, text);
    });
    (a.revision_hints || []).forEach(h => {
      const text = typeof h === 'string' ? h : (h.description ?? JSON.stringify(h));
      items += _warnCard('💡', 'hint', '', text);
    });
    warnEl.innerHTML = `<div class="eq-warn-list">${items}</div>`;
    show('eqWarningSection');
  }

  // ── 작가 개입 & 제약 ───────────────────────────────────────
  const constrEl = document.getElementById('eqConstraints');
  if (constrEl) {
    const hasData = a?.active_interventions?.length || a?.absolute_forbidden?.length
      || a?.episode_forbidden?.length || a?.episode_required?.length;
    if (hasData) {
      let html = '<div class="eq-kv-list">';
      if (a.active_interventions?.length) {
        html += `<div class="eq-kv"><span class="eq-kv-key" style="font-weight:700">작가 개입</span></div>`;
        a.active_interventions.forEach((ins, i) => {
          const insText = typeof ins === 'string' ? ins : (ins?.text ?? ins?.description ?? JSON.stringify(ins));
          html += `<div class="eq-warn-item hint" style="margin-bottom:3px;">${i+1}. ${insText}</div>`;
        });
      }
      if (a.absolute_forbidden?.length) {
        html += `<div class="eq-kv" style="margin-top:.5rem;"><span class="eq-kv-key" style="font-weight:700">절대 금지</span></div>`;
        a.absolute_forbidden.forEach((r, i) => {
          const rText = typeof r === 'string' ? r : (r?.text ?? r?.description ?? JSON.stringify(r));
          html += `<div class="eq-warn-item hard" style="margin-bottom:3px;">${i+1}. ${rText}</div>`;
        });
      }
      if (a.episode_forbidden?.length) {
        const fmtArr = arr => arr.map(x => typeof x === 'string' ? x : (x?.text ?? x?.description ?? JSON.stringify(x)));
        html += kv2('이번화 금지', fmtArr(a.episode_forbidden).join(' / '), 'warn');
      }
      if (a.episode_required?.length) {
        const fmtArr = arr => arr.map(x => typeof x === 'string' ? x : (x?.text ?? x?.description ?? JSON.stringify(x)));
        html += kv2('이번화 필수', fmtArr(a.episode_required).join(' / '), 'ok');
      }
      html += '</div>';
      constrEl.innerHTML = html;
      show('eqConstraintSection');
    }
  }

  // ── 장면 계획 (scene beats) ────────────────────────────────
  const beatsEl = document.getElementById('eqBeats');
  const beats = a?.scene_beats ?? (meta?.scene_beats_count ? null : null);
  if (beatsEl && beats?.length) {
    beatsEl.innerHTML = beats.map(b => `
      <div class="eq-beat-item">
        <div class="eq-beat-num">Beat ${b.beat_number}</div>
        <div class="eq-beat-loc">${b.location ?? ''}</div>
        <div class="eq-beat-summary">${b.summary}</div>
        ${b.characters_involved?.length ? `<div class="eq-beat-chars">${b.characters_involved.join(', ')}</div>` : ''}
      </div>`).join('');
    if (a?.hook_payload || a?.hook_concrete_event) {
      beatsEl.innerHTML += `<div class="eq-beat-item eq-beat-hook">
        <div class="eq-beat-num">Hook · ${HOOK_TYPE_KO[a.hook_type] ?? a.hook_type ?? ''}</div>
        ${a.hook_payload ? `<div class="eq-beat-summary">${a.hook_payload}</div>` : ''}
        ${a.hook_concrete_event ? `<div class="eq-beat-loc">${a.hook_concrete_event}</div>` : ''}
      </div>`;
    }
    show('eqBeatsSection');
  }

  // ── 리비전 이력 ─────────────────────────────────────────────
  const revEl = document.getElementById('eqRevisions');
  if (revEl && a?.revision_traces?.length) {
    revEl.innerHTML = a.revision_traces.map(r => `
      <div class="eq-char-row">
        <div class="eq-char-name">Revision ${r.iteration}</div>
        <div class="eq-char-fields">
          ${r.verdict_before ? `<div class="eq-char-field"><b>이전 </b>${r.verdict_before}${r.score_before != null ? ' ('+r.score_before+')' : ''}</div>` : ''}
          ${r.verdict_after  ? `<div class="eq-char-field"><b>이후 </b>${r.verdict_after}${r.score_after != null ? ' ('+r.score_after+')' : ''}</div>` : ''}
          ${r.improved_rules?.length ? `<div class="eq-char-field" style="flex-basis:100%"><b>개선 규칙 </b>${r.improved_rules.join(', ')}</div>` : ''}
        </div>
      </div>`).join('');
    show('eqRevisionSection');
  }

  // ── 후처리 통계 ─────────────────────────────────────────────
  _renderPostprocStats();

  // ── Episode Reward v2 ────────────────────────────────────────
  const epRwEl = document.getElementById('eqEpisodeReward');
  if (epRwEl) {
    const ee = a?.episode_extended;
    const schemaVer = a?.reward_schema_version;
    let html = '<div class="eq-kv-list">';
    html += kv2('schema version', schemaVer ?? (isPending ? 'pending' : 'not computed'), schemaVer === '2.0' ? 'ok' : 'warn');
    if (ee) {
      html += kv2('hard_gate_failed', ee.hard_gate_failed != null ? (ee.hard_gate_failed ? '⛔ FAIL' : '✓ pass') : 'pending', ee.hard_gate_failed ? 'bad' : 'ok');
      if (ee.hard_gate_reasons?.length) {
        ee.hard_gate_reasons.forEach(r => { html += kv2('gate reason', r, 'bad'); });
      }
      html += kv2('episode_extended_score', ee.episode_extended_score != null ? ee.episode_extended_score.toFixed(3) : 'pending', rc(ee.episode_extended_score));
      [
        ['state_completeness',       ee.state_completeness],
        ['goal_progress',            ee.goal_progress],
        ['scene_purpose_clarity',    ee.scene_purpose_clarity],
        ['dialogue_distinctiveness', ee.dialogue_distinctiveness],
        ['emotional_causality',      ee.emotional_causality],
        ['consequence_visibility',   ee.consequence_visibility],
        ['narrative_density',        ee.narrative_density],
        ['ending_progress',          ee.ending_progress],
      ].forEach(([k, v]) => {
        html += kv2(k, v != null ? v.toFixed(3) : 'pending', v != null ? rc(v) : 'dim');
      });
      if (ee.postprocess_dependency_penalty != null) html += kv2('postprocess_penalty', ee.postprocess_dependency_penalty.toFixed(3), ee.postprocess_dependency_penalty < -0.05 ? 'warn' : '');
      if (ee.judge_uncertainty != null) html += kv2('judge_uncertainty', ee.judge_uncertainty.toFixed(3), ee.judge_uncertainty > 0.6 ? 'bad' : ee.judge_uncertainty > 0.35 ? 'warn' : 'ok');
    } else {
      html += `<div class="eq-empty">${isPending ? '⏳ audit 완료 후 표시' : 'not computed'}</div>`;
    }
    html += '</div>';
    epRwEl.innerHTML = html;
    if (ee || !isPending) show('eqEpisodeRewardSection');
  }

  // ── Trajectory Reward ────────────────────────────────────────
  const trajEl = document.getElementById('eqTrajectory');
  if (trajEl) {
    const t = a?.trajectory_summary;
    let html = '<div class="eq-kv-list">';
    if (t?.computed) {
      html += kv2('windows', t.window_count, '');
      html += kv2('mean_window_score', t.mean_window_score?.toFixed(3), rc(t.mean_window_score));
      html += kv2('pre_final_convergence', t.pre_final_convergence_score?.toFixed(3), rc(t.pre_final_convergence_score));
      html += kv2('includes_final', t.includes_final ? '✓' : '—', t.includes_final ? 'ok' : '');
      html += kv2('arc_phases', t.arc_phases?.join(', ') ?? '—', '');
      if (t.recent_size2_scores) {
        const s = t.recent_size2_scores;
        html += '<div class="eq-kv" style="margin-top:.5rem"><span class="eq-kv-key" style="font-weight:700">최근 size=2 윈도우</span></div>';
        [
          ['emotional_arc',    s.emotional_arc_consistency],
          ['goal_evolution',   s.goal_evolution],
          ['escalation',       s.escalation_curve],
          ['end_convergence',  s.ending_convergence],
          ['item_retention',   s.item_retention_consistency],
          ['loc_coherence',    s.location_transition_coherence],
          ['char_stability',   s.character_identity_stability],
          ['foreshadow_pres',  s.foreshadow_pressure],
          ['curiosity',        s.curiosity_retention],
          ['continuity',       s.continuity_recall],
          ['state_non_rep',    s.state_non_repetition],
        ].forEach(([k, v]) => { if (v != null) html += kv2(k, v.toFixed(3), rc(v)); });
        html += kv2('size=2 score', t.recent_size2_score?.toFixed(3), rc(t.recent_size2_score));
      }
    } else {
      const trajMsg = isPending ? '⏳ audit 완료 후 확인' : '미계산 — trajectory_rewards 데이터 없음<br><span style="color:var(--text4);font-size:.85em;">scripts/run_trajectory.ts 실행 필요</span>';
      html += `<div class="eq-empty">${trajMsg}</div>`;
    }
    html += '</div>';
    trajEl.innerHTML = html;
    if (t?.computed || !isPending) show('eqTrajectorySection');
  }

  // ── Ending / Closure Reward ──────────────────────────────────
  const endEl = document.getElementById('eqEnding');
  if (endEl) {
    const en = a?.ending_summary;
    let html = '<div class="eq-kv-list">';
    if (en?.computed) {
      html += kv2('final_closure_score', en.final_closure_score?.toFixed(3), rc(en.final_closure_score));
      html += kv2('resolved_final_ep', en.resolved_final_episode ?? '—', '');
      [
        ['ending_readiness',          en.ending_readiness],
        ['central_conflict_res',      en.central_conflict_resolution],
        ['foreshadow_payoff',         en.foreshadow_payoff_coverage],
        ['character_arc_res',         en.character_arc_resolution],
        ['emotional_resolution',      en.emotional_resolution],
        ['ending_proportionality',    en.ending_proportionality],
        ['ending_surprise_earned',    en.ending_surprise_earned],
      ].forEach(([k, v]) => { if (v != null) html += kv2(k, v.toFixed(3), rc(v)); });
      [
        ['premature_closure',         en.premature_closure_penalty],
        ['overextended_delay',        en.overextended_delay_penalty],
        ['unresolved_thread',         en.unresolved_critical_thread_penalty],
        ['deus_ex_machina',           en.deus_ex_machina_penalty],
      ].forEach(([k, v]) => { if (v != null && v !== 0) html += kv2(k, v.toFixed(3), 'bad'); });
      if (en.judge_summary) html += kv2('judge', en.judge_summary, '');
    } else {
      html += `<div class="eq-empty">${isPending ? '⏳ pending' : 'not computed — batch script 실행 필요'}</div>`;
    }
    html += '</div>';
    endEl.innerHTML = html;
    if (en?.computed || !isPending) show('eqEndingSection');
  }
}

// 긴 경고 텍스트를 요약+펼치기 형태로 축약 (maxLen 초과 시 <details> 사용)
function _compact(text, maxLen = 120) {
  if (!text || text.length <= maxLen) return text ?? '';
  const preview = text.slice(0, maxLen);
  const rest = text.slice(maxLen);
  return `${preview}<details><summary>…더 보기</summary>${rest}</details>`;
}

function _startAuditPolling(episodeNum) {
  if (_auditPollTimer) clearInterval(_auditPollTimer);
  _auditCurrentEpisode = episodeNum;
  _auditPollTimer = setInterval(async () => {
    if (!bookId || !_auditCurrentEpisode) return;
    try {
      const r = await fetch(`/api/generate/audit-status?book_id=${bookId}&episode=${_auditCurrentEpisode}`);
      const data = await r.json();
      if (data.status === 'done') {
        clearInterval(_auditPollTimer);
        _auditPollTimer = null;
        window._lastAuditStatus = data;
        updateDebugMeta(window._lastEpisodeMeta || {}, data);
      } else {
        // pending — 최신 trace가 아직 audit 중임을 헤더에 표시
        _markAuditPending(data.trace_id);
      }
    } catch {}
  }, 8000); // 8초마다 폴링
}

function _clearDebugPanels() {
  // 생성 시작 시 이전 화 데이터가 남아 보이지 않도록 모든 디버그 패널 초기화
  const empty = id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; };
  const hide  = id => { const el = document.getElementById(id); if (el) el.hidden = true; };
  // Phase 4.19 — 본문 하단 회차 종료 카드도 생성 중에는 노출 금지
  const epEnd = document.getElementById('episodeEndCards');
  if (epEnd) { epEnd.hidden = true; epEnd.innerHTML = ''; }
  const pending = '<div style="color:var(--text4);font-style:italic;padding:.4rem 0;">⏳ 생성 완료 후 표시</div>';
  const basicEl = document.getElementById('eqBasicInfo');
  if (basicEl) basicEl.innerHTML = pending;
  const ppEl = document.getElementById('eqPostproc');
  if (ppEl) ppEl.innerHTML = pending;
  hide('eqPostprocSection');
  const charEl = document.getElementById('eqCharStates');
  if (charEl) charEl.innerHTML = pending;
  empty('eqQualityScores');
  empty('eqPlannerInfo');
  empty('eqWarnings');
  empty('eqConstraints');
  empty('eqBeats');
  empty('eqRevisions');
  empty('eqEpisodeReward');
  empty('eqTrajectory');
  hide('eqScoreSection');
  hide('eqPlannerSection');
  hide('eqWarningSection');
  hide('eqConstraintSection');
  hide('eqBeatsSection');
  hide('eqRevisionSection');
  hide('eqEpisodeRewardSection');
  hide('eqTrajectorySection');
  hide('eqEndingSection');
  const badge = document.getElementById('rpDebugBadge');
  if (badge) { badge.textContent = ''; badge.className = 'rp-debug-badge'; }
  window._lastAuditStatus = null;
  window._lastEpisodeMeta = null;
  _currentCharStates = [];
  // 인물 정보 사이드 패널도 초기화
  const sceneList = document.getElementById('sceneCharList');
  if (sceneList) sceneList.innerHTML =
    '<div style="color:var(--text4);font-style:italic;padding:.4rem 0;font-size:.82em;">⏳ 생성 완료 후 표시</div>';
}

function _markAuditPending(traceId) {
  const el = document.getElementById('eqAuditStatus');
  if (!el) return;
  if (traceId) {
    el.textContent = `⏳ 현재 화 분석 중… (${traceId.slice(0,8)})`;
    el.style.color = 'var(--text3)';
  } else {
    el.textContent = '';
  }
}

function updateDebugCharStates(charStates) {
  const el = document.getElementById('eqCharStates');
  if (!el || !charStates?.length) return;
  el.innerHTML = `<div class="eq-char-grid">${charStates.map(s => {
    const absent = s.visibility_state === 'absent';
    const f = (label, val) => val ? `<div class="eq-char-field"><b>${label}: </b>${val}</div>` : '';
    const fields = [
      f('감정', s.emotional_state),
      f('위치', s.location),
      f('신체', s.physical_state || null),
      f('소지', s.items?.length
        ? s.items.map(it => typeof it === 'string' ? it : (it.condition ? `${it.name}(${it.condition})` : it.name)).join(', ')
        : '<span style="color:var(--text4);font-style:italic;">빈손</span>'),
      f('목표', s.recent_goal),
    ].join('');
    const typeTag = s.type ? ` <span style="font-weight:normal;color:var(--text4);font-size:.74em;">${s.type}·${s.gender??''}</span>` : '';
    const absentTag = absent ? ' <span style="font-size:.7em;color:var(--text4);">[미등장]</span>' : '';
    return `<div class="eq-char-row${absent ? ' eq-char-absent' : ''}">
      <div class="eq-char-name">${s.character_name}${typeTag}${absentTag}</div>
      <div class="eq-char-fields">${fields || '<span class="eq-char-field" style="color:var(--text4);font-style:italic;">상태 미기록</span>'}</div>
    </div>`;
  }).join('')}</div>`;
}

// ── 인라인 디버그 카드 토글 ────────────────────────────────────
let _debugClickCount = 0;
let _debugClickTimer = null;
let _debugMode = false;

function toggleDebugDrawer() {
  const rpSection = document.getElementById('rpDebugSection');
  const btn = document.getElementById('debugModeBtn');

  if (_debugMode) {
    _debugMode = false;
    if (rpSection) rpSection.hidden = true;
    btn?.classList.remove('active');
    _debugClickCount = 0;
    return;
  }

  // 연속 클릭 10회로 진입
  _debugClickCount++;
  clearTimeout(_debugClickTimer);
  _debugClickTimer = setTimeout(() => { _debugClickCount = 0; }, 2500);

  if (_debugClickCount >= 10) {
    _debugClickCount = 0;
    clearTimeout(_debugClickTimer);
    _debugMode = true;
    if (rpSection) rpSection.hidden = false;
    btn?.classList.add('active');
    // 최신 데이터로 패널 채우기
    if (_currentCharStates.length) updateDebugCharStates(_currentCharStates);
    // meta 없어도 항상 호출 → 기본 정보 섹션 placeholder 표시
    updateDebugMeta(window._lastEpisodeMeta || {}, window._lastAuditStatus ?? null);
    // audit 데이터가 없고 현재 화가 알려져 있으면 백그라운드 fetch
    if (!window._lastAuditStatus && typeof displayedEpisode !== 'undefined' && displayedEpisode) {
      _loadAndApplyCharStates(displayedEpisode);
    }
    // 패널 자동 열기 + 사이드바 스크롤
    const panel = document.getElementById('rpDebugPanel');
    if (panel) panel.hidden = false;
    const chevron = document.getElementById('rpDebugChevron');
    if (chevron) chevron.textContent = '▾';
    rpSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function toggleRpDebugPanel() {
  const panel   = document.getElementById('rpDebugPanel');
  const chevron = document.getElementById('rpDebugChevron');
  if (!panel) return;
  const opening = panel.hidden;
  panel.hidden = !opening;
  if (chevron) chevron.textContent = opening ? '▾' : '▸';
}

function toggleEqSection(labelEl) {
  const section = labelEl.closest('.eq-section');
  if (section) section.classList.toggle('collapsed');
}

function toggleDirectorPanel() {
  const panel = document.getElementById('directorFloatPanel');
  const btn   = document.getElementById('directorFloatBtn');
  if (!panel) return;
  const open = panel.classList.toggle('open');
  if (btn) btn.classList.toggle('active', open);
}

// ── 생성 중 로딩 애니메이션 ───────────────────────────────────
const _LOADING_MSGS = [
  "플래너가 이야기 구조를 설계하는 중...",
  "장면 배치와 인물 감정선을 조율하는 중...",
  "대사와 지문의 리듬을 조각하는 중...",
  "세계관 규칙을 검토하고 있는 중...",
  "복선과 긴장감을 배치하는 중...",
  "이야기가 완성되어 가는 중...",
];
let _loadingInterval = null;
let _loadingMsgIdx = 0;

function _makeLoadingHTML() {
  return `<div class="gen-loading-wrap" id="genLoadingWrap">
    <div class="gen-loading-dots"><span></span><span></span><span></span></div>
    <div class="gen-loading-msg" id="genLoadingMsg">${_LOADING_MSGS[0]}</div>
  </div>`;
}

// Phase 4.20 R5A — 활성 생성 책으로 복귀 시 stale DB 콘텐츠 대신 in-progress 상태 복원.
// selectBook이 호출. 진행 중 누적된 토큰이 있으면 그대로 표시, 없으면 loading UI.
window._fsRestoreActiveGenView = function() {
  const ag = window._fsActiveGen;
  const out = document.getElementById('output');
  if (!out || !ag || ag.status !== 'generating') return false;
  const accumulated = window._fsActiveGenText || "";
  if (accumulated) {
    // 이미 도착한 토큰이 있으면 즉시 렌더 (hybrid streaming 대응).
    try {
      _renderQueue = accumulated;
      _pacingUntil = 0;
      clearTimeout(_renderTimer);
      renderProgressiveRaw(accumulated, false);
    } catch (e) {
      out.textContent = accumulated;
    }
  } else {
    // 아직 토큰 없음 — loading UI 표시 + 메시지 애니메이션 재개.
    out.innerHTML = _makeLoadingHTML();
    try { _startLoadingAnim(); } catch (_) {}
  }
  // 본문 하단 ep-end card는 생성 중이므로 숨김 (이전 회차 카드 노출 차단).
  const _epEnd = document.getElementById('episodeEndCards');
  if (_epEnd) { _epEnd.hidden = true; _epEnd.innerHTML = ''; }
  return true;
};

function _startLoadingAnim() {
  _loadingMsgIdx = 0;
  clearInterval(_loadingInterval);
  _loadingInterval = setInterval(() => {
    _loadingMsgIdx = (_loadingMsgIdx + 1) % _LOADING_MSGS.length;
    const el = document.getElementById('genLoadingMsg');
    if (el) {
      el.style.opacity = '0';
      setTimeout(() => {
        if (el) { el.textContent = _LOADING_MSGS[_loadingMsgIdx]; el.style.opacity = '1'; }
      }, 300);
    } else {
      clearInterval(_loadingInterval);
    }
  }, 3500);
}

// ── 캡처 기능 ──────────────────────────────────────────────────
// 고해상도 PNG 캡처 + text/plain 병행 클립보드 복사
// scale = max(2, devicePixelRatio) cap 3 → 레티나/4K 환경에서 선명도 보장
// logical width 900px 고정 → 긴 콘텐츠는 세로로 늘어나고 글자 크기 유지
//
// mode 옵션:
//   'body'  (default) — 본문만 캡처. 인물카드가 있으면 패널에 [인물카드 복사하러 ›] 버튼 표시.
//   'chars'           — 인물카드만 캡처 (헤더 + 카드 그리드만). [인물카드 복사하러] 진입 시 사용.
async function captureEpisode(mode = 'body') {
  const outputEl = document.getElementById('output');
  if (!outputEl || !outputEl.textContent.trim()) {
    showToast('캡처할 내용이 없습니다.'); return;
  }
  if (typeof html2canvas === 'undefined') {
    showToast('캡처 라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.'); return;
  }
  const charsOnly = mode === 'chars';

  const btn = document.getElementById('captureBtnMain');
  const origLabel = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }

  // ── 오프스크린 컨테이너 (logical width 900px 고정) ──────────
  const LOGICAL_WIDTH = 900;
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:fixed', 'left:-9999px', 'top:0',
    `width:${LOGICAL_WIDTH}px`, 'background:var(--bg)', 'padding:52px 64px 64px',
    'font-family:inherit', 'color:var(--text)', 'line-height:2',
    'box-sizing:border-box', 'z-index:-1',
    'font-size:15px',  // 명시적 기준 font-size — html2canvas가 상속하도록
  ].join(';');

  // 헤더 — 책 제목 (1줄) / "n화 화 제목" (1줄). FINAL: 괄호 제거.
  const bookTitle = document.getElementById('outputBookTitle')?.textContent?.trim() ?? '';
  const epLabel   = document.getElementById('outputEpLabel')?.textContent?.trim() ?? '';
  const epTitle   = document.getElementById('outputEpTitle')?.textContent?.trim() ?? '';
  // ep label + title 한 줄로 합치기: "{n화} {화 제목}" — 둘 중 하나만 있어도 자연스럽게
  const epLineText = epLabel
    ? (epTitle ? `${epLabel} ${epTitle}` : epLabel)
    : (epTitle ?? '');
  wrap.innerHTML = charsOnly ? '' : `<div class="cap-header">
    ${bookTitle ? `<div class="cap-book-title">${bookTitle}</div>` : ''}
    ${epLineText ? `<div class="cap-ep-line">${epLineText}</div>` : ''}
  </div>`;

  // 본문 복제 + 대사 강조 (charsOnly일 때는 본문 생략)
  if (!charsOnly) {
    const bodyClone = outputEl.cloneNode(true);
    bodyClone.querySelectorAll('.focus-line').forEach(el => el.classList.remove('focus-line'));
    bodyClone.style.cssText = 'font-size:0.95rem;line-height:2.1;padding:0;color:var(--text);word-break:keep-all;overflow-wrap:break-word;';
    bodyClone.querySelectorAll('p.dialogue-line').forEach(p => {
      p.style.cssText = 'color:var(--strong);font-weight:500;border-left:3px solid rgba(180,100,80,.5);padding-left:0.9em;margin-left:0;';
    });
    wrap.appendChild(bodyClone);
  }

  // 본문 plain text (클립보드 text/plain 병행용 — body 모드일 때만 의미 있음)
  // charsOnly: 책/화 헤더와 본문 생략, 인물 상태 placeholder만
  const plainText = (() => {
    const lines = [];
    if (charsOnly) {
      lines.push('[현재 인물 상태]');
    } else {
      if (bookTitle) lines.push(bookTitle + (epLabel ? ' · ' + epLabel : ''));
      if (epTitle)   lines.push(epTitle);
      lines.push('');
      outputEl.querySelectorAll('p').forEach(p => { if (p.textContent.trim()) lines.push(p.textContent.trim()); });
    }
    return lines.join('\n');
  })();

  // 인물정보 섹션 — charsOnly이거나 (R5B-1.5 이전 호환) 등장 인물이 있을 때
  // body 모드는 본문만 캡처 → 패널에서 [인물카드 복사하러 ›] 버튼으로 chars 모드 재진입
  if (charsOnly && _currentCharStates?.length) {
    const outputText = outputEl.textContent ?? '';
    const appearing = _currentCharStates.filter(s =>
      s.visibility_state !== 'absent' || outputText.includes(s.character_name)
    );
    if (appearing.length) {
      const divider = document.createElement('div');
      // charsOnly 모드는 본문이 없으니 separator 없이 위쪽 여백만 약간
      divider.style.cssText = charsOnly
        ? 'margin-top:0;padding-top:0;'
        : 'margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid rgba(168,152,128,.2);';
      // POST-1 §S10 reopen — 캡처 카드도 본문 하단과 동일 shared renderer (_buildCapStyleCharCardHtml).
      divider.innerHTML = `<div style="font-size:.75rem;color:var(--text4);letter-spacing:.08em;margin-bottom:1rem;">등장 인물</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.75rem;">
          ${appearing.map(s => _buildCapStyleCharCardHtml(s)).join('')}
        </div>`;
      wrap.appendChild(divider);
    }
  }

  document.body.appendChild(wrap);

  // ── CSS 변수 → 실제 색상값 치환 ────────────────────────────
  // text/html 클립보드는 다른 앱에서 var(--xx)를 해석 못함 → 실제 값으로 치환
  const cs = getComputedStyle(document.documentElement);
  const CSS_VARS = {
    'var(--bg)':     cs.getPropertyValue('--bg').trim()    || '#111',
    'var(--bg2)':    cs.getPropertyValue('--bg2').trim()   || '#1a1a1a',
    'var(--bg3)':    cs.getPropertyValue('--bg3').trim()   || '#222',
    'var(--text)':   cs.getPropertyValue('--text').trim()  || '#e8e0d4',
    'var(--text2)':  cs.getPropertyValue('--text2').trim() || '#c8bfb0',
    'var(--text3)':  cs.getPropertyValue('--text3').trim() || '#a09080',
    'var(--text4)':  cs.getPropertyValue('--text4').trim() || '#706050',
    'var(--strong)': cs.getPropertyValue('--strong').trim()|| '#f0c87a',
    'var(--border)': cs.getPropertyValue('--border').trim()|| 'rgba(168,152,128,.18)',
  };

  function resolveVars(html) {
    return Object.entries(CSS_VARS).reduce((s, [k, v]) => s.replaceAll(k, v), html);
  }

  // ── text/html 클립보드 직렬화 ───────────────────────────────
  // Notion·Word·Docs·OneNote 등에 붙이면 HTML 그대로 렌더링 → 벡터급 선명도
  const bgColor = CSS_VARS['var(--bg)'];
  const capHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { margin:0; background:${bgColor}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .cap-header { margin-bottom:2.4rem; padding-bottom:1.2rem; border-bottom:1px solid rgba(168,152,128,.25); }
  .cap-book-title { display:block; font-size:1.55rem; font-weight:700; opacity:.9; letter-spacing:.04em; line-height:1.4; }
  .cap-ep-line { display:block; font-size:2.2rem; font-weight:800; margin-top:.55rem; line-height:1.35; color:${CSS_VARS['var(--strong)']}; }
  p { margin:.6em 0; line-height:2.1; color:${CSS_VARS['var(--text)']}; font-size:15px; word-break:keep-all; }
  p.dialogue-line { color:${CSS_VARS['var(--strong)']}; font-weight:500; border-left:3px solid rgba(180,100,80,.5); padding-left:.9em; }
</style>
</head><body>
<div style="max-width:800px;padding:48px 56px 64px;box-sizing:border-box;">
${resolveVars(wrap.innerHTML)}
</div></body></html>`;

  const label    = charsOnly ? '인물정보' : '텍스트';
  const filename = (n) => `${bookTitle || 'episode'}_${epLabel || ''}${charsOnly ? '_chars' : ''}${n ? '_p' + String(n).padStart(2,'0') : ''}.png`.replace(/\s+/g,'_');
  const done     = () => { document.body.removeChild(wrap); if (btn) { btn.disabled = false; btn.innerHTML = origLabel; } };

  // ── PNG 렌더 — CSS 변수 치환 DOM → html2canvas ──────────────
  const makePngCanvas = async () => {
    const scale   = 6;
    const pngWrap = document.createElement('div');
    pngWrap.style.cssText    = resolveVars(wrap.style.cssText);
    pngWrap.innerHTML        = resolveVars(wrap.innerHTML);
    pngWrap.style.background = bgColor;
    pngWrap.style.color      = CSS_VARS['var(--text)'];
    pngWrap.style.position   = 'fixed';
    pngWrap.style.left       = '-9999px';
    pngWrap.style.top        = '0';
    document.body.appendChild(pngWrap);
    const canvas = await html2canvas(pngWrap, { backgroundColor: bgColor, scale, useCORS: true, logging: false, width: 900 });
    // 단락/카드 분할 후보 위치 수집 — removeChild 전에 측정해야 레이아웃이 살아있음
    //
    // R5A-C 보강: 인물 카드(.cap-char-card) / 소지품 row(.cap-item-row)는 atomic block으로
    // 다뤄 페이지 경계에서 잘리지 않게 한다. bottom y만 후보로 쓰면 카드 가운데에서 잘림 →
    // TOP y도 후보로 추가해 카드/row를 통째로 다음 페이지로 보낼 수 있게 한다.
    const wrapTop = pngWrap.getBoundingClientRect().top;
    const ATOMIC_BLOCK = new Set(['cap-char-card', 'cap-item-row']);
    // R5A-C v6 — 본문 단락 + 카드 + 카드 내부 모든 div/span 배지 — 상태/소지품 영역의
    // 세부 div bottom도 split 후보로 등록해 "글자 기준 cut → 옆 배지 잘림" 방지.
    const els = Array.from(pngWrap.querySelectorAll(
      'p, .scene-para, .dialogue-line, .cap-char-card, .cap-item-row, ' +
      '.cap-char-card > div, .cap-char-card > div > div, .cap-item-row > div'
    ));
    const splitYs = [];
    // R5A-C v7 — 페이지 비어있음 검출용 contentTops: 실제 텍스트 콘텐츠가 있는 element의
    //   top y 모음. 페이지 [yStart, yEnd) 안에 contentTop이 하나도 없으면 그 페이지는 빈 영역.
    const contentTops = [];
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      const top    = Math.round((rect.top    - wrapTop) * scale);
      const bottom = Math.round((rect.bottom - wrapTop) * scale);
      // bottom y는 항상 split 후보 (단락/sub-row 끝).
      splitYs.push(bottom);
      // atomic block (카드/소지품 row)은 TOP y도 split 후보.
      const isAtomic = [...el.classList].some(c => ATOMIC_BLOCK.has(c));
      if (isAtomic) splitYs.push(top);
      // 콘텐츠 존재 신호: 텍스트가 있는 element만 contentTops에 등록.
      const hasText = (el.textContent || '').trim().length > 0;
      if (hasText) contentTops.push(top);
    }
    const splitCandidates = splitYs
      .filter(y => y > 0 && y < canvas.height)
      .sort((a, b) => a - b);
    const contentTopsSorted = contentTops
      .filter(y => y >= 0 && y < canvas.height)
      .sort((a, b) => a - b);
    document.body.removeChild(pngWrap);
    return { canvas, scale, splitCandidates, contentTops: contentTopsSorted };
  };

  // ── 페이지 분할 — 단락 경계 우선, fallback 고정 높이 ──────────
  // 이상적 분할선 근처의 마지막 단락 하단을 실제 분할점으로 사용해 글자 잘림 방지
  const PAGE_H = 5600;  // canvas 픽셀 기준 (logical 1400px × scale 4)
  // R5A-C v7 — sliceCanvas:
  //   1) splitCandidates로 단락 경계 우선 cut.
  //   2) 마지막 페이지에 실제 콘텐츠(contentTops 안의 element top y)가 하나도 없으면 → 빈 페이지 → 직전과 병합.
  //   하드코딩된 픽셀 임계 사용 안 함. 콘텐츠 element 기반 의미적 검출.
  const sliceCanvas = (canvas, splitCandidates = [], contentTops = []) => {
    const total = Math.ceil(canvas.height / PAGE_H);
    if (total === 1) return [canvas];
    // 페이지 분할 (yRanges)
    const ranges = [];
    let yStart = 0;
    for (let i = 0; i < total; i++) {
      const idealEnd = Math.min(yStart + PAGE_H, canvas.height);
      const SLACK = PAGE_H * 0.15;
      const minCut = yStart + PAGE_H * 0.4;
      const candidate = [...splitCandidates]
        .filter(y => y > minCut && y <= idealEnd + SLACK)
        .pop();
      const yEnd = (i === total - 1) ? canvas.height : (candidate ?? idealEnd);
      ranges.push({ yStart, yEnd });
      yStart = yEnd;
      if (yStart >= canvas.height) break;
    }
    // 마지막 페이지에 실제 콘텐츠 element가 시작되지 않으면 직전 페이지에 흡수.
    // (배경/여백만 있고 텍스트·카드가 없는 페이지를 의미적으로 검출.)
    if (ranges.length >= 2) {
      const last = ranges[ranges.length - 1];
      const hasContent = contentTops.some(y => y >= last.yStart && y < last.yEnd);
      if (!hasContent) {
        const prev = ranges[ranges.length - 2];
        ranges.splice(ranges.length - 2, 2, { yStart: prev.yStart, yEnd: last.yEnd });
      }
    }
    // canvas slice
    return ranges.map(r => {
      const pg = document.createElement('canvas');
      pg.width  = canvas.width;
      pg.height = r.yEnd - r.yStart;
      pg.getContext('2d').drawImage(canvas, 0, -r.yStart);
      return pg;
    });
  };

  // ── 다장 순차 복사 오버레이 ────────────────────────────────
  // R5A-C v8 — 페이지 nav: [이전] [복사하기] [다음], 닫기 X는 우상단.
  //   복사 상태는 페이지별 추적 (copiedSet) → 이전/다음 이동 후에도 상태 유지.
  //   이전 페이지로 돌아가서 다시 복사 가능 → 실수 시 닫고 재진입 불필요.
  const showPageCopyUI = (pages, opts = {}) => {
    // R5B-1.5 UI: 캡처 토글 통합 — body 모드에서 인물 카드가 있으면
    // [인물카드 복사하러 ›] 버튼을 추가해 chars 모드 전환을 유도.
    // opts.kind: 'body' | 'chars' (panel 헤더 표기 + 'go-chars' 버튼 활성 분기)
    // opts.onGoChars: chars 모드 진입 callback (body 모드에서만 의미)
    const kind = opts.kind ?? 'body';
    const isCharsKind = kind === 'chars';
    const showGoChars = !isCharsKind && typeof opts.onGoChars === 'function';
    const headerLabel = isCharsKind ? '인물 카드 순차 복사' : '본문 순차 복사';

    let idx = 0;
    const copiedSet = new Set();  // 복사 완료된 페이지 idx 모음

    const toBlob = (pg) => new Promise(res => pg.toBlob(res, 'image/png'));

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;font-family:inherit;';

    const panel = document.createElement('div');
    panel.style.cssText = 'position:relative;background:#1c1a17;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px 32px 26px;width:420px;box-shadow:0 12px 40px rgba(0,0,0,.9);';

    const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };

    const render = () => {
      const isFirst = idx === 0;
      const isLast  = idx === pages.length - 1;
      const copied  = copiedSet.has(idx);
      const allCopied = copiedSet.size === pages.length;
      const thumbUrl = pages[idx].toDataURL('image/png');
      // 색상 — 배경 #1c1a17 대비 가독성 충분
      panel.innerHTML = `
        <button id="_cap_close" aria-label="닫기" style="position:absolute;top:12px;right:12px;background:transparent;border:none;color:#a89880;font-size:1.5rem;line-height:1;cursor:pointer;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background .15s;">×</button>
        <div style="font-size:1.15rem;color:#d4c0a8;letter-spacing:.04em;margin-bottom:.9rem;font-weight:600;padding-right:32px;">${headerLabel} · <span style="color:#f4e4c8;">${idx+1}</span>번째 장 / 총 ${pages.length}장 ${allCopied ? '<span style="color:#22c55e;font-size:.9em;">· 모두 복사됨</span>' : ''}</div>
        <img src="${thumbUrl}" style="width:100%;border-radius:6px;border:1px solid rgba(255,255,255,.08);margin-bottom:1.1rem;display:block;">
        <div style="font-size:1.05rem;color:${copied?'#22c55e':'#c0a080'};margin-bottom:1.4rem;line-height:1.8;min-height:3.5em;">
          ${copied
            ? `<b style="color:#e8e0d4;">${idx+1}번째 장</b> 클립보드 복사 완료<br><span style="padding-left:1em;">바로 <kbd style="background:#2a2a2a;padding:.15em .5em;border-radius:4px;font-size:1rem;">Ctrl+V</kbd> 붙여넣기</span>`
            : `<span>${idx+1}번째 장 복사 대기 — 아래 [복사하기] 클릭</span>`}
        </div>
        <div style="display:flex;gap:.5rem;">
          <button id="_cap_prev" ${isFirst?'disabled':''} style="background:${isFirst?'#1f1d1a':'#2a2a2a'};border:none;border-radius:8px;padding:.7rem 1rem;color:${isFirst?'#555':'#c0a890'};font-size:1rem;cursor:${isFirst?'not-allowed':'pointer'};font-weight:600;">‹ 이전</button>
          <button id="_cap_copy" style="flex:1;background:${copied?'#3a4a35':'#c87840'};border:none;border-radius:8px;padding:.75rem;color:#fff;font-weight:700;font-size:1.05rem;cursor:pointer;">${copied?'다시 복사':`${idx+1}번째 장 복사하기`}</button>
          <button id="_cap_next" ${isLast?'disabled':''} style="background:${isLast?'#1f1d1a':'#2a2a2a'};border:none;border-radius:8px;padding:.7rem 1rem;color:${isLast?'#555':'#c0a890'};font-size:1rem;cursor:${isLast?'not-allowed':'pointer'};font-weight:600;">다음 ›</button>
        </div>
        ${showGoChars ? `<div style="margin-top:.9rem;"><button id="_cap_go_chars" style="width:100%;background:#3a3a4a;border:1px solid rgba(168,152,255,.3);border-radius:8px;padding:.7rem;color:#c8c0e8;font-size:.95rem;cursor:pointer;font-weight:600;">📋 인물 카드 복사하러 가기 ›</button></div>` : ''}`;

      const closeBtn = panel.querySelector('#_cap_close');
      if (closeBtn) {
        closeBtn.addEventListener('click', close);
        closeBtn.addEventListener('mouseenter', () => closeBtn.style.background = 'rgba(255,255,255,.08)');
        closeBtn.addEventListener('mouseleave', () => closeBtn.style.background = 'transparent');
      }
      panel.querySelector('#_cap_copy')?.addEventListener('click', async () => {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toBlob(pages[idx]) })]);
        copiedSet.add(idx);
        render();
      });
      panel.querySelector('#_cap_prev')?.addEventListener('click', () => {
        if (idx > 0) { idx--; render(); }
      });
      panel.querySelector('#_cap_next')?.addEventListener('click', () => {
        if (idx < pages.length - 1) { idx++; render(); }
      });
      panel.querySelector('#_cap_go_chars')?.addEventListener('click', () => {
        close();
        opts.onGoChars();  // showGoChars=true 일 때만 emit
      });
    };

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    render();
  };

  // ── 클립보드 복사 우선순위 ──────────────────────────────────
  // 1순위: PNG — 1장이면 클립보드, 여러 장이면 순차 다운로드
  // 2순위: text/html (Notion·Docs·Word)
  // 3순위: text/plain
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      const { canvas, splitCandidates, contentTops } = await makePngCanvas();
      const pages = sliceCanvas(canvas, splitCandidates, contentTops);
      console.debug('[capture]', { pages: pages.length, w: canvas.width, h: canvas.height, candidates: splitCandidates.length });

      // R5B-1.5: body 모드 + 인물 카드 등장 인물 있음 → showPageCopyUI에서
      //   [인물 카드 복사하러 ›] 버튼 노출. 단일 페이지여도 panel 띄움.
      const hasCharsAhead = !charsOnly && _currentCharStates?.length > 0 && _currentCharStates.some(s => {
        const txt = outputEl.textContent ?? '';
        return s.visibility_state !== 'absent' || txt.includes(s.character_name);
      });
      const onGoChars = hasCharsAhead
        ? () => { setTimeout(() => captureEpisode('chars'), 50); }
        : null;

      if (pages.length === 1 && !hasCharsAhead) {
        // 단일 페이지 + 인물 카드 진입 옵션 없음 → 클립보드 직접 복사
        const blob = await new Promise(res => pages[0].toBlob(res, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast(`클립보드에 복사됐습니다 (${label} · ${canvas.width}×${canvas.height}px)`);
      } else {
        // 여러 페이지 OR 인물 카드 진입 가능 → 순차 복사 오버레이
        showPageCopyUI(pages, {
          kind: charsOnly ? 'chars' : 'body',
          onGoChars,
        });
      }
      done(); return;
    } catch (e) {
      console.debug('[capture] PNG 실패, HTML fallback', e);
    }

    // 2순위: text/html (PNG 클립보드 미지원 환경 — Notion·Docs·Word)
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html':  new Blob([capHtml],   { type: 'text/html'  }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      })]);
      showToast(`클립보드에 복사됐습니다 (${label} · HTML)`);
      done(); return;
    } catch (e) {
      console.debug('[capture] HTML 실패, text/plain fallback', e);
    }
  }

  // 3순위: text/plain
  try {
    await navigator.clipboard.writeText(plainText);
    showToast('이미지 복사 미지원 — 텍스트로 복사됐습니다.');
    done(); return;
  } catch {
    try {
      const { canvas, splitCandidates, contentTops } = await makePngCanvas();
      const pages = sliceCanvas(canvas, splitCandidates, contentTops);
      for (let i = 0; i < pages.length; i++) {
        await new Promise(res => setTimeout(res, i === 0 ? 0 : 300));
        const a = document.createElement('a');
        a.href     = pages[i].toDataURL('image/png');
        a.download = filename(pages.length > 1 ? i + 1 : 0);
        a.click();
      }
      showToast(pages.length > 1 ? `${pages.length}장으로 분할 저장됐습니다.` : '파일로 저장됩니다.');
    } catch {
      showToast('캡처에 실패했습니다.');
    }
    done();
  }
}
