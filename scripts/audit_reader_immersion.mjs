/**
 * audit_reader_immersion.mjs — Reader Immersion Integrity 결정론적 감사
 *
 * 독자 몰입을 깨는 서사 논리 오류를 범용 상태 모델로 감사한다.
 * 장르별 if문 없이 state/relationship/knowledge/inventory/location consistency 기반.
 *
 * Usage: node scripts/audit_reader_immersion.mjs --book-id <book_id>
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
if (!bookId) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ══════════════════════════════════════════════════════════════
// Data fetch
// ══════════════════════════════════════════════════════════════

const [epRes, stateRes, canonRes] = await Promise.all([
  pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
    [bookId]
  ),
  pool.query(
    `SELECT character_name, episode_number, location, physical_state, items,
            emotional_state, recent_goal, relationship_updates, visibility_state
     FROM character_dynamic_states WHERE book_id=$1
     ORDER BY character_name, episode_number`,
    [bookId]
  ),
  pool.query(
    `SELECT name, initial_items FROM canonical_characters WHERE book_id=$1`,
    [bookId]
  ),
]);
await pool.end();

const episodeTexts = new Map();
for (const r of epRes.rows) episodeTexts.set(r.episode_number, r.content ?? "");

const states = stateRes.rows.map(r => ({
  ...r,
  items: r.items ?? [],
  relationship_updates: r.relationship_updates ?? {},
}));

const canonItems = {};
for (const r of canonRes.rows) {
  const raw = r.initial_items;
  const arr = Array.isArray(raw) ? raw.map(i => (typeof i === "string" ? i : i?.name ?? "")) : [];
  canonItems[r.name] = arr;
}

// ══════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════

const FATAL_STATUS_KW = ["사망", "죽음", "죽었", "사체", "시신", "사망했", "숨졌", "숨을 거뒀", "절명"];
const INCAP_STATUS_KW = ["기절", "의식 불명", "의식불명", "쓰러졌", "혼수", "마비", "포박됨", "결박됨", "투옥"];

const ARTIFACT_PATTERNS = [
  { re: /<\/?s>/gi,           label: "LLM 특수토큰 <s>" },
  { re: /\[unused\d*\]/gi,    label: "unused 토큰" },
  { re: /<<[A-Z_]+>>/g,       label: "이중 꺾쇠 토큰" },
  { re: /[぀-ゟ゠-ヿ]{3,}/g, label: "일본어 조각" },
  { re: /[一-鿿]{4,}/g,               label: "중국어 조각" },
  { re: /[฀-๿]{3,}/g,               label: "태국어 조각" },
  { re: /\bSYSTEM\b|\bPROMPT\b|\bINSTRUCT\b/, label: "프롬프트 토큰 오염" },
];

const EMOTION_GROUPS = [
  ["혼란", "혼돈"], ["불안", "두려", "공포", "무서"],
  ["슬픔", "슬퍼", "비통"], ["분노", "화가", "격분"],
  ["절망", "희망이 없"],
];

function emotionGroup(e) {
  if (!e) return "(없음)";
  for (const grp of EMOTION_GROUPS) {
    if (grp.some(k => e.includes(k))) return grp[0];
  }
  return e;
}

function isSameZone(a, b) {
  if (!a || !b) return false;
  return a.split(/[\s-]/)[0] === b.split(/[\s-]/)[0];
}

const SEV_ORDER = ["fatal", "major", "minor"];
function addIssue(issues, issue) {
  const key = `${issue.episode}|${issue.character ?? ""}|${issue.category}`;
  const existing = issues.find(i => `${i.episode}|${i.character ?? ""}|${i.category}` === key);
  if (!existing || SEV_ORDER.indexOf(issue.severity) < SEV_ORDER.indexOf(existing.severity)) {
    const idx = issues.findIndex(i => `${i.episode}|${i.character ?? ""}|${i.category}` === key);
    if (idx >= 0) issues.splice(idx, 1);
    issues.push(issue);
  }
}

// ══════════════════════════════════════════════════════════════
// Checks
// ══════════════════════════════════════════════════════════════

const issues = [];

// ── A. Alive / Incapacitated Contradiction ──────────────────
{
  const fatalEp = {};
  const sorted = [...states].sort((a, b) => a.episode_number - b.episode_number);

  for (const s of sorted) {
    const ps = (s.physical_state ?? "").toLowerCase();
    const name = s.character_name;

    if (FATAL_STATUS_KW.some(k => ps.includes(k))) {
      fatalEp[name] = s.episode_number;
    }

    for (const [dName, deathEp] of Object.entries(fatalEp)) {
      if (s.episode_number <= deathEp) continue;
      if (s.character_name !== dName) continue;
      if (s.location && s.location !== "" && s.location !== "불명") {
        addIssue(issues, {
          severity: "fatal", category: "alive_contradiction",
          episode: s.episode_number, character: dName,
          evidence: `사망 판정(ep${deathEp}) 후 ep${s.episode_number} location="${s.location}"`,
          explanation: "사망 인물이 회복 설명 없이 재등장",
          suggested_fix_type: "state",
        });
      }
    }
  }

  // episode text 대사 참여 검사
  for (const [dName, deathEp] of Object.entries(fatalEp)) {
    for (const [epNum, text] of episodeTexts.entries()) {
      if (epNum <= deathEp) continue;
      const re = new RegExp(`${dName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[은는이가]?\\s*(?:말했|중얼|외쳤|속삭|소리쳤|답했|물었)`, "g");
      if (re.test(text)) {
        addIssue(issues, {
          severity: "fatal", category: "alive_contradiction",
          episode: epNum, character: dName,
          evidence: `사망 인물 "${dName}" 발화 동사 감지 (ep${epNum})`,
          explanation: "사망 인물이 설명 없이 대화 참여",
          suggested_fix_type: "state",
        });
      }
    }
  }
}

// ── B. Inventory Contradiction ──────────────────────────────
// 새 아이템 획득은 정상 — 분실/파손/소진된 아이템이 근거 없이 복구될 때만 경고
{
  const LOST_KW = ["분실", "없어졌", "사라졌", "잃어버", "파손", "고장", "망가졌", "소진", "비어있", "빈손"];

  const itemHist = {};
  for (const s of [...states].sort((a, b) => a.episode_number - b.episode_number)) {
    const name = s.character_name;
    const items = Array.isArray(s.items) ? s.items.map(i => {
      if (typeof i === "string") return { name: i, condition: "" };
      return { name: i?.name ?? "", condition: i?.condition ?? "" };
    }).filter(i => i.name) : [];
    if (!itemHist[name]) itemHist[name] = [];
    itemHist[name].push({ ep: s.episode_number, items });
  }

  for (const [charName, hist] of Object.entries(itemHist)) {
    // 분실/파손으로 표시된 아이템 추적
    const lostItems = new Set();
    for (let i = 0; i < hist.length; i++) {
      const curr = hist[i];
      for (const it of curr.items) {
        const cond = (it.condition ?? "").toLowerCase();
        if (LOST_KW.some(k => cond.includes(k) || it.name.includes(k))) {
          lostItems.add(it.name.replace(/^(분실|파손|소진된?|망가진?)\s*/, ""));
        }
      }
      // 분실 아이템이 다음 화에서 정상 상태로 복구되었으면 경고
      if (i > 0 && lostItems.size > 0) {
        for (const it of curr.items) {
          const baseName = it.name.replace(/^(분실|파손|소진된?|망가진?)\s*/, "");
          const cond = (it.condition ?? "").toLowerCase();
          const isLostNow = LOST_KW.some(k => cond.includes(k) || it.name.includes(k));
          if (lostItems.has(baseName) && !isLostNow) {
            addIssue(issues, {
              severity: "major", category: "inventory_contradiction",
              episode: curr.ep, character: charName,
              evidence: `"${baseName}" 이전 화에서 분실/파손 → ep${curr.ep} 정상 상태 복구 (근거 필요)`,
              explanation: "분실 또는 파손된 아이템이 수리/복구 설명 없이 재등장",
              suggested_fix_type: "ledger",
            });
          }
        }
      }
    }
  }
}

