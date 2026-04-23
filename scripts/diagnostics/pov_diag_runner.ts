/**
 * pov_diag_runner.ts — POV capability 진단용 variant 비교 실행기
 *
 * 실행: npx tsx scripts/pov_diag_runner.ts [variant]
 *   variant: A | B | C | D | all (기본 all)
 *
 * Variant 정의:
 *   A — 현재 buildGenPrompt 기준 (baseline)
 *   B — POV별 few-shot 예시 추가 (올바른 예 1 + 잘못된 예 1)
 *   C — POV별 금지/허용 규칙 강화 (few-shot 없이 명시적 규칙)
 *   D — 오프닝 scaffold (첫 문단 POV 고정 지시)
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const { pool }                = await import("../../src/lib/db.js");
const { runMigrateV2 }        = await import("../../src/db/migrate_v2.js");
const { validate }            = await import("../../src/services/validator.js");
const { getLLMClient, getStoryModel } = await import("../../src/lib/llm.js");
const { resolveCharacterPolicy } = await import("../../src/lib/character_policy_resolver.js");
const { POV_DIAG_CASES }      = await import("../fixtures/pov_diag_cases.js");

import type {
  TestCase, EffectiveContext, ValidationResult, GenConfig,
} from "../../src/types/canonical.js";

// ── EffectiveContext 조립 ────────────────────────────────────
function toCtx(tc: TestCase): EffectiveContext {
  const general   = tc.world_rules.filter(r => r.rule_type === "general").map(r => r.content);
  const absForbid = tc.world_rules.filter(r => r.rule_type === "absolute_forbidden").map(r => r.content);
  return {
    episode_number: tc.episode_number,
    gen_config: tc.gen_config,
    world_config: tc.world_config,
    general_rules: general,
    absolute_forbidden: absForbid,
    active_interventions: tc.active_interventions,
    characters: tc.characters,
    character_dynamic_states: tc.character_dynamic_states,
    character_inferred_states: [],
    prev_episode_state: tc.prev_episode_state,
    task: tc.task,
    foreshadow_memory: tc.prev_episode_state.open_foreshadows.map((f, i) => ({
      id: `diag-${i}`, planted_episode: tc.episode_number - 2, content: f, keywords: [],
    })),
    arc_summaries: [], character_arcs: {},
    rolling_summary: tc.prev_episode_state.ending_event
      ? `${tc.episode_number - 1}화: ${tc.prev_episode_state.ending_event}` : "",
    prev_episode_tail: undefined,
    reader_profile: { focus: 55, sentiment: 55, urgency: 50, complexity: 55, dialogue: 55, audio_sync: 40 },
  };
}

// ══════════════════════════════════════════════════════════════
// POV 규칙 블록 — 공통 베이스 (A/B/C/D 공유)
// ══════════════════════════════════════════════════════════════
function basePovRule(pov: GenConfig["pov"]): string {
  switch (pov) {
    case "1인칭 주인공":
      return "1인칭('나', '나는') 시점으로 서술한다. 서술부에서 '그가/그녀가'로 시작하는 3인칭 전환 금지.";
    case "1인칭 관찰자":
      return `1인칭 관찰자('나는 보았다', '나는 들었다') 시점으로 서술한다.
금지: 타인의 감정·생각을 서술부에서 직접 서술하는 것 ('그는 두려웠다', '그녀는 기쁨을 느꼈다').
허용: 외면 묘사만 ('그의 눈이 흔들렸다', '그녀의 손이 떨렸다').`;
    case "3인칭 관찰자":
      return `3인칭 관찰자 시점 — 한 명의 시점 인물 외부에서 관찰하듯 서술한다.
금지: 어떤 인물의 감정·생각·내면 목표를 서술부에서 직접 단언하는 것 ('그는 두려웠다', '그녀의 목표는 ~이었다', '믿지 않았다').
허용: 외면 관찰 ('그의 눈이 흔들렸다', '그녀가 멈칫했다'), 대사를 통한 내면 암시.`;
    case "전지적 작가":
      return "전지적 작가 시점 — 모든 인물의 내면·감정·생각을 직접 서술할 수 있다.";
    case "교차 시점":
      return "교차 시점 — 각 장면 전환 시 현재 시점 인물을 소제목 또는 서술로 명시한다. 해당 인물의 시점 안에서 타인 내면 직접 서술 금지.";
  }
}

// ══════════════════════════════════════════════════════════════
// Variant B — few-shot 예시 추가
// ══════════════════════════════════════════════════════════════
function fewShotPovRule(pov: GenConfig["pov"]): string {
  const base = basePovRule(pov);
  switch (pov) {
    case "1인칭 주인공":
      return `${base}

[시점 예시]
✓ 올바른 예: "나는 문을 열었다. 복도 끝에서 발소리가 들렸다."
✗ 틀린 예:  "그녀는 문을 열었다. 나는 뒤따라 들어갔다." — '그녀는'으로 시작하는 3인칭 혼입 금지.`;

    case "1인칭 관찰자":
      return `${base}

[시점 예시]
✓ 올바른 예: "그의 손이 떨리고 있었다. 그가 무언가를 숨기고 있음을 나는 느꼈다."
✗ 틀린 예:  "그는 두려웠다." — 화자 '나'가 타인의 내면을 직접 단언하는 것 금지.`;

    case "3인칭 관찰자":
      return `${base}

[시점 예시]
✓ 올바른 예: "루아의 입술이 굳게 닫혔다. 그녀의 손가락이 난간을 꽉 쥐었다."
✗ 틀린 예:  "루아는 두려웠다." / "루아의 목표는 탈출이었다." — 내면 직접 단언 금지.`;

    case "전지적 작가":
      return `${base}

[시점 예시]
✓ 올바른 예: "세아는 분노를 느꼈다. 루아는 그 분노의 이유를 알지 못했다."
  두 인물의 내면을 모두 서술 가능.`;

    case "교차 시점":
      return `${base}

[시점 예시]
✓ 올바른 예:
  ## 카이
  나는 산 정상에서 연기를 보았다. [장면 전환 명시]
  ## 리나
  리나는 서류를 펼쳤다. 숫자들이 그녀의 눈앞에서 흐릿해졌다.
✗ 틀린 예: 장면 전환 없이 시점 인물이 바뀌는 것.`;
  }
}

// ══════════════════════════════════════════════════════════════
// Variant C — 명시적 금지/허용 규칙 강화 (few-shot 없음)
// ══════════════════════════════════════════════════════════════
function rulesOnlyPovRule(pov: GenConfig["pov"]): string {
  switch (pov) {
    case "1인칭 주인공":
      return `시점: 1인칭 주인공
필수: 모든 서술부는 '나/나는/내가/나의'로 시작하거나 1인칭 관점을 유지한다.
절대금지: 서술부에서 '그가/그녀가/그는/그녀는'으로 시작하는 3인칭 주어 사용.
허용: 대사(" " 내부) 안에서 다른 인물이 '나'를 지칭하는 것은 정상.`;

    case "1인칭 관찰자":
      return `시점: 1인칭 관찰자
필수: 서술부에서 화자 '나'의 관찰·행동만 서술한다.
절대금지: 서술부에서 타인의 감정·생각·의도를 '~했다/~이었다' 형식으로 직접 단언하는 것.
예시 금지 표현: '그는 두려웠다', '그녀의 목표는 ~이었다', '그는 기뻤다'.
허용: '~처럼 보였다', '~인 듯했다', '~는 것 같았다' (추측 표현), 외면 관찰.`;

    case "3인칭 관찰자":
      return `시점: 3인칭 관찰자
필수: 특정 시점 인물의 외부 시선으로만 서술한다.
절대금지: 어느 인물의 감정·생각·내면 목표를 서술부에서 직접 단언하는 것.
  - 금지: '~는 두려웠다', '~의 목표는 ~이었다', '~은 ~라고 믿었다'
허용: 인물의 외면 행동과 표정 묘사, 대사 안에서 내면 암시.
서술부에서 내면을 표현하려면 반드시 추측 어미 사용 ('~듯했다', '~처럼 보였다').`;

    case "전지적 작가":
      return `시점: 전지적 작가
허용: 등장 모든 인물의 내면·감정·생각·과거·의도를 직접 서술 가능.
주의: 시점 자체는 위반이 없으나, 서술부에서 갑자기 1인칭('나는')으로 전환하지 않는다.`;

    case "교차 시점":
      return `시점: 교차 시점
필수: 각 장면 전환 시 현재 시점 인물을 반드시 소제목(## 이름) 또는 명시적 서술로 표시한다.
절대금지: 표시 없이 시점 인물이 바뀌는 것.
각 시점 인물의 장면 안에서: 해당 인물 시점에서 자연스러운 내면 서술만 허용. 타인 내면 직접 단언 금지.`;
  }
}

// ══════════════════════════════════════════════════════════════
// Variant D — 오프닝 scaffold (첫 문단 POV 고정 지시 추가)
// ══════════════════════════════════════════════════════════════
function scaffoldPovRule(pov: GenConfig["pov"]): string {
  const base = basePovRule(pov);
  switch (pov) {
    case "1인칭 주인공":
      return `${base}

[오프닝 scaffold] 첫 문장은 반드시 '나는/나의' 등 1인칭 주어로 시작한다. 예: "나는 문 앞에 섰다."`;

    case "1인칭 관찰자":
      return `${base}

[오프닝 scaffold] 첫 문장은 반드시 화자 '나'의 관찰로 시작한다. 예: "나는 그의 뒷모습을 바라보았다."`;

    case "3인칭 관찰자":
      return `${base}

[오프닝 scaffold] 첫 문장은 반드시 외면 묘사로 시작한다. 예: "${basePovRule(pov).includes("준혁") ? "준혁이" : "인물이"} 멈춰 섰다." — 내면 서술로 시작하지 않는다.`;

    case "전지적 작가":
      return `${base}

[오프닝 scaffold] 첫 문단에서 적어도 두 인물의 내면을 한 번씩 언급하여 전지적 시점임을 확립한다.`;

    case "교차 시점":
      return `${base}

[오프닝 scaffold] 첫 장면 시작 직전에 반드시 "## [인물 이름]" 형식의 소제목을 달아 시점 인물을 선언한다.`;
  }
}

// ══════════════════════════════════════════════════════════════
// 프롬프트 조립 — variant별 povRule만 교체
// ══════════════════════════════════════════════════════════════
function buildPrompt(
  ctx: EffectiveContext,
  variant: "A" | "B" | "C" | "D"
): { system: string; user: string } {
  const cfg = ctx.gen_config;
  const ep  = ctx.episode_number;

  const charList = ctx.characters.map(c =>
    `${c.name}(${c.gender}, ${c.type}): ${c.personality}`
  ).join("\n");

  const dynStates = ctx.character_dynamic_states.map(s => {
    const parts = [`${s.character_name}:`];
    if (s.location)       parts.push(`위치=${s.location}`);
    if (s.physical_state) parts.push(`신체상태=${s.physical_state}`);
    return parts.join(" ");
  }).join("\n");

  const prevState = ctx.prev_episode_state;
  const continuityBlock = [
    prevState.ending_event ? `직전 화 마지막 사건: ${prevState.ending_event}` : "",
    prevState.current_time ? `현재 시각: ${prevState.current_time}` : "",
  ].filter(Boolean).join("\n");

  const povRule =
    variant === "A" ? basePovRule(cfg.pov) :
    variant === "B" ? fewShotPovRule(cfg.pov) :
    variant === "C" ? rulesOnlyPovRule(cfg.pov) :
                      scaffoldPovRule(cfg.pov);

  const styleRule = cfg.style === "간결/담백" ? "짧고 명확한 문장, 불필요한 수식 배제"
    : cfg.style === "서정/감성" ? "감성적 묘사와 내면 정서를 풍부하게"
    : cfg.style === "묘사풍부" ? "장면과 감각을 세밀하게 묘사"
    : "균형 잡힌 묘사와 전개";

  const genRules  = ctx.general_rules.join("\n") || "없음";
  const absForbid = ctx.absolute_forbidden.join("\n") || "없음";
  const charNames = ctx.characters.map(c => c.name).join(", ");

  const charPolicy = resolveCharacterPolicy(cfg.character_policy, ctx.world_config);
  const aliasNote = charPolicy.alias_policy === "strict"
    ? "별칭·성씨 단독 지칭 금지."
    : "성씨 단독, 호칭 접미, 역할 지칭은 허용.";

  const endingHook = ctx.task.ending_hook_direction
    ? `[엔딩 훅 필수] 마지막 [CLIFF] 이후 2~4문장에서 다음 중 하나를 명확히 남긴다:
(1) 즉각적 위협/위기  (2) 예상치 못한 발견  (3) 새로운 심각한 문제  (4) 미해결 긴장
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
- 조사를 붙일 때 이름 자체를 변형하지 않는다.
별칭/호칭: ${aliasNote}

[이번 화 시작 상태]
${dynStates || "없음"}

[직전 화 연속성]
${continuityBlock || "없음"}

[대화 따옴표]
모든 대사는 반드시 "로 열고 "로 닫는다.

[문체·연출]
문체: ${styleRule}
분량: ${cfg.episodeLength}~${cfg.episodeLength + cfg.episodeLengthVar}자

[세계관 규칙]
${genRules}

[절대금지]
${absForbid}

[이번 화 목표] ${ctx.task.goal}
${ctx.task.required_events?.length ? `[필수 사건] ${ctx.task.required_events.join(", ")}` : ""}
${endingHook}

[출력 규칙]
- 화 제목: "# ${ep}화 - 제목" 형식으로 첫 줄에
- 본문만 출력. 설명·주석 금지
- 반드시 완결된 문장으로 끝낼 것
- 비최종화: [CLIFF] 단독 줄 → 클리프행어 2~4문장 → [END]
- 출력은 100% 한국어`;

  const user = `${ep}화를 ${cfg.pov} 시점으로 생성해줘.`;
  return { system, user };
}

// ══════════════════════════════════════════════════════════════
// 단일 케이스 실행
// ══════════════════════════════════════════════════════════════
async function runCase(
  tc: TestCase,
  variant: "A" | "B" | "C" | "D"
): Promise<{ tc: TestCase; variant: string; validation: ValidationResult; elapsed_ms: number }> {
  const t0  = Date.now();
  const ctx = toCtx(tc);
  const { system, user } = buildPrompt(ctx, variant);

  const llm   = getLLMClient();
  const model = getStoryModel();
  const cfg   = tc.gen_config;
  const maxTok = Math.ceil((cfg.episodeLength + cfg.episodeLengthVar) * 0.65 * 1.4) + 300;

  let text = "";
  try {
    const res = await (llm.chat.completions.create as any)({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.8, max_tokens: maxTok, stream: false,
    });
    text = res.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    text = `[생성 오류] ${String(e)}`;
  }

  const validation = await validate(text, ctx, { promptVersion: "A" });
  return { tc, variant, validation, elapsed_ms: Date.now() - t0 };
}

// ══════════════════════════════════════════════════════════════
// 결과 집계 + 출력
// ══════════════════════════════════════════════════════════════
interface DiagResult {
  case_id: string;
  pov: string;
  difficulty: string;
  variant: string;
  verdict: string;
  score: number;
  pov_violations: number;
  state_violations: number;
  name_violations: number;
  elapsed_ms: number;
}

function summarize(results: DiagResult[]) {
  const variants = ["A", "B", "C", "D"];
  const povTypes = ["1인칭 주인공", "1인칭 관찰자", "3인칭 관찰자", "전지적 작가", "교차 시점"];

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  POV CAPABILITY DIAGNOSTIC — VARIANT 비교");
  console.log("═══════════════════════════════════════════════════");

  // Variant별 집계
  console.log("\n[ Variant별 결과 ]");
  console.log("Variant | PASS | WARN | FAIL | avg점수 | POV위반 | 상태위반 | 이름위반");
  for (const v of variants) {
    const vr = results.filter(r => r.variant === v);
    if (vr.length === 0) continue;
    const pass = vr.filter(r => r.verdict.includes("PASS")).length;
    const warn = vr.filter(r => r.verdict === "WARN").length;
    const fail = vr.filter(r => r.verdict === "FAIL").length;
    const avgScore = Math.round(vr.reduce((s, r) => s + r.score, 0) / vr.length);
    const povV  = vr.reduce((s, r) => s + r.pov_violations, 0);
    const stateV = vr.reduce((s, r) => s + r.state_violations, 0);
    const nameV = vr.reduce((s, r) => s + r.name_violations, 0);
    console.log(`  ${v}     |  ${pass}   |  ${warn}   |  ${fail}   |   ${avgScore}   |    ${povV}    |    ${stateV}     |    ${nameV}`);
  }

  // POV별 집계
  console.log("\n[ POV별 시점 위반 횟수 (전 variant 합산) ]");
  for (const pov of povTypes) {
    const pr = results.filter(r => r.pov === pov);
    if (pr.length === 0) continue;
    const total = pr.reduce((s, r) => s + r.pov_violations, 0);
    const perCase = (total / pr.length).toFixed(1);
    const byVariant = variants.map(v => {
      const vr = pr.filter(r => r.variant === v);
      return vr.length > 0 ? vr.reduce((s, r) => s + r.pov_violations, 0) : "-";
    }).join(" | ");
    console.log(`  ${pov.padEnd(12)}: 총 ${total}건 (케이스당 ${perCase}) | A=${byVariant.split(" | ")[0]} B=${byVariant.split(" | ")[1]} C=${byVariant.split(" | ")[2]} D=${byVariant.split(" | ")[3]}`);
  }

  // 케이스별 상세
  console.log("\n[ 케이스별 상세 ]");
  const caseIds = [...new Set(results.map(r => r.case_id))];
  for (const id of caseIds) {
    const cr = results.filter(r => r.case_id === id);
    const pov = cr[0]?.pov ?? "?";
    const diff = cr[0]?.difficulty ?? "?";
    console.log(`  ${id} [${pov} / ${diff}]`);
    for (const v of variants) {
      const r = cr.find(x => x.variant === v);
      if (!r) continue;
      console.log(`    ${v}: ${r.verdict.padEnd(12)} score=${r.score} POV위반=${r.pov_violations} 상태위반=${r.state_violations}`);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// 메인
// ══════════════════════════════════════════════════════════════
await runMigrateV2();

const variantArg = (process.argv[2] ?? "all").toUpperCase() as "A" | "B" | "C" | "D" | "ALL";
const variants: ("A" | "B" | "C" | "D")[] = variantArg === "ALL"
  ? ["A", "B", "C", "D"] : [variantArg as "A" | "B" | "C" | "D"];

console.log(`\n🔬 POV 진단 실행 — ${POV_DIAG_CASES.length}케이스 × variant(${variants.join(",")}) = ${POV_DIAG_CASES.length * variants.length}회 생성+검증`);
console.log("  (리비전 없음 — 생성 1회 + 검증 1회)");

const allResults: DiagResult[] = [];
let done = 0;
const total = POV_DIAG_CASES.length * variants.length;

for (const tc of POV_DIAG_CASES) {
  for (const v of variants) {
    process.stdout.write(`  [${++done}/${total}] ${tc.id} variant=${v} POV=${tc.gen_config.pov}... `);
    try {
      const r = await runCase(tc, v);
      const povV  = r.validation.hard_violations.filter(x => x.rule.includes("시점")).length;
      const stateV = r.validation.hard_violations.filter(x => x.rule.includes("상태 보존")).length;
      const nameV = r.validation.hard_violations.filter(x => x.rule.includes("이름")).length;
      console.log(`${r.validation.verdict} score=${r.validation.total_score} POV위반=${povV}`);
      allResults.push({
        case_id: tc.id, pov: tc.gen_config.pov, difficulty: tc.difficulty,
        variant: v, verdict: r.validation.verdict, score: r.validation.total_score,
        pov_violations: povV, state_violations: stateV, name_violations: nameV,
        elapsed_ms: r.elapsed_ms,
      });
    } catch (e) {
      console.log(`ERROR: ${e}`);
      allResults.push({
        case_id: tc.id, pov: tc.gen_config.pov, difficulty: tc.difficulty,
        variant: v, verdict: "ERROR", score: 0,
        pov_violations: 0, state_violations: 0, name_violations: 0, elapsed_ms: 0,
      });
    }
  }
}

summarize(allResults);

// JSON 저장
const outDir = join(ROOT, "logs", "test_results");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const ts = Date.now();
const outPath = join(outDir, `pov_diag_${ts}.json`);
writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), variants, results: allResults }, null, 2));
console.log(`\n💾 결과 저장: ${outPath}`);

await pool.end();
