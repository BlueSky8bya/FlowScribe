#!/usr/bin/env node
/**
 * audit_regeneration_memory.mjs
 *
 * 같은 화 반복 재생성 시 DB 오염 감사:
 * - character_dynamic_states 중복 row 여부
 * - foreshadow 중복 planted_episode 여부
 * - rolling_summary 중복 항목 여부
 * - arc_summary 생성 여부
 *
 * Usage:
 *   node scripts/audit_regeneration_memory.mjs --book-id <id> --episode 1
 */

import pg from "pg";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    "book-id": { type: "string" },
    "episode": { type: "string" },
  },
});
const bookId = args["book-id"];
const episode = parseInt(args["episode"] ?? "1", 10);
if (!bookId) {
  console.error("Usage: node scripts/audit_regeneration_memory.mjs --book-id <id> --episode <N>");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, warn = 0, fail = 0;
const issues = [];

function check(label, passed, warnLevel = false) {
  if (passed) { console.log(`  ✓ ${label}`); pass++; }
  else if (warnLevel) { console.warn(`  ⚠ WARN: ${label}`); warn++; issues.push(`WARN: ${label}`); }
  else { console.error(`  ✗ FAIL: ${label}`); fail++; issues.push(`FAIL: ${label}`); }
}

try {
  console.log(`\n[Regeneration Memory Audit] book_id=${bookId}, episode=${episode}`);

  // 1. character_dynamic_states: 같은 화에 같은 인물 row가 1개여야 함
  const dsRes = await pool.query(
    `SELECT character_name, COUNT(*) AS cnt
     FROM character_dynamic_states
     WHERE book_id=$1 AND episode_number=$2
     GROUP BY character_name HAVING COUNT(*) > 1`,
    [bookId, episode]
  );
  check(
    `ep${episode} character_dynamic_states 중복 row 없음 (중복: ${dsRes.rows.length}건)`,
    dsRes.rows.length === 0
  );
  if (dsRes.rows.length > 0) {
    dsRes.rows.forEach(r => console.error(`    ✗ ${r.character_name}: ${r.cnt}개 row`));
  }

  // 2. foreshadow: 같은 화에 open 복선 중복 여부 (content 유사도)
  const fsRes = await pool.query(
    `SELECT content, COUNT(*) AS cnt
     FROM foreshadows
     WHERE book_id=$1 AND planted_episode=$2 AND status='open'
     GROUP BY content HAVING COUNT(*) > 1`,
    [bookId, episode]
  );
  check(
    `ep${episode} foreshadow 중복 content 없음 (중복: ${fsRes.rows.length}건)`,
    fsRes.rows.length === 0
  );

  // 3. foreshadow 총 건수 확인 (1화에 너무 많으면 누적 의심)
  const fsTotalRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM foreshadows WHERE book_id=$1 AND planted_episode=$2`,
    [bookId, episode]
  );
  const fsTotal = parseInt(fsTotalRes.rows[0]?.cnt ?? "0", 10);
  check(
    `ep${episode} foreshadow 총 ${fsTotal}건 (≤6 권장)`,
    fsTotal <= 6,
    fsTotal <= 10
  );

  // 4. 1화 생성 시 rolling_summary / arc_summary는 없어야 함
  if (episode === 1) {
    // rolling_summary는 book_settings에 저장됨
    const bsRes = await pool.query(
      `SELECT rolling_summary FROM book_settings WHERE book_id=$1`,
      [bookId]
    );
    const rs = bsRes.rows[0]?.rolling_summary ?? "";
    // 1화만 있는 책에서 rolling_summary에 1화 이상이 들어가면 안 됨
    const rsLines = rs.split("\n").filter(l => /^\d+화:/.test(l.trim()));
    check(
      `1화 재생성 후 rolling_summary가 2화 이상 항목을 포함하지 않음 (현재 ${rsLines.length}개)`,
      rsLines.every(l => /^1화:/.test(l.trim())),
      true
    );

    // arc_summary는 ep1에서 생성되지 않아야 함
    const arcRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM arc_summaries WHERE book_id=$1 AND arc_number=1`,
      [bookId]
    );
    const arcCnt = parseInt(arcRes.rows[0]?.cnt ?? "0", 10);
    check(
      `1화 단계에서 arc_summary 미생성 (현재 ${arcCnt}건)`,
      arcCnt === 0,
      true  // 10화 이하 책에서는 arc가 있을 수 있으니 warn
    );
  }

  // 5. episode_snapshots 중복 확인
  const snapRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM episode_snapshots WHERE book_id=$1 AND episode_number=$2`,
    [bookId, episode]
  );
  const snapCnt = parseInt(snapRes.rows[0]?.cnt ?? "0", 10);
  check(
    `ep${episode} episode_snapshots row ${snapCnt}건 (최대 1건 권장, ON CONFLICT DO UPDATE 사용 시)`,
    snapCnt <= 1,
    snapCnt <= 3
  );

} catch (err) {
  console.error("audit error:", err);
  process.exit(1);
} finally {
  await pool.end();
}

console.log(`\n────────────────────────────────────────`);
console.log(`Result: ${pass} passed, ${warn} warned, ${fail} failed`);
if (issues.length) {
  console.log("Issues:");
  issues.forEach(i => console.log(`  ${i}`));
}
if (fail > 0) process.exit(1);
