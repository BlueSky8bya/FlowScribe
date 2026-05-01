/**
 * r5b4a_route_comparison.mjs — R5B-4a Same-Plan Renderer Route Comparison
 *
 * .tmp/r5b4a_fixtures/ep<N>.json (R5B-4a fixture)을 읽어, 동일 plan + ctx에 대해
 * 다른 renderer route를 호출하고 narrative repetition / closing sim / cost / latency를
 * 측정한다.
 *
 * 비교 대상 route:
 *   - high_quality_ensemble (현재 baseline; renderer = deepseek-chat)
 *   - openai_renderer       (renderer = openai gpt-4.1-mini)
 *   - gemini_renderer       (renderer = gemini-2.5-flash)
 *
 * 출력:
 *   - 본문은 .tmp/r5b4a_outputs/<route>/ep<N>.txt (gitignored)
 *   - 메트릭은 .tmp/r5b4a_metrics_<route>.json (gitignored)
 *   - 비교 요약은 stdout (보고서 작성용)
 *
 * Usage:
 *   node scripts/r5b4a_route_comparison.mjs --routes high_quality_ensemble,openai_renderer,gemini_renderer --eps 76-90
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { config } from "dotenv";
config();  // dist 모듈 import 전에 .env 로드해야 buildClient가 OPENAI_API_KEY 등을 정상 인식
const { renderFromPlanWithTrace } = await import("../dist/pipeline/renderer.js");
const { checkNarrativeRepetition } = await import("../dist/lib/narrative_repetition_guard.js");
const { extractClosingScene, jaccardSim } = await import("../dist/lib/discovery_signature.js");

const args = process.argv.slice(2);
const routesArg = args[args.indexOf("--routes") + 1] ?? "high_quality_ensemble,openai_renderer,gemini_renderer";
const epsArg    = args[args.indexOf("--eps") + 1] ?? "76-90";

const ROUTES = routesArg.split(",").map(s => s.trim()).filter(Boolean);
const m = epsArg.match(/^(\d+)-(\d+)$/);
if (!m) { console.error("--eps format: from-to"); process.exit(1); }
const epFrom = parseInt(m[1], 10);
const epTo = parseInt(m[2], 10);

const FIXTURE_DIR = ".tmp/r5b4a_fixtures";
const OUTPUT_BASE = ".tmp/r5b4a_outputs";

// 모델별 1K token cost (USD, OpenAI/DeepSeek/Gemini 2025-05 기준 추정)
//   본 비교는 추정값 — 실제 청구는 provider 측정.
const COST_PER_1K_TOKENS = {
  "deepseek-chat":     { input: 0.00027, output: 0.0011 },
  "gpt-4.1-mini":      { input: 0.0004,  output: 0.0016 },
  "gemini-2.5-flash":  { input: 0.000075, output: 0.0003 },
};

function approxTokens(s) {
  // 한국어/영어 mix 보수 추정: 1.5자/token ≒ 0.67 tokens/char
  return Math.ceil((s ?? "").length / 1.5);
}

// fixture의 parsed_plan은 raw LLM 출력이라 renderer가 기대하는 enriched 필드가 없음.
// 본 비교는 same plan 가정이므로 missing 필드를 동일한 default로 일관되게 채운다.
function enrichPlanForRender(plan, ctx) {
  return {
    ...plan,
    forbidden_actions: plan.forbidden_actions ?? [],
    must_keep_items:   plan.must_keep_items   ?? [],
    target_length:     plan.target_length     ?? 1500,
    pov_contract:      plan.pov_contract      ?? `${ctx.gen_config?.pov ?? "3인칭 관찰자"} 시점으로 일관되게 서술한다.`,
    opening_location:  plan.opening_location  ?? plan.scene_beats?.[0]?.location ?? "장소 미상",
    opening_time_context: plan.opening_time_context ?? "직전 화 직후",
    ending_constraint: plan.ending_constraint ?? "cliff",
    // hook 관련은 그대로 (parsed_plan에 있음)
  };
}

async function runOneRoute(routeKey, fixtures) {
  const outDir = `${OUTPUT_BASE}/${routeKey}`;
  mkdirSync(outDir, { recursive: true });
  const records = [];
  console.log(`\n=== route: ${routeKey} ===`);
  for (const fx of fixtures) {
    const ep = fx.episode_number;
    const plan = enrichPlanForRender(fx.plan, fx.ctx);
    const ctx  = fx.ctx;
    const t0 = Date.now();
    let text = "", model = "?", system_prompt = "", user_prompt = "";
    try {
      const r = await renderFromPlanWithTrace(
        plan, ctx,
        /*modelOverride*/ undefined,
        /*routeSetOverride*/ routeKey,
        /*onChunk*/ undefined,           // batch — streaming 안 함
      );
      text = r.text;
      model = r.model_used;
      system_prompt = r.system_prompt;
      user_prompt = r.user_prompt;
    } catch (err) {
      console.log(`  ep${ep}: FAILED — ${err.message}`);
      records.push({ episode: ep, error: err.message });
      continue;
    }
    const elapsed = Date.now() - t0;
    // raw 본문은 .tmp/에 저장 (gitignored)
    writeFileSync(`${outDir}/ep${ep}.txt`, text, "utf8");
    const inTok = approxTokens(system_prompt + user_prompt);
    const outTok = approxTokens(text);
    const costRow = COST_PER_1K_TOKENS[model.replace(/^.*\//, "")] ?? COST_PER_1K_TOKENS[model] ?? null;
    const cost = costRow ? (inTok / 1000 * costRow.input + outTok / 1000 * costRow.output) : null;
    records.push({
      episode: ep, model_used: model,
      elapsed_ms: elapsed, chars: text.length,
      input_tokens_approx: inTok, output_tokens_approx: outTok,
      cost_usd_approx: cost,
    });
    console.log(`  ep${ep}: ${text.length}ch  ${elapsed}ms  in=${inTok}/out=${outTok}  cost=${cost?.toFixed(4) ?? "?"}`);
  }
  return records;
}

