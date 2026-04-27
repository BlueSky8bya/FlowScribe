// ══════════════════════════════════════════════════════════════
//  FlowScribe — Voice Archive & TTS Controller
//  SOP §15 (오디오 및 TTS 시스템) / §16 (Personal Voice Archive)
// ══════════════════════════════════════════════════════════════

// ── 상태 ─────────────────────────────────────────────────────
let _myVoices    = [];
let _rateDebounce = null;
let _browseVoices = [];
let _charMap     = [];         // 현재 책의 캐릭터→보이스 매핑
let _activeVoiceTab = "mine";
let _regStep     = 0;
let _regDraft    = {};         // 등록 중인 보이스 초안
let _consentChecked = {};      // 동의 항목 체크 상태

// ── TTS 엔진 상태 ─────────────────────────────────────────────
const _tts = {
  synth: window.speechSynthesis,
  voices: [],          // 시스템 보이스 목록
  selectedVoiceId: null,  // 선택된 Voice Archive ID (또는 "system:{name}")
  rate: 1.0,
  pitch: 1.0,
  playing: false,
  paused: false,
  utterances: [],      // 현재 발화 큐
  currentIdx: 0,
  segments: [],        // [{text, type:'narration'|'dialogue', character:string|null}]
  domSegments: [],     // DOM <p> 요소 배열 (하이라이팅용)
};

// ── 초기화 ────────────────────────────────────────────────────

async function initVoiceArchive() {
  _loadSystemVoices();
  await _refreshMyVoices();
  _renderTTSBar();
}

function _loadSystemVoices() {
  const load = () => {
    const all = window.speechSynthesis.getVoices();
    _tts.voices = all.filter(v => v.lang.startsWith("ko"));
    if (!_tts.voices.length) _tts.voices = all; // 폴백: 시스템에 한국어 음성 없을 때
    _populateVoiceSelect();
  };
  load();
  window.speechSynthesis.onvoiceschanged = load;
}

async function _refreshMyVoices() {
  try {
    const r = await fetch("/api/voice/mine");
    if (!r.ok) return;
    const { voices } = await r.json();
    _myVoices = voices;
    _updateVoiceSidebarCount();
    _populateVoiceSelect();
  } catch (e) { console.error(e); }
}

async function _refreshBrowse() {
  try {
    const r = await fetch("/api/voice/browse");
    if (!r.ok) return;
    const { voices } = await r.json();
    _browseVoices = voices;
  } catch (e) { console.error(e); }
}

async function _refreshCharMap() {
  if (!window.bookId) return;
  try {
    const r = await fetch(`/api/voice/book/${bookId}/map`);
    if (!r.ok) return;
    const { map } = await r.json();
    _charMap = map;
  } catch (e) { console.error(e); }
}

// ── 사이드바 카운트 ───────────────────────────────────────────

function _updateVoiceSidebarCount() {
  const el = document.getElementById("voiceCount");
  if (el) el.textContent = _myVoices.length || "";
}

// ── Voice Archive 모달 열기/닫기 ──────────────────────────────

function openVoiceArchive(tab = "mine") {
  document.getElementById("voiceOverlay").classList.add("open");
  switchVoiceTab(tab);
  if (tab === "mine") _renderMyVoices();
  if (tab === "browse") { _refreshBrowse().then(_renderBrowseVoices); }
  if (tab === "map") { _refreshCharMap().then(_renderCharMap); }
}

function closeVoiceArchive() {
  document.getElementById("voiceOverlay").classList.remove("open");
}

