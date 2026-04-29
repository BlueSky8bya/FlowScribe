// ── 세계관 UI 전체 초기화 (책 전환 시 항상 먼저 호출) ────────

function clearWorldSettingsUI() {
  // 배경·장르 칩 초기화
  settingVals.length = 0;
  moodVals.length = 0;
  document.querySelectorAll("#settingGrid .chip, #moodGrid .chip").forEach(c => {
    c.classList.remove("selected", "disabled");
  });
  document.querySelectorAll("#settingGrid ~ .custom-chip, #moodGrid ~ .custom-chip").forEach(el => el.remove());

  // 세계관 규칙 초기화
  ruleEntries.length = 0;
  document.querySelectorAll("#rulesWrap .tag").forEach(el => el.remove());

  // 인물 카드 초기화 — 빈 카드 1개로 리셋
  const container = document.getElementById("charCards");
  if (container) {
    container.innerHTML = "";
    charCount = 1;
    appendCharCard(container, 0, { type:"인간", gender:"해당없음" });
  }
  const ccn = document.getElementById("charCountNum");
  if (ccn) ccn.textContent = "1";
  _syncCharCounterBtns?.();

  // storyConfig 기본값 복원
  Object.assign(storyConfig, {
    conflict:3, foreshadow:3, emotion:3, dialogue:3, direction:3,
    episodeLength:2000, episodeLengthVar:500, totalEpisodes:30, totalEpisodesVar:5,
    pov: "3인칭 관찰자", style: "균형",
  });
  ["conflict","foreshadow","emotion","dialogue","direction"].forEach(key => {
    const slider = document.getElementById(key + "Slider");
    const valEl  = document.getElementById(key + "Val");
    if (slider) { slider.value = storyConfig[key]; slider.style.setProperty("--pct", "22.2%"); }
    if (valEl)  valEl.textContent = storyConfig[key];
  });
  ["pov","style"].forEach(key => {
    const val = storyConfig[key];
    document.querySelectorAll(`#${key}Grid .radio-chip`).forEach(c => {
      c.classList.toggle("selected", c.dataset.val === val);
    });
  });

  // 설정 버튼 OFF
  const sb = document.getElementById("settingsBtn");
  if (sb) { sb.classList.remove("active"); sb.innerHTML = "세계관 설정"; }

  applySettingsLock(false);
}

function _updateSettingsBtnLabel(isLocked) {
  const sb = document.getElementById("settingsBtn");
  if (!sb) return;
  sb.classList.add("active");
  sb.innerHTML = isLocked
    ? `세계관 설정 <span class="badge viewer">뷰어모드</span>`
    : `세계관 설정 <span class="badge">편집모드</span>`;
}

// ── 컨텍스트 UI 복원 ──────────────────────────────────────

function restoreContextUI(ctx) {
  if (!ctx) return;

  // 1. storyConfig 복원
  if (ctx.story_config) {
    Object.assign(storyConfig, ctx.story_config);
    // 슬라이더·입력값 동기화
    const sliderKeys = ["conflict","foreshadow","emotion","dialogue","direction"];
    sliderKeys.forEach(key => {
      const slider = document.getElementById(key + "Slider");
      const valEl  = document.getElementById(key + "Val");
      if (slider && storyConfig[key] != null) {
        slider.value = storyConfig[key];
        const pct = ((storyConfig[key] - 1) / 9 * 100).toFixed(1) + "%";
        slider.style.setProperty("--pct", pct);
        if (valEl) valEl.textContent = storyConfig[key];
      }
    });
    const volFields = [
      { id: "epLenInput",      key: "episodeLength"    },
      { id: "epVarInput",      key: "episodeLengthVar" },
      { id: "totalEpInput",    key: "totalEpisodes"    },
      { id: "totalEpVarInput", key: "totalEpisodesVar" },
    ];
    volFields.forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (el && storyConfig[key] != null) el.value = storyConfig[key];
    });
    // 시점·문체 라디오 칩
    ["pov","style"].forEach(key => {
      const val = storyConfig[key];
      if (!val) return;
      const gridId = key + "Grid";
      document.querySelectorAll(`#${gridId} .radio-chip`).forEach(c => {
        c.classList.toggle("selected", c.dataset.val === val);
      });
    });
  }

  // 2. 규칙 태그 초기화 (tag span만 제거, 입력 필드는 보존)
  ruleEntries.length = 0;
  document.querySelectorAll("#rulesWrap .tag").forEach(el => el.remove());

  // 3. 배경·세계관 칩 복원
  // world_rules에서 "장르: ..." 줄을 파싱해 settingVals/moodVals로 복원
  if (ctx.world_rules?.length) {
    const genreLine = ctx.world_rules.find(r => r.startsWith("장르: "));
    if (genreLine) {
      const genres = genreLine.replace("장르: ", "").split(", ").map(s => s.trim()).filter(Boolean);
      settingVals.length = 0;
      moodVals.length = 0;
      document.querySelectorAll("#settingGrid ~ .custom-chip, #moodGrid ~ .custom-chip").forEach(el => el.remove());
      document.querySelectorAll("#settingGrid .chip.selected, #moodGrid .chip.selected").forEach(c => c.classList.remove("selected"));

      genres.forEach(g => {
        const sChip = document.querySelector(`#settingGrid .chip[data-label="${g}"]`);
        const mChip = document.querySelector(`#moodGrid .chip[data-label="${g}"]`);
        if (sChip && settingVals.length < 3) {
          sChip.classList.add("selected");
          settingVals.push(g);
        } else if (mChip && moodVals.length < 3) {
          mChip.classList.add("selected");
          moodVals.push(g);
        } else if (!sChip && !mChip) {
          if (settingVals.length < 3) addChipDirect("settingGrid", settingVals, 3, g);
          else if (moodVals.length < 3) addChipDirect("moodGrid", moodVals, 3, g);
        }
      });

      // 최대 선택 수 도달 시 나머지 칩 희미하게 처리
      ["settingGrid", "moodGrid"].forEach(id => {
        const arr = id === "settingGrid" ? settingVals : moodVals;
        document.querySelectorAll(`#${id} .chip`).forEach(c => {
          if (c.classList.contains("selected")) { c.classList.remove("disabled"); return; }
          arr.length >= 3 ? c.classList.add("disabled") : c.classList.remove("disabled");
        });
      });
    }

    // 세계관 규칙 복원 (장르 줄 제외, soft 규칙)
    ctx.world_rules.filter(r => !r.startsWith("장르: ")).forEach(r => addRuleTagDirect(r, false));
  }

  // 4. 금지 설정 복원 (hard 규칙)
  if (ctx.forbidden_settings?.length) {
    ctx.forbidden_settings.forEach(r => addRuleTagDirect(r, true));
  }

  // 5. 인물 복원
  if (ctx.character_defaults && Object.keys(ctx.character_defaults).length) {
    const chars = Object.entries(ctx.character_defaults).map(([name, desc]) => {
      if (desc && typeof desc === "object") {
        // object 형식: { type, gender, personality, initial_items }
        return {
          name,
          personality: desc.personality || desc.description || "",
          type:        desc.type   || "인간",
          gender:      desc.gender || "해당없음",
          initialItems: Array.isArray(desc.initial_items) ? desc.initial_items : [],
        };
      }
      // legacy string 형식: "[유형: X, 성별: Y] 성격..."
      const typeMatch   = desc.match(/유형:\s*([^,\]]+)/);
      const genderMatch = desc.match(/성별:\s*([^\]]+)/);
      const personality = desc.replace(/\[[^\]]*\]\s*/, "").trim();
      return {
        name,
        personality,
        type:        typeMatch?.[1]?.trim()   || "인간",
        gender:      genderMatch?.[1]?.trim() || "해당없음",
        initialItems: [],
      };
    });

    charCount = Math.max(1, Math.min(10, chars.length));
    document.getElementById("charCountNum").textContent = charCount;
    const container = document.getElementById("charCards");
    container.innerHTML = "";
    const _shouldLockCards = Object.keys(episodeCache).some(k => Number(k) >= 2);
    chars.forEach((p, i) => {
      const c = appendCharCard(container, i, p);
      c.dataset.saved = "true";
      // 2화 이후 복원 시: 인물 카드를 확정 상태로 표시
      if (_shouldLockCards) {
        c.classList.add("locked");
        const lockBtn = c.querySelector(".char-lock-btn");
        if (lockBtn) { lockBtn.classList.add("locked"); lockBtn.textContent = "✔ 확정됨"; }
        const aiBtn = c.querySelector(".char-ai-btn");
        if (aiBtn) aiBtn.disabled = true;
        const nameInp = c.querySelector(".char-name");
        if (nameInp) { nameInp.readOnly = true; nameInp.style.pointerEvents = "none"; nameInp.style.opacity = ".5"; }
        c.querySelectorAll(".char-chip-label").forEach(el => { el.style.pointerEvents = "none"; el.style.opacity = ".5"; });
      }
    });
  }

  // 6. 설정 버튼 표시 (편집모드/뷰어모드)
  const _isLocked = Object.keys(episodeCache).some(k => Number(k) >= 2);
  _updateSettingsBtnLabel(_isLocked);

  // 7. 섹션 잠금 적용 (2화 생성 이후면 세계관 설정 고정 — 1화는 재생성 허용)
  applySettingsLock(_isLocked);
}

