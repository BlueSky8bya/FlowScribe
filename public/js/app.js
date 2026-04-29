// ── 앱 초기화 ─────────────────────────────────────────────────

marked.setOptions({ gfm: true, breaks: true });

// displayedEpisode: 현재 출력창에 보이는 화 번호 (currentEpisode는 다음 생성할 화 번호)
let displayedEpisode = null;

// ── 세계관 설정 완료 판정 ─────────────────────────────────────
function isWorldSetupReady() {
  if (!bookId) return false;
  const hasSettings = Array.isArray(settingVals) && settingVals.length > 0;
  const hasMoods    = Array.isArray(moodVals)    && moodVals.length > 0;
  // 인물 카드 최소 1명 이름 있음 (없으면 pass — 아직 카드 미생성 허용)
  const charInputs = document.querySelectorAll("#charsSection .char-card .char-name, #charsList .char-card .char-name");
  const hasChar = charInputs.length === 0 || [...charInputs].some(inp => inp.value?.trim());
  return hasSettings && hasMoods && hasChar;
}

// empty state CTA 버튼/안내 문구 즉시 동기화 (재렌더 없이)
function _syncEmptyStateCTA() {
  const hint   = document.getElementById("emptyStateHint");
  const genBtn = document.getElementById("emptyStateGenBtn");
  if (!hint || !genBtn) return;   // empty state가 없는 상태 (에피소드 있음)
  const ready = isWorldSetupReady();
  genBtn.disabled = !ready;
  genBtn.style.opacity = ready ? "" : ".45";
  genBtn.title = ready ? "" : "세계관 설정을 먼저 완료해주세요.";
  hint.textContent = ready
    ? "이제 1화를 생성할 수 있습니다."
    : "먼저 세계관을 설정한 뒤 1화를 생성하세요.";
}
// 다른 파일에서 호출 가능하도록 노출
window._syncEmptyStateCTA = _syncEmptyStateCTA;

function updateEpisodeUI() {
  epInfo.textContent = displayedEpisode ? `${displayedEpisode}화` : "";

  const isLatestEp = displayedEpisode !== null && displayedEpisode === currentEpisode - 1;

  // 재생성: 최신화에서만
  const regenBtn = document.getElementById("regenBtn");
  if (regenBtn) regenBtn.style.display = (displayedEpisode && isLatestEp) ? "inline-flex" : "none";
  const capToggle = document.getElementById("capToggleWrap");
  const capBtn    = document.getElementById("captureBtnMain");
  const capShow   = displayedEpisode ? "inline-flex" : "none";
  if (capToggle) capToggle.style.display = capShow;
  if (capBtn)    capBtn.style.display    = capShow;

  // center 구분선: epInfo가 있을 때만
  const directorSep = document.getElementById("directorSep");
  if (directorSep) directorSep.style.display = displayedEpisode ? "inline-block" : "none";

  // 작가 개입: 최신화에서만 활성화— 버튼 전체(아이콘+텍스트) opacity 통합 제어
  const directorBtn = document.getElementById("directorFloatBtn");
  if (directorBtn) {
    directorBtn.disabled = !isLatestEp;
    directorBtn.style.opacity = isLatestEp ? "" : "0.38";
    directorBtn.style.pointerEvents = isLatestEp ? "" : "none";
  }

  const nextEp = displayedEpisode !== null ? _nextEpNum?.(displayedEpisode) : null;
  if (displayedEpisode !== null && nextEp !== null && episodeCache[nextEp]) {
    btn.textContent = "다음화 보기";
    btn.onclick = viewNext;
  } else {
    btn.textContent = `${currentEpisode}화 생성`;
    btn.onclick = generate;
  }

  prevBtn.disabled = displayedEpisode === null || !_prevEpNum?.(displayedEpisode);

  // 에피소드가 전혀 없는 상태(1화 생성 전)이면 footer sendBtn 숨기고 empty state CTA 사용
  // 에피소드가 있거나 생성 중이면 footer sendBtn 표시
  const _noEpisodes = displayedEpisode === null && currentEpisode === 1 && !_generating;
  if (btn) btn.style.display = _noEpisodes ? "none" : "";

  console.debug("[updateEpisodeUI]", {
    displayedEpisode,
    currentEpisode,
    btnText: btn?.textContent,
    epInfo: epInfo?.textContent,
    episodeCacheKeys: Object.keys(episodeCache || {}),
  });

  updateEpisodeListUI?.();
  updateOutputHeader?.();
  // empty state CTA 상태 동기화 (에피소드 없는 상태에서만 실질 작동)
  _syncEmptyStateCTA();
}

setTheme(localStorage.getItem("fs-theme") || "dark");
setReadMode(readMode);
initAuth(); // 로그인 확인 → 책 복원 → updateEpisodeUI()