function switchVoiceTab(tab) {
  _activeVoiceTab = tab;
  document.querySelectorAll(".voice-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll(".voice-tab-pane").forEach(p => p.classList.toggle("active", p.dataset.tab === tab));
  if (tab === "mine") _renderMyVoices();
  if (tab === "browse") { _refreshBrowse().then(_renderBrowseVoices); }
  if (tab === "register") _startRegFlow();
  if (tab === "map") { _refreshCharMap().then(_renderCharMap); }
}

// ────────────────────────────────────────────────────────────
//  TAB 1: 내 보이스
// ────────────────────────────────────────────────────────────

function _renderMyVoices() {
  const pane = document.getElementById("vTabMine");
  if (!pane) return;
  if (!_myVoices.length) {
    pane.innerHTML = `<div class="voice-empty">
      <div class="voice-empty-icon">🎙</div>
      <div class="voice-empty-text">등록된 보이스가 없습니다.<br>나만의 목소리를 등록해 캐릭터에 생명을 불어넣어 보세요.</div>
      <button class="voice-empty-btn" onclick="switchVoiceTab('register')">+ 새 보이스 등록</button>
    </div>`;
    return;
  }

  pane.innerHTML = `<div class="voice-grid">${_myVoices.map(v => _voiceCardHTML(v, true)).join("")}</div>`;
}

function _voiceCardHTML(v, isOwner = false) {
  const scopeLabel = { private: "🔒 비공개", shared: "👥 공유", public: "🌐 공개" }[v.scope_level] ?? v.scope_level;
  const consentLabel = { confirmed: "✓ 동의완료", pending: "⏳ 대기", revoked: "✕ 취소" }[v.consent_status] ?? "";
  const styleTags = (v.style_tags ?? []).map(t => `<span class="voice-tag style">${t}</span>`).join("");
  const charTags  = (v.character_types ?? []).map(t => `<span class="voice-tag char">${t}</span>`).join("");
  const inactive  = !v.active || v.delete_requested;

  return `<div class="voice-card${inactive ? " inactive" : ""}" id="vc-${v.id}">
    <div class="voice-card-avatar">🎙</div>
    <div class="voice-card-body">
      <div class="voice-card-name">${esc(v.display_name)}</div>
      ${v.description ? `<div class="voice-card-desc">${esc(v.description)}</div>` : ""}
      <div class="voice-card-tags">${styleTags}${charTags}</div>
      <div class="voice-card-meta">
        <span class="voice-scope-badge ${v.scope_level}">${scopeLabel}</span>
        <span class="voice-consent-badge ${v.consent_status}">${consentLabel}</span>
        <div class="voice-rate-row">
          <span class="voice-rate-label">속도</span>
          <input class="voice-rate-slider" type="range" min="0.5" max="2" step="0.05" value="${v.default_rate}"
            oninput="this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)x"
            onchange="_saveVoiceRate('${v.id}',this.value)" />
          <span class="voice-rate-val">${parseFloat(v.default_rate).toFixed(1)}x</span>
        </div>
      </div>
    </div>
    ${isOwner ? `<div class="voice-card-actions">
      ${v.sample_path ? `<button class="voice-action-btn" onclick="_previewVoice('${v.id}')">▶ 미리듣기</button>` : `<button class="voice-action-btn" onclick="_openRecorder('${v.id}')">🎙 샘플 녹음</button>`}
      <button class="voice-action-btn" onclick="_openVoiceEdit('${v.id}')">편집</button>
      ${v.active
        ? `<button class="voice-action-btn danger" onclick="_deactivateVoice('${v.id}')">비활성화</button>`
        : `<button class="voice-action-btn" onclick="_activateVoice('${v.id}')">활성화</button>`}
      <button class="voice-action-btn danger" onclick="_deleteVoice('${v.id}','${esc(v.display_name)}')">삭제</button>
    </div>` : ""}
  </div>`;
}

// ── 보이스 편집 인라인 ────────────────────────────────────────

function _openVoiceEdit(id) {
  const v = _myVoices.find(x => x.id === id);
  if (!v) return;
  const SCOPES = ["private","shared","public"];
  const STYLES = ["따뜻한","차가운","깊은","밝은","조용한","강렬한","부드러운","날카로운"];
  const CHARS  = ["나레이터","영웅","악당","조연","소녀","소년","노인","신비로운존재"];

  const selectedStyles = new Set(v.style_tags ?? []);
  const selectedChars  = new Set(v.character_types ?? []);

  const modal = document.createElement("div");
  modal.className = "fs-dialog-overlay open";
  modal.innerHTML = `<div class="fs-dialog" style="max-width:520px;min-width:420px;">
    <div class="fs-dialog-title" style="text-align:left;font-size:1.05rem;margin-bottom:1.2rem;">보이스 편집 — ${esc(v.display_name)}</div>
    <div class="va-form-group">
      <label class="va-form-label">이름</label>
      <input class="va-form-input" id="editName" value="${esc(v.display_name)}" />
    </div>
    <div class="va-form-group">
      <label class="va-form-label">설명</label>
      <textarea class="va-form-textarea" id="editDesc">${esc(v.description ?? "")}</textarea>
    </div>
    <div class="va-form-group">
      <label class="va-form-label">공유 범위</label>
      <div class="va-scope-grid">
        ${SCOPES.map(s => `<div class="va-scope-card${v.scope_level===s?" selected":""}" id="editScope-${s}" onclick="_editSelectScope('${s}')">
          <div class="va-scope-icon">${{private:"🔒",shared:"👥",public:"🌐"}[s]}</div>
          <div class="va-scope-name">${{private:"비공개",shared:"공유",public:"공개"}[s]}</div>
        </div>`).join("")}
      </div>
    </div>
    <div class="va-form-group">
      <label class="va-form-label">음성 스타일</label>
      <div class="va-tag-grid">${STYLES.map(s=>`<div class="va-tag-chip${selectedStyles.has(s)?" selected":""}" onclick="this.classList.toggle('selected')" data-style="${s}">${s}</div>`).join("")}</div>
    </div>
    <div class="va-form-group">
      <label class="va-form-label">캐릭터 유형</label>
      <div class="va-tag-grid">${CHARS.map(c=>`<div class="va-tag-chip${selectedChars.has(c)?" selected":""}" onclick="this.classList.toggle('selected')" data-char="${c}">${c}</div>`).join("")}</div>
    </div>
    <div class="va-param-grid" style="margin-bottom:1.2rem;">
      <div class="va-param-item">
        <label class="va-param-label">속도 <span id="editRateVal">${v.default_rate}</span>x</label>
        <input class="va-param-slider" type="range" min="0.5" max="2" step="0.05" value="${v.default_rate}"
          oninput="document.getElementById('editRateVal').textContent=parseFloat(this.value).toFixed(2)" id="editRate" />
      </div>
      <div class="va-param-item">
        <label class="va-param-label">음높이 <span id="editPitchVal">${v.default_pitch}</span>x</label>
        <input class="va-param-slider" type="range" min="0.5" max="2" step="0.05" value="${v.default_pitch}"
          oninput="document.getElementById('editPitchVal').textContent=parseFloat(this.value).toFixed(2)" id="editPitch" />
      </div>
    </div>
    <div class="fs-dialog-actions">
      <button class="fs-dialog-btn" onclick="this.closest('.fs-dialog-overlay').remove()">취소</button>
      <button class="fs-dialog-btn primary" onclick="_saveVoiceEdit('${id}',this)">저장</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  window._editScopeSelected = v.scope_level;
}

function _editSelectScope(s) {
  window._editScopeSelected = s;
  document.querySelectorAll("[id^='editScope-']").forEach(el => el.classList.toggle("selected", el.id === `editScope-${s}`));
}

async function _saveVoiceEdit(id, btn) {
  const name = document.getElementById("editName").value.trim();
  if (!name) { showToast("이름을 입력해주세요", "warn"); return; }

  const style_tags = [...document.querySelectorAll(".va-tag-chip.selected[data-style]")].map(el => el.dataset.style);
  const character_types = [...document.querySelectorAll(".va-tag-chip.selected[data-char]")].map(el => el.dataset.char);

  btn.textContent = "저장 중...";
  await fetch(`/api/voice/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      display_name: name,
      description: document.getElementById("editDesc").value,
      scope_level: window._editScopeSelected,
      default_rate: parseFloat(document.getElementById("editRate").value),
      default_pitch: parseFloat(document.getElementById("editPitch").value),
      style_tags, character_types,
    }),
  });

  await _refreshMyVoices();
  _renderMyVoices();
  btn.closest(".fs-dialog-overlay").remove();
  showToast("보이스 설정이 저장됐습니다", "info");
}

