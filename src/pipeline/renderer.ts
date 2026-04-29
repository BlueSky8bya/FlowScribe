/**
 * renderer.ts — ScenePlan → 소설 텍스트 렌더러
 *
 * 역할: Plan Validator를 통과한 ScenePlan을 받아 실제 소설 문장을 생성.
 *
 * Legacy buildGenPrompt와의 차이:
 *   - 상태 보존 지시가 "텍스트 규칙"이 아닌 "계획 구조"에서 나온다.
 *   - Renderer는 "어떻게 쓰는가(POV/문체/감정)"에만 집중한다.
 *   - "무엇이 일어나는가(비트 순서/hook 사건)"은 ScenePlan이 확정한다.
 *   - 상태 보존 책임은 Planner가 처리했으므로 Renderer가 중복 책임지지 않는다.
 *
 * 미지원 POV 정책: 1인칭 관찰자 포함 모든 POV에 대해 pov_contract를 그대로 사용.
 * 호출 지점에서 POV 지원 여부를 확인한다.
 */

import { getLLMClient, getRendererModel, getActiveProvider } from "../lib/llm.js";
import { logInfo } from "../lib/logger.js";
import type { EffectiveContext } from "../types/canonical.js";
import type { ScenePlan } from "../types/planner.js";

function buildRendererSystemPrompt(plan: ScenePlan, ctx: EffectiveContext): string {
  const ep        = ctx.episode_number;
  // Skill-like keywords — must NOT be treated as physical inventory items
  const SKILL_PATTERNS = /스킬|능력|마법|특성|고유|패시브|액티브|버프|디버프|효과|기술|술식/;
  const charList  = ctx.characters.map(c => {
    const dyn = ctx.character_dynamic_states.find(d => d.character_name === c.name);
    const dynItems: any[] = dyn?.items ?? [];
    const canonItems: any[] = c.initial_items ?? [];
    const rawItems: any[] = dynItems.length > 0 ? dynItems : canonItems;
    // filter out skill/ability entries — they are not physical items
    const items = rawItems.filter((i: any) => {
      const name = typeof i === "string" ? i : (i.name ?? "");
      return !SKILL_PATTERNS.test(name);
    });
    // canonical 이름 맵 (동적 이름과 canonical 이름이 다를 수 있는 경우 canonical 우선)
    const canonNameMap: Record<string, string> = {};
    for (const ci of canonItems) {
      if (ci?.name) canonNameMap[ci.name.toLowerCase()] = ci.name;
    }
    const itemStr = items.length > 0
      ? items.map((i: any) => {
          const rawName = typeof i === "string" ? i : (i.name ?? "");
          // canonical 이름이 있으면 그것을 사용 (이름 변형 방지)
          const canonName = canonNameMap[rawName.toLowerCase()] ?? rawName;
          const cond = typeof i === "string" ? null : (i.condition ?? null);
          return cond ? `${canonName}(상태: ${cond})` : canonName;
        }).join(", ")
      : "없음";
    return `${c.name}(${c.gender}, ${c.type}): ${c.personality} / 소지품: ${itemStr}`;
  }).join("\n");
  const charNames = ctx.characters.map(c => c.name).join(", ");

  // 주인공 탐지 — personality에 "주인공" 또는 type이 "주인공"인 첫 인물
  const protagonistChar = ctx.characters.find(c =>
    c.type === "주인공" || /주인공/.test(c.personality ?? "")
  );
  const protagonistDecl = protagonistChar
    ? `[★ 핵심 주인공: ${protagonistChar.name}] 이 이야기의 주인공은 반드시 ${protagonistChar.name}이다. 모든 화에서 ${protagonistChar.name}의 시선·감정·행동이 서사를 이끌어야 한다. ${protagonistChar.name} 이외의 인물이 주인공처럼 묘사되거나 그 시점으로 이야기가 전개되는 것은 절대 금지다.`
    : "";

  // 장면 비트
  const beatsText = plan.scene_beats
    .map(b => `  ${b.beat_number}. [${b.location}] ${b.summary} (등장: ${b.characters_involved.join(", ")})`)
    .join("\n");

  // 부상 제약 (depiction guidance)
  const injuryText = plan.forbidden_actions.length > 0
    ? plan.forbidden_actions
        .map(fa => `  ${fa.character_name}(${fa.body_part}): ${fa.forbidden_description}는 불가. → ${fa.substitute_description}`)
        .join("\n")
    : "  없음";

  // 소지품 유지
  const noItemChars = ctx.characters
    .filter(c => {
      const dyn = ctx.character_dynamic_states.find(d => d.character_name === c.name);
      const dynItems: any[] = dyn?.items ?? [];
      const items: any[] = dynItems.length > 0 ? dynItems : (c.initial_items ?? []);
      return items.length === 0;
    })
    .map(c => c.name);
  const itemText = plan.must_keep_items.length > 0
    ? plan.must_keep_items
        .map(i => `  ${i.character_name}: "${i.item}" 소지 유지`)
        .join("\n")
    : "  없음";
  const noItemText = noItemChars.length > 0
    ? `\n[소지품 없는 인물 — 즉흥 아이템 금지]\n  ${noItemChars.join(", ")}은(는) 현재 아무것도 소지하지 않는다.\n  이 장면에서 칼·방패·활·도구 등 어떤 장비도 꺼내거나 사용해서는 안 된다.\n  이 장면 내 획득 묘사가 있을 때만 소지 가능하다.`
    : "";

  // 직전 화 여파
  const carryoverText = plan.carryover_effects.length > 0
    ? plan.carryover_effects
        .map(e => `  ${e.character_name}: ${e.description}${e.must_appear_in_opening ? " [첫 단락 필수]" : ""}`)
        .join("\n")
    : "  없음";

  // 세계관 규칙 사건화
  const worldRuleText = plan.world_rule?.scene_usage
    ? `  규칙: "${plan.world_rule.rule_content}"\n  작동 방식: ${plan.world_rule.scene_usage}`
    : "  없음";

  // 직전 화 연속성 (ep >= 2)
  const prevTailSection = (ctx.episode_number >= 2 && ctx.prev_episode_tail)
    ? `\n[직전 화 말미 — 이 장면 직후부터 이번 화가 이어진다]\n${ctx.prev_episode_tail.slice(-500)}\n`
    : "";

  // 연속성 계약 (ep >= 2)
  const cc = ctx.continuity_contract;
  const continuitySection = cc && cc.forbidden_regressions.length
    ? `\n[연속성 — 퇴행 금지]\n` +
      cc.forbidden_regressions.map(r => `- ${r}`).join("\n") +
      (cc.known_facts.length
        ? `\n[이미 알려진 사실 — 대사·행동에서 인물들이 이미 아는 것으로 처리]\n` +
          cc.known_facts.slice(0, 8).map(f => `- ${f}`).join("\n")
        : "") + "\n"
    : "";

  // Episode Delta Contract (ep >= 2)
  const dc = ctx.episode_delta_contract;
  const deltaSection = dc && ctx.episode_number >= 2
    ? (() => {
        const lines: string[] = [
          `이번 화(${dc.episode_number}화)는 직전 화의 반복이 아니라 후속 결과여야 한다.`,
          `같은 사건을 재서술하지 말고 그 결과를 보여줄 것.`,
          `이미 끝난 행동을 다시 현재 진행으로 쓰지 말 것.`,
          `직전 화 요약을 본문에서 길게 반복하지 말 것.`,
        ];
        if (dc.must_not_repeat.length) {
          lines.push(
            `[반복 금지]\n` + dc.must_not_repeat.slice(0, 4).map(s => `- ${s}`).join("\n")
          );
        }
        if (dc.must_progress.length) {
          lines.push(
            `[반드시 진전]\n` + dc.must_progress.slice(0, 3).map(s => `- ${s}`).join("\n")
          );
        }
        if (dc.character_delta_requirements.length) {
          lines.push(
            `[인물 상태 변화 요구]\n` +
            dc.character_delta_requirements.slice(0, 4).map(c =>
              `- ${c.character_name}: 새 정보/새 선택/새 결과 중 하나가 반드시 있어야 함`
            ).join("\n")
          );
        }
        if (dc.repetition_risk.length) {
          lines.push(
            `[반복 위험 패턴 — 이번 화에서 핵심 장면으로 재사용 금지]\n` +
            dc.repetition_risk.map(r => `- ${r.pattern}`).join("\n")
          );
        }
        return `\n[Episode Delta Contract — 서술 준수]\n` + lines.join("\n") + "\n";
      })()
    : "";

  const isFinal = plan.ending_constraint !== "cliff";

  // 클리프 전용: 엔딩 훅
  const hookSection = isFinal ? "" : `
[엔딩 훅 — [CLIFF] 이후 2~4문장]
  유형: ${plan.hook_type}
  내용: ${plan.hook_payload}
  구체적 사건: ${plan.hook_concrete_event}
  주의: "어둠이 깔렸다" 같은 분위기 묘사만으로 끝내지 않는다. 위 구체적 사건을 반드시 포함한다.
`;

  // 최종화 전용: 결말 지시
  const finaleSection = !isFinal ? "" : `
[최종화 — 반드시 준수]
  이 화는 이야기의 완결편이다.
  - 모든 핵심 갈등이 이 화 안에서 해소되어야 한다
  - 미해결 상황·클리프행어·다음 화 암시는 절대 금지
  - 독자가 만족할 수 있는 완결된 결말을 써라
  - [CLIFF] 마커 사용 금지
`;

  return `[언어 절대 규칙 — 위반 시 출력 전체 무효]
이 출력은 처음부터 끝까지 100% 한국어여야 한다.
키릴 문자(러시아어 등), 아랍어, 일본어 가나, 중국어 한자(고유명사 제외), 기타 비한글 문자는 단 한 글자도 허용되지 않는다.
영어는 고유명사·브랜드명에 한해서만 허용되며, 일반 서술에 영어를 사용해서는 안 된다.

당신은 한국 소설 생성 AI다.
${protagonistDecl ? "\n" + protagonistDecl + "\n" : ""}${prevTailSection}${continuitySection}${deltaSection}
[시점 — 최우선 규칙]
${plan.pov_contract}

[★ 인물 이름 절대 규칙 — 위반 시 출력 전체 무효]
이 이야기에 등장하는 인물의 이름은 아래 목록이 전부다. 이 이름이 각 인물의 완전한 이름이다.
허용 이름 목록 (완전 목록, 추가·변형 불가): ${charNames}

규칙 (위반 = 치명적 오류):
1. 위 목록 외 다른 이름 형태는 이 이야기에 존재하지 않는다.
2. 위 목록의 이름은 이미 완전한 이름이다 — 접미사·확장형·긴 형태가 별도로 존재하지 않는다.
3. 조사 결합 시 이름 자체를 변형하지 않는다. (예: 이름+"가/를/는/이/와/과/로/의")
4. 목록에 없는 새 이름을 창작하지 않는다.

[등장인물]
${charList}

[장면 계획 — 이 순서로 서술한다]
${beatsText}

[시작 위치·시각 — 첫 단락에서 반영]
  시작 위치: ${plan.opening_location}
  시각: ${plan.opening_time_context}

[직전 화 여파 — 첫 단락에서 반영]
${carryoverText}

[부상 제약 — 행동 묘사에서 자연스럽게 드러낸다]
${injuryText}

[소지품 유지 — 이름 변경 금지]
  ※ 스킬·능력·마법·고유 특성은 소지품이 아니다. 소지품은 실제로 손에 들거나 가방에 있는 물리적 아이템만 해당한다.
  ※ 위 [등장인물]에 명시된 소지품 이름을 그대로 사용한다. 축약·개명·확장 금지.
  ※ 예: "고성능 손전등"은 "손전등"으로 줄이지 않는다. 방전·파손 같은 상태 변화는 이름 뒤에 괄호로 표시한다.
  ※ 서술 속에서 소지품 상태가 변해도 이름 자체는 절대 바꾸지 않는다 — 상태는 묘사(방전되었다, 파손되었다)로 처리한다.
  ※ 그 외 장비는 즉흥으로 추가하지 않는다.
  ※ 스킬·능력·특성·패시브는 절대 소지품처럼 묘사하지 않는다.
${itemText}${noItemText}

[세계관 규칙 — 아래 방식으로 장면 내에서 실제로 작동해야 한다]
${worldRuleText}
${hookSection}${finaleSection}
[문체·분량]
  ${plan.tone_contract}
  목표 분량: ${plan.target_length}자 내외

[대화 따옴표]
  모든 대사: "로 열고 "로 닫는다. 미닫힘은 심각한 오류.

[출력 규칙]
- 화 제목: "# ${ep}화 - 제목" 형식으로 첫 줄
- 본문만 출력. 설명·주석·JSON 절대 금지
- 반드시 완결된 문장으로 끝낼 것
${isFinal
  ? "- [END]로 끝낸다. [CLIFF] 금지."
  : "- 비최종화: 본문 완성 후 [CLIFF] 단독 줄 → 클리프행어 2~4문장 → [END]\n  클리프행어: 위 hook_concrete_event 사건을 구체적 묘사로 서술한다."}
- 출력은 100% 한국어`;
}

