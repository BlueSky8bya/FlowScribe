/**
 * verify_item_location_ledger.mjs — Phase 4 Item/Location Ledger 정적 검증
 */

import { readFileSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }
function section(title) { console.log(`\n── ${title} ──`); }

const ledgerSrc   = (() => { try { return readFileSync("src/lib/item_ledger.ts", "utf-8"); } catch { return ""; } })();
const pipelineSrc = readFileSync("src/pipeline/index.ts", "utf-8");
const plannerSrc  = readFileSync("src/pipeline/planner.ts", "utf-8");
const rendererSrc = readFileSync("src/pipeline/renderer.ts", "utf-8");

// ── 1. item_ledger.ts 소스 ────────────────────────────────────
section("src/lib/item_ledger.ts 소스");
check("파일 존재", ledgerSrc.length > 0);
check("resolveItemName export",    ledgerSrc.includes("export function resolveItemName("));
check("normalizeItems export",     ledgerSrc.includes("export function normalizeItems("));
check("splitConditionFromName export", ledgerSrc.includes("export function splitConditionFromName("));
check("checkLocationChange export", ledgerSrc.includes("export function checkLocationChange("));
check("isSkillLike export",        ledgerSrc.includes("export function isSkillLike("));
check("emptyItemLedgerCheck export", ledgerSrc.includes("export function emptyItemLedgerCheck("));
check("emptyLocationLedgerCheck export", ledgerSrc.includes("export function emptyLocationLedgerCheck("));
check("ItemLedgerCheck interface", ledgerSrc.includes("export interface ItemLedgerCheck"));
check("LocationLedgerCheck interface", ledgerSrc.includes("export interface LocationLedgerCheck"));
check("ItemLedgerEntry interface", ledgerSrc.includes("export interface ItemLedgerEntry"));
check("LocationLedgerEntry interface", ledgerSrc.includes("export interface LocationLedgerEntry"));

// ── 2. skill reject ───────────────────────────────────────────
section("스킬/능력 reject");
check("SKILL_KEYWORDS 존재",     ledgerSrc.includes("const SKILL_KEYWORDS"));
check("스킬 keyword 포함",       ledgerSrc.includes("\"스킬\""));
check("능력 keyword 포함",       ledgerSrc.includes("\"능력\""));
check("패시브 keyword 포함",     ledgerSrc.includes("\"패시브\""));
check("Lv. keyword 포함",        ledgerSrc.includes("\"Lv.\""));
check("skill_rejected resolution", ledgerSrc.includes('"skill_rejected"'));
check("고유 스킬 패턴 감지",     ledgerSrc.includes("고유\\s*(스킬|능력|특성)"));

// ── 3. condition 분리 ─────────────────────────────────────────
section("condition 분리");
check("CONDITION_SUFFIX_PATTERNS 존재", ledgerSrc.includes("CONDITION_SUFFIX_PATTERNS"));
check("CONDITION_PREFIX_PATTERNS 존재", ledgerSrc.includes("CONDITION_PREFIX_PATTERNS"));
check("방전 condition",  ledgerSrc.includes("방전"));
check("파손 condition",  ledgerSrc.includes("파손"));
check("분실 condition",  ledgerSrc.includes("분실"));
check("괄호 분리 로직",  ledgerSrc.includes("CONDITION_PAREN_RE"));
check("condition_split resolution", ledgerSrc.includes('"condition_split"'));

// ── 4. alias/known_alias 복원 ─────────────────────────────────
section("canonical name 복원 (축약형)");
check("known_alias resolution", ledgerSrc.includes('"known_alias"'));
check("포함 관계 체크 (includes)", (() => {
  // cLower.includes(rLower) 또는 rLower.includes(cLower) 패턴 확인
  return ledgerSrc.includes("cLower.includes(rLower)") || ledgerSrc.includes("includes(rLower)");
})());
check("2글자 이하 false positive 방지", ledgerSrc.includes("rLower.length > 2"));

// ── 5. canonical carry-forward ────────────────────────────────
section("canonical item carry-forward");
check("missing canonical item 보강", ledgerSrc.includes("missing_canonical_items_restored_count++"));
check("ownerCanonicalItems 순회",    ledgerSrc.includes("for (const canon of ownerCanonicalItems)"));
check("prev item carry-forward",     ledgerSrc.includes("prevEntry"));

// ── 6. pipeline/index.ts 통합 ─────────────────────────────────
section("pipeline/index.ts 통합");
check("item_ledger import",           pipelineSrc.includes("from \"../lib/item_ledger.js\""));
check("normalizeItems 호출",          pipelineSrc.includes("normalizeItems("));
check("checkLocationChange 호출",     pipelineSrc.includes("checkLocationChange("));
check("emptyItemLedgerCheck 호출",    pipelineSrc.includes("emptyItemLedgerCheck()"));
check("emptyLocationLedgerCheck 호출", pipelineSrc.includes("emptyLocationLedgerCheck()"));
check("itemLedgerStats 변수",         pipelineSrc.includes("const itemLedgerStats"));
check("locationLedgerStats 변수",     pipelineSrc.includes("const locationLedgerStats"));
check("item_ledger logInfo",          pipelineSrc.includes("item_ledger: itemLedgerStats"));
check("location_ledger logInfo",      pipelineSrc.includes("location_ledger: locationLedgerStats"));
check("tracer item_ledger_check 첨부", pipelineSrc.includes("item_ledger_check = itemLedgerStats"));
check("tracer location_ledger_check 첨부", pipelineSrc.includes("location_ledger_check = locationLedgerStats"));
check("carry-forward에도 normalizeItems 적용", (() => {
  const idx = pipelineSrc.indexOf("carry-forward: 영어 오염 방지 + item ledger 정규화");
  return idx >= 0 && pipelineSrc.indexOf("normalizeItems(", idx) < idx + 300;
})());

