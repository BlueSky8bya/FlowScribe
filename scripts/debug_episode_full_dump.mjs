/**
 * debug_episode_full_dump.mjs — 책의 모든 화 본문/상태/plan 덤프 (서사 흐름 forensic용)
 *
 * Usage:
 *   node scripts/debug_episode_full_dump.mjs --book-id <id> --max-ep 5 --out logs/forensic/<name>.json
 */
import pg from "pg";
import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const maxEp = parseInt(args[args.indexOf("--max-ep") + 1] ?? "5", 10);
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;

if (!bookId) { console.error("Usage: --book-id <uuid> [--max-ep N] [--out path]"); process.exit(1); }

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const book = await pool.query(`SELECT id, title, current_episode, context FROM books WHERE id=$1`, [bookId]);
  if (!book.rows.length) { console.error("book not found"); process.exit(1); }

  const eps = await pool.query(
    `SELECT episode_number, content, summary, LENGTH(content) AS len
     FROM episodes WHERE book_id=$1 AND episode_number<=$2 ORDER BY episode_number ASC`,
    [bookId, maxEp]
  );

  const dynStates = await pool.query(
    `SELECT episode_number, character_name, location, physical_state, emotional_state, recent_goal, items
     FROM character_dynamic_states WHERE book_id=$1 AND episode_number<=$2
     ORDER BY episode_number ASC, character_name ASC`,
    [bookId, maxEp]
  );

  const foreshadows = await pool.query(
    `SELECT id, planted_episode, resolved_episode, content, status, keywords
     FROM foreshadows WHERE book_id=$1 ORDER BY planted_episode ASC, id ASC`,
    [bookId]
  );

  const arcs = await pool.query(
    `SELECT arc_number, episode_start, episode_end, summary FROM arc_summaries WHERE book_id=$1 ORDER BY arc_number ASC`,
    [bookId]
  ).catch(() => ({ rows: [] }));

  const charArcs = await pool.query(
    `SELECT character_name, episode_number, state, key_events FROM character_arcs WHERE book_id=$1 ORDER BY episode_number ASC, character_name ASC`,
    [bookId]
  ).catch(() => ({ rows: [] }));

  const traces = await pool.query(
    `SELECT episode_number, run_id, plan_verdict, final_score, planner_provider, planner_model, renderer_provider, renderer_model,
            run_started_at, plan_fallback_used,
            LEFT(scene_plan::text, 4000) AS plan_excerpt
     FROM run_traces WHERE book_id=$1 AND episode_number<=$2
     ORDER BY episode_number ASC, run_started_at DESC`,
    [bookId, maxEp]
  ).catch(() => ({ rows: [] }));

  const snaps = await pool.query(
    `SELECT episode_number, effective_context FROM episode_snapshots WHERE book_id=$1 AND episode_number<=$2
     ORDER BY episode_number ASC`,
    [bookId, maxEp]
  ).catch(() => ({ rows: [] }));

  const out = {
    book: book.rows[0],
    episodes: eps.rows.map(r => ({
      ep: r.episode_number,
      len: r.len,
      summary: r.summary,
      content: r.content,
    })),
    dynamic_states: dynStates.rows,
    foreshadows: foreshadows.rows,
    arc_summaries: arcs.rows,
    character_arcs: charArcs.rows,
    traces: traces.rows,
    snapshots: snaps.rows.map(r => ({
      ep: r.episode_number,
      effective_context: r.effective_context,
    })),
  };

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
    console.log(`written: ${outPath}`);
  } else {
    console.log(JSON.stringify(out, null, 2));
  }

  await pool.end();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
