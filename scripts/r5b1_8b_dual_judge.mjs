/**
 * r5b1_8b_dual_judge.mjs — R5B-1.8B reader-facing emotional plausibility multi-judge
 *
 * 두 model(reader_immersion_judge route_set: gemini-2.5-flash + openai gpt-4.1-mini)에
 * TEST2D ep1~15의 _요약된 감정 흐름과 짧은 본문 발췌_만 보낸다. 본문 전문 절대 안 보냄.
 *
 * 출력은 `.tmp/r5b1_8b_judge_<provider>.json` 으로만 — 절대 git commit 금지.
 *
 * Usage:
 *   node scripts/r5b1_8b_dual_judge.mjs --book-id <uuid>
 */
import pg from "pg";
import { writeFileSync, mkdirSync } from "fs";
import { config } from "dotenv";
import { resolveTaskMultiRoute, runLLMTask } from "../dist/services/model_router.js";

config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
if (!bookId) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 본문 발췌 요약 — 각 화에서 _첫 6줄 + 마지막 2줄만_ 추출. 전문 미사용.
function _shortExcerpt(content) {
  const lines = (content ?? "").split("\n").filter(Boolean);
  if (lines.length <= 8) return lines.join(" / ").slice(0, 280);
  const head = lines.slice(0, 6).join(" / ");
  const tail = lines.slice(-2).join(" / ");
  return `${head} ... [중략] ... ${tail}`.slice(0, 320);
}

function _shortBeat(b) {
  const f = (s) => (s ?? "").slice(0, 30);
  return `${b.name}: ${f(b.previous_emotion)}→${f(b.current_emotion)} | cause=${f(b.emotion_cause)} | goal=${f(b.goal_delta)} | beh=${f(b.behavior_delta)} | rel=${f(b.relationship_delta)} | dec=${f(b.decision_delta)}`;
}

async function main() {
  const eps = (await pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 AND episode_number<=15 ORDER BY episode_number`,
    [bookId]
  )).rows;
  const traces = (await pool.query(
    `SELECT DISTINCT ON (episode_number) episode_number, planner_trace
     FROM run_traces WHERE book_id=$1 AND episode_number<=15
     ORDER BY episode_number, created_at DESC`,
    [bookId]
  )).rows;
  const beatsByEp = {};
  for (const t of traces) {
    const beats = t.planner_trace?.parsed_plan?.character_emotional_beats ?? [];
    beatsByEp[t.episode_number] = Array.isArray(beats) ? beats : [];
  }

  const summary = eps.map(e => ({
    ep: e.episode_number,
    beats: beatsByEp[e.episode_number]?.map(_shortBeat) ?? [],
    excerpt: _shortExcerpt(e.content),
  }));

  // 대화 형식 (한국어)
  const userMsg = `당신은 소설 reader-facing 감정 흐름 평가자다. 아래는 어떤 소설 ep1~15의 인물별 planner emotional_beat과 본문 짧은 발췌다.

[평가 항목]
1. 같은 감정군이 유지되는 것이 사건 흐름상 납득 가능한가?
2. 인물의 행동 방식이 화마다 달라지는가?
3. 감정이 설명으로만 나오지 않고 행동/대사/선택으로 드러나는가?
4. planner emotional_beat가 본문에 실제 반영됐는가?
5. 50화로 확장해도 감정 몰입이 유지될 가능성이 있는가?
6. 특정 인물이 지나치게 단조롭게 느껴지는가?

[데이터]
${summary.map(s => `--- ep${s.ep} ---\n[planner beats]\n${s.beats.join("\n")}\n[excerpt]\n${s.excerpt}`).join("\n\n")}

[출력 — JSON]
{
  "scores": {"sameCluster_naturalness": 1~5, "behavior_variation": 1~5, "show_dont_tell": 1~5, "planner_render_alignment": 1~5, "scalable_50ep": 1~5, "monotony_risk": "none|some|severe"},
  "average": (위 5개 1~5 점수 평균),
  "verdict": "READY" or "CONDITIONAL" or "NOT_READY",
  "reasoning": "한 단락 (200자 이하)",
  "monotonous_characters": ["..."]
}`;

  const routes = resolveTaskMultiRoute("reader_immersion_judge");
  if (!routes || routes.length === 0) { console.error("no routes"); process.exit(1); }

  console.log(`[judge] routes: ${routes.map(r => `${r.provider}/${r.model}`).join(", ")}`);
  console.log(`[judge] payload: ${userMsg.length} chars`);

  mkdirSync(".tmp", { recursive: true });

  const results = [];
  for (const route of routes) {
    console.log(`\n[${route.provider}/${route.model}] judging...`);
    try {
      // Gemini-2.5-flash는 thinking이 max_tokens를 소모 → output 잘림. 충분히 크게.
      const isGemini = route.provider === "gemini";
      const res = await runLLMTask("reader_immersion_judge", {
        route_override: route,
        messages: [{ role: "user", content: userMsg }],
        temperature: route.temperature ?? 0.1,
        max_tokens: isGemini ? 16000 : 4000,
        json_mode: true,
        timeout_ms: 120000,
      });
      const txt = res.text ?? "";
      let parsed = null;
      // 1) raw direct
      try { parsed = JSON.parse(txt); } catch {}
      // 2) ```json fenced block
      if (!parsed) {
        const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fence) try { parsed = JSON.parse(fence[1].trim()); } catch {}
      }
      // 3) first { ... last }
      if (!parsed) {
        const start = txt.indexOf("{");
        const end = txt.lastIndexOf("}");
        if (start >= 0 && end > start) try { parsed = JSON.parse(txt.slice(start, end + 1)); } catch {}
      }
      console.log(`  elapsed: ${res.elapsed_ms}ms`);
      console.log(`  parsed: ${parsed ? "OK" : "FAIL"}`);
      if (parsed) {
        console.log(`  scores: ${JSON.stringify(parsed.scores)}`);
        console.log(`  average: ${parsed.average}`);
        console.log(`  verdict: ${parsed.verdict}`);
        console.log(`  monotonous: ${JSON.stringify(parsed.monotonous_characters)}`);
        console.log(`  reasoning: ${parsed.reasoning}`);
      } else {
        console.log(`  raw[first 400]: ${txt.slice(0, 400)}`);
      }
      results.push({ provider: route.provider, model: route.model, parsed, raw_excerpt: txt.slice(0, 600), elapsed_ms: res.elapsed_ms });
      const out = `.tmp/r5b1_8b_judge_${route.provider}.json`;
      writeFileSync(out, JSON.stringify({ provider: route.provider, model: route.model, parsed, elapsed_ms: res.elapsed_ms, raw_text: txt, finish_reason: res.finish_reason }, null, 2), "utf8");
      console.log(`  written: ${out}`);
    } catch (err) {
      console.error(`[error] ${route.provider}: ${err.message}`);
    }
  }

  await pool.end();
}
main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(1); });
