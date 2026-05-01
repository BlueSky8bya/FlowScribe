/**
 * audit_emotional_plausibility.mjs — R5B-1.8
 *
 * Emotional Plausibility + Cause-Action Progression Audit.
 *
 * 핵심 원칙(R5B-1.8 사용자 판단):
 *   - 같은 감정군(cluster)이 여러 화 유지되는 것 자체는 문제 아님.
 *   - fake progression = "라벨/cluster 변화가 있는데 emotion_cause·decision·consequence 어느 것도 본문 사건과 연결 안 된 경우"
 *   - 같은 cluster + 본문 사건이 만든 행동·목표·관계·결정 진전 = PASS
 *   - 다른 cluster로 점프했는데 사건 근거 없음 = FAIL (implausible shift)
 *   - cluster streak는 보조 지표 (단독 FAIL 기준 아님).
 *
 * Data sources:
 *   character_dynamic_states  — emotional_state, recent_goal, location (DB 저장 상태)
 *   run_traces.planner_trace.parsed_plan.character_emotional_beats
 *                             — cause/goal/behavior/relationship/decision/consequence/plausibility 진단
 *
 * Read-only. 본문 미저장.
 *
 * Usage:
 *   node scripts/audit_emotional_plausibility.mjs --book-id <uuid> [--max-ep N]
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

// ── normalizers / cluster heuristic ─────────────────────────────────
const _normGoal = (s) => (s ?? "")
  .toLowerCase()
  .replace(/[\s 　]+/g, " ")
  .replace(/[은는이가을를의에과와로]/g, "")
  .replace(/[\.,!?。·\-]/g, "")
  .trim();

const EMOTION_CLUSTERS = [
  ["불안", "긴장", "두려움", "공포", "초조", "걱정", "위축", "동요", "불길"],
  ["분노", "격노", "노여움", "분개", "성냄", "짜증", "원망"],
  ["슬픔", "비통", "절망", "우울", "비탄", "상실"],
  ["기쁨", "환희", "만족", "행복", "안도", "후련"],
  ["혼란", "당혹", "혼돈", "당황", "의문"],
  ["의심", "경계", "신중", "조심", "주의", "회의"],
  ["결단", "결의", "각오", "확신", "다짐", "단호"],
  ["호기심", "관심", "흥미", "탐구"],
  ["수치", "굴욕", "민망", "부끄러움"],
  ["연민", "동정", "안쓰러움", "측은"],
  ["공허", "무감", "허탈", "무기력"],
];
function _emotionCluster(label) {
  if (!label) return null;
  const norm = String(label).toLowerCase();
  for (let i = 0; i < EMOTION_CLUSTERS.length; i++) {
    if (EMOTION_CLUSTERS[i].some(k => norm.includes(k.toLowerCase()))) return i;
  }
  return -1;
}

// ── meaningful delta detection (planner.ts의 _isMeaningfulDelta 미러) ──
const _MEANINGLESS_RE = /^(유지|없음|동일|변화\s*없음|변동\s*없음|n\/?a|none|-)\s*$/i;
const _isMeaningful = (s) => {
  if (!s || typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 2) return false;
  return !_MEANINGLESS_RE.test(t);
};
const _countMeaningful = (beat) => {
  if (!beat) return 0;
  let n = 0;
  if (_isMeaningful(beat.emotion_cause))      n++;
  if (_isMeaningful(beat.goal_delta))         n++;
  if (_isMeaningful(beat.behavior_delta))     n++;
  if (_isMeaningful(beat.relationship_delta)) n++;
  if (_isMeaningful(beat.decision_delta))     n++;
  if (_isMeaningful(beat.consequence_delta))  n++;
  return n;
};
const _hasCauseSignal = (beat) =>
  _isMeaningful(beat?.emotion_cause)
  || _isMeaningful(beat?.decision_delta)
  || _isMeaningful(beat?.consequence_delta);

async function main() {
  // 본문
  const eps = (await pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 AND episode_number<=$2 ORDER BY episode_number`,
    [bookId, maxEp]
  )).rows;
  if (!eps.length) { console.error("no episodes"); process.exit(0); }

  // 인물 상태 (DB 저장)
  const dyn = (await pool.query(
    `SELECT episode_number, character_name, location, emotional_state, recent_goal, physical_state, visibility_state
     FROM character_dynamic_states WHERE book_id=$1 AND episode_number<=$2
     ORDER BY character_name, episode_number`,
    [bookId, maxEp]
  )).rows;

  // emotional_beats (planner output)
  const traces = (await pool.query(
    `SELECT episode_number, planner_trace FROM run_traces
     WHERE book_id=$1 AND episode_number<=$2 AND planner_trace IS NOT NULL
     ORDER BY episode_number ASC, created_at DESC`,
    [bookId, maxEp]
  )).rows;
  // ep별 가장 최신 trace의 emotional_beats만 사용
  const beatsByEpChar = {}; // { ep: { name: beat } }
  const seenEp = new Set();
  for (const t of traces) {
    if (seenEp.has(t.episode_number)) continue;
    seenEp.add(t.episode_number);
    const parsed = t.planner_trace?.parsed_plan;
    const beats = Array.isArray(parsed?.character_emotional_beats) ? parsed.character_emotional_beats : [];
    beatsByEpChar[t.episode_number] = {};
    for (const b of beats) {
      if (typeof b?.name === "string" && b.name.trim()) {
        beatsByEpChar[t.episode_number][b.name.trim()] = b;
      }
    }
  }

  // 인물별 상태 grouping
  const byChar = {};
  for (const r of dyn) {
    if (!byChar[r.character_name]) byChar[r.character_name] = {};
    byChar[r.character_name][r.episode_number] = r;
  }
  // 본문 등장 추정
  const appearByEp = {};
  for (const e of eps) {
    appearByEp[e.episode_number] = new Set();
    for (const charName of Object.keys(byChar)) {
      if (e.content.includes(charName)) appearByEp[e.episode_number].add(charName);
    }
  }

  console.log(`book_id: ${bookId}  episodes: ${eps.length}  beats_eps: ${Object.keys(beatsByEpChar).length}`);
  console.log("");
  console.log("── [Per-character × episode plausibility trace] ──");
  console.log("ep | char | ap | emo | cluster | lbl_d | clu_d | goal_d | dCnt | cause? | verdict");

  let totalAppearedTransitions = 0;
  let totalSameClusterWithDelta = 0;
  let totalSameClusterWithoutDelta = 0;
  let totalDifferentClusterWithCause = 0;
  let totalImplausibleShift = 0;
  let totalGenuineProgression = 0;
  let totalFakeRisk = 0;
  const charStats = {};

  for (const [name, byEp] of Object.entries(byChar)) {
    charStats[name] = {
      episodes: [],
      appearedEpisodes: 0,
      maxLabelStreak: 1,
      maxClusterStreak: 1,
      currentLabelStreak: 1,
      currentClusterStreak: 1,
      emotionCauseDeltaCount: 0,
      goalDeltaCount: 0,
      behaviorDeltaCount: 0,
      relationshipDeltaCount: 0,
      decisionDeltaCount: 0,
      consequenceDeltaCount: 0,
      sameClusterWithDelta: 0,
      sameClusterWithoutDelta: 0,
      implausibleShifts: 0,
      genuineProgression: 0,
      fakeRisk: 0,
      // for "3화 내 progression"
      transitionsWithBehaviorOrGoalDelta: 0,
    };
    let prev = null;
    for (let ep = 1; ep <= maxEp; ep++) {
      const cur = byEp[ep];
      if (!cur) continue;
      charStats[name].episodes.push(ep);
      const isAppeared = cur.visibility_state !== "absent" && cur.visibility_state !== "cannot_act"
                       && (appearByEp[ep]?.has(name) ?? false);
      if (isAppeared) charStats[name].appearedEpisodes++;
      const beat = beatsByEpChar[ep]?.[name];
      const dCnt = _countMeaningful(beat);
      const hasCause = _hasCauseSignal(beat);

      // count individual delta types
      if (_isMeaningful(beat?.emotion_cause))      charStats[name].emotionCauseDeltaCount++;
      if (_isMeaningful(beat?.goal_delta))         charStats[name].goalDeltaCount++;
      if (_isMeaningful(beat?.behavior_delta))     charStats[name].behaviorDeltaCount++;
      if (_isMeaningful(beat?.relationship_delta)) charStats[name].relationshipDeltaCount++;
      if (_isMeaningful(beat?.decision_delta))     charStats[name].decisionDeltaCount++;
      if (_isMeaningful(beat?.consequence_delta))  charStats[name].consequenceDeltaCount++;

      const labelDelta = prev ? (prev.emotional_state !== cur.emotional_state) : null;
      const prevCluster = prev ? _emotionCluster(prev.emotional_state) : null;
      const curCluster = _emotionCluster(cur.emotional_state);
      const sameCluster = prev && prevCluster !== null && curCluster !== null
                       && prevCluster >= 0 && curCluster >= 0 && prevCluster === curCluster;
      const goalDelta = prev ? (_normGoal(prev.recent_goal) !== _normGoal(cur.recent_goal)) : null;

      // streaks
      if (prev && prev.emotional_state === cur.emotional_state) {
        charStats[name].currentLabelStreak++;
        if (charStats[name].currentLabelStreak > charStats[name].maxLabelStreak)
          charStats[name].maxLabelStreak = charStats[name].currentLabelStreak;
      } else {
        charStats[name].currentLabelStreak = 1;
      }
      if (sameCluster) {
        charStats[name].currentClusterStreak++;
        if (charStats[name].currentClusterStreak > charStats[name].maxClusterStreak)
          charStats[name].maxClusterStreak = charStats[name].currentClusterStreak;
      } else {
        charStats[name].currentClusterStreak = 1;
      }

      // verdict — appeared 인물 + prev 있는 transition만 평가
      let verdict = "-";
      if (prev && isAppeared) {
        totalAppearedTransitions++;
        if (_isMeaningful(beat?.behavior_delta) || _isMeaningful(beat?.goal_delta)) {
          charStats[name].transitionsWithBehaviorOrGoalDelta++;
        }
        if (sameCluster && dCnt >= 1) {
          // 같은 감정군 + 의미 있는 delta ≥1 = PASS
          verdict = "SAME_CLUSTER_PASS";
          charStats[name].sameClusterWithDelta++;
          totalSameClusterWithDelta++;
          if (dCnt >= 2) { charStats[name].genuineProgression++; totalGenuineProgression++; }
        } else if (sameCluster && dCnt === 0) {
          verdict = "SAME_CLUSTER_NO_DELTA";
          charStats[name].sameClusterWithoutDelta++;
          totalSameClusterWithoutDelta++;
          charStats[name].fakeRisk++;
          totalFakeRisk++;
        } else if (!sameCluster && labelDelta && hasCause) {
          // 다른 감정군 점프 + cause/decision/consequence 명시 = PASS
          verdict = "SHIFT_WITH_CAUSE";
          totalDifferentClusterWithCause++;
          if (dCnt >= 2) { charStats[name].genuineProgression++; totalGenuineProgression++; }
        } else if (!sameCluster && labelDelta && !hasCause) {
          // 라벨/cluster 점프했는데 cause/decision/consequence 모두 없음 = implausible
          verdict = "IMPLAUSIBLE_SHIFT";
          charStats[name].implausibleShifts++;
          totalImplausibleShift++;
          charStats[name].fakeRisk++;
          totalFakeRisk++;
        } else if (!labelDelta && !goalDelta && dCnt === 0) {
          verdict = "STAGNANT";
          charStats[name].fakeRisk++;
          totalFakeRisk++;
        } else if (!labelDelta && (goalDelta || dCnt >= 1)) {
          verdict = "STABLE_WITH_PROGRESS";
          charStats[name].sameClusterWithDelta++;
          totalSameClusterWithDelta++;
          if (dCnt >= 2) { charStats[name].genuineProgression++; totalGenuineProgression++; }
        } else {
          verdict = "OK";
        }
      }

      const flag = verdict === "SAME_CLUSTER_NO_DELTA" || verdict === "STAGNANT" ? " ⚠"
                 : verdict === "IMPLAUSIBLE_SHIFT" ? " ✗"
                 : verdict === "SAME_CLUSTER_PASS" || verdict === "SHIFT_WITH_CAUSE" || verdict === "STABLE_WITH_PROGRESS" ? " ✓" : "";
      console.log(
        `${String(ep).padStart(2)} | ${name.padEnd(6)} | ${isAppeared?"Y":"-"} | ` +
        `${(cur.emotional_state??"?").padEnd(8)} | ${String(curCluster).padStart(3)} | ` +
        `${labelDelta===true?"Y":labelDelta===false?"-":"·"} | ` +
        `${sameCluster?"=":(prevCluster!==null&&curCluster!==null?"Y":"·")} | ` +
        `${goalDelta===true?"Y":goalDelta===false?"-":"·"} | ` +
        `${String(dCnt).padStart(4)} | ${hasCause?"Y":"-"} | ${verdict}${flag}`
      );

      prev = cur;
    }
    console.log("");
  }

  // ── per-character summary ──
  console.log("── [Per-character summary] ──");
  console.log("char    | eps | ap | str_lbl | str_clu | dCause | dGoal | dBehav | dRel | dDec | dCons | sameC+ | sameC- | implaus | fakeRisk");
  for (const [name, st] of Object.entries(charStats)) {
    console.log(
      `${name.padEnd(7)} | ${String(st.episodes.length).padStart(3)} | ` +
      `${String(st.appearedEpisodes).padStart(2)} | ` +
      `${String(st.maxLabelStreak).padStart(7)} | ${String(st.maxClusterStreak).padStart(7)} | ` +
      `${String(st.emotionCauseDeltaCount).padStart(6)} | ${String(st.goalDeltaCount).padStart(5)} | ` +
      `${String(st.behaviorDeltaCount).padStart(6)} | ${String(st.relationshipDeltaCount).padStart(4)} | ` +
      `${String(st.decisionDeltaCount).padStart(4)} | ${String(st.consequenceDeltaCount).padStart(5)} | ` +
      `${String(st.sameClusterWithDelta).padStart(6)} | ${String(st.sameClusterWithoutDelta).padStart(6)} | ` +
      `${String(st.implausibleShifts).padStart(7)} | ${String(st.fakeRisk).padStart(8)}`
    );
  }

  // ── aggregate ──
  console.log("");
  console.log("── [Aggregate — Plausibility metrics] ──");
  const denom = Math.max(1, totalAppearedTransitions);
  const sameNoDeltaRatio = totalSameClusterWithoutDelta / denom;
  const fakeRiskRatio = totalFakeRisk / denom;
  const genuineRatio = totalGenuineProgression / denom;
  const sameWithDeltaRatio = totalSameClusterWithDelta / denom;
  const implausibleCount = totalImplausibleShift;

  console.log(`appeared transitions: ${totalAppearedTransitions}`);
  console.log(`same_cluster_with_valid_delta: ${totalSameClusterWithDelta} (${(sameWithDeltaRatio*100).toFixed(1)}%)`);
  console.log(`same_cluster_without_delta:    ${totalSameClusterWithoutDelta} (${(sameNoDeltaRatio*100).toFixed(1)}%) ${sameNoDeltaRatio>0.10?"⚠":""}`);
  console.log(`different_cluster_with_cause:  ${totalDifferentClusterWithCause}`);
  console.log(`implausible_emotion_shift:     ${implausibleCount} ${implausibleCount>0?"✗":""}`);
  console.log(`fake_progression_risk:         ${totalFakeRisk} (${(fakeRiskRatio*100).toFixed(1)}%) ${fakeRiskRatio>0.10?"⚠":""}`);
  console.log(`genuine_progression(≥2 deltas):${totalGenuineProgression} (${(genuineRatio*100).toFixed(1)}%) ${genuineRatio<0.65?"⚠":""}`);

  // 인물별 3화 내 progression
  console.log("");
  console.log("── [Per-character 3-ep behavior/goal-delta cadence] ──");
  let cadenceFail = 0;
  for (const [name, st] of Object.entries(charStats)) {
    if (st.appearedEpisodes < 3) continue;
    const cadence = st.transitionsWithBehaviorOrGoalDelta / Math.max(1, st.appearedEpisodes - 1);
    const fail = cadence < 1/3;
    console.log(`  ${name.padEnd(8)} appeared=${st.appearedEpisodes} bg-delta-cadence=${(cadence*100).toFixed(0)}% ${fail?"⚠":"✓"}`);
    if (fail) cadenceFail++;
  }

  // ── verdict ──
  console.log("");
  console.log("── [R5B-1.8 PASS criteria] ──");
  const checks = [
    { name: "same_cluster_without_delta ≤ 10%",       pass: sameNoDeltaRatio <= 0.10 },
    { name: "fake_progression_risk ≤ 10%",            pass: fakeRiskRatio <= 0.10 },
    { name: "genuine_progression ≥ 65%",              pass: genuineRatio >= 0.65 },
    { name: "implausible_emotion_shift = 0",          pass: implausibleCount === 0 },
    { name: "주요 인물 3화 내 behavior/goal delta ≥1", pass: cadenceFail === 0 },
  ];
  for (const c of checks) console.log(`  ${c.pass?"✓":"✗"} ${c.name}`);
  const passed = checks.filter(c => c.pass).length;
  console.log("");
  console.log(`R5B-1.8 PASS: ${passed}/${checks.length} ${passed===checks.length?"✅":"⚠"}`);
  console.log(`(보조) max_label_streak=${Math.max(...Object.values(charStats).map(c=>c.maxLabelStreak),0)} max_cluster_streak=${Math.max(...Object.values(charStats).map(c=>c.maxClusterStreak),0)}`);

  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(1); });
