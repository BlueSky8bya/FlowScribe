/**
 * scripts/dpo_pair_collector_v2.ts — DPO Pair 수집 러너 v2
 *
 * 변경 사항:
 *  - 시나리오 6개 이상, 기본 20화 수집
 *  - filter v3: truncation/foreign-char/audit-complete/ee_score/judge_uncertainty/pp_penalty 검사 추가
 *  - items normalize: string[] / ItemEntry[] 모두 지원
 *  - chosen_model=27b가 되도록 A=12b(rejected 후보), B=27b(chosen 후보) 유지
 *  - savePair()에서 foreignCharFix, truncation, itemsNormalized, auditComplete 메타 저장
 *
 * 실행:
 *   npx tsx scripts/dpo_pair_collector_v2.ts
 *
 * 환경변수:
 *   DPO_SOURCE_BOOKS  — 쉼표 구분 source book ID 목록 (없으면 6개 기본값)
 *   DPO_EPISODES      — 화 수 (기본 20)
 *   DPO_MODEL_A       — rejected 후보 (기본 gemma3:12b)
 *   DPO_MODEL_B       — chosen 후보 (기본 gemma3:27b)
 *
 * filter_passed=TRUE 조건 (filter v3):
 *   1. score_delta >= 5
 *   2. chosen_verdict != FAIL
 *   3. both_fail이면 탈락
 *   4. chosen.povViolation && !rejected.povViolation → 탈락 (chosen_pov_worse)
 *   5. chosen 텍스트 truncation 감지 → 탈락
 *   6. chosen 텍스트 외국어 문자 검출 → 탈락 (foreign_char_contaminated)
 *   7. audit 미완료(computed_reward null) → 탈락
 *   8. renderer_trace null 또는 generated_text null → 탈락
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { randomUUID } from "crypto";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import {
  normalizeItems, detectForeignChars, detectTruncation,
  EE_MIN, JU_MAX, PP_MAX, MIN_SCORE_DELTA,
} from "./utils/dpo_utils.js";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const SERVER = "http://localhost:3000";

const MODEL_A  = process.env.DPO_MODEL_A  ?? "gemma3:12b";  // rejected 후보
const MODEL_B  = process.env.DPO_MODEL_B  ?? "gemma3:27b";  // chosen 후보
const PLANNER  = "gemma3:12b";
const EP_COUNT = parseInt(process.env.DPO_EPISODES ?? "20", 10);

// ItemEntry는 dpo_utils에서 re-export되므로 로컬 정의 제거
interface ItemEntry { name: string; condition?: string; }

// ── SSE 호출 ──────────────────────────────────────────────────────
interface SSEResult { success: boolean; elapsed_ms: number; error?: string; }

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
    setTimeout(() => {
      if (!finished) { finished = true; req.destroy(); resolve({ success: false, error: "timeout(10min)", elapsed_ms: Date.now() - t0 }); }
    }, 10 * 60 * 1000);
    req.write(bodyStr);
    req.end();
  });
}

// ── 책 복제 ──────────────────────────────────────────────────────
async function cloneBook(srcBookId: string, label: string): Promise<string> {
  const src = await pool.query("SELECT context, title FROM books WHERE id = $1", [srcBookId]);
  if (!src.rows.length) throw new Error(`Source book not found: ${srcBookId}`);
  const { context, title } = src.rows[0];
  const newId = randomUUID();
  await pool.query(
    `INSERT INTO books (id, user_id, title, context, current_episode, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, NOW(), NOW())`,
    [newId, USER_ID, `[DPOv2_${label}_${Date.now()}] ${title ?? label}`, JSON.stringify(context)],
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
  // canonical_characters 복제 — pipeline의 resolveCanonicalCharName이 올바른 이름 기준을 갖도록
  const canonChars = await pool.query(
    "SELECT name, gender, type, personality, initial_items FROM canonical_characters WHERE book_id = $1",
    [srcBookId],
  );
  for (const c of canonChars.rows) {
    await pool.query(
      `INSERT INTO canonical_characters (id, book_id, name, gender, type, personality, initial_items, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT DO NOTHING`,
      [randomUUID(), newId, c.name, c.gender, c.type, c.personality, JSON.stringify(c.initial_items ?? [])],
    );
  }
  // world_rules 복제 (있을 경우)
  const wRules = await pool.query(
    "SELECT rule_type, content FROM world_rules WHERE book_id = $1",
    [srcBookId],
  ).catch(() => ({ rows: [] as any[] }));
  for (const r of wRules.rows) {
    await pool.query(
      `INSERT INTO world_rules (id, book_id, rule_type, content, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING`,
      [randomUUID(), newId, r.rule_type, r.content],
    ).catch(() => {});
  }
  return newId;
}

// EE_MIN, JU_MAX, PP_MAX, MIN_SCORE_DELTA — dpo_utils에서 import됨

// ── TraceInfo ─────────────────────────────────────────────────────
interface TraceInfo {
  traceId: string;
  verdict: string | null;
  score: number | null;
  combinedReward: number | null;
  schemaVer: string | null;
  hardGateFailed: boolean | null;
  eeScore: number | null;
  judgeUncertainty: number | null;
  ppPenalty: number | null;
  povViolation: boolean;
  stateViolation: boolean;
  generatedText: string | null;
  hasAudit: boolean;
  hasRendererTrace: boolean;
  rendererMs: number | null;
  auditMs: number | null;
  planVerdict: string | null;
  traceModelUsed: string | null;
  itemsNormalized: string[];
  rawItemsFormat: "string" | "object" | "mixed" | "empty";
}

async function fetchLatestTrace(bookId: string, episode: number): Promise<TraceInfo | null> {
  const r = await pool.query(
    `SELECT
       trace_id::text,
       final_verdict,
       final_score,
       (computed_reward->>'combined_reward')::float combined_reward,
       computed_reward->>'reward_schema_version'              schema_ver,
       (computed_reward->'episode_extended'->>'hard_gate_failed')::boolean  hard_gate_failed,
       (computed_reward->'episode_extended'->>'episode_extended_score')::float ee_score,
       (computed_reward->'episode_extended'->>'judge_uncertainty')::float   judge_uncertainty,
       (computed_reward->'episode_extended'->>'postprocess_dependency_penalty')::float pp_penalty,
       prose_validation->'hard_violations' hard_viol,
       renderer_trace->>'generated_text' generated_text,
       renderer_trace IS NOT NULL has_renderer_trace,
       computed_reward IS NOT NULL has_audit,
       audit_elapsed_ms,
       total_elapsed_ms,
       renderer_trace->>'model_used' trace_model_used,
       plan_validation->>'verdict' plan_verdict,
       effective_context_snapshot->'character_dynamic_states' cds
     FROM run_traces
     WHERE book_id = $1 AND episode_number = $2
     ORDER BY created_at DESC LIMIT 1`,
    [bookId, episode],
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  const viols: any[] = row.hard_viol ?? [];

  // items 정규화
  let rawItemsFormat: TraceInfo["rawItemsFormat"] = "empty";
  const allItems: string[] = [];
  const cds = row.cds ?? {};
  for (const cs of Object.values(cds) as any[]) {
    const raw = cs?.items;
    if (!Array.isArray(raw) || !raw.length) continue;
    const isString = typeof raw[0] === "string";
    const isObj = typeof raw[0] === "object" && raw[0] !== null;
    if (rawItemsFormat === "empty") rawItemsFormat = isString ? "string" : "object";
    else if ((rawItemsFormat === "string" && !isString) || (rawItemsFormat === "object" && !isObj)) rawItemsFormat = "mixed";
    allItems.push(...normalizeItems(raw));
  }
  if (rawItemsFormat === "empty" && allItems.length === 0) rawItemsFormat = "empty";

  return {
    traceId: row.trace_id,
    verdict: row.final_verdict,
    score: row.final_score,
    combinedReward: row.combined_reward,
    schemaVer: row.schema_ver ?? null,
    hardGateFailed: row.hard_gate_failed ?? null,
    eeScore: row.ee_score ?? null,
    judgeUncertainty: row.judge_uncertainty ?? null,
    ppPenalty: row.pp_penalty ?? null,
    povViolation: viols.some((v: any) => (v.rule ?? "").match(/POV|시점/)),
    stateViolation: viols.some((v: any) => (v.rule ?? "").match(/상태|보존/)),
    generatedText: row.generated_text,
    hasAudit: !!row.has_audit,
    hasRendererTrace: !!row.has_renderer_trace,
    rendererMs: null,
    auditMs: row.audit_elapsed_ms ?? null,
    planVerdict: row.plan_verdict,
    traceModelUsed: row.trace_model_used,
    itemsNormalized: allItems,
    rawItemsFormat,
  };
}

// ── Pair 저장 (filter v3) ─────────────────────────────────────────
interface PairResult {
  filterPassed: boolean;
  filterReason: string | null;
  scoreDelta: number;
  chosenModel: string;
  foreignCharFix: boolean;
  truncationFlag: boolean;
  itemsFormatNormalized: boolean;
  auditComplete: boolean;
}

async function savePair(
  bookA: string,
  episode: number,
  trA: TraceInfo,
  trB: TraceInfo,
): Promise<PairResult> {
  const scoreA = trA.score ?? 0;
  const scoreB = trB.score ?? 0;
  const rawDelta = scoreB - scoreA;
  const chosenIsB = rawDelta >= 0;
  const chosen   = chosenIsB ? trB : trA;
  const rejected = chosenIsB ? trA : trB;
  const chosenModelName   = chosenIsB ? MODEL_B : MODEL_A;
  const rejectedModelName = chosenIsB ? MODEL_A : MODEL_B;
  const scoreDelta  = Math.abs(rawDelta);
  const rewardDelta = Math.abs((trB.combinedReward ?? 0) - (trA.combinedReward ?? 0));

  // ── filter v3 (임계값은 dpo_utils.EE_MIN/JU_MAX/PP_MAX) ────────
  const chosenText = chosen.generatedText ?? "";
  const foreignCharFix = detectForeignChars(chosenText);
  const truncationFlag = detectTruncation(chosenText);
  const auditComplete = chosen.hasAudit;
  const itemsFormatNormalized = chosen.rawItemsFormat !== "empty";

  let filterPassed = true;
  let filterReason: string | null = null;

  if (!chosen.hasRendererTrace || !chosenText) {
    filterPassed = false; filterReason = "renderer_trace_null";
  } else if (!auditComplete) {
    filterPassed = false; filterReason = "audit_incomplete";
  } else if (chosen.schemaVer !== "2.0") {
    filterPassed = false; filterReason = "v1_reward";
  } else if (chosen.hardGateFailed === true) {
    filterPassed = false; filterReason = "hard_gate_failed";
  } else if (scoreDelta < MIN_SCORE_DELTA) {
    filterPassed = false; filterReason = `score_delta_${scoreDelta.toFixed(1)}_below_${MIN_SCORE_DELTA}`;
  } else if (chosen.verdict === "FAIL" && rejected.verdict === "FAIL") {
    filterPassed = false; filterReason = "both_fail";
  } else if (chosen.verdict === "FAIL") {
    filterPassed = false; filterReason = "chosen_is_fail";
  } else if (chosen.povViolation && !rejected.povViolation) {
    filterPassed = false; filterReason = "chosen_pov_worse";
  } else if (truncationFlag) {
    filterPassed = false; filterReason = "chosen_truncated";
  } else if (foreignCharFix) {
    filterPassed = false; filterReason = "chosen_foreign_char";
  } else if (chosen.eeScore !== null && chosen.eeScore < EE_MIN) {
    filterPassed = false; filterReason = `ee_score_too_low_${chosen.eeScore.toFixed(3)}`;
  } else if (chosen.judgeUncertainty !== null && chosen.judgeUncertainty > JU_MAX) {
    filterPassed = false; filterReason = `high_judge_uncertainty_${chosen.judgeUncertainty.toFixed(3)}`;
  } else if (chosen.ppPenalty !== null && chosen.ppPenalty > PP_MAX) {
    filterPassed = false; filterReason = `postprocess_heavy_${chosen.ppPenalty.toFixed(3)}`;
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
      bookA, episode,
      chosen.traceId, chosenModelName, chosen.verdict, chosen.score, chosen.combinedReward,
      chosen.povViolation, chosen.stateViolation,
      rejected.traceId, rejectedModelName, rejected.verdict, rejected.score, rejected.combinedReward,
      rejected.povViolation, rejected.stateViolation,
      scoreDelta, rewardDelta, filterPassed, filterReason, PLANNER,
    ],
  );

  return { filterPassed, filterReason, scoreDelta, chosenModel: chosenModelName, foreignCharFix, truncationFlag, itemsFormatNormalized, auditComplete };
}

// ── 소스 북 (기본 6개 시나리오) ───────────────────────────────────
const USER_ID = "0720b196-e456-474e-85d1-f51473af9f68";

const DEFAULT_SOURCE_BOOKS = [
  { bookId: "7f8d321e-ac86-41c7-a409-dc98f5a3420e", label: "SF탐정" },
  { bookId: "a5de5090-9117-4b06-a7a0-03efbbd4dccf", label: "판타지모험" },
  { bookId: "1af6d8c4-e7d0-4abd-86fa-cc6465170060", label: "범죄스릴러" },
  { bookId: "b5ef8d70-0638-4db1-9509-cb164da558ab", label: "로맨스" },
  { bookId: "a5de5090-9117-4b06-a7a0-03efbbd4dccf", label: "판타지2" },  // 동일 장르 2회 — 다른 클론
  { bookId: "1af6d8c4-e7d0-4abd-86fa-cc6465170060", label: "스릴러2" },  // 동일 장르 2회 — 다른 클론
];

const SOURCE_BOOKS = process.env.DPO_SOURCE_BOOKS
  ? process.env.DPO_SOURCE_BOOKS.split(",").map(id => ({ bookId: id.trim(), label: id.trim() }))
  : DEFAULT_SOURCE_BOOKS;

// ── 진행바 유틸 ───────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  red: "\x1b[31m", blue: "\x1b[34m", magenta: "\x1b[35m",
  bgBlue: "\x1b[44m", bgGreen: "\x1b[42m",
};

function bar(done: number, total: number, width = 28): string {
  const pct = total > 0 ? done / total : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const inner = "█".repeat(filled) + "░".repeat(empty);
  const color = pct >= 0.8 ? C.green : pct >= 0.4 ? C.cyan : C.blue;
  return `${color}[${inner}]${C.reset} ${String(done).padStart(3)}/${total}`;
}

function elapsed(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

function eta(doneSteps: number, totalSteps: number, elapsedMs: number): string {
  if (doneSteps <= 0) return "--";
  const msPerStep = elapsedMs / doneSteps;
  const remaining = (totalSteps - doneSteps) * msPerStep;
  return elapsed(remaining);
}

let _statusLine = "";
function printStatus(line: string) {
  // 이전 상태 라인 덮어쓰기
  process.stdout.write(`\r\x1b[K${line}`);
  _statusLine = line;
}
function commitLine(line: string) {
  // 현재 상태 라인을 확정하고 개행
  process.stdout.write(`\r\x1b[K${line}\n`);
  _statusLine = "";
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  const startMs = Date.now();
  const TOTAL_GEN = SOURCE_BOOKS.length * EP_COUNT * 2; // Phase1 + Phase2
  let doneGen = 0;
  let lastEpMs = 0;

  // 헤더
  console.log(`\n${C.bold}╔══════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║   FlowScribe DPO Pair Collector v2               ║${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  시작   : ${new Date().toISOString()}`);
  console.log(`  모델 A : ${C.yellow}${MODEL_A}${C.reset} (rejected 후보)`);
  console.log(`  모델 B : ${C.green}${MODEL_B}${C.reset} (chosen 후보)`);
  console.log(`  플래너 : ${PLANNER}`);
  console.log(`  규모   : ${SOURCE_BOOKS.length}개 시나리오 × ${EP_COUNT}화 × 2모델 = ${C.bold}${TOTAL_GEN}회 생성${C.reset}`);
  console.log(`  목표   : usable pair ${C.bold}100개 이상${C.reset}\n`);

  const logDir = "c:/projects/FlowScribe/logs";
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = `${logDir}/dpo_collector_v2_${Date.now()}.jsonl`;
  const log: any[] = [];

  let totalPairs = 0;
  let passedPairs = 0;
  let chosen27bCount = 0;
  let chosen12bCount = 0;
  const filterReasonCount: Record<string, number> = {};

  // bookId 쌍 미리 생성
  const bookPairs: { src: typeof SOURCE_BOOKS[0]; bookA: string; bookB: string }[] = [];
  process.stdout.write(`${C.dim}[Init] 소스 북 복제 중...${C.reset}\n`);
  for (const src of SOURCE_BOOKS) {
    const bookA = await cloneBook(src.bookId, `A_${src.label}`);
    const bookB = await cloneBook(src.bookId, `B_${src.label}`);
    commitLine(`  ${C.dim}[${src.label}]${C.reset} A:${bookA.slice(0,8)}  B:${bookB.slice(0,8)}`);
    bookPairs.push({ src, bookA, bookB });
  }

  // ── Phase 1: A(12b) 전체 생성 ──
  console.log(`\n${C.bold}── Phase 1/3 ── ${C.yellow}${MODEL_A}${C.reset}${C.bold} renderer (rejected 후보)${C.reset}`);
  for (const [si, { src, bookA }] of bookPairs.entries()) {
    console.log(`  ${C.cyan}[${src.label}]${C.reset} (시나리오 ${si + 1}/${bookPairs.length})`);
    for (let ep = 1; ep <= EP_COUNT; ep++) {
      const t0 = Date.now();
      printStatus(`    ${bar(ep - 1, EP_COUNT, 20)} 화${ep} 생성 중...  전체 ${bar(doneGen, TOTAL_GEN, 16)}  ETA ${eta(doneGen, TOTAL_GEN, Date.now() - startMs)}`);
      const res = await consumeSSE(`${SERVER}/api/generate-v2`, {
        book_id: bookA, episode: ep, use_planner: true, enable_trace: true,
        validate: true, revise: false, planner_model: PLANNER, renderer_model: MODEL_A,
      });
      lastEpMs = Date.now() - t0;
      doneGen++;
      const status = res.success
        ? `${C.green}✓${C.reset} ${elapsed(lastEpMs)}`
        : `${C.red}✗ ${res.error}${C.reset}`;
      commitLine(`    ${bar(ep, EP_COUNT, 20)} 화${String(ep).padStart(2)} ${status}  전체 ${bar(doneGen, TOTAL_GEN, 16)}  ETA ${eta(doneGen, TOTAL_GEN, Date.now() - startMs)}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ── Phase 2: B(27b) 전체 생성 ──
  console.log(`\n${C.bold}── Phase 2/3 ── ${C.green}${MODEL_B}${C.reset}${C.bold} renderer (chosen 후보)${C.reset}`);
  for (const [si, { src, bookB }] of bookPairs.entries()) {
    console.log(`  ${C.cyan}[${src.label}]${C.reset} (시나리오 ${si + 1}/${bookPairs.length})`);
    for (let ep = 1; ep <= EP_COUNT; ep++) {
      const t0 = Date.now();
      printStatus(`    ${bar(ep - 1, EP_COUNT, 20)} 화${ep} 생성 중...  전체 ${bar(doneGen, TOTAL_GEN, 16)}  ETA ${eta(doneGen, TOTAL_GEN, Date.now() - startMs)}`);
      const res = await consumeSSE(`${SERVER}/api/generate-v2`, {
        book_id: bookB, episode: ep, use_planner: true, enable_trace: true,
        validate: true, revise: false, planner_model: PLANNER, renderer_model: MODEL_B,
      });
      lastEpMs = Date.now() - t0;
      doneGen++;
      const status = res.success
        ? `${C.green}✓${C.reset} ${elapsed(lastEpMs)}`
        : `${C.red}✗ ${res.error}${C.reset}`;
      commitLine(`    ${bar(ep, EP_COUNT, 20)} 화${String(ep).padStart(2)} ${status}  전체 ${bar(doneGen, TOTAL_GEN, 16)}  ETA ${eta(doneGen, TOTAL_GEN, Date.now() - startMs)}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ── Phase 3: Pair 매칭 및 저장 ──
  console.log(`\n${C.bold}── Phase 3/3 ── Pair 매칭 + filter v3 + dpo_pairs 저장${C.reset}`);
  const totalPairAttempts = bookPairs.length * EP_COUNT;
  let pairDone = 0;
  for (const { src, bookA, bookB } of bookPairs) {
    console.log(`  ${C.cyan}[${src.label}]${C.reset}`);
    for (let ep = 1; ep <= EP_COUNT; ep++) {
      const trA = await fetchLatestTrace(bookA, ep);
      const trB = await fetchLatestTrace(bookB, ep);
      pairDone++;

      if (!trA || !trB) {
        commitLine(`    화${String(ep).padStart(2)} ${C.dim}skip (trace missing A=${!!trA} B=${!!trB})${C.reset}  ${bar(pairDone, totalPairAttempts, 16)}`);
        continue;
      }

      const result = await savePair(bookA, ep, trA, trB);
      totalPairs++;
      if (result.filterPassed) {
        passedPairs++;
        if (result.chosenModel.includes("27b")) chosen27bCount++;
        else chosen12bCount++;
      }
      if (result.filterReason) {
        filterReasonCount[result.filterReason] = (filterReasonCount[result.filterReason] ?? 0) + 1;
      }

      const passRate = totalPairs > 0 ? (passedPairs / totalPairs * 100).toFixed(0) : "0";
      const passColor = passedPairs >= 100 ? C.green : passedPairs >= 50 ? C.yellow : C.dim;
      const flagStr = result.filterPassed
        ? `${C.green}PASS${C.reset}`
        : `${C.red}skip${C.reset}(${result.filterReason})`;
      const extras = [
        result.truncationFlag ? `${C.red}TRUNC${C.reset}` : null,
        result.foreignCharFix ? `${C.red}FOREIGN${C.reset}` : null,
        !result.auditComplete  ? `${C.yellow}NO_AUDIT${C.reset}` : null,
      ].filter(Boolean).join("|");

      commitLine(
        `    화${String(ep).padStart(2)} d=${result.scoreDelta.toFixed(1).padStart(5)} ${flagStr}` +
        ` chosen=${result.chosenModel.includes("27b") ? C.green : C.yellow}${result.chosenModel}${C.reset}` +
        ` A(${trA.verdict}/${trA.score ?? "?"}) B(${trB.verdict}/${trB.score ?? "?"})` +
        `${extras ? " [" + extras + "]" : ""}` +
        `  ${bar(pairDone, totalPairAttempts, 12)}` +
        `  ${passColor}usable ${passedPairs}${C.reset}(${passRate}%)`
      );

      log.push({
        scenario: src.label, episode: ep,
        a: { book_id: bookA, score: trA.score, verdict: trA.verdict, pov: trA.povViolation, items_format: trA.rawItemsFormat },
        b: { book_id: bookB, score: trB.score, verdict: trB.verdict, pov: trB.povViolation, items_format: trB.rawItemsFormat },
        ...result, ts: new Date().toISOString(),
      });
      fs.writeFileSync(logFile, log.map(x => JSON.stringify(x)).join("\n") + "\n");
    }
  }

  // ── 최종 요약 ──
  const totalMs = Date.now() - startMs;
  const passRate = totalPairs > 0 ? (passedPairs / totalPairs * 100).toFixed(1) : "0";
  const goal27b = totalPairs > 0 ? (chosen27bCount / Math.max(passedPairs, 1) * 100).toFixed(1) : "0";

  console.log(`\n${C.bold}╔══════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║   완료 ${new Date().toISOString().slice(0,19)}                 ║${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  소요 시간  : ${C.bold}${elapsed(totalMs)}${C.reset}`);
  console.log(`  총 pair    : ${totalPairs}`);
  const usableColor = passedPairs >= 100 ? C.green : passedPairs >= 50 ? C.yellow : C.red;
  console.log(`  usable     : ${usableColor}${C.bold}${passedPairs}개${C.reset} (${passRate}%)`);
  console.log(`  27b chosen : ${C.green}${chosen27bCount}${C.reset} / 12b chosen : ${C.yellow}${chosen12bCount}${C.reset}  (27b율 ${goal27b}%)`);
  if (Object.keys(filterReasonCount).length) {
    console.log(`  탈락 이유  :`);
    for (const [k, v] of Object.entries(filterReasonCount)) {
      console.log(`    ${C.dim}${k}${C.reset}: ${v}`);
    }
  }
  console.log(`  로그 파일  : ${C.dim}${logFile}${C.reset}`);

  if (passedPairs >= 100) {
    console.log(`\n${C.green}${C.bold}✓ 목표 달성! usable pair 100개 이상 확보됨.${C.reset}`);
    console.log(`  다음: ${C.cyan}npx tsx scripts/export_dpo_dataset_v2.ts${C.reset}`);
  } else {
    console.warn(`\n${C.red}${C.bold}✗ usable pair ${passedPairs}개 — 목표 미달.${C.reset}`);
    console.warn(`  DPO_EPISODES 늘리거나 추가 시나리오 필요.`);
    console.warn(`  현재 기준: DPO_EPISODES=${EP_COUNT}, 시나리오=${SOURCE_BOOKS.length}개`);
  }

  await pool.end();
}

main().catch(async (e) => { console.error("실패:", e.message); await pool.end(); process.exit(1); });
