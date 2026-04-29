#!/usr/bin/env node
/**
 * debug_regen_context.mjs
 *
 * 1화 재생성 시 플래너/렌더러에 들어가는 컨텍스트를 비교 출력한다.
 * - episode=1 생성 vs 재생성 context diff
 * - rolling_summary / arc_summary / prevTail / continuity_contract 포함 여부
 * - regen_prev 내용 확인
 *
 * Usage:
 *   node scripts/debug_regen_context.mjs --book-id <id> --episode 1
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
  console.error("Usage: node scripts/debug_regen_context.mjs --book-id <id> --episode <N>");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  console.log(`\n[Regen Context Debug] book_id=${bookId}, episode=${episode}`);
  console.log(`\n=== DB 상태 ===`);

  // 1. episode_snapshots: 가장 최근 스냅샷의 effective_context 내용 확인
  const snapRes = await pool.query(
    `SELECT created_at, effective_context
     FROM episode_snapshots WHERE book_id=$1 AND episode_number=$2
     ORDER BY created_at DESC LIMIT 1`,
    [bookId, episode]
  );
  if (snapRes.rows.length) {
    const ctx = snapRes.rows[0].effective_context ?? {};
    console.log(`\n[episode_snapshots ep${episode}] created_at: ${snapRes.rows[0].created_at}`);
    console.log(`  has rolling_summary: ${!!ctx.rolling_summary} (length: ${ctx.rolling_summary?.length ?? 0})`);
    console.log(`  has arc_summaries: ${Array.isArray(ctx.arc_summaries) ? ctx.arc_summaries.length + '개' : 'none'}`);
    console.log(`  has continuity_contract: ${!!ctx.continuity_contract}`);
    console.log(`  has episode_delta_contract: ${!!ctx.episode_delta_contract}`);
    console.log(`  character_dynamic_states: ${ctx.character_dynamic_states?.length ?? 0}명`);
    if (ctx.regen_prev_text) {
      console.log(`  regen_prev_text: ${ctx.regen_prev_text.slice(0, 100)}...`);
    } else {
      console.log(`  regen_prev_text: 없음`);
    }
  } else {
    console.log(`  episode_snapshots ep${episode} 없음`);
  }

  // 2. character_dynamic_states ep1
  const dsRes = await pool.query(
    `SELECT character_name, emotional_state, physical_state, location, recent_goal, items
     FROM character_dynamic_states WHERE book_id=$1 AND episode_number=$2
     ORDER BY character_name`,
    [bookId, episode]
  );
  console.log(`\n[character_dynamic_states ep${episode}] ${dsRes.rows.length}명:`);
  dsRes.rows.forEach(r => {
    console.log(`  ${r.character_name}: emotion=${r.emotional_state ?? '-'}, goal=${(r.recent_goal ?? '-').slice(0, 40)}, items=${(r.items ?? []).length}개`);
  });

  // 3. foreshadow
  const fsRes = await pool.query(
    `SELECT planted_episode, content, status, keywords FROM foreshadows WHERE book_id=$1 AND planted_episode=$2`,
    [bookId, episode]
  );
  console.log(`\n[foreshadows ep${episode}] ${fsRes.rows.length}건:`);
  fsRes.rows.forEach(r => {
    console.log(`  [${r.status}] ${String(r.content).slice(0, 60)} (kw: ${(r.keywords ?? []).join(", ")})`);
  });

  // 4. rolling_summary
  const bsRes = await pool.query(`SELECT rolling_summary FROM book_settings WHERE book_id=$1`, [bookId]);
  const rs = bsRes.rows[0]?.rolling_summary ?? "";
  console.log(`\n[rolling_summary] 총 ${rs.split("\n").filter(Boolean).length}줄:`);
  rs.split("\n").filter(Boolean).slice(0, 5).forEach(l => console.log(`  ${l.slice(0, 80)}`));

  // 5. 판단
  console.log(`\n=== 분석 ===`);
  if (episode === 1) {
    const snap = snapRes.rows[0]?.effective_context ?? {};
    if (snap.rolling_summary?.length > 10) {
      console.warn(`  ⚠ 1화 컨텍스트에 rolling_summary가 포함됨 — 오염 가능성`);
    } else {
      console.log(`  ✓ 1화 컨텍스트에 rolling_summary 없음`);
    }
    if (snap.continuity_contract) {
      console.warn(`  ⚠ 1화 컨텍스트에 continuity_contract 포함 — 오염 가능성`);
    } else {
      console.log(`  ✓ 1화 컨텍스트에 continuity_contract 없음`);
    }
    if (snap.episode_delta_contract) {
      console.warn(`  ⚠ 1화 컨텍스트에 episode_delta_contract 포함 — 오염 가능성`);
    } else {
      console.log(`  ✓ 1화 컨텍스트에 episode_delta_contract 없음`);
    }
  }
} catch (err) {
  console.error("debug error:", err);
  process.exit(1);
} finally {
  await pool.end();
}