function lockCharCardFields(card, lock) {
  // 이름 입력
  const nameInp = card.querySelector(".char-name");
  if (nameInp) {
    nameInp.readOnly = lock;
    nameInp.style.pointerEvents = lock ? "none" : "";
    nameInp.style.opacity = lock ? ".5" : "";
  }
  // 유형·성별 칩 드롭다운
  card.querySelectorAll(".char-chip-label").forEach(el => {
    el.style.pointerEvents = lock ? "none" : "";
    el.style.opacity = lock ? ".5" : "";
  });
  // 성격·특성 textarea 및 preview box
  const ta = card.querySelector(".char-personality");
  if (ta) { ta.readOnly = lock; ta.style.pointerEvents = lock ? "none" : ""; ta.style.opacity = lock ? ".7" : ""; }
  const preview = card.querySelector(".char-personality-preview-box");
  if (preview) { preview.style.pointerEvents = lock ? "none" : ""; }
  // 구체화 버튼
  const refineBtn = card.querySelector(".char-refine-btn");
  if (refineBtn) { refineBtn.disabled = lock; refineBtn.style.opacity = lock ? ".25" : ""; refineBtn.style.pointerEvents = lock ? "none" : ""; }
  // AI 추천 버튼
  const aiBtn = card.querySelector(".char-ai-btn");
  if (aiBtn) { aiBtn.disabled = lock; aiBtn.style.opacity = lock ? ".25" : ""; aiBtn.style.pointerEvents = lock ? "none" : ""; }
  // 소지품 입력창 (Enter 추가 금지)
  const itemsInp = card.querySelector(".char-items-input");
  if (itemsInp) { itemsInp.disabled = lock; itemsInp.style.display = lock ? "none" : ""; }
  // 소지품 태그 삭제 버튼 + 에디터 패널 진입 잠금
  card.classList.toggle("items-viewer-locked", lock);
  // 소지품 에디터 패널 닫기
  const edPanel = card.querySelector(".char-item-editor-panel");
  if (edPanel && lock) edPanel.classList.remove("open");
  // 소지품 AI 추천 버튼 (에디터 내)
  const itemAiBtn = card.querySelector(".item-ai-suggest-btn");
  if (itemAiBtn) { itemAiBtn.disabled = lock; itemAiBtn.style.opacity = lock ? ".25" : ""; itemAiBtn.style.pointerEvents = lock ? "none" : ""; }
  // hint 텍스트 숨김
  const hint = card.querySelector(".char-items-hint");
  if (hint) hint.style.display = lock ? "none" : "";
  // 뷰어 모드 배지
  card.dataset.viewerLocked = lock ? "true" : "";
}

function applySettingsLock(lock) {
  const pairs = [
    ["sectionFieldI",    "lockBadgeI"],
    ["sectionFieldII",   "lockBadgeII"],
    ["sectionFieldIII",  "lockBadgeIII"],
    ["sectionFieldIV",   "lockBadgeIV"],
    ["sectionFieldV",    "lockBadgeV"],
    ["sectionFieldVI",   "lockBadgeVI"],
    ["sectionFieldVII",  "lockBadgeVII"],
    ["sectionFieldVIII", "lockBadgeVIII"],
  ];
  pairs.forEach(([fieldId, badgeId]) => {
    const field = document.getElementById(fieldId);
    const badge = document.getElementById(badgeId);
    if (!field || !badge) return;
    field.classList.toggle("section-locked", lock);
    badge.classList.toggle("visible", lock);
  });

  // 섹션 III — 세계관 규칙 tag 입력 비활성화
  const rulesInput = document.getElementById("rulesInput");
  if (rulesInput) { rulesInput.disabled = lock; rulesInput.style.display = lock ? "none" : ""; }
  const rulesAiBtn = document.getElementById("rulesAiBtn");
  if (rulesAiBtn) { rulesAiBtn.disabled = lock; rulesAiBtn.style.opacity = lock ? ".25" : ""; rulesAiBtn.style.pointerEvents = lock ? "none" : ""; }

  // 섹션 IV — 인물 수 조절 + AI 추천 버튼 비활성화
  ["charCountMinus","charCountPlus","allCharAiBtn"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.disabled = lock; el.style.opacity = lock ? ".25" : ""; el.style.pointerEvents = lock ? "none" : ""; }
  });

  // 섹션 VII — 분량 입력 비활성화
  ["epLenInput","epVarInput","totalEpInput","totalEpVarInput"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.disabled = lock; el.style.opacity = lock ? ".45" : ""; }
  });

  // 섹션 VIII — 슬라이더 비활성화
  ["conflictSlider","foreshadowSlider","emotionSlider","dialogueSlider","directionSlider"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.disabled = lock; el.style.opacity = lock ? ".45" : ""; }
  });

  // 인물카드 이름·유형·성별 잠금 — data-saved 있는 카드만 (중간 생성 신규 카드는 저장 전까지 자유)
  document.querySelectorAll(".char-card[data-saved]").forEach(card => {
    lockCharCardFields(card, lock);
  });

  // 설정 버튼 레이블 동기화
  _updateSettingsBtnLabel?.(lock);
}

