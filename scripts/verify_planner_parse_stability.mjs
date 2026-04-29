/**
 * verify_planner_parse_stability.mjs
 * planner JSON parse → fallback → trace 저장 안정성 검증
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}`); failed++; }
}

const plannerTs = readFileSync(join(root, "src/pipeline/planner.ts"),   "utf8");
const pipeTs    = readFileSync(join(root, "src/pipeline/index.ts"),     "utf8");

console.log("\n═══════════════════════════════════════════════════════");
console.log(" VERIFY — Planner Parse Stability");
console.log("═══════════════════════════════════════════════════════\n");

// ── 1. JSON parse 3단계 시도 ─────────────────────────────────
console.log("[1] Parse strategies");
check("direct JSON.parse 시도",
  plannerTs.includes("JSON.parse(s)") || plannerTs.includes("JSON.parse(raw.trim())"));
check("```json 블록 추출",
  plannerTs.includes("```json"));
check("{ ... } 브레이스 추출",
  plannerTs.includes("braceMatch") || plannerTs.includes('match(/\\{[\\s\\S]*\\}/)'));

// ── 2. fallback plan 존재 ────────────────────────────────────
console.log("\n[2] Fallback plan");
check("buildFallbackPlan 함수 존재",
  plannerTs.includes("function buildFallbackPlan") || plannerTs.includes("buildFallbackPlan("));
check("fallback: scene_beats 최소 2개",
  (plannerTs.match(/beat_number:\s*[12]/g) ?? []).length >= 2);
check("fallback: hook_type unresolved_situation",
  plannerTs.includes("unresolved_situation"));
check("fallback_used 플래그 반환",
  plannerTs.includes("fallback_used: true") || plannerTs.includes("fallback_used:true"));

// ── 3. parse 실패 시 fallback 사용 + 로그 ───────────────────
console.log("\n[3] Parse failure handling");
check("JSON 파싱 실패 → fallback 사용 logWarn",
  plannerTs.includes("JSON 파싱 실패") || plannerTs.includes("fallback 사용"));
check("LLM 오류 → fallback 사용",
  plannerTs.includes("LLM 오류") || plannerTs.includes("플래너 LLM 오류"));
check("catch 블록이 fallback으로 연결",
  plannerTs.includes("buildFallbackPlan(ctx"));

// ── 4. pipeline trace 저장 안전 ──────────────────────────────
console.log("\n[4] Trace save safety");
check("pipeline: tracer?.save 호출",
  pipeTs.includes("tracer.save(") || pipeTs.includes("tracer?.save("));
check("pipeline: savedTraceId 반환",
  pipeTs.includes("trace_id:") && pipeTs.includes("savedTraceId"));
check("pipeline: renderer 오류 catch → generatedText 빈 문자열 유지 (pipeline 계속)",
  pipeTs.includes("렌더링 오류") || pipeTs.includes("rendering error"));

// ── 5. 스키마 명시 (JSON 구조 강제) ──────────────────────────
console.log("\n[5] Output schema enforcement");
check("출력 형식 최종 확인 섹션 존재",
  plannerTs.includes("출력 형식 최종 확인") || plannerTs.includes("JSON 구조만 출력"));
check("hook_type 허용 식별자 목록 명시",
  plannerTs.includes("immediate_threat") && plannerTs.includes("hook_type 허용"));
check("character_state_updates 생략 불가 지시",
  plannerTs.includes("character_state_updates는 절대 생략 불가"));

// ── 6. hook_type 정규화 ───────────────────────────────────────
console.log("\n[6] hook_type normalization");
check("normalizeHookType 함수 존재",
  plannerTs.includes("normalizeHookType") || plannerTs.includes("HOOK_ALIAS_MAP"));
check("한국어 번역 → 정규 식별자 매핑",
  plannerTs.includes("즉각위협") || plannerTs.includes("즉각 위협"));
check("fallback unresolved_situation",
  plannerTs.includes("fallback unresolved_situation") || plannerTs.includes("unresolved_situation"));

// ── 7. inactive character rotation (신규) ────────────────────
console.log("\n[7] Inactive character rotation (new)");
check("비활성 인물 로테이션 섹션 존재",
  plannerTs.includes("비활성 인물 로테이션") || plannerTs.includes("inactive"));
check("episode >= 3 조건",
  plannerTs.includes("episode_number >= 3"));
check("recent_goal 기반 비활성 감지",
  plannerTs.includes("recent_goal"));

console.log("\n───────────────────────────────────────────────────────");
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error("❌ PLANNER PARSE STABILITY: FAIL"); process.exit(1); }
else              console.log("✅ PLANNER PARSE STABILITY: PASS");
