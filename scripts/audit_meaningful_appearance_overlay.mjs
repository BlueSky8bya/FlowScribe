/**
 * audit_meaningful_appearance_overlay.mjs — R5B-1.8D
 *
 * 기존 LLM audit 결과(.tmp/r5b1_8c_alignment_*.json)에 deterministic detector를 overlay해
 * "새 R5B-1.8D guard 적용 시 잔존 absent_severe"를 read-only로 추정한다.
 *
 * 입력:
 *   - LLM audit JSON 파일 (R5B-1.9에서 생성)
 *   - DB의 episodes.content (full body)
 *
 * 출력:
 *   - 각 (ep, character)마다 detector level + would_block
 *   - aggregate: detector_caught_severe, would_remain_severe, false_positives_block
 *   - PASS 기준 3개 (R5B-1.8D)
 *
 * Usage:
 *   node scripts/audit_meaningful_appearance_overlay.mjs --book-id <uuid> --input .tmp/r5b1_8c_alignment_<bookId>.json
 */
import pg from "pg";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { config } from "dotenv";
import { detectMeaningfulAppearance, isUpdateAllowed } from "../dist/lib/meaningful_appearance.js";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const inputPath = args[args.indexOf("--input") + 1];
if (!bookId || !inputPath) {
  console.error("Usage: --book-id <uuid> --input <existing audit json>");
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const audit = JSON.parse(readFileSync(inputPath, "utf8"));
  const records = audit.records ?? [];
  const epNumbers = records.map(r => r.episode).filter(Boolean);
  if (epNumbers.length === 0) {
    console.error("No episodes in audit input");
    process.exit(1);
  }

  // body 읽기 — full content
  const eps = (await pool.query(
    `SELECT episode_number, content FROM episodes
     WHERE book_id=$1 AND episode_number = ANY($2::int[])
     ORDER BY episode_number`,
    [bookId, epNumbers]
  )).rows;
  const bodyByEp = {};
  for (const e of eps) bodyByEp[e.episode_number] = e.content ?? "";

  console.log(`book_id: ${bookId}  episodes: ${eps.length}  audit records: ${records.length}`);
  console.log("");

  const enrichedRecords = [];
  let total = 0, llmPass = 0, llmFail = 0, llmAbsentSevere = 0;
  let detectorBlock = 0, detectorCaughtSevere = 0, wouldRemainSevere = 0;
  let falsePositiveBlock = 0; // detector blocks (weak/none) BUT LLM said PASS+appeared (i.e., guard would wrongly hide a real appearance)

  // per-character aggregate
  const charAgg = {};

  // detail rows for failed cases
  const failDetails = [];

  for (const rec of records) {
    if (!Array.isArray(rec.evaluations)) continue;
    const body = bodyByEp[rec.episode] ?? "";
    const enrichedEvals = [];
    for (const ev of rec.evaluations) {
      total++;
      if (ev.verdict === "PASS") llmPass++;
      if (ev.verdict === "FAIL") llmFail++;
      const isAbsentSevere = (ev.appeared_in_body === false && ev.verdict !== "PASS");
      if (isAbsentSevere) llmAbsentSevere++;

      const det = detectMeaningfulAppearance(body, ev.character);
      const wouldBlock = !isUpdateAllowed(det.level);

      const enrichedEv = {
        ...ev,
        detector_level: det.level,
        detector_strong_count: det.strong_count,
        detector_medium_count: det.medium_count,
        detector_weak_count: det.weak_count,
        detector_occurrence: det.occurrence_count,
        detector_evidence_types: det.evidence_types,
        detector_would_block: wouldBlock,
      };
      enrichedEvals.push(enrichedEv);

      const k = ev.character;
      if (!charAgg[k]) charAgg[k] = {
        total: 0, llm_pass: 0, llm_fail: 0, llm_absent_severe: 0,
        det_block: 0, det_caught: 0, would_remain: 0, false_positive_block: 0,
      };
      charAgg[k].total++;
      if (ev.verdict === "PASS") charAgg[k].llm_pass++;
      if (ev.verdict === "FAIL") charAgg[k].llm_fail++;
      if (isAbsentSevere) charAgg[k].llm_absent_severe++;
      if (wouldBlock) {
        detectorBlock++;
        charAgg[k].det_block++;
      }
      if (isAbsentSevere) {
        if (wouldBlock) {
          detectorCaughtSevere++;
          charAgg[k].det_caught++;
        } else {
          wouldRemainSevere++;
          charAgg[k].would_remain++;
          failDetails.push({ ep: rec.episode, char: ev.character, llm_verdict: ev.verdict, llm_appeared: ev.appeared_in_body, llm_reason: ev.reason, det_level: det.level, det_types: det.evidence_types, det_strong: det.strong_count, det_medium: det.medium_count });
        }
      }
      // false positive block: detector blocks (weak/none) but LLM said appeared=true + verdict=PASS (i.e., real appearance, but guard would hide it → reader sees absent card)
      if (wouldBlock && ev.appeared_in_body === true && ev.verdict === "PASS") {
        falsePositiveBlock++;
        charAgg[k].false_positive_block++;
      }
    }
    enrichedRecords.push({ episode: rec.episode, evaluations: enrichedEvals });
  }

  console.log("── [Per-character — R5B-1.8D detector simulation] ──");
  console.log("char    | total | LLM_PASS | LLM_FAIL | LLM_absS | det_block | det_caught | remain | false_pos");
  for (const [name, c] of Object.entries(charAgg)) {
    console.log(`${name.padEnd(7)} | ${String(c.total).padStart(5)} | ${String(c.llm_pass).padStart(8)} | ${String(c.llm_fail).padStart(8)} | ${String(c.llm_absent_severe).padStart(8)} | ${String(c.det_block).padStart(9)} | ${String(c.det_caught).padStart(10)} | ${String(c.would_remain).padStart(6)} | ${String(c.false_positive_block).padStart(9)}`);
  }

  const passRate = total ? llmPass / total : 0;
  console.log("");
  console.log("── [Aggregate] ──");
  console.log(`total evaluations: ${total}`);
  console.log(`LLM PASS rate: ${(passRate*100).toFixed(1)}%`);
  console.log(`LLM FAIL: ${llmFail}, absent_severe: ${llmAbsentSevere}`);
  console.log("");
  console.log(`detector_block (weak/none → guard 차단): ${detectorBlock}`);
  console.log(`detector_caught_severe (기존 absent_severe 중 새 guard가 잡았을 것): ${detectorCaughtSevere} / ${llmAbsentSevere}`);
  console.log(`would_remain_severe (새 guard 적용 후 잔존 absent_severe 추정): ${wouldRemainSevere}`);
  console.log(`false_positive_block (실제 등장 인물 잘못 차단 추정): ${falsePositiveBlock}`);

  if (failDetails.length > 0) {
    console.log("");
    console.log("── [잔존 severe 케이스 (would_remain_severe)] ──");
    for (const d of failDetails) {
      console.log(`  ep${d.ep} ${d.char}: llm[verdict=${d.llm_verdict} appeared=${d.llm_appeared}] det[${d.det_level} S=${d.det_strong} M=${d.det_medium}] reason="${d.llm_reason}"`);
    }
  }

  // ── PASS criteria (R5B-1.8D) ──
  console.log("");
  console.log("── [R5B-1.8D PASS criteria] ──");
  const checks = [
    { name: "alignment LLM PASS ≥ 90%",                                 pass: passRate >= 0.90 },
    { name: "would_remain_severe = 0 (새 guard 적용 후 잔존 0)",        pass: wouldRemainSevere === 0 },
    { name: "detector_caught_severe = absent_severe (기존 모두 catch)", pass: detectorCaughtSevere === llmAbsentSevere },
    { name: "false_positive_block = 0 (실제 등장 인물 misblock 없음)",  pass: falsePositiveBlock === 0 },
  ];
  for (const c of checks) console.log(`  ${c.pass?"✓":"✗"} ${c.name}`);
  const passed = checks.filter(c => c.pass).length;
  console.log("");
  console.log(`R5B-1.8D detector overlay: ${passed}/${checks.length} ${passed===checks.length?"✅ READY":"⚠ CONDITIONAL"}`);

  // false positive 케이스 (LLM appeared=true + verdict=PASS이지만 detector가 막음)
  if (falsePositiveBlock > 0) {
    console.log("");
    console.log("── [false_positive_block 후보 — 추가 분석 필요] ──");
    let shown = 0;
    for (const rec of enrichedRecords) {
      for (const ev of rec.evaluations) {
        if (ev.detector_would_block && ev.appeared_in_body === true && ev.verdict === "PASS" && shown < 20) {
          console.log(`  ep${rec.episode} ${ev.character}: det=${ev.detector_level} S=${ev.detector_strong_count} M=${ev.detector_medium_count} W=${ev.detector_weak_count} types=[${ev.detector_evidence_types.join(",")}] llm_summary="${ev.rendered_last_summary}"`);
          shown++;
        }
      }
    }
    if (falsePositiveBlock > 20) console.log(`  ... +${falsePositiveBlock - 20} more`);
  }

  // save
  mkdirSync(".tmp", { recursive: true });
  const outPath = `.tmp/r5b1_8d_overlay_${bookId}.json`;
  writeFileSync(outPath, JSON.stringify({
    book_id: bookId,
    source_audit: inputPath,
    records: enrichedRecords,
    summary: {
      total, llm_pass: llmPass, llm_fail: llmFail, llm_absent_severe: llmAbsentSevere, llm_pass_rate: passRate,
      detector_block: detectorBlock, detector_caught_severe: detectorCaughtSevere,
      would_remain_severe: wouldRemainSevere, false_positive_block: falsePositiveBlock,
    },
    fail_details: failDetails,
    criteria: { passed, total: checks.length, checks },
  }, null, 2), "utf8");
  console.log("");
  console.log(`written: ${outPath}`);

  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(1); });
