/**
 * audit_multi_genre_fixture.mjs — 다중 장르 Reader Immersion 범용성 검증
 *
 * DB 없이 인메모리 fixture로 장르별 공통 몰입 파괴 패턴을 감지하는지 확인.
 * 장르별 if문 없이 state/inventory/location/emotion/artifact 기반 공통 로직으로 동작해야 함.
 *
 * 장르:
 *   1. 폐쇄 공간 미스터리 — location jump, emotional loop
 *   2. 판타지/이세계    — alive contradiction, speech register flip
 *   3. 현대/SF          — inventory contradiction (lost item recovery)
 *   4. 로맨스/관계      — repetition loop (감정 루프 + 목표 동결)
 *
 * Usage: node scripts/audit_multi_genre_fixture.mjs
 */

// ══════════════════════════════════════════════════════════════
// Shared helpers (inline — no DB dependency)
// ══════════════════════════════════════════════════════════════

const SEV_ORDER = ["fatal", "major", "minor"];
const FATAL_STATUS_KW = ["사망", "죽음", "죽었", "사체", "시신", "사망했", "숨졌", "절명"];
const INCAP_STATUS_KW = ["기절", "의식 불명", "마비", "포박됨"];
const LOST_KW = ["분실", "없어졌", "사라졌", "잃어버", "파손", "고장", "망가졌", "소진"];
const EMOTION_GROUPS = [
  ["혼란", "혼돈"], ["불안", "두려", "공포", "무서"],
  ["슬픔", "슬퍼", "비통"], ["분노", "화가", "격분"],
  ["절망", "희망이 없"],
];
const UNKNOWN_EMO = new Set(["(없음)", "알 수 없음", "미등장"]);
const ABSENT_LOC = new Set(["미등장", "알 수 없음", "불명", "비활성", ""]);
const TRANSITION_RE = [
  /(?:이동|향했다|갔다|도착했다|들어갔다|찾아갔다)/,
  /(?:잠시\s*후|한참\s*후|시간이\s*(?:흘러|지나)|얼마\s*후)/,
];
const ARTIFACT_PATTERNS = [
  { re: /<\/?s>/gi, label: "특수토큰" },
  { re: /\[unused\d*\]/gi, label: "unused" },
  { re: /[一-鿿]{4,}/g, label: "중국어" },
  { re: /[぀-ゟ゠-ヿ]{3,}/g, label: "일본어" },
];

function emotionGroup(e) {
  if (!e) return "(없음)";
  for (const g of EMOTION_GROUPS) if (g.some(k => e.includes(k))) return g[0];
  return e;
}
function isSameZone(a, b) {
  if (!a || !b) return false;
  return a.split(/[\s-]/)[0] === b.split(/[\s-]/)[0];
}

