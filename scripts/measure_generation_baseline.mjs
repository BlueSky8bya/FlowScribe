/**
 * measure_generation_baseline.mjs — Phase 4.20 R1.5
 *
 * /api/generate (planner path)의 latency 측정.
 * SSE 응답을 받아 다음 마커별 시간 분해:
 *   click_to_request_start (negligible — 클라 측정 아님)
 *   request_received (서버 timestamp from SSE 첫 status event)
 *   first_token_received (json.token 첫 수신)
 *   done_received (json.done 수신)
 * 또한 server가 SSE에 포함한 char_states / episode_meta 메타에서
 * planner_ms / renderer_ms / total_pipeline_ms를 추출.
 *
 * 실행 환경: server가 띄워져 있어야 함.
 * raw 본문 텍스트를 저장하지 않음 — char count만.
 *
 * Usage:
 *   node scripts/measure_generation_baseline.mjs --book-id <X> --episode 1 \
 *     [--route high_quality_ensemble] [--runs 1] [--app-url http://localhost:3000]
 *
 * 주의:
 *   - 측정 1회당 1회 generation = 모델 비용/시간 발생
 *   - --runs > 1 이면 비용 증가. baseline 용도 1-3회 권장
 *   - generated_text는 char count만 출력. 본문 자체는 저장 안 함.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const episode = parseInt(args[args.indexOf("--episode") + 1] ?? "1", 10);
const route = args.includes("--route") ? args[args.indexOf("--route") + 1] : null;
const runs = args.includes("--runs") ? parseInt(args[args.indexOf("--runs") + 1]) : 1;
const appUrl = args.includes("--app-url") ? args[args.indexOf("--app-url") + 1] : (process.env.APP_URL ?? "http://localhost:3000");

if (!bookId || bookId.startsWith("--")) {
  console.error("Usage: --book-id <uuid> --episode N [--route NAME] [--runs 1] [--app-url ...]");
  process.exit(2);
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a,b) => a-b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p / 100));
  return sorted[idx];
}

async function generateOnce(label) {
  const routeParam = route ? `&model_route=${encodeURIComponent(route)}` : "";
  // regen_nonce로 매번 다른 결과 유도 (cache hit 방지)
  const url = `${appUrl}/api/generate?episode=${episode}&book_id=${bookId}&use_planner=true&regen_nonce=${Date.now().toString(36)}${routeParam}`;

  const t0 = Date.now();
  let firstTokenAt = null;
  let doneAt = null;
  let charCount = 0;
  let episodeMeta = null;
  let charStatesCount = null;

  const res = await fetch(url, { method: "GET", headers: { "Accept": "text/event-stream" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.token) {
          if (firstTokenAt == null) firstTokenAt = Date.now();
          charCount += parsed.token.length;
        }
        if (parsed.done) {
          doneAt = Date.now();
          if (parsed.episode_meta) episodeMeta = parsed.episode_meta;
          if (parsed.char_states) charStatesCount = Array.isArray(parsed.char_states) ? parsed.char_states.length : 0;
        }
      } catch { /* status line 등 ignore */ }
    }
  }

  const click_to_first_token = firstTokenAt ? firstTokenAt - t0 : null;
  const click_to_done = doneAt ? doneAt - t0 : null;
  const first_token_to_done = (firstTokenAt && doneAt) ? doneAt - firstTokenAt : null;

  return {
    label,
    click_to_first_token_ms: click_to_first_token,
    click_to_done_ms: click_to_done,
    first_token_to_done_ms: first_token_to_done,
    body_char_count: charCount,
    char_states_count: charStatesCount,
    planner_ms: episodeMeta?.planner_ms ?? null,           // (Phase 4.19C에서 episode_meta에 안 넣음 — logger 마커로 확인)
    renderer_ms: episodeMeta?.renderer_ms ?? null,
    total_pipeline_ms: episodeMeta?.total_pipeline_ms ?? null,
    plan_verdict: episodeMeta?.plan_verdict ?? null,
    final_score: episodeMeta?.final_score ?? null,
    revision_count: episodeMeta?.revision_count ?? null,
    plan_fallback_used: episodeMeta?.plan_fallback_used ?? null,
  };
}

(async () => {
  const W = 75;
  console.log("\n" + "═".repeat(W));
  console.log(` Generation Latency Baseline (Phase 4.20 R1.5)`);
  console.log(` book_id: ${bookId.slice(0,8)}…  episode: ${episode}  route: ${route ?? "default"}  runs: ${runs}`);
  console.log("═".repeat(W));

  const samples = [];
  for (let i = 1; i <= runs; i++) {
    try {
      console.log(`\nrun ${i}/${runs} 시작...`);
      const r = await generateOnce(`run-${i}`);
      samples.push(r);
      console.log(`  click_to_first_token: ${r.click_to_first_token_ms} ms`);
      console.log(`  click_to_done:        ${r.click_to_done_ms} ms`);
      console.log(`  body chars:           ${r.body_char_count}`);
      if (r.plan_verdict) console.log(`  plan_verdict: ${r.plan_verdict}, score: ${r.final_score ?? "-"}, revisions: ${r.revision_count ?? 0}, plan_fallback: ${r.plan_fallback_used ?? false}`);
    } catch (e) {
      console.error(`  run ${i} 실패: ${e.message}`);
    }
    if (i < runs) await new Promise(r => setTimeout(r, 1500));
  }

  if (!samples.length) {
    console.error("\n측정 실패");
    process.exit(2);
  }

  const fts = samples.map(s => s.click_to_first_token_ms).filter(v => v != null);
  const dones = samples.map(s => s.click_to_done_ms).filter(v => v != null);

  console.log("\n" + "═".repeat(W));
  console.log(` 통계 (samples=${samples.length})`);
  console.log(`   click_to_first_token   p50=${pct(fts,50)}  p95=${pct(fts,95)}  ms`);
  console.log(`   click_to_done          p50=${pct(dones,50)}  p95=${pct(dones,95)}  ms`);
  console.log("═".repeat(W));
  console.log(` 참고 — Phase 4.20 forensic 추정:`);
  console.log(`   click_to_first_token   현재 11-25 s (judge 미발동) / 16-40 s (발동)`);
  console.log(`   R5 hybrid 후 목표      5-12 s`);
  console.log("═".repeat(W));
  console.log(`\nlogger 채널 'api:generate:latency'에서 단계별 시간 (request_start, effective_context_done,`);
  console.log(`pipeline_start, pipeline_done with planner_ms/renderer_ms/total_pipeline_ms, first_token_sent,`);
  console.log(`char_states_fetched, done_sent) 확인 가능.\n`);

  const out = {
    generated_at: new Date().toISOString(),
    book_id_prefix: bookId.slice(0,8),
    episode,
    route: route ?? "default",
    runs: samples.length,
    samples,        // body_char_count만 포함, 본문 자체 아님
    stats: {
      first_token_p50: pct(fts, 50),
      first_token_p95: pct(fts, 95),
      done_p50: pct(dones, 50),
      done_p95: pct(dones, 95),
    },
  };
  console.log("// JSON summary (raw text 미포함):");
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(2); });
