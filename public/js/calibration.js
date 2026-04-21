// ── 초기 캘리브레이션 (SOP §5) ────────────────────────────────
// MBTI 4문항 + 읽기 속도 측정 → 독자 프로필 초기값 계산

const CALIB_PASSAGE =
  "깊은 산속 외딴 암자에, 노승 하나가 홀로 살고 있었다. " +
  "어느 날 저녁 소년이 찾아와 물었다. '스님, 이 세상에서 가장 빠른 것이 무엇입니까?' " +
  "노승은 타오르는 촛불을 잠시 바라보다 조용히 입을 열었다. " +
  "'그것은 마음이란다. 마음은 촛불보다 빠르고, 바람보다 빠르며, " +
  "이 우주 그 어떤 것보다 앞서 도착하지.' " +
  "소년은 고개를 끄덕이며 돌아가는 길에, 어느새 별이 가득한 하늘을 올려다보고 있었다.";

const CALIB_QUESTIONS = [
  {
    key: "EI",
    q: "사람들과 함께할 때 에너지가 넘치나요, 혼자 있을 때 더 충전되나요?",
    a: [{ label: "함께할 때 에너지가 넘쳐요", val: "E" }, { label: "혼자 있을 때 더 충전돼요", val: "I" }],
  },
  {
    key: "SN",
    q: "새로운 가능성과 아이디어에 끌리나요, 구체적인 사실을 더 중시하나요?",
    a: [{ label: "아이디어와 가능성을 좋아해요", val: "N" }, { label: "구체적인 사실을 선호해요", val: "S" }],
  },
  {
    key: "TF",
    q: "결정을 내릴 때 논리를 먼저 따르나요, 감정을 먼저 따르나요?",
    a: [{ label: "논리적으로 분석해요", val: "T" }, { label: "감정과 가치관을 따라요", val: "F" }],
  },
  {
    key: "JP",
    q: "계획적으로 생활하는 편인가요, 상황에 따라 유연하게 행동하나요?",
    a: [{ label: "미리 계획하는 걸 좋아해요", val: "J" }, { label: "즉흥적으로 행동하는 편이에요", val: "P" }],
  },
];

let _calibState = { step: 0, mbti: {}, cpm: 0, startTime: null };

function _mbtiToProfile(mbti, cpm) {
  // SOP §8 Reading Hexagon 초기값 매핑
  const e = mbti.EI === "E";
  const n = mbti.SN === "N";
  const f = mbti.TF === "F";
  const j = mbti.JP === "J";
  // 읽기 속도: 한국어 평균 ~400cpm. 빠를수록 audio_sync 높음
  const audioSync = Math.min(95, Math.max(20, Math.round((cpm / 500) * 100)));
  return {
    focus:      e ? 42 : 68,   // 내향형 = 긴 집중 선호
    sentiment:  f ? 72 : 38,   // 감정형 = 감정 강도 선호
    urgency:    j ? 58 : 44,   // 판단형 = 구조적 긴장감
    complexity: n ? 70 : 40,   // 직관형 = 복잡 서사 선호
    dialogue:   e ? 66 : 46,   // 외향형 = 대화 장면 선호
    audio_sync: audioSync,
  };
}

function _mbtiString(mbti) {
  return (mbti.EI || "?") + (mbti.SN || "?") + (mbti.TF || "?") + (mbti.JP || "?");
}

// ── 캘리브레이션 진입점 ─────────────────────────────────────

async function runCalibrationIfNeeded(user) {
  if (user.calibration_done) return;
  await _showCalib();
}

function _showCalib() {
  return new Promise(resolve => {
    _calibState = { step: 0, mbti: {}, cpm: 0, startTime: null, _resolve: resolve };
    _renderCalibStep(0);
    document.getElementById("calibOverlay").classList.add("open");
  });
}

function _closeCalib() {
  document.getElementById("calibOverlay").classList.remove("open");
  if (_calibState._resolve) _calibState._resolve();
}

