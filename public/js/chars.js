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
  card.dataset.type   = p.type   || "인간";
  card.dataset.gender = p.gender || "해당없음";

  card.innerHTML = `
    <div class="char-card-accent"></div>
    <div class="char-card-inner">
      <div class="char-card-header">
        <div class="char-card-header-top">
          <span class="char-card-num">Character · ${i + 1}</span>
          <span class="char-card-name-preview">${esc(p.name||"이름 미입력")}</span>
          <button class="card-ai-btn char-ai-btn" style="margin-left:auto;flex-shrink:0" onclick="suggestCharacter(this)">✦ AI 추천</button>
          <button class="char-lock-btn" style="flex-shrink:0" onclick="toggleCharLock(this)">확정</button>
        </div>
        <span class="char-card-meta">
          <span class="char-meta-type">${esc(p.type&&p.type!=="기타"?p.type:(p.typeCustom||"인간"))}</span>
          <span class="char-meta-sep">·</span>
          <span class="char-meta-gender">${esc(p.gender&&p.gender!=="기타"?p.gender:(p.genderCustom||"해당없음"))}</span>
        </span>
      </div>
      <div class="char-card-body">
        <div class="char-name-row">
          <input class="char-input char-name" type="text" placeholder="이름을 입력하세요" value="${esc(p.name||"")}" />
        </div>
        <div class="char-fields-full">
          <div class="char-personality-label-row">
            <div class="char-personality-label">성격 · 특징</div>
            <button class="char-refine-btn" onclick="refinePersonality(this)">✦ 구체화</button>
          </div>
          <div class="char-personality-preview-box" style="display:${p.personality?'block':'none'}">${esc(p.personality||"")}</div>
          <textarea class="char-input char-personality" placeholder="말투·행동·외형을 구체적으로&#10;예) 말이 없고 눈을 잘 안 마주침. 화날 때 입술을 깨뭄. 키가 크고 손이 크다." style="display:${p.personality?'none':'block'}">${esc(p.personality||"")}</textarea>
        </div>
        <div class="char-fields-full char-items-row">
          <div class="char-personality-label">초기 소지품 <span style="font-size:.75rem;opacity:.55;font-weight:400">Enter로 항목 구분</span></div>
          <div class="char-items-tag-wrap" id="charItemsWrap-${i}">
            ${(p.initialItems||"").split(/[\n,]/).map(s=>s.trim()).filter(Boolean).map(raw=>{
              const _gMap={S:'#d4a000',A:'#9b5de0',B:'#3b82c8',C:'#2e8a55',D:'#888'};
              let nm=raw,gr=null;
              const pm=raw.match(/^([SABCD]):(.+)$/i); if(pm&&['S','A','B','C','D'].includes(pm[1].toUpperCase())){gr=pm[1].toUpperCase();nm=pm[2].trim();}
              else{const sm=raw.match(/^(.+)\(([SABCD])급?\)$/i);if(sm&&['S','A','B','C','D'].includes(sm[2].toUpperCase())){gr=sm[2].toUpperCase();nm=sm[1].trim();}}
              const gb=gr?`<span style="font-size:.68rem;font-weight:700;color:${_gMap[gr]};border:1px solid ${_gMap[gr]};border-radius:3px;padding:0 .22rem;margin-right:.2rem;">${gr}</span>`:'';
              return `<span class="tag char-item-tag"${gr?` data-grade="${gr}" data-item-name="${esc(nm)}"`:``}>${gb}${esc(nm)}<span class="tag-del" data-item="${esc(raw)}">×</span></span>`;
            }).join("")}
            <input class="tag-input-field char-items-input" type="text" placeholder="소지품 입력 후 Enter" />
          </div>
        </div>
        <hr class="char-divider">
        <div class="char-section">
          <div class="char-section-cell">
            <span class="char-chip-field-label">유형</span>
            <div class="char-chip-label" onclick="toggleChipSection(this)">
              <span class="char-selected-preview">${esc(p.type&&p.type!=="기타"?p.type:(p.typeCustom||"인간"))}</span>
              <span class="char-chip-toggle">▼</span>
            </div>
            <div class="char-chip-panel collapsed">
              <div class="char-chips type-chips">
                ${TYPES.map(t=>`<button class="char-chip${(p.type||"인간")===t?" selected":""}" data-val="${t}">${t}</button>`).join("")}
              </div>
              <div class="char-custom-wrap type-wrap${p.type==="기타"?" show":""}">
                <input class="char-custom-inp type-inp${p.type==="기타"&&p.typeCustom?" confirmed":""}" type="text" placeholder="예: 반신, 드래곤" value="${esc(p.typeCustom||"")}" />
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

  // 초기 소지품 multi-entry
  const itemsWrap = card.querySelector(".char-items-tag-wrap");
  const itemsInp  = card.querySelector(".char-items-input");
  if (itemsWrap && itemsInp) {
    // 등급 파싱: "S:검" 또는 "검(S)" 또는 "검(S급)" 형식 지원
    const ITEM_GRADES = ['S','A','B','C','D'];
    const GRADE_COLOR_MAP = { S:'#d4a000', A:'#9b5de0', B:'#3b82c8', C:'#2e8a55', D:'#888' };
    function _parseGrade(raw) {
      let name = raw.trim(), grade = null;
      const prefixM = name.match(/^([SABCD]):(.+)$/i);
      if (prefixM && ITEM_GRADES.includes(prefixM[1].toUpperCase())) { grade = prefixM[1].toUpperCase(); name = prefixM[2].trim(); }
      else {
        const suffixM = name.match(/^(.+)\(([SABCD])급?\)$/i);
        if (suffixM && ITEM_GRADES.includes(suffixM[2].toUpperCase())) { grade = suffixM[2].toUpperCase(); name = suffixM[1].trim(); }
      }
      return { name, grade };
    }
    function _addItemTag(val) {
      val = val.trim();
      if (!val) return;
      const { name, grade } = _parseGrade(val);
      const tag = document.createElement("span");
      tag.className = "tag char-item-tag";
      const gc = grade ? GRADE_COLOR_MAP[grade] : null;
      const gBadge = grade ? `<span class="char-item-grade-badge" style="font-size:.68rem;font-weight:700;color:${gc};border:1px solid ${gc};border-radius:3px;padding:0 .22rem;margin-right:.2rem;">${grade}</span>` : '';
      tag.innerHTML = `${gBadge}${esc(name)}<span class="tag-del">×</span>`;
      if (grade) tag.dataset.grade = grade;
      tag.dataset.itemName = name;
      tag.querySelector(".tag-del").addEventListener("click", () => tag.remove());
      itemsWrap.insertBefore(tag, itemsInp);
    }
    // 기존 태그 del 핸들러 바인딩
    itemsWrap.querySelectorAll(".char-item-tag .tag-del").forEach(del => {
      del.addEventListener("click", () => del.closest(".char-item-tag").remove());
    });
    itemsInp.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); _addItemTag(itemsInp.value); itemsInp.value = ""; }
    });
    itemsWrap.addEventListener("click", () => itemsInp.focus());
  }
  const nameInp = card.querySelector(".char-name");
  nameInp.addEventListener("input", e => {
    card.querySelector(".char-card-name-preview").textContent = e.target.value.trim() || "이름 미입력";
    if (e.target.value.trim()) e.target.style.borderColor = "";
  });

  card.querySelector(".char-card-header").addEventListener("click", e => {
    if (card.classList.contains("locked")) return;
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
      type: c.dataset.type || "인간",
      typeCustom: c.querySelector(".type-inp")?.value || "",
      gender: c.dataset.gender || "해당없음",
      genderCustom: c.querySelector(".gender-inp")?.value || "",
      initialItems: Array.from(c.querySelectorAll(".char-item-tag")).map(t => {
        const nm = (t.dataset.itemName || Array.from(t.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')).trim();
        const gr = t.dataset.grade;
        return nm ? (gr ? `${gr}:${nm}` : nm) : null;
      }).filter(Boolean).join("\n"),
    });
  });
  container.innerHTML = "";
  for (let i = 0; i < charCount; i++) {
    appendCharCard(container, i, saved[i] || { type:"인간", gender:"해당없음" });
  }
}

function changeCharCount(d) {
  const next = Math.max(1, Math.min(10, charCount + d));
  if (next === charCount) return;
  const container = document.getElementById("charCards");
  if (next > charCount) {
    for (let i = charCount; i < next; i++) appendCharCard(container, i, {type:"인간",gender:"해당없음"});
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
  const minBtn = document.querySelector(".counter-btn[onclick*='-1']");
  const maxBtn = document.querySelector(".counter-btn[onclick*='1']");
  if (minBtn) minBtn.disabled = charCount <= 1;
  if (maxBtn) maxBtn.disabled = charCount >= 10;
}

renderCharCards();
_syncCharCounterBtns();
