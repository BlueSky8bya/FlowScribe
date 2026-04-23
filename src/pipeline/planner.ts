/**
 * planner.ts — LLM 창의적 장면 계획 생성기
 *
 * 역할: StateExtractor가 확정한 결정론적 제약 위에서,
 * LLM이 "무슨 일이 어떻게 벌어지는가"만 계획한다.
 *
 * LLM 담당:
 *   - scene_beats (2~4개 장면 비트 순서)
 *   - world_rule (어떤 세계관 규칙이 어떻게 사건화)
 *   - carryover_effects (직전 화 여파의 구체적 묘사 방향)
 *   - hook_type + hook_payload + hook_concrete_event
 *
 * LLM 미담당 (StateExtractor 확정):
 *   - 인물 위치·부상·소지품·POV·분량
 *
 * 파싱 실패 시: 결정론적 fallback 계획으로 대체 (파이프라인 계속 진행).
 */

import { getLLMClient, getStoryModel } from "../lib/llm.js";
import { logInfo, logWarn } from "../lib/logger.js";
import type { EffectiveContext } from "../types/canonical.js";
import type {
  CreativePlan, CarryoverEffect, WorldRuleActivation, SceneBeat, HookType,
} from "../types/planner.js";
import type { ExtractedStateConstraints } from "./state_extractor.js";

// ══════════════════════════════════════════════════════════════
// Planner 프롬프트 조립
// ══════════════════════════════════════════════════════════════
function buildPlannerSystemPrompt(): string {
  return `당신은 소설 장면 설계자다. 소설 본문을 쓰지 않는다. JSON 계획만 출력한다.

아래 JSON 형식만 출력한다 (다른 텍스트 없이):
{
  "carryover_effects": [
    {"character_name": "인물명", "description": "이번 화 첫 단락에서 드러나야 할 직전 사건의 여파", "must_appear_in_opening": true}
  ],
  "world_rule": {
    "rule_content": "활용할 세계관 규칙 원문",
    "activation_type": "constraint",
    "scene_usage": "이 규칙이 이번 화에서 어떤 상황에서 인물의 행동·선택에 실제로 영향을 미치는지"
  },
  "scene_beats": [
    {"beat_number": 1, "summary": "장면 비트 요약", "characters_involved": ["인물명"], "location": "장소"}
  ],
  "hook_type": "immediate_threat",
  "hook_payload": "훅의 내용 요약 (1~2문장)",
  "hook_concrete_event": "마지막 2~4문장에서 실제로 일어날 구체적 사건 묘사"
}

규칙:
- scene_beats는 2~4개. 각 비트는 인물 행동·사건이 명확해야 한다.
- world_rule.activation_type은 "constraint"(행동 제약) / "conflict_cause"(갈등 원인) / "resolution_means"(해결 수단) 중 하나.
- world_rule.scene_usage는 "이 규칙 때문에 ~가 ~할 수 없다/해야 한다" 형식.
- hook_concrete_event는 분위기 묘사("어둠이 깔렸다" 등)가 아닌 실제 인물 행동·사건이어야 한다.
- JSON만 출력. 앞뒤 설명 없음.`;
}

function buildPlannerUserPrompt(
  ctx: EffectiveContext,
  sc: ExtractedStateConstraints,
): string {
  const rulesText = sc.general_rules.length > 0
    ? sc.general_rules.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "없음";

  const foreshadows = ctx.foreshadow_memory.map(f => `- ${f.content}`).join("\n") || "없음";
  const requiredEvents = ctx.task.required_events?.join(", ") || "없음";
  const hookDir = sc.ending_hook_direction || "자유";

  return `[${ctx.episode_number}화]
[목표] ${sc.task_goal}
[필수 사건] ${requiredEvents}
[엔딩 훅 방향] ${hookDir}

[인물 현재 상태]
${sc.char_summary}

[직전 화 여파]
${sc.prev_event_summary}

[세계관 규칙]
${rulesText}

[미회수 복선]
${foreshadows}

위 정보를 바탕으로 장면 계획 JSON을 출력해라.`;
}

