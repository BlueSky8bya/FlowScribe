// ── AI 추천 (직렬 큐) ─────────────────────────────────────────

const suggestQueue = [];
let suggestRunning = false;
let queuedCards    = new Set();

async function flushSuggestQueue() {
  if (suggestRunning) return;
  suggestRunning = true;
  while (suggestQueue.length > 0) {
    const task = suggestQueue.shift();
    await task();
  }
  suggestRunning = false;
  stopLoadingOverlay("charLoadingBar");
}

async function suggestCharacter(btn) {
  if (!settingVals.length && !moodVals.length) {
    showToast("배경·세계관 또는 장르·분위기를 먼저 선택해주세요.");
    return;
  }
  if (ruleEntries.length === 0) {
    showToast("세계관 규칙을 먼저 추가해주세요. 규칙이 있어야 인물의 성격·특징을 맥락에 맞게 생성할 수 있습니다.", "warn");
    return;
  }
  const card = btn.closest(".char-card");
  if (card.classList.contains("locked")) return;
  if (queuedCards.has(card)) return;
  queuedCards.add(card);

  btn.disabled = true;
  btn.textContent = suggestQueue.length > 0 ? `⋯ ${suggestQueue.length + 1}번째 대기` : "⟳";
  btn.classList.add("loading");

  suggestQueue.push(async () => {
    const myName = card.querySelector(".char-name").value.trim();
    const exclude_names = [...document.querySelectorAll(".char-name")]
      .map(i => i.value.trim()).filter(n => n && n !== myName);
    const myPersonality = card.querySelector(".char-personality").value.trim();
    const exclude_personalities = [...document.querySelectorAll(".char-personality")]
      .map(t => t.value.trim()).filter(p => p && p !== myPersonality);
    const myType = card.querySelector(".type-chips .char-chip.selected")?.dataset.val ?? "";
    const exclude_types = [...document.querySelectorAll(".type-chips .char-chip.selected")]
      .map(c => c.dataset.val).filter(t => t && t !== myType && t !== "기타");

    btn.textContent = "⟳";
    startLoadingOverlay("charLoadingBar", LOADING_MSGS);

    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "characters",
          context: getContext(),
          settings: [...settingVals],
          moods: [...moodVals],
          world_rules: ruleEntries.map(e => e.val),
          exclude_names,
          exclude_personalities,
          exclude_types,
        }),
      });
      const json = await res.json();
      if (!json.data?.length) throw new Error("empty");
      const c = json.data[0];
      const nameInp = card.querySelector(".char-name");
      const nameLocked = nameInp.readOnly;
      if (!nameLocked) {
        nameInp.value = c.name || "";
        card.querySelector(".char-card-name-preview").textContent = c.name || "이름 미입력";
        if (c.type) {
          const typeChip = card.querySelector(`.type-chips .char-chip[data-val="${c.type}"]`);
          if (typeChip) typeChip.click();
        }
        if (c.gender) {
          const genderChip = card.querySelector(`.gender-chips .char-chip[data-val="${c.gender}"]`);
          if (genderChip) genderChip.click();
        }
      }
      const taEl = card.querySelector(".char-personality");
      taEl.value = c.personality || "";
      taEl.style.height = "auto";
      taEl.style.height = taEl.scrollHeight + "px";
    } catch(e) {
      console.error("[suggest char]", e);
      showToast("인물 생성에 실패했습니다.", "err", 3000);
    } finally {
      btn.disabled = false;
      btn.textContent = "✦ AI 추천";
      btn.classList.remove("loading");
      queuedCards.delete(card);
      let i = 1;
      for (const qCard of queuedCards) {
        const qBtn = qCard.querySelector(".char-ai-btn");
        if (qBtn) qBtn.textContent = `⋯ ${i}번째 대기`;
        i++;
      }
    }
  });

  flushSuggestQueue();
}

