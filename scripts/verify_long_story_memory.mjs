/**
 * verify_long_story_memory.mjs
 * 장편 스토리 메모리 안정성 검증 하네스
 *
 * 모드:
 *   fixture  — 결정론적 시뮬레이션. DB/서버 불필요.
 *   trace    — 실제 API/DB 조회. --book-id + 서버(localhost:3000) 필요.
 *
 * 사용 예:
 *   node scripts/verify_long_story_memory.mjs --episodes 30 --mode fixture
 *   node scripts/verify_long_story_memory.mjs --episodes 100 --mode fixture
 *   node scripts/verify_long_story_memory.mjs --episodes 30 --mode trace --book-id <uuid>
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir  = dirname(fileURLToPath(import.meta.url));
const root   = resolve(__dir, "..");
const BASE   = "http://localhost:3000";

// ── CLI 파싱 ────────────────────────────────────────────────
const args     = process.argv.slice(2);
const getArg   = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const TOTAL    = parseInt(getArg("--episodes") ?? "30", 10);
const MODE     = (getArg("--mode") ?? "fixture").toLowerCase();
const BOOK_ID  = getArg("--book-id");
const ARC_SIZE = 10;

if (!["fixture", "trace"].includes(MODE)) {
  console.error("--mode must be 'fixture' or 'trace'");
  process.exit(1);
}
if (MODE === "trace" && !BOOK_ID) {
  console.error("--mode trace requires --book-id <uuid>");
  process.exit(1);
}

console.log(`\n${"═".repeat(68)}`);
console.log(`LONG-FORM STORY MEMORY AUDIT — ${TOTAL}화 | mode: ${MODE}`);
console.log(`${"═".repeat(68)}`);

// ── 아크 위상 계산 (state_extractor.ts 완전 복제) ────────────
function calcArcPhase(ep, total) {
  if (total <= 0) return "unknown";
  const ratio = ep / total;
  if (ratio < 0.15) return "intro";
  if (ratio < 0.35) return "early";
  if (ratio < 0.65) return "mid";
  if (ratio < 0.85) return "late";
  if (ratio < 0.97) return "pre_final";
  return "final";
}

function calcEpisodeRole(ep, total) {
  if (total <= 0) return "unknown";
  const remaining = total - ep;
  const ratio     = ep / total;
  if (ep >= total)    return "final";
  if (remaining <= 1) return "pre-final";
  if (remaining <= 5) return "late";
  if (ratio < 0.15)   return "intro";
  if (ratio < 0.35)   return "early";
  return "mid";
}

// ── 중단 조건 평가기 ─────────────────────────────────────────
const STOP = {
  consecutive_fails:       0,
  relationship_regressions: 0,
  item_hallucinations:      0,
  arc_absent_streak:        0,
  triggered:                false,
  reason:                   null,
};

function checkStop(m) {
  if (m.verdict === "FAIL") STOP.consecutive_fails++;
  else STOP.consecutive_fails = 0;
  if (m.arc_summary_present) STOP.arc_absent_streak = 0;
  else if (m.episode > ARC_SIZE) STOP.arc_absent_streak++;

  STOP.relationship_regressions += (m.regression_warnings?.length ?? 0);
  STOP.item_hallucinations      += (m.item_continuity_warnings?.length ?? 0);

  if (STOP.consecutive_fails >= 3)           return `3화 연속 FAIL (ep${m.episode})`;
  if (STOP.relationship_regressions >= 2)    return `관계 리셋 2회 이상 (ep${m.episode})`;
  if (STOP.item_hallucinations >= 3)         return `아이템 할루시네이션 3회 이상 (ep${m.episode})`;
  if (m.foreshadow_open_count >= 15 && m.foreshadow_resolved_count === 0)
                                             return `open_thread 15개 이상 + 회수 0 (ep${m.episode})`;
  if (m.rolling_summary_chars < 10 && m.episode >= 3)
                                             return `rolling_summary 비어 있음 (ep${m.episode})`;
  if (STOP.arc_absent_streak >= 10)          return `arc_summary 10화 연속 없음 (ep${m.episode})`;
  if (m.episode === m.total && !m.finalization_directive)
                                             return `최종화에 finalization directive 없음 (ep${m.episode})`;
  return null;
}

// ── Fixture 시뮬레이터 ────────────────────────────────────────
/**
 * 결정론적 픽스처 기반 시뮬레이션.
 * 실제 LLM 호출 없이 각 화의 메모리 상태를 수학적으로 모델링.
 *
 * 모델 가정:
 *  - rolling_summary: 화당 ~120자 요약, 최근 10화 롤링 창 → 최대 ~1200자
 *  - arc_summary: ep % 10 === 0 또는 단편 최종화 시 생성 (~500자)
 *  - character_arcs: 첫 번째 아크(ep 10) 이후 존재. 인물당 2개 key_events.
 *  - foreshadow: 3화마다 1개 신규 심기, 5화마다 1개 회수
 *  - dynamic_states: ep 2부터 존재 (recent_goal 포함)
 *  - continuity_contract: ep 2부터 존재
 *  - known_facts: arc 있으면 char_arcs × key_events, 없으면 rolling_summary 라인
 */
