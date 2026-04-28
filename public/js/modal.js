// ── 스프레드(장) 네비게이션 ───────────────────────────────────
const SPREAD_TITLES = [
  "✦ &nbsp; W O R L D &nbsp; B I B L E &nbsp; ✦",
  "✦ &nbsp; S T O R Y &nbsp; C O N F I G &nbsp; ✦",
];
const TOTAL_SPREADS = 2;
let currentSpread = 0;

function goSpread(delta, absolute = false) {
  const next = absolute ? delta : currentSpread + delta;
  if (next < 0 || next >= TOTAL_SPREADS) return;

  const track = document.querySelector(".spread-track");
  track.style.transform = `translateX(-${next * 100}%)`;

  document.querySelectorAll(".bible-spread").forEach((el, i) => {
    el.classList.toggle("hidden", i !== next);
  });
  document.querySelectorAll(".spread-dot").forEach((el, i) => {
    el.classList.toggle("active", i === next);
  });

  document.getElementById("spreadPrev").disabled = next === 0;
  document.getElementById("spreadNext").disabled = next === TOTAL_SPREADS - 1;
  document.getElementById("spreadTitle").innerHTML = SPREAD_TITLES[next];
  document.getElementById("spreadPageHint").textContent =
    `${next + 1} / ${TOTAL_SPREADS} · WORLD BIBLE · FlowScribe`;

  currentSpread = next;
}

// ── 모달 & 컨텍스트 저장 ──────────────────────────────────────

// 인물 카드 이름 추출 — 편집 모드(input) / 잠금 모드(preview span) 모두 지원
function getCharCardName(card) {
  try {
    // 1. 편집 모드: .char-name input
    const inputVal = card.querySelector(".char-name")?.value?.trim();
    if (inputVal) return inputVal;

    // 2. dataset (잠금/확정 후 저장된 이름)
    const dataName = (card.dataset.name ?? card.dataset.charName ?? "").trim();
    if (dataName) return dataName;

    // 3. 헤더 미리보기 텍스트 (.char-card-name-preview — chars.js 기준)
    const previewEl = card.querySelector(".char-card-name-preview");
    const previewTxt = previewEl?.textContent?.trim() ?? "";
    if (previewTxt && !/^이름\s*미입력$/.test(previewTxt) && !/^인물\s*\d*$/.test(previewTxt)) return previewTxt;

    // 4. 그 외 가능한 정적 표시 요소 (방어적 fallback)
    for (const sel of [".char-card-title", ".char-label", ".char-name-display", ".char-summary-name"]) {
      const el = card.querySelector(sel);
      const txt = (el?.textContent ?? "").trim();
      if (txt && !/^인물\s*\d*$/.test(txt)) return txt;
    }

    return "";
  } catch (e) {
    console.warn("[getCharCardName] error:", e);
    return "";
  }
}

function getContext() {
  return [
    settingVals.length ? "배경: " + settingVals.join(", ") : "",
    moodVals.length    ? "분위기: " + moodVals.join(", ")  : "",
    [...document.querySelectorAll(".char-name")].map(i=>i.value).filter(Boolean).join(", "),
    ruleEntries.map(e=>e.val).join(", "),
  ].filter(Boolean).join(" / ");
}

function openModal() {
  const overlay = document.getElementById("modalOverlay");
  if (!overlay) return;
  overlay.style.removeProperty("display");
  overlay.removeAttribute("aria-hidden");
  overlay.classList.add("open");
  goSpread(0, true);
}

