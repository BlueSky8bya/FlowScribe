/**
 * run_30ep_trace.mjs
 * 30화 actual trace 실행 스크립트
 *
 * 동작:
 *  1. test_fantasy_B 테스트북 + 인물 세팅 확인
 *  2. 테스트 유저 JWT 발급
 *  3. 에피소드 1~30 순차 생성 (SSE 수집)
 *  4. 화마다 DB에서 memory 상태 수집
 *  5. 중단 조건 체크
 *  6. tracking/ 폴더에 메트릭 저장
 *
 * 실행:
 *   node scripts/run_30ep_trace.mjs [--from N] [--to M] [--dry-run]
 *   --from N  : N화부터 시작 (재개용, 기본 1)
 *   --to M    : M화까지 생성 (기본 30)
 *   --dry-run : DB/API 호출 없이 설정만 확인
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import IORedis from "ioredis";
import jwt from "jsonwebtoken";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, "..");

// CLI
const args    = process.argv.slice(2);
const getArg  = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const FROM_EP = parseInt(getArg("--from") ?? "1",  10);
const TO_EP   = parseInt(getArg("--to")   ?? "30", 10);
const DRY_RUN = args.includes("--dry-run");
const BASE    = "http://localhost:3000";

// DB/Redis 연결
const pool  = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://flowscribe:flowscribe@localhost:5432/flowscribe" });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

// 테스트북 설정
const BOOK_ID = "test_fantasy_B";
const USER_ID = "efd847a1-79c7-47c5-a020-da37875efb0f";
const JWT_SECRET = process.env.JWT_SECRET ?? "asdflidjsfoieflkasdfaALKSDJFDdfDFdf452";

const WORLD_BIBLE = {
  world_rules: ["마법 사용 시 체력 소모", "엘프는 불 마법 사용 불가", "전쟁 중인 세계"],
  character_defaults: {
    "아르넬": { type: "엘프", gender: "남성", description: "마법사, 오만함, 강력함", initial_items: ["마법 지팡이", "엘프 망토"] },
    "세라":   { type: "인간", gender: "여성", description: "전사, 용감함, 상처 있음", initial_items: ["검", "방패"] },
    "크로그": { type: "드워프", gender: "남성", description: "대장장이, 충직함, 실용적", initial_items: ["전투 도끼", "수리 도구"] },
    "발루르": { type: "마족", gender: "남성", description: "적장, 잔인함, 강함", initial_items: ["암흑 검"] },
  },
  forbidden_settings: ["아군끼리 살상", "마법으로 즉사"],
  story_config: {
    totalEpisodes: 30, totalEpisodesVar: 0,
    pov: "3인칭 관찰자", style: "균형",
    episodeLength: 900, episodeLengthVar: 200,
    conflict: 8, foreshadow: 6, emotion: 7, dialogue: 6, direction: 8,
  },
};

// 중단 조건 상태
const STOP = { consecutive_fails: 0, relationship_regressions: 0, item_hallucinations: 0, triggered: false, reason: null };

// ── arc_phase / episode_role (state_extractor.ts 기준 복제) ──
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
  const ratio = ep / total;
  if (ep >= total)    return "final";
  if (remaining <= 1) return "pre-final";
  if (remaining <= 5) return "late";
  if (ratio < 0.15)   return "intro";
  if (ratio < 0.35)   return "early";
  return "mid";
}

// ── 유틸 ─────────────────────────────────────────────────────
function makeJwt() {
  return jwt.sign(
    { id: USER_ID, email: "test@flowscribe.test", displayName: "trace-tester", picture: "" },
    JWT_SECRET,
    { expiresIn: "1d" }
  );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ensureTrackingDir() {
  const ts  = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  const dir = resolve(root, `tracking/story_memory_audit/${ts}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── 인물 DB 세팅 ──────────────────────────────────────────────
async function ensureCharacters() {
  const existing = await pool.query(
    `SELECT name FROM canonical_characters WHERE book_id = $1`,
    [BOOK_ID]
  );
  const names = existing.rows.map(r => r.name);
  for (const [name, info] of Object.entries(WORLD_BIBLE.character_defaults)) {
    if (names.includes(name)) continue;
    await pool.query(
      `INSERT INTO canonical_characters (book_id, name, type, gender, personality, initial_items, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (book_id, name) DO NOTHING`,
      [BOOK_ID, name, info.type, info.gender, info.description, JSON.stringify(info.initial_items ?? [])]
    );
    console.log(`  [setup] 인물 등록: ${name}`);
  }
}

// ── Redis context 세팅 ────────────────────────────────────────
async function ensureContext() {
  const key = `context:${BOOK_ID}`;
  const existing = await redis.get(key);
  if (!existing) {
    await redis.set(key, JSON.stringify(WORLD_BIBLE));
    console.log(`  [setup] Redis context 세팅: ${key}`);
  }
}

// ── SSE 수집 ─────────────────────────────────────────────────
async function generateEpisode(episode, token) {
  const url = `${BASE}/api/generate?book_id=${BOOK_ID}&episode=${episode}&use_planner=true`;
  const t0  = Date.now();
  let fullText  = "";
  let charState = null;
  let errorOccurred = false;
  let errorMsg  = "";

  try {
    const res = await fetch(url, {
      headers: {
        Cookie: `fs_token=${token}`,
        Accept: "text/event-stream",
      },
      signal: AbortSignal.timeout(300_000), // 5분 타임아웃
    });

    if (!res.ok) {
      errorOccurred = true;
      errorMsg = `HTTP ${res.status}: ${await res.text()}`;
      return { ok: false, error: errorMsg, elapsed_ms: Date.now() - t0, fullText: "" };
    }

    // SSE 스트림 읽기
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.token) {
            fullText += payload.token;
            process.stdout.write(".");
          }
          if (payload.done) {
            charState = payload.char_states ?? null;
          }
          if (payload.error) {
            errorOccurred = true;
            errorMsg = payload.error;
          }
        } catch { /* 파싱 실패 무시 */ }
      }
    }
  } catch (err) {
    errorOccurred = true;
    errorMsg = String(err);
  }

  const elapsed_ms = Date.now() - t0;
  process.stdout.write("\n");

  return {
    ok: !errorOccurred && fullText.length > 100,
    error: errorMsg || null,
    text_chars: fullText.length,
    text_preview: fullText.slice(0, 80).replace(/\n/g, " "),
    char_states: charState,
    elapsed_ms,
    fullText,
  };
}