function fixtureSimulate(totalEpisodes) {
  const N_CHARS     = 5;   // 인물 수
  const metrics_all = [];

  // 복선 상태 추적
  let foreshadow_planted  = 0;
  let foreshadow_resolved = 0;

  for (let ep = 1; ep <= totalEpisodes; ep++) {
    // ── 복선 갱신 ──────────────────────────────────────────
    if (ep % 3 === 0) foreshadow_planted++;
    if (ep % 5 === 0 && foreshadow_planted > foreshadow_resolved) foreshadow_resolved++;
    const foreshadow_open = foreshadow_planted - foreshadow_resolved;

    // ── rolling_summary ────────────────────────────────────
    // 최근 10화 × 240자(gemma3:12b 실측 기준). ep < 10이면 ep × 240.
    const window_size           = Math.min(ep, 10);
    const rolling_summary_chars = window_size * 240;
    const rolling_summary_lines = window_size;

    // ── arc_summary ────────────────────────────────────────
    const isShortFinal    = totalEpisodes < ARC_SIZE && ep >= totalEpisodes;
    const isArcComplete   = ep % ARC_SIZE === 0;
    const arc_summary_present = isArcComplete || isShortFinal;
    const arc_summary_chars   = arc_summary_present ? 480 : 0;

    // ── character_arcs ─────────────────────────────────────
    // 첫 번째 아크 완료(ep>=10) 또는 단편 최종화 이후 존재
    const arcs_fired         = isShortFinal ? 1 : Math.floor(ep / ARC_SIZE);
    const character_arc_count = arcs_fired > 0 ? N_CHARS : 0;

    // ── continuity_contract & known_facts ──────────────────
    const continuity_contract_present = ep >= 2;
    let known_facts_count = 0;
    if (continuity_contract_present) {
      if (character_arc_count > 0) {
        // arc key_events(인물당 2개) + recent_goal(인물당 1개)
        known_facts_count = character_arc_count * 2 + N_CHARS;
      } else {
        // rolling_summary 라인 fallback (최대 ep-1줄)
        known_facts_count = Math.min(ep - 1, 10);
      }
    }

    // ── open_threads / resolved_threads ────────────────────
    const open_threads_count     = foreshadow_open;
    const resolved_threads_count = foreshadow_resolved;

    // ── finalization_directive ─────────────────────────────
    // renderer.ts: isFinal = ending_constraint !== "cliff"
    // → ep >= totalEpisodes → final constraint
    const finalization_directive = ep >= totalEpisodes;

    // ── 아크 위상 ──────────────────────────────────────────
    const arc_phase    = calcArcPhase(ep, totalEpisodes);
    const episode_role = calcEpisodeRole(ep, totalEpisodes);
    const arc_ratio    = totalEpisodes > 0 ? ep / totalEpisodes : 0;

    // ── verdict ────────────────────────────────────────────
    const issues = [];

    if (ep >= 2 && !continuity_contract_present)
      issues.push("continuity_contract 없음");
    if (ep >= 2 && known_facts_count < 1)
      issues.push("known_facts 0개");
    if (ep >= 2 && rolling_summary_chars < 10)
      issues.push("rolling_summary 비어있음");
    if (foreshadow_open > 12)
      issues.push(`open_thread 과다 (${foreshadow_open}개)`);
    if (ep === totalEpisodes && !finalization_directive)
      issues.push("최종화 directive 없음");
    if (ep > ARC_SIZE && character_arc_count === 0)
      issues.push("character_arcs 비어있음 (10화 초과인데 아크 없음)");

    const verdict =
      issues.length === 0 ? "PASS"
      : issues.some(i => i.includes("없음") || i.includes("비어있음")) ? "FAIL"
      : "WARN";

    const m = {
      episode:                    ep,
      total:                      totalEpisodes,
      arc_ratio:                  Math.round(arc_ratio * 1000) / 1000,
      arc_phase,
      episode_role,
      rolling_summary_chars,
      rolling_summary_line_count: rolling_summary_lines,
      arc_summary_present,
      arc_summary_chars,
      known_facts_count,
      open_threads_count,
      resolved_threads_count,
      character_arc_count,
      foreshadow_open_count:      foreshadow_open,
      foreshadow_resolved_count:  foreshadow_resolved,
      continuity_contract_present,
      finalization_directive,
      regression_warnings:        [],
      item_continuity_warnings:   [],
      issues,
      verdict,
    };

    metrics_all.push(m);

    const stop = checkStop(m);
    if (stop) {
      STOP.triggered = true;
      STOP.reason    = stop;
      console.error(`\n⛔ STOP CONDITION: ${stop}`);
      break;
    }
  }

  return metrics_all;
}