async function _saveVoiceRate(id, rate) {
  await fetch(`/api/voice/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ default_rate: parseFloat(rate) }),
  });
  const v = _myVoices.find(x => x.id === id);
  if (v) v.default_rate = parseFloat(rate);
}

async function _deactivateVoice(id) {
  await fetch(`/api/voice/${id}/deactivate`, { method: "POST" });
  await _refreshMyVoices(); _renderMyVoices();
  showToast("보이스가 비활성화됐습니다", "warn");
}

async function _activateVoice(id) {
  await fetch(`/api/voice/${id}/activate`, { method: "POST" });
  await _refreshMyVoices(); _renderMyVoices();
  showToast("보이스가 활성화됐습니다", "info");
}

async function _deleteVoice(id, name) {
  const ok = await showConfirm({ icon: "🗑️", title: `"${name}" 보이스 삭제`, desc: "삭제 즉시 모든 매핑에서 제외됩니다.\n감사 이력은 보존됩니다." });
  if (!ok) return;
  await fetch(`/api/voice/${id}`, { method: "DELETE" });
  await _refreshMyVoices(); _renderMyVoices();
  showToast(`"${name}" 삭제 완료`, "warn");
}

// ────────────────────────────────────────────────────────────
//  TAB 2: 음성 등록 — 4단계 흐름
// ────────────────────────────────────────────────────────────

const REG_STEPS = ["동의", "기본 정보", "음성 녹음", "완료"];

const CONSENT_ITEMS = [
  { key: "own", text: "이 목소리는 <em>제 목소리</em>이며, 본인이 직접 녹음한 것입니다.", required: true },
  { key: "ai_ok", text: "FlowScribe 내부 AI 낭독에 목소리를 사용하는 것에 동의합니다.", required: true },
  { key: "platform", text: "선택한 공유 범위 내에서 다른 사용자의 AI 낭독에 사용될 수 있음을 이해합니다.", required: false },
  { key: "no_clone", text: "제 동의 없이 목소리를 복제하거나 외부 유출하지 않는다는 것을 확인합니다.", required: true },
  { key: "withdraw", text: "언제든지 비활성화 또는 삭제 요청으로 사용을 중단할 수 있음을 알고 있습니다.", required: false },
];

function _startRegFlow() {
  _regStep = 0;
  _regDraft = {
    display_name: "", description: "", scope_level: "private",
    ai_narration_allowed: true, character_voice_allowed: true,
    commercial_use_allowed: false, adult_content_allowed: false,
    redistribution_allowed: false,
    tts_engine: "web_speech", tts_voice_id: null,
    default_rate: 1.0, default_pitch: 1.0,
    style_tags: [], character_types: [],
    consent_confirmed: false,
  };
  _consentChecked = {};
  _renderRegStep();
}

function _renderRegStep() {
  const pane = document.getElementById("vTabRegister");
  if (!pane) return;

  const stepDots = REG_STEPS.map((_, i) =>
    `<div class="va-step-dot${i < _regStep ? " done" : i === _regStep ? " active" : ""}"></div>`
  ).join("");

  const prevBtn = _regStep > 0
    ? `<button class="voice-action-btn" onclick="_regNav(-1)">← 이전</button>`
    : `<span></span>`;

  const nextLabel = _regStep === REG_STEPS.length - 1 ? "완료" : "다음 →";

  pane.innerHTML = `
    <div style="margin-bottom:1.2rem;">
      <div style="font-size:.8rem;color:var(--text4);letter-spacing:.1em;text-transform:uppercase;margin-bottom:.6rem;">
        ${REG_STEPS[_regStep]}
      </div>
      <div style="display:flex;gap:.35rem;">${stepDots}</div>
    </div>
    <div id="regBody">${_regStepBody()}</div>
    <div class="va-reg-nav">
      ${prevBtn}
      <button class="voice-action-btn primary" id="regNextBtn" onclick="_regNav(1)">${nextLabel}</button>
    </div>`;
}

function _regStepBody() {
  if (_regStep === 0) return _regConsentBody();
  if (_regStep === 1) return _regInfoBody();
  if (_regStep === 2) return _regRecordBody();
  if (_regStep === 3) return _regCompleteBody();
  return "";
}

function _regConsentBody() {
  return `<div class="va-consent-box">
    <div class="va-consent-title">📋 음성 등록 전 동의사항 (SOP §16.4 Normative)</div>
    <div class="va-consent-items">
      ${CONSENT_ITEMS.map(item => `
        <label class="va-consent-item${_consentChecked[item.key] ? " checked" : ""}" onclick="_toggleConsent('${item.key}')">
          <div class="va-consent-check">${_consentChecked[item.key] ? "✓" : ""}</div>
          <div class="va-consent-text">${item.text}${item.required ? '<span class="va-consent-required">*필수</span>' : ""}</div>
        </label>`).join("")}
    </div>
  </div>
  <div style="font-size:.82rem;color:var(--text4);margin-top:.7rem;line-height:1.6;">
    * 표시된 필수 항목에 모두 동의해야 다음 단계로 진행할 수 있습니다.
  </div>`;
}

function _regInfoBody() {
  const STYLES = ["따뜻한","차가운","깊은","밝은","조용한","강렬한","부드러운","날카로운"];
  const CHARS  = ["나레이터","영웅","악당","조연","소녀","소년","노인","신비로운존재"];
  const SCOPES = [
    { k: "private", icon: "🔒", name: "비공개", desc: "나만 사용" },
    { k: "shared",  icon: "👥", name: "공유",   desc: "플랫폼 내 공유" },
    { k: "public",  icon: "🌐", name: "공개",   desc: "공개 라이브러리" },
  ];
  return `
    <div class="va-form-group">
      <label class="va-form-label">보이스 이름 *</label>
      <input class="va-form-input" id="regName" placeholder="예: 차분한 나레이터" value="${esc(_regDraft.display_name)}"
        oninput="_regDraft.display_name=this.value" />
    </div>
    <div class="va-form-group">
      <label class="va-form-label">한 줄 설명</label>
      <textarea class="va-form-textarea" id="regDesc" placeholder="예: 낮고 차분한 남성 목소리, 판타지·스릴러 장르에 어울립니다."
        oninput="_regDraft.description=this.value">${esc(_regDraft.description)}</textarea>
    </div>
    <div class="va-form-group">
      <label class="va-form-label">공유 범위</label>
      <div class="va-scope-grid">
        ${SCOPES.map(s => `<div class="va-scope-card${_regDraft.scope_level===s.k?" selected":""}"
            onclick="_regSelectScope('${s.k}')">
          <div class="va-scope-icon">${s.icon}</div>
          <div class="va-scope-name">${s.name}</div>
          <div class="va-scope-desc">${s.desc}</div>
        </div>`).join("")}
      </div>
    </div>
    <div class="va-form-group">
      <label class="va-form-label">음성 스타일 (복수 선택)</label>
      <div class="va-tag-grid">
        ${STYLES.map(s=>`<div class="va-tag-chip${_regDraft.style_tags.includes(s)?" selected":""}"
          onclick="_regToggleTag('style','${s}',this)">${s}</div>`).join("")}
      </div>
    </div>
    <div class="va-form-group">
      <label class="va-form-label">캐릭터 유형 (복수 선택)</label>
      <div class="va-tag-grid">
        ${CHARS.map(c=>`<div class="va-tag-chip${_regDraft.character_types.includes(c)?" selected":""}"
          onclick="_regToggleTag('char','${c}',this)">${c}</div>`).join("")}
      </div>
    </div>
    <div class="va-param-grid">
      <div class="va-param-item">
        <label class="va-param-label">기본 속도 <span id="regRateVal">${_regDraft.default_rate}</span>x</label>
        <input class="va-param-slider" type="range" min="0.5" max="2" step="0.05" value="${_regDraft.default_rate}"
          oninput="_regDraft.default_rate=parseFloat(this.value);document.getElementById('regRateVal').textContent=parseFloat(this.value).toFixed(2)" />
      </div>
      <div class="va-param-item">
        <label class="va-param-label">음높이 <span id="regPitchVal">${_regDraft.default_pitch}</span>x</label>
        <input class="va-param-slider" type="range" min="0.5" max="2" step="0.05" value="${_regDraft.default_pitch}"
          oninput="_regDraft.default_pitch=parseFloat(this.value);document.getElementById('regPitchVal').textContent=parseFloat(this.value).toFixed(2)" />
      </div>
    </div>`;
}

function _regRecordBody() {
  return `<div class="va-record-area" id="regRecordArea">
    <div class="va-record-hint">
      아래 문장을 자연스럽게 읽으며 녹음해주세요.<br>
      <span style="color:var(--accent);">최소 10초 이상</span> 녹음해야 합니다.<br>
      <em style="color:var(--text4);font-style:normal;font-size:.82rem;">녹음은 선택 사항입니다 — 지금 건너뛸 수 있습니다.</em>
    </div>
    <div style="background:var(--bg2);border-radius:10px;padding:1rem 1.3rem;font-size:.95rem;color:var(--text2);line-height:1.85;text-align:left;max-width:420px;">
      "달빛이 강물 위에 내려앉은 밤, 그는 조용히 눈을 감았습니다.
      오래된 기억이 물결처럼 밀려왔고, 그는 그 흐름 속에 가만히 몸을 맡겼습니다.
      세상의 소리가 멀어지고, 오직 심장 소리만이 선명하게 남았습니다."
    </div>
    <canvas class="va-waveform" id="regWaveform"></canvas>
    <div class="va-record-timer" id="regTimer">00:00</div>
    <button class="va-record-btn" id="regRecordBtn" onclick="_toggleRecording()">🎙</button>
    <div id="regRecordStatus" style="font-size:.84rem;color:var(--text4);">버튼을 눌러 녹음 시작</div>
    ${_regDraft._recorded ? `<div style="color:#4ab870;font-size:.88rem;">✓ 녹음 완료 — 다음으로 진행하세요</div>` : ""}
  </div>`;
}

function _regCompleteBody() {
  return `<div style="text-align:center;padding:1.5rem 0;">
    <div style="font-size:2.5rem;margin-bottom:1rem;">✦</div>
    <div style="font-size:1.1rem;color:var(--text2);margin-bottom:.8rem;">보이스 등록 준비 완료</div>
    <div style="font-size:.9rem;color:var(--text4);line-height:1.8;">
      <strong style="color:var(--text3);">${esc(_regDraft.display_name)}</strong><br>
      ${esc(_regDraft.description || "설명 없음")}<br>
      공유 범위: ${{private:"🔒 비공개",shared:"👥 공유",public:"🌐 공개"}[_regDraft.scope_level]}<br>
      스타일: ${_regDraft.style_tags.join(", ") || "—"}
    </div>
  </div>`;
}

function _toggleConsent(key) {
  _consentChecked[key] = !_consentChecked[key];
  _renderRegStep();
}

function _regSelectScope(s) {
  _regDraft.scope_level = s;
  document.querySelectorAll(".va-scope-card").forEach(c => c.classList.toggle("selected", c.onclick?.toString().includes(`'${s}'`)));
}

function _regToggleTag(type, val, el) {
  const arr = type === "style" ? _regDraft.style_tags : _regDraft.character_types;
  const idx = arr.indexOf(val);
  if (idx > -1) arr.splice(idx, 1); else arr.push(val);
  el.classList.toggle("selected");
}

async function _regNav(dir) {
  // 유효성 검사
  if (dir > 0) {
    if (_regStep === 0) {
      const required = CONSENT_ITEMS.filter(i => i.required).map(i => i.key);
      if (!required.every(k => _consentChecked[k])) {
        showToast("필수 동의 항목을 모두 체크해주세요", "warn"); return;
      }
      _regDraft.consent_confirmed = true;
    }
    if (_regStep === 1) {
      if (!_regDraft.display_name.trim()) {
        showToast("보이스 이름을 입력해주세요", "warn"); return;
      }
    }
    if (_regStep === REG_STEPS.length - 1) {
      await _submitVoiceReg();
      return;
    }
  }
  _regStep = Math.max(0, Math.min(REG_STEPS.length - 1, _regStep + dir));
  _renderRegStep();
  if (_regStep === 2) _initWaveformCanvas();
}

let _mediaRecorder = null, _audioChunks = [], _recordTimer = null, _recordSec = 0;

function _initWaveformCanvas() {
  // AudioContext 시각화 (AnalyserNode)
  // 실제 녹음 시 초기화됨
}

function _toggleRecording() {
  if (_mediaRecorder?.state === "recording") {
    _stopRecording();
  } else {
    _startRecording();
  }
}

async function _startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioChunks = [];
    _mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    _mediaRecorder.ondataavailable = e => { if (e.data.size > 0) _audioChunks.push(e.data); };
    _mediaRecorder.onstop = _onRecordStop;
    _mediaRecorder.start(100);
    _recordSec = 0;
    document.getElementById("regRecordBtn")?.classList.add("recording");
    document.getElementById("regRecordArea")?.classList.add("recording");
    document.getElementById("regRecordBtn").textContent = "⏹";
    document.getElementById("regRecordStatus").textContent = "녹음 중...";
    _recordTimer = setInterval(() => {
      _recordSec++;
      const m = String(Math.floor(_recordSec / 60)).padStart(2, "0");
      const s = String(_recordSec % 60).padStart(2, "0");
      const el = document.getElementById("regTimer");
      if (el) el.textContent = `${m}:${s}`;
    }, 1000);
    _startWaveformAnim(stream);
  } catch {
    showToast("마이크 접근 권한이 필요합니다", "warn");
  }
}

function _stopRecording() {
  clearInterval(_recordTimer);
  _mediaRecorder?.stop();
  _mediaRecorder?.stream?.getTracks().forEach(t => t.stop());
}

function _onRecordStop() {
  const btn = document.getElementById("regRecordBtn");
  const area = document.getElementById("regRecordArea");
  if (btn) { btn.classList.remove("recording"); btn.textContent = "🎙"; }
  if (area) area.classList.remove("recording");
  document.getElementById("regRecordStatus").textContent = `녹음 완료 (${_recordSec}초)`;

  if (_recordSec < 5) { showToast("너무 짧습니다. 10초 이상 녹음해주세요", "warn"); return; }

  _regDraft._audioBlob = new Blob(_audioChunks, { type: "audio/webm;codecs=opus" });
  _regDraft._recorded = true;
  showToast(`녹음 완료 — ${_recordSec}초`, "info");
}

function _startWaveformAnim(stream) {
  const canvas = document.getElementById("regWaveform");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  const src = audioCtx.createMediaStreamSource(stream);
  src.connect(analyser);
  analyser.fftSize = 256;
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const draw = () => {
    if (!_mediaRecorder || _mediaRecorder.state !== "recording") return;
    requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(buf);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    ctx.lineWidth = 2;
    ctx.beginPath();
    buf.forEach((v, i) => {
      const x = (i / buf.length) * canvas.width;
      const y = (v / 128) * (canvas.height / 2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  draw();
}

async function _submitVoiceReg() {
  const btn = document.getElementById("regNextBtn");
  if (btn) btn.textContent = "등록 중...";

  try {
    const r = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(_regDraft),
    });
    if (!r.ok) { showToast("등록 실패 — 다시 시도해주세요", "err"); if (btn) btn.textContent = "완료"; return; }
    const { voice } = await r.json();

    // 샘플 오디오 업로드
    if (_regDraft._audioBlob) {
      const fd = new FormData();
      fd.append("audio", _regDraft._audioBlob, "sample.webm");
      await fetch(`/api/voice/${voice.id}/sample`, { method: "POST", body: fd });
    }

    await _refreshMyVoices();
    showToast(`"${voice.display_name}" 등록 완료!`, "info");
    switchVoiceTab("mine");
    _populateVoiceSelect();
  } catch (err) {
    showToast("등록 중 오류가 발생했습니다", "err");
    if (btn) btn.textContent = "완료";
  }
}

// ────────────────────────────────────────────────────────────
//  TAB 3: 공개 보이스 탐색
// ────────────────────────────────────────────────────────────

function _renderBrowseVoices() {
  const pane = document.getElementById("vTabBrowse");
  if (!pane) return;
  if (!_browseVoices.length) {
    pane.innerHTML = `<div class="voice-empty"><div class="voice-empty-icon">🌐</div>
      <div class="voice-empty-text">아직 공유된 보이스가 없습니다.<br>첫 번째로 공개 보이스를 등록해보세요.</div></div>`;
    return;
  }
  pane.innerHTML = `<div class="browse-grid">${_browseVoices.map(v => `
    <div class="browse-card" onclick="_usePublicVoice('${v.id}','${esc(v.display_name)}')">
      <div class="browse-card-name">${esc(v.display_name)}</div>
      <div class="browse-card-owner">by ${esc(v.owner_name ?? "—")}</div>
      <span class="voice-scope-badge ${v.scope_level}">${{shared:"👥 공유",public:"🌐 공개"}[v.scope_level] ?? v.scope_level}</span>
      <div class="browse-card-tags">
        ${(v.style_tags ?? []).map(t=>`<span class="voice-tag style">${t}</span>`).join("")}
        ${(v.character_types ?? []).map(t=>`<span class="voice-tag char">${t}</span>`).join("")}
      </div>
    </div>`).join("")}</div>`;
}

function _usePublicVoice(id, name) {
  _tts.selectedVoiceId = id;
  _populateVoiceSelect();
  showToast(`"${name}" 선택됨 — TTS에서 사용됩니다`, "info");
  closeVoiceArchive();
}

// ────────────────────────────────────────────────────────────
//  TAB 4: 캐릭터 배역 매핑
// ────────────────────────────────────────────────────────────

function _renderCharMap() {
  const pane = document.getElementById("vTabMap");
  if (!pane) return;

  // 등장인물 목록 — window에서 가져오거나 episodeCache에서 추출
  const chars = _extractCharacters();
  if (!chars.length) {
    pane.innerHTML = `<div class="voice-empty"><div class="voice-empty-icon">👤</div>
      <div class="voice-empty-text">등록된 인물이 없습니다.<br>세계관 설정에서 인물을 추가해주세요.</div></div>`;
    return;
  }

  const allVoices = [
    ..._myVoices.filter(v => v.active && !v.delete_requested && v.consent_status === "confirmed"),
    ..._browseVoices,
  ];
  const voiceOptions = `<option value="">— 없음 —</option>` +
    allVoices.map(v => `<option value="${v.id}">${esc(v.display_name)}</option>`).join("");

  // 특수 항목: 나레이터
  const specialChars = [{ name: "나레이터", role: "narrator" }, ...chars.map(c => ({ name: c, role: "character" }))];

  pane.innerHTML = `
    <div style="font-size:.86rem;color:var(--text4);margin-bottom:1rem;line-height:1.6;">
      각 인물에 보이스를 매핑하면 소리내어 읽기 모드에서 캐릭터별로 다른 목소리로 읽어드립니다.
    </div>
    <div class="char-map-grid">
      ${specialChars.map(c => {
        const cur = _charMap.find(m => m.character_name === c.name);
        const panVal = cur?.pan_position ?? 0;
        return `<div class="char-map-item">
          <div>
            <div class="char-map-name">${c.role === "narrator" ? "📖 " : "👤 "}${esc(c.name)}</div>
            <div class="char-map-role">${c.role === "narrator" ? "서술 음성" : "대사 음성"}</div>
          </div>
          <select class="char-map-select" data-char="${esc(c.name)}" data-role="${c.role}">
            ${voiceOptions.replace(`value="${cur?.voice_id ?? ""}"`, `value="${cur?.voice_id ?? ""}" selected`)}
          </select>
          <div class="char-map-pan">
            <div class="char-map-pan-label">좌우 ${panVal > 0 ? "R" : panVal < 0 ? "L" : "C"}</div>
            <input class="char-map-pan-slider" type="range" min="-1" max="1" step="0.1" value="${panVal}"
              data-char="${esc(c.name)}" title="Spatial Audio 위치 (SOP §15.2)" />
          </div>
        </div>`;
      }).join("")}
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:1.2rem;">
      <button class="voice-action-btn primary" onclick="_saveCharMap()">배역 저장</button>
    </div>`;
}

function _extractCharacters() {
  // window.chars 또는 에피소드 캐시에서 추출 시도
  if (window.chars?.length) return chars.map(c => c.name);
  // fallback: 공란
  return [];
}

async function _saveCharMap() {
  const selects = document.querySelectorAll(".char-map-select");
  const pans    = document.querySelectorAll(".char-map-pan-slider");
  const mappings = [];
  selects.forEach((sel, i) => {
    mappings.push({
      character_name: sel.dataset.char,
      narrator_role: sel.dataset.role,
      voice_id: sel.value || null,
      pan_position: parseFloat(pans[i]?.value ?? "0"),
    });
  });
  await fetch(`/api/voice/book/${bookId}/map`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mappings }),
  });
  await _refreshCharMap();
  showToast("캐릭터 배역이 저장됐습니다", "info");
}

// ────────────────────────────────────────────────────────────
//  TTS 엔진 — Web Speech API (SOP §15.1)
// ────────────────────────────────────────────────────────────

function _populateVoiceSelect() {
  const sel = document.getElementById("ttsVoiceSelect");
  if (!sel) return;

  sel.innerHTML = `<option value="default">시스템 기본 음성</option>`;

  // 내 보이스 (active + confirmed)
  const myActive = _myVoices.filter(v => v.active && !v.delete_requested && v.consent_status === "confirmed");
  if (myActive.length) {
    const grp = document.createElement("optgroup");
    grp.label = "내 보이스";
    myActive.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.display_name;
      if (v.id === _tts.selectedVoiceId) opt.selected = true;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }

  // 시스템 음성
  if (_tts.voices.length) {
    const grp = document.createElement("optgroup");
    grp.label = "시스템 음성";
    _tts.voices.forEach(v => {
      const opt = document.createElement("option");
      opt.value = `sys:${v.name}`;
      opt.textContent = `${v.name} (${v.lang})`;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }

  if (_tts.selectedVoiceId) sel.value = _tts.selectedVoiceId;
}

function _renderTTSBar() {
  const bar = document.getElementById("ttsBar");
  if (!bar) return;
  bar.innerHTML = `
    <select class="tts-voice-select" id="ttsVoiceSelect" onchange="_ttsSelectVoice(this.value)"></select>
    <div class="tts-progress" id="ttsProgress" onclick="_ttsSeek(event)">
      <div class="tts-progress-fill" id="ttsProgressFill" style="width:0%"></div>
    </div>
    <div class="tts-ctrl-row">
      <button class="tts-play-btn" id="ttsPlayBtn" onclick="_ttsTogglePlay()" title="재생/일시정지">▶</button>
      <button class="tts-stop-btn" onclick="_ttsStop()" title="정지">■</button>
      <span class="tts-status-text" id="ttsStatus">준비됨</span>
    </div>
    <div class="tts-speed-row">
      <span class="tts-speed-label">속도</span>
      <input class="tts-rate-input" type="range" id="ttsRate" min="0.5" max="2" step="0.05" value="1.0"
        oninput="_ttsChangeRate(parseFloat(this.value))" />
      <span class="tts-rate-display" id="ttsRateVal">1.0x</span>
    </div>`;
  _populateVoiceSelect();
}

function _ttsSelectVoice(val) {
  _tts.selectedVoiceId = val === "default" ? null : val;
}

function _getActiveTTSVoice() {
  if (!_tts.selectedVoiceId || _tts.selectedVoiceId === "default") return null;
  if (_tts.selectedVoiceId.startsWith("sys:")) {
    const name = _tts.selectedVoiceId.slice(4);
    return _tts.voices.find(v => v.name === name) ?? null;
  }
  // Voice Archive — map to stored tts_voice_id
  const va = _myVoices.find(v => v.id === _tts.selectedVoiceId) ?? _browseVoices.find(v => v.id === _tts.selectedVoiceId);
  if (va?.tts_voice_id) {
    const name = va.tts_voice_id.startsWith("sys:") ? va.tts_voice_id.slice(4) : va.tts_voice_id;
    return _tts.voices.find(v => v.name === name) ?? null;
  }
  return null;
}

function _getVoiceRate(voiceId) {
  const va = _myVoices.find(v => v.id === voiceId) ?? _browseVoices.find(v => v.id === voiceId);
  return va?.default_rate ?? _tts.rate;
}
function _getVoicePitch(voiceId) {
  const va = _myVoices.find(v => v.id === voiceId) ?? _browseVoices.find(v => v.id === voiceId);
  return va?.default_pitch ?? _tts.pitch;
}

// ── 에피소드 텍스트 파싱 — 나레이션 vs 대사 분리 (SOP §15.2) ─
function _parseSegments(text) {
  const segs = [];
  // 큰따옴표 대화 검출: "..." 또는 "..."
  const pattern = /("[\s\S]*?"|"[\s\S]*?")/g;
  let last = 0;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), type: "narration" });
    segs.push({ text: m[1], type: "dialogue" });
    last = m.index + m[1].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last), type: "narration" });
  return segs.filter(s => s.text.trim());
}

function _ttsTogglePlay() {
  if (_tts.playing && !_tts.paused) {
    _tts.synth.pause();
    _tts.paused = true;
    _tts.playing = false;
    _setTTSStatus("일시정지");
    document.getElementById("ttsPlayBtn").textContent = "▶";
  } else if (_tts.paused) {
    _tts.synth.resume();
    _tts.paused = false;
    _tts.playing = true;
    _setTTSStatus("읽는 중...");
    document.getElementById("ttsPlayBtn").textContent = "⏸";
  } else {
    _ttsReadCurrent();
  }
}

function _ttsReadCurrent() {
  // displayedEpisode는 app.js에서 let으로 선언된 전역 — window 프로퍼티가 아니므로 직접 접근
  if (typeof displayedEpisode === "undefined" || displayedEpisode == null ||
      !episodeCache?.[displayedEpisode]) {
    showToast("먼저 에피소드를 생성하거나 선택하세요", "warn"); return;
  }
  const text = episodeCache[displayedEpisode];
  _ttsSpeak(text);
}

function _ttsSpeak(text) {
  _tts.synth.cancel();
  _clearTtsHighlight();

  // DOM <p> 기반 세그먼트 — 각 문단을 하나의 발화로
  const outputEl = document.getElementById("output");
  const pEls = outputEl ? [...outputEl.querySelectorAll("p")] : [];
  if (pEls.length) {
    _tts.domSegments = pEls;
    _tts.segments = pEls.map(p => {
      // innerText의 \n(br) → 마침표 없으면 공백으로 교체해 TTS가 붙여읽기 방지
      const raw = (p.innerText || p.textContent || "").replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
      return { text: raw, type: "narration" };
    });
  } else {
    _tts.domSegments = [];
    _tts.segments = _parseSegments(text);
  }

  _tts.currentIdx = 0;
  _tts.playing = true;
  _tts.paused = false;
  _speakNext();
}

function _clearTtsHighlight() {
  document.querySelectorAll(".tts-current").forEach(el => el.classList.remove("tts-current"));
}

function _ttsChangeRate(val) {
  _tts.rate = val;
  const display = document.getElementById("ttsRateVal");
  if (display) display.textContent = val.toFixed(1) + "x";
  // 재생 중이면 250ms 디바운스 후 재시작
  if (_tts.playing && !_tts.paused) {
    clearTimeout(_rateDebounce);
    _rateDebounce = setTimeout(() => {
      _tts.synth.cancel();
      _speakNext();
    }, 250);
  }
}

function _speakNext() {
  if (_tts.currentIdx >= _tts.segments.length) {
    _tts.playing = false;
    _clearTtsHighlight();
    _setTTSStatus("완료");
    document.getElementById("ttsPlayBtn").textContent = "▶";
    document.getElementById("ttsProgressFill").style.width = "100%";
    return;
  }
  const seg = _tts.segments[_tts.currentIdx];
  const utter = new SpeechSynthesisUtterance(seg.text);

  // 보이스 설정
  const sysVoice = _getActiveTTSVoice();
  if (sysVoice) utter.voice = sysVoice;
  utter.rate  = _getVoiceRate(_tts.selectedVoiceId);
  utter.pitch = _getVoicePitch(_tts.selectedVoiceId);
  utter.lang  = "ko-KR";

  // 대사는 살짝 다른 파라미터 — Spatial Audio 근사 (SOP §15.2)
  if (seg.type === "dialogue") {
    utter.rate  *= 1.05;
    utter.pitch *= 1.08;
  }

  // 진행률 + DOM 하이라이팅
  utter.onstart = () => {
    const pct = Math.round((_tts.currentIdx / _tts.segments.length) * 100);
    document.getElementById("ttsProgressFill").style.width = `${pct}%`;
    _setTTSStatus(`${_tts.currentIdx + 1} / ${_tts.segments.length} 문단`);
    document.getElementById("ttsPlayBtn").textContent = "⏸";
    // 현재 문단 하이라이트
    _clearTtsHighlight();
    const domEl = _tts.domSegments[_tts.currentIdx];
    if (domEl) {
      domEl.classList.add("tts-current");
      domEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  utter.onend = () => {
    _tts.currentIdx++;
    if (_tts.playing) _speakNext();
  };
  utter.onerror = () => { _tts.playing = false; _setTTSStatus("오류"); };

  _tts.synth.speak(utter);
}

function _ttsStop() {
  _tts.synth.cancel();
  _tts.playing = false;
  _tts.paused  = false;
  _tts.currentIdx = 0;
  _clearTtsHighlight();
  _setTTSStatus("정지됨");
  document.getElementById("ttsPlayBtn").textContent = "▶";
  document.getElementById("ttsProgressFill").style.width = "0%";
}

function _ttsSeek(e) {
  const bar = document.getElementById("ttsProgress");
  if (!bar || !_tts.segments.length) return;
  const pct = e.offsetX / bar.clientWidth;
  _tts.currentIdx = Math.floor(pct * _tts.segments.length);
  if (_tts.playing) { _tts.synth.cancel(); _speakNext(); }
}

function _setTTSStatus(msg) {
  const el = document.getElementById("ttsStatus");
  if (el) el.textContent = msg;
}

// ── 보이스 미리듣기 ────────────────────────────────────────────

function _previewVoice(id) {
  const v = _myVoices.find(x => x.id === id);
  if (!v) return;
  const text = `안녕하세요. 저는 "${v.display_name}" 보이스입니다. 이 목소리로 이야기를 읽어드립니다.`;
  const utter = new SpeechSynthesisUtterance(text);
  const sysVoice = _tts.voices.find(sv => v.tts_voice_id && sv.name === v.tts_voice_id.replace("sys:", ""));
  if (sysVoice) utter.voice = sysVoice;
  utter.rate  = v.default_rate;
  utter.pitch = v.default_pitch;
  utter.lang  = "ko-KR";
  _tts.synth.cancel();
  _tts.synth.speak(utter);
  showToast("미리듣기 중...", "info", 3000);
}

// ── TTS 모드 연동 (소리내어 읽기 모드 진입 시) ─────────────────

function onReadModeChange(mode) {
  const bar = document.getElementById("ttsBar");
  if (!bar) return;
  bar.classList.toggle("hidden", mode !== "tts");
  if (mode !== "tts") _ttsStop();
}
