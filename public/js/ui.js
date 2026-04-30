// ── UI 유틸리티: 테마, 토스트, 읽기 모드, 로딩 오버레이 ──────

const output  = document.getElementById("output");
const btn     = document.getElementById("sendBtn");
const prevBtn = document.getElementById("prevBtn");
const epInfo  = document.getElementById("epInfo");

function esc(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── data-tip 플로팅 툴팁 (sidebar: 커서 추적 / topbar: 버튼 아래 고정) ──
document.addEventListener("DOMContentLoaded", () => {
  const tip = document.getElementById("hexFloatTip");
  if (!tip) return;

  function showTip(text) {
    tip.innerHTML = text.replace(/\n/g, "<br>");
    tip.style.transform = "";
    tip.style.display = "block";
  }
  function hideTip() { tip.style.display = "none"; tip.style.transform = ""; }

  // 사이드바: 커서 따라다님
  document.querySelector(".sidebar")?.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    showTip(el.getAttribute("data-tip"));
  });
  document.querySelector(".sidebar")?.addEventListener("mousemove", e => {
    if (tip.style.display === "none") return;
    tip.style.left = (e.clientX + 14) + "px";
    tip.style.top  = (e.clientY - 10) + "px";
  });
  document.querySelector(".sidebar")?.addEventListener("mouseout", e => {
    if (!e.target.closest("[data-tip]")) return;
    const to = e.relatedTarget;
    if (to && e.target.closest("[data-tip]")?.contains(to)) return;
    hideTip();
  });

  // 탑바: 버튼 아래 중앙 고정
  document.querySelector(".main-topbar")?.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    showTip(el.getAttribute("data-tip"));
    const rect = el.getBoundingClientRect();
    tip.style.left = (rect.left + rect.width / 2) + "px";
    tip.style.top  = (rect.bottom + 8) + "px";
    tip.style.transform = "translateX(-50%)";
  });
  document.querySelector(".main-topbar")?.addEventListener("mouseout", e => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    const to = e.relatedTarget;
    if (to && el.contains(to)) return;
    hideTip();
  });

  // 하단 바: 버튼 위 중앙 고정 (overflow:hidden 컨테이너 밖으로)
  document.querySelector(".bottom-controls")?.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    showTip(el.getAttribute("data-tip"));
    const rect = el.getBoundingClientRect();
    tip.style.left = (rect.left + rect.width / 2) + "px";
    tip.style.top  = (rect.top - 8) + "px";
    tip.style.transform = "translateX(-50%) translateY(-100%)";
  });
  document.querySelector(".bottom-controls")?.addEventListener("mouseout", e => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    const to = e.relatedTarget;
    if (to && el.contains(to)) return;
    hideTip();
  });

  // 오른쪽 패널: 커서 따라다님 (왼쪽으로 표시 — CSS로 이미 방향 지정)
  document.querySelector(".right-panel")?.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    showTip(el.getAttribute("data-tip"));
  });
  document.querySelector(".right-panel")?.addEventListener("mousemove", e => {
    if (tip.style.display === "none") return;
    // 왼쪽으로 표시 — 커서 왼쪽에 붙임
    const tipW = tip.offsetWidth || 220;
    tip.style.left = (e.clientX - tipW - 14) + "px";
    tip.style.top  = (e.clientY - 10) + "px";
    tip.style.transform = "";
  });
  document.querySelector(".right-panel")?.addEventListener("mouseout", e => {
    if (!e.target.closest("[data-tip]")) return;
    const to = e.relatedTarget;
    if (to && e.target.closest("[data-tip]")?.contains(to)) return;
    hideTip();
  });
});

// 테마
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  document.querySelectorAll(".theme-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("t-" + t).classList.add("active");
  localStorage.setItem("fs-theme", t);
}

