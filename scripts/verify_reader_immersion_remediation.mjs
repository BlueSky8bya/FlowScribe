/**
 * verify_reader_immersion_remediation.mjs
 * Phase 4.9 remediation 검증 — 6개 수정 항목 소스/로직 확인
 *
 * Usage: node scripts/verify_reader_immersion_remediation.mjs
 */
import { readFileSync, existsSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

// ── 1. CJK artifact 제거 (text_sanitizer.ts) ─────────────────
const sanitizerSrc = readFileSync("src/services/text_sanitizer.ts", "utf8");
console.log("── [1] CJK artifact 제거 (text_sanitizer.ts) ──");
check("NON_KO_SCRIPT_RE 존재", sanitizerSrc.includes("NON_KO_SCRIPT_RE"));
check("CJK 범위 포함 (一-鿿 or \\u4E00)", sanitizerSrc.includes("一-鿿") || sanitizerSrc.includes("\\u4E00"));
check("removed_foreign_fragments 반환", sanitizerSrc.includes("removed_foreign_fragments"));

// ── 2. 복선 과잉 회수 방지 (foreshadow.ts) ────────────────────
const foreshadowSrc = readFileSync("src/services/foreshadow.ts", "utf8");
console.log("\n── [2] 복선 과잉 회수 방지 (foreshadow.ts) ──");
check("같은 에피소드 planted→resolved 방지", foreshadowSrc.includes("planted_episode === episodeNumber") && foreshadowSrc.includes("continue"));
check("keyword 2개 이하: ALL 조건", foreshadowSrc.includes("hitCount >= totalKw"));
check("keyword 3개 이상: 과반 + 최소 2개", foreshadowSrc.includes("hitCount >= 2 && hitCount > totalKw / 2"));
check("200자 미만 본문 스킵", foreshadowSrc.includes("content.length < 200"));

// ── 3. canonical filter (effective_context.ts) ────────────────
const ctxSrc = readFileSync("src/services/effective_context.ts", "utf8");
console.log("\n── [3] canonical character filter (effective_context.ts) ──");
check("canonicalNameSetForFilter 생성", ctxSrc.includes("canonicalNameSetForFilter"));
check("dynStates canonical 필터 적용", ctxSrc.includes("filter(d => canonicalNameSetForFilter.has(d.character_name))"));

// ── 4. 재생성 memory isolation (generate_v2.ts) ───────────────
const genV2Src = readFileSync("src/api/generate_v2.ts", "utf8");
console.log("\n── [4] 재생성 memory isolation (generate_v2.ts) ──");
check("dynamic_states 재생성 DELETE", genV2Src.includes("DELETE FROM character_dynamic_states WHERE book_id=$1 AND episode_number=$2"));
check("foreshadows planted_episode DELETE", genV2Src.includes("DELETE FROM foreshadows WHERE book_id=$1 AND planted_episode=$2"));
check("재생성 memory isolation 로그", genV2Src.includes("재생성 memory isolation 완료"));

// ── 5. 이중 소유 guard (pipeline/index.ts) ────────────────────
const pipelineSrc = readFileSync("src/pipeline/index.ts", "utf8");
console.log("\n── [5] 이중 소유 guard (pipeline/index.ts) ──");
check("itemOwnerCandidates Map 생성", pipelineSrc.includes("itemOwnerCandidates"));
check("keeper 선택 로직 존재", pipelineSrc.includes("keeper"));
check("pipeline:itemLedger 로그", pipelineSrc.includes("pipeline:itemLedger"));
check("upd.items 필터링 (non-keeper)", pipelineSrc.includes("upd.items =") && pipelineSrc.includes(".filter("));

// ── 6. sanitizer pipeline 통합 ────────────────────────────────
console.log("\n── [6] sanitizer pipeline 통합 (pipeline/index.ts) ──");
check("text_sanitizer import", pipelineSrc.includes("text_sanitizer"));
check("sanitizeGeneratedBody 호출", pipelineSrc.includes("sanitizeGeneratedBody(rawRenderedText)") || pipelineSrc.includes("sanitizeGeneratedBody("));
check("pipeline:sanitizer 로그", pipelineSrc.includes("pipeline:sanitizer"));

// ── 7. 감사 스크립트 존재 확인 ────────────────────────────────
console.log("\n── [7] 감사 스크립트 파일 존재 ──");
const auditScripts = [
  "scripts/audit_dialogue_repetition.mjs",
  "scripts/audit_item_location_ledger.mjs",
  "scripts/audit_scene_transitions.mjs",
  "scripts/gemini_reader_immersion_full_audit.mjs",
];
for (const s of auditScripts) {
  check(`${s.split("/").pop()} 존재`, existsSync(s));
}

// ── 8. dist 빌드 산출물 확인 ──────────────────────────────────
console.log("\n── [8] dist 빌드 산출물 ──");
check("dist/services/text_sanitizer.js", existsSync("dist/services/text_sanitizer.js"));
check("dist/services/foreshadow.js", existsSync("dist/services/foreshadow.js"));
check("dist/services/effective_context.js", existsSync("dist/services/effective_context.js"));
check("dist/pipeline/index.js", existsSync("dist/pipeline/index.js"));
check("dist/api/generate_v2.js", existsSync("dist/api/generate_v2.js"));

// ── 결과 ──────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
const result = failed === 0
  ? "✅  ALL PASSED"
  : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
