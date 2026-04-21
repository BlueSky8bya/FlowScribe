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
import { resolveCharacterPolicy } from "../src/lib/character_policy_resolver.js";
import { ACTIVE_POV_POLICY, isUnsupportedPov } from "../src/types/pov_policy.js";
import { variantCPovRule as _sharedVariantCPovRule } from "../src/lib/pov_rules.js";

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
// POV 규칙 블록 — src/lib/pov_rules.ts 공유 모듈로 위임
// benchmark와 service가 동일 함수를 사용해 정책 의미 불일치를 방지한다.
// ══════════════════════════════════════════════════════════════
function variantCPovRule(pov: GenConfig["pov"]): string {
  return _sharedVariantCPovRule(pov);
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

  // POV 규칙 — Variant C (rules-only) 채택 (2026-04-22 진단 결과)
  // 1인칭 관찰자: 미지원 POV, 규칙은 포함하나 benchmark에서 별도 분리됨
  const povRule = variantCPovRule(cfg.pov);

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

  // 인물 등장 정책 리졸브 (GenConfig.character_policy 우선, 없으면 장르 기반 기본값)
  const charPolicy = resolveCharacterPolicy(
    cfg.character_policy,
    ctx.world_config
  );

  // 이름 혼동 vs 신규 인물 도입 분리 규칙 블록
  const aliasNote = charPolicy.alias_policy === "strict"
    ? "별칭·성씨 단독 지칭 금지. 반드시 등록된 이름 그대로만 사용."
    : "성씨 단독('박', '김'), 호칭 접미('씨', '님', '선배', '팀장'), 역할 지칭은 허용.";

  const newCharNote = charPolicy.new_character_policy === "closed_cast"
    ? "신규 인물(이름 있음/없음 모두) 등장 금지. 위 목록 인물만 등장."
    : charPolicy.new_character_policy === "extras_only"
    ? "이름 없는 배경 단역(행인, 점원, 경비 등)만 허용. 이름 있는 신규 인물 금지."
    : charPolicy.new_character_policy === "named_with_gate"
    ? `이름 있는 신규 인물: 꼭 필요할 때만 도입 가능. 첫 등장 시 역할·장면 기능·기존 인물과의 관계를 한 문장 이상 명시. 기존 핵심 인물을 가리거나 대체하는 방식 금지.
이름 없는 배경 단역(행인, 점원 등): ${charPolicy.background_extras_allowed ? "허용" : "금지"}.`
    : `이름 있는 신규 인물: 생성기 재량으로 추가 가능. 기존 핵심 인물 설정과 충돌 금지.
이름 없는 배경 단역: ${charPolicy.background_extras_allowed ? "허용" : "금지"}.`;

  // 인물 이름별 젠더 대명사 매핑 (이름 혼동 및 대명사 불일치 방지)
  const genderPronounList = ctx.characters.map(c => {
    const pronoun = c.gender === "여성" ? "그녀/그녀의" : c.gender === "남성" ? "그/그의" : "중립 표현";
    return `${c.name}(${c.gender}) → ${pronoun}`;
  }).join(", ");

  // 부상 제약 — 금지 동작 구체 명시
  const injuredChars = ctx.character_dynamic_states.filter(s =>
    s.physical_state && (s.physical_state.includes("부상") || s.physical_state.includes("중상") || s.physical_state.includes("경상"))
  );
  const injuryBlock = injuredChars.length > 0
    ? injuredChars.map(s => {
        const p = s.physical_state ?? "";
        const forbidden = p.includes("팔") || p.includes("손") || p.includes("어깨") || p.includes("손목")
          ? "집기·쥐기·들기·던지기·밀기 (해당 팔) 금지 — 반대 팔 또는 고통/제한 묘사 필수"
          : p.includes("다리") || p.includes("발") || p.includes("무릎") || p.includes("발목")
          ? "달리기·도약·차기 금지 — 절뚝임 또는 지지대 사용 필수"
          : "해당 부위 정상 사용 금지 — 대체 동작 또는 고통 묘사 필수";
        return `${s.character_name}(${p}): ${forbidden}`;
      }).join("\n")
    : "없음";

  // 정상 상태 인물 목록 — 임의 부상 금지
  const normalChars = ctx.character_dynamic_states
    .filter(s => !s.physical_state || s.physical_state === "정상" || s.physical_state === "없음" || s.physical_state === "양호")
    .map(s => s.character_name);

  // 엔딩 훅 — 구체적 지시
  const endingHookInstruction = ctx.task.ending_hook_direction
    ? `[엔딩 훅 필수] 마지막 [CLIFF] 이후 2~4문장에서 아래 중 하나를 명확하게 남겨야 한다:
(1) 즉각적 위협이나 위기 상황 (인물이 피할 수 없는 상황)
(2) 예상치 못한 발견이나 반전 정보
(3) 행동의 결과로 생긴 새로운 심각한 문제
(4) 독자가 "다음 화에서 무슨 일이?" 하고 묻게 만드는 미해결 상황
방향: ${ctx.task.ending_hook_direction}`
    : "";

  const system = `당신은 한국 소설 생성 AI다.

[시점 — 최우선 규칙]
${povRule}

[등장인물 — 허용 이름 목록]
${charList}
허용 이름: ${charNames}
이름 표기 규칙:
- 위 이름을 정확히 유지한다. 오기·합성·변형은 심각한 오류다.
- 조사를 붙일 때 이름 자체를 변형하지 않는다 (민서과 → 민서와).
- 이름을 인물 간에 교차 혼용하지 않는다.
별칭/호칭: ${aliasNote}
신규 인물 도입: ${newCharNote}

[인물 젠더 대명사 — 설정 기준 사용]
${genderPronounList}

[이번 화 시작 상태 — 첫 단락에서 반드시 반영]
각 인물의 현재 위치와 신체 상태:
${dynStates || "없음"}
규칙:
- 이번 화는 위 위치와 상태에서 시작한다. 첫 단락 안에서 시작 위치를 자연스럽게 드러낸다.
- 신체 상태가 '정상'인 인물에게 임의로 부상이나 이상 상태를 추가하지 않는다.
- 위치가 바뀐 경우에는 반드시 이동 경위나 시간 경과를 한 문장 이상 서술한다.

[부상 제약]
${injuryBlock}

[직전 화 연속성]
${continuityBlock || "없음"}

[대화 따옴표]
모든 대사는 반드시 "로 열고 "로 닫는다. 열린 따옴표를 닫지 않으면 심각한 오류다.

[문체·연출]
문체: ${styleRule}
연출: ${sliders || "기본"}
분량: ${cfg.episodeLength}~${cfg.episodeLength + cfg.episodeLengthVar}자

[세계관 규칙]
${genRules}

[절대금지 — 어떤 경우에도 위반 불가]
${absForbid}

[작가 개입 — 즉시 반영]
${interventions}

[직전 줄거리]
${prevSummary}

[미회수 복선 — 이번 화에서 하나 이상 사건 변수로 활용]
${foreshadows}

[이번 화 목표] ${ctx.task.goal}
${ctx.task.required_events?.length ? `[필수 사건] ${ctx.task.required_events.join(", ")}` : ""}
${ctx.task.special_constraints?.length ? `[특수 제약] ${ctx.task.special_constraints.join(" | ")}` : ""}
${endingHookInstruction}

[출력 규칙]
- 화 제목: "# ${ep}화 - 제목" 형식으로 첫 줄에
- 본문만 출력. 설명·주석·JSON 절대 금지
- 반드시 완결된 문장으로 끝낼 것
- 비최종화: 본문 완성 후 [CLIFF] 단독 줄 → 클리프행어 2~4문장 → [END]
- 최종화: 완전한 결말, [END]로 끝
- 출력은 100% 한국어`;

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
  setType: "dev" | "holdout" | "smoke",
  /** case_id → pov 맵 — by_pov 집계에 사용 */
  caseIdToPov: Record<string, string> = {},
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

  // POV별 집계 — caseIdToPov 맵 기반
  const byPov: Record<string, { pass: number; total: number }> = {};
  for (const r of results) {
    const pov = caseIdToPov[r.case_id] ?? "unknown";
    if (!byPov[pov]) byPov[pov] = { pass: 0, total: 0 };
    byPov[pov].total++;
    if (r.final_verdict === "PASS" || r.final_verdict === "PASS_STRONG") byPov[pov].pass++;
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
    by_pov: byPov,
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
  if (Object.keys(report.by_pov).length) {
    console.log("\nPOV별:");
    for (const [pov, s] of Object.entries(report.by_pov)) {
      if (s.total > 0) console.log(`  ${pov}: ${s.pass}/${s.total} (${Math.round(s.pass/s.total*100)}%)`);
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

/**
 * supported_pov 케이스 필터 — 미지원 POV를 제외하고 케이스를 보충한다.
 * 필터 사실은 항상 콘솔에 명시한다 (성능 회피가 아닌 지원 범위 기준 benchmark).
 */
function filterToSupportedPov(cases: TestCase[]): TestCase[] {
  const policy = ACTIVE_POV_POLICY;
  const unsupportedPovs = new Set(policy.unsupported_povs.map(u => u.pov));
  const filtered = cases.filter(tc => !unsupportedPovs.has(tc.gen_config.pov));
  const excluded = cases.length - filtered.length;
  if (excluded > 0) {
    console.log(`\n[POV 정책] 현재 모델(${policy.model}) 지원 범위 기준 benchmark`);
    console.log(`  미지원 POV: ${[...unsupportedPovs].join(", ")} → ${excluded}개 케이스 제외`);
    console.log(`  사유: ${policy.unsupported_povs.map(u => `${u.pov} — ${u.reason.slice(0, 60)}...`).join("; ")}`);
    console.log(`  전체 POV benchmark는 [dev|holdout|smoke|full] 명령을 사용하세요.`);
  }
  return filtered;
}

async function runDevSet(count: number, supportedPovOnly = false): Promise<RunReport> {
  const label = supportedPovOnly ? "DEV SET (지원 POV 기준)" : "DEV SET";
  console.log(`\n🔧 ${label} 실행 (${count}케이스, 프롬프트 A, 리비전 O)`);
  let cases = generateTestCases(count);
  if (supportedPovOnly) cases = filterToSupportedPov(cases);
  const caseIdToPov = Object.fromEntries(cases.map(tc => [tc.id, tc.gen_config.pov]));
  const results: TestResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    process.stdout.write(`  [${i+1}/${cases.length}] ${tc.description.slice(0, 50)}... `);
    const result = await runSingleCase(tc, { promptVersion: "A", doRevise: true });
    results.push(result);
    console.log(`${result.final_verdict} (${result.validation.total_score}점, ${result.elapsed_ms}ms)`);
  }

  const tag = supportedPovOnly ? "dev_supported" : "dev";
  const report = generateReport(results, "dev", caseIdToPov);
  printReport(report);
  saveReport(report, tag);
  return report;
}

async function runHoldoutSet(count: number, supportedPovOnly = false): Promise<RunReport> {
  const label = supportedPovOnly ? "HOLDOUT SET (지원 POV 기준)" : "HOLDOUT SET";
  console.log(`\n🔒 ${label} 실행 (${count}케이스, 프롬프트 B, 리비전 X)`);
  let cases = generateTestCases(count);
  if (supportedPovOnly) cases = filterToSupportedPov(cases);
  const caseIdToPov = Object.fromEntries(cases.map(tc => [tc.id, tc.gen_config.pov]));
  const results: TestResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    process.stdout.write(`  [${i+1}/${cases.length}] ${tc.description.slice(0, 50)}... `);
    const result = await runSingleCase(tc, { promptVersion: "B", doRevise: false });
    results.push(result);
    console.log(`${result.final_verdict} (${result.validation.total_score}점)`);
  }

  const tag = supportedPovOnly ? "holdout_supported" : "holdout";
  const report = generateReport(results, "holdout", caseIdToPov);
  printReport(report);
  saveReport(report, tag);
  return report;
}

async function runSmokeTest(count: number): Promise<RunReport> {
  console.log(`\n💨 SMOKE TEST 실행 (${count}케이스 — 연속 PASS 확인)`);
  const cases  = generateTestCases(count);
  const caseIdToPov = Object.fromEntries(cases.map(tc => [tc.id, tc.gen_config.pov]));
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

  const report = generateReport(results, "smoke", caseIdToPov);
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
    // ── 지원 POV 기준 benchmark (현재 모델 지원 범위만 집계) ──────────
    // 1인칭 관찰자 등 미지원 POV를 제외하고 실행한다.
    // 이는 성능 회피가 아니라 "현재 모델이 지원하는 범위" 기준 benchmark다.
    // 전체 POV 포함 benchmark는 [dev|holdout|full]을 사용한다.
    case "dev_supported":
      await runDevSet(parseInt(arg1), true);
      break;
    case "holdout_supported":
      await runHoldoutSet(parseInt(arg1), true);
      break;
    case "full_supported": {
      const dev = await runDevSet(parseInt(arg1), true);
      const holdout = await runHoldoutSet(parseInt(arg2), true);
      console.log("\n🏁 FULL_SUPPORTED 종료 조건 점검 (지원 POV 기준):");
      console.log(`  DEV PASS율: ${dev.pass_rate}% ${dev.pass_rate >= 90 ? "✅" : "❌"}`);
      console.log(`  HOLDOUT PASS율: ${holdout.pass_rate}% ${holdout.pass_rate >= 90 ? "✅" : "❌"}`);
      if (dev.pass_rate >= 90 && holdout.pass_rate >= 90 && dev.fail_rate === 0 && holdout.fail_rate === 0) {
        console.log("\n✅ 지원 POV 기준 종료 조건 달성.");
      } else {
        console.log("\n❌ 아직 종료 조건 미달.");
      }
      break;
    }
    default:
      console.log("사용법: npx tsx scripts/test_runner.ts [dev|holdout|smoke|full|dev_supported|holdout_supported|full_supported] [count]");
      console.log("  *_supported: 현재 모델 지원 POV 기준 benchmark (미지원 POV 제외, 명시적 로그 출력)");
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