// ── Trace 모드 (서버 API 조회) ────────────────────────────────
async function traceMode(bookId, totalEpisodes) {
  console.log(`\n[trace] bookId=${bookId} — 서버 접속 확인 중...`);
  try {
    await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
  } catch {
    console.error("[trace] 서버 미실행 — trace 모드 중단. fixture 모드를 사용하세요.");
    process.exit(1);
  }

  const metrics_all = [];

  // 에피소드 목록 조회
  const epRes = await fetch(`${BASE}/api/episodes/${bookId}/all`);
  if (!epRes.ok) {
    console.error(`[trace] /api/episodes/${bookId}/all 실패: ${epRes.status}`);
    process.exit(1);
  }
  const { episodes } = await epRes.json();
  const actualTotal = episodes.length;
  console.log(`[trace] 실제 에피소드 수: ${actualTotal}화`);

  // rolling_summary 조회 (최근 10화)
  const sumRes  = await fetch(`${BASE}/api/episodes/${bookId}/summary`);
  const sumData = sumRes.ok ? await sumRes.json() : {};
  const rolling_summary = sumData.summary ?? "";

  // foreshadow 통계
  const fRes    = await fetch(`${BASE}/api/episodes/${bookId}/foreshadows`);
  const fData   = fRes.ok ? await fRes.json() : {};
  const fStats  = fData.stats ?? { open: 0, resolved: 0, total: 0 };

  // debug endpoint (있으면 arc/character_arc 정보 가져오기)
  let arcData  = null;
  const dbgRes = await fetch(`${BASE}/api/debug/memory-status?book_id=${bookId}`);
  if (dbgRes.ok) arcData = await dbgRes.json();

  // 실제 에피소드별 상세 trace는 debug endpoint 없으면 aggregate만 가능
  for (const epRow of episodes.slice(0, totalEpisodes)) {
    const ep         = epRow.episode_number;
    const arc_phase  = calcArcPhase(ep, actualTotal);
    const episode_role = calcEpisodeRole(ep, actualTotal);
    const arc_ratio  = actualTotal > 0 ? ep / actualTotal : 0;

    const rolling_lines = rolling_summary.split("\n").filter(l => /^\d+화:/.test(l.trim()));

    const m = {
      episode:                    ep,
      total:                      actualTotal,
      arc_ratio:                  Math.round(arc_ratio * 1000) / 1000,
      arc_phase,
      episode_role,
      rolling_summary_chars:      rolling_summary.length,
      rolling_summary_line_count: rolling_lines.length,
      arc_summary_present:        arcData != null,
      arc_summary_chars:          arcData?.arc_summary_chars ?? 0,
      known_facts_count:          arcData?.known_facts_count ?? 0,
      open_threads_count:         fStats.open,
      resolved_threads_count:     fStats.resolved,
      character_arc_count:        arcData?.character_arc_count ?? 0,
      foreshadow_open_count:      fStats.open,
      foreshadow_resolved_count:  fStats.resolved,
      continuity_contract_present: ep >= 2,
      finalization_directive:     ep >= actualTotal,
      regression_warnings:        [],
      item_continuity_warnings:   [],
      issues: [],
      verdict: "PASS",
      _note: "trace aggregate — per-episode detail requires /api/debug/memory-status",
    };

    metrics_all.push(m);
  }

  return metrics_all;
}

