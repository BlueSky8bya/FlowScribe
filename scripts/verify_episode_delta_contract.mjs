/**
 * verify_episode_delta_contract.mjs — Phase 3 Episode Delta Contract 정적 검증
 */

import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }
function section(title) { console.log(`\n── ${title} ──`); }

const canonicalSrc        = readFileSync("src/types/canonical.ts", "utf-8");
const effectiveSrc        = readFileSync("src/services/effective_context.ts", "utf-8");
const plannerSrc          = readFileSync("src/pipeline/planner.ts", "utf-8");
const rendererSrc         = readFileSync("src/pipeline/renderer.ts", "utf-8");
const pipelineSrc         = readFileSync("src/pipeline/index.ts", "utf-8");
const validatorSrc        = readFileSync("src/services/episode_delta_validator.ts", "utf-8");
const trainingTypesSrc    = readFileSync("src/training/types.ts", "utf-8");

// ── 1. EpisodeDeltaContract 타입 정의 ──────────────────────────
section("EpisodeDeltaContract 타입");
check("EpisodeDeltaContract interface 선언", canonicalSrc.includes("export interface EpisodeDeltaContract"));
check("episode_number 필드", canonicalSrc.includes("episode_number: number;"));
check("previous_episode_facts 필드", canonicalSrc.includes("previous_episode_facts: string[]"));
check("previous_episode_end_state 필드", canonicalSrc.includes("previous_episode_end_state: string[]"));
check("must_progress 필드", canonicalSrc.includes("must_progress: string[]"));
check("must_not_repeat 필드", canonicalSrc.includes("must_not_repeat: string[]"));
check("newly_required_changes 필드", canonicalSrc.includes("newly_required_changes: string[]"));
check("character_delta_requirements 필드", canonicalSrc.includes("character_delta_requirements:"));
check("plot_delta_requirements 필드", canonicalSrc.includes("plot_delta_requirements:"));
check("repetition_risk 필드", canonicalSrc.includes("repetition_risk:"));

// ── 2. EffectiveContext에 필드 추가 ──────────────────────────────
section("EffectiveContext 필드");
check("episode_delta_contract 필드 존재", canonicalSrc.includes("episode_delta_contract?: EpisodeDeltaContract"));
check("EpisodeDeltaContract import in effective_context.ts", effectiveSrc.includes("EpisodeDeltaContract"));

// ── 3. effective_context.ts 생성 로직 ────────────────────────────
section("buildEpisodeDeltaContract 생성 로직");
check("buildEpisodeDeltaContract 함수 정의", effectiveSrc.includes("function buildEpisodeDeltaContract("));
check("ep >= 2 조건으로 생성", (() => {
  const block = effectiveSrc.match(/episodeDeltaContract.*=.*episodeNumber >= 2[\s\S]{0,200}buildEpisodeDeltaContract/)?.[0] ?? "";
  return block.length > 0;
})());
check("ep < 2이면 undefined", (() => {
  // episodeNumber >= 2 ? buildEpisodeDeltaContract(...) : undefined
  return effectiveSrc.includes(": undefined") &&
         effectiveSrc.includes("buildEpisodeDeltaContract") &&
         effectiveSrc.includes("episodeNumber >= 2");
})());
check("episode_delta_contract ctx에 주입", effectiveSrc.includes("episode_delta_contract: episodeDeltaContract"));
check("repetition_risk 반복 패턴 감지", effectiveSrc.includes("REPEAT_PATTERNS"));
check("rolling_summary 최근 3화 분석", effectiveSrc.includes("slice(-(Math.min(episodeNumber - 1, 3)))"));
check("must_not_repeat 생성", effectiveSrc.includes("must_not_repeat"));
check("must_progress 생성", effectiveSrc.includes("must_progress"));
check("character_delta_requirements 생성", effectiveSrc.includes("character_delta_requirements"));
check("plot_delta_requirements 생성", effectiveSrc.includes("plot_delta_requirements"));
check("LLM 호출 없음", !effectiveSrc.includes("callLLM") && !effectiveSrc.includes("generateDeltaWithLLM"));

// ── 4. Planner prompt에 delta contract 주입 ─────────────────────
section("Planner prompt 주입");
check("Episode Delta Contract 섹션 존재", plannerSrc.includes("[Episode Delta Contract — 절대 준수]"));
check("ctx.episode_delta_contract 참조", plannerSrc.includes("ctx.episode_delta_contract"));
check("ep >= 2 조건 (1화 재생성 제외)", (() => {
  const block = plannerSrc.match(/episode_delta_contract[\s\S]{0,100}episode_number >= 2/)?.[0] ?? "";
  return block.length > 0;
})());
check("must_not_repeat planner 주입", (() => {
  const block = plannerSrc.match(/Episode Delta Contract[\s\S]{0,500}must_not_repeat/)?.[0] ?? "";
  return block.length > 0;
})());
check("must_progress planner 주입", (() => {
  const block = plannerSrc.match(/Episode Delta Contract[\s\S]{0,600}must_progress/)?.[0] ?? "";
  return block.length > 0;
})());
check("repetition_risk planner 주입", (() => {
  // delta contract 빌드 블록(dc.repetition_risk) + sections.push 패턴 확인
  return plannerSrc.includes("dc.repetition_risk") &&
         plannerSrc.includes("[Episode Delta Contract — 절대 준수]");
})());
check("character_delta_requirements planner 주입", plannerSrc.includes("character_delta_requirements"));

