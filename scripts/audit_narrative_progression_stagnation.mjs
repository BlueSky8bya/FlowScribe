/**
 * audit_narrative_progression_stagnation.mjs — Phase R5A-D0
 *
 * 책 단위 서사 정체(narrative stagnation) 진단. read-only.
 *
 * 측정:
 *   - emotional_state streak (인물별 ep1~N)
 *   - location 변화 횟수
 *   - rolling_summary 길이/품질 (첫 문장 fallback인지 LLM 요약인지 추정)
 *   - foreshadow open thread 누적/도메인 반복 (같은 키워드 반복 plant 여부)
 *   - continuity_contract.known_facts vs open_threads 비율
 *   - episode_delta_contract.repetition_risk 발동 시점
 *   - emotional_progression_requirements 첫 발동 ep
 *   - keyword density (motif 반복) — book-agnostic 자동 추출
 *
 * 본문 전문/raw prompt 미저장. score/카운트만 출력.
 *
 * Usage:
 *   node scripts/audit_narrative_progression_stagnation.mjs --book-id <uuid> [--max-ep N]
 */
import pg from "pg";
import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const maxEp  = parseInt(args[args.indexOf("--max-ep") + 1] ?? "20", 10);
if (!bookId) { console.error("Usage: --book-id <uuid> [--max-ep N]"); process.exit(1); }

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TITLE_RE = /^#\s*\d+화\s*[-–—]\s*.+$/m;

function autoMotifs(eps) {
  // 책별 하드코딩 없이 본문에서 가장 자주 등장하는 짧은 명사구 자동 추출 (단순 빈도)
  const stopwords = new Set(["그녀","그는","그가","그것","자신","그녀의","그의","그런","이런","저런","그래서","하지만","그리고","그래도","빅토리","리아","카이렌","브론"]);
  const counts = new Map();
  for (const e of eps) {
    const tokens = (e.content||"").replace(TITLE_RE,"").match(/[가-힣]{2,5}/g) || [];
    const localSeen = new Set();
    for (const t of tokens) {
      if (stopwords.has(t)) continue;
      // 화 단위 unique count (한 화에서 여러 번 나와도 1로) → cross-episode persistence 측정
      if (localSeen.has(t)) continue;
      localSeen.add(t);
      counts.set(t, (counts.get(t)||0) + 1);
    }
  }
  // 5화 모두에 등장한 토큰 (절대치 기준 — maxEp 무관 적용)
  const persistent = [...counts.entries()].filter(([_,c]) => c >= Math.min(eps.length, 4)).sort((a,b)=>b[1]-a[1]);
  return persistent.slice(0, 8);
}

