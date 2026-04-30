/**
 * verify_generation_latency_markers.mjs — Phase 4.19C
 *
 * /api/generate (planner 경로)에 latency 계측 마커가 모두 박혔는지 정적 검증.
 * 실제 실행 시간은 logger 출력에서 확인 (raw prompt/response는 절대 남기지 않음).
 *
 * 마커:
 *   request_start
 *   effective_context_done
 *   pipeline_start
 *   pipeline_done   (planner_ms, renderer_ms, total_pipeline_ms 포함)
 *   first_token_sent
 *   char_states_fetched
 *   done_sent
 *
 * 또한 result 객체가 planner_elapsed_ms / renderer_elapsed_ms를 노출하는지 확인.
 */
import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const check = (s, c, d) => c ? ok(s) : ng(s, d);

const gen     = readFileSync("src/api/generate.ts", "utf8");
const pipeIdx = readFileSync("src/pipeline/index.ts", "utf8");

console.log("── [1] _genMark helper 정의 ──");
check("_genMark helper 정의", /const\s+_genMark\s*=\s*\(label/.test(gen));
check("api:generate:latency 채널로 logInfo 호출", /api:generate:latency/.test(gen));

console.log("\n── [2] 필수 마커 라벨 emit ──");
const markers = [
  "request_start",
  "effective_context_done",
  "pipeline_start",
  "pipeline_done",
  "first_token_sent",
  "char_states_fetched",
  "done_sent",
];
for (const m of markers) check(`${m} 마커`, gen.includes(`"${m}"`));

console.log("\n── [3] pipeline 결과의 elapsed 필드 노출 ──");
check("runPlannerPipeline 결과에 planner_elapsed_ms 노출", /planner_elapsed_ms/.test(pipeIdx));
check("runPlannerPipeline 결과에 renderer_elapsed_ms 노출", /renderer_elapsed_ms/.test(pipeIdx));
check("pipeline_done 마커가 elapsed 필드 함께 emit",
  /pipeline_done[\s\S]{0,400}planner_ms[\s\S]{0,80}renderer_ms[\s\S]{0,80}total_pipeline_ms/.test(gen));

console.log("\n── [4] raw prompt/response 절대 미노출 ──");
const latencyBlocks = gen.match(/_genMark\([^)]+\)/g) ?? [];
for (const b of latencyBlocks) {
  if (/prompt|response|text|content/.test(b) && !/text:\s*[^,]/.test(b)) {
    // chars(length) 정도만 허용
  }
}
check("_genMark 호출에 prompt/response/full text 포함 안 함",
  !latencyBlocks.some(b => /prompt|response|full_text|raw_text/.test(b)));

console.log("\n── [5] 산출물 ──");
check("dist/api/generate.js", existsSync("dist/api/generate.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