// 토스트 (같은 메시지 2초 내 중복 표시 방지)
const _toastShownAt = {};
function showToast(msg, type = "warn", duration = 3000) {
  const now = Date.now();
  if (_toastShownAt[msg] && now - _toastShownAt[msg] < 2000) return;
  _toastShownAt[msg] = now;
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add("show")); });
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── 폰트 크기 조절 ───────────────────────────────────────
(function initFontScale() {
  const sbVal   = parseFloat(localStorage.getItem("fs-sb-font")   || "1.0");
  const rpVal   = parseFloat(localStorage.getItem("fs-rp-font")   || "1.0");
  const mainVal = parseFloat(localStorage.getItem("fs-main-font") || "1.0");
  document.documentElement.style.setProperty("--sb-font-scale",   sbVal);
  document.documentElement.style.setProperty("--rp-font-scale",   rpVal);
  document.documentElement.style.setProperty("--main-font-scale", mainVal);
  const sbSlider   = document.getElementById("sbFontSlider");
  const rpSlider   = document.getElementById("rpFontSlider");
  const mainSlider = document.getElementById("mainFontSlider");
  if (sbSlider)   { sbSlider.value   = sbVal;   document.getElementById("sbFontVal").textContent   = sbVal.toFixed(1)   + "×"; }
  if (rpSlider)   { rpSlider.value   = rpVal;   document.getElementById("rpFontVal").textContent   = rpVal.toFixed(1)   + "×"; }
  if (mainSlider) { mainSlider.value = mainVal; document.getElementById("mainFontVal").textContent = mainVal.toFixed(1) + "×"; }
})();

function setSbFont(val) {
  val = parseFloat(val);
  document.documentElement.style.setProperty("--sb-font-scale", val);
  document.getElementById("sbFontVal").textContent = val.toFixed(1) + "×";
  localStorage.setItem("fs-sb-font", val);
}
function setRpFont(val) {
  val = parseFloat(val);
  document.documentElement.style.setProperty("--rp-font-scale", val);
  document.getElementById("rpFontVal").textContent = val.toFixed(1) + "×";
  localStorage.setItem("fs-rp-font", val);
}
function setMainFont(val) {
  val = parseFloat(val);
  document.documentElement.style.setProperty("--main-font-scale", val);
  document.getElementById("mainFontVal").textContent = val.toFixed(1) + "×";
  localStorage.setItem("fs-main-font", val);
}
function toggleFontPanel() {
  const p = document.getElementById("fontPanel");
  p.style.display = p.style.display === "none" ? "flex" : "none";
}
document.addEventListener("click", e => {
  const ctrl = document.getElementById("fontSizeCtrl");
  if (ctrl && !ctrl.contains(e.target)) {
    const p = document.getElementById("fontPanel");
    if (p) p.style.display = "none";
  }
});

// ── 읽기 모드 ───────────────────────────────────────────
const _modeFlashColor = { eye: "var(--accent)", aloud: "#c47060", tts: "#6090c8" };

function _flashOutput(mode) {
  if (!output) return;
  output.style.setProperty("--mode-flash-color", _modeFlashColor[mode] ?? "var(--accent)");
  output.classList.remove("mode-flash");
  void output.offsetWidth; // reflow
  output.classList.add("mode-flash");
  setTimeout(() => output.classList.remove("mode-flash"), 600);
}

// Phase 4.18 — 모드 전환 시 viewport 상단 paragraph anchor 캡처/복원.
// 청독/묵독에서 낭독으로 전환할 때 _focusLineIndex(이전 클릭 위치)로 점프하던 문제 수정.
// episode 이동(viewPrev/viewNext)은 별도로 _scrollToTopOnEpisodeChange가 처리.
function _captureReadingAnchor() {
  const scrollArea = document.querySelector(".output-scroll-area");
  if (!scrollArea) return null;
  const paras = Array.from(document.querySelectorAll("#output p"));
  if (!paras.length) return null;
  const areaTop = scrollArea.getBoundingClientRect().top;
  for (let i = 0; i < paras.length; i++) {
    const r = paras[i].getBoundingClientRect();
    if (r.bottom > areaTop + 1) {
      return { index: i, offsetWithin: areaTop - r.top };
    }
  }
  return { index: paras.length - 1, offsetWithin: 0 };
}

