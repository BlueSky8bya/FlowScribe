// ── 인물 카드 ─────────────────────────────────────────────────

function toggleChipSection(label) {
  const toggle = label.querySelector(".char-chip-toggle");
  const panel  = label.nextElementSibling;
  const open   = panel.classList.toggle("collapsed");
  toggle.style.transform = open ? "" : "rotate(180deg)";
}

function toggleCharLock(btn) {
  const card    = btn.closest(".char-card");
  const nameInp = card.querySelector(".char-name");

  // 이름 없으면 잠금 불가 — 시각 피드백만 주고 종료
  if (!card.classList.contains("locked") && !nameInp.value.trim()) {
    nameInp.style.borderColor = "var(--danger-text)";
    nameInp.focus();
    showToast("이름을 먼저 입력해주세요.", "warn", 2000);
    return;
  }

  const locked = card.classList.toggle("locked");
  btn.classList.toggle("locked", locked);
  btn.textContent = locked ? "✔ 확정됨" : "확정";

  const aiBtn = card.querySelector(".char-ai-btn");
  if (aiBtn) aiBtn.disabled = locked;

  if (locked) {
    card.classList.remove("expanded");
  } else {
    card.classList.add("expanded"); // 확정 해제 시 자동 펼침
  }

  // 이름 입력만 잠금
  nameInp.readOnly = locked;
  nameInp.style.pointerEvents = locked ? "none" : "";
  nameInp.style.opacity = locked ? ".5" : "";

  // 유형·성별 칩 레이블(드롭다운 토글) 잠금
  card.querySelectorAll(".char-chip-label").forEach(el => {
    el.style.pointerEvents = locked ? "none" : "";
    el.style.opacity = locked ? ".5" : "";
  });
}

function makeCharChips(card, groupClass, dataKey, customWrapClass, customInpClass) {
  const group = card.querySelector("." + groupClass);
  const cWrap = card.querySelector("." + customWrapClass);
  const cInp  = card.querySelector("." + customInpClass);

  function removeCustomChip() {
    const existing = group.parentNode.querySelector(".char-custom-chip[data-key='" + dataKey + "']");
    if (existing) {
      const val = existing.dataset.val;
      if (card.dataset[dataKey] === val) card.dataset[dataKey] = "";
      existing.remove();
    }
  }

  function updatePreview(val) {
    const panel = group.closest(".char-chip-panel");
    const label = panel?.previousElementSibling;
    const badge = label?.querySelector(".char-selected-preview");
    if (badge) badge.textContent = val;
    const metaSpan = card.querySelector(".char-meta-" + dataKey);
    if (metaSpan) metaSpan.textContent = val;
  }

  function confirmCustom() {
    const val = cInp.value.trim();
    if (!val) return;
    cWrap.classList.remove("show");
    cInp.value = "";
    const etcChip = group.querySelector(".char-chip[data-val='기타']");
    if (etcChip) etcChip.classList.remove("selected");
    removeCustomChip();
    card.dataset[dataKey] = val;
    updatePreview(val);

    const chip = document.createElement("span");
    chip.className = "custom-chip char-custom-chip";
    chip.dataset.key = dataKey;
    chip.dataset.val = val;
    chip.innerHTML = `${esc(val)}<span class="custom-chip-del">×</span>`;
    chip.querySelector(".custom-chip-del").addEventListener("click", () => {
      card.dataset[dataKey] = "";
      chip.remove();
    });
    group.after(chip);
  }

  group.querySelectorAll(".char-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      group.querySelectorAll(".char-chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
      if (chip.dataset.val === "기타") {
        removeCustomChip();
        cWrap.classList.add("show"); cInp.focus();
      } else {
        removeCustomChip();
        cWrap.classList.remove("show"); cInp.value = "";
        card.dataset[dataKey] = chip.dataset.val;
        updatePreview(chip.dataset.val);
      }
    });
  });

  cInp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); confirmCustom(); } });
  card.querySelector("." + customWrapClass + " .char-confirm-btn")
      ?.addEventListener("click", confirmCustom);
}

