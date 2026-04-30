/**
 * measure_prompt_budget.mjs — Phase 4.20 R1.5
 *
 * planner / renderer system+user prompt source의 정적 분석.
 *   1. section header 카운트 + 추정 길이
 *   2. negative instruction (금지/하지 말 것/회피) vs positive guidance (허용/권장/자유롭게)
 *   3. 누적 char 수 → 모델 컨텍스트 대비 추정
 *
 * 이 스크립트는 LLM 호출 없음. 코드 grep만. raw prompt 출력 없음.
 *
 * Usage:
 *   node scripts/measure_prompt_budget.mjs [--json]
 *
 * 출력: stdout markdown 또는 JSON (--json).
 */
import { readFileSync, existsSync } from "fs";

const useJson = process.argv.includes("--json");

const NEGATIVE_RE = [
  /금지/g, /하지\s*말/g, /피한다/g, /피해야/g, /절대\s*(금지|불가)/g,
  /막아야/g, /제한/g, /제약/g, /불가능/g, /반복\s*금지/g,
  /허용하지\s*않/g, /등장하지\s*않/g, /존재하지\s*않/g,
  /써서는\s*안/g, /해서는\s*안/g, /\s안\s*된다/g, /절대\s*안/g,
  /무효/g, /무시하라/g,
];
const POSITIVE_RE = [
  /허용/g, /권장/g, /자유롭게/g, /선택하라/g, /자연스럽게/g,
  /가능하다/g, /적합하다/g, /\s*반드시\s/g, /\s*해야\s/g,
];

function countMatches(s, patterns) {
  let n = 0;
  for (const p of patterns) {
    const m = s.match(p);
    if (m) n += m.length;
  }
  return n;
}

// section header 패턴: [...] 또는 ★[...]
const SECTION_HEADER_RE = /^\s*\[(?:★\s*)?[^\]]+\][^"`]*$/gm;

// JS template literal 안에 있는 section header 추출:
//   sections.push(`[XXX]\n...`)
//   sections.push(`[YYY ...] anchor`)
// 또는 단순 "[XXX...]" 패턴
const PUSH_HEADER_RE = /sections\.push\(\s*`(\[[^`\n]+)`?/g;

function extractSections(src) {
  const headers = new Set();
  // 1. sections.push("[...]
  const m1 = src.match(/sections\.push\(\s*[`"'](\[★?[^"`'\n]+\][^"`'\n]*)/g) ?? [];
  for (const m of m1) {
    const t = m.match(/\[★?[^\]]+\]/);
    if (t) headers.add(t[0]);
  }
  // 2. system prompt template literal에서 [XXX] 헤더
  const m2 = src.match(/\[★?[^\]\n]{2,40}\]/g) ?? [];
  for (const m of m2) headers.add(m);
  return [...headers];
}

function summarize(label, src) {
  const lines = src.split("\n");
  const chars = src.length;
  const approxTokens = Math.ceil(chars / 2.5);  // 대략 한국어 char/2.5 = token

  const negCount = countMatches(src, NEGATIVE_RE);
  const posCount = countMatches(src, POSITIVE_RE);
  const ratio = negCount === 0 ? Infinity : posCount / negCount;

  const sections = extractSections(src);
  return {
    label,
    file_chars: chars,
    file_lines: lines.length,
    approx_max_tokens_if_all_emitted: approxTokens,
    section_header_count: sections.length,
    section_headers_sample: sections.slice(0, 25),
    negative_marker_count: negCount,
    positive_marker_count: posCount,
    pos_neg_ratio: ratio === Infinity ? "∞" : ratio.toFixed(2),
  };
}

const planner  = readFileSync("src/pipeline/planner.ts", "utf8");
const renderer = readFileSync("src/pipeline/renderer.ts", "utf8");

const summary = {
  generated_at: new Date().toISOString(),
  notes: "정적 분석. 실제 generation 시 emit되는 section은 일부만 (조건부). 따라서 approx_max는 상한.",
  planner: summarize("planner.ts", planner),
  renderer: summarize("renderer.ts", renderer),
  build_artifacts_present: {
    "dist/pipeline/planner.js": existsSync("dist/pipeline/planner.js"),
    "dist/pipeline/renderer.js": existsSync("dist/pipeline/renderer.js"),
  },
};

if (useJson) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const W = 75;
function p(s) { console.log(s); }
p("\n" + "═".repeat(W));
p(" Prompt Budget Static Audit (Phase 4.20 R1.5)");
p("═".repeat(W));
p(`generated_at: ${summary.generated_at}`);
p(`note: ${summary.notes}`);

for (const role of ["planner", "renderer"]) {
  const r = summary[role];
  p(`\n[${r.label}]`);
  p(`  source chars: ${r.file_chars}, lines: ${r.file_lines}`);
  p(`  approx_max_tokens (전 section emit 시 상한): ~${r.approx_max_tokens_if_all_emitted}`);
  p(`  section header count: ${r.section_header_count}`);
  p(`  negative marker count: ${r.negative_marker_count}`);
  p(`  positive marker count: ${r.positive_marker_count}`);
  p(`  pos/neg ratio: ${r.pos_neg_ratio}  ${r.negative_marker_count > r.positive_marker_count ? "⚠️ negative dominance" : "✓"}`);
  p(`  section sample (top 25):`);
  for (const h of r.section_headers_sample) p(`    · ${h}`);
}
p("\n" + "═".repeat(W));
p("[참고] 평균 emit token (조건부 section 평가):");
p("  planner ~ 8-15K (Phase 4.20 forensic 기준)");
p("  renderer ~ 6-10K (Phase 4.20 forensic 기준)");
p("[다음 단계]");
p("  · negative dominance면 R2 prompt 가지치기 우선순위 높음");
p("  · approx_max가 모델 ctx 30% 이상이면 R2 필수");
p("═".repeat(W) + "\n");