// ── POST /api/episodes — summary/foreshadow/arc 후처리 트리거 ─
async function triggerEpisodePostProcess(episode, content, token) {
  try {
    const res = await fetch(`${BASE}/api/episodes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `fs_token=${token}`,
      },
      body: JSON.stringify({ book_id: BOOK_ID, episode_number: episode, content }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── DB에서 메모리 상태 수집 ───────────────────────────────────
async function collectDbMetrics(episode) {
  const [epRow, sumRows, fStats, arcRows, charArcRows, dynRows, snapRow] = await Promise.all([
    // 현재 화 저장 확인
    pool.query(
      `SELECT episode_number, length(content) AS content_chars, length(summary) AS summary_chars, summary
       FROM episodes WHERE book_id=$1 AND episode_number=$2`,
      [BOOK_ID, episode]
    ),
    // rolling_summary (최근 10화)
    pool.query(
      `SELECT episode_number, summary FROM episodes
       WHERE book_id=$1 AND episode_number <= $2 ORDER BY episode_number DESC LIMIT 10`,
      [BOOK_ID, episode]
    ),
    // foreshadow 통계
    pool.query(
      `SELECT status, count(*)::int AS cnt FROM foreshadows WHERE book_id=$1 GROUP BY status`,
      [BOOK_ID]
    ),
    // arc summaries
    pool.query(
      `SELECT arc_number, episode_start, episode_end, length(summary) AS summary_chars,
              jsonb_array_length(key_events) AS key_event_count
       FROM arc_summaries WHERE book_id=$1 ORDER BY arc_number`,
      [BOOK_ID]
    ),
    // character arcs
    pool.query(
      `SELECT DISTINCT ON (character_name) character_name, arc_number, state,
              jsonb_array_length(key_events) AS key_event_count
       FROM character_arcs WHERE book_id=$1 ORDER BY character_name, arc_number DESC`,
      [BOOK_ID]
    ),
    // dynamic states
    pool.query(
      `SELECT DISTINCT ON (character_name) character_name, emotional_state, recent_goal, episode_number
       FROM character_dynamic_states WHERE book_id=$1 ORDER BY character_name, episode_number DESC`,
      [BOOK_ID]
    ),
    // run_trace (for arc_phase, episode_role, continuity_contract)
    // saveEpisodeSnapshot은 generate_v2에서만 호출됨; 메인 generate는 run_traces에 저장
    pool.query(
      `SELECT effective_context_snapshot FROM run_traces
       WHERE book_id=$1 AND episode_number=$2 ORDER BY created_at DESC LIMIT 1`,
      [BOOK_ID, episode]
    ),
  ]);

  const fCounts = {};
  for (const r of fStats.rows) fCounts[r.status] = r.cnt;
  const f_open     = fCounts["open"]     ?? 0;
  const f_resolved = fCounts["resolved"] ?? 0;
  const f_total    = f_open + f_resolved + (fCounts["abandoned"] ?? 0);

  const rollingSummaryRows = [...sumRows.rows].reverse();
  const rollingSummary = rollingSummaryRows.map(r => `${r.episode_number}화: ${r.summary}`).join("\n");
  const rollingSummaryChars = rollingSummary.length;
  const hasEmptySummary = sumRows.rows.some(r => !r.summary || r.summary.trim().length < 10);

  const arcSummaryPresent = arcRows.rows.some(r => r.episode_end === episode);

  const snap = snapRow.rows[0]?.effective_context_snapshot ?? null;
  const cc   = snap?.continuity_contract ?? null;
  const epSummary = epRow.rows[0] ?? null;

  // narrative_contract는 run_traces에 저장 안됨 → gen_config에서 직접 계산
  const totalEp = snap?.gen_config?.totalEpisodes ?? 30;
  const arc_phase    = calcArcPhase(episode, totalEp);
  const episode_role = calcEpisodeRole(episode, totalEp);
  const arc_ratio    = totalEp > 0 ? Math.round(episode / totalEp * 1000) / 1000 : 0;

  // known_facts count from run_traces cc
  const kf = cc?.known_facts;
  const knownFactsCount = Array.isArray(kf) ? kf.length : 0;
  const openThreads     = Array.isArray(cc?.open_threads) ? cc.open_threads.length : 0;
  const forbiddenRegs   = Array.isArray(cc?.forbidden_regressions) ? cc.forbidden_regressions.length : 0;

  return {
    episode,
    episode_saved:          !!epSummary,
    content_chars:          epSummary?.content_chars ?? 0,
    summary_chars:          epSummary?.summary_chars ?? 0,
    summary_preview:        (epSummary?.summary ?? "").slice(0, 60),
    rolling_summary_chars:  rollingSummaryChars,
    rolling_summary_lines:  rollingSummaryRows.length,
    rolling_has_empty:      hasEmptySummary,
    arc_summary_present:    arcSummaryPresent,
    arc_summary_count:      arcRows.rows.length,
    arc_summaries:          arcRows.rows.map(r => ({ arc: r.arc_number, chars: r.summary_chars, key_events: r.key_event_count })),
    character_arc_count:    charArcRows.rows.length,
    character_arcs:         charArcRows.rows.map(r => ({ name: r.character_name, arc: r.arc_number, key_events: r.key_event_count })),
    dynamic_state_count:    dynRows.rows.length,
    dynamic_states:         dynRows.rows.map(r => ({ name: r.character_name, goal: r.recent_goal?.slice(0, 30) ?? null, emotion: r.emotional_state?.slice(0, 20) ?? null })),
    foreshadow_open:        f_open,
    foreshadow_resolved:    f_resolved,
    foreshadow_total:       f_total,
    continuity_contract_present: !!cc,
    known_facts_count:      knownFactsCount,
    open_threads_count:     openThreads,
    forbidden_regressions_count: forbiddenRegs,
    episode_role,
    arc_phase,
    arc_ratio,
    finalization_directive: episode >= totalEp,
  };
}

// ── 중단 조건 체크 ────────────────────────────────────────────
function checkStop(m, genResult) {
  if (!genResult.ok) STOP.consecutive_fails++;
  else STOP.consecutive_fails = 0;

  if (STOP.consecutive_fails >= 3)
    return `3화 연속 생성 FAIL (ep${m.episode})`;
  if (m.foreshadow_open >= 15 && m.foreshadow_resolved === 0)
    return `open_thread 15개 이상 + resolved 0 (ep${m.episode})`;
  if (m.rolling_has_empty && m.episode >= 3)
    return `rolling_summary 빈값 감지 (ep${m.episode})`;
  if (m.episode >= 10 && m.arc_summary_count === 0)
    return `10화 이후 arc_summary 없음 (ep${m.episode})`;
  if (m.episode === 30 && !m.finalization_directive)
    return `최종화(30화) finalization directive 없음`;
  return null;
}

// ── verdict 판정 ─────────────────────────────────────────────
function verdict(m, genResult) {
  if (!genResult.ok) return "FAIL";
  const issues = [];
  // cc: ep3 이후부터 기대 (ep2는 ep1 summary가 비동기라 아직 없을 수 있음)
  if (m.episode >= 3 && !m.continuity_contract_present) issues.push("cc없음");
  if (m.episode >= 3 && m.known_facts_count === 0 && m.rolling_summary_chars < 50)
    issues.push("known_facts=0+rolling_empty");
  if (m.episode >= 10 && m.character_arc_count === 0)   issues.push("no_char_arcs(ep10+)");
  if (issues.length === 0) return "PASS";
  if (issues.some(i => i.includes("없음") || i.includes("empty"))) return "FAIL";
  return "WARN";
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(68)}`);
  console.log(`30화 ACTUAL TRACE — ${BOOK_ID} | ep${FROM_EP}~ep${TO_EP}${DRY_RUN ? " [DRY-RUN]" : ""}`);
  console.log("모델: gemma3:12b (planner/renderer/summary)");
  console.log(`${"═".repeat(68)}`);

  if (DRY_RUN) {
    console.log("\n[dry-run] 설정 확인:");
    console.log("  BOOK_ID:", BOOK_ID);
    console.log("  USER_ID:", USER_ID);
    console.log("  story_config:", JSON.stringify(WORLD_BIBLE.story_config));
    console.log("  characters:", Object.keys(WORLD_BIBLE.character_defaults).join(", "));
    await pool.end(); redis.disconnect();
    return;
  }

  // 초기 세팅
  console.log("\n[init] 테스트북 세팅 확인...");
  await ensureContext();
  await ensureCharacters();

  const token   = makeJwt();
  const trackDir = ensureTrackingDir();
  const allMetrics = [];

  console.log(`[init] tracking dir: ${trackDir.replace(root + "\\", "")}`);
  console.log(`[init] JWT 발급 완료`);

  // 기존 에피소드 수 확인 (재개용)
  const existingEps = await pool.query(
    `SELECT episode_number FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
    [BOOK_ID]
  );
  const existingNums = new Set(existingEps.rows.map(r => r.episode_number));
  if (existingNums.size > 0) {
    console.log(`[init] 기존 에피소드: ${[...existingNums].join(", ")}화`);
  }

  console.log(`\n${"─".repeat(68)}`);
  console.log("ep   생성     chars  시간    cc  kf   f_op f_rs arc  role        verdict");
  console.log("─".repeat(68));

  for (let ep = FROM_EP; ep <= TO_EP; ep++) {
    process.stdout.write(`${String(ep).padEnd(5)}`);

    // 이미 존재하는 화는 생성 스킵하고 DB 메트릭만 수집
    let genResult;
    if (existingNums.has(ep)) {
      process.stdout.write("(skip) ");
      genResult = { ok: true, text_chars: 0, elapsed_ms: 0, error: null, text_preview: "(existing)", fullText: "" };
    } else {
      process.stdout.write("→ ");
      genResult = await generateEpisode(ep, token);
      if (genResult.ok) {
        existingNums.add(ep);
        // POST /api/episodes 로 summary/foreshadow/arc 후처리 트리거
        // generate.ts auto-save는 DB에 직접 쓰지만 setImmediate 후처리를 트리거하지 않음
        const posted = await triggerEpisodePostProcess(ep, genResult.fullText, token);
        if (!posted) process.stdout.write("[warn: episodes post failed] ");
      }
    }

    // DB 메트릭 수집 — 비동기 후처리(summary LLM, foreshadow, arc) 완료 대기
    // arc 완료(ep10,20,30): arc summary LLM + character_arcs LLM → 60초
    // 일반 화: summary LLM + foreshadow check → 15초
    const waitMs = (ep % 10 === 0) ? 60_000 : 15_000;
    process.stdout.write(`[wait ${waitMs/1000}s...]`);
    await sleep(waitMs);
    const m = await collectDbMetrics(ep);
    const v = verdict(m, genResult);

    // 테이블 출력
    const statusMark = v === "PASS" ? "✓" : v === "WARN" ? "△" : "✗";
    console.log(
      String(genResult.text_chars || m.content_chars).padEnd(7) +
      `${Math.round(genResult.elapsed_ms / 1000)}s`.padEnd(8) +
      (m.continuity_contract_present ? "Y" : "-").padEnd(4) +
      String(m.known_facts_count).padEnd(5) +
      String(m.foreshadow_open).padEnd(5) +
      String(m.foreshadow_resolved).padEnd(5) +
      (m.arc_summary_present ? "Y" : "-").padEnd(5) +
      m.episode_role.padEnd(12) +
      `${statusMark} ${v}`
    );

    const entry = {
      ...m,
      gen_ok:       genResult.ok,
      gen_chars:    genResult.text_chars,
      gen_elapsed_ms: genResult.elapsed_ms,
      gen_error:    genResult.error,
      gen_preview:  genResult.text_preview,
      verdict:      v,
    };
    allMetrics.push(entry);

    // 중단 조건 체크
    const stopReason = checkStop(m, genResult);
    if (stopReason) {
      STOP.triggered = true;
      STOP.reason = stopReason;
      console.error(`\n⛔ STOP: ${stopReason}`);
      break;
    }

    // 에피소드 간 간격 (모델 과부하 방지)
    if (ep < TO_EP) await sleep(800);
  }

  // ── 요약 메트릭 ────────────────────────────────────────────
  const n          = allMetrics.length;
  const passes     = allMetrics.filter(m => m.verdict === "PASS").length;
  const warns      = allMetrics.filter(m => m.verdict === "WARN").length;
  const fails      = allMetrics.filter(m => m.verdict === "FAIL").length;
  const totalSecs  = Math.round(allMetrics.reduce((a, m) => a + (m.gen_elapsed_ms ?? 0), 0) / 1000);
  const avgSecs    = n > 0 ? Math.round(totalSecs / n) : 0;

  const lastM      = allMetrics[allMetrics.length - 1] ?? {};
  const fTotal     = lastM.foreshadow_total ?? 0;
  const fRecall    = fTotal > 0 ? Math.round(lastM.foreshadow_resolved / fTotal * 100) : 0;
  const arcCoverage = allMetrics.filter(m => m.arc_summary_present).length;

  console.log(`\n${"─".repeat(68)}`);
  console.log("SUMMARY");
  console.log(`${"─".repeat(68)}`);
  console.log(`  에피소드 수            : ${n}/${TO_EP - FROM_EP + 1}`);
  console.log(`  PASS / WARN / FAIL     : ${passes} / ${warns} / ${fails}`);
  console.log(`  continuity_pass_rate   : ${n > 0 ? Math.round(passes / n * 100) : 0}%`);
  console.log(`  arc coverage (triggers): ${arcCoverage}회`);
  console.log(`  foreshadow_recall_rate : ${fRecall}%`);
  console.log(`  총 생성 시간           : ${totalSecs}초 (화당 평균 ${avgSecs}초)`);
  console.log(`  stop_triggered         : ${STOP.triggered ? `YES — ${STOP.reason}` : "NO"}`);

  // 30화 최종화 확인
  const finale = allMetrics.find(m => m.episode === 30);
  if (finale) {
    console.log(`\n  [30화 최종화]`);
    console.log(`    episode_role         : ${finale.episode_role}`);
    console.log(`    arc_phase            : ${finale.arc_phase}`);
    console.log(`    finalization_dir     : ${finale.finalization_directive ? "YES" : "NO"}`);
    console.log(`    open_threads         : ${finale.foreshadow_open}`);
    console.log(`    resolved_threads     : ${finale.foreshadow_resolved}`);
    console.log(`    char_arcs            : ${finale.character_arc_count}`);
    console.log(`    gen_ok               : ${finale.gen_ok}`);
  }

  // 전체 판정
  const overallVerdict =
    STOP.triggered || fails > 0           ? "NOT READY"
    : passes / n < 0.9                    ? "CONDITIONAL"
    : lastM.episode < 30                  ? "CONDITIONAL"
    : fRecall < 20                        ? "CONDITIONAL"
    : !finale?.finalization_directive     ? "CONDITIONAL"
    : "READY";

  console.log(`\n${"═".repeat(68)}`);
  const mark = overallVerdict === "READY" ? "✓" : overallVerdict === "CONDITIONAL" ? "△" : "✗";
  console.log(`최종 판정 [30화 trace]: ${mark} ${overallVerdict}`);
  console.log(`${"═".repeat(68)}\n`);

  // ── 결과 저장 ────────────────────────────────────────────
  const summary = {
    book_id: BOOK_ID, total_episodes: TO_EP, generated: n,
    verdict: overallVerdict, stop_triggered: STOP.triggered, stop_reason: STOP.reason,
    passes, warns, fails, continuity_pass_rate: n > 0 ? passes / n : 0,
    arc_coverage: arcCoverage, foreshadow_recall_rate: fRecall / 100,
    total_time_sec: totalSecs, avg_time_per_ep_sec: avgSecs,
    timestamp: new Date().toISOString(),
  };

  writeFileSync(
    resolve(trackDir, "metrics_30.json"),
    JSON.stringify({ summary, per_episode: allMetrics }, null, 2)
  );
  console.log(`  [saved] ${trackDir.replace(root + "\\", "").replace(root + "/", "")}/metrics_30.json`);
  console.log("  (tracking/ 폴더 — git-ignored)");

  await pool.end();
  redis.disconnect();
}

main().catch(err => { console.error(err); pool.end(); redis.disconnect(); process.exit(1); });
