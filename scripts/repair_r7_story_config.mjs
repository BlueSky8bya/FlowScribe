/**
 * repair_r7_story_config.mjs v2 — POST-S13.5 P0 R7 canary storyConfig 정정
 *
 * v1과 차이: books.context만 UPDATE하던 부분 회귀를 차단.
 * v2는 syncWorldContext helper를 호출해 books.context + world_configs + world_rules + Redis를
 * 한 번에 동기화한다 (saveContext API와 동일한 sync 경로).
 *
 * 본 script는 명시적 --apply 없이는 dry-run only — 절대 DB write 안 함.
 *
 * 사용법:
 *   # dry-run (DB 미수정)
 *   node scripts/repair_r7_story_config.mjs --book-id <book_id>
 *
 *   # 실제 sync 적용 (4중)
 *   node scripts/repair_r7_story_config.mjs --book-id <book_id> --apply
 *
 * 안전 가드:
 *   - book_id 미입력 시 즉시 종료
 *   - title이 정확히 "R7_회색지대_생존기_CANARY"인지 검증 (다른 책 보호)
 *   - --apply 없으면 어떤 DB write도 수행 안 함
 *   - syncWorldContext가 단일 트랜잭션 — 부분 실패 시 rollback
 *   - canonical_characters / item_vocab / characters / initial_items 절대 미터치
 *   - resolved_final_episode 보존 (정상 정책: totalEpisodes 30 ± totalEpisodesVar 5 random)
 *
 * 정정 대상 (storyConfig):
 *   genre/mood/style/emotion/conflict/direction
 *
 * 유지 (변경 없음):
 *   pov, dialogue, foreshadow, episodeLength*, totalEpisodes*, resolved_final_episode
 *
 * 정정 대상 (forbidden_settings):
 *   - "사망자 발화 금지"
 *   - "지식 경계 / 알 수 없는 정보 사용 금지"
 *   (이미 등록된 항목은 dedupe)
 */

import pg from "pg";
import { config as loadEnv } from "dotenv";
loadEnv();

// dist에서 helper import — tsc 빌드가 먼저 실행되어야 한다.
const { syncWorldContext } = await import("../dist/services/world_context_sync.js");

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
  console.log(`repair_r7_story_config v2 — ${MODE}`);
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
  console.log(`  • characters:           미터치 (별도 테이블)`);

  console.log(`\n${"─".repeat(72)}`);
  console.log("v2 sync 대상 (helper 호출 시 갱신)");
  console.log(`${"─".repeat(72)}`);
  console.log("  1. books.context           UPDATE jsonb (story_config + forbidden_settings 적용)");
  console.log("  2. world_configs           upsert (genre/mood/background/theme/common_tone)");
  console.log("  3. world_rules             deactivate + reinsert (general / absolute_forbidden)");
  console.log("  4. Redis context:${book_id} SET (TTL 7일)");

  if (scDelta.length === 0 && fbDelta.toAdd.length === 0) {
    console.log(`\n${"─".repeat(72)}`);
    console.log("storyConfig + forbidden 변경할 항목 없음. ");
    console.log("단, world_configs/world_rules/Redis가 stale일 가능성 → --apply로 helper 강제 sync 권장.");
    if (!APPLY) {
      console.log("DRY-RUN 종료. DB 미수정.");
      await pool.end();
      return;
    }
  }

  if (!APPLY) {
    console.log(`\n${"─".repeat(72)}`);
    console.log("DRY-RUN 종료. DB 미수정. 변경 적용하려면 --apply 인자 추가하세요.");
    await pool.end();
    return;
  }

  // APPLY: helper 호출 — 4중 sync (트랜잭션 내부)
  console.log(`\n${"─".repeat(72)}`);
  console.log("APPLY — syncWorldContext helper 호출 (4중 sync)");
  console.log(`${"─".repeat(72)}`);

  const newSc = { ...sc };
  for (const d of scDelta) newSc[d.key] = d.to;
  const newCtx = {
    ...ctx,
    story_config: newSc,
    forbidden_settings: fbDelta.finalArr,
  };

  try {
    const result = await syncWorldContext(BOOK_ID, newCtx);
    console.log(`✓ syncWorldContext 완료`);
    console.log(`  genre_synced:    ${result.genre_synced}`);
    console.log(`  general_count:   ${result.general_count}`);
    console.log(`  forbidden_count: ${result.forbidden_count}`);
  } catch (e) {
    console.error(`✗ syncWorldContext 실패: ${e?.message ?? e}`);
    await pool.end().catch(() => {});
    process.exit(1);
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
    console.log(`  ${ok ? "✓" : "✗"} books.context.story_config.${k} = ${JSON.stringify(got)}`);
    if (!ok) vFail++;
  }
  for (const r of REQUIRED_FORBIDDEN) {
    const ok = vFb.some(x => String(x).trim() === r);
    console.log(`  ${ok ? "✓" : "✗"} forbidden_settings contains "${r}"`);
    if (!ok) vFail++;
  }
  console.log(`  • books.context.story_config.resolved_final_episode = ${vSc.resolved_final_episode ?? "(없음)"} (유지)`);

  // world_configs 검증
  const wc = await pool.query(`SELECT genre, mood, background FROM world_configs WHERE book_id = $1`, [BOOK_ID]);
  const wcRow = wc.rows[0] ?? {};
  console.log(`  ${wcRow.genre === TARGET_STORY_CONFIG.genre ? "✓" : "✗"} world_configs.genre = ${JSON.stringify(wcRow.genre)}`);
  console.log(`  ${wcRow.mood === TARGET_STORY_CONFIG.mood   ? "✓" : "✗"} world_configs.mood = ${JSON.stringify(wcRow.mood)}`);
  if (wcRow.genre !== TARGET_STORY_CONFIG.genre) vFail++;
  if (wcRow.mood !== TARGET_STORY_CONFIG.mood) vFail++;

  // world_rules.absolute_forbidden 검증
  const wr = await pool.query(`SELECT content FROM world_rules WHERE book_id = $1 AND rule_type = 'absolute_forbidden' AND is_active = true`, [BOOK_ID]);
  const fbRows = wr.rows.map(r => r.content.trim());
  for (const r of REQUIRED_FORBIDDEN) {
    const ok = fbRows.some(x => x === r);
    console.log(`  ${ok ? "✓" : "✗"} world_rules.absolute_forbidden contains "${r}"`);
    if (!ok) vFail++;
  }

  await pool.end();
  process.exit(vFail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("repair_r7_story_config 실패:", e?.message ?? e);
  await pool.end().catch(() => {});
  process.exit(1);
});