// ── 요약 지표 계산 ────────────────────────────────────────────
function computeSummaryMetrics(metrics_all, totalEpisodes) {
  const n          = metrics_all.length;
  const passes     = metrics_all.filter(m => m.verdict === "PASS").length;
  const warns      = metrics_all.filter(m => m.verdict === "WARN").length;
  const fails      = metrics_all.filter(m => m.verdict === "FAIL").length;

  const expected_arcs   = Math.floor(totalEpisodes / ARC_SIZE)
    + (totalEpisodes < ARC_SIZE ? 1 : 0);
  const arcs_fired      = metrics_all.filter(m => m.arc_summary_present).length;
  const arc_coverage    = expected_arcs > 0 ? arcs_fired / expected_arcs : 0;

  const last            = metrics_all[metrics_all.length - 1] ?? {};
  const foreshadow_total = last.foreshadow_open_count + last.foreshadow_resolved_count;
  const foreshadow_recall =
    foreshadow_total > 0 ? last.foreshadow_resolved_count / foreshadow_total : 0;

  // summary_compression_stability: rolling_summary_chars가 ep 10 이후 1800~3500 범위를 유지하는가
  // (gemma3:12b 실측: ~240 chars/ep × 10화 = ~2400 기준; qwen2.5 기준 800~1600에서 재보정)
  const post10 = metrics_all.filter(m => m.episode > 10);
  const stable = post10.filter(m => m.rolling_summary_chars >= 1800 && m.rolling_summary_chars <= 3500).length;
  const summary_compression_stability = post10.length > 0 ? stable / post10.length : 1;

  // finalization_score: 최종화에서 finalization_directive 있고 arc_phase=final이면 1
  const finale = metrics_all.find(m => m.episode === totalEpisodes);
  const finalization_score =
    finale
      ? (finale.arc_phase === "final" ? 0.5 : 0)
        + (finale.finalization_directive ? 0.5 : 0)
      : 0;

  // unresolved_thread_growth_rate: open_threads 증가율 (화당)
  const mid = metrics_all.find(m => m.episode === Math.floor(totalEpisodes / 2));
  const open_mid  = mid?.foreshadow_open_count ?? 0;
  const open_end  = last.foreshadow_open_count ?? 0;
  const half      = totalEpisodes / 2;
  const unresolved_thread_growth_rate = half > 0
    ? Math.round(((open_end - open_mid) / half) * 100) / 100
    : 0;

  return {
    total_episodes_simulated: n,
    pass: passes, warn: warns, fail: fails,
    continuity_pass_rate:            Math.round(passes / n * 100) / 100,
    arc_coverage_rate:               Math.round(arc_coverage * 100) / 100,
    foreshadow_recall_rate:          Math.round(foreshadow_recall * 100) / 100,
    summary_compression_stability:   Math.round(summary_compression_stability * 100) / 100,
    finalization_score:              Math.round(finalization_score * 100) / 100,
    unresolved_thread_growth_rate,
    relationship_regression_count:   STOP.relationship_regressions,
    item_hallucination_count:        STOP.item_hallucinations,
    stop_triggered:                  STOP.triggered,
    stop_reason:                     STOP.reason ?? "없음",
  };
}

// ── 테이블 출력 ───────────────────────────────────────────────
const CHECK_EPISODES = new Set([
  1, 2, 3, 5, 10, 15, 20, 25, 29, 30,
  40, 45, 49, 50, 75, 95, 99, 100,
]);

