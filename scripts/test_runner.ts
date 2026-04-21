/**
 * test_runner.ts — 강건성 튜닝 루프 실행기
 *
 * 실행: npx tsx scripts/test_runner.ts [command] [options]
 *
 * commands:
 *   dev     [count]           dev set 테스트 (기본 20케이스)
 *   holdout [count]           holdout 테스트 (기본 20케이스, 프롬프트 B 사용)
 *   smoke   [count]           랜덤 smoke test (기본 20케이스, 연속 PASS 확인)
 *   full    [dev] [holdout]   dev + holdout 전체 실행
 *
 * 종료 조건:
 * - hard fail 0%
 * - dev set PASS 이상 90% 이상
 * - holdout set PASS 이상 90% 이상
 * - smoke test 20회 연속 PASS
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── 동적 임포트 (서버 의존성 분리) ────────────────────────────
const { generateTestCases } = await import("./case_generator.js");
const { pool } = await import("../src/lib/db.js");
const { runMigrateV2 } = await import("../src/db/migrate_v2.js");
const { validate } = await import("../src/services/validator.js");
const { reviseUntilPass } = await import("../src/services/revision.js");
const { getLLMClient, getStoryModel } = await import("../src/lib/llm.js");

import type {
  TestCase, TestResult, RunReport, Difficulty, Verdict,
  EffectiveContext, GenConfig, PrevEpisodeState, EpisodeTask,
} from "../src/types/canonical.js";

// ══════════════════════════════════════════════════════════════
// 생성기: TestCase → EffectiveContext 변환
// ══════════════════════════════════════════════════════════════
function testCaseToEffectiveContext(tc: TestCase, episodeNumber: number = 3): EffectiveContext {
  const generalRules  = tc.world_rules.filter(r => r.rule_type === "general").map(r => r.content);
  const absoluteForbid = tc.world_rules.filter(r => r.rule_type === "absolute_forbidden").map(r => r.content);

  return {
    episode_number: episodeNumber,
    gen_config: tc.gen_config,
    world_config: tc.world_config,
    general_rules: generalRules,
    absolute_forbidden: absoluteForbid,
    active_interventions: tc.active_interventions,
    characters: tc.characters,
    character_dynamic_states: tc.character_dynamic_states,
    character_inferred_states: [],
    prev_episode_state: tc.prev_episode_state,
    task: tc.task,
    foreshadow_memory: tc.prev_episode_state.open_foreshadows.map((f, i) => ({
      id: `test-${i}`, planted_episode: episodeNumber - 2, content: f, keywords: [],
    })),
    arc_summaries: [],
    character_arcs: {},
    rolling_summary: tc.prev_episode_state.ending_event
      ? `${episodeNumber - 1}화: ${tc.prev_episode_state.ending_event}` : "",
    prev_episode_tail: undefined,
    reader_profile: { focus: 55, sentiment: 55, urgency: 50, complexity: 55, dialogue: 55, audio_sync: 40 },
  };
}

// ══════════════════════════════════════════════════════════════
// 프롬프트 조립 (기존 story.ts buildSystemPrompt와 유사, standalone)
// ══════════════════════════════════════════════════════════════
function buildGenPrompt(ctx: EffectiveContext): { system: string; user: string } {
  const cfg = ctx.gen_config;
  const ep  = ctx.episode_number;

  const charList = ctx.characters.map(c =>
    `${c.name}(${c.gender}, ${c.type}): ${c.personality}`
  ).join("\n");

  const dynStates = ctx.character_dynamic_states.map(s => {
    const parts = [`${s.character_name}:`];
    if (s.location)        parts.push(`위치=${s.location}`);
    if (s.physical_state)  parts.push(`신체상태=${s.physical_state}`);
    if (s.items?.length)   parts.push(`소지품=${s.items.join(",")}`);
    if (s.recent_goal)     parts.push(`목표=${s.recent_goal}`);
    return parts.join(" ");
  }).join("\n");

  // 연속성 강제 규칙 조립
  const prevState = ctx.prev_episode_state;
  const continuityBlock = [
    prevState.ending_event ? `직전 화 마지막 사건: ${prevState.ending_event}` : "",
    prevState.current_time ? `현재 시각: ${prevState.current_time}` : "",
    prevState.environment_changes.length ? `환경 변화: ${prevState.environment_changes.join(", ")}` : "",
    prevState.continuity_notes.length   ? `연속성 주의: ${prevState.continuity_notes.join(" / ")}` : "",
    Object.keys(prevState.remaining_resources).length
      ? `잔여 자원: ${Object.entries(prevState.remaining_resources).map(([k,v])=>`${k}=${v}`).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const povRule = cfg.pov.includes("1인칭 주인공") ? "1인칭('나', '나는') 시점으로 서술"
    : cfg.pov.includes("1인칭 관찰자") ? "1인칭 관찰자('나는 보았다', '나는 들었다') 시점"
    : cfg.pov.includes("전지적") ? "전지적 작가 시점 — 인물 내면 묘사 허용"
    : cfg.pov === "교차 시점" ? "교차 시점 — 각 장면 전환 시 시점 인물을 명시"
    : `${cfg.pov} 시점 — 1인칭 표현 서술부 사용 금지 (대사 안은 허용)`;

  const styleRule = cfg.style === "간결/담백" ? "짧고 명확한 문장, 불필요한 수식 배제"
    : cfg.style === "서정/감성" ? "감성적 묘사와 내면 정서를 풍부하게"
    : cfg.style === "묘사풍부" ? "장면과 감각을 세밀하게 묘사"
    : "균형 잡힌 묘사와 전개";

  const sliders = [
    cfg.conflict   >= 8 ? "갈등을 격렬하게" : cfg.conflict   <= 3 ? "잔잔하게" : "",
    cfg.foreshadow >= 8 ? "복선을 촘촘히" : cfg.foreshadow <= 3 ? "복선 최소화" : "",
    cfg.emotion    >= 8 ? "감정 묘사 깊게" : cfg.emotion    <= 3 ? "감정 간결히" : "",
    cfg.dialogue   >= 8 ? "대사 비중 높게" : cfg.dialogue   <= 3 ? "서술 위주로" : "",
    cfg.direction  >= 8 ? "연출 강하게" : cfg.direction  <= 3 ? "담백하게" : "",
  ].filter(Boolean).join(". ");

  const genRules  = ctx.general_rules.join("\n") || "없음";
  const absForbid = ctx.absolute_forbidden.join("\n") || "없음";
  const interventions = ctx.active_interventions.map(i => `- ${i.instruction}`).join("\n") || "없음";
  const prevSummary = ctx.rolling_summary || "없음";
  const foreshadows = ctx.foreshadow_memory.map(f => `- [${f.planted_episode}화] ${f.content}`).join("\n") || "없음";

  const charNames = ctx.characters.map(c => c.name).join(", ");

  const system = `당신은 한국 소설 생성 AI다.

[최우선 규칙]
${povRule}
출력은 100% 한국어만 허용한다.
대화 따옴표는 반드시 " "(곡선 큰따옴표)를 사용한다. 모든 대사는 반드시 "로 열고 "로 닫는다. 여는 따옴표와 닫는 따옴표가 쌍을 이뤄야 하며, 열린 따옴표를 닫지 않으면 심각한 오류다.
본문은 ${cfg.episodeLength}~${cfg.episodeLength + cfg.episodeLengthVar}자 범위 안에서 완성한다.

[시점] ${povRule}
[문체] ${styleRule}
[연출] ${sliders || "기본"}

[등장인물 — 아래 이름만 사용, 절대 변형·합성·오기 금지]
${charList}
허용 이름 목록: ${charNames}
위 목록에 없는 이름을 만들거나 두 이름을 합치는 것은 심각한 오류다.

[이번 화 시작 위치 — 각 인물은 반드시 아래 위치에서 이번 화를 시작한다]
${ctx.character_dynamic_states.map(s => `${s.character_name}: ${s.location ?? "미정"}`).join("\n") || "없음"}
첫 장면에서 인물이 이 위치 외의 장소에 있으면 심각한 오류다.

[인물 현재 상태 — 이 상태에서 이어서 전개, 설명 없이 초기화 금지]
${dynStates || "없음"}

[부상 제약 — 아래 제약을 어기는 행동 묘사 금지]
${ctx.character_dynamic_states.filter(s => s.physical_state && (s.physical_state.includes("부상") || s.physical_state.includes("중상") || s.physical_state.includes("경상"))).map(s => `${s.character_name}: ${s.physical_state} → 해당 부위 정상 사용 불가. 다른 부위로 대체하거나 행동을 제한해야 함`).join("\n") || "없음"}

[직전 화 연속성 — 반드시 이어받아야 할 사항]
${continuityBlock || "없음"}

[세계관 규칙]
${genRules}

[절대금지 규칙 — 어떤 경우에도 위반 불가]
${absForbid}

[작가 개입 — 이번 화에 즉시 반영]
${interventions}

[직전 줄거리]
${prevSummary}

[미회수 복선]
${foreshadows}

[이번 화 목표] ${ctx.task.goal}
${ctx.task.required_events?.length ? `[필수 사건] ${ctx.task.required_events.join(", ")}` : ""}
${ctx.task.ending_hook_direction ? `[엔딩 훅 방향] ${ctx.task.ending_hook_direction}` : ""}
${ctx.task.special_constraints?.length ? `[특수 제약] ${ctx.task.special_constraints.join(" | ")}` : ""}

[연속성 규칙 — 반드시 준수]
- [상태 보존] 인물의 부상·소지품·자원·위치는 설명 없이 초기화하지 않는다. 부상 부위를 사용해야 할 때는 반드시 고통·제한·대체 동작을 묘사한다
- [장소 이동] 장면이 다른 장소로 바뀔 때 반드시 이동 과정이나 시간 경과를 한 문장 이상 서술한다. 이전 화에서 다른 위치에 있던 인물이 이번 화 시작 시 이미 새 위치에 있다면 반드시 어떻게 이동했는지 서술해야 한다
- [위치 연속성] 직전 화 마지막 인물 위치에서 이번 화가 시작된다. 위치가 바뀌었다면 반드시 이동 경위를 설명한다
- [이름 일관성] 인물 이름은 위 허용 목록 그대로만 사용한다. 첫 등장 시 서사 안에서 소개 절차를 거친다
- [젠더 대명사] 인물 설정의 성별에 맞는 대명사를 사용한다: 여성→"그녀/그녀의", 남성→"그/그의", 해당없음·기타→중립적 표현. 설정된 성별과 반대되는 대명사 사용 금지

[출력 규칙]
- 화 제목은 반드시 "# ${ep}화 - 제목" 형식으로 첫 줄에
- 반드시 완결된 문장으로 끝낼 것
- 본문만 출력. 설명·주석·JSON 절대 금지
- 비최종화: 본문 완성 후 [CLIFF] 단독 줄, 이후 클리프행어 2~4문장, 마지막 [END]
- 최종화: 완전한 결말, [END]로 끝`;

  const user = `${ep}화를 ${cfg.pov} 시점으로 생성해줘.`;

  return { system, user };
}

// ══════════════════════════════════════════════════════════════
// 단일 케이스 실행
// ══════════════════════════════════════════════════════════════
async function runSingleCase(
  tc: TestCase,
  opts: { promptVersion: "A" | "B"; doRevise: boolean; }
): Promise<TestResult> {
  const t0  = Date.now();
  const ctx = testCaseToEffectiveContext(tc, tc.episode_number);
  const { system, user } = buildGenPrompt(ctx);

  const llm    = getLLMClient();
  const model  = getStoryModel();
  const cfg    = tc.gen_config;
  const maxTok = Math.ceil((cfg.episodeLength + cfg.episodeLengthVar) * 0.65 * 1.4) + 300;

  // 생성
  let generatedText = "";
  try {
    const res = await (llm.chat.completions.create as any)({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user },
      ],
      temperature: 0.85,
      max_tokens: maxTok,
    });
    generatedText = res.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    console.error(`  ❌ 생성 오류 (${tc.id.slice(0, 8)}):`, err);
    return {
      case_id: tc.id, difficulty: tc.difficulty, iteration: 0,
      generated_chars: 0,
      validation: {
        verdict: "FAIL", hard_violations: [{ rule: "생성 오류", description: String(err), severity: "critical" }],
        soft_warnings: [], quality_scores: { pov_consistency:0, scene_clarity:0, character_consistency:0,
          plot_momentum:0, world_rule_usage:0, exposition_control:0, prose_density:0,
          ending_hook:0, style_adherence:0, intervention_adherence:0 },
        total_score: 0, summary: "생성 오류",
      },
      revision_count: 0, final_verdict: "FAIL",
      elapsed_ms: Date.now() - t0,
    };
  }

  // 검증
  const validation = await validate(generatedText, ctx, { promptVersion: opts.promptVersion });

  // 리비전
  let finalVerdict: Verdict = validation.verdict;
  let finalScore            = validation.total_score;
  let revisionCount         = 0;

  if (opts.doRevise && (validation.verdict === "FAIL" || validation.verdict === "WARN")) {
    const revised = await reviseUntilPass(generatedText, validation, ctx, {
      promptVersion: opts.promptVersion,
    });
    finalVerdict  = revised.final_verdict;
    finalScore    = revised.final_score;
    revisionCount = revised.iterations;
  }

  return {
    case_id: tc.id, difficulty: tc.difficulty, iteration: revisionCount + 1,
    generated_chars: generatedText.length,
    validation,
    revision_count: revisionCount,
    final_verdict: finalVerdict,
    elapsed_ms: Date.now() - t0,
  };
}

// ══════════════════════════════════════════════════════════════
// 리포트 생성
// ══════════════════════════════════════════════════════════════
function generateReport(
  results: TestResult[],
  setType: "dev" | "holdout" | "smoke"
): RunReport {
  const total    = results.length;
  const passed   = results.filter(r => r.final_verdict === "PASS" || r.final_verdict === "PASS_STRONG").length;
  const failed   = results.filter(r => r.final_verdict === "FAIL").length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const failRate = total > 0 ? Math.round((failed / total) * 100) : 0;
  const avgScore = total > 0 ? Math.round(results.reduce((s, r) => s + r.validation.total_score, 0) / total) : 0;

  // 난이도별
  const byDifficulty: Record<Difficulty, { pass: number; total: number }> = {
    easy: { pass: 0, total: 0 }, medium: { pass: 0, total: 0 }, hard: { pass: 0, total: 0 },
  };
  for (const r of results) {
    byDifficulty[r.difficulty].total++;
    if (r.final_verdict === "PASS" || r.final_verdict === "PASS_STRONG") byDifficulty[r.difficulty].pass++;
  }

  // 위반/경고 빈도
  const hardViolationFreq: Record<string, number> = {};
  const softWarningFreq:   Record<string, number> = {};
  for (const r of results) {
    for (const v of r.validation.hard_violations) hardViolationFreq[v.rule] = (hardViolationFreq[v.rule] ?? 0) + 1;
    for (const w of r.validation.soft_warnings)   softWarningFreq[w.rule]   = (softWarningFreq[w.rule]   ?? 0) + 1;
  }

  // smoke 연속 PASS 체크
  let consecutivePass = 0;
  for (const r of [...results].reverse()) {
    if (r.final_verdict === "PASS" || r.final_verdict === "PASS_STRONG") consecutivePass++;
    else break;
  }

  const terminationMet = failRate === 0 && passRate >= 90
    && (setType !== "smoke" || consecutivePass >= 20);

  return {
    run_id: randomUUID(),
    timestamp: new Date().toISOString(),
    set_type: setType,
    total_cases: total,
    results,
    pass_rate: passRate,
    fail_rate: failRate,
    avg_score: avgScore,
    by_difficulty: byDifficulty,
    by_pov: {}, // TODO: TestResult에 pov 필드 추가 후 집계
    by_style: {},
    hard_violation_freq: hardViolationFreq,
    soft_warning_freq: softWarningFreq,
    termination_condition_met: terminationMet,
  };
}

function printReport(report: RunReport): void {
  console.log("\n" + "═".repeat(60));
  console.log(`📊 ${report.set_type.toUpperCase()} 결과 — ${report.timestamp}`);
  console.log("═".repeat(60));
  console.log(`케이스: ${report.total_cases} | PASS율: ${report.pass_rate}% | FAIL율: ${report.fail_rate}% | 평균점수: ${report.avg_score}`);
  console.log("\n난이도별:");
  for (const [d, s] of Object.entries(report.by_difficulty)) {
    if (s.total > 0) console.log(`  ${d}: ${s.pass}/${s.total} (${Math.round(s.pass/s.total*100)}%)`);
  }
  if (Object.keys(report.hard_violation_freq).length) {
    console.log("\n하드 위반 빈도:");
    for (const [rule, cnt] of Object.entries(report.hard_violation_freq).sort(([,a],[,b]) => b - a).slice(0, 5)) {
      console.log(`  ${rule}: ${cnt}회`);
    }
  }
  if (Object.keys(report.soft_warning_freq).length) {
    console.log("\n소프트 경고 빈도 (상위 5):");
    for (const [rule, cnt] of Object.entries(report.soft_warning_freq).sort(([,a],[,b]) => b - a).slice(0, 5)) {
      console.log(`  ${rule}: ${cnt}회`);
    }
  }
  console.log(`\n종료 조건 달성: ${report.termination_condition_met ? "✅ YES" : "❌ NO"}`);
  console.log("═".repeat(60) + "\n");
}

function saveReport(report: RunReport, tag: string): string {
  const dir = join(ROOT, "logs", "test_results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = join(dir, `${tag}_${Date.now()}.json`);
  const latest   = join(dir, `${tag}_latest.json`);
  writeFileSync(filename, JSON.stringify(report, null, 2));
  writeFileSync(latest,   JSON.stringify(report, null, 2));
  console.log(`💾 결과 저장: ${filename}`);
  return filename;
}

// ══════════════════════════════════════════════════════════════
// 실행 모드별 함수
// ══════════════════════════════════════════════════════════════
async function runDevSet(count: number): Promise<RunReport> {
  console.log(`\n🔧 DEV SET 실행 (${count}케이스, 프롬프트 A, 리비전 O)`);
  const cases  = generateTestCases(count);
  const results: TestResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    process.stdout.write(`  [${i+1}/${cases.length}] ${tc.description.slice(0, 50)}... `);
    const result = await runSingleCase(tc, { promptVersion: "A", doRevise: true });
    results.push(result);
    console.log(`${result.final_verdict} (${result.validation.total_score}점, ${result.elapsed_ms}ms)`);
  }

  const report = generateReport(results, "dev");
  printReport(report);
  saveReport(report, "dev");
  return report;
}

async function runHoldoutSet(count: number): Promise<RunReport> {
  console.log(`\n🔒 HOLDOUT SET 실행 (${count}케이스, 프롬프트 B, 리비전 X)`);
  const cases  = generateTestCases(count);
  const results: TestResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    process.stdout.write(`  [${i+1}/${cases.length}] ${tc.description.slice(0, 50)}... `);
    const result = await runSingleCase(tc, { promptVersion: "B", doRevise: false });
    results.push(result);
    console.log(`${result.final_verdict} (${result.validation.total_score}점)`);
  }

  const report = generateReport(results, "holdout");
  printReport(report);
  saveReport(report, "holdout");
  return report;
}

async function runSmokeTest(count: number): Promise<RunReport> {
  console.log(`\n💨 SMOKE TEST 실행 (${count}케이스 — 연속 PASS 확인)`);
  const cases  = generateTestCases(count);
  const results: TestResult[] = [];
  let consecutivePass = 0;

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    process.stdout.write(`  [${i+1}/${cases.length}] ... `);
    const result = await runSingleCase(tc, { promptVersion: "A", doRevise: true });
    results.push(result);
    const isPass = result.final_verdict === "PASS" || result.final_verdict === "PASS_STRONG";
    if (isPass) consecutivePass++; else consecutivePass = 0;
    console.log(`${result.final_verdict} | 연속PASS: ${consecutivePass}`);
  }

  const report = generateReport(results, "smoke");
  printReport(report);
  saveReport(report, "smoke");
  return report;
}

// ══════════════════════════════════════════════════════════════
// CLI 진입점
// ══════════════════════════════════════════════════════════════
async function main() {
  // V2 마이그레이션 보장
  try { await runMigrateV2(); } catch {}

  const [,, command = "smoke", arg1 = "20", arg2 = "20"] = process.argv;

  switch (command) {
    case "dev":
      await runDevSet(parseInt(arg1));
      break;
    case "holdout":
      await runHoldoutSet(parseInt(arg1));
      break;
    case "smoke":
      await runSmokeTest(parseInt(arg1));
      break;
    case "full": {
      const dev = await runDevSet(parseInt(arg1));
      const holdout = await runHoldoutSet(parseInt(arg2));
      console.log("\n🏁 FULL RUN 종료 조건 점검:");
      console.log(`  DEV PASS율: ${dev.pass_rate}% ${dev.pass_rate >= 90 ? "✅" : "❌"}`);
      console.log(`  HOLDOUT PASS율: ${holdout.pass_rate}% ${holdout.pass_rate >= 90 ? "✅" : "❌"}`);
      console.log(`  DEV FAIL율: ${dev.fail_rate}% ${dev.fail_rate === 0 ? "✅" : "❌"}`);
      console.log(`  HOLDOUT FAIL율: ${holdout.fail_rate}% ${holdout.fail_rate === 0 ? "✅" : "❌"}`);
      if (dev.pass_rate >= 90 && holdout.pass_rate >= 90 && dev.fail_rate === 0 && holdout.fail_rate === 0) {
        console.log("\n✅ 종료 조건 달성! smoke test로 최종 확인하세요:");
        console.log("  npx tsx scripts/test_runner.ts smoke 20");
      } else {
        console.log("\n❌ 아직 종료 조건 미달. 주요 실패 축을 개선 후 재실행하세요.");
      }
      break;
    }
    default:
      console.log("사용법: npx tsx scripts/test_runner.ts [dev|holdout|smoke|full] [count]");
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
