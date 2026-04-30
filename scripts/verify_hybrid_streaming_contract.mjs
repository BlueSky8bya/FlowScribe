/**
 * verify_hybrid_streaming_contract.mjs — Phase 4.20 R5A
 *
 * hybrid streaming 구현이 정적 코드 contract를 준수하는지 확인.
 *   - feature flag (stream_mode=hybrid OR FEATURE_HYBRID_STREAMING=true) 정의
 *   - 기본 모드는 batch (default 깨지지 않음)
 *   - planner는 streaming 적용 안 함 (JSON 출력)
 *   - renderer만 onChunk 적용
 *   - phase 이벤트 emit (planner_start/done, renderer_start/done, save_start/done, postprocess_start)
 *   - DB 저장은 sanitized full_text (chunk별 저장 안 함)
 *   - judge/repair는 advisory only (R2 임계 정밀화 그대로 사용)
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const generate = readFileSync("src/api/generate.ts", "utf8");
const pipeline = readFileSync("src/pipeline/index.ts", "utf8");
const renderer = readFileSync("src/pipeline/renderer.ts", "utf8");
const router   = readFileSync("src/services/model_router.ts", "utf8");
const baseInf  = readFileSync("src/services/model_clients/base.ts", "utf8");
const oaiClient = readFileSync("src/services/model_clients/openai_compatible.ts", "utf8");

console.log("── [1] feature flag 정의 ──");
okIf("stream_mode 쿼리 파라미터 처리", /stream_mode/.test(generate));
okIf("FEATURE_HYBRID_STREAMING 환경변수", /FEATURE_HYBRID_STREAMING/.test(generate));
okIf("useHybridStream 플래그", /useHybridStream/.test(generate));
okIf("default batch 유지 (명시 'batch' override 가능)", /stream_mode.*===.*"batch"|_streamModeQ\s*!==\s*"batch"/.test(generate));

console.log("\n── [2] ChatRequest onChunk 지원 ──");
okIf("ChatRequest.onChunk 정의", /onChunk\?\s*:\s*\(delta:\s*string\)\s*=>\s*void/.test(baseInf));
okIf("OpenAICompatibleClient stream 분기 (req.onChunk 검사)", /if\s*\(\s*req\.onChunk\s*\)/.test(oaiClient));
okIf("stream:true 옵션 사용", /stream:\s*true/.test(oaiClient));
okIf("LLMTaskInput.onChunk 통과", /onChunk\?\s*:\s*\(delta:\s*string\)\s*=>\s*void/.test(router));

console.log("\n── [3] pipeline phase + chunk 통과 ──");
okIf("PlannerPipelineOptions.onRendererChunk", /onRendererChunk\?\s*:\s*\(delta:\s*string\)\s*=>\s*void/.test(pipeline));
okIf("PlannerPipelineOptions.onPhase", /onPhase\?\s*:\s*\(phase:\s*string/.test(pipeline));
okIf("planner_start emit", /phase\(\s*["']planner_start["']/.test(pipeline));
okIf("planner_done emit (elapsed_ms 포함)", /phase\(\s*["']planner_done["']\s*,\s*\{\s*elapsed_ms/.test(pipeline));
okIf("renderer_start emit", /phase\(\s*["']renderer_start["']/.test(pipeline));
okIf("renderer_done emit (elapsed_ms 포함)", /phase\(\s*["']renderer_done["']\s*,\s*\{\s*elapsed_ms/.test(pipeline));
okIf("renderer 호출에 onRendererChunk 전달", /renderFromPlanWithTrace\([^)]*onRendererChunk\)/.test(pipeline));

console.log("\n── [4] renderer streaming 분기 ──");
okIf("renderFromPlanWithTrace onChunk 시그너처", /renderFromPlanWithTrace\(\s*[\s\S]*?onChunk\?\s*:\s*\(delta:\s*string\)/.test(renderer));
okIf("router 호출에 onChunk 통과", /runLLMTask\([\s\S]*?onChunk/.test(renderer));
okIf("legacy path stream:true 분기 (onChunk 시)", /if\s*\(\s*onChunk\s*\)/.test(renderer));

console.log("\n── [5] generate.ts hybrid SSE 이벤트 ──");
okIf("hybrid token chunk emit (data: {token: delta})", /token:\s*delta|JSON\.stringify\(\s*\{\s*token:\s*delta/.test(generate));
okIf("hybrid phase emit (planner/renderer/save/postprocess)", /JSON\.stringify\(\s*\{\s*phase:/.test(generate));
okIf("save_done phase 이벤트", /["']save_done["']/.test(generate));
okIf("postprocess_start phase 이벤트", /["']postprocess_start["']/.test(generate));
okIf("sanitized_correction emit (chunk vs DB 차이)", /sanitized_correction/.test(generate));
okIf("batch 경로는 기존 token batch 유지", /res\.write\(\s*`data:\s*\$\{JSON\.stringify\(\s*\{\s*token:\s*result\.generated_text\s*\}\s*\)\s*\}/.test(generate));

console.log("\n── [6] DB 저장 정책 ──");
okIf("INSERT INTO episodes는 sanitized clean 사용 (batch+hybrid 공통)", /INSERT INTO episodes[\s\S]*?clean|VALUES\s*\(\$1,\s*\$2,\s*\$3,\s*\$4\)/.test(generate));
okIf("token chunk별 DB write 없음 (chunk callback이 query 호출 안 함)", !/onChunk[\s\S]*?pool\.query/.test(generate));

console.log("\n── [7] judge advisory only (R2 임계 유지) ──");
okIf("judge 발동 임계 (hints>=2 OR cross-check) 그대로", /coherenceHints\.length\s*>=\s*2/.test(pipeline));
okIf("judge skip 시 audit log 보존", /judge skip \(threshold below\)/.test(pipeline));

console.log("\n── [8] dist 빌드 산출물 ──");
okIf("dist/api/generate.js", existsSync("dist/api/generate.js"));
okIf("dist/pipeline/index.js", existsSync("dist/pipeline/index.js"));
okIf("dist/pipeline/renderer.js", existsSync("dist/pipeline/renderer.js"));
okIf("dist/services/model_clients/openai_compatible.js", existsSync("dist/services/model_clients/openai_compatible.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
