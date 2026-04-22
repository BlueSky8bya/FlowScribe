/**
 * protagonist_diag_runner.ts — 1인칭 주인공 POV 집중 진단 러너
 *
 * 실행: npx tsx scripts/protagonist_diag_runner.ts [variant] [mode] [cases]
 *   variant: A | B | C | D (기본 A)
 *   mode   : raw | revise (기본 raw)
 *   cases  : 케이스 수 (기본 10, 최대 10)
 *
 * Variant 정의:
 *   A — 현재 규칙 (src/lib/pov_rules.ts 그대로)
 *   B — 직접 금지 강화 버전 (타인 주어 서술 패턴 명시)
 *   C — 오프닝 앵커 버전 (첫 2~3문장 강제 1인칭)
 *   D — 문장 수준 전환 패턴 강제 버전 ('나는 보았다 — 그가 ~' 형식)
 *
 * raw mode  : revision 없이 raw generation 직후 validate만
 * revise mode: raw generation → revision → final verdict
 *
 * 결과 저장: logs/test_results/protagonist_diag_{variant}_{mode}_{timestamp}.json
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const { pool }            = await import("../src/lib/db.js");
const { runMigrateV2 }    = await import("../src/db/migrate_v2.js");
const { validate }        = await import("../src/services/validator.js");
const { reviseUntilPass } = await import("../src/services/revision.js");
const { getLLMClient, getStoryModel } = await import("../src/lib/llm.js");
const { resolveCharacterPolicy } = await import("../src/lib/character_policy_resolver.js");

import type { TestCase, EffectiveContext, GenConfig, Verdict } from "../src/types/canonical.js";
import { getProtagonistDiagCases } from "./protagonist_diag_cases.js";
import { variantCPovRule as sharedPovRule } from "../src/lib/pov_rules.js";

// ══════════════════════════════════════════════════════════════
// 1인칭 주인공 POV 규칙 Variants
// ══════════════════════════════════════════════════════════════

function variantA_protagonist(): string {
  // 현재 pov_rules.ts Variant C 규칙과 동일
  return `시점: 1인칭 주인공
필수: 모든 서술부는 '나/나는/내가/나의'로 시작하거나 1인칭 관점을 유지한다.
절대금지: 서술부에서 '그가/그녀가/그는/그녀는'으로 시작하는 3인칭 주어 사용.
허용: 대사(" " 내부) 안에서 다른 인물이 '나'를 지칭하는 것은 정상.`;
}

function variantB_protagonist(): string {
  // 직접 금지 강화 — 타인을 주어로 하는 서술 패턴 명시 금지
  return `시점: 1인칭 주인공
필수: 모든 서술부는 반드시 '나'의 시점에서 서술한다. '나는', '내가', '나의', '내 눈에', '내 귀에' 등 1인칭 표현을 사용한다.
절대금지:
- 서술부에서 '[타인 이름]/그/그녀는/이 [동사]다/했다' 형식 사용 (예: '민서가 달렸다', '그가 멈췄다')
- 서술부에서 타인의 감정·생각·의도를 직접 단언 ('그는 두려웠다', '그녀의 목표는 ~이었다')
- 서술부에서 타인을 주어로 한 행동·상태 서술 — 반드시 '나'를 주어로 전환
허용:
- 대사(" " 내부)에서는 어떤 주어든 허용
- '나는 그가 달리는 것을 보았다' — '나'가 관찰 주체인 형식으로 타인 묘사 가능
- '나는 그의 눈빛에서 두려움을 읽었다' — 나의 지각을 통한 타인 내면 간접 묘사 가능`;
}

function variantC_protagonist(): string {
  // shared pov_rules.ts 직접 위임 — 로컬 정의 제거
  return sharedPovRule("1인칭 주인공");
}

function variantD_protagonist(): string {
  // 문장 수준 전환 패턴 강제 — '나는 보았다' 형식 지시
  return `시점: 1인칭 주인공
필수: 모든 서술 문장의 실질적 주어가 '나'여야 한다. 타인의 행동·상태·감정을 서술할 때는 반드시 '나'의 지각을 거쳐야 한다.
절대금지 패턴 — 아래 패턴이 서술부에 등장하면 즉각적인 시점 오류:
- '[인물명/그/그녀]는 [동사했다]' 형식 (예: '민서가 달렸다', '그가 멈췄다', '그녀는 웃었다')
- '[인물명/그/그녀]의 [감정/생각]은 ~이었다' 형식 (예: '그는 두려웠다', '그녀의 목표는')
금지 패턴 대신 사용할 형식:
- '나는 [인물명]이 [동사하는 것을] 보았다/들었다/느꼈다'
- '나의 눈에 [인물명]은 [상태]처럼 보였다'
- '나는 그의 눈빛에서 [감정]을 읽었다'
허용: 대사(" " 내부).`;
}

function getPovRule(variant: "A" | "B" | "C" | "D"): string {
  if (variant === "A") return variantA_protagonist();
  if (variant === "B") return variantB_protagonist();
  if (variant === "C") return variantC_protagonist();
  return variantD_protagonist();
}

// ══════════════════════════════════════════════════════════════
// EffectiveContext 변환
// ══════════════════════════════════════════════════════════════
function toCtx(tc: TestCase): EffectiveContext {
  const gen = tc.gen_config;
  const ep  = tc.episode_number;
  return {
    episode_number: ep,
    gen_config: gen,
    world_config: tc.world_config,
    general_rules: tc.world_rules.filter(r => r.rule_type === "general").map(r => r.content),
    absolute_forbidden: tc.world_rules.filter(r => r.rule_type === "absolute_forbidden").map(r => r.content),
    active_interventions: tc.active_interventions,
    characters: tc.characters,
    character_dynamic_states: tc.character_dynamic_states,
    character_inferred_states: [],
    prev_episode_state: tc.prev_episode_state,
    task: tc.task,
    foreshadow_memory: tc.prev_episode_state.open_foreshadows.map((f, i) => ({
      id: `diag-${i}`, planted_episode: ep - 2, content: f, keywords: [],
    })),
    arc_summaries: [],
    character_arcs: {},
    rolling_summary: tc.prev_episode_state.ending_event
      ? `${ep - 1}화: ${tc.prev_episode_state.ending_event}` : "",
    prev_episode_tail: undefined,
    reader_profile: { focus: 55, sentiment: 55, urgency: 50, complexity: 55, dialogue: 55, audio_sync: 40 },
  };
}

// ══════════════════════════════════════════════════════════════
// 프롬프트 조립 — test_runner.ts buildGenPrompt와 동일 구조,
// POV 규칙만 variant로 교체
// ══════════════════════════════════════════════════════════════
function buildDiagPrompt(
  ctx: EffectiveContext,
  variant: "A" | "B" | "C" | "D",
): { system: string; user: string } {
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

  const locationList = ctx.character_dynamic_states
    .filter(s => s.location)
    .map(s => `${s.character_name}: ${s.location}`)
    .join(" / ");

  const prevState = ctx.prev_episode_state;
  const continuityBlock = [
    prevState.ending_event ? `직전 화 마지막 사건: ${prevState.ending_event}` : "",
    prevState.current_time ? `현재 시각: ${prevState.current_time}` : "",
    prevState.environment_changes.length ? `환경 변화: ${prevState.environment_changes.join(", ")}` : "",
    prevState.continuity_notes.length    ? `연속성 주의: ${prevState.continuity_notes.join(" / ")}` : "",
    Object.keys(prevState.remaining_resources).length
      ? `잔여 자원: ${Object.entries(prevState.remaining_resources).map(([k,v]) => `${k}=${v}`).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  // variant별 1인칭 주인공 POV 규칙
  const povRule = getPovRule(variant);

  const styleRule = cfg.style === "간결/담백"
    ? "짧고 명확한 문장. '마치 ~처럼', '~인 양', '~하듯' 과도한 비유 금지. 행동과 사실 위주 서술."
    : cfg.style === "서정/감성"
    ? "감성적 묘사와 내면 정서를 풍부하게. 감각 이미지로 감정 전달."
    : cfg.style === "묘사풍부"
    ? "장면·감각·인물 내면을 구체적으로 묘사. 추상적 수식보다 구체적 감각 세부 묘사."
    : "묘사와 사건 전개의 균형 유지.";

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

  const charPolicy = resolveCharacterPolicy(cfg.character_policy, ctx.world_config);

  const aliasNote = charPolicy.alias_policy === "strict"
    ? "별칭·성씨 단독 지칭 금지. 반드시 등록된 이름 그대로만 사용."
    : "성씨 단독, 호칭 접미, 역할 지칭은 허용.";

  const newCharNote = charPolicy.new_character_policy === "closed_cast"
    ? "신규 인물 등장 금지. 위 목록 인물만 등장."
    : charPolicy.new_character_policy === "extras_only"
    ? "이름 없는 배경 단역만 허용. 이름 있는 신규 인물 금지."
    : "이름 있는 신규 인물은 꼭 필요할 때만 도입. 첫 등장 시 역할 명시.";

  const genderPronounList = ctx.characters.map(c => {
    const pronoun = c.gender === "여성" ? "그녀/그녀의" : c.gender === "남성" ? "그/그의" : "이름/역할로만 지칭";
    return `${c.name}(${c.gender}) → ${pronoun}`;
  }).join(", ");

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

  const endingHookInstruction = ctx.task.ending_hook_direction
    ? `[엔딩 훅 필수] 마지막 [CLIFF] 이후 2~4문장에서 아래 중 하나를 명확하게 남겨야 한다:
(1) 즉각적 위협이나 위기 상황 (인물이 피할 수 없는 상황)
(2) 예상치 못한 발견이나 반전 정보
(3) 행동의 결과로 생긴 새로운 심각한 문제
(4) 독자가 "다음 화에서 무슨 일이?" 하고 묻게 만드는 미해결 상황
방향: ${ctx.task.ending_hook_direction}
주의: 막연한 분위기 묘사(예: "어둠이 깔렸다")로만 끝내지 않는다.`
    : "";

  const system = `당신은 한국 소설 생성 AI다.

[시점 — 최우선 규칙]
${povRule}

[등장인물 — 허용 이름 목록]
${charList}
허용 이름: ${charNames}
이름 표기 규칙:
- 위 이름을 정확히 유지한다. 오기·합성·변형·로마자 표기는 심각한 오류다.
- 조사를 붙일 때 이름 자체를 변형하지 않는다.
- 이름을 인물 간에 교차 혼용하지 않는다.
별칭/호칭: ${aliasNote}
신규 인물 도입: ${newCharNote}

[인물 젠더 대명사 — 설정 기준 사용, 위반 금지]
${genderPronounList}
절대금지: 설정 성별과 다른 대명사 사용. 성별이 '해당없음'인 인물에게 '그'나 '그녀' 단독 사용 금지 — 이름 또는 역할로 대체.

[이번 화 시작 상태 — 첫 단락에서 반드시 반영]
인물별 현재 위치: ${locationList || "없음"}
상세 상태:
${dynStates || "없음"}
규칙:
- 이번 화는 위 위치와 상태에서 시작한다. 첫 단락 안에서 시작 위치를 자연스럽게 드러낸다.
- 인물을 그 인물의 설정 위치가 아닌 다른 위치에 등장시키지 않는다. 이동이 필요하면 반드시 이동 경위나 시간 경과를 한 문장 이상 서술한다.
- 신체 상태가 '정상'인 인물에게 임의로 부상이나 이상 상태를 추가하지 않는다.

[부상 제약]
${injuryBlock}

[직전 화 연속성]
${continuityBlock || "없음"}

[대화 따옴표]
모든 대사는 반드시 "로 열고 "로 닫는다.

[문체·연출]
문체: ${styleRule}
연출: ${sliders || "기본"}
분량: ${cfg.episodeLength}~${cfg.episodeLength + cfg.episodeLengthVar}자

[세계관 규칙 — 이번 화에서 최소 1개를 사건 동인으로 활용]
${genRules}
활용 지시: 위 규칙 중 최소 1개가 이번 화의 행동 제약, 갈등 원인, 또는 결과에 직접 영향을 미쳐야 한다.

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
  클리프행어는 반드시 ①즉각적 위협, ②예상 밖 발견·반전, ③행동 결과로 생긴 새 문제, ④미해결 상황 중 하나를 구체적 사건으로 서술한다.
- 최종화: 완전한 결말, [END]로 끝
- 출력은 100% 한국어`;

  const user = `${ep}화를 1인칭 주인공 시점으로 생성해줘.`;

  return { system, user };
}

// ══════════════════════════════════════════════════════════════
// 단일 케이스 실행
// ══════════════════════════════════════════════════════════════
interface DiagResult {
  case_id: string;
  description: string;
  difficulty: string;
  variant: string;
  mode: "raw" | "revise";
  raw_verdict: string;
  raw_score: number;
  raw_pov_violations: number;
  raw_state_violations: number;
  final_verdict: string;
  final_score: number;
  revision_count: number;
  elapsed_ms: number;
}

async function runCase(
  tc: TestCase,
  variant: "A" | "B" | "C" | "D",
  mode: "raw" | "revise",
): Promise<DiagResult> {
  const t0  = Date.now();
  const ctx = toCtx(tc);
  const { system, user } = buildDiagPrompt(ctx, variant);
  const llm   = getLLMClient();
  const model = getStoryModel();
  const cfg   = tc.gen_config;
  const maxTok = Math.ceil((cfg.episodeLength + cfg.episodeLengthVar) * 0.65 * 1.4) + 300;

  let text = "";
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
    text = res.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    console.error("  생성 오류:", err);
    return {
      case_id: tc.id, description: tc.description, difficulty: tc.difficulty,
      variant, mode, raw_verdict: "FAIL", raw_score: 0,
      raw_pov_violations: 0, raw_state_violations: 0,
      final_verdict: "FAIL", final_score: 0, revision_count: 0,
      elapsed_ms: Date.now() - t0,
    };
  }

  // raw validation
  const rawVal = await validate(text, ctx, { promptVersion: "A" });
  const rawPovViol = rawVal.hard_violations.filter(v =>
    v.rule.includes("시점") || v.rule.includes("POV")
  ).length;
  const rawStateViol = rawVal.hard_violations.filter(v =>
    v.rule.includes("상태 보존") || v.rule.includes("시공간")
  ).length;

  let finalVerdict: string = rawVal.verdict;
  let finalScore: number   = rawVal.total_score;
  let revisionCount        = 0;

  // revision (revise mode에서만)
  if (mode === "revise" && (rawVal.verdict === "FAIL" || rawVal.verdict === "WARN")) {
    const revised = await reviseUntilPass(text, rawVal, ctx, { promptVersion: "A" });
    finalVerdict  = revised.final_verdict;
    finalScore    = revised.final_score;
    revisionCount = revised.iterations;
  }

  return {
    case_id: tc.id, description: tc.description, difficulty: tc.difficulty,
    variant, mode,
    raw_verdict: rawVal.verdict,
    raw_score: rawVal.total_score,
    raw_pov_violations: rawPovViol,
    raw_state_violations: rawStateViol,
    final_verdict: finalVerdict,
    final_score: finalScore,
    revision_count: revisionCount,
    elapsed_ms: Date.now() - t0,
  };
}

// ══════════════════════════════════════════════════════════════
// 리포트 출력
// ══════════════════════════════════════════════════════════════
function printDiagReport(results: DiagResult[], variant: string, mode: string) {
  console.log("\n" + "═".repeat(60));
  console.log(`📊 1인칭 주인공 진단 — Variant ${variant} / mode=${mode}`);
  console.log("  ※ 이 측정은 1인칭 주인공 POV 지원 가능 여부 판정을 위한 고정 세트 진단입니다.");
  console.log("  ※ 전체 supported POV benchmark가 아닙니다.");
  console.log("═".repeat(60));

  const total    = results.length;
  const rawPass  = results.filter(r => r.raw_verdict === "PASS" || r.raw_verdict === "PASS_STRONG").length;
  const rawFail  = results.filter(r => r.raw_verdict === "FAIL").length;
  const finPass  = results.filter(r => r.final_verdict === "PASS" || r.final_verdict === "PASS_STRONG").length;
  const finFail  = results.filter(r => r.final_verdict === "FAIL").length;
  const avgRaw   = Math.round(results.reduce((s, r) => s + r.raw_score,   0) / total);
  const avgFin   = Math.round(results.reduce((s, r) => s + r.final_score, 0) / total);
  const totalPovViol   = results.reduce((s, r) => s + r.raw_pov_violations,   0);
  const totalStateViol = results.reduce((s, r) => s + r.raw_state_violations, 0);

  console.log(`\n케이스: ${total}`);
  console.log(`RAW   — PASS: ${rawPass}/${total} (${Math.round(rawPass/total*100)}%) | FAIL: ${rawFail} | avg: ${avgRaw}`);
  if (mode === "revise") {
    console.log(`FINAL — PASS: ${finPass}/${total} (${Math.round(finPass/total*100)}%) | FAIL: ${finFail} | avg: ${avgFin}`);
    console.log(`Revision rescue: ${rawFail > 0 ? (rawFail - finFail) + '/' + rawFail + ' FAIL 구조' : '구조 불필요'}`);
  }
  console.log(`\nRAW 시점 위반 (hard): ${totalPovViol}건 / ${total}케이스`);
  console.log(`RAW 상태 보존 위반 (hard): ${totalStateViol}건 / ${total}케이스`);

  console.log("\n케이스별:");
  for (const r of results) {
    const raw  = `${r.raw_verdict}(${r.raw_score})`;
    const fin  = mode === "revise" ? ` → final:${r.final_verdict}(${r.final_score}) rev:${r.revision_count}` : "";
    const pov  = r.raw_pov_violations > 0 ? ` [POV위반x${r.raw_pov_violations}]` : "";
    const state = r.raw_state_violations > 0 ? ` [상태위반x${r.raw_state_violations}]` : "";
    console.log(`  ${r.case_id} ${r.difficulty.padEnd(6)} raw:${raw}${fin}${pov}${state}`);
  }
  console.log("═".repeat(60) + "\n");
}

function saveResults(results: DiagResult[], variant: string, mode: string) {
  const dir = join(ROOT, "logs", "test_results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts  = Date.now();
  const tag = `protagonist_diag_${variant}_${mode}`;
  const filename = join(dir, `${tag}_${ts}.json`);
  const latest   = join(dir, `${tag}_latest.json`);
  const payload  = { variant, mode, timestamp: new Date().toISOString(), results };
  writeFileSync(filename, JSON.stringify(payload, null, 2));
  writeFileSync(latest,   JSON.stringify(payload, null, 2));
  console.log(`💾 저장: ${filename}`);
}

// ══════════════════════════════════════════════════════════════
// CLI 진입점
// ══════════════════════════════════════════════════════════════
async function main() {
  try { await runMigrateV2(); } catch {}

  const [,, variantArg = "A", modeArg = "raw", caseCountArg = "10"] = process.argv;
  const variant   = (["A","B","C","D"].includes(variantArg) ? variantArg : "A") as "A"|"B"|"C"|"D";
  const mode      = (modeArg === "revise" ? "revise" : "raw") as "raw" | "revise";
  const caseCount = Math.min(parseInt(caseCountArg, 10) || 10, 10);

  const allCases  = getProtagonistDiagCases().slice(0, caseCount);

  console.log(`\n🎯 1인칭 주인공 집중 진단 — Variant ${variant} / mode=${mode} / ${caseCount}케이스`);
  console.log(`   고정 세트: protagonist_diag_cases.ts (랜덤 없음, 재현 가능)`);
  console.log(`   POV: 1인칭 주인공 (전체 supported POV benchmark 아님)\n`);

  const results: DiagResult[] = [];
  for (let i = 0; i < allCases.length; i++) {
    const tc = allCases[i];
    process.stdout.write(`  [${i+1}/${allCases.length}] ${tc.description.slice(0, 55)}... `);
    const result = await runCase(tc, variant, mode);
    results.push(result);
    const pov   = result.raw_pov_violations   > 0 ? ` POV위반x${result.raw_pov_violations}`   : "";
    const state = result.raw_state_violations > 0 ? ` 상태위반x${result.raw_state_violations}` : "";
    console.log(`raw:${result.raw_verdict}(${result.raw_score})${pov}${state} ${result.elapsed_ms}ms`);
  }

  printDiagReport(results, variant, mode);
  saveResults(results, variant, mode);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