// ── C. Location Jump ────────────────────────────────────────
{
  const TRANSITION_RE = [
    /(?:이동|향했다|갔다|도착했다|들어갔다|찾아갔다|걸어갔다|나아갔다)/,
    /(?:잠시\s*후|한참\s*후|시간이\s*(?:흘러|지나)|얼마\s*후|다음\s*날)/,
    /(?:문을|복도를|계단을|통로를)\s*(?:열고|지나|내려|올라|따라)/,
    /(?:공기가|냄새가|빛이|온도가|바람이).*(?:맞았다|스쳤다|채웠다|감쌌다)/,
  ];

  const locHist = {};
  for (const s of [...states].sort((a, b) => a.episode_number - b.episode_number)) {
    if (!s.location) continue;
    if (!locHist[s.character_name]) locHist[s.character_name] = [];
    locHist[s.character_name].push({ ep: s.episode_number, loc: s.location });
  }

  // "미등장" / "알 수 없음" 등 비등장 마커는 실제 위치가 아니므로 skip
  const ABSENT_MARKERS = ["미등장", "알 수 없음", "불명", "비활성", ""];

  for (const [charName, hist] of Object.entries(locHist)) {
    for (let i = 1; i < hist.length; i++) {
      const prev = hist[i - 1], curr = hist[i];
      if (ABSENT_MARKERS.includes(prev.loc) || ABSENT_MARKERS.includes(curr.loc)) continue;
      if (prev.loc === curr.loc || isSameZone(prev.loc, curr.loc)) continue;
      const text = episodeTexts.get(curr.ep) ?? "";
      if (!TRANSITION_RE.some(re => re.test(text))) {
        addIssue(issues, {
          severity: "major", category: "location_jump",
          episode: curr.ep, character: charName,
          evidence: `ep${prev.ep} "${prev.loc}" → ep${curr.ep} "${curr.loc}" (전환 문장 없음)`,
          explanation: "장소 이동 설명 없는 위치 점프",
          suggested_fix_type: "prompt",
        });
      }
    }
  }
}

