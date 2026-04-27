/**
 * scripts/export_dpo_dataset.ts — DPO 학습 데이터 JSONL 추출
 *
 * dpo_pairs 테이블에서 filter_passed=TRUE인 pair를 읽고
 * run_traces의 renderer_trace.system_prompt + user_prompt 조합으로
 * DPO 학습용 JSONL을 생성한다.
 *
 * 실행:
 *   npx tsx scripts/export_dpo_dataset.ts
 *   npx tsx scripts/export_dpo_dataset.ts --min-delta 10 --out data/datasets/dpo_v1.jsonl
 *
 * 출력 형식 (각 줄):
 * {
 *   "id": "<pair_id>",
 *   "prompt": "<system_prompt>\n\n<user_prompt>",
 *   "chosen": "<chosen_text>",
 *   "rejected": "<rejected_text>",
 *   "metadata": {
 *     "book_id": "...", "episode": N,
 *     "chosen_model": "...", "rejected_model": "...",
 *     "score_delta": N, "reward_delta": N,
 *     "chosen_verdict": "...", "rejected_verdict": "...",
 *     "chosen_pov_violation": false, "rejected_pov_violation": false
 *   }
 * }
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

// CLI 인수 파싱
const args = process.argv.slice(2);
const minDelta  = parseFloat(args[args.indexOf("--min-delta")  + 1] ?? "5");
const outFile   = args[args.indexOf("--out") + 1] ?? "data/datasets/dpo_v1.jsonl";
const maxRows   = parseInt(args[args.indexOf("--limit") + 1] ?? "0", 10) || undefined;

async function main() {
  console.log("FlowScribe DPO Dataset Export");
  console.log(`min_score_delta: ${minDelta}`);
  console.log(`출력: ${outFile}`);

  // dpo_pairs + 두 trace 조인
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
       p.score_delta,
       p.reward_delta,
       p.chosen_pov_violation,
       p.rejected_pov_violation,
       ct.renderer_trace      AS chosen_trace,
       rt.renderer_trace      AS rejected_trace
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
  let written = 0, skipped = 0;

  for (const row of r.rows) {
    const ct = row.chosen_trace;
    const rt = row.rejected_trace;

    // renderer_trace에서 prompt + output 추출
    if (!ct?.system_prompt || !ct?.generated_text || !rt?.system_prompt || !rt?.generated_text) {
      skipped++;
      continue;
    }

    // prompt: chosen 기준 (두 출력이 같은 planner context에서 나왔으므로 동일해야 함)
    const prompt = `${ct.system_prompt}\n\n${ct.user_prompt ?? ""}`.trim();

    const example = {
      id: row.pair_id,
      prompt,
      chosen: ct.generated_text,
      rejected: rt.generated_text,
      metadata: {
        book_id:                row.book_id,
        episode:                row.episode_number,
        chosen_model:           row.chosen_model,
        rejected_model:         row.rejected_model,
        score_delta:            row.score_delta,
        reward_delta:           row.reward_delta,
        chosen_verdict:         row.chosen_verdict,
        rejected_verdict:       row.rejected_verdict,
        chosen_pov_violation:   row.chosen_pov_violation,
        rejected_pov_violation: row.rejected_pov_violation,
      },
    };

    out.write(JSON.stringify(example) + "\n");
    written++;
  }

  out.end();
  console.log(`완료: ${written}개 작성, ${skipped}개 스킵 (trace 불완전)`);
  console.log(`파일: ${outFile}`);

  await pool.end();
}

main().catch(async (e) => { console.error("실패:", e.message); await pool.end(); process.exit(1); });
