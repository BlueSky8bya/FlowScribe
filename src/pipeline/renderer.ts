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

import { getLLMClient, getStoryModel } from "../lib/llm.js";
import { logInfo } from "../lib/logger.js";
import type { EffectiveContext } from "../types/canonical.js";
import type { ScenePlan } from "../types/planner.js";

function buildRendererSystemPrompt(plan: ScenePlan, ctx: EffectiveContext): string {
  const ep        = ctx.episode_number;
  const charList  = ctx.characters.map(c => `${c.name}(${c.gender}, ${c.type}): ${c.personality}`).join("\n");
  const charNames = ctx.characters.map(c => c.name).join(", ");

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
  const itemText = plan.must_keep_items.length > 0
    ? plan.must_keep_items
        .map(i => `  ${i.character_name}: "${i.item}" 소지 유지`)
        .join("\n")
    : "  없음";

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

  // 엔딩 훅
  const hookText = [
    `  유형: ${plan.hook_type}`,
    `  내용: ${plan.hook_payload}`,
    `  구체적 사건: ${plan.hook_concrete_event}`,
  ].join("\n");

  return `당신은 한국 소설 생성 AI다.

[시점 — 최우선 규칙]
${plan.pov_contract}

[등장인물]
${charList}
허용 이름: ${charNames}
이름 표기: 위 이름을 정확히 유지. 변형·혼용 금지. 조사 붙일 때 이름 자체 변형 금지.

[장면 계획 — 이 순서로 서술한다]
${beatsText}

[시작 위치·시각 — 첫 단락에서 반영]
  시작 위치: ${plan.opening_location}
  시각: ${plan.opening_time_context}

[직전 화 여파 — 첫 단락에서 반영]
${carryoverText}

[부상 제약 — 행동 묘사에서 자연스럽게 드러낸다]
${injuryText}

[소지품 유지]
${itemText}

[세계관 규칙 — 아래 방식으로 장면 내에서 실제로 작동해야 한다]
${worldRuleText}

[엔딩 훅 — [CLIFF] 이후 2~4문장]
${hookText}
  주의: "어둠이 깔렸다" 같은 분위기 묘사만으로 끝내지 않는다. 위 구체적 사건을 반드시 포함한다.

[문체·분량]
  ${plan.tone_contract}
  목표 분량: ${plan.target_length}자 내외

[대화 따옴표]
  모든 대사: "로 열고 "로 닫는다. 미닫힘은 심각한 오류.

[출력 규칙]
- 화 제목: "# ${ep}화 - 제목" 형식으로 첫 줄
- 본문만 출력. 설명·주석·JSON 절대 금지
- 반드시 완결된 문장으로 끝낼 것
${plan.ending_constraint === "cliff"
  ? "- 비최종화: 본문 완성 후 [CLIFF] 단독 줄 → 클리프행어 2~4문장 → [END]\n  클리프행어: 위 hook_concrete_event 사건을 구체적 묘사로 서술한다."
  : "- 최종화: 완전한 결말, [END]로 끝"}
- 출력은 100% 한국어`;
}

export async function renderFromPlan(
  plan: ScenePlan,
  ctx: EffectiveContext,
): Promise<string> {
  const llm    = getLLMClient();
  const model  = getStoryModel();
  const maxTok = Math.ceil(plan.target_length * 0.65 * 1.5) + 400;

  logInfo("pipeline:renderer", "렌더링 시작", {
    episode: ctx.episode_number, model, target_length: plan.target_length,
  });

  const res = await (llm.chat.completions.create as any)({
    model,
    messages: [
      { role: "system", content: buildRendererSystemPrompt(plan, ctx) },
      { role: "user",   content: `${ctx.episode_number}화를 ${ctx.gen_config.pov} 시점으로 생성해줘.` },
    ],
    temperature: 0.85,
    max_tokens: maxTok,
  });

  return res.choices?.[0]?.message?.content ?? "";
}