// ── D. Emotional Loop ───────────────────────────────────────
{
  const byChar = {};
  for (const s of [...states].sort((a, b) => a.episode_number - b.episode_number)) {
    if (!byChar[s.character_name]) byChar[s.character_name] = [];
    byChar[s.character_name].push(s);
  }

  // "알 수 없음"/"(없음)" 등 데이터 부재 마커는 루프 계산에서 제외
  const UNKNOWN_EMO = new Set(["(없음)", "알 수 없음", "미등장"]);

  for (const [charName, hist] of Object.entries(byChar)) {
    let streak = 1;
    for (let i = 1; i < hist.length; i++) {
      const prevEmo = emotionGroup(hist[i - 1].emotional_state ?? "");
      const currEmo = emotionGroup(hist[i].emotional_state ?? "");
      // 데이터 부재 마커는 루프로 보지 않음
      if (UNKNOWN_EMO.has(prevEmo) || UNKNOWN_EMO.has(currEmo)) { streak = 1; continue; }
      const prevGoal = (hist[i - 1].recent_goal ?? "").trim();
      const currGoal = (hist[i].recent_goal ?? "").trim();
      const goalSame = prevGoal === currGoal || currGoal === "이전 목표 유지";

      if (prevEmo === currEmo && goalSame) {
        streak++;
        if (streak >= 3) {
          addIssue(issues, {
            severity: streak >= 4 ? "major" : "minor",
            category: "repetition_loop",
            episode: hist[i].episode_number, character: charName,
            evidence: `감정 "${currEmo}" ${streak}화 연속 (ep${hist[i - streak + 1]?.episode_number}~ep${hist[i].episode_number})`,
            explanation: "감정·목표 변화 없이 반복 — 행동/결정/관계 변화 필요",
            suggested_fix_type: "prompt",
          });
          // streak 유지: 다음 화도 같으면 4화째(major)로 올라감
        }
      } else {
        streak = 1;
      }
    }
  }
}

// ── E. LLM Artifact / Repetition ────────────────────────────
for (const [epNum, text] of episodeTexts.entries()) {
  for (const { re, label } of ARTIFACT_PATTERNS) {
    const match = text.match(re);
    if (match) {
      addIssue(issues, {
        severity: "fatal", category: "artifact_noise",
        episode: epNum,
        evidence: `${label}: "${match[0]?.slice(0, 40)}"`,
        explanation: "LLM 특수 토큰 또는 비한국어 조각 오염",
        suggested_fix_type: "postprocess",
      });
    }
  }

  // 동일 문장 3회 이상 반복
  const sentences = text.split(/[.。!?！？\n]/).map(s => s.trim()).filter(s => s.length > 10);
  const sentCount = {};
  for (const s of sentences) sentCount[s] = (sentCount[s] ?? 0) + 1;
  for (const [s, cnt] of Object.entries(sentCount)) {
    if (cnt >= 3) {
      addIssue(issues, {
        severity: "major", category: "repetition_loop",
        episode: epNum,
        evidence: `"${s.slice(0, 60)}" × ${cnt}회 반복`,
        explanation: "동일 문장 3회 이상 반복",
        suggested_fix_type: "postprocess",
      });
    }
  }
}

