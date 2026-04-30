/**
 * test_ep1_regen_loop.mjs — Phase 4.17 ep1 재생성 5회 + intro integrity 검증
 *
 * book에 ep1을 5회 생성해 각 결과의 첫 200자를 출력한다.
 * 매번 같은 ep을 재생성하므로 server의 regen 로직이 활성화된다.
 *
 * Usage: node scripts/test_ep1_regen_loop.mjs --book-id <uuid> [--regens 5]
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const regens = args.includes("--regens") ? parseInt(args[args.indexOf("--regens") + 1]) : 5;
if (!bookId) { console.error("Usage: --book-id <uuid> [--regens 5]"); process.exit(1); }

const BASE_URL = process.env.APP_URL ?? "http://localhost:3000";

async function generateEp1(attempt) {
  const url = `${BASE_URL}/api/generate?episode=1&book_id=${bookId}&use_planner=true${attempt > 1 ? `&regen_nonce=${Date.now().toString(36)}` : ""}`;
  const res = await fetch(url, { method: "GET", headers: { "Accept": "text/event-stream" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let text = "";
  let done = false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    const chunk = decoder.decode(value);
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.token) text += parsed.token;
        if (parsed.done) done = true;
        if (parsed.error) throw new Error(parsed.error);
      } catch {}
    }
  }
  return text;
}

async function main() {
  console.log(`\n${"═".repeat(75)}`);
  console.log(` ep1 재생성 ${regens}회 테스트 (book ${bookId.slice(0, 8)}...)`);
  console.log("═".repeat(75));
  const openings = [];
  for (let i = 1; i <= regens; i++) {
    process.stdout.write(`\n[ep1 #${i}] 생성 중... `);
    try {
      const t0 = Date.now();
      const text = await generateEp1(i);
      const elapsed = Date.now() - t0;
      const opening = text.slice(0, 200).replace(/\n+/g, " | ");
      openings.push(opening);
      console.log(`(${elapsed}ms, ${text.length}자)`);
      console.log(`  opening: ${opening}`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
    }
    // 다음 시도 전 약간 대기
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`\n${"─".repeat(75)}`);
  console.log(`✓ 완료. 총 ${openings.length}개 opening 수집.`);
  // 다양성 측정 (단순 unique opening 비율)
  const unique = new Set(openings.map(o => o.slice(0, 100))).size;
  console.log(`  diversity (앞 100자 unique): ${unique}/${openings.length}`);
  console.log("═".repeat(75));
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
