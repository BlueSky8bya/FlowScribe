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

const _SAVE_MSGS = [
  "소지품의 출처를 파악하고 있습니다…", "인물의 첫 장비를 정리하고 있습니다…",
  "세계관 규칙과 소지품 설명을 맞춰보고 있습니다…", "등장인물의 기억 속 단서를 정리하고 있습니다…",
  "인물의 성격과 소지품이 어울리는지 확인하고 있습니다…", "세계의 첫 페이지를 열고 있습니다…",
  "초기 설정을 세계관 기록에 등록하고 있습니다…", "이야기의 뿌리를 내리고 있습니다…",
  "인물 관계도를 그리고 있습니다…", "세계관 규칙 충돌 여부를 점검하고 있습니다…",
  "이름과 성격이 어울리는지 살펴보고 있습니다…", "소지품 목록을 서사 흐름에 맞게 배치하고 있습니다…",
  "설정 초안을 문서화하고 있습니다…", "인물의 첫 등장 방식을 고민하고 있습니다…",
  "숨겨진 설정을 기록하고 있습니다…", "장르에 맞는 도구를 확인하고 있습니다…",
  "이야기를 시작하기 위한 준비를 마치고 있습니다…", "캐릭터 고유 특성을 정리하고 있습니다…",
  "아이템의 용도를 서사적으로 해석하고 있습니다…", "세계관 분위기와 소지품을 조율하고 있습니다…",
  "주인공의 첫 챕터를 상상하고 있습니다…", "등장인물의 동기를 명확히 하고 있습니다…",
  "소지품에 담긴 이야기를 풀어내고 있습니다…", "인물의 배경을 세계관에 녹이고 있습니다…",
  "복선이 될 소지품을 선별하고 있습니다…", "설정 저장소를 업데이트하고 있습니다…",
  "이야기의 씨앗을 심고 있습니다…", "캐릭터의 첫 발자국을 기록하고 있습니다…",
  "세계관 규칙을 교차 검증하고 있습니다…", "소지품 설명이 일관되는지 확인하고 있습니다…",
  "등장 장면을 준비하고 있습니다…", "장르 특성에 맞는 단어를 선택하고 있습니다…",
  "미리 써둔 복선을 정리하고 있습니다…", "인물의 감정선을 추적하고 있습니다…",
  "세계의 역사를 정리하고 있습니다…", "이야기의 톤을 세팅하고 있습니다…",
  "캐릭터 간 관계를 분류하고 있습니다…", "소지품의 등장 빈도를 조율하고 있습니다…",
  "세계관 내 금기 사항을 확인하고 있습니다…", "인물의 언어 습관을 메모하고 있습니다…",
  "장소와 소지품의 연계성을 보고 있습니다…", "배경 설정을 간결하게 압축하고 있습니다…",
  "규칙의 예외 조항을 등록하고 있습니다…", "고유 아이템 이름의 문법을 점검하고 있습니다…",
  "설정 간 충돌을 방지하는 규칙을 작성하고 있습니다…", "캐릭터의 비밀을 기록소에 보관하고 있습니다…",
  "세계 밖 관점에서 설정을 검토하고 있습니다…", "처음 만나는 독자를 위해 설정을 다듬고 있습니다…",
  "마법 체계와 소지품의 연관성을 따지고 있습니다…", "이야기의 첫 문장을 상상하고 있습니다…",
  "캐릭터 프로필 카드를 작성하고 있습니다…", "소지품 재고 목록을 완성하고 있습니다…",
  "세계관 문서를 압축 저장하고 있습니다…", "언어 설정을 세계관에 맞게 조정하고 있습니다…",
  "역할군에 어울리는 장비를 배치하고 있습니다…", "설정의 공백을 채우고 있습니다…",
  "등장인물의 첫 감정을 기록하고 있습니다…", "인물이 지닌 물건의 의미를 해석하고 있습니다…",
  "세계관 지도의 첫 윤곽을 잡고 있습니다…", "소지품의 희귀도를 세계관 기준으로 정리하고 있습니다…",
  "이야기 시작점을 세계관에 고정하고 있습니다…", "인물의 결핍을 소지품으로 표현하고 있습니다…",
  "장르적 클리셰를 피하기 위해 설정을 점검하고 있습니다…", "세계관의 내부 논리를 검증하고 있습니다…",
  "이야기 속 물건의 무게를 가늠하고 있습니다…", "캐릭터가 사용할 언어를 정리하고 있습니다…",
  "서사적 긴장감을 높일 설정을 확인하고 있습니다…", "인물의 첫 행동을 예측하고 있습니다…",
  "세계관 설정을 내러티브 구조에 연결하고 있습니다…", "배경 소음을 걸러내고 있습니다…",
  "소지품이 복선으로 작동할 수 있는지 보고 있습니다…", "설정이 이야기의 흐름을 해치지 않는지 확인하고 있습니다…",
  "인물의 욕망이 설정에 반영됐는지 확인하고 있습니다…", "세계관 외부 변수를 정리하고 있습니다…",
  "규칙을 이야기 안에서 테스트하고 있습니다…", "기억 속 단서가 뒤에 등장할 것을 준비하고 있습니다…",
  "초반 장면을 위한 분위기를 설정하고 있습니다…", "세계관 내 시간대를 확인하고 있습니다…",
  "소지품이 캐릭터 성격과 일치하는지 점검하고 있습니다…", "설정 데이터를 정제하고 있습니다…",
  "이야기 시작 전의 고요함을 저장하고 있습니다…", "인물의 한계를 세계관에 반영하고 있습니다…",
  "설정의 일관성을 최종 검토하고 있습니다…", "배경 디테일을 세계관 문서에 기입하고 있습니다…",
  "장르와 분위기가 일치하는지 확인하고 있습니다…", "캐릭터의 숨겨진 면모를 기록하고 있습니다…",
  "이야기 전체 구조와 세계관이 연결되는지 확인하고 있습니다…", "세계관 데이터를 암호화하고 있습니다…",
  "서사의 첫 단추를 채우고 있습니다…", "인물과 세계가 하나가 되는 순간을 준비하고 있습니다…",
  "저장 중입니다…",
];