function runChecks({ states, episodeTexts }) {
  const issues = [];
  const push = (i) => issues.push(i);

  // A. Alive contradiction
  const fatalEp = {};
  for (const s of [...states].sort((a, b) => a.episode_number - b.episode_number)) {
    const ps = (s.physical_state ?? "").toLowerCase();
    if (FATAL_STATUS_KW.some(k => ps.includes(k))) fatalEp[s.character_name] = s.episode_number;
    for (const [dName, dep] of Object.entries(fatalEp)) {
      if (s.episode_number <= dep || s.character_name !== dName) continue;
      if (s.location && !ABSENT_LOC.has(s.location)) {
        push({ severity: "fatal", category: "alive_contradiction", episode: s.episode_number, character: dName,
          evidence: `사망(ep${dep}) 후 ep${s.episode_number} location="${s.location}"` });
      }
    }
  }
  for (const [dName, dep] of Object.entries(fatalEp)) {
    for (const [epNum, text] of episodeTexts.entries()) {
      if (epNum <= dep) continue;
      const re = new RegExp(`${dName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[은는이가]?\\s*(?:말했|외쳤|답했)`, "g");
      if (re.test(text)) push({ severity: "fatal", category: "alive_contradiction", episode: epNum, character: dName,
        evidence: `사망 인물 "${dName}" 발화 감지 (ep${epNum})` });
    }
  }

  // B. Inventory (lost item recovery)
  const itemHist = {};
  for (const s of [...states].sort((a, b) => a.episode_number - b.episode_number)) {
    const items = Array.isArray(s.items) ? s.items.map(i => typeof i === "string"
      ? { name: i, condition: "" } : { name: i?.name ?? "", condition: i?.condition ?? "" })
      .filter(i => i.name) : [];
    if (!itemHist[s.character_name]) itemHist[s.character_name] = [];
    itemHist[s.character_name].push({ ep: s.episode_number, items });
  }
  for (const [, hist] of Object.entries(itemHist)) {
    const lostItems = new Set();
    for (let i = 0; i < hist.length; i++) {
      const curr = hist[i];
      for (const it of curr.items) {
        const cond = (it.condition ?? "").toLowerCase();
        if (LOST_KW.some(k => cond.includes(k) || it.name.includes(k)))
          lostItems.add(it.name.replace(/^(분실|파손|소진된?|망가진?)\s*/, ""));
      }
      if (i > 0 && lostItems.size > 0) {
        for (const it of curr.items) {
          const base = it.name.replace(/^(분실|파손|소진된?|망가진?)\s*/, "");
          const cond = (it.condition ?? "").toLowerCase();
          const lostNow = LOST_KW.some(k => cond.includes(k) || it.name.includes(k));
          if (lostItems.has(base) && !lostNow)
            push({ severity: "major", category: "inventory_contradiction", episode: curr.ep,
              evidence: `"${base}" 분실→ep${curr.ep} 복구 근거 없음` });
        }
      }
    }
  }

  // C. Location jump
  const locHist = {};
  for (const s of [...states].sort((a, b) => a.episode_number - b.episode_number)) {
    if (!s.location) continue;
    if (!locHist[s.character_name]) locHist[s.character_name] = [];
    locHist[s.character_name].push({ ep: s.episode_number, loc: s.location });
  }
  for (const [, hist] of Object.entries(locHist)) {
    for (let i = 1; i < hist.length; i++) {
      const p = hist[i - 1], c = hist[i];
      if (ABSENT_LOC.has(p.loc) || ABSENT_LOC.has(c.loc)) continue;
      if (p.loc === c.loc || isSameZone(p.loc, c.loc)) continue;
      const text = episodeTexts.get(c.ep) ?? "";
      if (!TRANSITION_RE.some(re => re.test(text)))
        push({ severity: "major", category: "location_jump", episode: c.ep,
          evidence: `"${p.loc}" → "${c.loc}" (전환 문장 없음)` });
    }
  }

  // D. Emotional loop
  const byChar = {};
  for (const s of [...states].sort((a, b) => a.episode_number - b.episode_number)) {
    if (!byChar[s.character_name]) byChar[s.character_name] = [];
    byChar[s.character_name].push(s);
  }
  for (const [, hist] of Object.entries(byChar)) {
    let streak = 1;
    for (let i = 1; i < hist.length; i++) {
      const pe = emotionGroup(hist[i - 1].emotional_state ?? "");
      const ce = emotionGroup(hist[i].emotional_state ?? "");
      if (UNKNOWN_EMO.has(pe) || UNKNOWN_EMO.has(ce)) { streak = 1; continue; }
      const pg = (hist[i - 1].recent_goal ?? "").trim();
      const cg = (hist[i].recent_goal ?? "").trim();
      if (pe === ce && (pg === cg || cg === "이전 목표 유지")) {
        streak++;
        if (streak >= 3) {
          push({ severity: streak >= 4 ? "major" : "minor", category: "repetition_loop",
            episode: hist[i].episode_number, character: hist[i].character_name,
            evidence: `감정 "${ce}" ${streak}화 연속` });
          // streak 유지
        }
      } else streak = 1;
    }
  }

  // E. Artifact
  for (const [epNum, text] of episodeTexts.entries()) {
    for (const { re, label } of ARTIFACT_PATTERNS) {
      const match = text.match(re);
      if (match) push({ severity: "fatal", category: "artifact_noise", episode: epNum,
        evidence: `${label}: "${match[0]?.slice(0, 30)}"` });
    }
  }

  // F. Speech register flip
  for (const [, hist] of Object.entries(byChar)) {
    for (let i = 1; i < hist.length; i++) {
      const pr = hist[i - 1].relationship_updates ?? {};
      const cr = hist[i].relationship_updates ?? {};
      for (const tgt of Object.keys(cr)) {
        const pv = (pr[tgt] ?? "").toLowerCase(), cv = (cr[tgt] ?? "").toLowerCase();
        if (!pv || !cv) continue;
        const pF = /존댓말|formal|경어/.test(pv), cF = /존댓말|formal|경어/.test(cv);
        const pC = /반말|casual|친밀/.test(pv), cC = /반말|casual|친밀/.test(cv);
        if ((pF && cC) || (pC && cF))
          push({ severity: "minor", category: "speech_register_flip",
            episode: hist[i].episode_number, character: hist[i].character_name,
            evidence: `[${pv}] → [${cv}] (대상: ${tgt})` });
      }
    }
  }

  return issues;
}