// ── 커스텀 다이얼로그 ──────────────────────────────────────

function _fsDialog({ icon = "", title = "", desc = "", inputPlaceholder = null, inputValue = "", buttons = [], extraHtml = "" }) {
  return new Promise(resolve => {
    const overlay = document.getElementById("fsDialogOverlay");
    const iconEl  = document.getElementById("fsDialogIcon");
    const titleEl = document.getElementById("fsDialogTitle");
    const descEl  = document.getElementById("fsDialogDesc");
    const inputEl = document.getElementById("fsDialogInput");
    const actionsEl = document.getElementById("fsDialogActions");

    iconEl.textContent  = icon;
    iconEl.style.display = icon ? "block" : "none";
    titleEl.textContent = title;
    descEl.textContent  = desc;
    descEl.style.display = desc ? "block" : "none";

    // extra HTML (복선 목록 등)
    let extraEl = document.getElementById("fsDialogExtra");
    if (!extraEl) {
      extraEl = document.createElement("div");
      extraEl.id = "fsDialogExtra";
      actionsEl.parentNode.insertBefore(extraEl, actionsEl);
    }
    extraEl.innerHTML = extraHtml;
    extraEl.style.display = extraHtml ? "block" : "none";

    if (inputPlaceholder !== null) {
      inputEl.style.display = "block";
      inputEl.placeholder = inputPlaceholder;
      inputEl.value = inputValue;
    } else {
      inputEl.style.display = "none";
    }

    actionsEl.innerHTML = "";
    buttons.forEach(({ label, cls = "", value }) => {
      const btn = document.createElement("button");
      btn.className = `fs-dialog-btn ${cls}`;
      btn.textContent = label;
      btn.onclick = () => { _closeDialog(); resolve(value); };
      actionsEl.appendChild(btn);
    });

    overlay.classList.add("open");

    const onKey = e => {
      if (e.key === "Escape") { _closeDialog(); resolve(null); document.removeEventListener("keydown", onKey); }
      if (e.key === "Enter" && inputPlaceholder !== null) {
        const primary = buttons.find(b => b.cls?.includes("primary"));
        if (primary) { _closeDialog(); resolve(inputEl.value.trim() || null); document.removeEventListener("keydown", onKey); }
      }
    };
    document.addEventListener("keydown", onKey);

    if (inputPlaceholder !== null) setTimeout(() => inputEl.focus(), 80);
  });
}

function _closeDialog() {
  document.getElementById("fsDialogOverlay").classList.remove("open");
}

async function showPrompt({ icon = "📖", title, desc = "", placeholder = "", defaultValue = "" }) {
  const val = await _fsDialog({
    icon, title, desc, inputPlaceholder: placeholder, inputValue: defaultValue,
    buttons: [
      { label: "취소", cls: "", value: "__cancel__" },
      { label: "확인", cls: "primary", value: "__input__" },
    ],
  });
  if (val === "__cancel__" || val === null) return null;
  const input = document.getElementById("fsDialogInput").value.trim();
  return input || null;
}

async function showConfirm({ icon = "⚠️", title, desc = "" }) {
  const val = await _fsDialog({
    icon, title, desc,
    buttons: [
      { label: "취소", cls: "", value: false },
      { label: "삭제", cls: "danger", value: true },
    ],
  });
  return val === true;
}

// ── 인증 & 책/프로필/복선 초기화 ────────────────────────────

let currentUser = null;
let _allBooks   = [];

async function initAuth() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth_error")) {
    const msg = params.get("msg") ? decodeURIComponent(params.get("msg")) : "";
    showLoginOverlay(msg ? `로그인 실패: ${msg}` : "로그인에 실패했습니다. 다시 시도해주세요.");
    history.replaceState({}, "", "/");
    return;
  }
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) { showLoginOverlay(); return; }
    const { user } = await res.json();
    currentUser = user;
    showUserBar(user);
    await runCalibrationIfNeeded(user);
    await initBooks();
    initVoiceArchive?.();
  } catch {
    showLoginOverlay();
  }
}

function showLoginOverlay(errorMsg) {
  document.getElementById("loginOverlay").style.display = "flex";
  if (errorMsg) {
    const errEl = document.getElementById("loginErrorMsg");
    if (errEl) { errEl.textContent = errorMsg; errEl.style.display = "block"; }
    else showToast(errorMsg, "err", 6000);
  }
}

function showUserBar(user) {
  const bar    = document.getElementById("userBar");
  const name   = document.getElementById("userDisplayName");
  const avatar = document.getElementById("userAvatar");
  if (!bar) return;
  const display = user.displayName || user.email || "—";
  name.textContent = display;

  // 이메일 표시
  const emailEl = document.getElementById("userEmail");
  if (emailEl) emailEl.textContent = user.email || "";

  // Google 프로필 사진
  if (user.picture) {
    avatar.innerHTML = `<img src="${user.picture}" alt="${display}" referrerpolicy="no-referrer" />`;
  } else {
    avatar.textContent = display.charAt(0).toUpperCase();
  }
  bar.style.display = "flex";
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  location.reload();
}

// ── 책 초기화 ─────────────────────────────────────────────

async function initBooks() {
  const res = await fetch("/api/books");
  const { books } = await res.json();
  _allBooks = books;

  if (!books.length) {
    await createNewBook("새 이야기");
    return;
  }

  renderBookList(books, books[0].id);
  showBookListToggle();   // selectBook 성공 여부와 무관하게 즉시 표시
  await selectBook(books[0]);
}

async function createNewBook(title) {
  const inputTitle = title ?? await showPrompt({
    icon: "📖",
    title: "새 책 만들기",
    desc: "이 책의 제목을 입력하세요.",
    placeholder: "예: 달빛 아래의 검사",
    defaultValue: "",
  });
  if (!inputTitle) return;

  const res = await fetch("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: inputTitle }),
  });
  const data = await res.json();
  if (!res.ok) { showToast(data.message ?? "책 생성 실패", "err"); return; }
  const { book } = data;

  const listRes = await fetch("/api/books");
  const { books } = await listRes.json();
  _allBooks = books;
  renderBookList(books, book.id);
  showBookListToggle();
  await selectBook(book);
}

// ── selectBook 단계 함수들 ─────────────────────────────────

function _setActiveBook(book) {
  bookId            = book.id;
  activeBookTitle   = book.title ?? "";
  currentEpisode    = book.current_episode ?? 1;
  _openActIndices.clear();
  _arcSeeded = false;
}

function _clearStorySurface() {
  // episodeCache, output, debug panels, episode list, arc — bookList 영역 절대 건드리지 않음
  Object.keys(episodeCache).forEach(k => delete episodeCache[k]);
  displayedEpisode = null;
  output.innerHTML = "";
  if (typeof _clearDebugPanels   === "function") _clearDebugPanels();
  if (typeof updateSceneCharPanel === "function") updateSceneCharPanel([]);
  clearStoryProgressUI();
}

