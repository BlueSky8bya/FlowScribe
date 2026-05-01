/**
 * dump_r5b1_8b_review_data.mjs — R5B-1.8B reader-facing review data dump
 *
 * TEST2D ep1~15 본문 + planner emotional_beats를 .tmp/ (gitignored) 에 출력.
 * raw 본문은 보고서에 절대 commit 안 함 — review용 임시 자료.
 *
 * Usage:
 *   node scripts/dump_r5b1_8b_review_data.mjs --book-id <uuid> --max-ep 15 [--out .tmp/r5b1_8b_review.json]
 */
import pg from "pg";
import { writeFileSync, mkdirSync } from "fs";
import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const maxEp = parseInt(args[args.indexOf("--max-ep") + 1] ?? "15", 10);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : ".tmp/r5b1_8b_review.json";
if (!bookId) { console.error("Usage: --book-id <uuid> [--max-ep 15] [--out path]"); process.exit(1); }

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const eps = (await pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 AND episode_number<=$2 ORDER BY episode_number`,
    [bookId, maxEp]
  )).rows;
  const dyn = (await pool.query(
    `SELECT episode_number, character_name, emotional_state, recent_goal, location, visibility_state
     FROM character_dynamic_states WHERE book_id=$1 AND episode_number<=$2
     ORDER BY character_name, episode_number`,
    [bookId, maxEp]
  )).rows;
  const traces = (await pool.query(
    `SELECT DISTINCT ON (episode_number) episode_number, planner_trace
     FROM run_traces
     WHERE book_id=$1 AND episode_number<=$2 AND planner_trace IS NOT NULL
     ORDER BY episode_number, created_at DESC`,
    [bookId, maxEp]
  )).rows;

  // build per-ep payload
  const beatsByEp = {};
  const sceneBeatsByEp = {};
  for (const t of traces) {
    const parsed = t.planner_trace?.parsed_plan;
    beatsByEp[t.episode_number] = Array.isArray(parsed?.character_emotional_beats) ? parsed.character_emotional_beats : [];
    sceneBeatsByEp[t.episode_number] = Array.isArray(parsed?.scene_beats) ? parsed.scene_beats.map(b => ({
      beat_number: b?.beat_number, summary: b?.summary, characters_involved: b?.characters_involved, location: b?.location
    })) : [];
  }

  const dynByEp = {};
  for (const r of dyn) {
    if (!dynByEp[r.episode_number]) dynByEp[r.episode_number] = [];
    dynByEp[r.episode_number].push(r);
  }

  const records = eps.map(e => ({
    episode: e.episode_number,
    content_chars: e.content?.length ?? 0,
    content: e.content,
    scene_beats: sceneBeatsByEp[e.episode_number] ?? [],
    emotional_beats: beatsByEp[e.episode_number] ?? [],
    character_states: dynByEp[e.episode_number] ?? [],
  }));

  mkdirSync(".tmp", { recursive: true });
  writeFileSync(out, JSON.stringify({ book_id: bookId, episodes: records }, null, 2), "utf8");
  console.log(`written: ${out}`);
  console.log(`episodes: ${records.length}, total_chars: ${records.reduce((s,r)=>s+(r.content_chars||0),0)}`);

  await pool.end();
}
main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(1); });