async function main() {
  const eps = (await pool.query(
    `SELECT episode_number, content, summary, LENGTH(content) AS content_len, LENGTH(summary) AS summary_len
     FROM episodes WHERE book_id=$1 AND episode_number<=$2 ORDER BY episode_number ASC`,
    [bookId, maxEp]
  )).rows;
  if (!eps.length) { console.error("no episodes found"); process.exit(0); }

  const dyn = (await pool.query(
    `SELECT episode_number, character_name, location, emotional_state, recent_goal, physical_state
     FROM character_dynamic_states WHERE book_id=$1 AND episode_number<=$2
     ORDER BY episode_number ASC, character_name ASC`,
    [bookId, maxEp]
  )).rows;

  const fs = (await pool.query(
    `SELECT planted_episode, resolved_episode, status, content, keywords FROM foreshadows
     WHERE book_id=$1 AND planted_episode<=$2 ORDER BY planted_episode ASC`,
    [bookId, maxEp]
  )).rows;

  const snaps = (await pool.query(
    `SELECT episode_number, effective_context FROM episode_snapshots
     WHERE book_id=$1 AND episode_number<=$2 ORDER BY episode_number ASC`,
    [bookId, maxEp]
  )).rows;

  const arcs = (await pool.query(
    `SELECT arc_number FROM arc_summaries WHERE book_id=$1`, [bookId]
  ).catch(()=>({rows:[]}))).rows;

  // ── 1. summary 품질 추정 ──────────────────────────────────────
  // 첫 문장 fallback인지 LLM 요약인지: title-prefix 형태 + 짧으면 fallback
  let fallbackSummaryCount = 0;
  for (const e of eps) {
    const isFallback = (e.summary||"").startsWith("# ") || (e.summary||"").length < 80;
    if (isFallback) fallbackSummaryCount++;
  }
  const summaryFallbackRatio = eps.length ? fallbackSummaryCount / eps.length : 0;
  const summaryAvgLen = eps.length ? Math.round(eps.reduce((s,e)=>s+(e.summary_len||0),0)/eps.length) : 0;

  // ── 2. emotion / location streak ──────────────────────────────
  const byChar = {};
  for (const r of dyn) {
    if (!byChar[r.character_name]) byChar[r.character_name] = [];
    byChar[r.character_name].push(r);
  }
  const emotionStreaks = [];
  let locationChanges = 0, locationCarries = 0;
  for (const [name, rows] of Object.entries(byChar)) {
    rows.sort((a,b)=>a.episode_number-b.episode_number);
    let curEmo = rows[0]?.emotional_state ?? null;
    let streak = 1, maxStreak = 1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].emotional_state === curEmo) { streak++; if (streak>maxStreak) maxStreak=streak; }
      else { curEmo = rows[i].emotional_state; streak = 1; }
    }
    emotionStreaks.push({ character: name, max_streak: maxStreak, final_emotion: curEmo });
    let lastLoc = rows[0]?.location ?? null;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].location !== lastLoc) { locationChanges++; lastLoc = rows[i].location; }
      else locationCarries++;
    }
  }

  // ── 3. foreshadow keyword 반복 ────────────────────────────────
  // 같은 keyword가 N회 이상 plant 되면 motif 누적 의심
  const kwPlantCount = new Map();
  for (const f of fs) {
    for (const kw of (f.keywords||[])) {
      kwPlantCount.set(kw, (kwPlantCount.get(kw)||0) + 1);
    }
  }
  const recurringMotifs = [...kwPlantCount.entries()].filter(([_,c])=>c>=3).sort((a,b)=>b[1]-a[1]);
  const openCount = fs.filter(f=>f.status==="open" || !f.resolved_episode).length;
  const resolvedCount = fs.length - openCount;

  // ── 4. snapshot contract metrics ──────────────────────────────
  const snapMetrics = snaps.map(s => {
    const ec = s.effective_context || {};
    const cc = ec.continuity_contract || {};
    const dc = ec.episode_delta_contract || {};
    return {
      ep: s.episode_number,
      rolling_summary_len: (ec.rolling_summary||"").length,
      foreshadow_count: (ec.foreshadow_memory||[]).length,
      known_facts: (cc.known_facts||[]).length,
      open_threads: (cc.open_threads||[]).length,
      forbidden_regressions: (cc.forbidden_regressions||[]).length,
      emo_progression_reqs: (cc.emotional_progression_requirements||[]).length,
      must_progress: (dc.must_progress||[]).length,
      must_not_repeat: (dc.must_not_repeat||[]).length,
      repetition_risk: (dc.repetition_risk||[]).length,
      character_arcs: Object.keys(ec.character_arcs||{}).length,
    };
  });

  const firstEmoTrigger = snapMetrics.find(m=>m.emo_progression_reqs>0)?.ep ?? null;
  const firstRepRisk = snapMetrics.find(m=>m.repetition_risk>0)?.ep ?? null;

  // ── 5. cross-episode motif (자동 추출) ────────────────────────
  const motifs = autoMotifs(eps);

  // ── 6. 진전 score (heuristic) ─────────────────────────────────
  // 각 화: 새 location? 새 인물 첫 등장? recent_goal 변경? emo 변경?
  const epScores = [];
  let prevDynByChar = {};
  for (const e of eps) {
    const epRows = dyn.filter(d=>d.episode_number===e.episode_number);
    let score = 0;
    let newLoc = false, newGoal = false, newEmo = false;
    for (const r of epRows) {
      const prev = prevDynByChar[r.character_name];
      if (prev) {
        if (prev.location !== r.location) newLoc = true;
        if (prev.recent_goal !== r.recent_goal && r.recent_goal !== "이전 목표 유지") newGoal = true;
        if (prev.emotional_state !== r.emotional_state) newEmo = true;
      }
      prevDynByChar[r.character_name] = r;
    }
    if (newLoc) score += 2;
    if (newGoal) score += 1;
    if (newEmo) score += 1;
    if (score > 5) score = 5;
    epScores.push({ ep: e.episode_number, score, newLoc, newGoal, newEmo });
  }
  const avgScore = epScores.length ? (epScores.reduce((s,e)=>s+e.score,0)/epScores.length).toFixed(2) : "n/a";

  // ── 출력 ──────────────────────────────────────────────────────
  console.log(`book_id: ${bookId}  episodes: ${eps.length}`);
  console.log(`arc_summaries generated: ${arcs.length}`);
  console.log("");
  console.log("── [Summary quality] ──");
  console.log(`  fallback_summary_ratio: ${(summaryFallbackRatio*100).toFixed(0)}%`);
  console.log(`  avg summary length: ${summaryAvgLen} chars  (LLM 요약이면 200~400, fallback이면 30~60)`);
  console.log("");
  console.log("── [State streaks] ──");
  for (const s of emotionStreaks) {
    const flag = s.max_streak >= 3 ? " ⚠" : "";
    console.log(`  ${s.character}: max emotion streak=${s.max_streak}  final="${s.final_emotion}"${flag}`);
  }
  console.log(`  location changes: ${locationChanges}  carry-forwards: ${locationCarries}` + (locationChanges===0 ? " ⚠ (no movement)" : ""));
  console.log("");
  console.log("── [Foreshadow / motif] ──");
  console.log(`  total foreshadows: ${fs.length}  open: ${openCount}  resolved: ${resolvedCount}`);
  console.log(`  recurring keywords (planted ≥3 episodes):`);
  for (const [kw,c] of recurringMotifs.slice(0,8)) console.log(`    "${kw}" × ${c}`);
  console.log(`  cross-episode persistent tokens (≥4/${eps.length} eps):`);
  for (const [t,c] of motifs.slice(0,8)) console.log(`    ${t} × ${c}`);
  console.log("");
  console.log("── [Snapshot contract by ep] ──");
  console.log("  ep | rs_len | fs_mem | k_facts | o_threads | f_regr | emo_req | mp | mnr | rep_risk | char_arcs");
  for (const m of snapMetrics) {
    console.log(`  ${String(m.ep).padStart(2)} | ${String(m.rolling_summary_len).padStart(6)} | ${String(m.foreshadow_count).padStart(6)} | ${String(m.known_facts).padStart(7)} | ${String(m.open_threads).padStart(9)} | ${String(m.forbidden_regressions).padStart(6)} | ${String(m.emo_progression_reqs).padStart(7)} | ${String(m.must_progress).padStart(2)} | ${String(m.must_not_repeat).padStart(3)} | ${String(m.repetition_risk).padStart(8)} | ${String(m.character_arcs).padStart(9)}`);
  }
  console.log(`  emotion_progression_requirements first triggered at ep: ${firstEmoTrigger ?? "never"}`);
  console.log(`  repetition_risk first triggered at ep: ${firstRepRisk ?? "never"}`);
  console.log("");
  console.log("── [Per-episode progression score (0~5)] ──");
  for (const s of epScores) {
    const flag = s.score === 0 ? " ⚠" : "";
    console.log(`  ep${String(s.ep).padStart(2)}: ${s.score}  loc=${s.newLoc?"Y":"N"} goal=${s.newGoal?"Y":"N"} emo=${s.newEmo?"Y":"N"}${flag}`);
  }
  console.log(`  avg progression score: ${avgScore}` + (parseFloat(avgScore)<2 ? " ⚠ (정체 의심)" : ""));
  console.log("");
  console.log("── [Verdict] ──");
  const flags = [];
  if (summaryFallbackRatio >= 0.5) flags.push("summary fallback dominant");
  if (locationChanges === 0 && eps.length >= 3) flags.push("location frozen");
  if (emotionStreaks.some(s=>s.max_streak>=4)) flags.push("emotion streak≥4");
  if (recurringMotifs.length >= 1 && recurringMotifs[0][1] >= 4) flags.push(`motif "${recurringMotifs[0][0]}" replanted ${recurringMotifs[0][1]}x`);
  if (parseFloat(avgScore) < 2) flags.push("low progression");
  if (firstEmoTrigger === null && eps.length >= 4) flags.push("emo_progression never triggered");
  if (snapMetrics.every(m=>m.character_arcs===0) && eps.length >= 4) flags.push("character_arcs always empty");
  console.log(flags.length ? `  STAGNATION FLAGS: ${flags.join(" | ")}` : "  STAGNATION FLAGS: 없음");

  await pool.end();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