function _restoreReadingAnchor(anchor) {
  if (!anchor) return;
  const scrollArea = document.querySelector(".output-scroll-area");
  if (!scrollArea) return;
  const paras = document.querySelectorAll("#output p");
  const target = paras[Math.min(anchor.index, paras.length - 1)];
  if (!target) return;
  const areaTop = scrollArea.getBoundingClientRect().top;
  const targetTop = target.getBoundingClientRect().top;
  scrollArea.scrollBy({ top: targetTop - areaTop - anchor.offsetWithin, behavior: "auto" });
}

function setReadMode(mode) {
  const prev = readMode;
  // 모드 전환일 때만 anchor 캡처 (초기 부팅 시 prev === mode → null)
  const anchor = (prev !== mode) ? _captureReadingAnchor() : null;
  readMode = mode;
  localStorage.setItem("fs-readmode", mode);
  document.querySelectorAll(".read-mode-btn").forEach(b => b.classList.remove("active"));
  const modeBtn = document.getElementById("mode-" + mode);
  if (modeBtn) modeBtn.classList.add("active");

  if (prev !== mode) _flashOutput(mode);

  // body 클래스 전환
  document.body.classList.remove("read-aloud", "mode-aloud", "mode-tts", "mode-eye");

  if (mode === "aloud") {
    document.body.classList.add("read-aloud", "mode-aloud");
    if (!_generating) {
      // anchor가 있으면 _focusLineIndex를 viewport 기준으로 동기화 후 복원 (스크롤 강제 이동 방지)
      if (anchor) _focusLineIndex = anchor.index;
      applyFocusLine(true);
    }
  } else if (mode === "tts") {
    document.body.classList.add("mode-tts");
    document.querySelectorAll("#output p").forEach(p => {
      p.classList.remove("focus-line", "tts-done");
      delete p.dataset.aloudDone;
    });
    // 모드 전환 시 대화체 스타일 재적용 (들여쓰기 분류 보장)
    if (typeof applyDialogueStyle === "function") applyDialogueStyle(document.getElementById("output"));
  } else {
    document.body.classList.add("mode-eye");
    document.querySelectorAll("#output p").forEach(p => {
      p.classList.remove("focus-line", "tts-current");
      delete p.dataset.aloudDone;
    });
    // 모드 전환 시 대화체 스타일 재적용 (들여쓰기 분류 보장)
    if (typeof applyDialogueStyle === "function") applyDialogueStyle(document.getElementById("output"));
  }

  // DOM mutation 이후 anchor 복원 — 모든 모드에 공통 적용
  if (anchor) {
    requestAnimationFrame(() => _restoreReadingAnchor(anchor));
  }
}

// 쉼표/마침표 기준으로 문장을 분리해 들여쓰기 블록으로 재구성
function applyAloudFormat() {
  document.querySelectorAll("#output p").forEach(p => {
    if (p.dataset.aloudDone) return;
    const text = p.textContent ?? "";
    // 마침표·느낌표·물음표 뒤 → 문장 분리 / 쉼표 뒤 → 짧은 여백
    const sentences = text
      .split(/(?<=[.!?。!?])\s+/)  // 문장 끝 부호 뒤 공백에서만 분리 (쉼표 제외)
      .map(s => s.trim()).filter(Boolean);
    if (sentences.length <= 1) return;
    p.innerHTML = sentences
      .map(s => `<span class="aloud-sentence">${s}</span>`)
      .join(" ");  // 스팬 사이 공백 유지 — 묵독/청독 전환 시 문장부호 뒤 공백 보존
    p.dataset.aloudDone = "1";
  });
  // innerHTML 교체로 날아간 char-name-ref 재적용
  if (typeof window._rewrapCharNamesIfNeeded === "function") window._rewrapCharNamesIfNeeded();
}

let _focusLineIndex = 0; // 현재 포커스된 단락 인덱스 (DOM 교체 후 복원용)

