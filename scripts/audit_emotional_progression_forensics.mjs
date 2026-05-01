/**
 * audit_emotional_progression_forensics.mjs — R5B-1.6
 *
 * 감정 변화의 진정성 분석. 단순 라벨 streak가 아닌:
 *   emotion_label_delta + goal_delta + location_delta + appeared 결합
 *   fake progression detection (label만 변경, goal/location 동일)
 *   root cause candidate 분류 (planner/extractor/normalizer/carry-forward/UI/plot 정체)
 *
 * read-only. 본문 미저장.
 *
 * Usage:
 *   node scripts/audit_emotional_progression_forensics.mjs --book-id <uuid> [--max-ep N]
 */
import pg from "pg";
import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const maxEp = parseInt(args[args.indexOf("--max-ep") + 1] ?? "30", 10);
if (!bookId) { console.error("Usage: --book-id <uuid> [--max-ep N]"); process.exit(1); }

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// recent_goal 텍스트 normalize: 표현 변주 차이는 흡수, 핵심 의미만 비교
const _normGoal = (s) => (s ?? "")
  .toLowerCase()
  .replace(/[\s 　]+/g, " ")
  .replace(/[은는이가을를의에과와로]/g, "")  // 조사 제거
  .replace(/[\.,!?。·\-]/g, "")
  .trim();

// 감정 단어가 의미적으로 같은 그룹인지 — heuristic. 같은 그룹 변경은 fake change.
const EMOTION_CLUSTERS = [
  ["불안", "긴장", "두려움", "공포", "초조", "걱정"],
  ["분노", "격노", "노여움", "분개", "성냄"],
  ["슬픔", "비통", "절망", "우울", "비탄"],
  ["기쁨", "환희", "만족", "행복", "안도"],
  ["혼란", "당혹", "혼돈", "혼돈"],
  ["의심", "경계", "신중", "조심", "주의"],
  ["결단", "결의", "각오", "확신", "다짐"],
  ["호기심", "관심", "흥미"],
];
function _emotionCluster(label) {
  if (!label) return null;
  const norm = label.toLowerCase();
  for (let i = 0; i < EMOTION_CLUSTERS.length; i++) {
    if (EMOTION_CLUSTERS[i].some(k => norm.includes(k.toLowerCase()))) return i;
  }
  return -1; // unknown cluster — treat as unique
}

