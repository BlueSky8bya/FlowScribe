/**
 * gen_validate.ts — 단건 에피소드 생성 + Claude 검증 CLI
 *
 * 실행:
 *   npx tsx scripts/gen_validate.ts <book_id> <episode> [--revise] [--version B]
 *
 * 예시:
 *   npx tsx scripts/gen_validate.ts my-book-id 5
 *   npx tsx scripts/gen_validate.ts my-book-id 5 --revise
 *   npx tsx scripts/gen_validate.ts my-book-id 5 --revise --version B
 *
 * 또는 랜덤 테스트 케이스 생성:
 *   npx tsx scripts/gen_validate.ts --random [difficulty]
 */

import "dotenv/config";
import { pool } from "../src/lib/db.js";
import { runMigrateV2 } from "../src/db/migrate_v2.js";
import { buildEffectiveContext, effectiveContextToStoryContext } from "../src/services/effective_context.js";
import { validate } from "../src/services/validator.js";
import { reviseUntilPass } from "../src/services/revision.js";
import { getLLMClient, getStoryModel } from "../src/lib/llm.js";
import { generateTestCases } from "./case_generator.js";
import type { EffectiveContext, Difficulty } from "../src/types/canonical.js";

// ── 인수 파싱 ────────────────────────────────────────────────
const args = process.argv.slice(2);
const isRandom    = args[0] === "--random";
const doRevise    = args.includes("--revise");
const versionIdx  = args.indexOf("--version");
const promptVer   = (versionIdx !== -1 ? args[versionIdx + 1] : "A") as "A" | "B";

async function runWithBookId(bookId: string, episodeNumber: number) {
  console.log(`\n📖 book_id=${bookId}  episode=${episodeNumber}`);

  // 유효 컨텍스트 조립
  const ctx = await buildEffectiveContext({ bookId, episodeNumber });
  const storyCtx = effectiveContextToStoryContext(ctx);

  // 생성 (non-streaming, 직접 LLM 호출)
  const llm    = getLLMClient();
  const model  = getStoryModel();
  const cfg    = ctx.gen_config;
  const maxTok = Math.ceil((cfg.episodeLength + cfg.episodeLengthVar) * 0.65 * 1.4) + 300;

  console.log(`⚙️  모델: ${model} | 시점: ${cfg.pov} | 문체: ${cfg.style}`);
  process.stdout.write("✍️  생성 중...");

  const t0  = Date.now();
  const res = await (llm.chat.completions.create as any)({
    model,
    messages: [
      { role: "system", content: (storyCtx as any).worldBible ? buildStandalonePrompt(ctx) : "한국어로 소설을 써라" },
      { role: "user",   content: `${episodeNumber}화를 ${cfg.pov} 시점으로 생성해줘.` },
    ],
    temperature: 0.85,
    max_tokens: maxTok,
  });
  const generated: string = res.choices?.[0]?.message?.content ?? "";
  console.log(` 완료 (${generated.length}자, ${Date.now() - t0}ms)\n`);
  console.log("─".repeat(60));
  console.log(generated.slice(0, 500) + (generated.length > 500 ? "\n... (이하 생략)" : ""));
  console.log("─".repeat(60));

  await runValidation(generated, ctx, bookId, episodeNumber);
}

async function runWithTestCase(difficulty: Difficulty | "all") {
  const [tc] = generateTestCases(1, difficulty);
  console.log(`\n🎲 랜덤 케이스: ${tc.description}`);

  const { buildGenPrompt } = await buildGenPromptFromCase(tc);
  const llm   = getLLMClient();
  const model = getStoryModel();
  const cfg   = tc.gen_config;
  const maxTok = Math.ceil((cfg.episodeLength + cfg.episodeLengthVar) * 0.65 * 1.4) + 300;

  process.stdout.write("✍️  생성 중...");
  const t0  = Date.now();
  const res = await (llm.chat.completions.create as any)({
    model,
    messages: [
      { role: "system", content: buildGenPrompt.system },
      { role: "user",   content: buildGenPrompt.user },
    ],
    temperature: 0.85,
    max_tokens: maxTok,
  });
  const generated: string = res.choices?.[0]?.message?.content ?? "";
  console.log(` 완료 (${generated.length}자, ${Date.now() - t0}ms)\n`);
  console.log("─".repeat(60));
  console.log(generated.slice(0, 500) + (generated.length > 500 ? "\n... (이하 생략)" : ""));
  console.log("─".repeat(60));

  const ctx = buildTestCtx(tc);
  await runValidation(generated, ctx, "test", 3);
}

