/**
 * clone_world_bible_clean_book.mjs — R5B-1
 *
 * source book의 user-authored 세계관/인물 설정 + 선택적 ep1 baseline content를
 * 새 clean book으로 복사. **오염된 generated history는 절대 복사 안 함**.
 *
 * 복사 대상 (user-authored):
 *   - books.context (legacy world bible JSON)
 *   - redis context:{book_id} (legacy world bible)
 *   - world_configs (background/genre/mood/theme/common_tone)
 *   - world_rules (general / absolute_forbidden)
 *   - canonical_characters (name/type/gender/personality/initial_items)
 *   - characters (source='user' 만)
 *   - 선택적: episodes.content (--copy-episode N) — fallback marker로 summary 부착
 *
 * 복사 금지 (generated/오염):
 *   - run_traces, episode_snapshots, foreshadows, arc_summaries
 *   - character_dynamic_states, character_arcs, character_inferred_states
 *   - validation_logs, revision_logs, trajectory_rewards, dpo_pairs
 *   - author_interventions
 *
 * Usage:
 *   node scripts/clone_world_bible_clean_book.mjs \
 *     --source-book-id <uuid> \
 *     --title "확률을 깨는 용사(확깨용)_TEST2" \
 *     --copy-episode 1
 */
import pg from "pg";
import IORedis from "ioredis";
import { randomUUID } from "crypto";
import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const srcBookId = args[args.indexOf("--source-book-id") + 1];
const title     = args[args.indexOf("--title") + 1];
const copyEp    = args.includes("--copy-episode") ? parseInt(args[args.indexOf("--copy-episode") + 1], 10) : null;
const apply     = args.includes("--yes");

if (!srcBookId || !title) {
  console.error("Usage: --source-book-id <uuid> --title \"<new title>\" [--copy-episode N] [--yes]");
  process.exit(1);
}

const { Pool } = pg;
const pool  = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

const SUMMARY_FALLBACK_MARKER = "[[FALLBACK]]";

