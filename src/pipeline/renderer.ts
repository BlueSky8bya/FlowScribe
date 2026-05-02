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
import { resolveTaskRoute, runLLMTask } from "../services/model_router.js";
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

  // ── 절대 규칙 (Phase 4.19) ─────────────────────────────────────
  // 사용자가 "절대"로 마킹한 항목 — 부정형/긍정형 모두 본문 서술에서 그대로 준수.
  // planner system prompt에도 들어가지만, renderer가 본문을 직접 쓰므로 여기서도 노출한다.
  const absoluteRulesSection = (ctx.absolute_forbidden && ctx.absolute_forbidden.length > 0)
    ? `\n[★ 절대 규칙 — 본문 서술에서 반드시 준수]\n` +
      `각 항목의 자연어 의미 그대로. 부정형은 일어나지 않게, 긍정형/전제는 ${ctx.episode_number === 1 ? "1화 본문 안에서 명시적으로 그려지게" : "이미 일어난 사건으로 전제되게"}. 규칙 문장을 그대로 옮기지 말고 행동·묘사·대사로 반영.\n` +
      ctx.absolute_forbidden.map((r, i) => `${i + 1}. ${r}`).join("\n") + "\n"
    : "";

  // 직전 화 연속성 (ep >= 2)
  const prevTailSection = (ctx.episode_number >= 2 && ctx.prev_episode_tail)
    ? `\n[직전 화 말미 — 이 장면 직후부터 이번 화가 이어진다]\n${ctx.prev_episode_tail.slice(-500)}\n` +
      `[장면 전환] 다른 장소·상황에서 시작하면 1~2문장으로 자연스럽게 이어준다 (3문장 이상 설명은 피한다).\n`
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
          `이번 화(${dc.episode_number}화)는 직전 화의 후속 결과다 — 같은 사건을 재서술하지 말고 그 결과를 보여준다. 직전 화 요약은 본문에서 짧게.`,
        ];
        if (dc.must_not_repeat.length) {
          lines.push(
            `[반복 변주 — 다음을 핵심으로 다시 다루지 않는다]\n` + dc.must_not_repeat.slice(0, 6).map(s => `- ${s}`).join("\n")
          );
          // 감정 루프 억제 — 1줄로 압축
          lines.push(
            `[감정 진전] 같은 감정이 유지되어도 새 선택·행동·충돌·발견 중 하나로 이어진다. "두려워했다"로 멈추지 말고 "그 두려움에 이끌려 ○○했다"로 진전.`
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

  // 이전 화 제목 — 동일·유사 제목 재선택 방지 (구조적, 책 무관 일반 메커니즘)
  const prevTitlesSection = (ctx.prev_episode_titles && ctx.prev_episode_titles.length > 0)
    ? `\n[이전 화 제목 — 이번 화 제목으로 재사용·유사 변형 금지]\n` +
      ctx.prev_episode_titles.map(t => `- ${t}`).join("\n") +
      `\n  이번 ${ep}화 제목은 위 목록과 의미·핵심 단어가 겹치지 않게 새로 짓는다. 이번 화의 핵심 사건/전환을 반영할 것.\n`
    : "";

  return `[언어] 100% 한국어. 비한글 문자(키릴·아랍·가나·한자 등) 사용 안 함 (고유명사 제외). 영어는 고유명사·브랜드명만 허용.

당신은 한국 소설 생성 AI다.
${protagonistDecl ? "\n" + protagonistDecl + "\n" : ""}${absoluteRulesSection}${prevTailSection}${continuitySection}${deltaSection}
[시점 — 최우선 규칙]
${plan.pov_contract}

[★ 인물 이름]
허용 목록 (이게 완전한 이름, 추가·변형 안 함): ${charNames}
조사 결합 시 이름 자체는 변형 안 한다(이름+"가/를/는/이/와/과/로/의"). 목록 외 새 이름 창작 안 한다.

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

[소지품]
  소지품은 실제 물리적 아이템만 (스킬·능력·마법·특성은 제외). 위 [등장인물]의 소지품 이름을 그대로 사용한다 — 축약·개명·확장 안 함.
  상태 변화는 묘사(방전되었다·파손되었다)로 표현하고 이름은 변형 안 한다. 그 외 장비를 즉흥으로 추가하지 않는다.
${itemText}${noItemText}

[세계관 규칙 — 아래 방식으로 장면 내에서 실제로 작동해야 한다]
${worldRuleText}
${hookSection}${finaleSection}
[문체·분량]
  ${plan.tone_contract}
  목표 분량: ${plan.target_length}자 내외

[★ R5B-1.8 감정 납득성 — 사건이 만드는 감정 흐름]
  - 인물의 감정은 단어("불안했다"·"긴장했다"·"경계했다")로 직접 설명하지 말고 행동·대사·선택·시선·호흡·작은 동작으로 드러낸다.
  - 같은 감정이 여러 화에 걸쳐 유지되는 것은 자연스럽다. 인물 상황과 사건이 그렇게 만들었으면 무리하게 다른 감정으로 갈아끼우지 말 것.
  - 단, 같은 감정이 유지되더라도 그 감정이 "행동에 미치는 양상" — 행동 방식·말투·선택·거리감·질문 방식 중 하나는 달라져야 한다.
    · 나쁨: "그는 여전히 불안했다." (감정 라벨 박기·반복)
    · 좋음: "그는 손끝의 떨림을 거두지 않았지만, 이번에는 물러서지 않았다. 빛이 사라진 바닥을 먼저 가리켰다." (같은 불안 → 다른 대응)
  - 감정 라벨을 본문에 직접 박지 말 것 — 독자가 행동·대사에서 추론하게 한다.
  - 감정군이 바뀔 때(예: 불안 → 분노)는 본문에 그 변화를 만든 사건·정보·관계 변화가 반드시 드러나야 한다 — 사건 없는 감정 점프는 부자연스럽다.
  - character_emotional_beats(있으면)의 cause / goal_delta / behavior_delta / relationship_delta / decision_delta / consequence_delta가 본문 행동·대사·결정·관계로 실제 구현되어야 한다 — 단어로 해설하지 말고 장면으로.

[대화 따옴표]
  모든 대사: "로 열고 "로 닫는다. 미닫힘은 심각한 오류.

${prevTitlesSection}[출력 규칙]
- 화 제목: "# ${ep}화 - 제목" 형식으로 첫 줄. ${ctx.prev_episode_titles && ctx.prev_episode_titles.length > 0 ? "위 [이전 화 제목] 목록과 동일·유사 금지 (의미·키워드 겹침 금지)." : ""}
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
  provider: string;        // R5B-4d — 실제 호출된 provider
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
  routeSetOverride?: string,
  onChunk?: (delta: string) => void,
  temperatureOverride?: number,  // Phase 4.20 R5A-C — Fix F: foreign retry용 강제 temp
  extraSystem?: string,          // R5B-3.5: retry 시 system prompt 끝에 추가할 instruction
): Promise<RenderResult> {
  const maxTok = Math.max(2048, Math.ceil(plan.target_length * 0.65 * 1.8) + 500);
  const baseSystemPrompt = buildRendererSystemPrompt(plan, ctx);
  const systemPrompt = extraSystem ? `${baseSystemPrompt}\n\n${extraSystem}` : baseSystemPrompt;
  const userPrompt   = `${ctx.episode_number}화를 ${ctx.gen_config.pov} 시점으로 생성해줘.`;

  // Phase 4.13/4.14 — config 라우트가 renderer에 다른 provider/model을 지정하면 router 사용.
  // routeSetOverride가 있으면 우선 적용. 그렇지 않으면 legacy path.
  const route = resolveTaskRoute("renderer", routeSetOverride);
  const useRouter = !modelOverride
    && route
    && (route.provider !== getActiveProvider() || route.model !== getRendererModel());

  const t0 = Date.now();
  const model = modelOverride ?? (useRouter ? route!.model : getRendererModel());
  const provider = useRouter ? route!.provider : getActiveProvider();

  logInfo("pipeline:renderer", "렌더링 시작", {
    episode: ctx.episode_number,
    model,
    provider,
    target_length: plan.target_length,
    via: useRouter ? "router" : "legacy",
    streaming: !!onChunk,
  });

  // Phase 4.18 — 재생성 시 prose-level 다양성도 약하게 강화.
  // Phase 4.20 R5A-C — Fix D: cap 0.95 → 0.90. 한국어 본문이 OOD 영역에 빠지지 않도록.
  //   기존: min(0.95, 0.85 + attempt*0.025) → attempt 4+ = 0.95
  //   신규: min(0.90, 0.85 + min(attempt,3)*0.017) → attempt 3+ = 0.90
  const _regenContract = (ctx as any).regen_divergence_contract as
    | import("../types/canonical.js").RegenerationDivergenceContract
    | undefined;
  const _temperatureRendererBase = _regenContract
    ? Math.min(0.90, 0.85 + Math.min(_regenContract.attempt_count, 3) * 0.017)
    : 0.85;
  // temperatureOverride가 지정되면 base 무시 (Fix F retry 경로)
  const _temperatureRenderer = typeof temperatureOverride === "number"
    ? temperatureOverride
    : _temperatureRendererBase;

  let text: string;
  if (useRouter) {
    const r = await runLLMTask("renderer", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      route_set_override: routeSetOverride,
      temperature: _temperatureRenderer,
      max_tokens: maxTok,
      ...(onChunk ? { onChunk } : {}),
    });
    text = r.text;
  } else {
    const llm = getLLMClient();
    const extraOptions = getActiveProvider() === "ollama"
      ? { options: { num_ctx: 8192 } }
      : {};
    if (onChunk) {
      // Phase 4.20 R5A — legacy path streaming (Ollama 등)
      const stream: any = await (llm.chat.completions.create as any)({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        temperature: _temperatureRenderer,
        max_tokens: maxTok,
        stop: ["[END]"],
        stream: true,
        ...extraOptions,
      });
      let buffer = "";
      for await (const chunk of stream) {
        const delta = chunk?.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          buffer += delta;
          try { onChunk(delta); } catch { /* sink */ }
        }
      }
      text = buffer;
    } else {
      const res = await (llm.chat.completions.create as any)({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        temperature: _temperatureRenderer,
        max_tokens: maxTok,
        stop: ["[END]"],
        ...extraOptions,
      });
      text = res.choices?.[0]?.message?.content ?? "";
    }
  }

  return {
    text,
    system_prompt: systemPrompt,
    user_prompt:   userPrompt,
    model_used:    model,
    provider,
    elapsed_ms:    Date.now() - t0,
  };
}
