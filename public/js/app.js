// ── 앱 초기화 ─────────────────────────────────────────────────

marked.setOptions({ gfm: true, breaks: true });

// displayedEpisode: 현재 출력창에 보이는 화 번호 (currentEpisode는 다음 생성할 화 번호)
let displayedEpisode = null;

function updateEpisodeUI() {
  epInfo.textContent = displayedEpisode ? `${displayedEpisode}화` : "";

  const regenBtn = document.getElementById("regenBtn");
  if (regenBtn) regenBtn.style.display = displayedEpisode ? "inline-flex" : "none";

  const nextEp = (displayedEpisode ?? 0) + 1;
  if (displayedEpisode !== null && episodeCache[nextEp]) {
    btn.textContent = "다음화 보기";
    btn.onclick = viewNext;
  } else {
    btn.textContent = `${currentEpisode}화 생성`;
    btn.onclick = generate;
  }

  prevBtn.disabled = displayedEpisode === null || displayedEpisode <= 1 || !episodeCache[displayedEpisode - 1];

  updateEpisodeListUI?.();
  updateOutputHeader?.();
}

setTheme(localStorage.getItem("fs-theme") || "dark");
setReadMode(readMode);
initAuth(); // 로그인 확인 → 책 복원 → updateEpisodeUI()
