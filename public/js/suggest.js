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
    const cards = [...document.querySelectorAll(".char-card")];
    const cardIdx = cards.indexOf(card);

    btn.textContent = "⟳";
    startLoadingOverlay("charLoadingBar", LOADING_MSGS);

    try {
      const body = _buildWorldSetupBody("character_one", { character_index: cardIdx });
      const res = await fetch("/api/suggest/world-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      const c = json.character;
      if (!c) throw new Error("empty");

      const nameInp = card.querySelector(".char-name");
      const existingName = nameInp.value.trim();
      // 이름이 비어 있을 때만 AI 추천 이름 적용 (기존 입력 보호)
      if (!existingName) {
        nameInp.value = c.name || "";
        card.querySelector(".char-card-name-preview").textContent = c.name || "이름 미입력";
      }
      // 유형·성별은 기본값("인간"/"해당없음")이면 AI 추천 적용
      const existingType   = card.dataset.type   || "인간";
      const existingGender = card.dataset.gender || "해당없음";
      if (c.type && (existingType === "인간" || existingType === "기타")) {
        const typeChip = card.querySelector(`.type-chips .char-chip[data-val="${c.type}"]`);
        if (typeChip) typeChip.click();
      }
      if (c.gender && (existingGender === "해당없음" || existingGender === "기타")) {
        const genderChip = card.querySelector(`.gender-chips .char-chip[data-val="${c.gender}"]`);
        if (genderChip) genderChip.click();
      }
      // 성격·특성 — 비어 있을 때만 적용
      const taEl = card.querySelector(".char-personality");
      if (!taEl.value.trim()) {
        taEl.value = c.personality || "";
        taEl.style.height = "auto";
        taEl.style.height = taEl.scrollHeight + "px";
      }

      // 소지품 — 기존 태그를 보존하고 새 항목만 추가 (동명 항목은 추가 금지)
      if (c.initial_items?.length && typeof applyItemsToCard === "function") {
        const wrap = card.querySelector(".char-items-tag-wrap");
        const existingNames = new Set(
          Array.from(wrap?.querySelectorAll(".char-item-tag") ?? [])
            .map(t => (t.dataset.itemName || "").trim().toLowerCase())
            .filter(Boolean)
        );
        const newItems = c.initial_items.filter(it => {
          const nm = (typeof it === "string" ? it : it.name || "").trim().toLowerCase();
          return nm && !existingNames.has(nm);
        });
        if (newItems.length) applyItemsToCard(card, newItems);
      }
    } catch(e) {
      console.error("[suggest char]", e);
      showToast("인물 생성에 실패했습니다.", "err", 3000);
    } finally {
      btn.disabled = false;
      btn.textContent = "✨ AI 추천";
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
      allBtn.textContent = "✨ 전체 AI 추천";
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
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[refine] API error", res.status, errBody);
      throw new Error(`refine API ${res.status}`);
    }
    const json = await res.json();
    if (json.already_long) {
      showToast("이미 충분히 구체화되어 있습니다. (450자 이상)", "info", 3000);
    } else if (json.val) {
      // 구체화 결과가 기존보다 20% 이상 짧으면 반영하지 않음 (압축이 아닌 확장이어야 함)
      if (json.val.length < personality.length * 0.8) {
        console.warn("[refine] result too short, discarded", { orig: personality.length, result: json.val.length });
        showToast("구체화 결과가 기존보다 너무 짧아 반영하지 않았습니다.", "warn", 3000);
      } else {
        ta.value = json.val;
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
      }
    }
  } catch(e) {
    console.error("[refine]", e);
    showToast("구체화에 실패했습니다.", "err", 3000);
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ 구체화";
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
    btn.textContent = "✨ AI 추천";
    btn.classList.remove("loading");
    stopLoadingOverlay("rulesLoadingBar");
  }
}

// ── AI 세계관 추천 (world-setup) ──────────────────────────────

// ── v2 공통 헬퍼 ─────────────────────────────────────────────