export interface RenderResult {
  text: string;
  system_prompt: string;
  user_prompt: string;
  model_used: string;
  elapsed_ms: number;
}

export async function renderFromPlan(
  plan: ScenePlan,
  ctx: EffectiveContext,
  modelOverride?: string,
): Promise<string> {
  return (await renderFromPlanWithTrace(plan, ctx, modelOverride)).text;
}

export async function renderFromPlanWithTrace(
  plan: ScenePlan,
  ctx: EffectiveContext,
  modelOverride?: string,
): Promise<RenderResult> {
  const llm    = getLLMClient();
  const model  = modelOverride ?? getRendererModel();
  const maxTok = Math.max(2048, Math.ceil(plan.target_length * 0.65 * 1.8) + 500);

  logInfo("pipeline:renderer", "렌더링 시작", {
    episode: ctx.episode_number, model, target_length: plan.target_length,
  });

  const extraOptions = getActiveProvider() === "ollama"
    ? { options: { num_ctx: 8192 } }
    : {};

  const systemPrompt = buildRendererSystemPrompt(plan, ctx);
  const userPrompt   = `${ctx.episode_number}화를 ${ctx.gen_config.pov} 시점으로 생성해줘.`;

  const t0  = Date.now();
  const res = await (llm.chat.completions.create as any)({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
    temperature: 0.85,
    max_tokens: maxTok,
    stop: ["[END]"],
    ...extraOptions,
  });

  return {
    text:          res.choices?.[0]?.message?.content ?? "",
    system_prompt: systemPrompt,
    user_prompt:   userPrompt,
    model_used:    model,
    elapsed_ms:    Date.now() - t0,
  };
}