// ── 7. planner prompt 지시 ────────────────────────────────────
section("planner prompt 소지품 원칙");
check("이름 변경 금지 지시",         plannerSrc.includes("소지품 이름(name)은 사용자가 설정한 원본 이름"));
check("condition으로 기록 지시",     plannerSrc.includes("소지품 상태 변화는 name이 아니라 condition"));
check("스킬 제외 지시",              plannerSrc.includes("스킬·능력·특성·이능·마법 능력·패시브는 items에 절대 넣지 않는다"));
check("예시 금지 패턴 포함",         plannerSrc.includes("손전등(방전)"));

// ── 8. renderer prompt 지시 ──────────────────────────────────
section("renderer prompt 소지품 원칙");
check("이름 변경 금지 섹션",         rendererSrc.includes("소지품 유지 — 이름 변경 금지"));
check("축약 금지 지시",              rendererSrc.includes("축약·개명·확장 금지"));
check("condition으로 처리 지시",     rendererSrc.includes("상태는 묘사(방전되었다, 파손되었다)로 처리한다"));
check("스킬 묘사 금지",              rendererSrc.includes("스킬·능력·특성·패시브는 절대 소지품처럼 묘사하지 않는다"));

// ── 9. trace_logger.ts 병합 ───────────────────────────────────
section("trace_logger.ts 병합");
const traceSrc = (() => { try { return readFileSync("src/training/trace_logger.ts", "utf-8"); } catch { return ""; } })();
check("item_ledger_check 병합",      traceSrc.includes("item_ledger_check = itemLedger"));
check("location_ledger_check 병합",  traceSrc.includes("location_ledger_check = locationLedger"));

// ── 10. dist 빌드 산출물 ──────────────────────────────────────
section("dist 빌드 산출물");
let distLedger = "";
try { distLedger = readFileSync("dist/lib/item_ledger.js", "utf-8"); } catch {}
check("dist/lib/item_ledger.js 생성됨", distLedger.length > 0);
check("dist resolveItemName export",  distLedger.includes("resolveItemName"));
check("dist normalizeItems export",   distLedger.includes("normalizeItems"));
check("dist isSkillLike export",      distLedger.includes("isSkillLike"));

// ── 11. 런타임 변환 테스트 ────────────────────────────────────
section("런타임 변환 테스트");
if (distLedger.length > 0) {
  try {
    const mod = await import("../dist/lib/item_ledger.js");
    const { resolveItemName: rin, isSkillLike: isl, splitConditionFromName: sc, normalizeItems: ni } = mod;

    // condition 분리
    const r1 = rin("고성능 손전등(방전)", [{ name: "고성능 손전등" }], []);
    check("손전등(방전) → canonical_name=고성능 손전등", r1.canonical_name === "고성능 손전등", `got: ${r1.canonical_name}`);
    check("손전등(방전) → condition=방전", r1.condition === "방전", `got: ${r1.condition}`);

    // 접두 condition
    const r2 = rin("방전된 고성능 손전등", [{ name: "고성능 손전등" }], []);
    check("방전된 고성능 손전등 → canonical_name=고성능 손전등", r2.canonical_name === "고성능 손전등", `got: ${r2.canonical_name}`);
    check("방전된 고성능 손전등 → condition=방전", r2.condition === "방전", `got: ${r2.condition}`);

    // 축약형 복원
    const r3 = rin("손전등", [{ name: "고성능 손전등" }], []);
    check("손전등 → known_alias (고성능 손전등)", r3.resolution === "known_alias", `got: ${r3.resolution}, name: ${r3.canonical_name}`);

    // 스킬 reject
    const r4 = rin("똑똑이 스킬", [], []);
    check("똑똑이 스킬 → skill_rejected", r4.resolution === "skill_rejected", `got: ${r4.resolution}`);

    const r5 = rin("고유 스킬: 분석", [], []);
    check("고유 스킬: 분석 → skill_rejected", r5.resolution === "skill_rejected", `got: ${r5.resolution}`);

    // isSkillLike 직접 테스트
    check("isSkillLike('마법 능력 Lv.3') = true", isl("마법 능력 Lv.3") === true, "");
    check("isSkillLike('패시브: 강화') = true",   isl("패시브: 강화") === true, "");
    check("isSkillLike('고성능 손전등') = false",  isl("고성능 손전등") === false, "");

    // canonical carry-forward
    const items = ni(
      [{ name: "손전등" }],           // planner가 축약형으로 출력
      [{ name: "고성능 손전등", description: "어두운 균열 내부를 비추는 장비" }, { name: "S20" }],
      [],
      { canonical_items_count: 0, normalized_items_count: 0, rejected_skill_items_count: 0,
        condition_split_count: 0, new_items_count: 0, item_name_drift_count: 0,
        missing_canonical_items_restored_count: 0 },
    );
    const hasS20 = items.some(i => i.name === "S20");
    const hasFullName = items.some(i => i.name === "고성능 손전등");
    check("S20 carry-forward (planner 미포함)", hasS20, `items: ${items.map(i=>i.name).join(",")}`);
    check("손전등 → 고성능 손전등 복원", hasFullName, `items: ${items.map(i=>i.name).join(",")}`);

  } catch (e) {
    fail("런타임 import 실패", e.message);
  }
} else {
  fail("dist 빌드 없음 — 런타임 테스트 스킵", "npm run build 먼저 실행");
}

console.log(`\n${"─".repeat(55)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