async function _loadEpisodes(bid) {
  try {
    const res = await fetch(`/api/episodes/${bid}/all`);
    if (!res.ok) { console.error(`[selectBook] episodes API ${res.status}`); return []; }
    const { episodes } = await res.json();
    console.debug("[selectBook] episodes fetched", { count: episodes.length });
    return Array.isArray(episodes) ? episodes : [];
  } catch (e) {
    console.error("[selectBook] failed at episodes load", e);
    return [];
  }
}

function _renderLatestEpisode(episodes) {
  const safeEps = Array.isArray(episodes) ? episodes : [];
  for (const ep of safeEps) {
    if (ep?.episode_number != null) episodeCache[ep.episode_number] = ep.content || "";
  }

  if (!safeEps.length) {
    displayedEpisode = null;
    currentEpisode   = 1;
    output.innerHTML = "";
    if (typeof updateDebugCharStates === "function") updateDebugCharStates([]);
    updateEpisodeListUI();
    console.debug("[selectBook] no episodes — blank state");
    return;
  }

  const latest = safeEps[safeEps.length - 1];
  displayedEpisode = latest.episode_number;
  currentEpisode   = displayedEpisode + 1;

  if (typeof _ppReset === "function") _ppReset();

  const content = latest.content || episodeCache[displayedEpisode] || "";
  console.debug("[selectBook] latest episode", { displayedEpisode, contentLen: content.length });

  if (content) {
    renderProgressive(content, true);
    // renderProgressive가 빈 결과를 낼 경우 텍스트 fallback
    if (!output.textContent.trim()) {
      console.warn("[selectBook] renderProgressive produced empty output; fallback to textContent");
      output.textContent = content;
    }
  } else {
    output.innerHTML = `<p class="empty-state">본문을 불러오지 못했습니다.</p>`;
  }

  console.debug("[selectBook] renderProgressive done", { outputLen: output.textContent.length });
  updateEpisodeListUI();
}

async function _restoreContextSafely(bid) {
  clearWorldSettingsUI();
  try {
    const res = await fetch(`/api/context/${bid}`);
    if (res.ok) { restoreContextUI(await res.json()); }
    console.debug("[selectBook] context restored");
  } catch (e) { console.error("[selectBook] context restore failed", e); }
}