function score(issues) {
  let p = 0;
  for (const i of issues) {
    if (i.severity === "fatal") p += 0.15;
    else if (i.severity === "major") p += 0.03;
    else p += 0.01;
  }
  return Math.max(0, 1 - p);
}

// ══════════════════════════════════════════════════════════════
// Fixtures
// ══════════════════════════════════════════════════════════════

const FIXTURES = [

  // ── Genre 1: 폐쇄 공간 미스터리 — location jump ──────────────
  {
    label: "미스터리/폐쇄공간 — location jump",
    states: [
      { character_name: "김형사", episode_number: 1, location: "A동 취조실", physical_state: "정상", emotional_state: "냉철함", recent_goal: "단서 수집", items: [], relationship_updates: {} },
      { character_name: "김형사", episode_number: 2, location: "B동 증거실", physical_state: "정상", emotional_state: "냉철함", recent_goal: "단서 수집", items: [], relationship_updates: {} },
    ],
    episodeTexts: new Map([
      [1, "김형사는 취조실에 앉아 자료를 검토했다."],
      [2, "김형사는 피의자를 바라봤다."],  // 전환 문장 없음
    ]),
    expected: [{ category: "location_jump", severity: "major" }],
  },

  // ── Genre 2: 판타지/이세계 — alive contradiction ─────────────
  {
    label: "판타지/이세계 — alive contradiction (사망 후 발화)",
    states: [
      { character_name: "기사 발렌", episode_number: 2, location: "왕성 광장", physical_state: "사망", emotional_state: "없음", recent_goal: "", items: [], relationship_updates: {} },
      { character_name: "기사 발렌", episode_number: 4, location: "왕성 광장", physical_state: "정상", emotional_state: "결의", recent_goal: "왕 호위", items: [], relationship_updates: {} },
    ],
    episodeTexts: new Map([
      [2, "기사 발렌은 적의 칼에 쓰러져 사망했다."],
      [3, "왕궁은 적막했다."],
      [4, "기사 발렌이 말했다. \"폐하, 제가 돌아왔습니다.\""],
    ]),
    expected: [{ category: "alive_contradiction", severity: "fatal" }],
  },

  // ── Genre 3: 현대/SF — inventory contradiction ───────────────
  {
    label: "현대/SF — inventory (분실 아이템 설명 없이 복구)",
    states: [
      { character_name: "이연구원", episode_number: 3, location: "실험동", physical_state: "정상", emotional_state: "초조", recent_goal: "데이터 복구", items: [{ name: "마스터키", condition: "분실" }], relationship_updates: {} },
      { character_name: "이연구원", episode_number: 5, location: "실험동", physical_state: "정상", emotional_state: "집중", recent_goal: "해독 완료", items: [{ name: "마스터키", condition: "" }], relationship_updates: {} },
    ],
    episodeTexts: new Map([
      [3, "이연구원은 마스터키를 잃어버렸다는 사실을 알았다."],
      [4, "복도는 조용했다."],
      [5, "이연구원은 서랍에서 마스터키를 꺼냈다."],  // 복구 근거 없음
    ]),
    expected: [{ category: "inventory_contradiction", severity: "major" }],
  },

  // ── Genre 4: 로맨스/관계 — emotional loop ────────────────────
  // 현실적 케이스: LLM이 동일 감정 문자열을 4화 연속 출력
  {
    label: "로맨스/관계 — repetition_loop (동일 감정 문자열 4화 동결)",
    states: [
      { character_name: "하나", episode_number: 1, location: "카페", physical_state: "정상", emotional_state: "그에 대한 설렘", recent_goal: "고백 준비", items: [], relationship_updates: {} },
      { character_name: "하나", episode_number: 2, location: "카페", physical_state: "정상", emotional_state: "그에 대한 설렘", recent_goal: "고백 준비", items: [], relationship_updates: {} },
      { character_name: "하나", episode_number: 3, location: "카페", physical_state: "정상", emotional_state: "그에 대한 설렘", recent_goal: "고백 준비", items: [], relationship_updates: {} },
      { character_name: "하나", episode_number: 4, location: "카페", physical_state: "정상", emotional_state: "그에 대한 설렘", recent_goal: "고백 준비", items: [], relationship_updates: {} },
    ],
    episodeTexts: new Map([
      [1, "하나는 카페에서 그를 기다렸다."],
      [2, "하나는 또 카페에 앉아 있었다."],
      [3, "하나는 오늘도 카페에 왔다."],
      [4, "하나는 카페를 떠나지 못했다."],
    ]),
    expected: [{ category: "repetition_loop", severity: "major" }], // 4화 연속 → major
  },

  // ── Genre 5: artifact — 장르 무관 ───────────────────────────
  {
    label: "공통 — LLM artifact 오염 (장르 무관)",
    states: [],
    episodeTexts: new Map([
      [1, "그녀는 말했다. </s> 이 세계의 법칙은 단순하다."],
      [2, "한적한 마을이었다."],
    ]),
    expected: [{ category: "artifact_noise", severity: "fatal" }],
  },

  // ── Genre 6: speech register flip ───────────────────────────
  {
    label: "관계 — speech_register_flip (존댓말→반말 급변)",
    states: [
      { character_name: "민준", episode_number: 1, location: "사무실", physical_state: "정상", emotional_state: "긴장", recent_goal: "협상", items: [], relationship_updates: { "이사장": "존댓말, 공식적 관계" } },
      { character_name: "민준", episode_number: 2, location: "사무실", physical_state: "정상", emotional_state: "여유", recent_goal: "협상 마무리", items: [], relationship_updates: { "이사장": "반말, 친밀한 관계" } },
    ],
    episodeTexts: new Map([
      [1, "민준은 이사장에게 정중히 말했다."],
      [2, "민준은 이사장에게 편하게 말했다."],
    ]),
    expected: [{ category: "speech_register_flip", severity: "minor" }],
  },

];

