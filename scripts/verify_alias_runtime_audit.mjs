/**
 * verify_alias_runtime_audit.mjs — Phase 2B alias runtime 정적 검증
 *
 * carry-forward 보강, prevMap canonical-only 필터링,
 * prevNames 계산 방식, legacy contamination 분리 검증.
 */

import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }
function section(title) { console.log(`\n── ${title} ──`); }

const pipelineSrc = readFileSync("src/pipeline/index.ts", "utf-8");
const resolverSrc = readFileSync("src/lib/entity_resolver.ts", "utf-8");
const auditSrc    = readFileSync("scripts/audit_character_aliases.mjs", "utf-8");

// ── 1. prevMap canonical-only 필터링 ─────────────────────────
section("prevMap canonical-only 필터링");
check("prevMap를 for loop + resolveCanonicalCharName로 빌드", (() => {
  // prevMap 빌드 블록에 resolveCanonicalCharName 호출과 if (rn) prevMap.set 패턴 존재
  const block = pipelineSrc.match(/prevMap\s*=\s*new Map[\s\S]*?canonicalItemMap/)?.[0] ?? "";
  return block.includes("resolveCanonicalCharName") && block.includes("prevMap.set");
})());
check("prevMap: rn 없으면 non-canonical row 제외 (descriptive/orphan 필터)", (() => {
  const block = pipelineSrc.match(/prevMap\s*=\s*new Map[\s\S]*?canonicalItemMap/)?.[0] ?? "";
  return block.includes("if (rn)") || block.includes("if(rn)");
})());
check("기존 Map(...map) 방식 제거됨", (() => {
  // old: new Map(ctx.character_dynamic_states.map(d => [d.character_name, d]))
  return !pipelineSrc.includes("new Map(\n      ctx.character_dynamic_states.map(d => [d.character_name, d])");
})());

// ── 2. prevNames canonical-only ──────────────────────────────
section("prevNames canonical-only 계산");
check("prevNames를 prevMap.keys() 기반으로 계산", pipelineSrc.includes("[...prevMap.keys()]"));
check("기존 ctx.character_dynamic_states.map 방식 제거됨", (() => {
  // 이전 코드: const prevNames = new Set(ctx.character_dynamic_states.map(d => d.character_name))
  // carry-forward 블록 근처에서 old 방식이 없어야 함
  const block = pipelineSrc.match(/absent seed[\s\S]{0,200}prevNames/)?.[0] ?? "";
  return !block.includes("ctx.character_dynamic_states.map(d => d.character_name)");
})());
check("prevNames Set<string> 타입 명시", pipelineSrc.includes("new Set<string>"));

// ── 3. carry-forward descriptive_mention 차단 ──────────────────
section("carry-forward descriptive_mention 차단");
check("carry-forward loop에서 resolveCanonicalCharName 호출", (() => {
  const block = pipelineSrc.match(/carry-forward[\s\S]{0,600}continue/)?.[0] ?? "";
  return block.includes("resolveCanonicalCharName");
})());
check("carry-forward: resolvedPrevName null → continue", (() => {
  const block = pipelineSrc.match(/carry-forward[\s\S]{0,600}continue/)?.[0] ?? "";
  return block.includes("if (!resolvedPrevName) continue");
})());
check("carry-forward: descriptive prev state 재전파 불가 구조", (() => {
  // resolveCanonicalCharName가 descriptive → null → continue로 차단됨이 문서화됨
  return pipelineSrc.includes("descriptive_mention_skipped") ||
         pipelineSrc.includes("orphan → carry-forward 스킵") ||
         pipelineSrc.includes("descriptive_mention / orphan → 커밋 스킵");
})());

// ── 4. direct commit descriptive → skip ─────────────────────
section("direct commit — descriptive_mention 확실한 skip");
check("!resolvedName → continue (direct commit 루프)", (() => {
  const block = pipelineSrc.match(/Entity Resolution[\s\S]{0,500}if \(!resolvedName\) continue/)?.[0] ?? "";
  return block.length > 0;
})());
check("normStats.descriptive_mention_skipped 카운터", pipelineSrc.includes("descriptive_mention_skipped: 0"));
check("normStats 로그에 descriptive_mention_skipped 반영", (() => {
  // logInfo "캐릭터 상태 커밋 완료" 블록에 norm_stats가 포함
  return pipelineSrc.includes("norm_stats: normStats");
})());

// ── 5. audit script --after-episode / --ignore-legacy ─────────
section("audit script legacy/new 분리 옵션");
check("--after-episode 파싱", auditSrc.includes("--after-episode"));
check("--ignore-legacy 파싱", auditSrc.includes("--ignore-legacy"));
check("dynEpFilter: episode_number > N 조건", auditSrc.includes("episode_number > "));
check("auditMode 출력", auditSrc.includes("Audit mode:"));
check("auditOpts를 auditBook에 전달", auditSrc.includes("auditBook(id, auditOpts)"));

// ── 6. entity_resolver allowNewCharacter 기본값 확인 ──────────
section("allowNewCharacter 기본값 안전성");
check("allowNewCharacter 기본값 true (하위호환)", resolverSrc.includes("allowNewCharacter = true"));
check("allowNewCharacter = false면 descriptive_mention fallback", (() => {
  const block = resolverSrc.match(/if \(allowNewCharacter\)[\s\S]{0,200}new_character[\s\S]{0,200}descriptive_mention/)?.[0] ?? "";
  return block.length > 0 || resolverSrc.includes("new_character_not_allowed");
})());
check("new_character confidence 0.6 (canonical 1.0보다 낮음)", resolverSrc.includes("confidence: 0.6"));

// ── 7. verify_book_load_flow 40/40 범위 수정 확인 ─────────────
section("verify_book_load_flow 범위 수정 확인");
let bookLoadSrc = "";
try { bookLoadSrc = readFileSync("scripts/verify_book_load_flow.mjs", "utf-8"); } catch {}
check("outEl.textContent 검색 범위 3500 이상", (() => {
  const m = bookLoadSrc.match(/outEl\.textContent[\s\S]{0,50}\{0,(\d+)\}/);
  return m ? parseInt(m[1]) >= 3000 : bookLoadSrc.includes("{0,3500}") || bookLoadSrc.includes("{0,4000}");
})());

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