function closeModal() {
  const overlay = document.getElementById("modalOverlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  // display 인라인 스타일이 남아 있으면 강제 제거
  const computed = getComputedStyle(overlay).display;
  if (computed !== "none") {
    overlay.style.display = "none";
  } else {
    overlay.style.removeProperty("display");
  }
}

function closeModalOutside(e) { /* 바깥 클릭으로 닫지 않음 — 저장 후 닫기 버튼만 사용 */ }

async function saveContext() {
  console.debug("[saveContext] ENTER");

  // 버튼 로딩 상태
  const saveBtn = document.querySelector('.btn-save, [onclick*="saveContext"]');
  const origText = saveBtn?.innerHTML || '저장 후 닫기';
  function _restoreBtn() {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origText; }
  }
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';
  }

  try {
    // Step A: 전역 변수 안전 접근
    const _settingVals = typeof settingVals !== "undefined" ? settingVals : [];
    const _moodVals    = typeof moodVals    !== "undefined" ? moodVals    : [];
    const _ruleEntries = typeof ruleEntries !== "undefined" ? ruleEntries : [];
    const _storyConfig = typeof storyConfig !== "undefined" ? storyConfig : {};
    const _bookId      = typeof bookId      !== "undefined" ? bookId      : null;

    console.debug("[saveContext] globals ok", { _bookId, settingCount: _settingVals.length });

    if (!_bookId) {
      console.error("[saveContext] no bookId");
      showToast("책을 먼저 선택해 주세요", "err");
      _restoreBtn();
      return;
    }

    // Step B: 이름 미입력 인물카드 검증
    const unnamedCards = [...document.querySelectorAll(".char-card")].filter(
      card => !getCharCardName(card)
    );

    console.debug("[saveContext] unnamed count:", unnamedCards.length);

    if (unnamedCards.length) {
      unnamedCards.forEach(card => {
        const inp = card.querySelector(".char-name");
        if (inp) {
          inp.style.borderColor = "var(--danger-text)";
          inp.placeholder = "이름을 입력해야 저장할 수 있습니다";
          inp.focus();
        } else {
          card.style.outline = "2px solid var(--danger-text, red)";
        }
      });
      showToast(`이름이 비어 있는 인물 카드가 ${unnamedCards.length}개 있습니다`, "err");
      _restoreBtn();
      return;
    }

    // Step C: 데이터 수집
    console.debug("[saveContext] building payload");

    const genres = [..._settingVals, ..._moodVals];
    const characterDefaults = {};
    const characterRows = [];

    document.querySelectorAll(".char-card").forEach(card => {
      try {
        const name = getCharCardName(card);
        if (!name) return;

        const personality = card.querySelector(".char-personality")?.value?.trim() ?? "";
        let type   = card.dataset.type   ?? "기타";
        let gender = card.dataset.gender ?? "기타";
        if (type   === "기타") type   = card.querySelector(".type-inp")?.value?.trim()   || "기타";
        if (gender === "기타") gender = card.querySelector(".gender-inp")?.value?.trim() || "기타";

        const initial_items = Array.from(card.querySelectorAll(".char-item-tag")).map(t => {
          const nm = (t.dataset.itemName || Array.from(t.childNodes)
            .filter(n => n.nodeType === 3)
            .map(n => n.textContent.trim())
            .join('')).trim();
          const gr = t.dataset.grade || null;
          if (!nm) return null;
          return gr ? { name: nm, grade: gr } : { name: nm };
        }).filter(Boolean);

        characterDefaults[name] = { type, gender, personality, description: personality, initial_items };
        characterRows.push({ name, personality, type, gender, source: "user", initial_items });
      } catch (cardErr) {
        console.warn("[saveContext] card error:", cardErr);
      }
    });

    const worldBible = {
      world_rules: [
        ...(genres.length ? [`장르: ${genres.join(", ")}`] : []),
        ..._ruleEntries.filter(e => !e.hard).map(e => e.val),
      ],
      character_defaults: characterDefaults,
      fixed_relationships: [],
      forbidden_settings: _ruleEntries.filter(e => e.hard).map(e => e.val),
    };

    console.debug("[saveContext] payload built, characterRows:", characterRows.length);

    // Step D: 세계관 저장 (critical)
    console.debug("[saveContext] POST /api/context");
    const contextRes = await fetch("/api/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book_id: _bookId, worldBible, storyConfig: _storyConfig }),
    });

    if (!contextRes.ok) {
      const errText = await contextRes.text().catch(() => "");
      throw new Error(`/api/context failed: ${contextRes.status} ${errText.slice(0, 200)}`);
    }

    console.debug("[saveContext] context saved ok");

    // Step E: 인물 저장 (non-critical — 실패해도 모달 닫기)
    if (characterRows.length > 0) {
      console.debug("[saveContext] POST /api/characters");
      try {
        const charRes = await fetch("/api/characters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ book_id: _bookId, characters: characterRows }),
        });
        if (!charRes.ok) {
          const errText = await charRes.text().catch(() => "");
          console.warn("[saveContext] /api/characters non-ok:", charRes.status, errText.slice(0, 200));
          showToast("세계관은 저장됐지만 인물 정보 일부를 확인해야 합니다", "warning");
        } else {
          console.debug("[saveContext] characters saved ok");
        }
      } catch (charErr) {
        console.warn("[saveContext] /api/characters exception:", charErr);
        showToast("세계관은 저장됐지만 인물 정보 저장 중 경고가 있습니다", "warning");
      }
    }

    // Step F: 2화 이후 인물 카드 잠금 적용
    if (typeof currentEpisode !== "undefined" && currentEpisode > 1) {
      document.querySelectorAll(".char-card").forEach(card => {
        card.dataset.saved = "true";
        if (typeof lockCharCardFields === "function") {
          try { lockCharCardFields(card, true); } catch (e) {}
        }
      });
    }

    // Step G: 세계관 설정 버튼 활성화
    const sb = document.getElementById("settingsBtn");
    if (sb) {
      sb.classList.add("active");
      sb.innerHTML = `세계관 설정 <span class="badge">ON</span>`;
    }

    // Step H: 버튼 복원 후 모달 닫기
    _restoreBtn();
    console.debug("[saveContext] calling closeModal");
    closeModal();

    const overlay = document.getElementById("modalOverlay");
    console.debug("[saveContext] DONE", {
      overlayOpen: overlay?.classList.contains("open"),
      overlayDisplay: overlay ? getComputedStyle(overlay).display : "N/A",
    });

  } catch (err) {
    console.error("[saveContext] FATAL ERROR:", err);
    if (typeof showToast === "function") {
      showToast("설정 저장 중 오류가 발생했습니다. 콘솔을 확인하세요.", "err");
    }
    _restoreBtn();
  }
}