function _renderCalibStep(step) {
  const body = document.getElementById("calibBody");
  _calibState.step = step;

  if (step === 0) {
    body.innerHTML = `
      <div class="calib-welcome">
        <div class="calib-icon">✦</div>
        <h2 class="calib-h2">FlowScribe에 오신 것을 환영합니다</h2>
        <p class="calib-desc">
          AI가 처음부터 당신의 취향에 맞는 이야기를 만들려면<br>
          간단한 설정이 필요합니다.<br><br>
          <span class="calib-time">⏱ 약 2분 소요 · 이후에는 자동으로 학습됩니다</span>
        </p>
        <button class="calib-btn primary" onclick="_renderCalibStep(1)">시작하기 →</button>
      </div>`;
    _setProgress(0, 6);
    return;
  }

  if (step >= 1 && step <= 4) {
    const qi = step - 1;
    const q = CALIB_QUESTIONS[qi];
    const answered = _calibState.mbti[q.key];
    body.innerHTML = `
      <div class="calib-question">
        <div class="calib-qnum">질문 ${step} / 4</div>
        <p class="calib-q">${q.q}</p>
        <div class="calib-choices">
          ${q.a.map(a => `
            <button class="calib-choice${answered === a.val ? " selected" : ""}"
              onclick="_selectAnswer('${q.key}','${a.val}')">
              ${a.label}
            </button>`).join("")}
        </div>
        <div class="calib-nav">
          ${step > 1 ? `<button class="calib-btn ghost" onclick="_renderCalibStep(${step-1})">← 이전</button>` : '<span></span>'}
          <button class="calib-btn primary${answered ? "" : " disabled"}"
            onclick="${answered ? `_renderCalibStep(${step+1})` : ''}">
            ${step === 4 ? "읽기 속도 측정 →" : "다음 →"}
          </button>
        </div>
      </div>`;
    _setProgress(step, 6);
    return;
  }

  if (step === 5) {
    const charCount = CALIB_PASSAGE.replace(/\s/g, "").length;
    body.innerHTML = `
      <div class="calib-speed">
        <div class="calib-qnum">읽기 속도 측정</div>
        <p class="calib-desc-sm">아래 글을 자연스럽게 읽어보세요.<br>다 읽으면 버튼을 눌러주세요.</p>
        <div class="calib-passage" id="calibPassage">${CALIB_PASSAGE}</div>
        <div class="calib-speed-btns">
          <button class="calib-btn primary" id="calibStartBtn" onclick="_startReading()">읽기 시작</button>
          <button class="calib-btn success" id="calibDoneBtn" onclick="_doneReading(${charCount})" style="display:none;">다 읽었어요 ✓</button>
        </div>
        <div class="calib-nav">
          <button class="calib-btn ghost" onclick="_renderCalibStep(4)">← 이전</button>
        </div>
      </div>`;
    _setProgress(5, 6);
    return;
  }

  if (step === 6) {
    const mbtiStr = _mbtiString(_calibState.mbti);
    const cpm = _calibState.cpm;
    const profile = _mbtiToProfile(_calibState.mbti, cpm);
    const speedLabel = cpm < 300 ? "천천히 음미하는 스타일" : cpm < 500 ? "평균적인 독서 속도" : "빠른 독서 스타일";
    body.innerHTML = `
      <div class="calib-result">
        <div class="calib-result-mbti">
          <span class="calib-mbti-badge">${mbtiStr}</span>
          <span class="calib-speed-label">${cpm > 0 ? `분당 ${cpm}자 · ${speedLabel}` : '속도 측정 건너뜀'}</span>
        </div>
        <p class="calib-desc-sm">이 설정을 바탕으로 AI가 첫 이야기를 구성합니다.<br>읽을수록 더 정교하게 맞춰집니다.</p>
        <div class="calib-hex-preview">
          <svg id="calibHexSvg" viewBox="0 0 180 160" width="180" height="160"></svg>
        </div>
        <button class="calib-btn primary large" onclick="_saveCalibration(${JSON.stringify(profile).replace(/"/g,'&quot;')})">
          FlowScribe 시작하기 ✦
        </button>
      </div>`;
    _setProgress(6, 6);
    _drawCalibHex(profile);
    return;
  }
}

function _selectAnswer(key, val) {
  _calibState.mbti[key] = val;
  _renderCalibStep(_calibState.step);
}

function _startReading() {
  _calibState.startTime = Date.now();
  document.getElementById("calibStartBtn").style.display = "none";
  document.getElementById("calibDoneBtn").style.display = "inline-flex";
  document.getElementById("calibPassage").classList.add("reading");
}

function _doneReading(charCount) {
  const elapsed = (Date.now() - _calibState.startTime) / 1000 / 60; // minutes
  _calibState.cpm = Math.round(charCount / elapsed);
  _renderCalibStep(6);
}

async function _saveCalibration(profileStr) {
  const profile = typeof profileStr === "string" ? JSON.parse(profileStr) : profileStr;
  const mbti = _mbtiString(_calibState.mbti);
  const cpm  = _calibState.cpm;

  try {
    await fetch("/api/auth/calibration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mbti, reading_cpm: cpm, profile_init: profile }),
    });
  } catch (e) { console.error(e); }

  _closeCalib();
}

function _setProgress(current, total) {
  const bar = document.getElementById("calibProgressBar");
  const dots = document.getElementById("calibProgressDots");
  if (bar) bar.style.width = `${Math.round((current / total) * 100)}%`;
  if (dots) {
    dots.innerHTML = Array.from({ length: total }, (_, i) =>
      `<span class="calib-dot${i < current ? " done" : i === current - 1 ? " active" : ""}"></span>`
    ).join("");
  }
}

function _drawCalibHex(profile) {
  const svg = document.getElementById("calibHexSvg");
  if (!svg) return;
  const keys   = ["focus","sentiment","urgency","complexity","dialogue","audio_sync"];
  const labels = ["집중","감정","긴장","복잡","대화","음성"];
  const cx = 90, cy = 80, R = 55;
  const angles = keys.map((_, i) => Math.PI / 2 + (2 * Math.PI * i / 6) * -1);
  const pt = (r, i) => [cx + r * Math.cos(angles[i]), cy - r * Math.sin(angles[i])];
  const gridLines = [0.33, 0.66, 1.0].map(f => {
    const pts = keys.map((_, i) => pt(R * f, i).join(",")).join(" ");
    return `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="0.8"/>`;
  }).join("");
  const vals = keys.map(k => (profile[k] ?? 0) / 100);
  const dataPts = vals.map((v, i) => pt(R * v, i).join(",")).join(" ");
  const labelEls = keys.map((k, i) => {
    const [x, y] = pt(R + 13, i);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central"
      font-size="9" fill="rgba(255,255,255,.6)" font-family="inherit">${labels[i]} <tspan font-weight="bold" fill="rgba(255,255,255,.9)">${profile[k]}</tspan></text>`;
  }).join("");
  svg.innerHTML = `${gridLines}
    <polygon points="${dataPts}" fill="rgba(168,152,128,.25)" stroke="rgba(168,152,128,.8)" stroke-width="1.5"/>
    ${vals.map((v,i)=>{const[x,y]=pt(R*v,i);return`<circle cx="${x}" cy="${y}" r="3" fill="rgba(168,152,128,.9)"/>`;}).join("")}
    ${labelEls}`;
}
