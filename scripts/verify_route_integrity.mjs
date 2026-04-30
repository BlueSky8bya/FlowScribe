/**
 * verify_route_integrity.mjs — Phase 4.14C route config 무결성 검증
 *
 * 각 route_set의 모든 task에 대해 router가 config의 provider/model을 그대로 호출하는지
 * 작은 dry-run 호출로 직접 검증한다. 실제 LLM이 응답하는지도 확인.
 *
 * fall-through 방지: route config가 baseline과 같은 provider/model이라면 OK,
 * 다르다면 useRouter=true로 동작해야 한다.
 *
 * Usage: node scripts/verify_route_integrity.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();

let passed = 0; let failed = 0; let skipped = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
function skip(label, detail) { console.log(`  ⊘ ${label}${detail ? ` — ${detail}` : ""}`); skipped++; }

async function main() {
  const { runLLMTask, dumpRouteSet, listRouteSets } = await import("../dist/services/model_router.js");

  const W = 75;
  console.log(`\n${"═".repeat(W)}\n Phase 4.14C — Route Integrity Verify\n${"═".repeat(W)}`);

  const routes = listRouteSets();
  console.log(`route sets: [${routes.join(", ")}]`);

  // 핵심 task만 검증 (planner / renderer / narrative_repair)
  const targetTasks = ["planner", "renderer", "narrative_repair"];

  for (const routeName of routes) {
    console.log(`\n── ${routeName} ──`);
    const dump = dumpRouteSet(routeName);
    for (const task of targetTasks) {
      const expected = dump.routes[task];
      if (!expected) {
        skip(`${task} (no route mapping)`);
        continue;
      }
      // planner는 json_mode=true가 config에 설정될 수 있음 — OpenAI/DeepSeek는
      // prompt에 'json' 단어 없으면 400. 실제 planner prompt는 JSON schema 포함이지만
      // 본 verify는 작은 dry-run이므로 prompt에 'json' 명시.
      const isJsonTask = task === "planner" || task === "state_extractor";
      const testPrompt = isJsonTask
        ? `Respond with a tiny JSON: {"ok":1}. (한국어 무시 가능)`
        : "한국어로 한 단어만 출력: 안녕.";
      try {
        const r = await runLLMTask(task, {
          messages: [{ role: "user", content: testPrompt }],
          route_set_override: routeName,
          temperature: 0.1,
          max_tokens: 30,
        });
        const providerOk = r.provider === expected.provider;
        const modelOk = r.model === expected.model;
        if (providerOk && modelOk && r.text.length > 0) {
          ok(`${task}: ${r.provider}/${r.model} (${r.elapsed_ms}ms)`);
        } else if (!providerOk || !modelOk) {
          fail(`${task} mismatch`, `expected=${expected.provider}/${expected.model}, actual=${r.provider}/${r.model}`);
        } else {
          fail(`${task} empty response`);
        }
      } catch (e) {
        fail(`${task}`, e.message.slice(0, 80));
      }
    }

    // multi_routes (judge)
    const judges = dump.multi_routes.reader_immersion_judge;
    if (judges?.length) {
      console.log(`  judge: ${judges.length}개 등록 (${judges.map(j => `${j.provider}/${j.model}`).join(", ")})`);
    }
  }

  console.log(`\n${"─".repeat(W)}`);
  console.log(`PASS ${passed} | FAIL ${failed} | SKIP ${skipped}`);
  console.log(`${"═".repeat(W)}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
