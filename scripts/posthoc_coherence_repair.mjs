/**
 * posthoc_coherence_repair.mjs — Phase 4.10 post-hoc 검증
 *
 * 기존 smoke book의 각 화에 대해 runNarrativeCoherenceCheck + repair를
 * 호출해 실제 결과가 어떻게 변하는지 보여준다.
 *
 * 주의: 본문 자체를 DB에 덮어쓰지 않는다 (드라이런).
 * Phase 4.10 코드가 정상 작동하는지만 검증.
 *
 * Usage: node scripts/posthoc_coherence_repair.mjs --book-id <uuid> [--apply]
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const apply = args.includes("--apply");
if (!bookId) { console.error("Usage: --book-id <uuid> [--apply]"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { judgeAndRepair } = await import("../dist/services/narrative_coherence.js");

  const epRes = await pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
    [bookId]
  );
  const stRes = await pool.query(
    `SELECT episode_number, character_name, location, items, physical_state, emotional_state, visibility_state, recent_goal
     FROM character_dynamic_states WHERE book_id=$1 ORDER BY episode_number, character_name`,
    [bookId]
  );

  const stateByEp = {};
  for (const r of stRes.rows) {
    if (!stateByEp[r.episode_number]) stateByEp[r.episode_number] = [];
    stateByEp[r.episode_number].push({
      character_name: r.character_name,
      location: r.location,
      physical_state: r.physical_state,
      emotional_state: r.emotional_state,
      items: Array.isArray(r.items) ? r.items :
        (typeof r.items === "string" ? JSON.parse(r.items || "[]") : []),
      visibility_state: r.visibility_state,
    });
  }

  const W = 70;
  console.log(`\n${"═".repeat(W)}`);
  console.log(` POSTHOC — Coherence Judge + Repair (book: ${bookId.slice(0, 8)}...)`);
  console.log(` mode: ${apply ? "APPLY (DB 갱신)" : "DRY RUN (DB 변경 없음)"}`);
  console.log("═".repeat(W));

  let totalFatal = 0;
  let totalMajor = 0;
  let totalMinor = 0;
  let totalRepairApplied = 0;
  let totalRepairFailed = 0;
  const summary = [];

  for (let i = 0; i < epRes.rows.length; i++) {
    const ep = epRes.rows[i];
    const states = stateByEp[ep.episode_number] ?? [];

    // 이전 화 tail
    const prevSummary = i > 0 ? `직전 화 tail: ${epRes.rows[i - 1].content.slice(-1500)}` : undefined;

    process.stdout.write(`  ep${ep.episode_number} judge+repair... `);
    const result = await judgeAndRepair(
      {
        episode_number: ep.episode_number,
        content: ep.content,
        states,
        prevSummary,
        hints: [],
      },
      { force: true, allowRepair: true },
    );

    const fatal = result.judge.fatalIssues.length;
    const major = result.judge.majorIssues.length;
    const minor = result.judge.minorIssues.length;
    totalFatal += fatal;
    totalMajor += major;
    totalMinor += minor;
    totalRepairApplied += result.repaired.applied;
    totalRepairFailed += result.repaired.failed;

    const judgeStatus = result.judge.judgeError
      ? `error=${result.judge.judgeError.slice(0, 30)}`
      : `f=${fatal} m=${major} mn=${minor} repair=${result.repaired.applied}/${result.repaired.applied + result.repaired.failed}`;
    console.log(judgeStatus);

    summary.push({
      ep: ep.episode_number,
      fatal, major, minor,
      repair_applied: result.repaired.applied,
      repair_failed: result.repaired.failed,
      changed: result.finalContent !== ep.content,
    });

    if (fatal > 0) {
      for (const iss of result.judge.fatalIssues.slice(0, 3)) {
        console.log(`    🔴 [${iss.category}] ${(iss.violation ?? "").slice(0, 70)}`);
      }
    }

    if (apply && result.repaired.applied > 0) {
      await pool.query(
        `UPDATE episodes SET content=$1 WHERE book_id=$2 AND episode_number=$3`,
        [result.finalContent, bookId, ep.episode_number]
      );
      console.log(`    ✓ DB 갱신: ep${ep.episode_number} (${result.repaired.applied}개 단락 repair)`);
    }
  }

  await pool.end();

  // SUMMARY
  console.log(`\n${"─".repeat(W)}`);
  console.log("SUMMARY");
  console.log(`${"─".repeat(W)}`);
  for (const s of summary) {
    console.log(`  ep${s.ep}: fatal=${s.fatal} major=${s.major} minor=${s.minor} repair=${s.repair_applied}/${s.repair_applied + s.repair_failed} changed=${s.changed}`);
  }
  console.log(`${"─".repeat(W)}`);
  console.log(`총 fatal: ${totalFatal} | major: ${totalMajor} | minor: ${totalMinor}`);
  console.log(`총 repair 적용: ${totalRepairApplied} | 실패: ${totalRepairFailed}`);
  console.log(`${"═".repeat(W)}\n`);

  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
