/**
 * scripts/export_dpo_dataset_v2.ts — DPO 학습 데이터 JSONL 추출 v2
 *
 * dpo_pairs 테이블에서 filter_passed=TRUE인 pair를 읽고
 * run_traces의 renderer_trace.system_prompt + user_prompt 조합으로
 * DPO 학습용 JSONL을 생성한다.
 *
 * v2 변경:
 *  - metadata 필드 확장 (모든 debug/quality 신호 포함)
 *  - items normalize 반영 (string[] / ItemEntry[] 모두 지원)
 *  - truncation_flag, foreign_char_fix, audit_complete 포함
 *  - 학습 prompt에는 디버그 필드 넣지 않음 (system_prompt + user_prompt만)
 *
 * 실행:
 *   npx tsx scripts/export_dpo_dataset_v2.ts
 *   npx tsx scripts/export_dpo_dataset_v2.ts --min-delta 5 --out data/datasets/dpo_v2.jsonl
 *
 * 출력 형식:
 * {
 *   "id": "<pair_id>",
 *   "prompt": "<system_prompt>\n\n<user_prompt>",
 *   "chosen": "<chosen_text>",
 *   "rejected": "<rejected_text>",
 *   "metadata": {
 *     "book_id", "episode",
 *     "chosen_model", "rejected_model",
 *     "score_delta", "reward_delta",
 *     "chosen_verdict", "rejected_verdict",
 *     "chosen_pov_violation", "rejected_pov_violation",
 *     "chosen_state_violation", "rejected_state_violation",
 *     "foreign_char_fix",         -- chosen 텍스트에 외국어 문자 감지 여부 (filter v2에서 제외됨)
 *     "truncation_flag",          -- chosen 텍스트 비정상 종료 여부 (filter v2에서 제외됨)
 *     "item_format_normalized",   -- items가 normalize 처리된 경우 true
 *     "render_ms",                -- chosen renderer elapsed_ms (null 가능)
 *     "audit_ms",                 -- chosen audit elapsed_ms (null 가능)
 *     "plan_verdict",             -- chosen plan_validation verdict
 *     "trace_id"                  -- chosen trace_id
 *   }
 * }
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

// ── ItemEntry 정규화 (collector v2와 동일) ───────────────────────
interface ItemEntry { name: string; condition?: string; }

function normalizeItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const e = item as ItemEntry;
      return e.condition ? `${e.name} (${e.condition})` : e.name;
    }
    return String(item);
  });
}

function detectItemFormatNormalized(cds: Record<string, any> | null): boolean {
  if (!cds) return false;
  for (const cs of Object.values(cds)) {
    const items = cs?.items;
    if (!Array.isArray(items) || !items.length) continue;
    if (typeof items[0] !== "string") return true; // ItemEntry 형식 감지
  }
  return false;
}

// ── 외국어 문자 감지 ──────────────────────────────────────────────
const FOREIGN_CHAR_PATTERN = /[一-鿿぀-ゟ゠-ヿ　-〿]/;
function detectForeignChars(text: string): boolean {
  return FOREIGN_CHAR_PATTERN.test(text);
}

// ── truncation 감지 ───────────────────────────────────────────────
function detectTruncation(text: string): boolean {
  if (!text || text.length < 50) return true;
  const trimmed = text.trim();
  if (/\[END\]$/.test(trimmed) || /\[CLIFF\](\s*\[END\])?$/.test(trimmed)) return false;
  const lastChar = trimmed.slice(-1);
  if ([".", "!", "?", "。", "！", "？", '"', "'", "…", "」", "』"].includes(lastChar)) return false;
  return true;
}

// ── CLI 인수 ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag: string, def: string): string {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
}
const minDelta = parseFloat(getArg("--min-delta", "5"));
const outFile  = getArg("--out", "data/datasets/dpo_v2.jsonl");
const maxRows  = parseInt(getArg("--limit", "0"), 10) || undefined;

async function main() {
  console.log("FlowScribe DPO Dataset Export v2");
  console.log(`min_score_delta: ${minDelta}`);
  console.log(`출력: ${outFile}`);

  const limitClause = maxRows ? `LIMIT ${maxRows}` : "";
  const r = await pool.query(
    `SELECT
       p.id::text             AS pair_id,
       p.book_id,
       p.episode_number,
       p.chosen_model,
       p.rejected_model,
       p.chosen_verdict,
       p.rejected_verdict,
       p.chosen_score,
       p.rejected_score,
       p.score_delta,
       p.reward_delta,
       p.chosen_pov_violation,
       p.rejected_pov_violation,
       p.chosen_state_violation,
       p.rejected_state_violation,
       p.planner_model,
       p.created_at           AS pair_created_at,
       -- chosen trace
       ct.trace_id::text      AS chosen_trace_id,
       ct.renderer_trace      AS chosen_renderer_trace,
       ct.audit_elapsed_ms    AS chosen_audit_ms,
       ct.plan_validation     AS chosen_plan_validation,
       ct.effective_context_snapshot->'character_dynamic_states' AS chosen_cds,
       -- rejected trace
       rt.trace_id::text      AS rejected_trace_id,
       rt.renderer_trace      AS rejected_renderer_trace
     FROM dpo_pairs p
     JOIN run_traces ct ON ct.trace_id = p.chosen_trace_id
     JOIN run_traces rt ON rt.trace_id = p.rejected_trace_id
     WHERE p.filter_passed = TRUE
       AND p.score_delta >= $1
     ORDER BY p.score_delta DESC
     ${limitClause}`,
    [minDelta],
  );

  console.log(`대상 pair: ${r.rows.length}개`);

  if (!r.rows.length) {
    console.log("추출할 pair 없음 (filter_passed=TRUE인 pair가 없거나 min-delta 조건 미달)");
    await pool.end();
    return;
  }

  const outDir = path.dirname(outFile);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const out = fs.createWriteStream(outFile, { encoding: "utf8" });
  let written = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};

  function skipWith(reason: string) {
    skipped++;
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
  }

  for (const row of r.rows) {
    const ct = row.chosen_renderer_trace;
    const rt = row.rejected_renderer_trace;

    // renderer_trace 필수 필드 체크
    if (!ct?.system_prompt || !ct?.generated_text) { skipWith("chosen_trace_incomplete"); continue; }
    if (!rt?.system_prompt || !rt?.generated_text) { skipWith("rejected_trace_incomplete"); continue; }

    const chosenText   = ct.generated_text as string;
    const rejectedText = rt.generated_text as string;

    // 사후 품질 체크 (이미 filter v2를 통과했지만 export 시점에서도 재확인)
    const foreignCharFix  = detectForeignChars(chosenText);
    const truncationFlag  = detectTruncation(chosenText);

    // items normalize 여부
    const cds = row.chosen_cds as Record<string, any> | null;
    const itemFormatNormalized = detectItemFormatNormalized(cds);

    // chosen render_ms
    const renderMs: number | null = (ct as any).elapsed_ms ?? null;

    // plan verdict
    const planVerdict: string | null = row.chosen_plan_validation?.verdict ?? null;

    // prompt 구성 (학습용 — 디버그 필드 없음)
    const prompt = `${ct.system_prompt}\n\n${(ct as any).user_prompt ?? ""}`.trim();

    const example = {
      id:       row.pair_id,
      prompt,
      chosen:   chosenText,
      rejected: rejectedText,
      metadata: {
        // 식별
        book_id:                    row.book_id,
        episode:                    row.episode_number,
        trace_id:                   row.chosen_trace_id,

        // 모델
        chosen_model:               row.chosen_model,
        rejected_model:             row.rejected_model,
        planner_model:              row.planner_model,

        // 점수
        score_delta:                row.score_delta,
        reward_delta:               row.reward_delta,
        chosen_score:               row.chosen_score,
        rejected_score:             row.rejected_score,

        // 판정
        chosen_verdict:             row.chosen_verdict,
        rejected_verdict:           row.rejected_verdict,

        // 위반 플래그
        chosen_pov_violation:       row.chosen_pov_violation,
        rejected_pov_violation:     row.rejected_pov_violation,
        chosen_state_violation:     row.chosen_state_violation,
        rejected_state_violation:   row.rejected_state_violation,

        // 데이터 위생
        foreign_char_fix:           foreignCharFix,
        truncation_flag:            truncationFlag,
        item_format_normalized:     itemFormatNormalized,

        // 성능
        render_ms:                  renderMs,
        audit_ms:                   row.chosen_audit_ms ?? null,

        // Plan 품질
        plan_verdict:               planVerdict,

        // 수집 시각
        pair_created_at:            row.pair_created_at,
      },
    };

    out.write(JSON.stringify(example) + "\n");
    written++;
  }

  out.end();

  console.log(`\n완료: ${written}개 작성, ${skipped}개 스킵`);
  if (skipped > 0) console.log("스킵 이유:", JSON.stringify(skipReasons));
  console.log(`파일: ${outFile}`);

  // 요약 통계
  await printStats();

  await pool.end();
}

async function printStats() {
  const r = await pool.query(
    `SELECT
       chosen_model,
       COUNT(*) total,
       AVG(score_delta) avg_delta,
       MIN(score_delta) min_delta,
       MAX(score_delta) max_delta
     FROM dpo_pairs WHERE filter_passed=TRUE
     GROUP BY chosen_model`
  );
  console.log("\n[dpo_pairs 통계]");
  r.rows.forEach(row => {
    console.log(`  chosen=${row.chosen_model}: count=${row.total} avg_delta=${parseFloat(row.avg_delta).toFixed(1)} min=${row.min_delta} max=${row.max_delta}`);
  });
}

main().catch(async (e) => { console.error("실패:", e.message); await pool.end(); process.exit(1); });