// ══════════════════════════════════════════════════════════════
// JSON 파싱 복구 전략
// ══════════════════════════════════════════════════════════════
function parseCreativePlan(raw: string): CreativePlan | null {
  // 1. 직접 파싱
  try {
    const parsed = JSON.parse(raw.trim());
    if (parsed.scene_beats && parsed.hook_type) return parsed as CreativePlan;
  } catch {}

  // 2. ```json ... ``` 블록 추출
  const jsonBlock = raw.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlock) {
    try {
      const parsed = JSON.parse(jsonBlock[1].trim());
      if (parsed.scene_beats && parsed.hook_type) return parsed as CreativePlan;
    } catch {}
  }

  // 3. 첫 { ... } 추출
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (parsed.scene_beats && parsed.hook_type) return parsed as CreativePlan;
    } catch {}
  }

  return null;
}

// ══════════════════════════════════════════════════════════════
// 결정론적 fallback — LLM 실패 시 최소 계획 생성
// ══════════════════════════════════════════════════════════════
function buildFallbackPlan(
  ctx: EffectiveContext,
  sc: ExtractedStateConstraints,
): CreativePlan {
  const rule = sc.general_rules[0] ?? "세계관 규칙 없음";
  const prevEnding = ctx.prev_episode_state.ending_event;
  const chars = ctx.characters.map(c => c.name);

  const carryover: CarryoverEffect[] = prevEnding
    ? [{
        character_name: chars[0] ?? "주인공",
        description: `직전 사건(${prevEnding.slice(0, 40)})의 긴장감·여파가 이번 화 첫 행동에서 이어진다`,
        must_appear_in_opening: true,
      }]
    : [];

  const worldRule: WorldRuleActivation = {
    rule_content: rule,
    activation_type: "constraint",
    scene_usage: `"${rule}" 규칙이 이번 화에서 인물의 행동 선택지를 제한하는 상황이 발생한다`,
  };

  const beats: SceneBeat[] = [
    {
      beat_number: 1,
      summary: `인물들이 ${sc.opening_location}에서 ${ctx.task.goal}을 위해 움직이기 시작한다`,
      characters_involved: chars,
      location: sc.opening_location,
    },
    {
      beat_number: 2,
      summary: ctx.task.required_events?.[0]
        ? `${ctx.task.required_events[0]} 사건이 발생한다`
        : "상황이 복잡해지며 갈등이 고조된다",
      characters_involved: chars,
      location: sc.opening_location,
    },
  ];

  const hookDir = sc.ending_hook_direction;
  return {
    carryover_effects: carryover,
    world_rule: worldRule,
    scene_beats: beats,
    hook_type: "unresolved_situation" as HookType,
    hook_payload: hookDir || "다음 화로 이어지는 미해결 상황이 발생한다",
    hook_concrete_event: hookDir
      ? `${hookDir} 상황이 마지막 장면에서 구체적으로 드러난다`
      : "예상치 못한 발견이나 위협이 발생해 독자를 다음 화로 끌어당긴다",
  };
}

// ══════════════════════════════════════════════════════════════
// 메인 함수
// ══════════════════════════════════════════════════════════════
export async function runCreativePlanner(
  ctx: EffectiveContext,
  sc: ExtractedStateConstraints,
): Promise<{ plan: CreativePlan; fallback_used: boolean }> {
  const llm   = getLLMClient();
  const model = getStoryModel();

  logInfo("pipeline:planner", "창의적 장면 계획 생성", {
    episode: ctx.episode_number, model,
  });

  try {
    const res = await (llm.chat.completions.create as any)({
      model,
      messages: [
        { role: "system", content: buildPlannerSystemPrompt() },
        { role: "user",   content: buildPlannerUserPrompt(ctx, sc) },
      ],
      temperature: 0.4,    // 구조적 JSON 출력을 위해 낮춤
      max_tokens: 1000,
    });

    const raw = res.choices?.[0]?.message?.content ?? "";
    const parsed = parseCreativePlan(raw);

    if (parsed) {
      logInfo("pipeline:planner", "플래너 JSON 파싱 성공");
      return { plan: parsed, fallback_used: false };
    }

    logWarn("pipeline:planner", "JSON 파싱 실패 — fallback 사용", {
      raw_preview: raw.slice(0, 200),
    });
    return { plan: buildFallbackPlan(ctx, sc), fallback_used: true };

  } catch (err) {
    logWarn("pipeline:planner", "플래너 LLM 오류 — fallback 사용", { error: String(err) });
    return { plan: buildFallbackPlan(ctx, sc), fallback_used: true };
  }
}