function _buildWorldSetupBody(target, extra) {
  return {
    book_id: typeof bookId !== "undefined" ? bookId : null,
    target,
    locked: {
      settings:   [...(typeof lockedSettings !== "undefined" ? lockedSettings : [])],
      moods:      [...(typeof lockedMoods    !== "undefined" ? lockedMoods    : [])],
      characters: getLockedCharacterNames(),
    },
    current: {
      settings:   typeof settingVals !== "undefined" ? [...settingVals]  : [],
      moods:      typeof moodVals    !== "undefined" ? [...moodVals]     : [],
      rules:      typeof ruleEntries !== "undefined" ? ruleEntries.map(e => e.val) : [],
      characters: getCharacterDataForSuggest(),
      style:      typeof storyConfig !== "undefined" ? (storyConfig.style || "") : "",
      direction:  typeof storyConfig !== "undefined" ? {
        conflict:   storyConfig.conflict   ?? 5,
        foreshadow: storyConfig.foreshadow ?? 5,
        emotion:    storyConfig.emotion    ?? 5,
        dialogue:   storyConfig.dialogue   ?? 5,
        direction:  storyConfig.direction  ?? 5,
      } : {},
    },
    limits: {
      settingsMax: 3,
      moodsMax: 3,
      charactersMax: 5,
      characterCount: typeof charCount !== "undefined" ? charCount : 1,
      ...(extra || {}),
    },
  };
}