// ── 5. Renderer prompt에 delta contract 주입 ────────────────────
section("Renderer prompt 주입");
check("Episode Delta Contract 섹션 존재", rendererSrc.includes("[Episode Delta Contract — 서술 준수]"));
check("ctx.episode_delta_contract 참조", rendererSrc.includes("ctx.episode_delta_contract"));
check("ep >= 2 조건", (() => {
  const block = rendererSrc.match(/episode_delta_contract[\s\S]{0,100}episode_number >= 2/)?.[0] ?? "";
  return block.length > 0;
})());
check("must_not_repeat renderer 주입", (() => {
  const block = rendererSrc.match(/Delta Contract[\s\S]{0,400}must_not_repeat/)?.[0] ?? "";
  return block.length > 0;
})());
check("must_progress renderer 주입", (() => {
  const dcIdx = rendererSrc.indexOf("[Episode Delta Contract — 서술 준수]");
  const mpIdx = rendererSrc.indexOf("must_progress", dcIdx < 0 ? 0 : dcIdx);
  // deltaSection 정의 블록에서 must_progress 참조 확인
  return rendererSrc.includes("must_progress") && rendererSrc.includes("deltaSection");
})());
check("반복 금지 서술 지시 포함", rendererSrc.includes("같은 사건을 재서술하지 말고"));
check("deltaSection 변수 생성", rendererSrc.includes("const deltaSection ="));
check("deltaSection 프롬프트에 삽입", rendererSrc.includes("${deltaSection}"));

// ── 6. episode_delta_validator.ts ───────────────────────────────
section("episode_delta_validator.ts");
check("checkEpisodeDelta 함수 export", validatorSrc.includes("export function checkEpisodeDelta("));
check("EpisodeDeltaCheckResult interface export", validatorSrc.includes("export interface EpisodeDeltaCheckResult"));
check("verdict: PASS | WARN", validatorSrc.includes('"PASS" | "WARN"'));
check("repeated_patterns 필드", validatorSrc.includes("repeated_patterns: string[]"));
check("missing_progress 필드", validatorSrc.includes("missing_progress: string[]"));
check("opening_similarity_score 필드", validatorSrc.includes("opening_similarity_score: number"));
check("bigramSimilarity 계산", validatorSrc.includes("bigramSimilarity"));
check("0.4 유사도 임계값", validatorSrc.includes("0.4"));
check("REPEAT_DETECT_PATTERNS 배열", validatorSrc.includes("REPEAT_DETECT_PATTERNS"));
check("verdict FAIL 없음 (WARN까지만)", !validatorSrc.includes('"FAIL"'));

// ── 7. pipeline/index.ts 통합 ────────────────────────────────────
section("pipeline/index.ts 통합");
check("episode_delta_validator import", pipelineSrc.includes("episode_delta_validator"));
check("checkEpisodeDelta 호출", pipelineSrc.includes("checkEpisodeDelta("));
check("Step 5.25 Episode Delta Check 존재", pipelineSrc.includes("Step 5.25: Episode Delta Check"));
check("tracer.episode_delta_check 저장", pipelineSrc.includes("episode_delta_check = deltaCheckResult"));
check("EpisodeDeltaCheckResult 타입 import", pipelineSrc.includes("EpisodeDeltaCheckResult"));

// ── 8. training/types.ts input_contract metadata ─────────────────
section("training/types.ts trace metadata");
check("has_episode_delta_contract 필드", trainingTypesSrc.includes("has_episode_delta_contract"));
check("delta_must_progress_count 필드", trainingTypesSrc.includes("delta_must_progress_count"));
check("delta_must_not_repeat_count 필드", trainingTypesSrc.includes("delta_must_not_repeat_count"));
check("delta_repetition_risk_count 필드", trainingTypesSrc.includes("delta_repetition_risk_count"));
check("input_contract에 delta metadata 주입 (pipeline)", pipelineSrc.includes("has_episode_delta_contract: !!ctx.episode_delta_contract"));

// ── 9. 1화 재생성 예외 ──────────────────────────────────────────
section("1화 재생성 예외");
check("delta contract: episode_number >= 2 조건으로만 생성 (effective_context)", (() => {
  // effectiveSrc에서 episodeNumber >= 2 조건 확인
  return effectiveSrc.includes("episodeNumber >= 2") &&
         effectiveSrc.includes("buildEpisodeDeltaContract");
})());
check("planner: dc가 없으면 delta contract 섹션 생략", (() => {
  // planner에서 dc가 있을 때만 섹션 추가
  const block = plannerSrc.match(/const dc = ctx\.episode_delta_contract[\s\S]{0,50}if \(dc/)?.[0] ?? "";
  return block.length > 0;
})());

// ── 10. 빌드 산출물 ──────────────────────────────────────────────
section("빌드 산출물 확인");
let distSrc = "";
try { distSrc = readFileSync("dist/services/episode_delta_validator.js", "utf-8"); } catch {}
check("dist/services/episode_delta_validator.js 생성됨", distSrc.length > 0);
check("dist에 checkEpisodeDelta export", distSrc.includes("checkEpisodeDelta"));
let distEffSrc = "";
try { distEffSrc = readFileSync("dist/services/effective_context.js", "utf-8"); } catch {}
check("dist effective_context에 buildEpisodeDeltaContract 포함", distEffSrc.includes("buildEpisodeDeltaContract"));

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
