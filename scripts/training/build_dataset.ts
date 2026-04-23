/**
 * scripts/training/build_dataset.ts — 학습 데이터셋 빌드 CLI
 *
 * 사용:
 *   npx tsx scripts/training/build_dataset.ts [mode] [options]
 *
 * mode:
 *   planner_sft   — Planner SFT 데이터셋 생성
 *   renderer_dpo  — Renderer DPO 데이터셋 생성
 *   all           — 전체 (기본)
 *
 * options:
 *   --min-score=70     최소 prose 점수 (default: 70)
 *   --from=2026-04-01  날짜 범위 시작
 *   --to=2026-04-30    날짜 범위 끝
 *   --out=data/datasets 출력 디렉터리
 */

import "dotenv/config";
import { pool } from "../../src/lib/db.js";
import { runMigrateV2 } from "../../src/db/migrate_v2.js";
import { buildAndExportAll, buildPlannerSFTDataset, exportToJSONL } from "../../src/training/dataset_builder.js";
import { join } from "path";

const args = process.argv.slice(2);
const mode = args[0] ?? "all";
const getFlag = (name: string, def: string) =>
  args.find(a => a.startsWith(`--${name}=`))?.split("=")[1] ?? def;

const minScore = parseInt(getFlag("min-score", "70"));
const dateFrom = getFlag("from", "");
const dateTo   = getFlag("to", "");
const outDir   = getFlag("out", "data/datasets");

async function main() {
  console.log(`[build_dataset] mode=${mode} min_score=${minScore} out=${outDir}`);

  try {
    await runMigrateV2();
  } catch {
    // 테이블이 이미 존재하면 무시
  }

  const cfg = {
    output_dir: outDir,
    min_final_score: minScore,
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  };

  if (mode === "planner_sft") {
    const data = await buildPlannerSFTDataset(pool, cfg);
    exportToJSONL(data, join(outDir, "planner_sft.jsonl"));
    console.log(`✅ Planner SFT: ${data.length}개`);
  } else if (mode === "all") {
    await buildAndExportAll(pool, cfg);
    console.log("✅ 전체 데이터셋 빌드 완료");
  } else {
    console.error(`❌ 알 수 없는 mode: ${mode}`);
    process.exit(1);
  }
}

main()
  .catch(e => { console.error("❌", e); process.exit(1); })
  .finally(() => pool.end());