function applyFocusLine(restoreOnly = false) {
  if (readMode !== "aloud") return;
  if (!restoreOnly) applyAloudFormat();
  const paras = document.querySelectorAll("#output p");
  paras.forEach((p, i) => {
    p.classList.remove("focus-line");
    p.onclick = () => { _focusLineIndex = i; moveFocusLine(p, false); };
  });
  if (!paras.length) return;
  // 인덱스 복원: 기존 포커스 위치 유지, 새 단락이 추가됐을 때만 마지막 단락으로 이동하지 않음
  const target = paras[Math.min(_focusLineIndex, paras.length - 1)];
  target.classList.add("focus-line");
  if (!restoreOnly) moveFocusLine(target, true);
}

// ── 화자 성별 추론 시스템 ────────────────────────────────────
// charGenderMap: 설정 확정 성별 (null = 미스터리, 추론 금지)
// charInferredMap: 문맥 추론 성별 (에피소드 렌더링 후 업데이트)
window.charGenderMap   = window.charGenderMap   ?? {};
window.charInferredMap = window.charInferredMap ?? {};

const _MALE_RE   = /그는|그가|그의|그를|그에게|그도|사내|남자|소년|아버지|할아버지|형(?!제)|오빠|남편|삼촌|왕자/;
const _FEMALE_RE = /그녀는|그녀가|그녀의|그녀를|그녀에게|그녀도|여자|소녀|어머니|할머니|언니|누나|아내|이모|공주/;

// 에피소드 렌더링 완료 후 호출 — 설정에 없는 신규 인물의 성별을 문맥으로 추론
function updateGenderFromContext() {
  const paras = Array.from(document.querySelectorAll("#output p"));
  if (!paras.length) return;
  // 추론 대상: 설정에 없거나 성별이 null이 아닌 인물
  const candidates = Object.keys(window.charGenderMap).filter(
    n => window.charGenderMap[n] === null  // null = 미스터리 인물 → 추론 금지
  );
  // 설정에 없는 인물 이름을 문맥에서 탐색하는 건 별도 로직이 없으므로,
  // 여기선 charGenderMap에 있지만 성별이 null인 인물은 건너뛰고,
  // 이미 inferred된 인물도 재분석하여 누적 점수로 확정
  const scoreMap = {};
  for (const p of paras) {
    const txt = p.textContent ?? "";
    const mc = _MALE_RE.test(txt) ? 1 : 0;
    const fc = _FEMALE_RE.test(txt) ? 1 : 0;
    if (!mc && !fc) continue;
    for (const name of Object.keys(window.charGenderMap)) {
      if (window.charGenderMap[name] !== null) continue; // 이미 확정이거나 미스터리 처리
      if (!txt.includes(name)) continue;
      scoreMap[name] = scoreMap[name] ?? { m: 0, f: 0 };
      scoreMap[name].m += mc;
      scoreMap[name].f += fc;
    }
    // 설정에 없는 인물은 charInferredMap에서만 추론 가능하므로
    // 여기서는 별도로 처리하지 않음 (이름 목록이 없으므로)
  }
  for (const [name, sc] of Object.entries(scoreMap)) {
    if (sc.m === sc.f) continue; // 동점이면 보류
    window.charInferredMap[name] = sc.m > sc.f ? "남성" : "여성";
  }
}

function _getCharGender(name) {
  const g = window.charGenderMap[name];
  if (g === undefined) return window.charInferredMap[name] ?? null; // 설정에 없는 신규 인물
  if (g === null)      return null;  // 미스터리 인물: 색상 없음
  return g;
}

// 대사 단락 포커스 시 화자 성별 탐지
// paras: 배열 (querySelectorAll 결과를 한 번만 변환해서 넘겨줌)
function _detectSpeakerGender(target, parasArr) {
  if (!target.classList.contains("dialogue-line")) return null;
  if (!Object.keys(window.charGenderMap).length && !Object.keys(window.charInferredMap).length) return null;
  const idx = parasArr.indexOf(target);
  // 현재 단락 + 직전 3단락에서 인물 이름 탐색 (최근 단락 우선)
  for (let i = idx; i >= Math.max(0, idx - 3); i--) {
    const txt = parasArr[i].textContent ?? "";
    for (const name of Object.keys(window.charGenderMap)) {
      if (txt.includes(name)) {
        const g = _getCharGender(name);
        if (g !== null) return g;
      }
    }
    for (const name of Object.keys(window.charInferredMap)) {
      if (txt.includes(name)) return window.charInferredMap[name];
    }
  }
  return null;
}

