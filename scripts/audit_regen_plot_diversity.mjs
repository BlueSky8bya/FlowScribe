/**
 * audit_regen_plot_diversity.mjs
 * 재생성 플롯 다양성 검증 — ep1 재생성본들이 충분히 다른 대안 플롯을 제공하는지 확인
 * Usage: node scripts/audit_regen_plot_diversity.mjs --book-id <uuid> --episode <n>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId  = args[args.indexOf("--book-id") + 1];
const episode = parseInt(args[args.indexOf("--episode") + 1] ?? "1", 10);
if (!bookId) { console.error("Usage: --book-id <uuid> --episode <n>"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// run_traces에서 모든 버전 수집 (episodes 테이블은 최신 1건만 유지)
const tracesRes = await pool.query(
  `SELECT planner_trace, renderer_trace, created_at
   FROM run_traces
   WHERE book_id=$1 AND episode_number=$2
   ORDER BY created_at ASC`,
  [bookId, episode]
);

await pool.end();

// renderer_trace에서 generated_text 추출
const traces   = tracesRes.rows;
const versions = traces.map(r => ({
  content:    r.renderer_trace?.generated_text ?? r.renderer_trace?.raw_output ?? "",
  created_at: r.created_at,
})).filter(v => v.content.length > 0);

console.log(`\n═══════════════════════════════════════════════════════`);
console.log(` AUDIT — Regen Plot Diversity (book: ${bookId.slice(0, 8)}..., ep${episode})`);
console.log(`═══════════════════════════════════════════════════════\n`);

if (versions.length === 0) {
  console.log("⚠️  에피소드 생성 결과 없음");
  process.exit(0);
}
if (versions.length === 1) {
  console.log("ℹ️  생성 결과 1건 — 재생성 비교 불가 (재생성 후 다시 실행)");
  console.log(`  버전 1: ${versions[0].content.slice(0, 80)}...`);
  process.exit(0);
}

console.log(`생성 버전 수: ${versions.length}개\n`);

// ── 텍스트 유사도 계산 (n-gram 기반 Jaccard) ────────────────
function tokenize(text) {
  // 한국어 + 기본 문자 토큰화 (공백 분리 + 3-gram)
  const words = text.replace(/[^가-힣a-zA-Z0-9]/g, " ").split(/\s+/).filter(Boolean);
  const grams = new Set();
  for (const w of words) grams.add(w);
  for (let i = 0; i < words.length - 1; i++) grams.add(words[i] + "_" + words[i+1]);
  return grams;
}

function jaccard(setA, setB) {
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// 처음 200자 (오프닝 유사도)
function openingSim(a, b) {
  const headA = tokenize(a.slice(0, 200));
  const headB = tokenize(b.slice(0, 200));
  return jaccard(headA, headB);
}

// 전체 텍스트 유사도
function fullSim(a, b) {
  return jaccard(tokenize(a), tokenize(b));
}

// ── 플롯 구조 추출 ───────────────────────────────────────────
function extractPlotFeatures(text, trace) {
  const plan = trace?.planner_trace?.parsed_plan;

  // 첫 번째 장면 위치
  const firstBeatLoc = plan?.scene_beats?.[0]?.location ?? null;
  // hook 유형
  const hookType = plan?.hook_type ?? null;
  // 장면 개수
  const beatCount = plan?.scene_beats?.length ?? 0;
  // 등장 인물 조합 (모든 beat의 인물 합집합)
  const allChars = new Set(plan?.scene_beats?.flatMap(b => b.characters_involved ?? []) ?? []);
  // 첫 번째 beat의 인물 조합
  const firstChars = new Set(plan?.scene_beats?.[0]?.characters_involved ?? []);
  // 첫 200자에서 갈등 키워드 추출
  const conflictHead = text.slice(0, 300);
  const conflictKeywords = ["발견", "충돌", "경고", "막혔", "잠겼", "소리", "비명", "공격", "숨겨", "거짓말", "의심", "폭발", "균열", "차단", "사라"];
  const firstConflict = conflictKeywords.find(k => conflictHead.includes(k)) ?? "(없음)";

  return { firstBeatLoc, hookType, beatCount, allChars: [...allChars], firstChars: [...firstChars], firstConflict };
}

// ── 분석 실행 ────────────────────────────────────────────────
const features = versions.map((v, i) => ({
  idx: i + 1,
  content: v.content,
  created_at: v.created_at,
  ...extractPlotFeatures(v.content, traces[i])
}));

// pairwise 유사도
const pairwiseSims = [];
const openingSims  = [];

for (let i = 0; i < versions.length; i++) {
  for (let j = i + 1; j < versions.length; j++) {
    const sim  = fullSim(versions[i].content, versions[j].content);
    const osim = openingSim(versions[i].content, versions[j].content);
    pairwiseSims.push({ pair: `v${i+1}↔v${j+1}`, sim, osim });
    openingSims.push(osim);
  }
}

const avgPairwiseSim = pairwiseSims.reduce((s, p) => s + p.sim, 0) / pairwiseSims.length;
const avgOpeningSim  = openingSims.reduce((s, x) => s + x, 0) / openingSims.length;
const maxOpeningSim  = Math.max(...openingSims);

// hook 다양성
const hooks = features.map(f => f.hookType).filter(Boolean);
const uniqueHooks = new Set(hooks).size;
const hookDiversity = hooks.length === 0 ? 0 : uniqueHooks / hooks.length;

// 첫 장면 위치 다양성
const locs = features.map(f => f.firstBeatLoc).filter(Boolean);
const uniqueLocs = new Set(locs).size;
const locDiversity = locs.length === 0 ? 0 : Math.min(1, uniqueLocs / Math.max(1, locs.length - 1));

// 첫 갈등 다양성
const conflicts = features.map(f => f.firstConflict);
const uniqueConflicts = new Set(conflicts).size;
const conflictDiversity = uniqueConflicts / Math.max(1, conflicts.length);
const repeatedFirstConflict = conflicts.filter(c => conflicts.indexOf(c) !== conflicts.lastIndexOf(c) && c !== "(없음)").length;

// 복합 diversity_score
// 낮은 텍스트 유사도 + 높은 오프닝 다양성 + hook/위치 다양성
const textDivScore   = Math.max(0, 1 - avgPairwiseSim);   // 높을수록 좋음
const openDivScore   = Math.max(0, 1 - avgOpeningSim);     // 높을수록 좋음
const hookDivScore   = hookDiversity;
const locDivScore    = locDiversity;
const conflictScore  = conflictDiversity;

// 가중 평균: 텍스트 30%, 오프닝 30%, hook 15%, 위치 15%, 갈등 10%
const diversity_score = (
  textDivScore * 0.30 +
  openDivScore * 0.30 +
  hookDivScore * 0.15 +
  locDivScore  * 0.15 +
  conflictScore * 0.10
);

// ── 출력 ─────────────────────────────────────────────────────
for (const f of features) {
  console.log(`[버전 ${f.idx}] ${new Date(f.created_at).toLocaleTimeString()}`);
  console.log(`  첫 장면 위치  : ${f.firstBeatLoc ?? "(trace 없음)"}`);
  console.log(`  hook 유형     : ${f.hookType ?? "(trace 없음)"}`);
  console.log(`  장면 수       : ${f.beatCount}`);
  console.log(`  첫 인물 조합  : ${f.firstChars.join(", ") || "(없음)"}`);
  console.log(`  첫 갈등 키워드: ${f.firstConflict}`);
  console.log(`  오프닝 200자  : ${f.content.slice(0, 80).replace(/\n/g, " ")}...`);
  console.log();
}

console.log("── pairwise 유사도 ──");
for (const p of pairwiseSims) {
  const simLabel = p.sim > 0.5 ? "⚠️ " : p.sim > 0.35 ? "△ " : "✅";
  const oLabel   = p.osim > 0.5 ? "⚠️ " : p.osim > 0.35 ? "△ " : "✅";
  console.log(`  ${p.pair}: 전체=${(p.sim*100).toFixed(1)}% ${simLabel} | 오프닝=${(p.osim*100).toFixed(1)}% ${oLabel}`);
}

console.log(`\n── 종합 지표 ──`);
console.log(`  pairwise_text_similarity  : ${(avgPairwiseSim*100).toFixed(1)}%`);
console.log(`  opening_similarity        : ${(avgOpeningSim*100).toFixed(1)}% (최대 ${(maxOpeningSim*100).toFixed(1)}%)`);
console.log(`  hook_diversity            : ${(hookDiversity*100).toFixed(0)}%`);
console.log(`  location_diversity        : ${(locDivScore*100).toFixed(0)}%`);
console.log(`  repeated_first_conflict   : ${repeatedFirstConflict}건`);
console.log(`  diversity_score           : ${(diversity_score*100).toFixed(1)}%`);

let verdict;
if (diversity_score >= 0.70)      { verdict = "✅  PASS"; }
else if (diversity_score >= 0.50) { verdict = "⚠️   WARN"; }
else                               { verdict = "❌  FAIL"; }

console.log(`\n  verdict: ${verdict}`);

console.log(`\n───────────────────────────────────────────────────────`);
if (diversity_score < 0.50) {
  console.error("❌ REGEN PLOT DIVERSITY: FAIL — 재생성 버튼이 의미 있는 대안 플롯을 제공하지 못함");
  process.exit(1);
} else if (diversity_score < 0.70) {
  console.log("⚠️  REGEN PLOT DIVERSITY: WARN — 다양성 부족, 재생성 프롬프트 점검 권장");
} else {
  console.log("✅ REGEN PLOT DIVERSITY: PASS");
}