async function saveContext() {
  console.debug("[saveContext] ENTER");

  // 버튼 로딩 상태 — 버튼 텍스트는 "저장 중..."으로 고정, 랜덤 메시지는 별도 span에 표시
  const saveBtn = document.querySelector('.btn-save, [onclick*="saveContext"]');
  const statusMsgEl = document.getElementById("saveStatusMsg");
  const origText = saveBtn?.innerHTML || '저장 후 닫기';
  let _msgInterval = null;
  function _startMsgCycle() {
    const pick = () => _SAVE_MSGS[Math.floor(Math.random() * _SAVE_MSGS.length)];
    if (statusMsgEl) { statusMsgEl.textContent = pick(); statusMsgEl.style.display = ""; }
    _msgInterval = setInterval(() => {
      if (statusMsgEl) statusMsgEl.textContent = pick();
    }, 2500);
  }
  function _restoreBtn() {
    if (_msgInterval) { clearInterval(_msgInterval); _msgInterval = null; }
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origText; }
    if (statusMsgEl) { statusMsgEl.textContent = ""; statusMsgEl.style.display = "none"; }
  }
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중...";
    _startMsgCycle();
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
          if (!nm) return null;
          const obj = { name: nm };
          if (t.dataset.grade)      obj.grade       = t.dataset.grade;
          if (t.dataset.description) obj.description = t.dataset.description;
          if (t.dataset.category)   obj.category    = t.dataset.category;
          if (t.dataset.badgeLabel) obj.badge_label  = t.dataset.badgeLabel;
          return obj;
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
