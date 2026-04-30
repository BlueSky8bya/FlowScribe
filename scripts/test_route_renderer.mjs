/**
 * test_route_renderer.mjs — 라우트별 renderer 호출 직접 검증
 *
 * 한 episode plan으로 baseline / deepseek_full 두 route renderer를 호출해 결과 비교.
 * 본문 자체를 DB에 쓰지 않음 (드라이런 검증).
 *
 * Usage: node scripts/test_route_renderer.mjs --book-id <uuid> --episode <N>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const episode = parseInt(args[args.indexOf("--episode") + 1] ?? "1", 10);
if (!bookId) { console.error("Usage: --book-id <uuid> --episode <N>"); process.exit(1); }

async function main() {
  const { runLLMTask, dumpRouteSet, listRouteSets } = await import("../dist/services/model_router.js");

  console.log(`\n${"═".repeat(70)}`);
  console.log(` Route Renderer Test (book=${bookId.slice(0,8)}.., ep=${episode})`);
  console.log("═".repeat(70));

  // 사용 가능한 route 확인
  const routes = listRouteSets();
  console.log(`available routes: ${routes.join(", ")}`);

  // 같은 system/user prompt로 두 route 비교
  const systemPrompt = "당신은 한국어 단편 소설 작가다. 3인칭 관찰자 시점으로 짧은 장면을 쓴다.";
  const userPrompt = `한 명의 인물이 폐허 도시에서 지하 통로 입구에 도착해 안으로 들어가는 장면을 5문장으로 써라. 한국어로만.`;

  const targetRoutes = ["baseline_local", "deepseek_full"];
  const results = [];

  for (const routeName of targetRoutes) {
    const dump = dumpRouteSet(routeName);
    const rendererRoute = dump.routes.renderer;
    if (!rendererRoute) {
      console.log(`\n[${routeName}] renderer route 없음 — skip`);
      continue;
    }
    console.log(`\n[${routeName}] renderer = ${rendererRoute.provider}/${rendererRoute.model}`);
    try {
      const t0 = Date.now();
      const r = await runLLMTask("renderer", {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        route_set_override: routeName,
        temperature: 0.85,
        max_tokens: 600,
      });
      const elapsed = Date.now() - t0;
      results.push({ route: routeName, provider: r.provider, model: r.model, elapsed_ms: elapsed, len: r.text.length, preview: r.text.slice(0, 300) });
      console.log(`  elapsed: ${elapsed}ms, len: ${r.text.length}자`);
      console.log(`  preview:\n${r.text.slice(0, 300).split("\n").map(l => "    " + l).join("\n")}`);
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      results.push({ route: routeName, error: e.message });
    }
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log("Summary");
  console.log("─".repeat(70));
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.route}: ERROR - ${r.error.slice(0, 60)}`);
    } else {
      console.log(`  ${r.route}: ${r.provider}/${r.model}, ${r.elapsed_ms}ms, ${r.len}자`);
    }
  }
  console.log("═".repeat(70));
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
