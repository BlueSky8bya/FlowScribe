/**
 * verify_generated_body_sanitizer.mjs
 * text_sanitizer.ts 동작 검증
 */
import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

// ── Source checks ──────────────────────────────────────────────
const src = readFileSync("src/services/text_sanitizer.ts", "utf8");
console.log("── text_sanitizer.ts 소스 검증 ──");
check("sanitizeGeneratedBody export", src.includes("export function sanitizeGeneratedBody"));
check("SPECIAL_TOKEN_RE: <unused\\d+>", src.includes("<unused\\d+>"));
check("HASHTAG_RE: #[a-z_]", src.includes("HASHTAG_RE"));
check("FOREIGN_FRAGMENT_RE 존재", src.includes("FOREIGN_FRAGMENT_RE"));
check("NON_KO_SCRIPT_RE 키릴/아랍 패턴", src.includes("NON_KO_SCRIPT_RE"));
check("removed_special_tokens 반환", src.includes("removed_special_tokens"));
check("removed_foreign_fragments 반환", src.includes("removed_foreign_fragments"));
check("warnings 반환", src.includes("warnings:"));
check("ALLOWED_LATIN: CLIFF/END 허용", src.includes("CLIFF|END"));
check("중복 공백 정리", src.includes('replace(/[ \\t]{2,}/'));

// ── pipeline/index.ts 통합 검증 ───────────────────────────────
const pipelineSrc = readFileSync("src/pipeline/index.ts", "utf8");
console.log("\n── pipeline/index.ts sanitizer 통합 ──");
check("text_sanitizer import", pipelineSrc.includes("text_sanitizer"));
check("sanitizeGeneratedBody 호출", pipelineSrc.includes("sanitizeGeneratedBody(rawRenderedText)"));
check("sanitized.text로 교체", pipelineSrc.includes("generatedText = sanitized.text"));
check("sanitizer warning logWarn", pipelineSrc.includes("pipeline:sanitizer"));

// ── effective_context.ts canonical filter 검증 ────────────────
const ctxSrc = readFileSync("src/services/effective_context.ts", "utf8");
console.log("\n── effective_context.ts canonical filter ──");
check("canonicalNameSetForFilter 생성", ctxSrc.includes("canonicalNameSetForFilter"));
check("dynStates canonical 필터 적용", ctxSrc.includes("filter(d => canonicalNameSetForFilter.has(d.character_name))"));

// ── generate_v2.ts regen isolation ────────────────────────────
const genV2Src = readFileSync("src/api/generate_v2.ts", "utf8");
console.log("\n── generate_v2.ts regen memory isolation ──");
check("character_dynamic_states DELETE", genV2Src.includes("DELETE FROM character_dynamic_states WHERE book_id=$1 AND episode_number=$2"));
check("foreshadows DELETE planted_episode", genV2Src.includes("DELETE FROM foreshadows WHERE book_id=$1 AND planted_episode=$2"));
check("재생성 memory isolation 로그", genV2Src.includes("재생성 memory isolation 완료"));

// ── dist 빌드 산출물 ──────────────────────────────────────────
import { existsSync } from "fs";
console.log("\n── dist 빌드 산출물 ──");
check("dist/services/text_sanitizer.js 생성됨", existsSync("dist/services/text_sanitizer.js"));
const distSanitizer = existsSync("dist/services/text_sanitizer.js")
  ? readFileSync("dist/services/text_sanitizer.js", "utf8") : "";
check("dist sanitizeGeneratedBody export", distSanitizer.includes("sanitizeGeneratedBody"));

// ── 런타임 변환 테스트 ─────────────────────────────────────────
console.log("\n── 런타임 변환 테스트 ──");
try {
  const { sanitizeGeneratedBody } = await import("../dist/services/text_sanitizer.js");

  // <unused4896> 제거
  const r1 = sanitizeGeneratedBody("땅이 <unused4896>짓는 듯했다.");
  check("<unused4896> 제거됨", !r1.text.includes("<unused4896>"));
  check("<unused4896> removed_special_tokens=1", r1.removed_special_tokens === 1);
  check("한국어 문장 보존", r1.text.includes("땅이") && r1.text.includes("짓는"));

  // <unused332> 제거
  const r2 = sanitizeGeneratedBody("폐허에 <unused332> 울려 퍼졌다.");
  check("<unused332> 제거됨", !r2.text.includes("<unused332>"));

  // #shy 제거
  const r3 = sanitizeGeneratedBody("그녀는 #shy 미소를 지었다.");
  check("#shy 제거됨", !r3.text.includes("#shy"));
  check("#shy removed_foreign_fragments>=1", r3.removed_foreign_fragments >= 1);

  // ahuv potongannya 제거
  const r4 = sanitizeGeneratedBody("엘리온은 ahuv potongannya 폐허를 향해 걸었다.");
  check("외국어 조각 ahuv potongannya 제거", !r4.text.includes("ahuv") && !r4.text.includes("potongannya"));

  // 한국어 정상 문장 보존
  const r5 = sanitizeGeneratedBody("사일러스는 단검을 들고 조심스럽게 앞으로 나아갔다.");
  check("한국어 정상 문장 보존", r5.text === "사일러스는 단검을 들고 조심스럽게 앞으로 나아갔다.");
  check("정상 문장: removed_special_tokens=0", r5.removed_special_tokens === 0);
  check("정상 문장: removed_foreign_fragments=0", r5.removed_foreign_fragments === 0);

  // CLIFF, END 보존
  const r6 = sanitizeGeneratedBody("이야기는 계속된다.\n[CLIFF]\n그는 뒤를 돌아보았다.\n[END]");
  check("CLIFF 보존", r6.text.includes("CLIFF"));
  check("END 보존", r6.text.includes("END"));

} catch(e) {
  fail("런타임 테스트 실패", e.message);
}

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
