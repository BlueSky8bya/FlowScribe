/**
 * forensic_generation_trace.mjs
 * smoke book 생성 trace forensic audit
 * Usage: node scripts/forensic_generation_trace.mjs --book-id <uuid>
 */
import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookIdIdx = args.indexOf("--book-id");
const BOOK = bookIdIdx !== -1 ? args[bookIdIdx + 1] : null;
if (!BOOK) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SPECIAL_TOKEN_RE = /<unused\d+>|<\|[a-z_]+\|>|<unk>|<pad>/g;
const HASHTAG_RE = /#[a-z_][a-z0-9_]*/g;
const FOREIGN_FRAGMENT_RE = /[a-z]{4,}(?:\s+[a-z]{3,})*/gi;
const ALLOWED_FRAGMENT = /^(CLIFF|END|AI|OK|USB|PC|TV|IT|SF|DNA|ID|IP|API|JSON|HTML)$/i;

function scanContamination(text) {
  if (!text) return { special: 0, foreign: 0, snippets: [] };
  const specialMatches = [...text.matchAll(SPECIAL_TOKEN_RE)].map(m => m[0]);
  const hashMatches = [...text.matchAll(HASHTAG_RE)].map(m => m[0]);
  const foreignMatches = [...text.matchAll(FOREIGN_FRAGMENT_RE)]
    .map(m => m[0].trim())
    .filter(m => !ALLOWED_FRAGMENT.test(m.split(' ')[0]) && m.length > 3)
    .slice(0, 5);
  return {
    special: specialMatches.length,
    foreign: foreignMatches.length + hashMatches.length,
    snippets: [...specialMatches, ...hashMatches, ...foreignMatches].slice(0, 5),
  };
}

async function run() {
  const [episodes, traces, dynStates, canonChars] = await Promise.all([
    pool.query(`SELECT episode_number, length(content) chars, left(content, 50) preview FROM episodes WHERE book_id=$1 ORDER BY episode_number`, [BOOK]),
    pool.query(`SELECT trace_id, episode_number, final_verdict, final_score, renderer_trace FROM run_traces WHERE book_id=$1 ORDER BY episode_number, created_at`, [BOOK]),
    pool.query(`SELECT DISTINCT character_name FROM character_dynamic_states WHERE book_id=$1`, [BOOK]),
    pool.query(`SELECT name FROM canonical_characters WHERE book_id=$1`, [BOOK]),
  ]);

  const canonNames = new Set(canonChars.rows.map(r => r.name));
  const dynNames = new Set(dynStates.rows.map(r => r.character_name));
  const nonCanonDyn = [...dynNames].filter(n => !canonNames.has(n));

  console.log("\n═══════════════════════════════════════════════════════");
  console.log(" FORENSIC GENERATION TRACE REPORT");
  console.log(` Book: ${BOOK}`);
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("── Episode Summary ──────────────────────────────────");
  episodes.rows.forEach(e => {
    console.log(`  ep${e.episode_number}: ${e.chars} chars`);
  });
  const totalChars = episodes.rows.reduce((s, r) => s + parseInt(r.chars), 0);
  const avgChars = episodes.rows.length ? Math.round(totalChars / episodes.rows.length) : 0;
  console.log(`  Total: ${totalChars} chars / Avg: ${avgChars} chars/ep`);

  console.log("\n── Run Trace Summary ────────────────────────────────");
  const byEp = {};
  traces.rows.forEach(t => {
    if (!byEp[t.episode_number]) byEp[t.episode_number] = [];
    byEp[t.episode_number].push(t);
  });
  Object.entries(byEp).forEach(([ep, ts]) => {
    const verdicts = ts.map(t => `${t.final_verdict}(${t.final_score})`).join(', ');
    console.log(`  ep${ep}: ${ts.length} trace(s) — ${verdicts}`);
  });

  console.log("\n── Body Contamination Scan ──────────────────────────");
  for (const trace of traces.rows) {
    const rt = trace.renderer_trace;
    if (!rt) continue;
    const rawText = typeof rt === 'string' ? rt : (rt.generated_text ?? JSON.stringify(rt));
    const scan = scanContamination(rawText);
    if (scan.special > 0 || scan.foreign > 0) {
      console.log(`  ep${trace.episode_number} trace raw: special=${scan.special} foreign=${scan.foreign} → ${JSON.stringify(scan.snippets)}`);
    }
  }
  // Also scan final episode content
  for (const ep of episodes.rows) {
    // noop
    const res = await pool.query(`SELECT content FROM episodes WHERE book_id=$1 AND episode_number=$2`, [BOOK, ep.episode_number]);
    const text = res.rows[0]?.content ?? "";
    const scan = scanContamination(text);
    const status = scan.special === 0 && scan.foreign === 0 ? "CLEAN" : `CONTAMINATED special=${scan.special} foreign=${scan.foreign}`;
    console.log(`  ep${ep.episode_number} final body: ${status}${scan.snippets.length ? " → " + JSON.stringify(scan.snippets) : ""}`);
  }

  console.log("\n── Character State Integrity ────────────────────────");
  console.log(`  Canonical chars: ${[...canonNames].join(', ')}`);
  console.log(`  Dynamic state names: ${[...dynNames].join(', ')}`);
  if (nonCanonDyn.length) {
    console.log(`  ⚠ NON-CANONICAL in dynamic states: ${nonCanonDyn.join(', ')}`);
  } else {
    console.log(`  ✓ All dynamic state names are canonical`);
  }

  console.log("\n── World Config Check ───────────────────────────────");
  const worldRules = await pool.query(`SELECT count(*) FROM world_rules WHERE book_id=$1`, [BOOK]).catch(() => ({ rows: [{ count: 0 }] }));
  const worldConfigs = await pool.query(`SELECT count(*) FROM world_configs WHERE book_id=$1`, [BOOK]).catch(() => ({ rows: [{ count: 0 }] }));
  const Redis = require("ioredis");
  const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  const redisCtx = await redis.get(`context:${BOOK}`).catch(() => null);
  redis.quit();
  const redisRules = redisCtx ? (JSON.parse(redisCtx).world_rules?.length ?? 0) : 0;
  console.log(`  world_rules table: ${worldRules.rows[0].count} rows`);
  console.log(`  world_configs table: ${worldConfigs.rows[0].count} rows`);
  console.log(`  Redis context world_rules: ${redisRules}`);
  if (redisRules === 0 && worldRules.rows[0].count === 0) {
    console.log(`  ⚠ WORLD RULES MISSING — generation context will have 0 rules`);
  } else {
    console.log(`  ✓ World rules present (Redis: ${redisRules})`);
  }

  console.log("\n── Foreshadow Count ─────────────────────────────────");
  const foreshadows = await pool.query(`SELECT planted_episode, count(*) FROM foreshadows WHERE book_id=$1 GROUP BY planted_episode ORDER BY planted_episode`, [BOOK]).catch(() => ({ rows: [] }));
  if (foreshadows.rows.length) {
    foreshadows.rows.forEach(r => console.log(`  ep${r.planted_episode}: ${r.count} foreshadows`));
    const total = foreshadows.rows.reduce((s, r) => s + parseInt(r.count), 0);
    if (total > 15) console.log(`  ⚠ Total foreshadows ${total} — may be excessive for context window`);
  } else {
    console.log("  No foreshadows");
  }

  console.log("\n═══════════════════════════════════════════════════════");
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