async function _restoreCharsSafely(bid) {
  window.charGenderMap   = {};
  window.charInferredMap = {};
  let needFallback = false;
  try {
    const res = await fetch(`/api/characters/${bid}`);
    if (res.ok) {
      const { characters } = await res.json();
      for (const c of (characters ?? [])) {
        if (!c.name) continue;
        const g = c.gender;
        window.charGenderMap[c.name] = (g === "남성" || g === "여성") ? g : null;
      }
    }
  } catch (_) {}

  if (displayedEpisode) {
    const ep = displayedEpisode;
    Promise.all([
      fetch(`/api/generate/char-states?book_id=${bid}&episode=${ep}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/generate/audit-status?book_id=${bid}&episode=${ep}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([d, auditData]) => {
      if (d?.char_states?.length) {
        updateSceneCharPanel(d.char_states);
        wrapCharNamesInOutput(d.char_states);
        if (typeof updateDebugCharStates === "function") updateDebugCharStates(d.char_states);
      } else { needFallback = true; }
      if (auditData?.status === "done") {
        window._lastAuditStatus = auditData;
        if (!window._lastEpisodeMeta) window._lastEpisodeMeta = {};
        if (typeof updateDebugMeta === "function") updateDebugMeta(window._lastEpisodeMeta, auditData);
      }
    }).catch(() => { needFallback = true; })
    .finally(() => {
      if (needFallback) _applyCharGenderFallback();
      if (typeof _renderPostprocStats === "function") _renderPostprocStats();
      console.debug("[selectBook] char states restored");
    });
  }
}

async function _updateSidebarsSafely(bid) {
  try {
    updateArcUI(currentEpisode - 1 || 0);
    await Promise.all([loadProfile(), loadForeshadowStats(), loadSessionStats()]);
    await loadOverrides?.();
    updateEpisodeUI();
    updateOutputHeader();
    console.debug("[selectBook] sidebar updated");
  } catch (e) { console.error("[selectBook] sidebar update failed", e); }
}

// ── 메인 오케스트레이터 ─────────────────────────────────────

async function selectBook(book) {
  console.debug("[selectBook] start", { id: book?.id, title: book?.title });

  _setActiveBook(book);
  _clearStorySurface();
  console.debug("[selectBook] clear story UI done");

  const episodes = await _loadEpisodes(book.id);
  _renderLatestEpisode(episodes);

  // 본문 렌더 완료 후 context/chars/sidebar 순차 실행 (실패 격리)
  await _restoreContextSafely(book.id);
  _restoreCharsSafely(book.id);           // fire-and-forget (내부적으로 async)
  await _updateSidebarsSafely(book.id);

  const epCount = Object.keys(episodeCache).length;
  if (epCount > 0) showToast(`${book.title} — ${epCount}화 불러왔습니다.`, "info", 2000);
  console.debug("[selectBook] done", { epCount, outputLen: output.textContent.length });
}

// ── 책 목록 접기/펼치기 ────────────────────────────────────

let _bookListManuallyOpen = false;

function _collapseBookList(activeTitle) {
  const wrap   = document.getElementById("bookListWrap");
  const toggle = document.getElementById("bookListToggle");
  if (!wrap || !toggle) return;
  toggle.style.display = "flex";
  // 사용자가 수동으로 열었으면 접지 않음 (연속 삭제 등 작업 편의)
  if (_bookListManuallyOpen) return;
  wrap.classList.add("collapsed");
  toggle.classList.add("collapsed");
}

async function ensureBookListLoaded() {
  const list = document.getElementById("bookList");
  if (!list) return [];
  try {
    const res = await fetch("/api/books", { cache: "no-store" });
    if (!res.ok) throw new Error(`books fetch failed: ${res.status}`);
    const data = await res.json();
    const books = Array.isArray(data.books) ? data.books : [];
    _allBooks = books;
    renderBookList(books, bookId);
    return books;
  } catch (err) {
    console.error("[book-list] failed to load books", err);
    list.innerHTML = `<div class="book-list-empty book-list-error">책 목록을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.</div>`;
    return [];
  }
}

async function toggleBookList() {
  const wrap   = document.getElementById("bookListWrap");
  const toggle = document.getElementById("bookListToggle");
  if (!wrap || !toggle) return;

  showBookListToggle();

  const willOpen = wrap.classList.contains("collapsed") || !document.querySelector("#bookList .book-item");

  if (willOpen) {
    await ensureBookListLoaded();
    wrap.classList.remove("collapsed");
    wrap.hidden = false;
    wrap.style.removeProperty("display");
    wrap.style.maxHeight = "none";
    wrap.style.height = "auto";
    wrap.style.overflow = "visible";
    toggle.classList.remove("collapsed");
  } else {
    wrap.classList.add("collapsed");
    toggle.classList.add("collapsed");
  }

  const labelEl = toggle.querySelector(".book-list-toggle-label");
  if (labelEl) labelEl.textContent = wrap.classList.contains("collapsed") ? "서재 펼치기" : "서재 접기";
  _bookListManuallyOpen = !wrap.classList.contains("collapsed");
}

// ── 책 삭제 ───────────────────────────────────────────────

async function deleteBook(b) {
  const ok = await showConfirm({
    icon: "🗑️",
    title: `"${b.title}" 삭제`,
    desc: "삭제하면 모든 에피소드와 설정이 사라집니다.\n이 작업은 되돌릴 수 없습니다.",
  });
  if (!ok) return;

  await fetch(`/api/books/${b.id}`, { method: "DELETE" });

  const listRes = await fetch("/api/books");
  const { books } = await listRes.json();
  _allBooks = books;

  if (!books.length) {
    await createNewBook("새 이야기");
    return;
  }

  const nextBook = books[0];
  renderBookList(books, nextBook.id);
  await selectBook(nextBook);
  showToast(`"${b.title}" 삭제됨`, "warn", 2500);
}

// ── 책 목록 토글 — 항상 표시 (조건부 없음) ───────────────
function showBookListToggle() {
  const toggle = document.getElementById("bookListToggle");
  const wrap   = document.getElementById("bookListWrap");
  if (toggle) {
    toggle.style.removeProperty("display");
    toggle.hidden = false;
    toggle.classList.remove("hidden", "collapsed");
  }
  if (wrap) {
    wrap.hidden = false;
    wrap.style.removeProperty("display");
    wrap.classList.remove("collapsed");
  }
  // 라벨 동기화: 접혀있지 않으므로 "서재 접기"
  const labelEl = toggle?.querySelector(".book-list-toggle-label");
  if (labelEl) labelEl.textContent = "서재 접기";
}
// 하위 호환 alias
function updateBookListToggleVisibility() { showBookListToggle(); }

// ── 이야기 진행 UI 초기화 (book list는 건드리지 않음) ──────
function clearStoryProgressUI() {
  const arcSection = document.getElementById("arcSection");
  if (arcSection) arcSection.style.display = "none";
  const arcDivider = document.getElementById("arcDivider");
  if (arcDivider) arcDivider.style.display = "none";
  const arcActList = document.getElementById("arcActList");
  if (arcActList) arcActList.innerHTML = "";
  const epListCount = document.getElementById("epListCount");
  if (epListCount) epListCount.textContent = "";
  const epList = document.getElementById("episodeList");
  if (epList) epList.innerHTML = "";
  const header = document.getElementById("outputHeader");
  if (header) header.style.display = "none";
  ["statTotalSessions","statAvgCompletion","statAvgTime"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "—";
  });
  document.querySelectorAll(".metric-fill[data-key]").forEach(el => el.style.width = "0%");
  document.querySelectorAll(".metric-val[data-key]").forEach(el => el.textContent = "0");
  const dirBadge = document.getElementById("directorBadge");
  if (dirBadge) { dirBadge.textContent = ""; dirBadge.style.display = "none"; }
}

// ── 책 목록 렌더링 ─────────────────────────────────────────

function renderBookList(books, activeId) {
  const list = document.getElementById("bookList");
  if (!list) return;

  showBookListToggle();

  list.innerHTML = "";
  const allBooks = Array.isArray(books) ? books : [];

  if (!allBooks.length) {
    list.innerHTML = `<div class="book-list-empty">아직 책이 없습니다. 새 책을 만들어 시작하세요.</div>`;
    return;
  }

  allBooks.forEach((b, idx) => {
    const item = document.createElement("div");
    item.className = "book-item" + (b.id === activeId ? " active" : "");
    item.dataset.id = b.id;
    const epCount = b.id === bookId
      ? Object.keys(episodeCache).length
      : (b.current_episode ?? 1) - 1;
    const epLabel = epCount > 0 ? `${epCount}화 완성` : "시작 전";
    const updatedAt = b.updated_at ? new Date(b.updated_at) : null;
    const dateLabel = updatedAt ? updatedAt.toLocaleDateString("ko-KR", { month:"numeric", day:"numeric" }) : "";
    const subText = [epLabel, dateLabel].filter(Boolean).join(" · ");
    item.innerHTML = `
      <div class="book-item-icon">${idx + 1}</div>
      <div class="book-item-body">
        <span class="book-item-title">${esc(b.title)}</span>
        <span class="book-item-sub">${subText}</span>
      </div>
      <div class="book-item-actions">
        <button class="book-item-edit" title="제목 수정" aria-label="제목 수정">✎</button>
        <button class="book-item-del" title="이 책 삭제" aria-label="삭제">✕</button>
      </div>
    `;

    function startTitleEdit() {
      const titleSpan = item.querySelector(".book-item-title");
      const inp = document.createElement("input");
      inp.className = "book-item-edit-input";
      inp.value = b.title;
      titleSpan.replaceWith(inp);
      inp.focus(); inp.select();
      let saved = false;
      async function saveEdit() {
        if (saved) return; saved = true;
        const newTitle = inp.value.trim();
        if (!newTitle || newTitle === b.title) { renderBookList(_allBooks, bookId); return; }
        const r = await fetch(`/api/books/${b.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        });
        const data = await r.json();
        if (!r.ok) { showToast(data.message ?? "제목 수정 실패", "err"); renderBookList(_allBooks, bookId); return; }
        b.title = newTitle;
        const inAllBooks = _allBooks.find(fb => fb.id === b.id);
        if (inAllBooks) inAllBooks.title = newTitle;
        if (b.id === bookId) { activeBookTitle = newTitle; updateOutputHeader?.(); }
        renderBookList(_allBooks, bookId);
        showToast("제목이 수정됐습니다.", "ok", 1800);
      }
      inp.addEventListener("keydown", e => {
        if (e.key === "Enter")  { e.preventDefault(); saveEdit(); }
        if (e.key === "Escape") { saved = true; renderBookList(_allBooks, bookId); }
      });
      inp.addEventListener("blur", saveEdit);
    }

    item.querySelector(".book-item-edit").onclick = e => { e.stopPropagation(); startTitleEdit(); };
    item.querySelector(".book-item-title").ondblclick = e => { e.stopPropagation(); startTitleEdit(); };

    item.querySelector(".book-item-del").onclick = e => {
      e.stopPropagation();
      const actions = item.querySelector(".book-item-actions");
      actions.innerHTML = `
        <button class="bic-cancel">취소</button>
        <button class="bic-ok">삭제</button>
      `;
      actions.querySelector(".bic-cancel").onclick = e2 => { e2.stopPropagation(); renderBookList(_allBooks, bookId); };
      actions.querySelector(".bic-ok").onclick = async e2 => {
        e2.stopPropagation();
        await fetch(`/api/books/${b.id}`, { method: "DELETE" });
        const { books } = await (await fetch("/api/books")).json();
        _allBooks = books;
        if (!books.length) { await createNewBook("새 이야기"); return; }
        const next = books[0];
        renderBookList(books, next.id);
        await selectBook(next);
        showToast(`"${b.title}" 삭제됨`, "warn", 2500);
      };
    };
    item.onclick = async () => {
      if (b.id === bookId) return;
      const freshRes = await fetch("/api/books");
      const { books: fresh } = await freshRes.json();
      _allBooks = fresh;
      const selected = fresh.find(fb => fb.id === b.id);
      if (selected) { renderBookList(fresh, selected.id); await selectBook(selected); }
    };
    list.appendChild(item);
  });
  if (!list.querySelector(".book-item")) {
    console.warn("[renderBookList] books > 0 but no .book-item rendered — check book objects");
    list.innerHTML = `<div class="book-list-empty">표시할 책이 없습니다.</div>`;
  }
  showBookListToggle();
}

