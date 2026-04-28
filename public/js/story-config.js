// ── 서사 설정 (시점·문체·분량·슬라이더) ──────────────────────

function buildRadioChips(containerId, items, stateKey) {
  const container = document.getElementById(containerId);
  items.forEach(label => {
    const btn = document.createElement("button");
    btn.className = "chip radio-chip" + (storyConfig[stateKey] === label ? " selected" : "");
    btn.dataset.val = label;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      container.querySelectorAll(".radio-chip").forEach(c => c.classList.remove("selected"));
      btn.classList.add("selected");
      storyConfig[stateKey] = label;
    });
    container.appendChild(btn);
  });
}

function initSliders() {
  const sliders = [
    { id: "conflictSlider",   valId: "conflictVal",   key: "conflict"   },
    { id: "foreshadowSlider", valId: "foreshadowVal", key: "foreshadow" },
    { id: "emotionSlider",    valId: "emotionVal",    key: "emotion"    },
    { id: "dialogueSlider",   valId: "dialogueVal",   key: "dialogue"   },
    { id: "directionSlider",  valId: "directionVal",  key: "direction"  },
  ];
  sliders.forEach(({ id, valId, key }) => {
    const slider = document.getElementById(id);
    const valEl  = document.getElementById(valId);
    if (!slider || !valEl) return;
    function updateSlider() {
      const pct = ((slider.value - 1) / 9 * 100).toFixed(1) + "%";
      slider.style.setProperty("--pct", pct);
      valEl.textContent = slider.value;
    }
    slider.value = storyConfig[key];
    updateSlider();
    slider.addEventListener("input", () => {
      storyConfig[key] = Number(slider.value);
      updateSlider();
    });
  });
}

function initVolumeInputs() {
  const fields = [
    { id: "epLenInput",       key: "episodeLength"    },
    { id: "epVarInput",       key: "episodeLengthVar" },
    { id: "totalEpInput",     key: "totalEpisodes"    },
    { id: "totalEpVarInput",  key: "totalEpisodesVar" },
  ];
  fields.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = storyConfig[key];
    function _syncVal() {
      const v = Number(el.value);
      if (v > 0) { storyConfig[key] = v; el.value = v; }
    }
    el.addEventListener("change", _syncVal);
    el.addEventListener("input",  _syncVal);
  });
}

// 초기화
buildRadioChips("povGrid",   POV_ITEMS,   "pov");
buildRadioChips("styleGrid", STYLE_ITEMS, "style");
initSliders();
initVolumeInputs();