async function main() {
  console.log(`[clone] source: ${srcBookId}`);
  console.log(`[clone] target title: ${title}`);
  console.log(`[clone] copy episode: ${copyEp ?? "none"}`);
  console.log(`[clone] mode: ${apply ? "APPLY" : "DRY-RUN (--yes 없음)"}`);
  console.log("");

  // ── source 검증 ───────────────────────────────────────────
  const srcBook = await pool.query("SELECT * FROM books WHERE id=$1", [srcBookId]);
  if (!srcBook.rows.length) { console.error("source book not found"); process.exit(1); }
  const src = srcBook.rows[0];
  console.log(`[src] title="${src.title}" user_id=${src.user_id} current_ep=${src.current_episode}`);

  // 중복 title 검사
  const dup = await pool.query("SELECT id FROM books WHERE user_id=$1 AND title=$2", [src.user_id, title]);
  if (dup.rows.length) {
    console.error(`[error] target title already exists for this user: ${dup.rows[0].id}`);
    process.exit(1);
  }

  // 복사 대상 데이터 미리 조회 (dry-run 출력용)
  const wc  = await pool.query("SELECT background, genre, mood, theme, common_tone FROM world_configs WHERE book_id=$1", [srcBookId]).catch(()=>({rows:[]}));
  // R5B-1 clone: source의 중복 누적된 world_rules는 dedup해서 복사 (재생성 누적으로 중복된 row는 정리됨)
  const wr  = await pool.query("SELECT DISTINCT rule_type, content FROM world_rules WHERE book_id=$1", [srcBookId]).catch(()=>({rows:[]}));
  const cc  = await pool.query("SELECT name, type, gender, personality, initial_items FROM canonical_characters WHERE book_id=$1 ORDER BY name ASC", [srcBookId]);
  const usrChars = await pool.query("SELECT name, role, personality, type, gender, source, first_appeared_episode, extra FROM characters WHERE book_id=$1 AND source='user'", [srcBookId]).catch(()=>({rows:[]}));
  const redisCtx = await redis.get(`context:${srcBookId}`);
  let epRow = null;
  if (copyEp != null) {
    const r = await pool.query("SELECT content FROM episodes WHERE book_id=$1 AND episode_number=$2", [srcBookId, copyEp]);
    epRow = r.rows[0] ?? null;
  }

  console.log("[plan] world_configs:", wc.rows.length, "row");
  console.log("[plan] world_rules:", wr.rows.length, "row");
  console.log("[plan] canonical_characters:", cc.rows.length, "row");
  console.log("[plan] characters (user):", usrChars.rows.length, "row");
  console.log("[plan] redis context:", redisCtx ? "present" : "absent");
  console.log("[plan] episode content copy:", epRow ? `ep${copyEp} (${epRow.content.length} chars)` : "skip");

  if (!apply) {
    console.log("\n[dry-run] --yes 추가 시 실제 적용");
    await pool.end(); await redis.quit();
    return;
  }

  // ── 복사 실행 (transaction) ───────────────────────────────
  const newBookId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // jsonb 컬럼은 driver가 object로 parse — INSERT 시 stringify 필요
    const ctxStr = src.context == null ? null : (typeof src.context === "string" ? src.context : JSON.stringify(src.context));
    await client.query(
      "INSERT INTO books (id, user_id, title, context, current_episode) VALUES ($1, $2, $3, $4::jsonb, 1)",
      [newBookId, src.user_id, title, ctxStr]
    );

    if (wc.rows.length) {
      const w = wc.rows[0];
      await client.query(
        `INSERT INTO world_configs (book_id, background, genre, mood, theme, common_tone)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [newBookId, w.background, w.genre, w.mood, w.theme, w.common_tone]
      );
    }

    for (const r of wr.rows) {
      await client.query(
        "INSERT INTO world_rules (book_id, rule_type, content) VALUES ($1,$2,$3)",
        [newBookId, r.rule_type, r.content]
      );
    }

    for (const ch of cc.rows) {
      const itemsStr = ch.initial_items == null ? null : (typeof ch.initial_items === "string" ? ch.initial_items : JSON.stringify(ch.initial_items));
      await client.query(
        `INSERT INTO canonical_characters (book_id, name, type, gender, personality, initial_items)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [newBookId, ch.name, ch.type, ch.gender, ch.personality, itemsStr]
      );
    }

    for (const ch of usrChars.rows) {
      const extraStr = ch.extra == null ? "{}" : (typeof ch.extra === "string" ? ch.extra : JSON.stringify(ch.extra));
      await client.query(
        `INSERT INTO characters (book_id, name, role, personality, type, gender, source, first_appeared_episode, extra)
         VALUES ($1,$2,$3,$4,$5,$6,'user',$7,$8::jsonb)`,
        [newBookId, ch.name, ch.role, ch.personality, ch.type, ch.gender, ch.first_appeared_episode, extraStr]
      );
    }

    if (epRow) {
      // R5B-1: ep content 복사 + fallback marker로 summary 부착
      // (LLM 요약은 다음 trigger 또는 manual rerun으로 생성됨 — clone 단계에서는 LLM 호출 0)
      const fallback = SUMMARY_FALLBACK_MARKER + (epRow.content.split(/[.。!?]/)[0]?.trim() ?? "");
      await client.query(
        `INSERT INTO episodes (book_id, episode_number, content, summary)
         VALUES ($1,$2,$3,$4)`,
        [newBookId, copyEp, epRow.content, fallback]
      );
      await client.query(
        "UPDATE books SET current_episode = $1 WHERE id = $2",
        [copyEp + 1, newBookId]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[error] transaction rolled back:", err.message);
    process.exit(1);
  } finally {
    client.release();
  }

  if (redisCtx) {
    await redis.set(`context:${newBookId}`, redisCtx);
  }

  console.log("\n✅ clone complete");
  console.log(`new book_id: ${newBookId}`);
  console.log(`title: ${title}`);
  console.log(`copied: world_configs=${wc.rows.length} world_rules=${wr.rows.length} canonical_characters=${cc.rows.length} characters_user=${usrChars.rows.length} redis_context=${redisCtx?"yes":"no"} episode=${epRow?copyEp:"none"}`);
  console.log(`excluded (NOT copied): run_traces, episode_snapshots, foreshadows, arc_summaries, character_dynamic_states, character_arcs, character_inferred_states, validation_logs, revision_logs, trajectory_rewards, dpo_pairs, author_interventions`);

  await pool.end();
  await redis.quit();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
