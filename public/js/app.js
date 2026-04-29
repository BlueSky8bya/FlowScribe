// ── 앱 초기화 ─────────────────────────────────────────────────

marked.setOptions({ gfm: true, breaks: true });

// displayedEpisode: 현재 출력창에 보이는 화 번호 (currentEpisode는 다음 생성할 화 번호)
let displayedEpisode = null;

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
}

setTheme(localStorage.getItem("fs-theme") || "dark");
setReadMode(readMode);
initAuth(); // 로그인 확인 → 책 복원 → updateEpisodeUI()