// ══════════════════════════════════════════════════════════════
// Run & Report
// ══════════════════════════════════════════════════════════════

const W = 65;
console.log(`\n${"═".repeat(W)}`);
console.log(` Multi-Genre Reader Immersion Fixture Tests`);
console.log("═".repeat(W));

let totalPass = 0, totalFail = 0;

for (const fx of FIXTURES) {
  const issues = runChecks({ states: fx.states, episodeTexts: fx.episodeTexts });
  const s = score(issues);

  const results = [];
  for (const exp of fx.expected) {
    const found = issues.some(i => i.category === exp.category && i.severity === exp.severity);
    results.push({ ...exp, found });
  }

  const allFound = results.every(r => r.found);
  const icon = allFound ? "✅" : "❌";
  totalPass += allFound ? 1 : 0;
  totalFail += allFound ? 0 : 1;

  console.log(`\n${icon} ${fx.label}`);
  for (const r of results) {
    const ri = r.found ? "  ✓" : "  ✗";
    console.log(`${ri} expected [${r.category}/${r.severity}] → ${r.found ? "DETECTED" : "MISSED"}`);
  }
  if (!allFound) {
    console.log(`   detected issues: ${issues.map(i => i.category).join(", ") || "(none)"}`);
  }
  console.log(`   immersion_score: ${(s * 100).toFixed(1)}%`);
}

console.log(`\n${"─".repeat(W)}`);
console.log(` Total: ${totalPass + totalFail} fixtures | PASS: ${totalPass} | FAIL: ${totalFail}`);
if (totalFail === 0) {
  console.log(" ALL GENRES PASS ✅ — 장르별 하드코딩 없이 범용 감지 확인됨");
} else {
  console.log(" SOME FIXTURES FAILED ❌");
  process.exit(1);
}
console.log("═".repeat(W) + "\n");
