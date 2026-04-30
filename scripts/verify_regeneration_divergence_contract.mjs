/**
 * verify_regeneration_divergence_contract.mjs — Phase 4.18
 *
 * RegenerationDivergenceContract 정책이 코드 레벨에서 살아있는지 정적 검사:
 *   1. types/canonical.ts에 RegenerationDivergenceContract 타입 정의됨
 *   2. EffectiveContext에 regen_mode + regen_divergence_contract 필드 추가됨
 *   3. services/regen_divergence.ts에 buildRegenDivergenceContract + detectGenerationMode 정의됨
 *   4. api/generate.ts와 api/generate_v2.ts에서 contract를 ctx에 주입함
 *   5. planner.ts가 regen_divergence_contract를 prompt에 반영하고 regen_prev_text full beat dump를 제거함
 *   6. planner/renderer가 regen 시 temperature를 상향 조정함
 *   7. ep1 재생성 framing이 alternate opening generation으로 유지됨
 *
 * Usage: node scripts/verify_regeneration_divergence_contract.mjs
 * Exit: 0 PASS, 1 FAIL
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const f = (p) => fs.readFileSync(path.join(root, p), "utf8");

const canonical = f("src/types/canonical.ts");
const regenDiv = f("src/services/regen_divergence.ts");
const apiGen = f("src/api/generate.ts");
const apiGenV2 = f("src/api/generate_v2.ts");
const planner = f("src/pipeline/planner.ts");
const renderer = f("src/pipeline/renderer.ts");

const checks = [];
function check(name, ok, detail = "") { checks.push({ name, ok, detail }); }

// 1. RegenerationDivergenceContract 타입 정의
check(
  "1. types/canonical.ts에 RegenerationDivergenceContract 타입 정의",
  /export\s+interface\s+RegenerationDivergenceContract\b/.test(canonical),
  ""
);
check(
  "2. RegenerationDivergenceContract에 must_vary_axes 포함",
  /must_vary_axes\s*:\s*Array<[\s\S]*?opening_location[\s\S]*?ending_hook/.test(canonical),
  ""
);
check(
  "3. RegenerationDivergenceContract에 old_episode_signature 포함",
  /old_episode_signature\s*:\s*\{/.test(canonical),
  ""
);
check(
  "4. EffectiveContext에 regen_mode + regen_divergence_contract 필드",
  /regen_mode\?\s*:\s*GenerationMode/.test(canonical) &&
    /regen_divergence_contract\?\s*:\s*RegenerationDivergenceContract/.test(canonical),
  ""
);

// 5-6. regen_divergence.ts 빌더
check(
  "5. regen_divergence.ts: buildRegenDivergenceContract export",
  /export\s+async\s+function\s+buildRegenDivergenceContract\b/.test(regenDiv),
  ""
);
check(
  "6. regen_divergence.ts: detectGenerationMode export",
  /export\s+async\s+function\s+detectGenerationMode\b/.test(regenDiv),
  ""
);
check(
  "7. regen_divergence.ts: hint_min_divergent_axes 자동 산정 (attempt_count 기반)",
  /attemptCount\s*>=\s*4/.test(regenDiv),
  ""
);

// 8-9. api/generate.ts에서 주입
check(
  "8. api/generate.ts: detectGenerationMode + buildRegenDivergenceContract import",
  /from\s+["']\.\.\/services\/regen_divergence\.js["']/.test(apiGen) &&
    /detectGenerationMode/.test(apiGen) && /buildRegenDivergenceContract/.test(apiGen),
  ""
);
check(
  "9. api/generate.ts: ctx.regen_divergence_contract 주입",
  /regen_divergence_contract/.test(apiGen),
  ""
);
check(
  "10. api/generate.ts: 기존 regen_prev_text 누적 코드 제거 (allBeatSets dump 안함)",
  !/allBeatSets\.map\([^)]*시도/.test(apiGen),
  ""
);
check(
  "11. api/generate_v2.ts: contract 주입 코드 동기화",
  /regen_divergence_contract/.test(apiGenV2) && /detectGenerationMode/.test(apiGenV2),
  ""
);

// 12. planner.ts가 contract를 prompt에 사용
check(
  "12. planner.ts: regen_divergence_contract 추출",
  /regen_divergence_contract/.test(planner),
  ""
);
check(
  "13. planner.ts: must_vary axes 가이드 prompt에 포함",
  /must_vary[\s\S]*axes/.test(planner),
  ""
);
check(
  "14. planner.ts: 이전 시도 beat 전문 [이전 시도 beat 기록]을 prompt에 dump하지 않음",
  !/\[이전 시도 beat 기록 — 다양성 참고용\]\\n\$\{regenPrev\}/.test(planner),
  ""
);
check(
  "15. planner.ts: regen_avoid_locations 하드코딩 회피 목록 제거",
  !/regen_avoid_locations[\s\S]{0,200}avoidLines\.push\([^)]*반드시 피한다/.test(planner),
  ""
);

// 16-17. sampling temperature
check(
  "16. planner.ts: regen 시 temperature 상향 (0.65 고정 아님)",
  /_temperaturePlanner\s*=\s*_regenContract[\s\S]{0,80}attempt_count/.test(planner),
  ""
);
check(
  "17. renderer.ts: regen 시 temperature 상향",
  /_temperatureRenderer\s*=\s*_regenContract[\s\S]{0,80}attempt_count/.test(renderer),
  ""
);

// 18. ep1 alternate opening framing 유지
check(
  "18. planner.ts: ep1 재생성에서 alternate opening 모드 framing 유지",
  /alternate opening generation/.test(planner) && /first introduction/.test(planner),
  ""
);

// 19. N+1 이후 문맥은 contract에 포함하지 않음 — 코드에 next_episode 필드 없음
check(
  "19. RegenerationDivergenceContract에 N+1 문맥 필드 없음",
  !/next_episode_(facts|context|threads)/.test(canonical),
  ""
);

// 20. 재생성 모드는 4가지 generation mode 가운데 적절히 라벨링
check(
  "20. GenerationMode 4가지 모두 정의 (new/next/latest_regen/episode1_regen)",
  /new_episode_generation/.test(canonical) &&
    /next_episode_generation/.test(canonical) &&
    /latest_episode_regeneration/.test(canonical) &&
    /episode1_regeneration/.test(canonical),
  ""
);

const W = 75;
console.log(`\n${"═".repeat(W)}`);
console.log(" RegenerationDivergenceContract — Static Verification");
console.log(`${"═".repeat(W)}`);
let pass = 0, fail = 0;
for (const c of checks) {
  if (c.ok) { pass++; console.log(`  ✅ ${c.name}`); }
  else      { fail++; console.log(`  ❌ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`); }
}
console.log(`${"─".repeat(W)}`);
console.log(`총 ${checks.length} | PASS ${pass} | FAIL ${fail}`);
console.log(`${"═".repeat(W)}\n`);
process.exit(fail > 0 ? 1 : 0);
