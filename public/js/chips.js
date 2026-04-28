// ── 칩 그룹 (배경·세계관 / 장르·분위기) ──────────────────────

function buildChipGroup(gridId, items) {
  const grid = document.getElementById(gridId);
  items.forEach(label => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.dataset.label = label;
    chip.textContent = label;
    grid.appendChild(chip);
  });
}

function bindChipGroup(gridId, customWrapId, customInputId, arr, max, groupKey) {
  const grid = document.getElementById(gridId);
  const wrap = document.getElementById(customWrapId);
  const inp  = document.getElementById(customInputId);

  function updateDisabled() {
    grid.querySelectorAll(".chip").forEach(c => {
      if (c.classList.contains("selected")) { c.classList.remove("disabled"); return; }
      arr.length >= max ? c.classList.add("disabled") : c.classList.remove("disabled");
    });
  }

  grid.addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const label = chip.dataset.label;
    if (chip.classList.contains("selected")) {
      chip.classList.remove("selected");
      const idx = arr.indexOf(label);
      if (idx > -1) arr.splice(idx, 1);
      if (label === "기타") wrap.classList.remove("show");
      // 선택 해제 시 잠금도 해제
      const lockSet = groupKey === "setting" ? lockedSettings : lockedMoods;
      lockSet.delete(label);
      chip.classList.remove("chip-locked");
      chip.querySelector(".chip-lock-icon")?.remove();
    } else {
      if (arr.length >= max) return;
      arr.push(label);
      chip.classList.add("selected");
      if (label === "기타") { wrap.classList.add("show"); inp.focus(); }
    }
    updateDisabled();
  });

  grid.addEventListener("dblclick", e => {
    const chip = e.target.closest(".chip");
    if (!chip || !chip.classList.contains("selected")) return;
    e.stopPropagation();
    const label = chip.dataset.label;
    const lockSet = groupKey === "setting" ? lockedSettings : lockedMoods;
    if (lockSet.has(label)) {
      lockSet.delete(label);
      chip.classList.remove("chip-locked");
      chip.querySelector(".chip-lock-icon")?.remove();
    } else {
      lockSet.add(label);
      chip.classList.add("chip-locked");
      if (!chip.querySelector(".chip-lock-icon")) {
        const icon = document.createElement("span");
        icon.className = "chip-lock-icon";
        icon.textContent = " 🔒";
        chip.appendChild(icon);
      }
    }
  });

  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); confirmCustomChip(groupKey); }
  });
}

function confirmCustomChip(groupKey) {
  const isS  = groupKey === "setting";
  const grid = document.getElementById(isS ? "settingGrid" : "moodGrid");
  const wrap = document.getElementById(isS ? "settingCustomWrap" : "moodCustomWrap");
  const inp  = document.getElementById(isS ? "settingCustomInput" : "moodCustomInput");
  const arr  = isS ? settingVals : moodVals;
  const val  = inp.value.trim();
  if (!val) return;

  const etcChip = grid.querySelector(".chip[data-label='기타']");
  if (etcChip) {
    etcChip.classList.remove("selected");
    const etcIdx = arr.indexOf("기타");
    if (etcIdx > -1) arr.splice(etcIdx, 1);
  }
  if (arr.includes(val)) { inp.value = ""; return; }
  if (arr.length >= 3) { inp.value = ""; wrap.classList.remove("show"); return; }

  arr.push(val);
  inp.value = "";
  wrap.classList.remove("show");

  const customChip = document.createElement("span");
  customChip.className = "custom-chip";
  customChip.dataset.val = val;
  customChip.innerHTML = `${esc(val)}<span class="custom-chip-del" title="삭제">×</span>`;
  customChip.querySelector(".custom-chip-del").addEventListener("click", () => {
    arr.splice(arr.indexOf(val), 1);
    customChip.remove();
    grid.querySelectorAll(".chip").forEach(c => {
      if (!c.classList.contains("selected")) c.classList.remove("disabled");
    });
  });
  grid.after(customChip);

  grid.querySelectorAll(".chip").forEach(c => {
    if (!c.classList.contains("selected"))
      arr.length >= 3 ? c.classList.add("disabled") : c.classList.remove("disabled");
  });
}

function addChipDirect(gridId, arr, max, val) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  if (arr.includes(val) || arr.length >= max) return;
  const existing = grid.querySelector(`.chip[data-label="${val}"]`);
  if (existing && !existing.classList.contains("disabled")) { existing.click(); return; }
  arr.push(val);
  const customChip = document.createElement("span");
  customChip.className = "custom-chip";
  customChip.dataset.val = val;
  customChip.innerHTML = `${val}<span class="custom-chip-del" title="삭제">×</span>`;
  customChip.querySelector(".custom-chip-del").addEventListener("click", () => {
    arr.splice(arr.indexOf(val), 1);
    customChip.remove();
    grid.querySelectorAll(".chip").forEach(c => {
      if (!c.classList.contains("selected")) c.classList.remove("disabled");
    });
  });
  grid.after(customChip);
  grid.querySelectorAll(".chip").forEach(c => {
    if (!c.classList.contains("selected"))
      arr.length >= max ? c.classList.add("disabled") : c.classList.remove("disabled");
  });
}

// 초기화
buildChipGroup("settingGrid", SETTING_ITEMS);
buildChipGroup("moodGrid",    MOOD_ITEMS);
bindChipGroup("settingGrid","settingCustomWrap","settingCustomInput", settingVals, 3, "setting");
bindChipGroup("moodGrid",   "moodCustomWrap",   "moodCustomInput",    moodVals,   3, "mood");