function moveFocusLine(target, scroll = true) {
  const paras = document.querySelectorAll("#output p");
  const parasArr = Array.from(paras);
  parasArr.forEach((p, i) => { p.classList.remove("focus-line"); if (p === target) _focusLineIndex = i; });
  target.classList.add("focus-line");

  // 성별 색상 적용
  const gender = _detectSpeakerGender(target, parasArr);
  target.dataset.speakerGender = gender ?? "";

  if (!scroll) return;
  const scrollArea = document.querySelector(".output-scroll-area");
  if (!scrollArea) return;
  const TOP_OFFSET = 72;
  const delta = target.getBoundingClientRect().top
              - scrollArea.getBoundingClientRect().top
              - TOP_OFFSET;
  scrollArea.scrollBy({ top: delta, behavior: "smooth" });
}

// 낭독 모드 ↑↓ 키보드 내비게이션
document.addEventListener("keydown", e => {
  if (readMode !== "aloud") return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  const cur = document.querySelector("#output p.focus-line");
  if (!cur) return;
  if (e.key === "ArrowDown" || e.key === "ArrowRight") {
    e.preventDefault();
    const next = cur.nextElementSibling;
    if (next && next.tagName === "P") moveFocusLine(next);
  } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
    e.preventDefault();
    const prev = cur.previousElementSibling;
    if (prev && prev.tagName === "P") moveFocusLine(prev);
  }
});

// ── 사이드바 너비 드래그 조절 ─────────────────────────────
(function initSidebarResize() {
  const handle = document.getElementById("sbResizeHandle");
  const sidebar = document.querySelector(".sidebar");
  if (!handle || !sidebar) return;

  const saved = localStorage.getItem("fs-sb-width");
  if (saved) document.documentElement.style.setProperty("--sb-width", saved + "px");

  let startX, startW;
  handle.addEventListener("mousedown", e => {
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(e) {
      const w = Math.min(600, Math.max(200, startW + (e.clientX - startX)));
      document.documentElement.style.setProperty("--sb-width", w + "px");
    }
    function onUp() {
      handle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const w = sidebar.getBoundingClientRect().width;
      localStorage.setItem("fs-sb-width", Math.round(w));
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
})();

// ── 오른쪽 패널 너비 드래그 조절 (왼쪽과 대칭) ────────────
(function initRightPanelResize() {
  const handle = document.getElementById("rpResizeHandle");
  const panel  = document.getElementById("rightPanel");
  if (!handle || !panel) return;

  const saved = localStorage.getItem("fs-rp-width");
  if (saved) document.documentElement.style.setProperty("--rp-width", saved + "px");

  let startX, startW;
  handle.addEventListener("mousedown", e => {
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(e) {
      // 오른쪽 패널은 왼쪽 edge를 드래그 → 커서가 왼쪽으로 갈수록 넓어짐
      const w = Math.min(600, Math.max(200, startW - (e.clientX - startX)));
      document.documentElement.style.setProperty("--rp-width", w + "px");
    }
    function onUp() {
      handle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const w = panel.getBoundingClientRect().width;
      localStorage.setItem("fs-rp-width", Math.round(w));
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
})();

// 로딩 오버레이
const _loadingTimers = {};

function startLoadingOverlay(barId, msgPool) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  bar.innerHTML = `<div class="loading-spinner"></div><span class="loading-msg-text"></span>`;
  const msgEl = bar.querySelector(".loading-msg-text");
  const pick = () => msgPool[Math.floor(Math.random() * msgPool.length)];
  msgEl.textContent = pick();
  bar.classList.add("show");
  _loadingTimers[barId] = setInterval(() => {
    msgEl.style.opacity = "0";
    setTimeout(() => { msgEl.textContent = pick(); msgEl.style.opacity = ""; }, 300);
  }, 5000);
}

function stopLoadingOverlay(barId) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  clearInterval(_loadingTimers[barId]);
  bar.classList.remove("show");
  setTimeout(() => { bar.innerHTML = ""; }, 250);
}
