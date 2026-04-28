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
}

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
function closeModal() {
  const overlay = document.getElementById("modalOverlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.style.removeProperty("display");
}
function closeModalOutside(e) { /* 바깥 클릭으로 닫지 않음 — 저장 후 닫기 버튼만 사용 */ }

async function saveContext() {
  // 이름 미입력 인물카드 검증
  const unnamedCards = [...document.querySelectorAll(".char-card")].filter(
    card => !getCharCardName(card)
  );
  if (unnamedCards.length) {
    unnamedCards.forEach(card => {
      const inp = card.querySelector(".char-name");
      if (inp) {
        inp.style.borderColor = "var(--danger-text)";
        inp.placeholder = "이름을 입력해야 저장할 수 있습니다";
        inp.focus();
      } else {
        // 잠금/확정 상태 카드: 카드 테두리만 강조
        card.style.borderColor = "var(--danger-text)";
      }
    });
    showToast(`이름이 비어 있는 인물 카드가 ${unnamedCards.length}개 있습니다`, "err");
    return;
  }

  // 데이터 수집
  const genres = [...(settingVals || []), ...(moodVals || [])];
  const characterDefaults = {};
  const characterRows = [];
  document.querySelectorAll(".char-card").forEach(card => {
    const name        = getCharCardName(card);
    const personality = card.querySelector(".char-personality")?.value?.trim() ?? "";
    let type   = card.dataset.type ?? "기타";
    let gender = card.dataset.gender ?? "기타";
    if (type   === "기타") type   = card.querySelector(".type-inp")?.value?.trim()   || "기타";
    if (gender === "기타") gender = card.querySelector(".gender-inp")?.value?.trim() || "기타";
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
      ...(ruleEntries || []).filter(e => !e.hard).map(e => e.val),
    ],
    character_defaults: characterDefaults,
    fixed_relationships: [],
    forbidden_settings: (ruleEntries || []).filter(e => e.hard).map(e => e.val),
  };

  // 세계관 저장 (critical — 실패 시 모달 유지)
  try {
    const contextRes = await fetch("/api/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book_id: bookId, worldBible, storyConfig }),
    });
    if (!contextRes.ok) {
      const errText = await contextRes.text().catch(() => "");
      throw new Error(`context save failed: ${contextRes.status} ${errText}`);
    }
  } catch (err) {
    console.error("[saveContext] /api/context failed:", err);
    showToast("세계관 저장 실패 — 다시 시도해 주세요", "err");
    return; // 모달 유지
  }

  // 인물 저장 (non-critical — 실패해도 모달 닫기)
  if (characterRows.length > 0) {
    try {
      const charRes = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, characters: characterRows }),
      });
      if (!charRes.ok) {
        const errText = await charRes.text().catch(() => "");
        console.warn("[saveContext] /api/characters warning:", charRes.status, errText);
        showToast("인물 정보 일부 저장에 문제가 발생했습니다", "warning");
      }
    } catch (err) {
      console.warn("[saveContext] /api/characters exception:", err);
      showToast("인물 정보 저장 중 오류 — 세계관은 저장됐습니다", "warning");
    }
  }

  // 저장 완료 후 UI 갱신 및 모달 닫기
  if (typeof currentEpisode !== "undefined" && currentEpisode > 1) {
    document.querySelectorAll(".char-card").forEach(card => {
      card.dataset.saved = "true";
      if (typeof lockCharCardFields === "function") lockCharCardFields(card, true);
    });
  }
  const sb = document.getElementById("settingsBtn");
  if (sb) {
    sb.classList.add("active");
    sb.innerHTML = `세계관 설정 <span class="badge">ON</span>`;
  }
  closeModal(); // context 저장 성공 후 항상 호출
}
