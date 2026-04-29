/**
 * audit_generation_quality_integrity.mjs
 * 통합 생성 품질/무결성 감사
 * Usage: node scripts/audit_generation_quality_integrity.mjs --book-id <uuid>
 */
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
const FOREIGN_RE = /[a-z]{5,}(?:\s+[a-z]{4,})*/gi;
const ALLOWED = /^(CLIFF|END|AI|OK|USB|PC|TV|SF|DNA|ID|IP|API|JSON|HTML|CSS|Echoing|Forgotten|Ruins|Mist)$/i;
const NON_KO = /[Ѐ-ӿ؀-ۿ฀-๿]/g;

async function run() {
  const [canonChars, episodes, dynStates] = await Promise.all([
    pool.query(`SELECT name FROM canonical_characters WHERE book_id=$1`, [BOOK]),
    pool.query(`SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`, [BOOK]),
    pool.query(`SELECT DISTINCT character_name FROM character_dynamic_states WHERE book_id=$1`, [BOOK]),
  ]);

  const canonNames = new Set(canonChars.rows.map(r => r.name));
  const dynNames = [...new Set(dynStates.rows.map(r => r.character_name))];
  const nonCanonDyn = dynNames.filter(n => !canonNames.has(n));

  const Redis = require("ioredis");
  const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  const redisCtx = await redis.get(`context:${BOOK}`).catch(() => null);
  redis.quit();
  const worldRulesCount = redisCtx ? (JSON.parse(redisCtx).world_rules?.length ?? 0) : 0;

  let totalSpecial = 0, totalForeign = 0, totalNonKo = 0;
  const epResults = [];

  for (const ep of episodes.rows) {
    const text = ep.content;
    const special = [...text.matchAll(SPECIAL_TOKEN_RE)].length;
    const hash = [...text.matchAll(HASHTAG_RE)].length;
    const foreign = [...text.matchAll(FOREIGN_RE)].filter(m => !ALLOWED.test(m[0].trim().split(' ')[0])).length;
    const nonKo = [...text.matchAll(NON_KO)].length;
    totalSpecial += special;
    totalForeign += foreign + hash;
    totalNonKo += nonKo;
    epResults.push({ ep: ep.episode_number, chars: text.length, special, foreign: foreign + hash, nonKo });
  }

  const traces = await pool.query(`SELECT final_verdict, final_score FROM run_traces WHERE book_id=$1`, [BOOK]);
  const passCount = traces.rows.filter(r => r.final_verdict === 'PASS').length;
  const warnCount = traces.rows.filter(r => r.final_verdict === 'WARN').length;
  const failCount = traces.rows.filter(r => r.final_verdict === 'FAIL').length;
  const avgScore = traces.rows.length
    ? Math.round(traces.rows.reduce((s, r) => s + (r.final_score || 0), 0) / traces.rows.length)
    : 0;

  console.log(`\n╔═══════════════════════════════════════════════════════╗`);
  console.log(` GENERATION QUALITY INTEGRITY AUDIT — ${BOOK.slice(0,8)}...`);
  console.log(`╚═══════════════════════════════════════════════════════╝\n`);

  console.log("┌─ Episode Body Scan ─────────────────────────────────");
  epResults.forEach(r => {
    const status = r.special === 0 && r.foreign === 0 && r.nonKo === 0 ? "CLEAN" : `CONTAMINATED`;
    const detail = [];
    if (r.special) detail.push(`special=${r.special}`);
    if (r.foreign) detail.push(`foreign=${r.foreign}`);
    if (r.nonKo) detail.push(`nonKo=${r.nonKo}`);
    console.log(`│  ep${r.ep}: ${r.chars}chars ${status}${detail.length ? ' ' + detail.join(' ') : ''}`);
  });
  console.log("├─ Body Contamination Summary ────────────────────────");
  console.log(`│  special_token_count: ${totalSpecial}`);
  console.log(`│  foreign_fragment_count: ${totalForeign}`);
  console.log(`│  non_ko_script_count: ${totalNonKo}`);

  console.log("├─ Character State Integrity ─────────────────────────");
  console.log(`│  canonical: ${[...canonNames].join(', ')}`);
  console.log(`│  dynamic_state names: ${dynNames.join(', ')}`);
  if (nonCanonDyn.length) {
    console.log(`│  ⚠ non-canonical in DB: ${nonCanonDyn.join(', ')}`);
  } else {
    console.log(`│  ✓ dynamic states: all canonical`);
  }

  console.log("├─ World Config Inclusion ────────────────────────────");
  console.log(`│  world_rules_in_context: ${worldRulesCount}`);
  if (worldRulesCount === 0) console.log(`│  ⚠ WORLD RULES MISSING`);

  console.log("├─ Run Trace Quality ─────────────────────────────────");
  console.log(`│  traces: ${traces.rows.length} (PASS=${passCount} WARN=${warnCount} FAIL=${failCount})`);
  console.log(`│  avg_score: ${avgScore}`);

  // Verdict
  const issues = [];
  if (totalSpecial > 0) issues.push(`special_tokens(${totalSpecial})`);
  if (totalForeign > 0) issues.push(`foreign_fragments(${totalForeign})`);
  if (nonCanonDyn.length) issues.push(`non_canonical_states(${nonCanonDyn.join(',')})`);
  if (worldRulesCount === 0) issues.push(`world_rules_missing`);
  if (avgScore < 50) issues.push(`avg_score_low(${avgScore})`);

  console.log("└─ Verdict ───────────────────────────────────────────");
  if (issues.length === 0) {
    console.log("  ✅ CLEAN — no integrity issues found");
  } else {
    console.log(`  ❌ ISSUES: ${issues.join(', ')}`);
  }

  await pool.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
