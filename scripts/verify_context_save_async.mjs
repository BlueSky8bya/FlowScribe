/**
 * verify_context_save_async.mjs — Phase 4.19C
 *
 * /api/context POST의 비동기 처리 정적 검증.
 *   1. setImmediate + Promise.all 패턴 — saveContext 응답이 LLM enrich 대기 안 함
 *   2. background failure가 응답을 막지 않음 (.catch swallow)
 *   3. latency markers (context_save_start / context_db_save_done /
 *      context_response_sent / item_desc_bg_start / item_desc_bg_done) emit
 */
import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const check = (s, c, d) => c ? ok(s) : ng(s, d);

const ctxApi = readFileSync("src/api/context.ts", "utf8");

console.log("── [1] setImmediate + Promise.all 패턴 ──");
check("setImmediate로 응답 사이클 후 enrich 실행",
  /setImmediate\(\(\)\s*=>\s*\{[\s\S]{0,200}Promise\.all/.test(ctxApi));
check("Promise.all 병렬 실행",
  /Promise\.all\(enrichJobs\.map\(/.test(ctxApi));
check("개별 job 실패는 .catch로 swallow",
  /generateAndSaveItemDescriptions\(\{[\s\S]{0,800}\}\)\s*\.catch\(/.test(ctxApi));
check("응답 전송이 setImmediate 이후 실행되지 않음 (즉시 res.json)",
  /res\.json\(\{ ok: true \}\)/.test(ctxApi) && !/await\s+Promise\.all\(enrichJobs/.test(ctxApi));

console.log("\n── [2] latency markers ──");
check("context_save_start 마커", ctxApi.includes("context_save_start"));
check("context_db_save_done 마커", ctxApi.includes("context_db_save_done"));
check("context_response_sent 마커", ctxApi.includes("context_response_sent"));
check("item_desc_bg_start 마커", ctxApi.includes("item_desc_bg_start"));
check("item_desc_bg_done 마커", ctxApi.includes("item_desc_bg_done"));
check("item_desc_bg_error 마커", ctxApi.includes("item_desc_bg_error"));

console.log("\n── [3] response 전 await 차단 확인 ──");
// generateAndSaveItemDescriptions가 응답 전에 await되지 않아야 함
const beforeRes = ctxApi.split("res.json({ ok: true })")[0];
check("응답 전에 generateAndSaveItemDescriptions await 호출 없음",
  !/await\s+generateAndSaveItemDescriptions/.test(beforeRes));
check("응답 전 setImmediate로만 enrichJobs 처리",
  /enrichJobs\.length[\s\S]{0,150}setImmediate/.test(beforeRes));

console.log("\n── [4] dist 빌드 ──");
check("dist/api/context.js", existsSync("dist/api/context.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
