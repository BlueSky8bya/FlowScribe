/**
 * repair_r7_story_config.mjs — POST-S13.5 R7 canary 책 storyConfig 정정
 *
 * R7 canary 책(R7_회색지대_생존기_CANARY)의 books.context.story_config 필드와
 * forbidden_settings에 박힌 stale 값을 R7 목적에 맞게 정정한다.
 *
 * 본 script는 명시적 --apply 없이는 dry-run only — 절대 DB write 안 함.
 *
 * 사용법:
 *   # dry-run (DB 미수정)
 *   node scripts/repair_r7_story_config.mjs --book-id <book_id>
 *
 *   # 실제 UPDATE 적용
 *   node scripts/repair_r7_story_config.mjs --book-id <book_id> --apply
 *
 * 안전 가드:
 *   - book_id 미입력 시 즉시 종료
 *   - title이 정확히 "R7_회색지대_생존기_CANARY"인지 검증 (다른 책 보호)
 *   - --apply 없으면 어떤 UPDATE도 수행 안 함
 *   - 트랜잭션 사용 — 부분 실패 시 rollback
 *   - world_rules / character_defaults / canonical_characters / item_vocab은 절대 미터치
 *   - resolved_final_episode 유지 (정상 정책: totalEpisodes 30 ± totalEpisodesVar 5 범위 random)
 *
 * 정정 대상 (storyConfig):
 *   genre:     "포스트아포칼립스 서바이벌"
 *   mood:      "스릴러, 드라마"
 *   style:     "균형"
 *   emotion:   5
 *   conflict:  5
 *   direction: 5
 *
 * 유지 (변경 없음):
 *   pov, dialogue, foreshadow, episodeLength*, totalEpisodes*, resolved_final_episode
 *
 * 정정 대상 (forbidden_settings):
 *   하나라도 있으면 그대로 유지하고, 빠진 hard rule만 추가한다.
 *     - "사망자 발화 금지"
 *     - "지식 경계 / 알 수 없는 정보 사용 금지"
 */

import pg from "pg";
import { config as loadEnv } from "dotenv";
loadEnv();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const bidIdx = args.indexOf("--book-id");
const APPLY  = args.includes("--apply");
const BOOK_ID = bidIdx !== -1 ? args[bidIdx + 1] : null;

const EXPECTED_TITLE = "R7_회색지대_생존기_CANARY";

const TARGET_STORY_CONFIG = Object.freeze({
  genre:     "포스트아포칼립스 서바이벌",
  mood:      "스릴러, 드라마",
  style:     "균형",
  emotion:   5,
  conflict:  5,
  direction: 5,
});

const REQUIRED_FORBIDDEN = Object.freeze([
  "사망자 발화 금지",
  "지식 경계 / 알 수 없는 정보 사용 금지",
]);

if (!BOOK_ID) {
  console.error("Usage:");
  console.error("  node scripts/repair_r7_story_config.mjs --book-id <book_id> [--apply]");
  process.exit(1);
}

const MODE = APPLY ? "APPLY" : "DRY-RUN";

function diffStoryConfig(current, target) {
  const out = [];
  for (const [k, v] of Object.entries(target)) {
    const cur = current?.[k];
    if (cur !== v) out.push({ key: k, from: cur, to: v });
  }
  return out;
}

function diffForbidden(current, required) {
  const cur = Array.isArray(current) ? current.map(String) : [];
  const toAdd = required.filter(r => !cur.some(x => x.trim() === r));
  return { current: cur, toAdd, finalArr: [...cur, ...toAdd] };
}