async function suggestAllCharacters() {
  if (ruleEntries.length === 0) { showToast("세계관 규칙을 먼저 추가해주세요.", "warn"); return; }
  if (!settingVals.length && !moodVals.length) { showToast("배경·세계관 또는 장르·분위기를 먼저 선택해주세요."); return; }

  const allBtns = [...document.querySelectorAll(".char-ai-btn")];
  const toQueue = allBtns.filter(btn => {
    const card = btn.closest(".char-card");
    return card && !queuedCards.has(card) && !card.classList.contains("locked");
  });
  if (!toQueue.length) { showToast("모든 인물 카드가 이미 생성 중입니다.", "warn"); return; }

  const allBtn = document.getElementById("allCharAiBtn");
  allBtn.disabled = true;
  allBtn.textContent = `⟳ ${toQueue.length}명 대기 중`;

  for (const btn of toQueue) {
    await new Promise(r => setTimeout(r, 0));
    suggestCharacter(btn);
  }

  const waitDone = setInterval(() => {
    if (!suggestRunning) {
      allBtn.disabled = false;
      allBtn.textContent = "✦ 전체 AI 추천";
      clearInterval(waitDone);
    }
  }, 500);
}

async function refinePersonality(btn) {
  const card = btn.closest(".char-card");
  if (card.classList.contains("locked")) return;
  const ta = card.querySelector(".char-personality");
  const personality = ta.value.trim();
  if (!personality) { showToast("먼저 성격·특징을 입력해주세요.", "warn"); return; }

  btn.disabled = true;
  btn.textContent = "⟳";

  try {
    const name   = card.querySelector(".char-name").value.trim();
    const type   = card.dataset.type || "인간";
    const gender = card.dataset.gender || "";
    const res = await fetch("/api/suggest/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, type, gender, personality,
        settings: [...settingVals],
        moods: [...moodVals],
        world_rules: ruleEntries.map(e => e.val),
      }),
    });
    const json = await res.json();
    if (json.val) {
      ta.value = json.val;
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  } catch(e) {
    console.error("[refine]", e);
    showToast("구체화에 실패했습니다.", "err", 3000);
  } finally {
    btn.disabled = false;
    btn.textContent = "✦ 구체화";
  }
}

async function suggestRules() {
  if (!settingVals.length && !moodVals.length) { showToast("배경·세계관 또는 장르·분위기를 먼저 선택해주세요."); return; }
  const btn = document.getElementById("rulesAiBtn");
  btn.disabled = true;
  btn.textContent = "⟳";
  btn.classList.add("loading");
  startLoadingOverlay("rulesLoadingBar", RULES_LOADING_MSGS);
  try {
    const res = await fetch("/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section: "rules",
        context: getContext(),
        settings: [...settingVals],
        moods: [...moodVals],
        existing_rule_count: ruleEntries.length,
        existing_rules: ruleEntries.map(e => e.val),
      }),
    });
    const json = await res.json();
    if (json.data) applySuggestion("rules", json.data);
  } catch(e) {
    console.error("[suggest rules]", e);
    showToast("규칙 생성에 실패했습니다. 잠시 후 다시 시도하세요.", "err", 4000);
  } finally {
    btn.disabled = false;
    btn.textContent = "✦ AI 추천";
    btn.classList.remove("loading");
    stopLoadingOverlay("rulesLoadingBar");
  }
}

// ── AI 세계관 추천 (world-setup) ──────────────────────────────

function selectOrAddChip(group, label) {
  const gridId = group === "settings" ? "settingGrid" : "moodGrid";
  const arr    = group === "settings" ? settingVals : moodVals;
  addChipDirect(gridId, arr, 3, label);
}

