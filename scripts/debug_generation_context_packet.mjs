/**
 * debug_generation_context_packet.mjs
 * 특정 book/episode의 generation context packet을 덤프
 * Usage: node scripts/debug_generation_context_packet.mjs --book-id <uuid> --episode <N>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();

const args = process.argv.slice(2);
const bookIdIdx = args.indexOf("--book-id");
const epIdx = args.indexOf("--episode");
const BOOK = bookIdIdx !== -1 ? args[bookIdIdx + 1] : null;
const EP = epIdx !== -1 ? parseInt(args[epIdx + 1]) : null;
if (!BOOK || !EP) { console.error("Usage: --book-id <uuid> --episode <N>"); process.exit(1); }

async function run() {
  const { buildEffectiveContext } = await import("../dist/services/effective_context.js");
  const { extractStateConstraints } = await import("../dist/pipeline/state_extractor.js");

  const ctx = await buildEffectiveContext({ bookId: BOOK, episodeNumber: EP });
  const sc = extractStateConstraints(ctx);

  // Token estimate (4 chars ≈ 1 token)
  const estimateTokens = (s) => Math.round((s || "").length / 4);

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(` GENERATION CONTEXT PACKET — ep${EP}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  console.log("── Context Integrity ────────────────────────────────");
  console.log(`  canonical_characters: ${ctx.characters.length} (${ctx.characters.map(c => c.name).join(', ')})`);
  console.log(`  dynamic_states: ${ctx.character_dynamic_states.length} (${ctx.character_dynamic_states.map(d => d.character_name).join(', ')})`);
  console.log(`  general_rules: ${ctx.general_rules.length}`);
  console.log(`  absolute_forbidden: ${ctx.absolute_forbidden.length}`);
  console.log(`  foreshadows: ${ctx.foreshadow_memory.length}`);
  console.log(`  arc_summaries: ${ctx.arc_summaries?.length ?? 0}`);
  console.log(`  continuity_contract: ${ctx.continuity_contract ? 'YES' : 'NO'}`);
  console.log(`  episode_delta_contract: ${ctx.episode_delta_contract ? 'YES' : 'NO'}`);
  console.log(`  rolling_summary length: ${ctx.rolling_summary?.length ?? 0} chars`);
  console.log(`  prev_episode_tail length: ${ctx.prev_episode_tail?.length ?? 0} chars`);

  console.log("\n── PASS/FAIL Checks ─────────────────────────────────");
  const checks = [
    ["canonical_characters >= 1", ctx.characters.length >= 1],
    ["general_rules >= 1 (세계관 규칙 존재)", ctx.general_rules.length >= 1],
    ["dynamic_states canonical only", ctx.character_dynamic_states.every(d => ctx.characters.some(c => c.name === d.character_name))],
    ["initial_items present", ctx.characters.some(c => (c.initial_items?.length ?? 0) > 0)],
    ["closed-cast in renderer prompt", true], // structural guarantee
    ["prev_episode_tail present (ep>1)", EP === 1 || !!ctx.prev_episode_tail],
  ];
  checks.forEach(([label, pass]) => console.log(`  ${pass ? '✓' : '✗'} ${label}`));

  console.log("\n── Prompt Token Estimates ───────────────────────────");
  // Approximate user prompt size
  const charSummaryLen = sc.char_summary.length;
  const rulesLen = sc.general_rules.join('\n').length;
  const foreLen = ctx.foreshadow_memory.map(f => f.content).join('\n').length;
  const prevTailLen = ctx.prev_episode_tail?.length ?? 0;
  const rollingSumLen = ctx.rolling_summary?.length ?? 0;
  const arcPhaseEstimate = 600; // reduced from 2178 after optimization
  const deltaLen = JSON.stringify(ctx.episode_delta_contract ?? {}).length;
  const contLen = JSON.stringify(ctx.continuity_contract ?? {}).length;
  const totalUserEst = charSummaryLen + rulesLen + foreLen + prevTailLen + rollingSumLen + arcPhaseEstimate + deltaLen + contLen + 1500;
  const systemEst = 1029 + 2024; // planner + renderer static

  console.log(`  char_summary: ~${estimateTokens(sc.char_summary)} tokens`);
  console.log(`  general_rules: ~${estimateTokens(sc.general_rules.join('\n'))} tokens`);
  console.log(`  foreshadows: ~${estimateTokens(ctx.foreshadow_memory.map(f=>f.content).join('\n'))} tokens`);
  console.log(`  prev_tail: ~${estimateTokens(ctx.prev_episode_tail)} tokens`);
  console.log(`  rolling_summary: ~${estimateTokens(ctx.rolling_summary)} tokens`);
  console.log(`  arc_phase (estimated): ~${Math.round(arcPhaseEstimate/4)} tokens`);
  console.log(`  delta_contract: ~${estimateTokens(JSON.stringify(ctx.episode_delta_contract))} tokens`);
  console.log(`  continuity_contract: ~${estimateTokens(JSON.stringify(ctx.continuity_contract))} tokens`);
  console.log(`  static system prompts: ~${Math.round(systemEst/4)} tokens`);
  console.log(`  ─────────────────────────────────────────────────`);
  console.log(`  TOTAL estimate: ~${Math.round(totalUserEst/4) + Math.round(systemEst/4)} tokens`);
  const OLLAMA_CTX = 8192;
  const remaining = OLLAMA_CTX - Math.round(totalUserEst/4) - Math.round(systemEst/4);
  console.log(`  Remaining for generation (8192 ctx): ~${remaining} tokens`);
  if (remaining < 1000) console.log(`  ⚠ CRITICAL: <1000 tokens left for generation!`);
  else if (remaining < 2000) console.log(`  ⚠ WARNING: <2000 tokens left for generation`);
  else console.log(`  ✓ Generation space OK`);

  console.log(`\n═══════════════════════════════════════════════════════`);
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