async function main() {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`repair_r7_story_config — ${MODE}`);
  console.log(`book_id:  ${BOOK_ID}`);
  console.log(`${"═".repeat(72)}`);

  const r = await pool.query(`SELECT id, title, context FROM books WHERE id = $1`, [BOOK_ID]);
  if (r.rows.length === 0) {
    console.error(`✗ book not found: ${BOOK_ID}`);
    process.exit(1);
  }
  const book = r.rows[0];
  console.log(`title: ${book.title}`);

  if (book.title !== EXPECTED_TITLE) {
    console.error(`✗ title 불일치 — expected "${EXPECTED_TITLE}", got "${book.title}"`);
    console.error(`  R7 canary 책이 아니므로 정정 거부 (다른 책 보호).`);
    process.exit(1);
  }

  const ctx = book.context || {};
  const sc  = ctx.story_config || {};
  const fb  = ctx.forbidden_settings;

  // delta 계산
  const scDelta = diffStoryConfig(sc, TARGET_STORY_CONFIG);
  const fbDelta = diffForbidden(fb, REQUIRED_FORBIDDEN);

  console.log(`\n${"─".repeat(72)}`);
  console.log("storyConfig DELTA");
  console.log(`${"─".repeat(72)}`);
  if (scDelta.length === 0) {
    console.log("  (변경 없음 — 모든 항목이 이미 목표값과 일치)");
  } else {
    for (const d of scDelta) {
      const fromStr = d.from === undefined ? "(없음)" : JSON.stringify(d.from);
      const toStr   = JSON.stringify(d.to);
      console.log(`  • ${d.key.padEnd(10)}: ${fromStr} → ${toStr}`);
    }
  }

  console.log(`\n${"─".repeat(72)}`);
  console.log("forbidden_settings DELTA");
  console.log(`${"─".repeat(72)}`);
  console.log(`  현재 ${fbDelta.current.length}건:`);
  if (fbDelta.current.length === 0) console.log("    (없음)");
  else fbDelta.current.forEach((s, i) => console.log(`    [${i}] ${s}`));
  console.log(`  추가 ${fbDelta.toAdd.length}건:`);
  if (fbDelta.toAdd.length === 0) console.log("    (없음 — 이미 모두 등록됨)");
  else fbDelta.toAdd.forEach(s => console.log(`    + ${s}`));

  // 미터치 영역 표시
  console.log(`\n${"─".repeat(72)}`);
  console.log("UNTOUCHED (미터치 영역)");
  console.log(`${"─".repeat(72)}`);
  console.log(`  • world_rules:           ${Array.isArray(ctx.world_rules) ? ctx.world_rules.length : 0}건 — 유지`);
  console.log(`  • character_defaults:    ${Object.keys(ctx.character_defaults || {}).length}명 — 유지`);
  console.log(`  • fixed_relationships:   ${Array.isArray(ctx.fixed_relationships) ? ctx.fixed_relationships.length : 0}건 — 유지`);
  console.log(`  • storyConfig.pov:        "${sc.pov ?? ""}" — 유지`);
  console.log(`  • storyConfig.dialogue:   ${sc.dialogue ?? "(없음)"} — 유지`);
  console.log(`  • storyConfig.foreshadow: ${sc.foreshadow ?? "(없음)"} — 유지`);
  console.log(`  • storyConfig.episodeLength:    ${sc.episodeLength ?? "(없음)"} — 유지`);
  console.log(`  • storyConfig.episodeLengthVar: ${sc.episodeLengthVar ?? "(없음)"} — 유지`);
  console.log(`  • storyConfig.totalEpisodes:    ${sc.totalEpisodes ?? "(없음)"} — 유지`);
  console.log(`  • storyConfig.totalEpisodesVar: ${sc.totalEpisodesVar ?? "(없음)"} — 유지`);
  console.log(`  • storyConfig.resolved_final_episode: ${sc.resolved_final_episode ?? "(없음)"} — 유지 (정상 정책)`);
  console.log(`  • canonical_characters: 미터치 (별도 테이블)`);
  console.log(`  • item_vocab:           미터치 (별도 테이블)`);

  if (scDelta.length === 0 && fbDelta.toAdd.length === 0) {
    console.log(`\n${"─".repeat(72)}`);
    console.log("변경할 항목 없음 — 정정 불필요. 종료.");
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log(`\n${"─".repeat(72)}`);
    console.log("DRY-RUN 종료. DB 미수정. 변경 적용하려면 --apply 인자 추가하세요.");
    await pool.end();
    return;
  }

  // APPLY: 트랜잭션 안에서 context jsonb 갱신
  console.log(`\n${"─".repeat(72)}`);
  console.log("APPLY — context jsonb UPDATE (transaction)");
  console.log(`${"─".repeat(72)}`);

  const newSc = { ...sc };
  for (const d of scDelta) newSc[d.key] = d.to;
  const newCtx = {
    ...ctx,
    story_config: newSc,
    forbidden_settings: fbDelta.finalArr,
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE books SET context = $1::jsonb, updated_at = NOW() WHERE id = $2 AND title = $3`,
      [JSON.stringify(newCtx), BOOK_ID, EXPECTED_TITLE]
    );
    if (upd.rowCount !== 1) {
      throw new Error(`UPDATE rowCount unexpected: ${upd.rowCount}`);
    }
    await client.query("COMMIT");
    console.log(`✓ COMMIT — books.context jsonb UPDATE (rowCount=${upd.rowCount}).`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`✗ ROLLBACK — ${e?.message ?? e}`);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  // post-apply read-only 검증
  console.log(`\n${"─".repeat(72)}`);
  console.log("POST-APPLY VERIFY (read-only)");
  console.log(`${"─".repeat(72)}`);
  const v = await pool.query(`SELECT context FROM books WHERE id = $1`, [BOOK_ID]);
  const vSc = v.rows[0]?.context?.story_config ?? {};
  const vFb = v.rows[0]?.context?.forbidden_settings ?? [];
  let vFail = 0;
  for (const [k, target] of Object.entries(TARGET_STORY_CONFIG)) {
    const got = vSc[k];
    const ok = got === target;
    console.log(`  ${ok ? "✓" : "✗"} storyConfig.${k} = ${JSON.stringify(got)} ${ok ? "" : `(expected ${JSON.stringify(target)})`}`);
    if (!ok) vFail++;
  }
  for (const r of REQUIRED_FORBIDDEN) {
    const ok = vFb.some(x => String(x).trim() === r);
    console.log(`  ${ok ? "✓" : "✗"} forbidden contains "${r}"`);
    if (!ok) vFail++;
  }
  console.log(`  • storyConfig.resolved_final_episode = ${vSc.resolved_final_episode ?? "(없음)"} (유지)`);
  console.log(`  • storyConfig.episodeLength = ${vSc.episodeLength ?? "(없음)"} (유지)`);
  console.log(`  • storyConfig.totalEpisodes = ${vSc.totalEpisodes ?? "(없음)"} (유지)`);

  await pool.end();
  process.exit(vFail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("repair_r7_story_config 실패:", e?.message ?? e);
  await pool.end().catch(() => {});
  process.exit(1);
});