async function main() {
  // load fixtures
  const fixtures = [];
  for (let ep = epFrom; ep <= epTo; ep++) {
    const p = `${FIXTURE_DIR}/ep${ep}.json`;
    if (!existsSync(p)) continue;
    fixtures.push(JSON.parse(readFileSync(p, "utf8")));
  }
  console.log(`fixtures: ${fixtures.length} (ep${epFrom}-${epTo})`);
  if (fixtures.length === 0) { console.error("no fixtures"); process.exit(1); }

  // run
  const allMetrics = {};
  for (const route of ROUTES) {
    allMetrics[route] = await runOneRoute(route, fixtures);
    writeFileSync(`.tmp/r5b4a_metrics_${route}.json`, JSON.stringify(allMetrics[route], null, 2), "utf8");
  }

  // measure narrative repetition per route (인접 화 비교 + closing sim)
  console.log("\n=== Narrative repetition per route ===");
  for (const route of ROUTES) {
    const outs = [];
    for (let ep = epFrom; ep <= epTo; ep++) {
      const p = `${OUTPUT_BASE}/${route}/ep${ep}.txt`;
      if (!existsSync(p)) continue;
      outs.push({ episode: ep, content: readFileSync(p, "utf8") });
    }
    let totalExactDup = 0;
    let totalRetry = 0, totalPass = 0;
    let maxClosing = 0, maxAdjFull = 0;
    for (let i = 1; i < outs.length; i++) {
      const recent = outs.slice(Math.max(0, i - 3), i);
      const r = checkNarrativeRepetition(outs[i].content, recent);
      totalExactDup += r.exact_duplicate_count;
      if (r.verdict === "RETRY") totalRetry++; else totalPass++;
      if (r.closing_scene_similarity > maxClosing) maxClosing = r.closing_scene_similarity;
      if (r.adjacent_full_similarity > maxAdjFull) maxAdjFull = r.adjacent_full_similarity;
    }
    allMetrics[`${route}__rep`] = { totalExactDup, totalRetry, totalPass, maxClosing, maxAdjFull };
    console.log(`  ${route}: PASS=${totalPass} RETRY=${totalRetry}  exact_dup=${totalExactDup}  max_closing=${maxClosing.toFixed(3)}  max_adj_full=${maxAdjFull.toFixed(3)}`);
  }

  // aggregate cost / latency
  console.log("\n=== Cost / latency per route (sum / avg) ===");
  for (const route of ROUTES) {
    const recs = allMetrics[route].filter(r => !r.error);
    const totalCost = recs.reduce((s, r) => s + (r.cost_usd_approx ?? 0), 0);
    const avgElapsed = recs.length ? recs.reduce((s, r) => s + r.elapsed_ms, 0) / recs.length : 0;
    const avgChars = recs.length ? recs.reduce((s, r) => s + r.chars, 0) / recs.length : 0;
    console.log(`  ${route}: total_cost=${totalCost.toFixed(4)}  avg_elapsed=${avgElapsed.toFixed(0)}ms  avg_chars=${avgChars.toFixed(0)}`);
    allMetrics[`${route}__agg`] = { totalCost, avgElapsed, avgChars };
  }

  // summary
  const summary = {
    eps: { from: epFrom, to: epTo, count: fixtures.length },
    routes: ROUTES,
    metrics: allMetrics,
  };
  writeFileSync(".tmp/r5b4a_comparison_summary.json", JSON.stringify(summary, null, 2), "utf8");
  console.log("\nwritten: .tmp/r5b4a_comparison_summary.json");
}
main().catch(e => { console.error("FATAL:", e); process.exit(1); });
