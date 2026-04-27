/**
 * scripts/dpo_pair_collector.ts — DPO Pair 수집 러너
 *
 * 동일한 컨텍스트에서 renderer 모델만 다르게 두 번 생성하고
 * 결과를 비교해 dpo_pairs 테이블에 저장한다.
 *
 * 실행:
 *   npx tsx scripts/dpo_pair_collector.ts
 *
 * 환경변수:
 *   DPO_SOURCE_BOOKS  — 쉼표 구분 source book ID 목록 (없으면 기본값)
 *   DPO_EPISODES      — 화 수 (기본 5)
 *   DPO_MODEL_A       — rejected 후보 (기본 gemma3:12b)
 *   DPO_MODEL_B       — chosen 후보 (기본 gemma3:27b)
 *
 * 필터 규칙 (filter_passed=TRUE 조건):
 *   1. score_delta >= 5
 *   2. chosen의 POV 위반이 rejected 이하
 *   3. chosen_verdict != FAIL (단독 FAIL 허용 안 됨)
 *   예외: both_fail이면 탈락, score_delta 부족이면 탈락
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { randomUUID } from "crypto";
import * as http from "http";
import * as fs from "fs";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const SERVER = "http://localhost:3000";

const MODEL_A  = process.env.DPO_MODEL_A  ?? "gemma3:12b";
const MODEL_B  = process.env.DPO_MODEL_B  ?? "gemma3:27b";
const PLANNER  = "gemma3:12b";
const EP_COUNT = parseInt(process.env.DPO_EPISODES ?? "5", 10);
const MIN_SCORE_DELTA = 5;

const DEFAULT_SOURCE_BOOKS = [
  { bookId: "7f8d321e-ac86-41c7-a409-dc98f5a3420e", label: "SF탐정" },
  { bookId: "a5de5090-9117-4b06-a7a0-03efbbd4dccf", label: "판타지모험" },
  { bookId: "1af6d8c4-e7d0-4abd-86fa-cc6465170060", label: "범죄스릴러" },
];

const SOURCE_BOOKS = process.env.DPO_SOURCE_BOOKS
  ? process.env.DPO_SOURCE_BOOKS.split(",").map(id => ({ bookId: id.trim(), label: id.trim() }))
  : DEFAULT_SOURCE_BOOKS;

const USER_ID = "0720b196-e456-474e-85d1-f51473af9f68";

interface SSEResult {
  success: boolean;
  elapsed_ms: number;
  error?: string;
}

function consumeSSE(url: string, body: object): Promise<SSEResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const bodyStr = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: parseInt(urlObj.port) || 80,
      path: urlObj.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) },
    };

    let finished = false;
    let buffer = "";

    const req = http.request(options, (res) => {
      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.done === true && !finished) { finished = true; resolve({ success: true, elapsed_ms: Date.now() - t0 }); }
            if (json.error && !finished) { finished = true; resolve({ success: false, error: json.error, elapsed_ms: Date.now() - t0 }); }
          } catch { /* ignore */ }
        }
      });
      res.on("end", () => { if (!finished) { finished = true; resolve({ success: true, elapsed_ms: Date.now() - t0 }); } });
    });
    req.on("error", (err) => { if (!finished) { finished = true; resolve({ success: false, error: err.message, elapsed_ms: Date.now() - t0 }); } });
    setTimeout(() => { if (!finished) { finished = true; req.destroy(); resolve({ success: false, error: "timeout(10min)", elapsed_ms: Date.now() - t0 }); } }, 10 * 60 * 1000);
    req.write(bodyStr);
    req.end();
  });
}

