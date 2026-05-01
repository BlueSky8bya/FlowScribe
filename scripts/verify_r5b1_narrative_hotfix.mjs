/**
 * verify_r5b1_narrative_hotfix.mjs — R5B-1
 *
 * Static contract for narrative stagnation triage hotfix.
 *
 * 검증:
 *   1. episode_summary helper 존재 + fallback marker 정의
 *   2. generate.ts / generate_v2.ts / episodes.ts 모두 helper 사용 + ON CONFLICT marker 정책
 *   3. effective_context.ts: rolling_summary가 marker strip 처리
 *   4. STREAK_TRIGGER 4 → 2, recentHistory ep>=4 → ep>=2
 *   5. foreshadow.ts: keyword Jaccard dedup 로직 존재
 *   6. dist 산출물
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const summaryHelper = readFileSync("src/services/episode_summary.ts", "utf8");
const generate    = readFileSync("src/api/generate.ts", "utf8");
const generateV2  = readFileSync("src/api/generate_v2.ts", "utf8");
const episodesApi = readFileSync("src/api/episodes.ts", "utf8");
const effective   = readFileSync("src/services/effective_context.ts", "utf8");
const foreshadow  = readFileSync("src/services/foreshadow.ts", "utf8");

console.log("── [helper] episode_summary.ts ──");
okIf("SUMMARY_FALLBACK_MARKER 정의", /SUMMARY_FALLBACK_MARKER\s*=\s*["']\[\[FALLBACK\]\]["']/.test(summaryHelper));
okIf("buildFallbackSummary export", /export function buildFallbackSummary/.test(summaryHelper));
okIf("generateAndSaveLLMSummary export", /export async function generateAndSaveLLMSummary/.test(summaryHelper));
okIf("idempotent: marker 없으면 skip 로직", /isFallbackSummary|!isFallbackSummary|LIKE\s+\$\d\s*\|\|\s*['"]%['"]|LIKE \$\d \|\| '%'/.test(summaryHelper));

console.log("\n── [generate.ts] summary writer 통합 + ON CONFLICT marker ──");
okIf("buildFallbackSummary import", /from ["']\.\.\/services\/episode_summary\.js["']/.test(generate));
okIf("buildFallbackSummary 사용 (clean)", /buildFallbackSummary\(clean\)/.test(generate));
okIf("ON CONFLICT — fallback marker LIKE 절", /WHEN episodes\.summary LIKE \$\d \|\| ['"]%['"][\s\S]{0,50}THEN EXCLUDED\.summary/.test(generate));
okIf("setImmediate에서 generateAndSaveLLMSummary 호출", /setImmediate[\s\S]{0,500}generateAndSaveLLMSummary/.test(generate));

console.log("\n── [generate_v2.ts] summary writer 통합 + ON CONFLICT marker ──");
okIf("buildFallbackSummary import", /from ["']\.\.\/services\/episode_summary\.js["']/.test(generateV2));
okIf("buildFallbackSummary 사용 (fullText)", /buildFallbackSummary\(fullText\)/.test(generateV2));
okIf("ON CONFLICT — fallback marker LIKE 절", /WHEN episodes\.summary LIKE \$\d \|\| ['"]%['"][\s\S]{0,50}THEN EXCLUDED\.summary/.test(generateV2));
okIf("setImmediate에서 generateAndSaveLLMSummary 호출", /setImmediate[\s\S]{0,500}generateAndSaveLLMSummary/.test(generateV2));

console.log("\n── [episodes.ts] helper 사용 ──");
okIf("buildFallbackSummary import", /from ["']\.\.\/services\/episode_summary\.js["']/.test(episodesApi));
okIf("인라인 summary LLM 호출 제거 (getLLMClient 미사용)", !/getLLMClient\(\)\.chat\.completions\.create/.test(episodesApi));
okIf("generateAndSaveLLMSummary 호출", /generateAndSaveLLMSummary/.test(episodesApi));

console.log("\n── [effective_context.ts] rolling_summary marker strip + STREAK_TRIGGER ──");
okIf("rolling_summary marker strip", /_SUMMARY_FALLBACK_MARKER[\s\S]{0,400}startsWith\(_SUMMARY_FALLBACK_MARKER\)[\s\S]{0,40}slice/.test(effective));
okIf("STREAK_TRIGGER = 2 (R5B-1)", /STREAK_TRIGGER\s*=\s*2/.test(effective));
okIf("STREAK_TRIGGER = 4 잔존 안 함", !/const\s+STREAK_TRIGGER\s*=\s*4/.test(effective));
okIf("recentHistory 조회 ep>=2", /R5B-1[\s\S]{0,200}ep>=4 → ep>=2[\s\S]{0,200}episodeNumber\s*>=\s*2[\s\S]{0,400}character_dynamic_states/.test(effective));

console.log("\n── [foreshadow.ts] lightweight dedup ──");
okIf("Jaccard 계산 함수 _jaccard 정의", /_jaccard\s*=/.test(foreshadow));
okIf("DEDUP_THRESHOLD 0.6", /DEDUP_THRESHOLD\s*=\s*0\.6/.test(foreshadow));
okIf("기존 open 복선 keyword 조회", /SELECT keywords FROM foreshadows[\s\S]{0,100}status='open'/.test(foreshadow));
okIf("dedup skip 시 dedupSkipped 카운터", /dedupSkipped\+\+/.test(foreshadow));
okIf("accepted 만 INSERT", /accepted\.map\(item =>[\s\S]{0,200}INSERT INTO foreshadows/.test(foreshadow));

console.log("\n── [build] dist 산출물 ──");
okIf("dist/services/episode_summary.js", existsSync("dist/services/episode_summary.js"));
okIf("dist/api/generate.js", existsSync("dist/api/generate.js"));
okIf("dist/api/generate_v2.js", existsSync("dist/api/generate_v2.js"));
okIf("dist/api/episodes.js", existsSync("dist/api/episodes.js"));
okIf("dist/services/effective_context.js", existsSync("dist/services/effective_context.js"));
okIf("dist/services/foreshadow.js", existsSync("dist/services/foreshadow.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
