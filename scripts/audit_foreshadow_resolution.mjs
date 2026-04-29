#!/usr/bin/env node
/**
 * audit_foreshadow_resolution.mjs
 *
 * foreshadow resolve 판정 감사:
 * - resolved 중 keyword 재등장만으로 처리된 "false resolved" 감지
 * - open 복선 중 본문에서 실제 payoff가 있는 것 감지 (missed)
 * - 과도한 resolved 비율 WARN
 *
 * Usage:
 *   node scripts/audit_foreshadow_resolution.mjs --book-id <id>
 */

import pg from "pg";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: { "book-id": { type: "string" } },
});
const bookId = args["book-id"];
if (!bookId) {
  console.error("Usage: node scripts/audit_foreshadow_resolution.mjs --book-id <id>");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// PASS/WARN/FAIL 카운터
let pass = 0, warn = 0, fail = 0;
const issues = [];

function check(label, passed, warnLevel = false) {
  if (passed) { console.log(`  ✓ ${label}`); pass++; }
  else if (warnLevel) { console.warn(`  ⚠ WARN: ${label}`); warn++; issues.push(`WARN: ${label}`); }
  else { console.error(`  ✗ FAIL: ${label}`); fail++; issues.push(`FAIL: ${label}`); }
}

try {
  // 1. 전체 foreshadow 조회
  const fRes = await pool.query(
    `SELECT id, planted_episode, content, keywords, status, resolved_episode
     FROM foreshadows WHERE book_id = $1 ORDER BY planted_episode ASC`,
    [bookId]
  );
  const foreshadows = fRes.rows;
  const total = foreshadows.length;
  const resolvedList = foreshadows.filter(f => f.status === "resolved");
  const openList = foreshadows.filter(f => f.status === "open");

  console.log(`\n[Foreshadow Audit] book_id=${bookId}`);
  console.log(`  총 복선: ${total} / resolved: ${resolvedList.length} / open: ${openList.length}`);

  check("복선이 최소 1개 이상 존재", total >= 1);

  // 2. resolved 비율 — 90% 이상이면 WARN
  const resolvedRatio = total > 0 ? resolvedList.length / total : 0;
  check(
    `resolved 비율 ${(resolvedRatio * 100).toFixed(0)}% (≤80% 권장)`,
    resolvedRatio <= 0.80,
    true
  );

  // 3. resolved 복선 중 "false resolved" 감지
  // false resolved 기준:
  //   - resolved_episode가 planted_episode와 같음 (즉시 해소, 복선 아님)
  //   - keywords가 1개이고 매우 짧음 (1~2글자 공통어)
  let falseResolvedCount = 0;
  const SHORT_GENERIC_WORDS = new Set(["이", "그", "저", "것", "때", "곳", "와", "과", "의"]);

  for (const f of resolvedList) {
    let isFalse = false;
    let reason = "";

    // 즉시 resolved (planted == resolved)
    if (f.resolved_episode && f.resolved_episode === f.planted_episode) {
      isFalse = true;
      reason = `planted_episode === resolved_episode (${f.planted_episode}화)`;
    }
    // 단일 짧은 키워드
    if (f.keywords?.length === 1 && SHORT_GENERIC_WORDS.has(f.keywords[0])) {
      isFalse = true;
      reason = `single generic keyword: "${f.keywords[0]}"`;
    }
    // 키워드 없음
    if (!f.keywords?.length) {
      isFalse = true;
      reason = "no keywords";
    }

    if (isFalse) {
      falseResolvedCount++;
      console.warn(`    ⚠ false_resolved 의심 [ep${f.planted_episode}→ep${f.resolved_episode}]: "${String(f.content).slice(0, 60)}" (${reason})`);
    }
  }

  check(
    `false_resolved 의심 건수 ${falseResolvedCount} (0 권장)`,
    falseResolvedCount === 0,
    falseResolvedCount < 3  // 3건 미만은 WARN
  );

  // 4. 최종화 복선 중 major가 resolved인지
  const epRes = await pool.query(
    `SELECT MAX(episode_number) AS max_ep FROM episodes WHERE book_id = $1`,
    [bookId]
  );
  const maxEp = epRes.rows[0]?.max_ep ?? 0;
  const finalOpenMajor = openList.filter(f =>
    f.planted_episode <= Math.ceil(maxEp * 0.5)  // 전반부에 심은 복선
  );
  check(
    `전반부(ep1~${Math.ceil(maxEp * 0.5)}) 복선 중 open ${finalOpenMajor.length}건 — 최종화까지 회수 가능`,
    finalOpenMajor.length <= 2,
    finalOpenMajor.length <= 4
  );

  // 5. planted 복선이 이후 에피소드에서 내용 상 언급되는지 체크 (keywords 기반)
  // open 복선 중 실제 본문에 keyword가 등장하는 화가 있으면 "missed resolve" 가능성
  let missedCount = 0;
  if (openList.length > 0 && maxEp > 0) {
    const epContent = await pool.query(
      `SELECT episode_number, content FROM episodes
       WHERE book_id = $1 AND episode_number > $2
       ORDER BY episode_number ASC`,
      [bookId, openList[0]?.planted_episode ?? 0]
    );
    for (const f of openList) {
      const kws = f.keywords ?? [];
      if (kws.length < 2) continue;
      for (const ep of epContent.rows) {
        if (ep.episode_number <= f.planted_episode) continue;
        const hits = kws.filter(kw => ep.content?.includes(kw)).length;
        if (hits >= 2) {
          missedCount++;
          console.warn(`    ⚠ missed_resolve 가능성 [ep${f.planted_episode}복선 → ep${ep.episode_number}언급]: "${String(f.content).slice(0, 50)}"`);
          break;
        }
      }
    }
  }
  check(
    `missed_resolve(열려있지만 본문 언급 있는) 의심 ${missedCount}건`,
    missedCount === 0,
    missedCount < 3
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