async function main() {
  const eps = (await pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 AND episode_number<=$2 ORDER BY episode_number`,
    [bookId, maxEp]
  )).rows;
  if (!eps.length) { console.error("no episodes"); process.exit(0); }

  const dyn = (await pool.query(
    `SELECT episode_number, character_name, location, emotional_state, recent_goal, physical_state, visibility_state
     FROM character_dynamic_states WHERE book_id=$1 AND episode_number<=$2
     ORDER BY character_name, episode_number`,
    [bookId, maxEp]
  )).rows;

  // 인물별 ep별 grouping
  const byChar = {};
  for (const r of dyn) {
    if (!byChar[r.character_name]) byChar[r.character_name] = {};
    byChar[r.character_name][r.episode_number] = r;
  }

  // 본문에서 인물 이름 등장 (appeared 추정 보강)
  const appearByEp = {};
  for (const e of eps) {
    appearByEp[e.episode_number] = new Set();
    for (const charName of Object.keys(byChar)) {
      if (e.content.includes(charName)) appearByEp[e.episode_number].add(charName);
    }
  }

  console.log(`book_id: ${bookId}  episodes: ${eps.length}`);
  console.log("");
  console.log("── [Per-character × episode trace] ──");
  console.log("ep | char | appear | emo | goal_head(40) | loc_head(20) | label_delta | cluster_delta | goal_delta | fake_risk");

  let totalFakeRisk = 0;
  let totalGenuineProgression = 0;
  const charStats = {};

  for (const [name, byEp] of Object.entries(byChar)) {
    charStats[name] = {
      episodes: [],
      labelChanges: 0,
      clusterChanges: 0,
      goalChanges: 0,
      locationChanges: 0,
      fakeRisks: 0,
      maxStreakOverall: 1,
      maxStreakAppearedOnly: 1,
      currentStreak: 1,
      currentAppearedStreak: 1,
      currentEmo: null,
      currentEmoAppeared: null,
    };
    let prev = null;
    for (let ep = 1; ep <= maxEp; ep++) {
      const cur = byEp[ep];
      if (!cur) continue;
      const isAppeared = cur.visibility_state !== "absent" && cur.visibility_state !== "cannot_act"
                       && (appearByEp[ep]?.has(name) ?? false);
      const labelDelta = prev ? (prev.emotional_state !== cur.emotional_state ? "Y" : "-") : "(first)";
      const prevCluster = prev ? _emotionCluster(prev.emotional_state) : null;
      const curCluster = _emotionCluster(cur.emotional_state);
      const clusterDelta = prev ? (prevCluster !== curCluster ? "Y" : "-") : "(first)";
      const goalDelta = prev ? (_normGoal(prev.recent_goal) !== _normGoal(cur.recent_goal) ? "Y" : "-") : "(first)";
      const locDelta = prev ? (prev.location !== cur.location ? "Y" : "-") : "(first)";

      // fake_progression: 감정 라벨/cluster은 바뀌었지만 goal/location 모두 동일
      const fakeRisk = (labelDelta === "Y" && goalDelta === "-" && locDelta === "-") ? "FAKE" :
                       (labelDelta === "Y" && goalDelta === "Y") ? "GENUINE" :
                       (labelDelta === "-" && goalDelta === "-" && locDelta === "-") ? "STAGNANT" : "-";

      if (prev) {
        if (labelDelta === "Y") charStats[name].labelChanges++;
        if (clusterDelta === "Y") charStats[name].clusterChanges++;
        if (goalDelta === "Y") charStats[name].goalChanges++;
        if (locDelta === "Y") charStats[name].locationChanges++;
        if (fakeRisk === "FAKE") { charStats[name].fakeRisks++; totalFakeRisk++; }
        if (fakeRisk === "GENUINE") totalGenuineProgression++;
      }

      // streak 계산 (전체)
      if (prev && prev.emotional_state === cur.emotional_state) {
        charStats[name].currentStreak++;
        if (charStats[name].currentStreak > charStats[name].maxStreakOverall) charStats[name].maxStreakOverall = charStats[name].currentStreak;
      } else {
        charStats[name].currentStreak = 1;
      }
      // streak 계산 (appeared-only — appeared=true인 ep만 카운트)
      if (isAppeared) {
        if (charStats[name].currentEmoAppeared === cur.emotional_state) {
          charStats[name].currentAppearedStreak++;
          if (charStats[name].currentAppearedStreak > charStats[name].maxStreakAppearedOnly) charStats[name].maxStreakAppearedOnly = charStats[name].currentAppearedStreak;
        } else {
          charStats[name].currentAppearedStreak = 1;
          charStats[name].currentEmoAppeared = cur.emotional_state;
        }
      }

      const goalHead = (cur.recent_goal ?? "").slice(0, 40);
      const locHead = (cur.location ?? "").slice(0, 20);
      const flag = fakeRisk === "FAKE" ? "⚠" : fakeRisk === "STAGNANT" ? "·" : fakeRisk === "GENUINE" ? "✓" : "";
      console.log(`${String(ep).padStart(2)} | ${name.padEnd(6)} | ${isAppeared?"Y":"-"} | ${(cur.emotional_state??"?").padEnd(8)} | ${goalHead.padEnd(40)} | ${locHead.padEnd(20)} | ${labelDelta} | ${clusterDelta} | ${goalDelta} | ${fakeRisk}${flag}`);

      charStats[name].episodes.push(ep);
      prev = cur;
    }
    console.log(""); // blank line between characters
  }

  // ── per-character summary ──
  console.log("── [Per-character summary] ──");
  console.log("char    | eps | label_changes | cluster_changes | goal_changes | loc_changes | fake_risks | streak_overall | streak_appeared");
  for (const [name, st] of Object.entries(charStats)) {
    console.log(
      `${name.padEnd(7)} | ${String(st.episodes.length).padStart(3)} | ` +
      `${String(st.labelChanges).padStart(13)} | ${String(st.clusterChanges).padStart(15)} | ` +
      `${String(st.goalChanges).padStart(12)} | ${String(st.locationChanges).padStart(11)} | ` +
      `${String(st.fakeRisks).padStart(10)} | ${String(st.maxStreakOverall).padStart(14)} | ${String(st.maxStreakAppearedOnly).padStart(15)}`
    );
  }

  // ── 종합 metric ──
  console.log("");
  console.log("── [Aggregate] ──");
  const totalTransitions = Object.values(charStats).reduce((s, c) => s + Math.max(0, c.episodes.length - 1), 0);
  console.log(`total transitions: ${totalTransitions}`);
  console.log(`total fake_progression risk: ${totalFakeRisk}  (${totalTransitions ? ((totalFakeRisk/totalTransitions)*100).toFixed(1) : 0}%)`);
  console.log(`total genuine_progression: ${totalGenuineProgression}  (${totalTransitions ? ((totalGenuineProgression/totalTransitions)*100).toFixed(1) : 0}%)`);

  // appeared-only streak max
  const maxAppearedStreak = Math.max(...Object.values(charStats).map(c => c.maxStreakAppearedOnly), 0);
  console.log(`max appeared-only emotion streak: ${maxAppearedStreak}` + (maxAppearedStreak >= 3 ? " ⚠ (≥3 정체 의심)" : ""));

  // ── Root cause candidate (heuristic) ──
  console.log("");
  console.log("── [Root cause candidate] ──");
  const candidates = [];
  if (totalFakeRisk / Math.max(1, totalTransitions) >= 0.3) candidates.push("HIGH: fake progression — 라벨만 변경 (planner/renderer 감정 장면화 부족 가능, 후보 A/B)");
  if (maxAppearedStreak >= 4) candidates.push("HIGH: appeared 인물도 4화+ streak — carry-forward 과강함 또는 plot 정체 (후보 E/G)");
  if (Object.values(charStats).some(c => c.goalChanges < c.episodes.length * 0.4)) candidates.push("MEDIUM: 일부 인물 goal_changes < 40% — extractor 보수성 또는 planner output 부족 (후보 C/A)");
  // cluster vs label divergence: label만 자주 바뀌고 cluster는 그대로 → normalizer 압축 의심
  let labelOnlyChanges = 0;
  for (const c of Object.values(charStats)) labelOnlyChanges += Math.max(0, c.labelChanges - c.clusterChanges);
  if (labelOnlyChanges >= totalTransitions * 0.2) candidates.push("MEDIUM: 라벨만 변경 (cluster 동일) — normalizer 표면 분산 의심 (후보 D)");
  if (candidates.length === 0) candidates.push("LOW: 감정 변화 패턴 정상");
  for (const c of candidates) console.log("  " + c);

  // ── verdict ──
  console.log("");
  console.log("── [Verdict] ──");
  const flags = [];
  if (totalFakeRisk / Math.max(1, totalTransitions) >= 0.3) flags.push("fake progression 비율 높음");
  if (maxAppearedStreak >= 3) flags.push("appeared streak ≥3");
  if (totalGenuineProgression / Math.max(1, totalTransitions) < 0.3) flags.push("genuine progression < 30%");
  console.log(flags.length ? `  EMOTIONAL FORENSIC FLAGS: ${flags.join(" | ")}` : "  EMOTIONAL FORENSIC FLAGS: 없음");

  await pool.end();
}

main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(1); });
