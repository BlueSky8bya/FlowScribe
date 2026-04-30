/**
 * measure_context_save_latency.mjs — Phase 4.20 R1.5
 *
 * /api/context POST의 latency 측정.
 * Phase 4.19C에서 setImmediate + Promise.all로 분리했으므로 응답 자체는 빠를 것.
 * 본 스크립트는 같은 book을 N번 saveContext 재호출해 p50/p95 측정.
 *
 * 실행 환경: server가 띄워져 있어야 함 (npm run dev / npm start).
 *
 * Usage:
 *   node scripts/measure_context_save_latency.mjs --book-id <X> --runs 5 [--app-url http://localhost:3000]
 *
 * 주의: 이 스크립트는 GET /api/context/:bookId로 현재 컨텍스트를 받고 그 payload로 POST /api/context를 N번 다시 보낸다.
 *       따라서 측정 도중 사용자 데이터가 변경되지 않는다 (idempotent).
 *       raw payload 출력 금지, latency만 기록.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const runs = args.includes("--runs") ? parseInt(args[args.indexOf("--runs") + 1]) : 5;
const appUrl = args.includes("--app-url") ? args[args.indexOf("--app-url") + 1] : (process.env.APP_URL ?? "http://localhost:3000");
if (!bookId || bookId.startsWith("--")) {
  console.error("Usage: --book-id <uuid> [--runs 5] [--app-url http://localhost:3000]");
  process.exit(2);
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a,b) => a-b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p / 100));
  return sorted[idx];
}

async function fetchExistingContext() {
  const r = await fetch(`${appUrl}/api/context/${bookId}`);
  if (!r.ok) throw new Error(`GET /api/context failed: ${r.status}`);
  return await r.json();
}

async function postContext(payload) {
  const t0 = Date.now();
  const r = await fetch(`${appUrl}/api/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const elapsed = Date.now() - t0;
  if (!r.ok) throw new Error(`POST /api/context failed: ${r.status}`);
  return elapsed;
}

(async () => {
  const W = 70;
  console.log("\n" + "═".repeat(W));
  console.log(` saveContext Latency Measurement (Phase 4.20 R1.5)`);
  console.log(` book_id: ${bookId.slice(0, 8)}…   runs: ${runs}   url: ${appUrl}`);
  console.log("═".repeat(W));

  // 1. 기존 context 가져오기 (saveContext의 입력으로 재사용)
  let existing;
  try {
    existing = await fetchExistingContext();
  } catch (e) {
    console.error(`기존 context 가져오기 실패: ${e.message}`);
    console.error("→ saveContext가 처음 호출되는 책이거나 server가 안 떠 있는지 확인");
    process.exit(2);
  }

  const payload = {
    book_id: bookId,
    worldBible: {
      world_rules: existing.world_rules ?? [],
      character_defaults: existing.character_defaults ?? {},
      fixed_relationships: existing.fixed_relationships ?? [],
      forbidden_settings: existing.forbidden_settings ?? [],
    },
    storyConfig: existing.story_config ?? null,
  };

  // 2. 워밍업 1회 (cache 안정화)
  try {
    const _warm = await postContext(payload);
    console.log(`\n워밍업: ${_warm} ms`);
  } catch (e) {
    console.error(`워밍업 실패: ${e.message}`);
    process.exit(2);
  }

  // 3. N번 측정
  const samples = [];
  for (let i = 1; i <= runs; i++) {
    try {
      const ms = await postContext(payload);
      samples.push(ms);
      console.log(`run ${i}/${runs}: ${ms} ms`);
    } catch (e) {
      console.error(`run ${i} 실패: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // 4. 통계
  if (!samples.length) {
    console.error("\n측정 실패");
    process.exit(2);
  }
  const sum = samples.reduce((a,b) => a+b, 0);
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const avg = sum / samples.length;
  const p50 = pct(samples, 50);
  const p95 = pct(samples, 95);

  console.log("\n" + "═".repeat(W));
  console.log(` 결과 (saveContext POST round-trip, body bytes ~${JSON.stringify(payload).length})`);
  console.log(`   samples: ${samples.length}`);
  console.log(`   min:  ${min} ms`);
  console.log(`   p50:  ${p50} ms`);
  console.log(`   avg:  ${avg.toFixed(0)} ms`);
  console.log(`   p95:  ${p95} ms`);
  console.log(`   max:  ${max} ms`);
  console.log("═".repeat(W));
  console.log(` Phase 4.19C 목표: p95 < 2000 ms`);
  console.log(` 결과: ${p95 < 2000 ? "✅ 달성" : "❌ 추가 조사"}`);
  console.log("═".repeat(W));
  console.log(`\n[참고] item_desc LLM enrich는 setImmediate background로 별도 진행됨 (응답에 포함 안 됨).`);
  console.log(`logger 채널 'api:context:save:latency'에서 item_desc_bg_start / item_desc_bg_done 마커 확인 가능.\n`);

  // JSON 산출물 (raw payload 포함 안 함)
  const out = {
    generated_at: new Date().toISOString(),
    book_id_prefix: bookId.slice(0, 8),
    runs: samples.length,
    samples_ms: samples,
    stats: { min, p50, avg: Math.round(avg), p95, max },
    target_p95_ms: 2000,
    pass: p95 < 2000,
  };
  console.log("// JSON summary (raw payload 미포함):");
  console.log(JSON.stringify(out, null, 2));

  process.exit(0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(2); });
