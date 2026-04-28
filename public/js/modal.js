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

function getContext() {
  return [
    settingVals.length ? "배경: " + settingVals.join(", ") : "",
    moodVals.length    ? "분위기: " + moodVals.join(", ")  : "",
    [...document.querySelectorAll(".char-name")].map(i=>i.value).filter(Boolean).join(", "),
    ruleEntries.map(e=>e.val).join(", "),
  ].filter(Boolean).join(" / ");
}

function openModal()  {
  document.getElementById("modalOverlay").classList.add("open");
  goSpread(0, true);
}
function closeModal() { document.getElementById("modalOverlay").classList.remove("open"); }
function closeModalOutside(e) { /* 바깥 클릭으로 닫지 않음 — 저장 후 닫기 버튼만 사용 */ }

async function saveContext() {
  const genres = [...settingVals, ...moodVals];

  // 이름 미입력 인물카드 검증
  const unnamedCards = [...document.querySelectorAll(".char-card")].filter(
    card => !card.querySelector(".char-name")?.value?.trim()
  );
  if (unnamedCards.length) {
    unnamedCards.forEach(card => {
      const inp = card.querySelector(".char-name");
      inp.style.borderColor = "var(--danger-text)";
      inp.placeholder = "이름을 입력해야 저장할 수 있습니다";
      inp.focus();
    });
    showToast(`이름이 비어 있는 인물 카드가 ${unnamedCards.length}개 있습니다`, "err");
    return;
  }

  const characterDefaults = {};
  const characterRows = [];
  document.querySelectorAll(".char-card").forEach(card => {
    const name        = card.querySelector(".char-name")?.value?.trim() ?? "";
    const personality = card.querySelector(".char-personality")?.value?.trim() ?? "";
    let type   = card.dataset.type;
    let gender = card.dataset.gender;
    if (type   === "기타") type   = card.querySelector(".type-inp").value.trim()   || "기타";
    if (gender === "기타") gender = card.querySelector(".gender-inp").value.trim() || "기타";
    if (!name) return;
    // 초기 소지품: tag 시스템에서 텍스트 추출 → [{name}] 배열
    const initial_items = Array.from(card.querySelectorAll(".char-item-tag")).map(t => {
      const nm = (t.dataset.itemName || Array.from(t.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')).trim();
      const gr = t.dataset.grade || null;
      if (!nm) return null;
      return gr ? { name: nm, grade: gr } : { name: nm };
    }).filter(Boolean);
    characterDefaults[name] = { type, gender, personality, description: personality, initial_items };
    characterRows.push({ name, personality, type, gender, source: "user", initial_items });
  });

  const worldBible = {
    world_rules: [
      ...(genres.length ? [`장르: ${genres.join(", ")}`] : []),
      ...ruleEntries.filter(e => !e.hard).map(e => e.val),
    ],
    character_defaults: characterDefaults,
    fixed_relationships: [],
    forbidden_settings: ruleEntries.filter(e => e.hard).map(e => e.val),
  };

  try {
    await fetch("/api/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book_id: bookId, worldBible, storyConfig }),
    });

    if (characterRows.length > 0) {
      await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, characters: characterRows }),
      });
    }

    // 저장 완료 — 1화 이후면 이 시점부터 모든 카드 이름/유형/성별 잠금
    if (currentEpisode > 1) {
      document.querySelectorAll(".char-card").forEach(card => {
        card.dataset.saved = "true";
        lockCharCardFields(card, true);
      });
    }
  } catch {
    showToast("서버 연결 실패 — 설정은 로컬에 유지됩니다", "warning");
  } finally {
    const sb = document.getElementById("settingsBtn");
    if (sb) {
      sb.classList.add("active");
      sb.innerHTML = `세계관 설정 <span class="badge">ON</span>`;
    }
    closeModal();
  }
}
