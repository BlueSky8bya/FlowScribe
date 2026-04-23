/**
 * ab_hook_world_runner.ts — 엔딩 훅 / 세계관 규칙 활용 prompt 개선 A/B 분리 비교 러너
 *
 * 실행: npx tsx scripts/ab_hook_world_runner.ts
 *
 * 비교 설계:
 *   A (current) — state persistence 변경 A/B/C 적용 버전 (이전 단계 확정)
 *     - [이번 화 시작 상태] 강화 + 소지품 초기화 금지
 *     - injuryBlock: depiction guidance 방식
 *     - [직전 화 연속성] 여파 반영 directive
 *     - 세계관/엔딩 훅: 기존 수준
 *
 *   B (improved) — A + hook/world-rule 개선 추가
 *     - 세계관 규칙: "사건 내 작동" 요건 강화 (배경 설명 그치기 금지 명시)
 *     - 엔딩 훅: 분위기 묘사 금지 예시 추가 + 인물 행동·사건 변화 필수 명시
 *     - [출력 규칙] CLIFF: anti-vague 예시 추가
 *
 * 동일 조건:
 *   - 같은 14케이스 고정 세트 (ab_state_persistence_cases.ts)
 *   - POV 규칙: 동일
 *   - revision 정책: 동일
 *   - state persistence 변경: 동일 (A/B/C 유지)
 *   - validator: 동일 (freeze 상태)
 *
 * 결과 저장: logs/test_results/ab_hook_world_{timestamp}.json
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const { pool }            = await import("../../src/lib/db.js");
const { runMigrateV2 }    = await import("../../src/db/migrate_v2.js");
const { validate }        = await import("../../src/services/validator.js");
const { reviseUntilPass } = await import("../../src/services/revision.js");
const { getLLMClient, getStoryModel } = await import("../../src/lib/llm.js");
const { resolveCharacterPolicy } = await import("../../src/lib/character_policy_resolver.js");

import type { TestCase, EffectiveContext } from "../../src/types/canonical.js";
import { variantCPovRule } from "../../src/lib/pov_rules.js";
import { AB_STATE_PERSISTENCE_CASES } from "../fixtures/ab_state_persistence_cases.js";

// ══════════════════════════════════════════════════════════════
// TestCase → EffectiveContext
// ══════════════════════════════════════════════════════════════
function toCtx(tc: TestCase): EffectiveContext {
  const ep = tc.episode_number;
  return {
    episode_number: ep,
    gen_config: tc.gen_config,
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
      id: `ab-${i}`, planted_episode: ep - 2, content: f, keywords: [],
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
// 공통 프롬프트 블록 조립 헬퍼
// ══════════════════════════════════════════════════════════════
function buildCommonBlocks(ctx: EffectiveContext) {
  const cfg = ctx.gen_config;
  const ep  = ctx.episode_number;

  const charList = ctx.characters.map(c =>
    `${c.name}(${c.gender}, ${c.type}): ${c.personality}`
  ).join("\n");
  const charNames = ctx.characters.map(c => c.name).join(", ");

  const dynStates = ctx.character_dynamic_states.map(s => {
    const parts = [`${s.character_name}:`];
    if (s.location)       parts.push(`위치=${s.location}`);
    if (s.physical_state) parts.push(`신체상태=${s.physical_state}`);
    if (s.items?.length)  parts.push(`소지품=${s.items.join(",")}`);
    if (s.recent_goal)    parts.push(`목표=${s.recent_goal}`);
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
    prevState.continuity_notes.length   ? `연속성 주의: ${prevState.continuity_notes.join(" / ")}` : "",
    Object.keys(prevState.remaining_resources).length
      ? `잔여 자원: ${Object.entries(prevState.remaining_resources).map(([k,v])=>`${k}=${v}`).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const povRule = variantCPovRule(cfg.pov);

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

  const genRules     = ctx.general_rules.join("\n") || "없음";
  const absForbid    = ctx.absolute_forbidden.join("\n") || "없음";
  const interventions = ctx.active_interventions.map(i => `- ${i.instruction}`).join("\n") || "없음";
  const prevSummary  = ctx.rolling_summary || "없음";
  const foreshadows  = ctx.foreshadow_memory.map(f => `- [${f.planted_episode}화] ${f.content}`).join("\n") || "없음";

  const charPolicy = resolveCharacterPolicy(cfg.character_policy, ctx.world_config);
  const aliasNote = charPolicy.alias_policy === "strict"
    ? "별칭·성씨 단독 지칭 금지. 반드시 등록된 이름 그대로만 사용."
    : "성씨 단독('박', '김'), 호칭 접미('씨', '님'), 역할 지칭은 허용.";
  const newCharNote = charPolicy.new_character_policy === "closed_cast"
    ? "신규 인물(이름 있음/없음 모두) 등장 금지. 위 목록 인물만 등장."
    : charPolicy.new_character_policy === "extras_only"
    ? "이름 없는 배경 단역(행인, 점원, 경비 등)만 허용. 이름 있는 신규 인물 금지."
    : charPolicy.new_character_policy === "named_with_gate"
    ? `이름 있는 신규 인물: 꼭 필요할 때만 도입 가능. 첫 등장 시 역할·기존 인물과의 관계를 한 문장 이상 명시.\n이름 없는 배경 단역: ${charPolicy.background_extras_allowed ? "허용" : "금지"}.`
    : `이름 있는 신규 인물: 생성기 재량으로 추가 가능.\n이름 없는 배경 단역: ${charPolicy.background_extras_allowed ? "허용" : "금지"}.`;

  const genderPronounList = ctx.characters.map(c => {
    const pronoun = c.gender === "여성" ? "그녀/그녀의" : c.gender === "남성" ? "그/그의" : "이름/역할로만 지칭";
    return `${c.name}(${c.gender}) → ${pronoun}`;
  }).join(", ");

  const injuredChars = ctx.character_dynamic_states.filter(s =>
    s.physical_state && (
      s.physical_state.includes("부상") || s.physical_state.includes("중상") ||
      s.physical_state.includes("경상") || s.physical_state.includes("한계") ||
      s.physical_state.includes("고갈")
    )
  );

  // depiction guidance injuryBlock (state persistence 변경 B 유지)
  const injuryBlock = injuredChars.length > 0
    ? injuredChars.map(s => {
        const p = s.physical_state ?? "";
        const guidance = p.includes("팔") || p.includes("손") || p.includes("어깨") || p.includes("손목")
          ? "해당 팔 정상 사용 불가. 행동 묘사 시 고통 반응·반대 팔 사용·동작 회피를 자연스럽게 드러낸다."
          : p.includes("다리") || p.includes("발") || p.includes("무릎") || p.includes("발목")
          ? "해당 다리 정상 사용 불가. 걷기·달리기 묘사 시 절뚝임·지지·통증을 반드시 수반한다."
          : p.includes("갈비뼈") || p.includes("갈비")
          ? "격렬한 신체 활동 불가. 호흡·이동 묘사 시 갈비뼈 통증이 드러나야 한다."
          : "해당 부위 정상 사용 불가. 행동 시 부상 부위의 제약 또는 고통이 드러나야 한다.";
        return `${s.character_name}(${p}): ${guidance}`;
      }).join("\n")
    : "없음";

  return {
    ep, cfg, charList, charNames, dynStates, locationList,
    continuityBlock, povRule, styleRule, sliders,
    genRules, absForbid, interventions, prevSummary, foreshadows,
    aliasNote, newCharNote, genderPronounList,
    injuryBlock,
  };
}

// ══════════════════════════════════════════════════════════════
// endingHookInstruction 빌더
// ══════════════════════════════════════════════════════════════
function buildEndingHookA(ctx: EffectiveContext): string {
  if (!ctx.task.ending_hook_direction) return "";
  return `[엔딩 훅 필수] 마지막 [CLIFF] 이후 2~4문장에서 아래 중 하나를 명확하게 남겨야 한다:
(1) 즉각적 위협이나 위기 상황
(2) 예상치 못한 발견이나 반전 정보
(3) 행동의 결과로 생긴 새로운 심각한 문제
(4) 독자가 "다음 화에서 무슨 일이?" 묻게 만드는 미해결 상황
방향: ${ctx.task.ending_hook_direction}
주의: 막연한 분위기 묘사로만 끝내지 않는다.`;
}

function buildEndingHookB(ctx: EffectiveContext): string {
  if (!ctx.task.ending_hook_direction) return "";
  return `[엔딩 훅 필수] 마지막 [CLIFF] 이후 2~4문장에서 아래 중 하나를 명확하게 남겨야 한다:
(1) 즉각적 위협이나 위기 상황
(2) 예상치 못한 발견이나 반전 정보
(3) 행동의 결과로 생긴 새로운 심각한 문제
(4) 독자가 "다음 화에서 무슨 일이?" 묻게 만드는 미해결 상황
방향: ${ctx.task.ending_hook_direction}
주의: "어둠이 깔렸다" "침묵만 흘렀다" 같은 분위기 묘사만으로 끝내지 않는다. 인물의 행동·발견·상황 변화가 반드시 포함되어야 한다.`;
}

// ══════════════════════════════════════════════════════════════
// Prompt A — state persistence A/B/C 유지, hook/world 현재 수준
// ══════════════════════════════════════════════════════════════
function buildCurrentPrompt(ctx: EffectiveContext): { system: string; user: string } {
  const b = buildCommonBlocks(ctx);
  const endingHookInstruction = buildEndingHookA(ctx);

  const system = `당신은 한국 소설 생성 AI다.

[시점 — 최우선 규칙]
${b.povRule}

[등장인물 — 허용 이름 목록]
${b.charList}
허용 이름: ${b.charNames}
이름 표기 규칙:
- 위 이름을 정확히 유지한다. 오기·합성·변형·로마자 표기는 심각한 오류다.
- 조사를 붙일 때 이름 자체를 변형하지 않는다 (민서과 → 민서와).
- 이름을 인물 간에 교차 혼용하지 않는다.
별칭/호칭: ${b.aliasNote}
신규 인물 도입: ${b.newCharNote}

[인물 젠더 대명사 — 설정 기준 사용, 위반 금지]
${b.genderPronounList}
절대금지: 설정 성별과 다른 대명사 사용. 성별이 '해당없음'인 인물에게 '그'나 '그녀' 단독 사용 금지 — 이름 또는 역할로 대체.

[이번 화 시작 상태 — 첫 단락에서 반드시 반영]
인물별 현재 위치: ${b.locationList || "없음"}
상세 상태 (소지품·부상·목표 포함):
${b.dynStates || "없음"}
시작 규칙:
- 첫 문장 또는 첫 단락의 행동·환경 묘사가 위 위치에서 비롯되어야 한다. 위 위치와 맞지 않는 장면으로 시작하지 않는다.
- 위 소지품·자원·목표 상태를 유지한다. 이번 화 시작 시 명시된 소지품을 임의로 분실·소비·초기화하지 않는다.
- 인물을 설정 위치 외 장소에 등장시킬 경우 이동 경위 또는 시간 경과를 1문장 이상 서술한다.
- 신체 상태가 정상인 인물에게 임의로 부상이나 이상 상태를 추가하지 않는다.

[부상 제약]
${b.injuryBlock}

[직전 화 연속성 — 이번 화 첫 장면에서 여파 반영]
${b.continuityBlock || "없음"}
${b.continuityBlock ? "위 직전 사건의 여파(긴장감·환경·인물 상태 변화)가 이번 화 첫 단락의 행동·감정·환경에서 자연스럽게 이어져야 한다." : ""}

[대화 따옴표]
모든 대사는 반드시 "로 열고 "로 닫는다. 열린 따옴표를 닫지 않으면 심각한 오류다.

[문체·연출]
문체: ${b.styleRule}
연출: ${b.sliders || "기본"}
분량: ${b.cfg.episodeLength}~${b.cfg.episodeLength + b.cfg.episodeLengthVar}자

[세계관 규칙 — 이번 화에서 최소 1개를 사건 동인으로 활용]
${b.genRules}
활용 지시: 위 규칙 중 최소 1개가 이번 화의 행동 제약, 갈등 원인, 또는 결과에 직접 영향을 미쳐야 한다.

[절대금지 — 어떤 경우에도 위반 불가]
${b.absForbid}

[작가 개입 — 즉시 반영]
${b.interventions}

[직전 줄거리]
${b.prevSummary}

[미회수 복선 — 이번 화에서 하나 이상 사건 변수로 활용]
${b.foreshadows}

[이번 화 목표] ${ctx.task.goal}
${ctx.task.required_events?.length ? `[필수 사건] ${ctx.task.required_events.join(", ")}` : ""}
${ctx.task.special_constraints?.length ? `[특수 제약] ${ctx.task.special_constraints.join(" | ")}` : ""}
${endingHookInstruction}

[출력 규칙]
- 화 제목: "# ${b.ep}화 - 제목" 형식으로 첫 줄에
- 본문만 출력. 설명·주석·JSON 절대 금지
- 반드시 완결된 문장으로 끝낼 것
- 비최종화: 본문 완성 후 [CLIFF] 단독 줄 → 클리프행어 2~4문장 → [END]
  클리프행어는 반드시 ①즉각적 위협/위기, ②예상 밖 발견·반전, ③행동 결과로 생긴 새 문제, ④독자가 "다음 화에서 무슨 일이?" 묻게 만드는 미해결 상황 중 하나를 구체적 사건으로 서술한다.
- 최종화: 완전한 결말, [END]로 끝
- 출력은 100% 한국어`;

  const user = `${b.ep}화를 ${b.cfg.pov} 시점으로 생성해줘.`;
  return { system, user };
}

// ══════════════════════════════════════════════════════════════
// Prompt B — A + hook/world-rule 개선 추가
// ══════════════════════════════════════════════════════════════
function buildImprovedPrompt(ctx: EffectiveContext): { system: string; user: string } {
  const b = buildCommonBlocks(ctx);
  const endingHookInstruction = buildEndingHookB(ctx);

  const system = `당신은 한국 소설 생성 AI다.

[시점 — 최우선 규칙]
${b.povRule}

[등장인물 — 허용 이름 목록]
${b.charList}
허용 이름: ${b.charNames}
이름 표기 규칙:
- 위 이름을 정확히 유지한다. 오기·합성·변형·로마자 표기는 심각한 오류다.
- 조사를 붙일 때 이름 자체를 변형하지 않는다 (민서과 → 민서와).
- 이름을 인물 간에 교차 혼용하지 않는다.
별칭/호칭: ${b.aliasNote}
신규 인물 도입: ${b.newCharNote}

[인물 젠더 대명사 — 설정 기준 사용, 위반 금지]
${b.genderPronounList}
절대금지: 설정 성별과 다른 대명사 사용. 성별이 '해당없음'인 인물에게 '그'나 '그녀' 단독 사용 금지 — 이름 또는 역할로 대체.

[이번 화 시작 상태 — 첫 단락에서 반드시 반영]
인물별 현재 위치: ${b.locationList || "없음"}
상세 상태 (소지품·부상·목표 포함):
${b.dynStates || "없음"}
시작 규칙:
- 첫 문장 또는 첫 단락의 행동·환경 묘사가 위 위치에서 비롯되어야 한다. 위 위치와 맞지 않는 장면으로 시작하지 않는다.
- 위 소지품·자원·목표 상태를 유지한다. 이번 화 시작 시 명시된 소지품을 임의로 분실·소비·초기화하지 않는다.
- 인물을 설정 위치 외 장소에 등장시킬 경우 이동 경위 또는 시간 경과를 1문장 이상 서술한다.
- 신체 상태가 정상인 인물에게 임의로 부상이나 이상 상태를 추가하지 않는다.

[부상 제약]
${b.injuryBlock}

[직전 화 연속성 — 이번 화 첫 장면에서 여파 반영]
${b.continuityBlock || "없음"}
${b.continuityBlock ? "위 직전 사건의 여파(긴장감·환경·인물 상태 변화)가 이번 화 첫 단락의 행동·감정·환경에서 자연스럽게 이어져야 한다." : ""}

[대화 따옴표]
모든 대사는 반드시 "로 열고 "로 닫는다. 열린 따옴표를 닫지 않으면 심각한 오류다.

[문체·연출]
문체: ${b.styleRule}
연출: ${b.sliders || "기본"}
분량: ${b.cfg.episodeLength}~${b.cfg.episodeLength + b.cfg.episodeLengthVar}자

[세계관 규칙 — 이번 화에서 최소 1개를 사건 동인으로 활용]
${b.genRules}
활용 지시: 위 규칙 중 최소 1개가 이번 화의 행동 제약, 갈등 원인, 또는 결과에 직접 영향을 미쳐야 한다. 규칙을 배경 설명·언급에만 활용하거나 서사에서 무시하지 않는다 — 반드시 인물의 행동 가능성을 제한하거나 갈등을 촉발하거나 해결 수단을 규정하는 방식으로 사건 내에서 작동해야 한다.

[절대금지 — 어떤 경우에도 위반 불가]
${b.absForbid}

[작가 개입 — 즉시 반영]
${b.interventions}

[직전 줄거리]
${b.prevSummary}

[미회수 복선 — 이번 화에서 하나 이상 사건 변수로 활용]
${b.foreshadows}

[이번 화 목표] ${ctx.task.goal}
${ctx.task.required_events?.length ? `[필수 사건] ${ctx.task.required_events.join(", ")}` : ""}
${ctx.task.special_constraints?.length ? `[특수 제약] ${ctx.task.special_constraints.join(" | ")}` : ""}
${endingHookInstruction}

[출력 규칙]
- 화 제목: "# ${b.ep}화 - 제목" 형식으로 첫 줄에
- 본문만 출력. 설명·주석·JSON 절대 금지
- 반드시 완결된 문장으로 끝낼 것
- 비최종화: 본문 완성 후 [CLIFF] 단독 줄 → 클리프행어 2~4문장 → [END]
  클리프행어는 반드시 ①즉각적 위협/위기, ②예상 밖 발견·반전, ③행동 결과로 생긴 새 문제, ④독자가 "다음 화에서 무슨 일이?" 묻게 만드는 미해결 상황 중 하나를 구체적 사건으로 서술한다. "어둠이 깔렸다" "침묵만 흘렀다" 같은 분위기 묘사만으로 끝내지 않는다.
- 최종화: 완전한 결말, [END]로 끝
- 출력은 100% 한국어`;

  const user = `${b.ep}화를 ${b.cfg.pov} 시점으로 생성해줘.`;
  return { system, user };
}

// ══════════════════════════════════════════════════════════════
// 결과 타입
// ══════════════════════════════════════════════════════════════
interface CaseResult {
  case_id: string;
  description: string;
  difficulty: string;
  pov: string;
  verdict: string;
  score: number;
  pov_violations: number;
  state_violations: number;
  location_violations: number;
  injury_violations: number;
  quote_violations: number;
  hook_violations: number;
  world_violations: number;
  soft_warnings: string[];
  elapsed_ms: number;
}

// ══════════════════════════════════════════════════════════════
// 단일 케이스 실행
// ══════════════════════════════════════════════════════════════
async function runCase(
  tc: TestCase,
  variant: "A" | "B",
  idx: number,
  total: number,
): Promise<CaseResult> {
  const t0  = Date.now();
  const ctx = toCtx(tc);
  const { system, user } = variant === "A"
    ? buildCurrentPrompt(ctx)
    : buildImprovedPrompt(ctx);

  const llm    = getLLMClient();
  const model  = getStoryModel();
  const cfg    = tc.gen_config;
  const maxTok = Math.ceil((cfg.episodeLength + cfg.episodeLengthVar) * 0.65 * 1.4) + 300;

  process.stdout.write(
    `  [${idx}/${total}] [${tc.id}] ${tc.description.slice(0, 40)}... `
  );

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
      case_id: tc.id, description: tc.description,
      difficulty: tc.difficulty, pov: cfg.pov,
      verdict: "FAIL", score: 0,
      pov_violations: 0, state_violations: 0,
      location_violations: 0, injury_violations: 0, quote_violations: 0,
      hook_violations: 1, world_violations: 1,
      soft_warnings: ["생성 오류"],
      elapsed_ms: Date.now() - t0,
    };
  }

  const valResult = await validate(text, ctx, { promptVersion: "A" });

  let finalVerdict = valResult.verdict;
  let finalScore   = valResult.total_score;
  if (valResult.verdict === "FAIL" || valResult.verdict === "WARN") {
    const revised = await reviseUntilPass(text, valResult, ctx, { promptVersion: "A" });
    finalVerdict = revised.final_verdict;
    finalScore   = revised.final_score;
  }

  const hardRules = valResult.hard_violations.map(v => v.rule);
  const softRules = valResult.soft_warnings?.map((w: any) => w.rule ?? w) ?? [];

  const povViol    = hardRules.filter(r => r.includes("시점") || r.includes("POV")).length;
  const stateViol  = hardRules.filter(r => r.includes("상태 보존") || r.includes("시공간 연결")).length;
  const locViol    = (softRules as string[]).filter((r: string) => r.includes("위치")).length;
  const injViol    = (softRules as string[]).filter((r: string) => r.includes("부상")).length;
  const quoteViol  = hardRules.filter(r => r.includes("따옴표")).length;
  const hookViol   = (softRules as string[]).filter((r: string) => r.includes("엔딩 훅")).length;
  const worldViol  = (softRules as string[]).filter((r: string) => r.includes("세계관")).length;

  const elapsed = Date.now() - t0;
  console.log(`${finalVerdict}(${finalScore}) POV${povViol} 상태${stateViol} 위치${locViol} 부상${injViol} 훅${hookViol} 세계관${worldViol} ${Math.round(elapsed/1000)}s`);

  return {
    case_id: tc.id, description: tc.description,
    difficulty: tc.difficulty, pov: cfg.pov,
    verdict: finalVerdict, score: finalScore,
    pov_violations: povViol, state_violations: stateViol,
    location_violations: locViol, injury_violations: injViol,
    quote_violations: quoteViol,
    hook_violations: hookViol, world_violations: worldViol,
    soft_warnings: softRules,
    elapsed_ms: elapsed,
  };
}

// ══════════════════════════════════════════════════════════════
// 배치 실행
// ══════════════════════════════════════════════════════════════
async function runBatch(variant: "A" | "B", cases: TestCase[]): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    results.push(await runCase(cases[i], variant, i + 1, cases.length));
  }
  return results;
}

// ══════════════════════════════════════════════════════════════
// 요약 통계
// ══════════════════════════════════════════════════════════════
function summarize(results: CaseResult[]) {
  const total = results.length;
  const pass  = results.filter(r => r.verdict === "PASS").length;
  const fail  = results.filter(r => r.verdict === "FAIL").length;
  const warn  = results.filter(r => r.verdict === "WARN").length;
  const avg   = Math.round(results.reduce((s, r) => s + r.score, 0) / total);

  const sumField = (f: keyof CaseResult) =>
    results.reduce((s, r) => s + (r[f] as number), 0);

  const byPov: Record<string, { pass: number; total: number }> = {};
  for (const r of results) {
    if (!byPov[r.pov]) byPov[r.pov] = { pass: 0, total: 0 };
    byPov[r.pov].total++;
    if (r.verdict === "PASS") byPov[r.pov].pass++;
  }

  return {
    total, pass, fail, warn, avg,
    pov_violations:      sumField("pov_violations"),
    state_violations:    sumField("state_violations"),
    location_violations: sumField("location_violations"),
    injury_violations:   sumField("injury_violations"),
    quote_violations:    sumField("quote_violations"),
    hook_violations:     sumField("hook_violations"),
    world_violations:    sumField("world_violations"),
    by_pov: byPov,
  };
}

// ══════════════════════════════════════════════════════════════
// 출력 포맷
// ══════════════════════════════════════════════════════════════
function printSummary(label: string, s: ReturnType<typeof summarize>, total: number) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📊 ${label} 결과 (${total}케이스)`);
  console.log(`${"═".repeat(60)}`);
  console.log(`avg: ${s.avg} | PASS: ${s.pass}(${Math.round(s.pass/total*100)}%) | FAIL: ${s.fail}(${Math.round(s.fail/total*100)}%) | WARN: ${s.warn}`);
  console.log(`\n[hook/world-rule 핵심 지표]`);
  console.log(`  엔딩 훅 약함(soft):     ${s.hook_violations}회 / ${total}케이스 (${(s.hook_violations/total).toFixed(2)}/케이스)`);
  console.log(`  세계관 미준수(soft):    ${s.world_violations}회 / ${total}케이스 (${(s.world_violations/total).toFixed(2)}/케이스)`);
  console.log(`\n[상태 보존 부작용 확인]`);
  console.log(`  POV위반(hard):          ${s.pov_violations}회 / ${total}케이스 (${(s.pov_violations/total).toFixed(2)}/케이스)`);
  console.log(`  상태 직접 모순(hard):   ${s.state_violations}회 / ${total}케이스 (${(s.state_violations/total).toFixed(2)}/케이스)`);
  console.log(`  위치 불일치(soft):      ${s.location_violations}회 / ${total}케이스 (${(s.location_violations/total).toFixed(2)}/케이스)`);
  console.log(`  부상 제약 미반영(soft): ${s.injury_violations}회 / ${total}케이스 (${(s.injury_violations/total).toFixed(2)}/케이스)`);
  console.log(`  따옴표 미닫힘(hard):    ${s.quote_violations}회 / ${total}케이스`);
  console.log(`\n[POV별]`);
  for (const [pov, stat] of Object.entries(s.by_pov)) {
    console.log(`  ${pov}: ${stat.pass}/${stat.total} (${Math.round(stat.pass/stat.total*100)}%)`);
  }
}

// ══════════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════════
await runMigrateV2();

const cases = AB_STATE_PERSISTENCE_CASES;
const timestamp = Date.now();

console.log("\n════════════════════════════════════════════════════════════");
console.log(`🔬 A/B hook/world-rule 개선 비교 실험 — ${new Date().toISOString()}`);
console.log(`   케이스: ${cases.length}개 고정 세트`);
console.log(`   A = current (state persistence A/B/C 유지, hook/world 현재 수준)`);
console.log(`   B = improved (A + 세계관 사건내작동 강화 + 엔딩훅 분위기묘사금지)`);
console.log("════════════════════════════════════════════════════════════\n");

// ── A 실행
console.log("▶ [A] current prompt 실행 중...\n");
const resultsA = await runBatch("A", cases);
const summaryA = summarize(resultsA);
printSummary("A (current)", summaryA, cases.length);

// ── B 실행
console.log("\n\n▶ [B] improved prompt 실행 중...\n");
const resultsB = await runBatch("B", cases);
const summaryB = summarize(resultsB);
printSummary("B (improved)", summaryB, cases.length);

// ── A vs B 비교
const n = cases.length;
console.log(`\n${"═".repeat(60)}`);
console.log(`📊 A vs B 비교 (같은 ${n}케이스)`);
console.log(`${"═".repeat(60)}`);
console.log(`avg:                  A=${summaryA.avg} → B=${summaryB.avg}  (${summaryB.avg >= summaryA.avg ? "✅" : "❌"})`);
console.log(`PASS율:               A=${Math.round(summaryA.pass/n*100)}% → B=${Math.round(summaryB.pass/n*100)}%`);
console.log(`FAIL율:               A=${Math.round(summaryA.fail/n*100)}% → B=${Math.round(summaryB.fail/n*100)}%`);
console.log(`\n[hook/world-rule 핵심]`);
console.log(`엔딩 훅 약함/케이스:   A=${(summaryA.hook_violations/n).toFixed(2)} → B=${(summaryB.hook_violations/n).toFixed(2)}  ${summaryB.hook_violations <= summaryA.hook_violations ? "✅" : "❌"}`);
console.log(`세계관 미준수/케이스:  A=${(summaryA.world_violations/n).toFixed(2)} → B=${(summaryB.world_violations/n).toFixed(2)}  ${summaryB.world_violations <= summaryA.world_violations ? "✅" : "❌"}`);
console.log(`\n[상태 보존 부작용]`);
console.log(`POV위반/케이스:        A=${(summaryA.pov_violations/n).toFixed(2)} → B=${(summaryB.pov_violations/n).toFixed(2)}  ${summaryB.pov_violations <= summaryA.pov_violations ? "✅" : "❌"}`);
console.log(`상태 모순/케이스:      A=${(summaryA.state_violations/n).toFixed(2)} → B=${(summaryB.state_violations/n).toFixed(2)}  ${summaryB.state_violations <= summaryA.state_violations ? "✅" : "❌"}`);
console.log(`위치 불일치/케이스:    A=${(summaryA.location_violations/n).toFixed(2)} → B=${(summaryB.location_violations/n).toFixed(2)}  ${summaryB.location_violations <= summaryA.location_violations ? "✅" : "❌"}`);
console.log(`부상 미반영/케이스:    A=${(summaryA.injury_violations/n).toFixed(2)} → B=${(summaryB.injury_violations/n).toFixed(2)}  ${summaryB.injury_violations <= summaryA.injury_violations ? "✅" : "❌"}`);
console.log(`따옴표 미닫힘:         A=${summaryA.quote_violations} → B=${summaryB.quote_violations}  ${summaryB.quote_violations <= summaryA.quote_violations ? "✅" : "❌"}`);

// ── 저장
const outDir = join(ROOT, "logs", "test_results");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `ab_hook_world_${timestamp}.json`);
writeFileSync(outPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  cases: cases.length,
  variant_A_desc: "state persistence A/B/C 유지, hook/world 현재 수준",
  variant_B_desc: "A + 세계관 사건내작동 강화 + 엔딩훅 분위기묘사금지 명시",
  summary_A: summaryA,
  summary_B: summaryB,
  results_A: resultsA,
  results_B: resultsB,
}, null, 2), "utf-8");

console.log(`\n💾 저장: ${outPath}`);

await pool.end();
