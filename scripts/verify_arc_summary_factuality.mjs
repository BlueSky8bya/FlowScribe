#!/usr/bin/env node
/**
 * verify_arc_summary_factuality.mjs
 *
 * arc_memory.ts의 "미등장 hallucination guard" 구현 검증:
 * 1. arc_memory.ts에 charEvidenceMap 집계 로직 포함 여부
 * 2. "미등장" hallucination post-validation 코드 포함 여부
 * 3. LLM 프롬프트에 "등장 화수가 1 이상인 인물은 미등장 금지" 지시 포함 여부
 * 4. character_arcs LLM 프롬프트에도 동일 guard 포함 여부
 * 5. arc_memory export { ARC_SIZE } 유지 여부
 *
 * Usage: node scripts/verify_arc_summary_factuality.mjs
 */

import { readFileSync } from "fs";

let pass = 0, fail = 0;
const issues = [];

function check(label, passed) {
  if (passed) { console.log(`  ✓ ${label}`); pass++; }
  else { console.error(`  ✗ FAIL: ${label}`); fail++; issues.push(label); }
}

const src = readFileSync("src/services/arc_memory.ts", "utf8");

check(
  "charEvidenceMap: character_dynamic_states 집계 로직 포함",
  src.includes("charEvidenceMap") && src.includes("episode_count")
);

check(
  "deterministic evidence를 LLM 프롬프트에 주입 (charEvidenceText)",
  src.includes("charEvidenceText") && src.includes("인물 등장 데이터")
);

check(
  "arc summary LLM 프롬프트: 등장 화수 1 이상 → 미등장 금지 지시",
  src.includes("등장 화수가 1 이상") || src.includes("episode_count > 0") || src.includes("row가 있는 인물")
);

check(
  "post-validation: DB row 있는데 미등장이면 수정 (hallucination 보정)",
  src.includes("미등장 hallucination 보정") || (src.includes("miPattern") && src.includes("episode_count > 0"))
);

check(
  "character_arcs LLM에도 미등장 guard 포함",
  src.includes("등장 화수가 0인 인물만") || src.includes("등장 화수가 1 이상인 인물은 절대")
);

check(
  "logWarn on hallucination correction 포함",
  src.includes("arc summary 미등장 hallucination 보정") || src.includes("character_arcs 미등장 hallucination 보정")
);

check(
  "ARC_SIZE export 유지",
  src.includes("export { ARC_SIZE }")
);

// dist 파일 확인
try {
  const dist = readFileSync("dist/services/arc_memory.js", "utf8");
  check("dist/services/arc_memory.js 빌드됨", dist.length > 0);
  check("dist에 charEvidenceMap 포함", dist.includes("charEvidenceMap"));
} catch {
  check("dist/services/arc_memory.js 빌드됨", false);
}

console.log(`\n───────────────────────────────────────────`);
console.log(`Result: ${pass} passed, ${fail} failed`);
if (issues.length) {
  console.log("Failed checks:");
  issues.forEach(i => console.log(`  - ${i}`));
}
if (fail > 0) process.exit(1);
