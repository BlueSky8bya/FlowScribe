/**
 * generate_smoke_episodes.mjs
 * Phase 4.9 smoke book용 10화 일괄 생성
 *
 * Usage: node scripts/generate_smoke_episodes.mjs --book-id <book_id> [--episodes 10]
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const totalEpisodes = args.includes("--episodes") ? parseInt(args[args.indexOf("--episodes") + 1]) : 10;
const modelRoute = args.includes("--route") ? args[args.indexOf("--route") + 1] : null;

if (!bookId) { console.error("Usage: --book-id <uuid> [--episodes 10] [--route <route_set>]"); process.exit(1); }

const BASE_URL = process.env.APP_URL ?? "http://localhost:3000";

async function generateEpisode(episodeNumber) {
  console.log(`\n[ep${episodeNumber}] 생성 시작...`);

  const res = await fetch(`${BASE_URL}/api/generate-v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
    body: JSON.stringify({
      book_id: bookId,
      episode: episodeNumber,
      use_planner: true,
      enable_trace: false,
      ...(modelRoute ? { model_route: modelRoute } : {}),
      gen_config: {
        episodeLength: 900,
        episodeLengthVar: 150,
        conflict: 8,
        foreshadow: 7,
        emotion: 7,
        dialogue: 7,
        direction: 8
      }
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  // SSE stream consumption
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
        if (parsed.done) {
          done = true;
          console.log(`[ep${episodeNumber}] 완료 — ${text.length}자 (chars=${parsed.chars ?? "?"})`);
        }
        if (parsed.error) {
          throw new Error(`SSE error: ${parsed.error}`);
        }
      } catch {}
    }
  }

  if (!done) {
    console.warn(`[ep${episodeNumber}] done 이벤트 없이 스트림 종료 (${text.length}자)`);
  }

  return text.length;
}

async function main() {
  console.log(`Book: ${bookId}`);
  console.log(`생성 대상: 1~${totalEpisodes}화`);
  console.log(`Route: ${modelRoute ?? "active (config default)"}`);

  for (let ep = 1; ep <= totalEpisodes; ep++) {
    try {
      await generateEpisode(ep);
      // 연속 생성 시 서버 과부하 방지
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`[ep${ep}] 생성 실패: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\n✅ ${totalEpisodes}화 생성 완료`);
  console.log("\n감사 명령:");
  console.log(`  node scripts/audit_item_location_ledger.mjs --book-id ${bookId}`);
  console.log(`  node scripts/audit_dialogue_repetition.mjs --book-id ${bookId}`);
  console.log(`  node scripts/audit_scene_transitions.mjs --book-id ${bookId}`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