function appendCharCard(container, i, p) {
  const card = document.createElement("div");
  card.className = "char-card";
  // POST-1 §7.2/§7.3: default 역할 "기타", 성별 "기타" (옛 default "인간"/"해당없음" → 새 taxonomy)
  card.dataset.type   = p.type   || "기타";
  card.dataset.gender = p.gender || "기타";

  card.innerHTML = `
    <div class="char-card-accent"></div>
    <div class="char-card-inner">
      <div class="char-card-header">
        <div class="char-card-header-top">
          <span class="char-card-num">Character · ${i + 1}</span>
          <span class="char-card-name-preview">${esc(p.name||"이름 미입력")}</span>
          <button class="card-ai-btn char-ai-btn" style="margin-left:auto;flex-shrink:0" onclick="suggestCharacter(this)">✨ AI 추천</button>
          <button class="char-delete-btn" style="flex-shrink:0" onclick="deleteCharCard(this)" title="인물 삭제">✕</button>
          <button class="char-lock-btn" style="flex-shrink:0" onclick="toggleCharLock(this)">확정</button>
        </div>
        <span class="char-card-meta">
          <span class="char-meta-type">${esc(p.type&&p.type!=="기타"?p.type:(p.typeCustom||"기타"))}</span>
          <span class="char-meta-sep">·</span>
          <span class="char-meta-gender">${esc(p.gender&&p.gender!=="기타"?p.gender:(p.genderCustom||"기타"))}</span>
        </span>
      </div>
      <div class="char-card-body">
        <div class="char-name-row">
          <input class="char-input char-name" type="text" placeholder="이름을 입력하세요" value="${esc(p.name||"")}" />
        </div>
        <div class="char-fields-full">
          <div class="char-personality-label-row">
            <div class="char-personality-label">성격 · 특징</div>
            <button class="char-refine-btn" onclick="refinePersonality(this)">✨ 구체화</button>
          </div>
          <div class="char-personality-preview-box" style="display:${p.personality?'block':'none'}">${esc(p.personality||"")}</div>
          <textarea class="char-input char-personality" placeholder="말투·행동·외형을 구체적으로&#10;예) 말이 없고 눈을 잘 안 마주침. 화날 때 입술을 깨뭄. 키가 크고 손이 크다." style="display:${p.personality?'none':'block'}">${esc(p.personality||"")}</textarea>
        </div>
        <div class="char-fields-full char-items-row">
          <div class="char-personality-label">초기 소지품 <span class="char-items-hint" style="font-size:.75rem;opacity:.55;font-weight:400">Enter 구분 · <code style="font-size:.72rem">이름 :: 설명</code> 또는 <code style="font-size:.72rem">이름(설명)</code></span></div>
          <div class="char-items-tag-wrap" id="charItemsWrap-${i}">
            <input class="tag-input-field char-items-input" type="text" placeholder="소지품 입력 후 Enter" />
          </div>
        </div>
        <hr class="char-divider">
        <div class="char-section">
          <div class="char-section-cell">
            <span class="char-chip-field-label">역할</span>
            <div class="char-chip-label" onclick="toggleChipSection(this)">
              <span class="char-selected-preview">${esc(p.type&&p.type!=="기타"?p.type:(p.typeCustom||"기타"))}</span>
              <span class="char-chip-toggle">▼</span>
            </div>
            <div class="char-chip-panel collapsed">
              <div class="char-chips type-chips">
                ${TYPES.map(t=>`<button class="char-chip${(p.type||"기타")===t?" selected":""}" data-val="${t}">${t}</button>`).join("")}
              </div>
              <div class="char-custom-wrap type-wrap${p.type==="기타"?" show":""}">
                <input class="char-custom-inp type-inp${p.type==="기타"&&p.typeCustom?" confirmed":""}" type="text" placeholder="예: 멘토, 적대자" value="${esc(p.typeCustom||"")}" />
                <button class="char-confirm-btn">↵</button>
              </div>
            </div>
          </div>
          <div class="char-section-cell">
            <span class="char-chip-field-label">성별</span>
            <div class="char-chip-label" onclick="toggleChipSection(this)">
              <span class="char-selected-preview">${esc(p.gender&&p.gender!=="기타"?p.gender:(p.genderCustom||"해당없음"))}</span>
              <span class="char-chip-toggle">▼</span>
            </div>
            <div class="char-chip-panel collapsed">
              <div class="char-chips gender-chips">
                ${GENDERS.map(g=>`<button class="char-chip${(p.gender||"해당없음")===g?" selected":""}" data-val="${g}">${g}</button>`).join("")}
              </div>
              <div class="char-custom-wrap gender-wrap${p.gender==="기타"?" show":""}">
                <input class="char-custom-inp gender-inp${p.gender==="기타"&&p.genderCustom?" confirmed":""}" type="text" placeholder="예: 무성, 양성" value="${esc(p.genderCustom||"")}" />
                <button class="char-confirm-btn">↵</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  makeCharChips(card,"type-chips",  "type",  "type-wrap",  "type-inp");
  makeCharChips(card,"gender-chips","gender","gender-wrap","gender-inp");

  // ── 초기 소지품 multi-entry ────────────────────────────────
  const itemsWrap = card.querySelector(".char-items-tag-wrap");
  const itemsInp  = card.querySelector(".char-items-input");
  if (itemsWrap && itemsInp) {
    const ITEM_GRADES = ['S','A','B','C','D'];
    const GRADE_COLOR_MAP = { S:'#d4a000', A:'#9b5de0', B:'#3b82c8', C:'#2e8a55', D:'#888' };

    // 태그 HTML 재생성 (grade badge + name span + desc dot + × 버튼)
    function _refreshTagDisplay(tag) {
      const nm = tag.dataset.itemName || "";
      const gr = tag.dataset.grade || null;
      const gc = gr ? GRADE_COLOR_MAP[gr] : null;
      const gBadge = gc ? `<span class="char-item-grade-badge" style="font-size:.68rem;font-weight:700;color:${gc};border:1px solid ${gc};border-radius:3px;padding:0 .22rem;margin-right:.2rem;">${gr}</span>` : '';
      const desc = tag.dataset.description || "";
      const descDot = desc ? `<span class="char-item-desc-dot" title="${esc(desc)}">·</span>` : '';
      tag.innerHTML = `${gBadge}<span class="char-item-tag-name">${esc(nm)}</span>${descDot}<span class="tag-del">×</span>`;
    }

    // 구조화 데이터로 태그 요소 생성
    function _buildItemTag(data) {
      // data: { name, grade?, description?, category?, badge_label? } 또는 string
      const norm = _normalizeItem(data);
      if (!norm.name) return null;
      const tag = document.createElement("span");
      tag.className = "tag char-item-tag";
      tag.dataset.itemName = norm.name;
      if (norm.grade)       tag.dataset.grade       = norm.grade;
      if (norm.description) tag.dataset.description = norm.description;
      if (norm.category)    tag.dataset.category    = norm.category;
      if (norm.badge_label) tag.dataset.badgeLabel  = norm.badge_label;
      _refreshTagDisplay(tag);
      return tag;
    }

    // item 입력 파싱: "이름 :: 설명" / "이름(설명)" / "이름" / 등급 접두 형식
    function _parseItemInput(raw) {
      raw = raw.trim();
      // :: 문법 우선 (가장 명확)
      const colonIdx = raw.indexOf("::");
      if (colonIdx > 0) {
        return { name: raw.slice(0, colonIdx).trim(), description: raw.slice(colonIdx + 2).trim() };
      }
      // 등급 prefix: S:이름
      const prefM = raw.match(/^([SABCD]):(.+)$/i);
      if (prefM && ITEM_GRADES.includes(prefM[1].toUpperCase())) {
        return { name: prefM[2].trim(), grade: prefM[1].toUpperCase() };
      }
      // 괄호 suffix: 등급(S급) vs 설명(텍스트)
      const parenM = raw.match(/^(.+?)\((.+)\)$/);
      if (parenM) {
        const inner = parenM[2].trim().replace(/급$/, "");
        if (ITEM_GRADES.includes(inner.toUpperCase())) {
          return { name: parenM[1].trim(), grade: inner.toUpperCase() };
        }
        return { name: parenM[1].trim(), description: parenM[2].trim() };
      }
      return { name: raw };
    }

    // string 또는 object → 정규화된 item object
    function _normalizeItem(it) {
      if (typeof it === "string") {
        const parsed = _parseItemInput(it);
        return parsed;
      }
      return {
        name:        it.name        || "",
        grade:       it.grade       || null,
        description: it.description || "",
        category:    it.category    || "",
        badge_label: it.badge_label || "",
      };
    }

    // 태그 추가 (Enter 입력 또는 초기 로딩)
    function _addItemTag(val) {
      if (!val || !val.trim()) return;
      const parsed = _parseItemInput(val.trim());
      if (!parsed.name) return;
      const tag = _buildItemTag(parsed);
      if (tag) itemsWrap.insertBefore(tag, itemsInp);
    }

    // ── 인라인 에디터 패널 ──────────────────────────────────
    const editorPanel = document.createElement("div");
    editorPanel.className = "char-item-editor-panel";
    editorPanel.innerHTML = `
      <div class="item-ed-row">
        <label class="item-ed-label">이름</label>
        <input class="item-ed-name tag-input-field" type="text" placeholder="소지품 이름" />
      </div>
      <div class="item-ed-row">
        <label class="item-ed-label">설명</label>
        <input class="item-ed-desc tag-input-field" type="text" placeholder="간단한 설명 (선택, 직접 입력하면 AI가 채우지 않습니다)" />
      </div>
      <!-- POST-1 §7.1: 카테고리 입력 UI 제거 — AI가 자동 분류. input은 데이터 보존용으로 hidden 유지 (suggest.js가 .item-ed-cat.value를 set/get) -->
      <input class="item-ed-cat" type="hidden" />
      <div class="item-ed-btns">
        <button class="item-ed-ok btn-xs btn-primary">확인</button>
        <button class="item-ed-cancel btn-xs">취소</button>
        <button class="item-ai-suggest-btn btn-xs" style="margin-left:auto">✨ 설명 추천</button>
        <button class="item-ai-refine-btn btn-xs" style="margin-left:.3rem">✨ 설명 구체화</button>
      </div>
    `;
    itemsWrap.insertAdjacentElement("afterend", editorPanel);

    let _editingTag = null;

    function _openEditor(tag, readOnly = false) {
      _editingTag = readOnly ? null : tag;
      const nameField = editorPanel.querySelector(".item-ed-name");
      const descField = editorPanel.querySelector(".item-ed-desc");
      const catField  = editorPanel.querySelector(".item-ed-cat");
      const okBtn      = editorPanel.querySelector(".item-ed-ok");
      const sugBtn     = editorPanel.querySelector(".item-ai-suggest-btn");
      const refineBtn  = editorPanel.querySelector(".item-ai-refine-btn");
      nameField.value = tag.dataset.itemName || "";
      descField.value = tag.dataset.description || "";
      catField.value  = tag.dataset.category    || "";
      [nameField, descField, catField].forEach(f => {
        f.readOnly = readOnly;
        f.style.opacity = readOnly ? ".7" : "";
        f.style.pointerEvents = readOnly ? "none" : "";
      });
      if (okBtn)     { okBtn.style.display = readOnly ? "none" : ""; }
      if (sugBtn)    { sugBtn.disabled = readOnly; sugBtn.style.opacity = readOnly ? ".25" : ""; sugBtn.style.pointerEvents = readOnly ? "none" : ""; }
      if (refineBtn) { refineBtn.disabled = readOnly; refineBtn.style.opacity = readOnly ? ".25" : ""; refineBtn.style.pointerEvents = readOnly ? "none" : ""; }
      editorPanel.classList.add("open");
      if (!readOnly) nameField.focus();
    }

    function _applyEditor() {
      if (!_editingTag) return;
      const name = editorPanel.querySelector(".item-ed-name").value.trim();
      const desc = editorPanel.querySelector(".item-ed-desc").value.trim();
      const cat  = editorPanel.querySelector(".item-ed-cat").value.trim();
      if (!name) { _closeEditor(); return; }
      _editingTag.dataset.itemName = name;
      if (desc) _editingTag.dataset.description = desc;
      else delete _editingTag.dataset.description;
      if (cat) { _editingTag.dataset.category = cat; _editingTag.dataset.badgeLabel = cat; }
      else { delete _editingTag.dataset.category; delete _editingTag.dataset.badgeLabel; }
      _refreshTagDisplay(_editingTag);
      _closeEditor();
    }

    function _closeEditor() {
      editorPanel.classList.remove("open");
      _editingTag = null;
    }

    editorPanel.querySelector(".item-ed-ok").addEventListener("click", _applyEditor);
    editorPanel.querySelector(".item-ed-cancel").addEventListener("click", _closeEditor);
    editorPanel.querySelector(".item-ai-suggest-btn").addEventListener("click", () => {
      if (typeof suggestItemDetail === "function") suggestItemDetail(editorPanel, card);
    });
    editorPanel.querySelector(".item-ai-refine-btn").addEventListener("click", () => {
      if (typeof suggestItemRefine === "function") suggestItemRefine(editorPanel, card);
    });
    editorPanel.querySelector(".item-ed-name").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); _applyEditor(); }
      if (e.key === "Escape") _closeEditor();
    });
    editorPanel.querySelector(".item-ed-desc").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); _applyEditor(); }
      if (e.key === "Escape") _closeEditor();
    });

    // ── 이벤트 위임 ──────────────────────────────────────────
    itemsWrap.addEventListener("click", e => {
      const viewerLocked = card.classList.contains("items-viewer-locked");
      const del = e.target.closest(".tag-del");
      if (del) {
        if (viewerLocked) return;
        del.closest(".char-item-tag").remove(); return;
      }
      const nameSpan = e.target.closest(".char-item-tag-name, .char-item-desc-dot");
      if (nameSpan) {
        _openEditor(nameSpan.closest(".char-item-tag"), viewerLocked);
        return;
      }
      // 태그 자체 클릭 (name span 아닌 여백) → 에디터
      const tag = e.target.closest(".char-item-tag");
      if (tag) {
        _openEditor(tag, viewerLocked);
        return;
      }
      if (!viewerLocked) itemsInp.focus();
    });

    // Enter 키 입력
    itemsInp.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); _addItemTag(itemsInp.value); itemsInp.value = ""; }
    });

    // 초기 소지품 복원
    if (Array.isArray(p.initialItems) && p.initialItems.length) {
      p.initialItems.forEach(it => {
        const norm = _normalizeItem(it);
        if (norm.name) {
          const tag = _buildItemTag(norm);
          if (tag) itemsWrap.insertBefore(tag, itemsInp);
        }
      });
    }
  }
  const nameInp = card.querySelector(".char-name");
  nameInp.addEventListener("input", e => {
    card.querySelector(".char-card-name-preview").textContent = e.target.value.trim() || "이름 미입력";
    if (e.target.value.trim()) e.target.style.borderColor = "";
  });

  card.querySelector(".char-card-header").addEventListener("click", e => {
    if (e.target.closest(".char-lock-btn, .char-ai-btn")) return;
    card.classList.toggle("expanded");
  });

  const ta      = card.querySelector(".char-personality");
  const preview = card.querySelector(".char-personality-preview-box");

  function autoResize() { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
  function showPreview() {
    if (!ta.value.trim()) return; // 비어있으면 textarea 그대로
    preview.textContent = ta.value;
    preview.style.display = "block";
    ta.style.display = "none";
  }
  function showEditor() {
    preview.style.display = "none";
    ta.style.display = "block";
    ta.focus();
    setTimeout(autoResize, 0);
  }

  preview.addEventListener("click", showEditor);
  ta.addEventListener("blur", showPreview);
  ta.addEventListener("input", autoResize);
  if (ta.value) autoResize();

  container.appendChild(card);
  return card;
}

function renderCharCards() {
  const container = document.getElementById("charCards");
  const saved = [];
  container.querySelectorAll(".char-card").forEach(c => {
    saved.push({
      name: c.querySelector(".char-name")?.value || "",
      personality: c.querySelector(".char-personality")?.value || "",
      type: c.dataset.type || "기타",
      typeCustom: c.querySelector(".type-inp")?.value || "",
      gender: c.dataset.gender || "기타",
      genderCustom: c.querySelector(".gender-inp")?.value || "",
      initialItems: Array.from(c.querySelectorAll(".char-item-tag")).map(t => {
        const nm = (t.dataset.itemName || Array.from(t.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')).trim();
        if (!nm) return null;
        const obj = { name: nm };
        if (t.dataset.grade)      obj.grade      = t.dataset.grade;
        if (t.dataset.description) obj.description = t.dataset.description;
        if (t.dataset.category)   obj.category   = t.dataset.category;
        if (t.dataset.badgeLabel) obj.badge_label = t.dataset.badgeLabel;
        return obj;
      }).filter(Boolean),
    });
  });
  container.innerHTML = "";
  for (let i = 0; i < charCount; i++) {
    appendCharCard(container, i, saved[i] || { type:"기타", gender:"기타" });
  }
}

// AI 추천 소지품을 카드에 적용 (structured item array 지원)
// 태그 이벤트는 itemsWrap 위임 리스너가 처리하므로 직접 바인딩 불필요
function applyItemsToCard(card, items) {
  if (!items || !items.length) return;
  const wrap = card.querySelector(".char-items-tag-wrap");
  const inp  = card.querySelector(".char-items-input");
  if (!wrap || !inp) return;
  const GRADE_COLOR_MAP = { S:'#d4a000', A:'#9b5de0', B:'#3b82c8', C:'#2e8a55', D:'#888' };
  items.forEach(rawItem => {
    const nm = typeof rawItem === "string" ? rawItem : (rawItem.name || "");
    if (!nm) return;
    const item = typeof rawItem === "string" ? { name: rawItem } : rawItem;
    const tag = document.createElement("span");
    tag.className = "tag char-item-tag";
    tag.dataset.itemName = nm;
    if (item.grade)       tag.dataset.grade       = item.grade;
    if (item.description) tag.dataset.description = item.description;
    if (item.category)    tag.dataset.category    = item.category;
    if (item.badge_label) tag.dataset.badgeLabel  = item.badge_label;
    // HTML 구성: grade badge + name span + desc dot + ×
    const gc = item.grade ? GRADE_COLOR_MAP[item.grade] : null;
    const gBadge = gc ? `<span class="char-item-grade-badge" style="font-size:.68rem;font-weight:700;color:${gc};border:1px solid ${gc};border-radius:3px;padding:0 .22rem;margin-right:.2rem;">${item.grade}</span>` : '';
    const descDot = item.description ? `<span class="char-item-desc-dot" title="${esc(item.description)}">·</span>` : '';
    tag.innerHTML = `${gBadge}<span class="char-item-tag-name">${esc(nm)}</span>${descDot}<span class="tag-del">×</span>`;
    wrap.insertBefore(tag, inp);
  });
}

function changeCharCount(d) {
  const next = Math.max(1, Math.min(5, charCount + d));
  if (next === charCount) return;
  const container = document.getElementById("charCards");
  if (next > charCount) {
    for (let i = charCount; i < next; i++) appendCharCard(container, i, {type:"기타",gender:"기타"});
  } else {
    for (let i = charCount; i > next; i--) {
      const cards = container.querySelectorAll(".char-card");
      if (cards.length) container.removeChild(cards[cards.length - 1]);
    }
  }
  charCount = next;
  document.getElementById("charCountNum").textContent = charCount;
  _syncCharCounterBtns();
}

function _syncCharCounterBtns() {
  const minBtn = document.getElementById("charCountMinus");
  const maxBtn = document.getElementById("charCountPlus");
  if (minBtn) minBtn.disabled = charCount <= 1;
  if (maxBtn) maxBtn.disabled = charCount >= 5;
}

async function deleteCharCard(btn) {
  // 모달 열림(편집모드) + 섹션 잠금 없을 때만 삭제 허용
  const isModalOpen = document.getElementById("modalOverlay")?.classList.contains("open");
  const isLocked = document.getElementById("sectionFieldIV")?.classList.contains("section-locked");
  if (!isModalOpen || isLocked) return;

  const container = document.getElementById("charCards");
  const cards = container.querySelectorAll(".char-card");
  if (cards.length <= 1) { showToast("최소 1명의 인물이 필요합니다.", "warn", 2000); return; }

  const card = btn.closest(".char-card");
  const name = card.querySelector(".char-name")?.value?.trim() || "이 인물";

  const confirmed = await _fsDialog({
    title: "인물카드를 삭제할까요?",
    desc: `"${name}" 설정은 저장 후 복구하기 어렵습니다.`,
    buttons: [
      { label: "취소",  cls: "",             value: false },
      { label: "삭제",  cls: "danger",       value: true  },
    ],
  });
  if (!confirmed) return;

  card.remove();
  charCount = Math.max(1, charCount - 1);
  document.getElementById("charCountNum").textContent = charCount;
  _syncCharCounterBtns();
}

function syncCharDeleteBtns() {
  // CSS .modal-overlay.open .char-delete-btn 규칙으로 처리 — section-locked 시만 추가 숨김
  const container = document.getElementById("charCards");
  if (!container) return;
  const isLocked = document.getElementById("sectionFieldIV")?.classList.contains("section-locked");
  container.querySelectorAll(".char-delete-btn").forEach(btn => {
    btn.style.display = isLocked ? "none" : "";
  });
}

renderCharCards();
_syncCharCounterBtns();