// ── 에피소드 목록 사이드바 ─────────────────────────────────

function updateEpisodeListUI() {
  const list  = document.getElementById("episodeList");
  const count = document.getElementById("epListCount");
  if (!list) return;

  const nums = Object.keys(episodeCache).map(Number).sort((a, b) => a - b);
  if (count) count.textContent = nums.length ? `${nums.length}화` : "";

  list.innerHTML = "";
  nums.forEach(n => {
    const btn = document.createElement("button");
    btn.className = "ep-list-item" + (n === displayedEpisode ? " active" : "");
    btn.innerHTML = `<span class="ep-list-dot"></span>${n}화`;
    btn.onclick = () => {
      displayedEpisode = n;
      renderProgressive(episodeCache[n], true);
      updateEpisodeUI();
      updateEpisodeListUI();
      updateOutputHeader();
      _loadAndApplyCharStates?.(n);
    };
    list.appendChild(btn);
  });
}

// ── 출력 헤더 (화 라벨 + 글자 수) ────────────────────────

function updateOutputHeader() {
  const header    = document.getElementById("outputHeader");
  const bookTitleEl = document.getElementById("outputBookTitle");
  const epSepEl   = document.getElementById("outputEpSep");
  const epLabel   = document.getElementById("outputEpLabel");
  const charCount = document.getElementById("outputCharCount");
  if (!header) return;

  if (displayedEpisode && episodeCache[displayedEpisode]) {
    header.style.display = "flex";
    if (bookTitleEl) bookTitleEl.textContent = activeBookTitle || "";
    if (epSepEl)    epSepEl.style.display = activeBookTitle ? "" : "none";
    if (epLabel)    epLabel.textContent    = `${displayedEpisode}화`;
    if (charCount) {
      const len = episodeCache[displayedEpisode].replace(/\s/g, "").length;
      charCount.textContent = `${len.toLocaleString()}자`;
    }
  } else {
    header.style.display = "none";
  }
}

// ── 복선 — 사이드바 비표시, 결말 후 버튼만 ────────────────

async function loadForeshadowStats() {
  if (!bookId) return;
  try {
    const res = await fetch(`/api/episodes/${bookId}/foreshadows`);
    if (!res.ok) return;
    const { stats } = await res.json();
    // 결말 완성 여부: 완성 화수 >= totalEpisodes
    const done = Object.keys(episodeCache).length >= (storyConfig.totalEpisodes ?? 20);
    const hasForeshadow = (stats.open ?? 0) + (stats.resolved ?? 0) > 0;
    const btn = document.getElementById("foreshadowRevealBtn");
    if (btn) btn.style.display = (done && hasForeshadow) ? "block" : "none";
  } catch (e) { console.error(e); }
}

// 복선 보기 모달 (결말 후 호출)
async function showForeshadowReveal() {
  if (!bookId) return;
  try {
    const res = await fetch(`/api/episodes/${bookId}/foreshadows`);
    if (!res.ok) return;
    const { foreshadows } = await res.json();
    if (!foreshadows.length) { showToast("심어진 복선이 없습니다.", "warn"); return; }

    const rows = foreshadows.map(f => {
      const ep = f.planted_episode ? `<span style="color:var(--accent);font-size:.75em;margin-right:.4rem;">${f.planted_episode}화</span>` : "";
      const resolved = f.status === "resolved"
        ? `<span style="color:var(--success,#4ade80);font-size:.7em;margin-left:.4rem;">✓ 회수됨</span>` : "";
      return `<div style="padding:.5rem 0;border-bottom:1px solid var(--border1,rgba(255,255,255,.07));font-size:.82em;color:var(--text2);">${ep}${esc(f.content)}${resolved}</div>`;
    }).join("");

    await _fsDialog({
      icon: "🔍",
      title: "이 이야기에 숨겨진 복선들",
      desc: `총 ${foreshadows.length}개의 복선이 심어져 있었습니다.`,
      extraHtml: `<div style="max-height:300px;overflow-y:auto;margin-top:.6rem;">${rows}</div>`,
      buttons: [{ label: "닫기", cls: "primary", value: null }],
    });
  } catch (e) { console.error(e); }
}

// ── 독자 프로필 ────────────────────────────────────────────

async function loadProfile() {
  if (!bookId) return;
  try {
    const res = await fetch(`/api/books/${bookId}/profile`);
    if (!res.ok) return;
    const { profile } = await res.json();
    updateProfileUI(profile);
  } catch (e) { console.error(e); }
}

function updateProfileUI(profile) {
  drawHexagon(profile);
  ["focus","sentiment","urgency","complexity","dialogue","audio_sync"].forEach(key => {
    const fill = document.querySelector(`.metric-fill[data-key="${key}"]`);
    const val  = document.querySelector(`.metric-val[data-key="${key}"]`);
    const v = profile[key] ?? 0;
    if (fill) fill.style.width = `${v}%`;
    if (val)  val.textContent  = v;
  });
}

// ── Reading Hexagon SVG — 6-axis radar chart ───────────────
const HEX_KEYS   = ["focus","sentiment","urgency","complexity","dialogue","audio_sync"];
const HEX_LABELS = ["집중","감정","긴장","복잡","대화","음성"];
const HEX_TIPS   = [
  "집중\n긴 호흡의 문장, 깊이 파고드는\n서술 방식을 얼마나 좋아하는지",
  "감정\n기쁨·슬픔·분노 등 감정 기복이\n큰 이야기를 얼마나 즐기는지",
  "긴장\n위기, 갈등, 반전이 자주 등장하는\n빠른 전개를 얼마나 선호하는지",
  "복잡\n여러 인물 시점, 복잡한 관계·음모가\n얽힌 이야기를 얼마나 좋아하는지",
  "대화\n설명보다 인물 간 대화로\n이야기가 전개되는 것을 선호하는지",
  "음성\n소리내어 읽기·청독 기능을\n얼마나 자주 사용하는지",
];

