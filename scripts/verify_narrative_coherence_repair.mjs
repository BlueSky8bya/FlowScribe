/**
 * verify_narrative_coherence_repair.mjs — Phase 4.10 narrative coherence 코드 검증
 *
 * 검증 항목:
 * - src/services/narrative_coherence.ts 구조
 * - pipeline/index.ts 통합 (judge + repair 호출)
 * - audit_knowledge_boundaries.mjs / audit_action_affordance.mjs 존재
 * - dist 빌드 산출물
 */
import { readFileSync, existsSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

// ── 1. narrative_coherence.ts 구조 ──────────────────────────
const ncSrc = readFileSync("src/services/narrative_coherence.ts", "utf8");
console.log("── [1] narrative_coherence.ts 구조 ──");
check("CoherenceIssue interface", ncSrc.includes("interface CoherenceIssue"));
check("4개 category 정의", ncSrc.includes("knowledge_leak") && ncSrc.includes("affordance") && ncSrc.includes("transition") && ncSrc.includes("body_state"));
check("severity 3단계", ncSrc.includes("fatal") && ncSrc.includes("major") && ncSrc.includes("minor"));
check("runNarrativeCoherenceCheck export", ncSrc.includes("export async function runNarrativeCoherenceCheck"));
check("repairNarrativeCoherenceIssues export", ncSrc.includes("export async function repairNarrativeCoherenceIssues"));
check("judgeAndRepair entry point", ncSrc.includes("export async function judgeAndRepair"));
check("paragraph_index 기반 repair", ncSrc.includes("paragraph_index"));
check("max repair length guard", ncSrc.includes("cleaned.length > original.length"));
check("Gemini API 호출", ncSrc.includes("generativelanguage.googleapis.com"));
check("temperature 0.1 (deterministic judge)", ncSrc.includes("temperature: 0.1"));

// ── 2. pipeline/index.ts 통합 ───────────────────────────────
const pipelineSrc = readFileSync("src/pipeline/index.ts", "utf8");
console.log("\n── [2] pipeline/index.ts 통합 ──");
check("narrative_coherence import", pipelineSrc.includes("narrative_coherence"));
check("judgeAndRepair import", pipelineSrc.includes("judgeAndRepair"));
check("selective 트리거 (env COHERENCE_JUDGE)", pipelineSrc.includes("COHERENCE_JUDGE"));
check("hints 수집 (continuity + delta)", pipelineSrc.includes("coherenceHints"));
check("repair 결과 generatedText 갱신", pipelineSrc.includes("generatedText = result.finalContent"));
check("tracer.coherence_check 첨부", pipelineSrc.includes("coherence_check"));
check("error skip — judge 실패 시 generation 계속", pipelineSrc.includes("judge/repair 실행 실패"));

// ── 3. 감사 스크립트 존재 ───────────────────────────────────
console.log("\n── [3] 신규 audit 스크립트 ──");
const newAudits = [
  "scripts/audit_knowledge_boundaries.mjs",
  "scripts/audit_action_affordance.mjs",
];
for (const s of newAudits) check(`${s.split("/").pop()} 존재`, existsSync(s));

// ── 4. audit 스크립트 구조 검사 ─────────────────────────────
console.log("\n── [4] audit 스크립트 구조 ──");
const kbSrc = readFileSync("scripts/audit_knowledge_boundaries.mjs", "utf8");
check("knowledge: Gemini 호출", kbSrc.includes("generativelanguage.googleapis.com"));
check("knowledge: 추측·의심·질문 제외", kbSrc.includes("추측") || kbSrc.includes("의심"));
check("knowledge: 누적 컨텍스트 사용", kbSrc.includes("이전 화 요약") || kbSrc.includes("prevEpsBriefs"));

const afSrc = readFileSync("scripts/audit_action_affordance.mjs", "utf8");
check("affordance: Gemini 호출", afSrc.includes("generativelanguage.googleapis.com"));
check("affordance: 부상/기절/구속 검사", afSrc.includes("부상") && afSrc.includes("기절"));
check("affordance: visibility_state 검사", afSrc.includes("visibility_state"));

// ── 5. dist 빌드 산출물 ─────────────────────────────────────
console.log("\n── [5] dist 빌드 산출물 ──");
check("dist/services/narrative_coherence.js", existsSync("dist/services/narrative_coherence.js"));
check("dist/pipeline/index.js", existsSync("dist/pipeline/index.js"));

if (existsSync("dist/services/narrative_coherence.js")) {
  const distNc = readFileSync("dist/services/narrative_coherence.js", "utf8");
  check("dist judgeAndRepair export", distNc.includes("judgeAndRepair"));
  check("dist runNarrativeCoherenceCheck export", distNc.includes("runNarrativeCoherenceCheck"));
}

// ── 6. 결과 ─────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