async function cloneBook(srcBookId: string, label: string): Promise<string> {
  const src = await pool.query("SELECT context, title FROM books WHERE id = $1", [srcBookId]);
  if (!src.rows.length) throw new Error(`Source book not found: ${srcBookId}`);
  const { context, title } = src.rows[0];
  const newId = randomUUID();
  await pool.query(
    `INSERT INTO books (id, user_id, title, context, current_episode, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, NOW(), NOW())`,
    [newId, USER_ID, `[DPO_${label}_${Date.now()}] ${title ?? label}`, JSON.stringify(context)],
  );
  const chars = await pool.query(
    "SELECT name, gender, type, personality, role, source, extra FROM characters WHERE book_id = $1",
    [srcBookId],
  );
  for (const c of chars.rows) {
    await pool.query(
      `INSERT INTO characters (id, book_id, name, gender, type, personality, role, source, extra, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [randomUUID(), newId, c.name, c.gender, c.type, c.personality, c.role, c.source, c.extra],
    );
  }
  return newId;
}

interface TraceInfo {
  traceId: string;
  verdict: string | null;
  score: number | null;
  combinedReward: number | null;
  povViolation: boolean;
  stateViolation: boolean;
}

async function fetchLatestTrace(bookId: string, episode: number, _rendererModel: string): Promise<TraceInfo | null> {
  // book_id로만 조회 — bookA/bookB가 이미 모델을 구분함
  const r = await pool.query(
    `SELECT
       trace_id::text,
       final_verdict,
       final_score,
       (computed_reward->'breakdown'->>'combined_reward')::float combined_reward,
       prose_validation->'hard_violations' hard_viol
     FROM run_traces
     WHERE book_id = $1 AND episode_number = $2
     ORDER BY created_at DESC LIMIT 1`,
    [bookId, episode],
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  const viols: any[] = row.hard_viol ?? [];
  return {
    traceId: row.trace_id,
    verdict: row.final_verdict,
    score: row.final_score,
    combinedReward: row.combined_reward,
    povViolation: viols.some((v: any) => (v.rule ?? "").match(/POV|시점/)),
    stateViolation: viols.some((v: any) => (v.rule ?? "").match(/상태|보존/)),
  };
}

async function savePair(bookId: string, episode: number, trA: TraceInfo, trB: TraceInfo) {
  const scoreA = trA.score ?? 0;
  const scoreB = trB.score ?? 0;
  const rawDelta = scoreB - scoreA;      // 양수 = B가 나음
  const chosenIsB = rawDelta >= 0;
  const chosen   = chosenIsB ? trB : trA;
  const rejected = chosenIsB ? trA : trB;
  const chosenModelName   = chosenIsB ? MODEL_B : MODEL_A;
  const rejectedModelName = chosenIsB ? MODEL_A : MODEL_B;
  const scoreDelta  = Math.abs(rawDelta);
  const rewardDelta = Math.abs((trB.combinedReward ?? 0) - (trA.combinedReward ?? 0));

  let filterPassed = true;
  let filterReason: string | null = null;

  if (scoreDelta < MIN_SCORE_DELTA) {
    filterPassed = false; filterReason = `score_delta_${scoreDelta.toFixed(1)}_below_${MIN_SCORE_DELTA}`;
  } else if (chosen.verdict === "FAIL" && rejected.verdict === "FAIL") {
    filterPassed = false; filterReason = "both_fail";
  } else if (chosen.verdict === "FAIL") {
    filterPassed = false; filterReason = "chosen_is_fail";
  } else if (chosen.povViolation && !rejected.povViolation) {
    filterPassed = false; filterReason = "chosen_pov_worse";
  }

  await pool.query(
    `INSERT INTO dpo_pairs (
       book_id, episode_number,
       chosen_trace_id, chosen_model, chosen_verdict, chosen_score, chosen_reward,
       chosen_pov_violation, chosen_state_violation,
       rejected_trace_id, rejected_model, rejected_verdict, rejected_score, rejected_reward,
       rejected_pov_violation, rejected_state_violation,
       score_delta, reward_delta, filter_passed, filter_reason, planner_model
     ) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [
      bookId, episode,
      chosen.traceId, chosenModelName, chosen.verdict, chosen.score, chosen.combinedReward,
      chosen.povViolation, chosen.stateViolation,
      rejected.traceId, rejectedModelName, rejected.verdict, rejected.score, rejected.combinedReward,
      rejected.povViolation, rejected.stateViolation,
      scoreDelta, rewardDelta, filterPassed, filterReason, PLANNER,
    ],
  );

  return { filterPassed, filterReason, scoreDelta, chosenModel: chosenModelName };
}

async function main() {
  console.log("FlowScribe DPO Pair Collector");
  console.log("시작:", new Date().toISOString());
  console.log(`A(rejected_후보)=${MODEL_A}  B(chosen_후보)=${MODEL_B}  planner=${PLANNER}`);
  console.log(`소스: ${SOURCE_BOOKS.length}개 시나리오 × ${EP_COUNT}화`);
  console.log(`전략: A 전체 먼저(12b 유지) → B 전체 나중(27b 유지) — 모델 스왑 2회로 최소화\n`);

  const logFile = `c:/projects/FlowScribe/logs/dpo_collector_${Date.now()}.jsonl`;
  const log: any[] = [];
  let totalPairs = 0, passedPairs = 0;

  // bookId 쌍을 미리 생성
  const bookPairs: { src: typeof SOURCE_BOOKS[0]; bookA: string; bookB: string }[] = [];
  for (const src of SOURCE_BOOKS) {
    const bookA = await cloneBook(src.bookId, `A_${src.label}`);
    const bookB = await cloneBook(src.bookId, `B_${src.label}`);
    console.log(`  [${src.label}] bookA=${bookA.slice(0, 8)}  bookB=${bookB.slice(0, 8)}`);
    bookPairs.push({ src, bookA, bookB });
  }

  // ── Phase 1: 모든 A(12b) 생성 ── 12b가 VRAM에 지속 유지
  console.log(`\n[Phase 1] ${MODEL_A} renderer — 전 시나리오 A 생성`);
  for (const { src, bookA } of bookPairs) {
    console.log(`  시나리오: ${src.label}`);
    for (let ep = 1; ep <= EP_COUNT; ep++) {
      process.stdout.write(`    화 ${ep}/${EP_COUNT} ... `);
      const res = await consumeSSE(`${SERVER}/api/generate-v2`, {
        book_id: bookA, episode: ep, use_planner: true, enable_trace: true,
        validate: true, revise: false, planner_model: PLANNER, renderer_model: MODEL_A,
      });
      console.log(res.success ? `ok(${Math.round(res.elapsed_ms / 1000)}s)` : `FAIL(${res.error})`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ── Phase 2: 모든 B(27b) 생성 ── 27b가 VRAM에 지속 유지
  console.log(`\n[Phase 2] ${MODEL_B} renderer — 전 시나리오 B 생성`);
  for (const { src, bookB } of bookPairs) {
    console.log(`  시나리오: ${src.label}`);
    for (let ep = 1; ep <= EP_COUNT; ep++) {
      process.stdout.write(`    화 ${ep}/${EP_COUNT} ... `);
      const res = await consumeSSE(`${SERVER}/api/generate-v2`, {
        book_id: bookB, episode: ep, use_planner: true, enable_trace: true,
        validate: true, revise: false, planner_model: PLANNER, renderer_model: MODEL_B,
      });
      console.log(res.success ? `ok(${Math.round(res.elapsed_ms / 1000)}s)` : `FAIL(${res.error})`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ── Phase 3: Pair 매칭 및 저장 ──
  console.log(`\n[Phase 3] Pair 매칭 및 dpo_pairs 저장`);
  for (const { src, bookA, bookB } of bookPairs) {
    console.log(`  시나리오: ${src.label}`);
    for (let ep = 1; ep <= EP_COUNT; ep++) {
      const trA = await fetchLatestTrace(bookA, ep, MODEL_A);
      const trB = await fetchLatestTrace(bookB, ep, MODEL_B);

      if (!trA || !trB) {
        console.log(`    화 ${ep}: skip(trace missing A=${!!trA} B=${!!trB})`);
        continue;
      }

      const result = await savePair(bookA, ep, trA, trB);
      totalPairs++;
      if (result.filterPassed) passedPairs++;

      const flag = result.filterPassed ? "PASS" : `skip(${result.filterReason})`;
      console.log(`    화 ${ep}: d=${result.scoreDelta.toFixed(1)} ${flag} chosen=${result.chosenModel} A(${trA.verdict}/${trA.score}) B(${trB.verdict}/${trB.score})`);

      log.push({
        scenario: src.label, episode: ep,
        a: { book_id: bookA, score: trA.score, verdict: trA.verdict, pov: trA.povViolation },
        b: { book_id: bookB, score: trB.score, verdict: trB.verdict, pov: trB.povViolation },
        ...result, ts: new Date().toISOString(),
      });
      fs.writeFileSync(logFile, log.map(x => JSON.stringify(x)).join("\n") + "\n");
    }
  }

  console.log(`\n== 완료: ${new Date().toISOString()} ==`);
  console.log(`총 pair: ${totalPairs}  필터 통과: ${passedPairs}개 (${totalPairs > 0 ? (passedPairs/totalPairs*100).toFixed(0) : 0}%)`);
  console.log(`로그: ${logFile}`);
  console.log("다음: npx tsx scripts/export_dpo_dataset.ts");

  await pool.end();
}

main().catch(async (e) => { console.error("실패:", e.message); await pool.end(); process.exit(1); });