function drawHexagon(profile) {
  const svg = document.getElementById("hexagonSvg");
  if (!svg) return;

  const cx = 95, cy = 85, R = 62;
  const angles = HEX_KEYS.map((_, i) => Math.PI / 2 + (2 * Math.PI * i / 6) * -1);
  const pt = (r, i) => [cx + r * Math.cos(angles[i]), cy - r * Math.sin(angles[i])];

  const gridLines = [0.33, 0.66, 1.0].map(f => {
    const pts = HEX_KEYS.map((_, i) => pt(R * f, i).join(",")).join(" ");
    const op = f === 1.0 ? "0.35" : "0.2";
    return `<polygon points="${pts}" fill="none" stroke="var(--border2)" stroke-width="${f===1?1:.7}" opacity="${op}"/>`;
  }).join("");

  const spokes = HEX_KEYS.map((_, i) => {
    const [x, y] = pt(R, i);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--border2)" stroke-width="0.7" opacity="0.3"/>`;
  }).join("");

  const vals = HEX_KEYS.map(k => (profile[k] ?? 0) / 100);
  const dataPts = vals.map((v, i) => pt(R * v, i).join(",")).join(" ");

  // 각 축 라벨 — data-htip 속성으로 플로팅 툴팁 연동
  const labelEls = HEX_KEYS.map((k, i) => {
    const [x, y] = pt(R + 16, i);
    return `<g class="hex-axis-g" data-htip="${HEX_TIPS[i]}" style="cursor:help;">
      <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central"
        font-size="19" fill="var(--text3)" font-family="inherit">${HEX_LABELS[i]}</text>
    </g>`;
  }).join("");

  svg.innerHTML = `
    ${gridLines}${spokes}
    <polygon points="${dataPts}" fill="var(--accent)" fill-opacity="0.15" stroke="var(--accent)" stroke-width="1.8"/>
    ${vals.map((v,i)=>{const[x,y]=pt(R*v,i);return`<circle cx="${x}" cy="${y}" r="3.5" fill="var(--accent)" opacity="0.9"/>`;}).join("")}
    ${labelEls}`;

  _setupHexTooltip(svg);
  _renderHexLegend(profile);
}

function _renderHexLegend(profile) {
  const grid = document.getElementById("hexLegendGrid");
  if (!grid) return;
  const descs = ["몰입형 집중","감정 기복","긴장·갈등","복잡 서사","대화 비중","BGM 동기화"];
  grid.innerHTML = HEX_KEYS.map((k, i) => {
    const v = profile[k] ?? 0;
    const bar = Math.round(v);
    return `<div class="hex-leg-item" data-tip="${HEX_TIPS[i]}">
      <div class="hex-leg-header">
        <span class="hex-leg-label">${HEX_LABELS[i]}</span>
        <span class="hex-leg-val">${v}</span>
      </div>
      <div class="hex-leg-track">
        <div class="hex-leg-fill" style="width:${bar}%"></div>
      </div>
    </div>`;
  }).join("");
}

function _setupHexTooltip(svg) {
  const tip = document.getElementById("hexFloatTip");
  if (!tip) return;

  svg.addEventListener("mousemove", e => {
    const g = e.target.closest("[data-htip]");
    if (g) {
      tip.textContent = "";
      // multi-line via \n
      g.dataset.htip.split("\n").forEach((line, i) => {
        if (i > 0) tip.appendChild(document.createElement("br"));
        tip.appendChild(document.createTextNode(line));
      });
      tip.style.display = "block";
      tip.style.left = (e.clientX + 14) + "px";
      tip.style.top  = (e.clientY - 10) + "px";
    } else {
      tip.style.display = "none";
    }
  });
  svg.addEventListener("mouseleave", () => { tip.style.display = "none"; });
}

// ── 아크 진행 ────────────────────────────────────────────

function _computeAct(ep, total) {
  // total: 예상 총 화수 (storyConfig.totalEpisodes)
  const t = Math.max(total || 20, ep);  // ep가 total 초과해도 마지막 막 유지
  let acts;
  if (t <= 6) {
    acts = [{ n: "전반", end: Math.ceil(t / 2) }, { n: "후반", end: t }];
  } else if (t <= 20) {
    // 3막: 발단(30%) / 전개+위기(40%) / 결말(30%)
    acts = [
      { n: "1막", end: Math.ceil(t * 0.30) },
      { n: "2막", end: Math.ceil(t * 0.70) },
      { n: "3막", end: t },
    ];
  } else {
    // 4막: 발단(20%) / 전개(30%) / 위기(30%) / 결말(20%)
    acts = [
      { n: "1막", end: Math.ceil(t * 0.20) },
      { n: "2막", end: Math.ceil(t * 0.50) },
      { n: "3막", end: Math.ceil(t * 0.80) },
      { n: "4막", end: t },
    ];
  }
  let actStart = 1;
  for (let i = 0; i < acts.length; i++) {
    const actEnd = acts[i].end;
    if (ep <= actEnd) {
      const span = actEnd - actStart + 1;
      const pct  = Math.min(100, Math.round(((ep - actStart) / span) * 100));
      return { name: `제${i + 1}막`, range: `${actStart}–${actEnd}화`, pct, arcStart: actStart, arcEnd: actEnd };
    }
    actStart = acts[i].end + 1;
  }
  const last = acts[acts.length - 1];
  return { name: `제${acts.length}막`, range: `${actStart}–${last.end}화`, pct: 100, arcStart: actStart, arcEnd: last.end };
}

const _openActIndices = new Set();  // 사용자가 펼친 막 인덱스 기억
let _arcSeeded = false;             // 최초 1회만 현재 막 자동 펼침