async function _callWorldSetupTarget(target, extra) {
  const body = _buildWorldSetupBody(target, extra);
  if (!body.book_id) { showToast("책을 먼저 선택해 주세요", "warning"); return null; }
  const res = await fetch("/api/suggest/world-setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`suggest API ${res.status}`);
  return res.json();
}

function _withBtnLoading(btn, loadingText, asyncFn) {
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = loadingText;
  asyncFn()
    .catch(err => {
      console.error("[suggest v2]", err);
      showToast("AI 추천 실패 — 다시 시도해 주세요", "warning");
    })
    .finally(() => {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    });
}

function _isSectionLocked(fieldId) {
  const field = document.getElementById(fieldId);
  return field ? field.classList.contains("section-locked") : false;
}

async function runSettingsSuggest() {
  if (_isSectionLocked("sectionFieldI")) return;
  const btn = document.getElementById("settingsAiBtn");
  if (!btn) return;
  const remaining = 3 - (typeof settingVals !== "undefined" ? settingVals.length : 0);
  if (remaining <= 0) { showToast("배경/세계관 선택 슬롯이 가득 찼습니다 (최대 3개)", "warn"); return; }
  _withBtnLoading(btn, "AI 추천 중...", async () => {
    const data = await _callWorldSetupTarget("settings");
    if (!data) return;
    const toAdd = data.settingsToAdd ?? [];
    if (!toAdd.length) { showToast("AI가 추천할 새 항목을 찾지 못했습니다", "warn"); return; }
    toAdd.forEach(item => addChipDirect("settingGrid", settingVals, 3, item.label));
    showToast(`배경/세계관 ${toAdd.length}개 추천됐습니다`, "info");
  });
}

async function runMoodsSuggest() {
  if (_isSectionLocked("sectionFieldII")) return;
  const btn = document.getElementById("moodsAiBtn");
  if (!btn) return;
  const remaining = 3 - (typeof moodVals !== "undefined" ? moodVals.length : 0);
  if (remaining <= 0) { showToast("장르/분위기 선택 슬롯이 가득 찼습니다 (최대 3개)", "warn"); return; }
  _withBtnLoading(btn, "AI 추천 중...", async () => {
    const data = await _callWorldSetupTarget("moods");
    if (!data) return;
    const toAdd = data.moodsToAdd ?? [];
    if (!toAdd.length) { showToast("AI가 추천할 새 항목을 찾지 못했습니다", "warn"); return; }
    toAdd.forEach(item => addChipDirect("moodGrid", moodVals, 3, item.label));
    showToast(`장르/분위기 ${toAdd.length}개 추천됐습니다`, "info");
  });
}

async function runRulesSuggestV2() {
  if (_isSectionLocked("sectionFieldIII")) return;
  const hasContext = (typeof settingVals !== "undefined" && settingVals.length > 0)
                  || (typeof moodVals    !== "undefined" && moodVals.length    > 0);
  if (!hasContext) { showToast("배경/세계관과 장르/분위기를 먼저 선택해 주세요", "warn"); return; }
  // 이미 10개이면 API 호출 없이 안내만
  const remaining = typeof _remainingRuleSlots === "function" ? _remainingRuleSlots()
    : Math.max(0, 10 - (typeof ruleEntries !== "undefined" ? ruleEntries.length : 0));
  if (remaining <= 0) { showToast("세계관 규칙은 최대 10개까지 설정할 수 있습니다.", "warn"); return; }
  const btn = document.getElementById("rulesAiBtn");
  if (!btn) return;
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "⟳";
  btn.classList.add("loading");
  startLoadingOverlay("rulesLoadingBar", RULES_LOADING_MSGS);
  _callWorldSetupTarget("rules")
    .then(data => {
      if (!data) return;
      const rules = data.rulesToAdd ?? [];
      if (!rules.length) { showToast("AI가 생성한 규칙이 없습니다", "warn"); return; }
      if (typeof addRuleTagDirect === "function") {
        // 남은 슬롯만큼만 적용 (문장 단위 유지, 중간 자르기 없음)
        const curRemaining = typeof _remainingRuleSlots === "function" ? _remainingRuleSlots()
          : Math.max(0, 10 - (typeof ruleEntries !== "undefined" ? ruleEntries.length : 0));
        let added = 0;
        for (const r of rules) {
          if (added >= curRemaining) break;
          if (r.text?.trim()) { addRuleTagDirect(r.text.trim(), !!r.hard); added++; }
        }
        if (added > 0) showToast(`규칙 ${added}개가 추가됐습니다`, "info");
        else showToast("추가할 수 있는 슬롯이 없습니다 (최대 10개)", "warn");
      }
    })
    .catch(err => {
      console.error("[runRulesSuggestV2]", err);
      showToast("규칙 생성에 실패했습니다. 잠시 후 다시 시도하세요.", "err", 4000);
    })
    .finally(() => {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      btn.classList.remove("loading");
      stopLoadingOverlay("rulesLoadingBar");
    });
}

async function runStyleSuggest() {
  if (_isSectionLocked("sectionFieldVI")) return;
  if (!(typeof settingVals !== "undefined" && (settingVals.length || moodVals.length))) {
    showToast("배경/세계관 또는 장르/분위기를 먼저 선택해 주세요", "warn"); return;
  }
  const btn = document.getElementById("styleAiBtn");
  if (!btn) return;
  _withBtnLoading(btn, "AI 추천 중...", async () => {
    const data = await _callWorldSetupTarget("style");
    if (!data || !data.style) { showToast("AI가 문체를 추천하지 못했습니다", "warn"); return; }
    const styleGrid = document.getElementById("styleGrid");
    if (styleGrid) {
      const chip = styleGrid.querySelector(`.radio-chip[data-val="${data.style}"]`);
      if (chip) chip.click();
    }
    showToast(`문체 "${data.style}" 추천됐습니다`, "info");
  });
}

async function runDirectionSuggest() {
  if (_isSectionLocked("sectionFieldVIII")) return;
  if (!(typeof settingVals !== "undefined" && (settingVals.length || moodVals.length))) {
    showToast("배경/세계관 또는 장르/분위기를 먼저 선택해 주세요", "warn"); return;
  }
  const btn = document.getElementById("directionAiBtn");
  if (!btn) return;
  _withBtnLoading(btn, "AI 추천 중...", async () => {
    const data = await _callWorldSetupTarget("direction");
    if (!data || !data.direction) { showToast("AI가 연출 수치를 추천하지 못했습니다", "warn"); return; }
    const dir = data.direction;
    [
      { key: "conflict",   sliderId: "conflictSlider",   valId: "conflictVal"   },
      { key: "foreshadow", sliderId: "foreshadowSlider", valId: "foreshadowVal" },
      { key: "emotion",    sliderId: "emotionSlider",    valId: "emotionVal"    },
      { key: "dialogue",   sliderId: "dialogueSlider",   valId: "dialogueVal"   },
      { key: "direction",  sliderId: "directionSlider",  valId: "directionVal"  },
    ].forEach(({ key, sliderId }) => {
      if (dir[key] == null) return;
      const slider = document.getElementById(sliderId);
      if (slider) {
        slider.value = dir[key];
        slider.dispatchEvent(new Event("input"));
      }
      if (typeof storyConfig !== "undefined") storyConfig[key] = dir[key];
    });
    showToast("연출 조율 수치가 업데이트됐습니다", "info");
  });
}

function selectOrAddChip(group, label) {
  const gridId = group === "settings" ? "settingGrid" : "moodGrid";
  const arr    = group === "settings" ? settingVals : moodVals;
  addChipDirect(gridId, arr, 3, label);
}

async function runWorldSetupSuggest() {
  const btn = document.getElementById("settingsAiBtn") || document.getElementById("aiSuggestBtn");
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
      limits: { settingsMax: 4, moodsMax: 4, rulesMax: 10, charactersMax: 5 },
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
    initial_items: Array.from(card.querySelectorAll(".char-item-tag")).map(t => {
      const nm = t.dataset.itemName || t.querySelector(".char-item-tag-name")?.textContent?.trim() || "";
      if (!nm) return null;
      const obj = { name: nm };
      if (t.dataset.grade)       obj.grade       = t.dataset.grade;
      if (t.dataset.description) obj.description = t.dataset.description;
      if (t.dataset.category)    obj.category    = t.dataset.category;
      if (t.dataset.badgeLabel)  obj.badge_label = t.dataset.badgeLabel;
      return obj;
    }).filter(Boolean),
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
      if (!lockedNames.has(c.name) && charCount < 5) {
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
        if (c.initial_items?.length && typeof applyItemsToCard === "function") {
          applyItemsToCard(last, c.initial_items);
        }
      }
    });
  }

  showToast("AI 추천이 반영됐습니다", "info");
}