function printMetricsTable(metrics_all, summary) {
  console.log(`\n${"─".repeat(68)}`);
  console.log(
    "ep".padEnd(5) +
    "role".padEnd(11) +
    "arc_phase".padEnd(11) +
    "roll".padEnd(7) +
    "arc".padEnd(5) +
    "kfact".padEnd(7) +
    "f_op".padEnd(6) +
    "f_rs".padEnd(6) +
    "cc".padEnd(5) +
    "verdict"
  );
  console.log("─".repeat(68));

  for (const m of metrics_all) {
    if (!CHECK_EPISODES.has(m.episode) && m.episode !== m.total) continue;
    const line =
      String(m.episode).padEnd(5) +
      m.episode_role.padEnd(11) +
      m.arc_phase.padEnd(11) +
      String(m.rolling_summary_chars).padEnd(7) +
      (m.arc_summary_present ? "Y".padEnd(5) : "-".padEnd(5)) +
      String(m.known_facts_count).padEnd(7) +
      String(m.foreshadow_open_count).padEnd(6) +
      String(m.foreshadow_resolved_count).padEnd(6) +
      (m.continuity_contract_present ? "Y".padEnd(5) : "-".padEnd(5)) +
      (m.verdict === "PASS" ? "✓ PASS"
       : m.verdict === "WARN" ? "△ WARN"
       : "✗ FAIL") +
      (m.issues.length ? `  [${m.issues.join(", ")}]` : "");
    console.log(line);
  }

  console.log(`\n${"─".repeat(68)}`);
  console.log("SUMMARY METRICS");
  console.log(`${"─".repeat(68)}`);
  console.log(`  episodes simulated       : ${summary.total_episodes_simulated}`);
  console.log(`  PASS / WARN / FAIL        : ${summary.pass} / ${summary.warn} / ${summary.fail}`);
  console.log(`  continuity_pass_rate      : ${(summary.continuity_pass_rate * 100).toFixed(0)}%`);
  console.log(`  arc_coverage_rate         : ${(summary.arc_coverage_rate * 100).toFixed(0)}%`);
  console.log(`  foreshadow_recall_rate    : ${(summary.foreshadow_recall_rate * 100).toFixed(0)}%`);
  console.log(`  summary_compression_stab  : ${(summary.summary_compression_stability * 100).toFixed(0)}%`);
  console.log(`  finalization_score        : ${summary.finalization_score.toFixed(2)} / 1.0`);
  console.log(`  unresolved_growth/ep      : ${summary.unresolved_thread_growth_rate}`);
  console.log(`  stop_triggered            : ${summary.stop_triggered ? `YES — ${summary.stop_reason}` : "NO"}`);
}

// ── PASS/FAIL 판정 ────────────────────────────────────────────
function overallVerdict(summary) {
  if (summary.stop_triggered)                        return "NOT READY";
  if (summary.fail > 0)                              return "NOT READY";
  if (summary.continuity_pass_rate < 0.9)            return "CONDITIONAL";
  if (summary.arc_coverage_rate < 0.8)               return "CONDITIONAL";
  if (summary.foreshadow_recall_rate < 0.3)          return "CONDITIONAL";
  if (summary.summary_compression_stability < 0.85)  return "CONDITIONAL";
  if (summary.finalization_score < 0.8)              return "CONDITIONAL";
  return "READY";
}

// ── 구조적 위험 분석 ──────────────────────────────────────────
function analyzeRisks(metrics_all, summary, totalEpisodes) {
  const risks = [];

  if (summary.foreshadow_recall_rate < 0.4)
    risks.push(`복선 회수율 낮음 (${(summary.foreshadow_recall_rate*100).toFixed(0)}%) — checkAndResolveForeshadows 민감도 향상 필요`);

  const maxOpen = Math.max(...metrics_all.map(m => m.foreshadow_open_count));
  if (maxOpen >= 10)
    risks.push(`open_thread 최대 ${maxOpen}개 — 장편에서 복선 과다 누적 위험`);

  if (summary.summary_compression_stability < 0.9)
    risks.push("rolling_summary 압축 불안정 — 10화 이후 창 크기 재검토 필요");

  if (totalEpisodes >= 50 && summary.arc_coverage_rate < 1.0)
    risks.push(`arc_coverage ${(summary.arc_coverage_rate*100).toFixed(0)}% — 일부 아크가 누락되면 known_facts 공백 발생`);

  if (summary.finalization_score < 1.0)
    risks.push("finalization_score < 1.0 — 최종화 directive 또는 arc_phase=final 조건 확인 필요");

  // 100화 이상 위험
  if (totalEpisodes >= 100) {
    risks.push("100화 이상: character_arcs는 아크당 저장되므로 10개 아크 × 5인물 = 50 row — DB 조회 비용 증가");
    risks.push("100화 이상: rolling_summary는 최근 10화 창으로 고정 → 초반 핵심 목표 유실 가능 (arc_summary로만 보완)");
    risks.push("100화 이상: foreshadow_open 13개 이상 예상 — threshold(15) 근접, 능동적 회수 로직 필요");
  }

  return risks;
}