function updateArcUI(ep) {
  const section = document.getElementById("arcSection");
  if (!section || !ep || ep < 1) return;

  const total  = storyConfig.totalEpisodes ?? 20;
  section.style.display = "block";
  const divider = document.getElementById("arcDivider");
  if (divider) divider.style.display = "block";

  // 전체 막 목록 계산
  const t = Math.max(total, ep);
  let acts;
  if (t <= 6)       acts = [{ n:"전반", s:1, e:Math.ceil(t/2) }, { n:"후반", s:Math.ceil(t/2)+1, e:t }];
  else if (t <= 20) acts = [{ n:"1막", s:1, e:Math.ceil(t*.30) }, { n:"2막", s:Math.ceil(t*.30)+1, e:Math.ceil(t*.70) }, { n:"3막", s:Math.ceil(t*.70)+1, e:t }];
  else              acts = [{ n:"1막", s:1, e:Math.ceil(t*.20) }, { n:"2막", s:Math.ceil(t*.20)+1, e:Math.ceil(t*.50) }, { n:"3막", s:Math.ceil(t*.50)+1, e:Math.ceil(t*.80) }, { n:"4막", s:Math.ceil(t*.80)+1, e:t }];

  const container = document.getElementById("arcActList");
  if (!container) return;

  // 재렌더링 전 현재 열린 막 인덱스 저장
  container.querySelectorAll(".arc-act").forEach((el, i) => {
    const eps = el.querySelector(".arc-act-eps");
    if (eps && !eps.hidden) _openActIndices.add(i);
    else _openActIndices.delete(i);
  });
  container.innerHTML = "";

  // 독자가 아직 도달하지 않은 막은 표시하지 않음
  acts = acts.filter(act => act.s <= ep);

  acts.forEach((act, idx) => {
    const isCurrentAct = ep >= act.s && ep <= act.e;
    // 현재 막: ep까지만 카운트, 완료 막: 전체 카운트
    const visibleEnd = isCurrentAct ? ep : act.e;
    const doneInAct = [...Array(visibleEnd - act.s + 1)].filter((_, i) => episodeCache[act.s + i]).length;
    const actTotal  = act.e - act.s + 1;  // 항상 막 전체 화수 기준
    const pct       = actTotal > 0 ? Math.round((doneInAct / actTotal) * 100) : 0;

    const actEl = document.createElement("div");
    actEl.className = "arc-act" + (isCurrentAct ? " arc-act-current" : "");
    actEl.dataset.actIdx = idx;

    const header = document.createElement("div");
    header.className = "arc-act-header";
    header.innerHTML = `
      <span class="arc-act-name">${act.n}</span>
      <span class="arc-act-range">${act.s}–${act.e}화</span>
      <span class="arc-act-progress-wrap"><span class="arc-act-progress-fill" style="width:${pct}%"></span></span>
      <span class="arc-act-pct">${pct}%</span>
      <span class="arc-act-toggle"></span>
    `;

    const epList = document.createElement("div");
    epList.className = "arc-act-eps";
    // 최초 렌더링 시에만 현재 막 자동 펼침 — 이후엔 사용자 선택만 반영
    if (!_arcSeeded && isCurrentAct) _openActIndices.add(idx);
    const shouldOpen = _openActIndices.has(idx);
    epList.hidden = !shouldOpen;
    header.querySelector(".arc-act-toggle").textContent = shouldOpen ? "▾" : "▸";

    // 현재 막은 ep까지만, 완료 막은 전체 표시
    const epEnd = isCurrentAct ? ep : act.e;
    for (let i = act.s; i <= epEnd; i++) {
      const epEl = document.createElement("div");
      const hasContent = !!episodeCache[i];
      const isCurrent = i === ep;
      epEl.className = "arc-ep-row-item" + (hasContent ? " done" : "") + (isCurrent ? " current" : "");
      let epTitle = "";
      if (hasContent && typeof extractEpTitle === "function") {
        const parsed = extractEpTitle(episodeCache[i]);
        epTitle = parsed.title ? parsed.title.replace(/^\d+화\s*[-–—]\s*/, "") : "";
      }
      epEl.textContent = epTitle ? `${i}화. ${epTitle}` : `${i}화`;
      if (hasContent) {
        epEl.style.cursor = "pointer";
        epEl.title = `${i}화 보기`;
        epEl.onclick = () => {
          displayedEpisode = i;
          renderProgressive(episodeCache[i], true);
          updateEpisodeUI();
          updateEpisodeListUI?.();
          updateOutputHeader?.();
          updateArcUI(currentEpisode - 1);
        };
      }
      epList.appendChild(epEl);
    }

    header.onclick = () => {
      const open = !epList.hidden;
      epList.hidden = open;
      header.querySelector(".arc-act-toggle").textContent = open ? "▸" : "▾";
      if (open) _openActIndices.delete(idx); else _openActIndices.add(idx);
    };

    actEl.appendChild(header);
    actEl.appendChild(epList);
    container.appendChild(actEl);
  });
  _arcSeeded = true;
}

// ── 세션 통계 ────────────────────────────────────────────

async function loadSessionStats() {
  if (!bookId) return;
  try {
    const res = await fetch(`/api/books/${bookId}/stats`);
    if (!res.ok) return;
    const { stats } = await res.json();
    const n = v => (v == null ? "—" : v);
    const el = id => document.getElementById(id);
    if (el("statTotalSessions")) el("statTotalSessions").textContent = n(stats.total_sessions);
    if (el("statAvgCompletion")) el("statAvgCompletion").textContent = stats.avg_completion != null ? stats.avg_completion + "%" : "—";
    if (el("statAvgTime"))    el("statAvgTime").textContent    = stats.avg_seconds != null ? stats.avg_seconds + "s" : "—";
  } catch (e) { console.error(e); }
}

// ── 에피소드 생성 후 동기화 ────────────────────────────────

async function syncBookEpisode() {
  if (!bookId) return;

  const listRes = await fetch("/api/books");
  const { books } = await listRes.json();
  _allBooks = books;
  renderBookList(books, bookId);
  updateEpisodeListUI();
  updateOutputHeader();

  await fetch(`/api/books/${bookId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_episode: currentEpisode }),
  }).catch(() => {});

  updateArcUI(currentEpisode - 1);
  await Promise.all([loadProfile(), loadForeshadowStats(), loadSessionStats()]);
}

// ── charGenderMap 기반 fallback (기존 책에서 char_states가 없을 때) ──

function _applyCharGenderFallback() {
  const gmap = window.charGenderMap ?? {};
  const names = Object.keys(gmap);
  if (!names.length) return;

  const charStates = names.map(name => ({
    character_name: name,
    gender: gmap[name] === "남성" ? "남성" : gmap[name] === "여성" ? "여성" : null,
    type: null,
    emotional_state: null,
    physical_state: null,
    items: [],
    location: null,
    visibility_state: "present",
  }));

  // 이름 span wrapping + hover 카드 맵 구성 + 패널 표시 (이름/유형 최소 표시)
  if (typeof updateSceneCharPanel === "function") updateSceneCharPanel(charStates);
  if (typeof seedCharStateMapFromGenderMap === "function") seedCharStateMapFromGenderMap(charStates);
}

// ── 전역 함수 노출 (inline onclick 지원) ──────────────────────
window.toggleBookList        = toggleBookList;
window.renderBookList        = renderBookList;
window.ensureBookListLoaded  = ensureBookListLoaded;
window.showBookListToggle    = showBookListToggle;

// ── 진단 유틸 (DevTools: await __fsDiag()) ─────────────────
window.__fsDiag = async function () {
  const currentId = typeof bookId !== "undefined" ? bookId : window.bookId;
  let eps = null;
  try {
    eps = currentId
      ? await fetch(`/api/episodes/${currentId}/all`, { cache: "no-store" }).then(r => r.json())
      : null;
  } catch (e) { eps = { error: String(e) }; }

  return {
    bookId: currentId,
    activeBookTitle,
    currentEpisode,
    displayedEpisode,
    episodeCacheKeys: Object.keys(episodeCache || {}),
    outputTextLen:  document.getElementById("output")?.textContent?.length,
    outputHTMLLen:  document.getElementById("output")?.innerHTML?.length,
    episodesApiCount: eps?.episodes?.length ?? null,
    latestEpisode: eps?.episodes?.at?.(-1)
      ? { n: eps.episodes.at(-1).episode_number, title: eps.episodes.at(-1).title, contentLen: eps.episodes.at(-1).content?.length }
      : null,
    bookItemCount: document.querySelectorAll("#bookList .book-item").length,
    bookListText:  document.getElementById("bookList")?.textContent?.trim(),
    authScript:    Array.from(document.scripts).map(s => s.src).filter(s => s.includes("auth.js")),
  };
};
