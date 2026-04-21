// ── 에피소드 생성 & SSE 스트리밍 ─────────────────────────────

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
      p.textContent = text.trimEnd() + " " + next.textContent.trimStart();
      next.remove();
      paras.splice(i + 1, 1);
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
  //   직선 " (U+0022): 모델이 빈번히 사용하나, 문장 내 강조에도 쓰여 오탐 가능
  //     → 직선은 단락 시작 위치에서만 대화로 인정 (applyDialogueStyle에서 처리)
  //     → splitDialogueNarration에서는 직선 따옴표 제외
  //   곡선 ' ' (U+2018/9): '스킬명', '강조' 등 단어 강조에도 쓰여 오탐 많음
  //     → 내용이 한 단어(공백 없음)이면 강조로 간주하고 분리하지 않음
  const OPEN_Q  = '\u201C\u300C\u300E';  // " 「 『  (곡선 작은따옴표 제외)
  const CLOSE_Q = '\u201D\u300D\u300F';  // " 」 』
  // 곡선 작은따옴표는 내용에 공백이 있을 때(문장)만 대화로 분리
  const SINGLE_DIAL_RE = /\u2018([^\u2019]*\s[^\u2019]*)\u2019/g;
  const DIAL_RE = new RegExp(
    '[' + OPEN_Q + ']([^' + CLOSE_Q + ']*)[' + CLOSE_Q + ']', 'g'
  );

  container.querySelectorAll("p").forEach(p => {
    const text = p.textContent;
    // 두 패턴을 합쳐 위치순으로 정렬 후 처리
    const matches = [];
    let m;
    const re1 = new RegExp(DIAL_RE.source, "g");
    while ((m = re1.exec(text)) !== null) matches.push({ index: m.index, end: m.index + m[0].length, text: m[0] });
    const re2 = new RegExp(SINGLE_DIAL_RE.source, "g");
    while ((m = re2.exec(text)) !== null) {
      // 이미 DIAL_RE가 잡은 범위와 겹치지 않으면 추가
      if (!matches.some(x => m.index >= x.index && m.index < x.end)) {
        matches.push({ index: m.index, end: m.index + m[0].length, text: m[0] });
      }
    }
    matches.sort((a, b) => a.index - b.index);

    const parts = [];
    let lastIdx = 0;
    let found = matches.length > 0;

    for (const hit of matches) {
      const before = text.slice(lastIdx, hit.index).trim();
      if (before) parts.push({ type: "narr", text: before });
      parts.push({ type: "dial", text: hit.text.trim() });
      lastIdx = hit.end;
    }

    if (!found) return;

    const after = text.slice(lastIdx).trim();
    if (after) parts.push({ type: "narr", text: after });

    // 대사 + 지문 혼합 단락만 분리 (순수 대사 or 순수 지문은 그대로)
    if (parts.length < 2) return;

    const frag = document.createDocumentFragment();
    parts.forEach(pt => {
      const np = document.createElement("p");
      np.textContent = pt.text;
      if (pt.type === "dial") { np.classList.add("dialogue-line"); np.dataset.splitDialogue = "1"; }
      frag.appendChild(np);
    });
    p.replaceWith(frag);
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
  container.querySelectorAll("p:not(.dialogue-line)").forEach(p => {
    if (DIAL_START.test(p.textContent.trimStart())) p.classList.add("dialogue-line");
  });
  // 지문 단락의 불필요한 클래스 정리 (splitDialogue 마커 없고 따옴표로 시작 안 하면 제거)
  container.querySelectorAll("p.dialogue-line").forEach(p => {
    if (!p.dataset.splitDialogue && !DIAL_START.test(p.textContent.trimStart())) {
      p.classList.remove("dialogue-line");
    }
  });
}

function renderProgressiveRaw(text, done) {
  // [CLIFF] 구분자 제거 (서버가 스트리밍 중 전송하는 마커, 저장 텍스트에서 제거)
  // [CLIFF] 또는 [CLIFF (미닫힘) 제거 — 모델이 ] 없이 쓰는 경우 대응
  text = text.replace(/\[CLIFF[\]\n]?/g, "").replace(/\n{3,}/g, "\n\n");
  // 직선 따옴표 → 곡선 따옴표 변환 (모델이 " 사용 시 교정)
  // 1단계: 완전한 쌍 변환 (straight-straight 또는 straight-curlyclose)
  text = text.replace(/^"([^"\u201D\n]+)[\u201D"]$/mg, "\u201C$1\u201D")  // 단락 전체
             .replace(/"([^"\u201D\n]*[가-힣][^"\u201D\n]*)[\u201D"]/g, "\u201C$1\u201D"); // 인라인
  // 2단계: 쌍 변환 후 남은 단독 직선따옴표 교정 (단락 경계 기준)
  text = text.replace(/^"/mg, "\u201C")   // 단락 시작 직선 → 곡선 열림
             .replace(/"$/mg, "\u201D");  // 단락 끝 직선 → 곡선 닫힘
  const { title, body } = extractEpTitle(text);

  // 출력 헤더: 스트리밍 중에도 즉시 표시
  const header  = document.getElementById("outputHeader");
  const labelEl = document.getElementById("outputEpLabel");
  const titleEl = document.getElementById("outputEpTitle");
  if (header && displayedEpisode) header.style.display = "flex";
  if (labelEl && displayedEpisode) labelEl.textContent = `${displayedEpisode}화`;
  if (titleEl) titleEl.textContent = title ? title.replace(/^\d+화\s*[-–—]\s*/, "") : "";

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

function viewPrev() {
  const prev = displayedEpisode !== null ? displayedEpisode - 1 : currentEpisode - 2;
  if (prev < 1 || !episodeCache[prev]) return;
  displayedEpisode = prev;
  renderProgressive(episodeCache[displayedEpisode], true);
  updateEpisodeUI();
}

function viewNext() {
  const next = displayedEpisode !== null ? displayedEpisode + 1 : currentEpisode;
  if (!episodeCache[next]) return;
  displayedEpisode = next;
  renderProgressive(episodeCache[displayedEpisode], true);
  updateEpisodeUI();
}

function regenerate() {
  if (_generating) return;
  if (displayedEpisode == null) return;
  // 현재 화를 캐시에서 제거하고 동일 번호로 재생성
  delete episodeCache[displayedEpisode];
  currentEpisode = displayedEpisode;
  displayedEpisode = null;
  document.getElementById("output").textContent = "";
  generate();
}

async function saveEpisode(episodeNum, content) {
  await fetch("/api/episodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: bookId, episode_number: episodeNum, content }),
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
  output.textContent = "";
  _sessionStart = Date.now();
  _generating = true;

  const episodeNum = currentEpisode;
  displayedEpisode = episodeNum;
  btn.disabled = true; prevBtn.disabled = true;
  updateEpisodeUI();
  const es = new EventSource(`/api/generate?episode=${currentEpisode}&book_id=${bookId}`);
  es.onmessage = e => {
    if (e.data === "[DONE]") {
      es.close();
      _generating = false;
      renderProgressive(rawText, true);
      applyFocusLine();
      episodeCache[episodeNum] = rawText;
      saveEpisode(episodeNum, rawText);
      _sendLog(episodeNum, 1.0, null);
      displayedEpisode = episodeNum;
      currentEpisode++;
      updateEpisodeUI();
      syncBookEpisode?.();
      if (currentEpisode > 1) applySettingsLock(true);
      btn.disabled = false;
      return;
    }
    try {
      const { token, error } = JSON.parse(e.data);
      if (error) {
        _generating = false;
        output.textContent = "오류가 발생했습니다.";
        es.close(); btn.disabled = false; prevBtn.disabled = false;
      } else { rawText += token; _renderQueue = rawText; pacingAppend(token); }
    } catch (e) { console.error(e); }
  };
  es.onerror = () => {
    es.close();
    _generating = false;
    if (rawText) {
      const approxCompletion = Math.min(rawText.length / 900, 1.0);
      _sendLog(episodeNum, approxCompletion, approxCompletion < 0.95 ? approxCompletion : null);
      renderProgressive(rawText, true);
      episodeCache[episodeNum] = rawText;
      saveEpisode(episodeNum, rawText);
      displayedEpisode = episodeNum;
      currentEpisode++;
      updateEpisodeUI();
    }
    btn.disabled = false; prevBtn.disabled = false;
  };
}