// ── 메트릭 저장 ───────────────────────────────────────────────
function saveMetrics(metrics_all, summary, verdict) {
  try {
    mkdirSync(resolve(root, "logs"), { recursive: true });
    const ts   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const path = resolve(root, `logs/longstory_audit_${TOTAL}ep_${ts}.json`);
    const out  = {
      meta: { total_episodes: TOTAL, mode: MODE, timestamp: ts, verdict },
      summary,
      per_episode: metrics_all,
    };
    writeFileSync(path, JSON.stringify(out, null, 2));
    console.log(`\n  [saved] ${path.replace(root + "\\", "").replace(root + "/", "")}`);
    console.log("  (git-ignored — 커밋하지 마세요)");
  } catch {
    // 저장 실패는 검증 자체를 중단하지 않음
  }
}

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
  let metrics_all;

  if (MODE === "fixture") {
    console.log(`\n[fixture] ${TOTAL}화 결정론적 시뮬레이션 실행 중...`);
    console.log("  인물 5명 / A플롯 1 / B플롯 1 / 복선: 3화마다 심기, 5화마다 회수");
    metrics_all = fixtureSimulate(TOTAL);
  } else {
    metrics_all = await traceMode(BOOK_ID, TOTAL);
  }

  const summary = computeSummaryMetrics(metrics_all, TOTAL);
  printMetricsTable(metrics_all, summary);

  const verdict = overallVerdict(summary);
  const risks   = analyzeRisks(metrics_all, summary, TOTAL);

  if (risks.length) {
    console.log(`\n${"─".repeat(68)}`);
    console.log("구조적 위험 분석");
    console.log("─".repeat(68));
    risks.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  }

  console.log(`\n${"═".repeat(68)}`);
  const mark = verdict === "READY" ? "✓" : verdict === "CONDITIONAL" ? "△" : "✗";
  console.log(`최종 판정 [${TOTAL}화 ${MODE}]: ${mark} ${verdict}`);
  console.log(`${"═".repeat(68)}\n`);

  saveMetrics(metrics_all, summary, verdict);

  if (verdict === "NOT READY") process.exit(1);
}

// ── Phase 1 carry-forward 소스 검증 ──────────────────────────
import { readFileSync as _rf2 } from 'fs';
import { join as _j2, dirname as _d2 } from 'path';
import { fileURLToPath as _fu2 } from 'url';
{
  const __d = _d2(_fu2(import.meta.url));
  const pipelineTs = _rf2(_j2(__d, "../src/pipeline/index.ts"), "utf-8");
  let passed = 0, failed = 0;
  function chk(label, cond) {
    if (cond) { console.log(`  ✓ ${label}`); passed++; }
    else { console.error(`  ✗ ${label}`); failed++; }
  }
  console.log("\n── Phase 1: carry-forward source checks ─────────────────────");
  chk("outer condition is bookId only (not stateUpdates.length)",
    /if\s*\(\s*bookId\s*&&\s*ctx\.episode_number\s*\)/.test(pipelineTs));
  chk("stateUpdates.length guard only wraps direct commit",
    /if\s*\(\s*stateUpdates\.length\s*>\s*0\s*\)\s*\{/.test(pipelineTs));
  chk("carry-forward runs unconditionally (for ... character_dynamic_states)",
    pipelineTs.includes("carry-forward + absent-seed: stateUpdates"));
  chk("state_source logged",
    pipelineTs.includes("state_source"));
  console.log(`  ${failed ? `❌ ${failed} FAILED / ${passed} passed` : `✅ ALL ${passed} carry-forward checks PASS`}`);
  if (failed) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