async function runValidation(
  generated: string,
  ctx: EffectiveContext,
  bookId: string,
  episodeNumber: number
) {
  process.stdout.write(`\n🔍 검증 중 (프롬프트 ${promptVer})...`);
  const validation = await validate(generated, ctx, { bookId, episodeNumber, promptVersion: promptVer });
  console.log(` 완료\n`);

  console.log(`판정: ${verdictEmoji(validation.verdict)} ${validation.verdict}  (${validation.total_score}점)`);
  console.log(`요약: ${validation.summary}`);

  if (validation.hard_violations.length) {
    console.log("\n❗ 하드 위반:");
    for (const v of validation.hard_violations) {
      console.log(`  [${v.severity.toUpperCase()}] ${v.rule}: ${v.description}`);
    }
  }
  if (validation.soft_warnings.length) {
    console.log("\n⚠️  소프트 경고:");
    for (const w of validation.soft_warnings.filter(x => x.severity === "medium")) {
      console.log(`  ${w.rule}: ${w.description}`);
    }
  }
  console.log("\n품질 점수:");
  const qs = validation.quality_scores;
  for (const [k, v] of Object.entries(qs)) {
    const bar = "█".repeat(Math.round(v / 10)) + "░".repeat(10 - Math.round(v / 10));
    console.log(`  ${k.padEnd(24)} ${bar} ${v}`);
  }

  if (doRevise && (validation.verdict === "FAIL" || validation.verdict === "WARN")) {
    console.log("\n🔧 리비전 시작...");
    const result = await reviseUntilPass(generated, validation, ctx, { bookId, episodeNumber, promptVersion: promptVer });
    console.log(`리비전 완료: ${result.iterations}회 | 최종 판정: ${verdictEmoji(result.final_verdict)} ${result.final_verdict} (${result.final_score}점)`);
    if (result.absolute_blocked) console.log("⛔ 절대금지 위반으로 차단됨");
  }

  if (validation.revision_hints?.length) {
    console.log("\n💡 리비전 힌트:");
    for (const h of validation.revision_hints) console.log(`  - ${h}`);
  }
}

function verdictEmoji(v: string): string {
  return v === "PASS_STRONG" ? "🌟" : v === "PASS" ? "✅" : v === "WARN" ? "⚠️" : "❌";
}

function buildStandalonePrompt(ctx: EffectiveContext): string {
  const cfg = ctx.gen_config;
  const charList = ctx.characters.map(c => `${c.name}(${c.gender}): ${c.personality}`).join("\n");
  return `당신은 한국 소설 생성 AI다.
시점: ${cfg.pov} | 문체: ${cfg.style}
대사 따옴표: " "(곡선)만 사용
본문: ${cfg.episodeLength}~${cfg.episodeLength + cfg.episodeLengthVar}자

[인물]
${charList}
[규칙] ${ctx.general_rules.join(" | ") || "없음"}
[절대금지] ${ctx.absolute_forbidden.join(" | ") || "없음"}
${ctx.active_interventions.length ? `[작가 개입] ${ctx.active_interventions.map(i => i.instruction).join(" | ")}` : ""}
${ctx.rolling_summary ? `[직전 줄거리] ${ctx.rolling_summary}` : ""}

본문 완성 후 [CLIFF] 단독 줄, 클리프행어 2~4문장, [END]`;
}

async function buildGenPromptFromCase(tc: any) {
  const { generateTestCases: _ } = await import("./case_generator.js");
  const cfg    = tc.gen_config;
  const ep     = 3;
  const chars  = tc.characters.map((c: any) => `${c.name}(${c.gender}): ${c.personality}`).join("\n");
  const rules  = tc.world_rules.filter((r: any) => r.rule_type === "general").map((r: any) => r.content).join("\n") || "없음";
  const abs    = tc.world_rules.filter((r: any) => r.rule_type === "absolute_forbidden").map((r: any) => r.content).join("\n") || "없음";
  const inter  = tc.active_interventions.map((i: any) => i.instruction).join("\n") || "없음";

  const system = `당신은 한국 소설 생성 AI다.
시점: ${cfg.pov} | 문체: ${cfg.style} | 장르: ${cfg.genre ?? "미정"}
대사: " "(곡선 따옴표) | 본문: ${cfg.episodeLength}~${cfg.episodeLength+cfg.episodeLengthVar}자

[인물] ${chars}
[규칙] ${rules}
[절대금지] ${abs}
[작가 개입] ${inter}
[이번 화 목표] ${tc.task.goal}
${tc.task.ending_hook_direction ? `[엔딩 훅] ${tc.task.ending_hook_direction}` : ""}

본문 완성 후 [CLIFF] 단독 줄, 클리프행어 2~4문장, [END]`;

  return { buildGenPrompt: { system, user: `${ep}화를 ${cfg.pov} 시점으로 생성해줘.` } };
}

function buildTestCtx(tc: any): EffectiveContext {
  return {
    episode_number: 3,
    gen_config: tc.gen_config,
    world_config: tc.world_config,
    general_rules: tc.world_rules.filter((r: any) => r.rule_type === "general").map((r: any) => r.content),
    absolute_forbidden: tc.world_rules.filter((r: any) => r.rule_type === "absolute_forbidden").map((r: any) => r.content),
    active_interventions: tc.active_interventions,
    characters: tc.characters,
    character_dynamic_states: tc.character_dynamic_states,
    character_inferred_states: [],
    prev_episode_state: tc.prev_episode_state,
    task: tc.task,
    foreshadow_memory: [],
    arc_summaries: [],
    character_arcs: {},
    rolling_summary: tc.prev_episode_state.ending_event || "",
    reader_profile: { focus:55, sentiment:55, urgency:50, complexity:55, dialogue:55, audio_sync:40 },
  };
}

// ── 진입점 ───────────────────────────────────────────────────
try { await runMigrateV2(); } catch {}

if (isRandom) {
  const diff = (args[1] ?? "all") as Difficulty | "all";
  await runWithTestCase(diff);
} else {
  const bookId  = args[0];
  const episode = parseInt(args[1] ?? "1", 10);
  if (!bookId) {
    console.log("사용법: npx tsx scripts/gen_validate.ts <book_id> <episode> [--revise] [--version A|B]");
    console.log("        npx tsx scripts/gen_validate.ts --random [easy|medium|hard]");
    process.exit(1);
  }
  await runWithBookId(bookId, episode);
}

await pool.end();
