/**
 * verify_model_router.mjs — Phase 4.12 Model Router 구조 검증
 *
 * config 로드 / route 해석 / env 치환 / multi_route / fallback 등을 코드/구조 레벨에서 검증.
 * 실제 LLM 호출은 하지 않는다.
 */
import { readFileSync, existsSync } from "fs";

let passed = 0; let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function check(label, cond, detail) { cond ? ok(label) : fail(label, detail); }

// ── 1. 파일 존재 ──
console.log("── [1] 파일 구조 ──");
check("src/services/llm_tasks.ts", existsSync("src/services/llm_tasks.ts"));
check("src/services/model_router.ts", existsSync("src/services/model_router.ts"));
check("src/services/model_clients/base.ts", existsSync("src/services/model_clients/base.ts"));
check("src/services/model_clients/openai_compatible.ts", existsSync("src/services/model_clients/openai_compatible.ts"));
check("src/services/model_clients/gemini_client.ts", existsSync("src/services/model_clients/gemini_client.ts"));
check("config/model_routes.json", existsSync("config/model_routes.json"));

// ── 2. taxonomy 정의 ──
const tasksSrc = readFileSync("src/services/llm_tasks.ts", "utf8");
console.log("\n── [2] LLM Task taxonomy ──");
check("planner task 정의", tasksSrc.includes('"planner"'));
check("renderer task 정의", tasksSrc.includes('"renderer"'));
check("state_extractor task 정의", tasksSrc.includes('"state_extractor"'));
check("narrative_repair task 정의", tasksSrc.includes('"narrative_repair"'));
check("reader_immersion_judge task 정의", tasksSrc.includes('"reader_immersion_judge"'));
check("RouteSet interface 정의", tasksSrc.includes("interface RouteSet"));
check("multi_routes 필드", tasksSrc.includes("multi_routes"));
check("TASK_SENSITIVITY 정의", tasksSrc.includes("TASK_SENSITIVITY"));

// ── 3. router 구조 ──
const routerSrc = readFileSync("src/services/model_router.ts", "utf8");
console.log("\n── [3] model_router.ts 구조 ──");
check("runLLMTask export", routerSrc.includes("export async function runLLMTask"));
check("resolveTaskRoute export", routerSrc.includes("export function resolveTaskRoute"));
check("resolveTaskMultiRoute export", routerSrc.includes("export function resolveTaskMultiRoute"));
check("env 치환 (${VAR:-default})", routerSrc.includes("resolveEnvTemplate"));
check("client 캐시 (Map)", routerSrc.includes("_clientCache"));
check("provider availability 체크", routerSrc.includes("is_available"));
check("fallback_route 처리", routerSrc.includes("fallback_route") || routerSrc.includes("cfg.fallback_route"));
// logInfo / logWarn 호출에 apiKey/api_key 직접 노출 패턴이 없는지
const logKeyPattern = /log(Info|Warn|Error)\([^)]*api[_]?[Kk]ey[^)]*\)/;
check("api key 로그 노출 방지 (logger 직접 노출 없음)", !logKeyPattern.test(routerSrc));

// ── 4. config 검증 ──
console.log("\n── [4] config/model_routes.json ──");
const cfg = JSON.parse(readFileSync("config/model_routes.json", "utf8"));
check("active_route 필드", typeof cfg.active_route === "string");
check("route_sets 객체", typeof cfg.route_sets === "object");
check("baseline_local route", !!cfg.route_sets["baseline_local"]);
check("deepseek_renderer route", !!cfg.route_sets["deepseek_renderer"]);
check("deepseek_planner route", !!cfg.route_sets["deepseek_planner"]);
check("deepseek_full route", !!cfg.route_sets["deepseek_full"]);
check("high_quality_ensemble route", !!cfg.route_sets["high_quality_ensemble"]);
check("baseline_local에 multi_routes (judge)", !!cfg.route_sets["baseline_local"]?.multi_routes?.reader_immersion_judge);

// ── 5. dist 빌드 ──
console.log("\n── [5] dist 빌드 산출물 ──");
check("dist/services/llm_tasks.js", existsSync("dist/services/llm_tasks.js"));
check("dist/services/model_router.js", existsSync("dist/services/model_router.js"));
check("dist/services/model_clients/base.js", existsSync("dist/services/model_clients/base.js"));
check("dist/services/model_clients/openai_compatible.js", existsSync("dist/services/model_clients/openai_compatible.js"));
check("dist/services/model_clients/gemini_client.js", existsSync("dist/services/model_clients/gemini_client.js"));

// ── 6. 런타임 dump (실제 LLM 호출 X) ──
console.log("\n── [6] 런타임 dumpRouteSet (실제 호출 X) ──");
try {
  const { dumpRouteSet, listRouteSets } = await import("../dist/services/model_router.js");
  const sets = listRouteSets();
  check("listRouteSets 반환값 수 >= 5", sets.length >= 5, `actual=${sets.length}`);
  check("baseline_local 포함", sets.includes("baseline_local"));

  const baseline = dumpRouteSet("baseline_local");
  check("baseline_local 덤프 OK", !!baseline.routes.planner);
  check("baseline planner 모델 env 치환됨", typeof baseline.routes.planner?.model === "string" && !baseline.routes.planner.model.includes("${"));
  check("baseline reader_immersion_judge multi 2개 이상", (baseline.multi_routes.reader_immersion_judge?.length ?? 0) >= 2);
} catch (e) {
  fail("런타임 dump 실패", e.message);
}

// ── 결과 ──
console.log(`\n${"─".repeat(60)}`);
const result = failed === 0 ? "✅  ALL PASSED" : `❌  ${failed} FAILED`;
console.log(`${result} — ${passed + failed} checks (${passed} passed, ${failed} failed)`);
process.exit(failed > 0 ? 1 : 0);