// ── F. Speech Register Flip ─────────────────────────────────
{
  const byChar = {};
  for (const s of [...states].sort((a, b) => a.episode_number - b.episode_number)) {
    if (!byChar[s.character_name]) byChar[s.character_name] = [];
    byChar[s.character_name].push(s);
  }

  for (const [charName, hist] of Object.entries(byChar)) {
    for (let i = 1; i < hist.length; i++) {
      const prevRel = hist[i - 1].relationship_updates ?? {};
      const currRel = hist[i].relationship_updates ?? {};
      for (const target of Object.keys(currRel)) {
        const prev = (prevRel[target] ?? "").toLowerCase();
        const curr = (currRel[target] ?? "").toLowerCase();
        if (!prev || !curr) continue;
        const prevFormal = /존댓말|formal|경어|높임/.test(prev);
        const currFormal = /존댓말|formal|경어|높임/.test(curr);
        const prevCasual = /반말|casual|친밀|편한/.test(prev);
        const currCasual = /반말|casual|친밀|편한/.test(curr);
        if ((prevFormal && currCasual) || (prevCasual && currFormal)) {
          addIssue(issues, {
            severity: "minor", category: "speech_register_flip",
            episode: hist[i].episode_number, character: charName,
            evidence: `[${prev}] → [${curr}] (대상: ${target})`,
            explanation: "호칭/말투 격식이 한 화 만에 반전",
            suggested_fix_type: "state",
          });
        }
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Score & Output
// ══════════════════════════════════════════════════════════════

const finalIssues = issues.sort((a, b) => {
  if (a.episode !== b.episode) return a.episode - b.episode;
  return SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity);
});

let penalty = 0;
for (const i of finalIssues) {
  if (i.severity === "fatal") penalty += 0.15;
  else if (i.severity === "major") penalty += 0.03;
  else penalty += 0.01;
}
const immersion_score = Math.max(0, 1 - penalty);
const fatalCount = finalIssues.filter(i => i.severity === "fatal").length;
const majorCount = finalIssues.filter(i => i.severity === "major").length;
const minorCount = finalIssues.filter(i => i.severity === "minor").length;

let verdict;
if (immersion_score >= 0.95) verdict = "PASS";
else if (immersion_score >= 0.90) verdict = "CONDITIONAL";
else if (immersion_score >= 0.80) verdict = "WARN";
else verdict = "FAIL";

const catSummary = {};
for (const i of finalIssues) catSummary[i.category] = (catSummary[i.category] ?? 0) + 1;

// ── Print ──
const W = 65;
const line = "═".repeat(W);
console.log(`\n${line}`);
console.log(` Reader Immersion Integrity Audit`);
console.log(` book_id: ${bookId}`);
console.log(` episodes: ${epRes.rows.length} | characters: ${Object.keys(canonItems).length}`);
console.log(line);

if (finalIssues.length === 0) {
  console.log("\n  ✅  No immersion issues detected.\n");
} else {
  for (const i of finalIssues) {
    const icon = i.severity === "fatal" ? "🔴" : i.severity === "major" ? "🟡" : "🔵";
    console.log(`\n${icon} [ep${i.episode}] [${i.category}]${i.character ? ` — ${i.character}` : ""}`);
    console.log(`   ${i.evidence}`);
    console.log(`   → ${i.explanation}`);
    console.log(`   fix: ${i.suggested_fix_type}`);
  }
}

console.log(`\n${line}`);
console.log(` Summary`);
console.log(line);
console.log(` fatal:  ${fatalCount}`);
console.log(` major:  ${majorCount}`);
console.log(` minor:  ${minorCount}`);
if (Object.keys(catSummary).length > 0) {
  console.log(` categories: ${Object.entries(catSummary).map(([k, v]) => `${k}×${v}`).join(", ")}`);
}
console.log(`\n immersion_score: ${(immersion_score * 100).toFixed(1)}%`);
console.log(` verdict:         ${verdict}`);
console.log(` 30화 가능:       ${verdict !== "FAIL" && fatalCount === 0 ? "YES" : "NO (fatal 또는 FAIL)"}`);
console.log(line + "\n");