// ── 소지품 상세 AI 추천 (item_detail) ────────────────────────
async function suggestItemDetail(editorPanel, card) {
  if (!editorPanel) return;
  const nameVal = editorPanel.querySelector(".item-ed-name").value.trim();
  if (!nameVal) { showToast("소지품 이름을 먼저 입력해주세요.", "warn"); return; }

  const btn = editorPanel.querySelector(".item-ai-suggest-btn");
  const origHtml = btn?.innerHTML || "✨ 설명 추천";
  if (btn) { btn.disabled = true; btn.textContent = "⟳"; }

  try {
    const charName    = card.querySelector(".char-name")?.value?.trim() || "";
    const charType    = card.dataset.type   || "";
    const charGender  = card.dataset.gender || "";
    const personality = card.querySelector(".char-personality")?.value?.trim() || "";

    const existingDesc = editorPanel.querySelector(".item-ed-desc").value.trim();
    const existingCat  = editorPanel.querySelector(".item-ed-cat").value.trim();

    const body = {
      book_id: typeof bookId !== "undefined" ? bookId : null,
      target: "item_detail",
      item_name: nameVal,
      char_name: charName,
      char_type: charType,
      char_gender: charGender,
      personality,
      existing_description: existingDesc,
      existing_category:    existingCat,
      context: {
        settings: typeof settingVals !== "undefined" ? [...settingVals] : [],
        moods:    typeof moodVals    !== "undefined" ? [...moodVals]    : [],
        rules:    typeof ruleEntries !== "undefined" ? ruleEntries.map(e => e.val) : [],
      },
    };
    if (!body.book_id) { showToast("책을 먼저 선택해 주세요", "warning"); return; }

    const res = await fetch("/api/suggest/world-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[suggestItemDetail] API error", res.status, errBody);
      throw new Error(`suggest API ${res.status}`);
    }
    const data = await res.json();
    const item = data.item;
    if (!item || !item.description) {
      console.error("[suggestItemDetail] empty item response", data);
      throw new Error("empty item");
    }

    // 사용자가 이미 입력한 값은 덮어쓰지 않음
    const descInput = editorPanel.querySelector(".item-ed-desc");
    const catInput  = editorPanel.querySelector(".item-ed-cat");
    if (!descInput.value.trim() && item.description) descInput.value = item.description;
    if (!catInput.value.trim() && item.category)    catInput.value  = item.category;
    showToast("소지품 정보가 추천됐습니다", "info");
  } catch (e) {
    console.error("[suggestItemDetail]", e);
    showToast("소지품 추천에 실패했습니다.", "err", 3000);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

// ── 소지품 설명 구체화 (item_refine) ──────────────────────────
async function suggestItemRefine(editorPanel, card) {
  if (!editorPanel) return;
  const nameVal = editorPanel.querySelector(".item-ed-name").value.trim();
  const descVal = editorPanel.querySelector(".item-ed-desc").value.trim();
  if (!nameVal) { showToast("소지품 이름을 먼저 입력해주세요.", "warn"); return; }
  if (!descVal) { showToast("구체화할 기존 설명이 없습니다. 설명 추천을 먼저 사용해 주세요.", "warn"); return; }

  const btn = editorPanel.querySelector(".item-ai-refine-btn");
  const origHtml = btn?.innerHTML || "✨ 설명 구체화";
  if (btn) { btn.disabled = true; btn.textContent = "⟳"; }

  try {
    const charName   = card.querySelector(".char-name")?.value?.trim() || "";
    const charType   = card.dataset.type   || "";
    const charGender = card.dataset.gender || "";
    const personality = card.querySelector(".char-personality")?.value?.trim() || "";
    const existingCat = editorPanel.querySelector(".item-ed-cat").value.trim();

    const body = {
      book_id: typeof bookId !== "undefined" ? bookId : null,
      target: "item_refine",
      item_name: nameVal,
      char_name: charName,
      char_type: charType,
      char_gender: charGender,
      personality,
      existing_description: descVal,
      existing_category: existingCat,
      context: {
        settings: typeof settingVals !== "undefined" ? [...settingVals] : [],
        moods:    typeof moodVals    !== "undefined" ? [...moodVals]    : [],
        rules:    typeof ruleEntries !== "undefined" ? ruleEntries.map(e => e.val) : [],
      },
    };
    if (!body.book_id) { showToast("책을 먼저 선택해 주세요", "warning"); return; }

    const res = await fetch("/api/suggest/world-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[suggestItemRefine] API error", res.status, errBody);
      throw new Error(`suggest API ${res.status}`);
    }
    const data = await res.json();
    const item = data.item;
    if (!item?.description) throw new Error("empty item description");

    editorPanel.querySelector(".item-ed-desc").value = item.description;
    if (item.category && !existingCat) editorPanel.querySelector(".item-ed-cat").value = item.category;
    showToast("설명이 구체화됐습니다", "info");
  } catch (e) {
    console.error("[suggestItemRefine]", e);
    showToast("설명 구체화에 실패했습니다.", "err", 3000);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

function applySuggestion(section, data) {
  if (!Array.isArray(data)) return;
  if (section === "setting") {
    data.forEach(val => addChipDirect("settingGrid", settingVals, 3, val));
  } else if (section === "mood") {
    data.forEach(val => addChipDirect("moodGrid", moodVals, 3, val));
  } else if (section === "characters") {
    data.forEach(c => {
      if (charCount >= 5) return;
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