async function runWorldSetupSuggest() {
  const btn = document.getElementById("aiSuggestBtn");
  if (!btn) return;

  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "AI 추천 중...";

  try {
    const body = {
      book_id: typeof bookId !== "undefined" ? bookId : null,
      target: "world_setup",
      locked: {
        settings: [...(typeof lockedSettings !== "undefined" ? lockedSettings : [])],
        moods:    [...(typeof lockedMoods    !== "undefined" ? lockedMoods    : [])],
        characters: getLockedCharacterNames(),
      },
      current: {
        settings:   typeof settingVals  !== "undefined" ? settingVals  : [],
        moods:      typeof moodVals     !== "undefined" ? moodVals     : [],
        rules:      typeof ruleEntries  !== "undefined" ? ruleEntries.map(e => e.val) : [],
        characters: getCharacterDataForSuggest(),
      },
      limits: { settingsMax: 4, moodsMax: 4, rulesMax: 20, charactersMax: 6 },
    };

    if (!body.book_id) {
      showToast("책을 먼저 선택해 주세요", "warning");
      return;
    }

    const res = await fetch("/api/suggest/world-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`suggest API ${res.status}`);
    const data = await res.json();

    applyWorldSuggestResult(data, body.locked);

  } catch (err) {
    console.error("[runWorldSetupSuggest]", err);
    showToast("AI 추천 실패 — 다시 시도해 주세요", "warning");
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

function getLockedCharacterNames() {
  return Array.from(document.querySelectorAll(".char-card.locked"))
    .map(card => card.querySelector(".char-name")?.value?.trim() || "")
    .filter(Boolean);
}

function getCharacterDataForSuggest() {
  return Array.from(document.querySelectorAll(".char-card")).map(card => ({
    name:        card.querySelector(".char-name")?.value?.trim() || "",
    gender:      card.dataset.gender || "",
    type:        card.dataset.type   || "",
    personality: card.querySelector(".char-personality")?.value?.trim() || "",
    initial_items: Array.from(card.querySelectorAll(".char-item-tag")).map(t => ({
      name: t.dataset.itemName || t.textContent.replace("×", "").trim(),
    })),
  })).filter(c => c.name);
}

function applyWorldSuggestResult(data, locked) {
  if (data.settings?.length) {
    const lockedSet = new Set(locked.settings);
    data.settings.forEach(item => {
      if (!lockedSet.has(item.label)) selectOrAddChip("settings", item.label);
    });
  }

  if (data.moods?.length) {
    const lockedSet = new Set(locked.moods);
    data.moods.forEach(item => {
      if (!lockedSet.has(item.label)) selectOrAddChip("moods", item.label);
    });
  }

  if (data.rulesToAdd?.length && typeof addRuleTagDirect === "function") {
    data.rulesToAdd.forEach(rule => {
      if (rule.text?.trim()) addRuleTagDirect(rule.text.trim(), !!rule.hard);
    });
  }

  if (data.characters?.length) {
    const lockedNames = new Set(locked.characters);
    data.characters.forEach(c => {
      if (!lockedNames.has(c.name) && charCount < 10) {
        charCount++;
        document.getElementById("charCountNum").textContent = charCount;
        renderCharCards();
        const cards = document.querySelectorAll(".char-card");
        const last  = cards[cards.length - 1];
        if (!last) return;
        last.querySelector(".char-name").value        = c.name        || "";
        last.querySelector(".char-personality").value = c.personality || "";
        last.querySelector(".char-card-name-preview").textContent = c.name || "이름 미입력";
        if (c.type) {
          const typeChip = last.querySelector(`.type-chips .char-chip[data-val="${c.type}"]`);
          if (typeChip) typeChip.click();
        }
        if (c.gender) {
          const genderChip = last.querySelector(`.gender-chips .char-chip[data-val="${c.gender}"]`);
          if (genderChip) genderChip.click();
        }
      }
    });
  }

  showToast("AI 추천이 반영됐습니다", "info");
}

function applySuggestion(section, data) {
  if (!Array.isArray(data)) return;
  if (section === "setting") {
    data.forEach(val => addChipDirect("settingGrid", settingVals, 3, val));
  } else if (section === "mood") {
    data.forEach(val => addChipDirect("moodGrid", moodVals, 3, val));
  } else if (section === "characters") {
    data.forEach(c => {
      if (charCount >= 10) return;
      charCount++;
      document.getElementById("charCountNum").textContent = charCount;
      renderCharCards();
      const cards = document.querySelectorAll(".char-card");
      const last  = cards[cards.length - 1];
      if (!last) return;
      last.querySelector(".char-name").value        = c.name        || "";
      last.querySelector(".char-personality").value = c.personality || "";
      last.querySelector(".char-card-name-preview").textContent = c.name || "이름 미입력";
    });
  } else if (section === "rules") {
    data.forEach(r => { if (r.val) addRuleTagDirect(r.val, !!r.hard); });
  }
}
