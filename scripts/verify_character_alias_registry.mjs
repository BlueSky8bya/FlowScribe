/**
 * verify_character_alias_registry.mjs — Phase 2 alias registry 구조 검증
 *
 * 소스 코드 기반 정적 검증 (DB 조회 없음)
 */

import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }
function section(title) { console.log(`\n── ${title} ──`); }

const resolverSrc  = readFileSync("src/lib/entity_resolver.ts", "utf-8");
const pipelineSrc  = readFileSync("src/pipeline/index.ts", "utf-8");

// ── 1. entity_resolver.ts 구조 ─────────────────────────────
section("entity_resolver.ts 구조");
check("ResolutionType 타입 정의", resolverSrc.includes('"canonical"') && resolverSrc.includes('"descriptive_mention"'));
check("EntityResolution 인터페이스", resolverSrc.includes("interface EntityResolution"));
check("ObservedMention 인터페이스", resolverSrc.includes("interface ObservedMention"));
check("resolveEntity 함수 export", resolverSrc.includes("export function resolveEntity"));
check("isDescriptiveMention 함수 export", resolverSrc.includes("export function isDescriptiveMention"));
check("isProperNounForm 함수 export", resolverSrc.includes("export function isProperNounForm"));

// ── 2. 묘사형 패턴 커버리지 ──────────────────────────────────
section("묘사형 패턴 커버리지");
check("GENERIC_NOUNS 집합 정의", resolverSrc.includes("const GENERIC_NOUNS = new Set("));
check("DESCRIPTIVE_PREFIXES 배열 정의", resolverSrc.includes("const DESCRIPTIVE_PREFIXES = ["));
check("아이 포함", resolverSrc.includes('"아이"'));
check("소년/소녀 포함", resolverSrc.includes('"소년"') && resolverSrc.includes('"소녀"'));
check("낯선 prefix 포함", resolverSrc.includes('"낯선"'));
check("그림자 속 prefix 포함", resolverSrc.includes('"그림자 속"'));
check("기사/병사 등 직역 포함", resolverSrc.includes('"기사"') && resolverSrc.includes('"병사"'));
check("목소리/존재/그림자 추상 포함", resolverSrc.includes('"목소리"') && resolverSrc.includes('"존재"'));

// ── 3. resolveEntity 판별 로직 ──────────────────────────────
section("resolveEntity 판별 로직");
check("exact canonical match (confidence 1.0)", resolverSrc.includes('"exact_match"'));
check("drift correction 경로", resolverSrc.includes('"drift_corrected'));
check("비한국어 → rejected", resolverSrc.includes('"non_korean_script"'));
check("descriptive_mention → null 반환 경로", resolverSrc.includes('"descriptive_pattern_match"'));
check("proper noun form 체크", resolverSrc.includes('"not_proper_noun_form"'));
check("new_character confidence < 1.0", resolverSrc.includes("confidence: 0.6") || resolverSrc.includes("confidence: 0.7"));
check("allowNewCharacter 옵션 존재", resolverSrc.includes("allowNewCharacter"));
check("new_character_candidate reason", resolverSrc.includes('"new_character_candidate"'));
check("특정 이름 하드코딩 없음 (발루르)", !resolverSrc.includes("발루르"));
// 주석·예시에 등장할 수 있으므로, GENERIC_NOUNS/PREFIXES에 직접 추가되지 않았는지 확인
check("특정 이름 '낯선 기사' GENERIC_NOUNS에 직접 추가되지 않음", (() => {
  // GENERIC_NOUNS Set에 "낯선 기사" 리터럴이 원소로 없으면 OK (주석/예시는 허용)
  const setBody = resolverSrc.match(/const GENERIC_NOUNS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  return !setBody.includes('"낯선 기사"');
})());

// ── 4. pipeline/index.ts 통합 ────────────────────────────────
section("pipeline/index.ts 통합");
check("entity_resolver import", pipelineSrc.includes('from "../lib/entity_resolver.js"'));
check("resolveEntity 호출", pipelineSrc.includes("resolveEntity("));
check("descriptive_mention_skipped event 타입", pipelineSrc.includes('"descriptive_mention_skipped"'));
check("descriptive_mention → continue (커밋 스킵)", pipelineSrc.includes("descriptive_mention_skipped"));
check("normStats에 descriptive_mention_skipped 카운터", pipelineSrc.includes("descriptive_mention_skipped: 0"));
check("resolveCanonicalCharName 래퍼 유지 (하위호환)", pipelineSrc.includes("function resolveCanonicalCharName"));
check("CharNormEvent에 descriptive_mention_skipped 포함", (() => {
  // type CharNormEvent = ... "descriptive_mention_skipped" ...
  const typeBlock = pipelineSrc.match(/type CharNormEvent\s*=[\s\S]*?;/)?.[0] ?? "";
  return typeBlock.includes("descriptive_mention_skipped");
})());

// ── 5. 저장 전 Entity Resolution 흐름 ───────────────────────
section("저장 전 Entity Resolution 흐름");
check("commit 직전 resolveCanonicalCharName 호출", (() => {
  // stateUpdates 루프 내부에 resolve 호출이 있는지
  const block = pipelineSrc.match(/stateUpdates\.length > 0[\s\S]*?commitDynamicState/)?.[0] ?? "";
  return block.includes("resolveCanonicalCharName") || block.includes("resolveEntity");
})());
check("!resolvedName → continue (orphan/descriptive skip)", pipelineSrc.includes("if (!resolvedName) continue"));
check("carry-forward에도 resolve 적용", (() => {
  const block = pipelineSrc.match(/carry-forward[\s\S]*?resolveCanonicalCharName/)?.[0] ?? "";
  return block.length > 0 || pipelineSrc.includes("resolveCanonicalCharName(prev.character_name");
})());

// ── 6. 빌드 산출물 (dist) ────────────────────────────────────
section("빌드 산출물 확인");
let distSrc = "";
try {
  distSrc = readFileSync("dist/lib/entity_resolver.js", "utf-8");
} catch {}
check("dist/lib/entity_resolver.js 생성됨", distSrc.length > 0);
check("dist에 isDescriptiveMention 존재", distSrc.includes("isDescriptiveMention"));
check("dist에 resolveEntity 존재", distSrc.includes("resolveEntity"));

// ── 7. 기존 name_classifier.ts 삭제 확인 ─────────────────────
section("name_classifier.ts 처리");
let oldClassifierSrc = "";
try { oldClassifierSrc = readFileSync("src/lib/name_classifier.ts", "utf-8"); } catch {}
// name_classifier.ts: Phase 2A에서는 import 제거로 충분 (파일 삭제는 Phase 2B 이후)
if (oldClassifierSrc.length > 0) {
  // import되지 않는지만 확인
  const importedAnywhere = pipelineSrc.includes("name_classifier") || resolverSrc.includes("name_classifier");
  check("name_classifier.ts가 파이프라인에서 import되지 않음", !importedAnywhere, importedAnywhere ? "pipeline/index.ts 또는 entity_resolver.ts에서 name_classifier를 import하고 있습니다" : undefined);
} else {
  check("name_classifier.ts 제거 또는 미존재 확인", true);
}

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
