/**
 * state_extractor.ts — EffectiveContext에서 상태 제약을 결정론적으로 추출
 *
 * LLM을 사용하지 않는다.
 * EffectiveContext의 deterministic 데이터만 처리해 ScenePlan의 결정론적 필드를 채운다.
 *
 * 이 계층이 존재하는 이유:
 * - 위치/부상/소지품은 LLM 판단이 필요 없는 사실이다.
 * - LLM에게 이 사실을 "지시"하는 대신, 계획 단계에서 확정하면 Renderer가 따를 수밖에 없다.
 * - state persistence 문제의 근원을 프롬프트 지시 강화가 아닌 구조로 해결한다.
 */

import type { EffectiveContext, GenConfig, EpisodeCharBudget } from "../types/canonical.js";
import { resolveCharBudget } from "../types/canonical.js";
import type { ForbiddenAction, ItemConstraint } from "../types/planner.js";
import { variantCPovRule } from "../policies/pov_rules.js";

export type EpisodeRole = "intro" | "early" | "mid" | "late" | "pre-final" | "final";
export type ArcPhase = "intro" | "early" | "mid" | "late" | "pre_final" | "final" | "unknown";

export interface NarrativeContract {
  resolved_final: number;
  remaining_episodes: number;
  episode_role: EpisodeRole;
  arc_phase: ArcPhase;
  arc_ratio: number; // 0.0 ~ 1.0, 현재 화 / 최종화
}

export interface ExtractedStateConstraints {
  // ScenePlan deterministic fields
  opening_location: string;
  opening_time_context: string;
  forbidden_actions: ForbiddenAction[];
  must_keep_items: ItemConstraint[];
  pov_contract: string;
  tone_contract: string;
  target_length: number;
  ending_constraint: "cliff" | "final";

  // Story contract — planner + trace용
  char_budget: EpisodeCharBudget;
  absent_characters: string[];  // visibility_state가 "absent" 또는 "cannot_act"인 인물

  // Narrative contract — 연재 흐름 제약
  narrative_contract: NarrativeContract;

  // Rule / Intervention contract — 규칙/개입 제약
  absolute_forbidden: string[];
  episode_forbidden: string[];    // gen_config.forbidden_elements
  episode_required: string[];     // gen_config.required_elements
  active_intervention_instructions: string[];  // is_active인 AuthorIntervention의 instruction

  // Context for creative planner prompt
  char_summary: string;
  prev_event_summary: string;
  general_rules: string[];
  task_goal: string;
  ending_hook_direction: string;
}

// ── 부상 → 행동 제약 변환 ──────────────────────────────────────
function buildInjuryConstraint(physicalState: string): { forbidden: string; substitute: string } {
  const p = physicalState;
  if (p.includes("팔") || p.includes("손") || p.includes("어깨") || p.includes("손목")) {
    return {
      forbidden: "해당 팔로 물건 집기·들기·던지기·밀기 등 정상 사용",
      substitute: "고통 반응·반대 팔 사용·동작 회피를 묘사로 드러낸다",
    };
  }
  if (p.includes("다리") || p.includes("발") || p.includes("무릎") || p.includes("발목")) {
    return {
      forbidden: "해당 다리로 달리기·도약·차기",
      substitute: "절뚝임·지지대 사용·통증 묘사를 수반한다",
    };
  }
  if (p.includes("갈비뼈") || p.includes("갈비")) {
    return {
      forbidden: "격렬한 신체 활동",
      substitute: "호흡·이동 묘사 시 갈비뼈 통증을 드러낸다",
    };
  }
  if (p.includes("고갈") || p.includes("한계") || p.includes("임박")) {
    return {
      forbidden: "주력기·특수 능력 사용",
      substitute: "제약 상태임을 묘사·대사·인물 선택에서 드러낸다",
    };
  }
  return {
    forbidden: "해당 부위 정상 사용",
    substitute: "부상 부위의 제약 또는 고통을 행동 묘사에서 드러낸다",
  };
}

// ── 문체 계약 생성 ─────────────────────────────────────────────
function buildToneContract(cfg: GenConfig): string {
  const base = cfg.style === "간결/담백"
    ? "간결하고 사실 위주의 문장."
    : cfg.style === "서정/감성"
    ? "감성적 묘사와 내면 정서 중심."
    : cfg.style === "묘사풍부"
    ? "장면·감각·인물 내면을 구체적으로 묘사."
    : "묘사와 사건 전개의 균형.";

  const sliders = [
    cfg.conflict   >= 8 ? "갈등 격렬하게" : cfg.conflict   <= 3 ? "잔잔하게" : "",
    cfg.emotion    >= 8 ? "감정 묘사 깊게" : "",
    cfg.dialogue   >= 8 ? "대사 비중 높게" : cfg.dialogue   <= 3 ? "서술 위주" : "",
    cfg.direction  >= 8 ? "연출 강하게" : "",
  ].filter(Boolean).join(", ");

  return sliders ? `${base} 연출: ${sliders}.` : base;
}

// ── 메인 추출 함수 ─────────────────────────────────────────────
export function extractStateConstraints(ctx: EffectiveContext): ExtractedStateConstraints {
  const cfg  = ctx.gen_config;
  const prev = ctx.prev_episode_state;

  // opening location: 주인공 또는 첫 번째 인물의 현재 위치
  const primaryDyn = ctx.character_dynamic_states[0];
  const openingLoc =
    primaryDyn?.location ||
    Object.values(prev.current_locations)[0] ||
    "알 수 없음";

  // forbidden_actions: 부상 인물만 추출
  const forbidden_actions: ForbiddenAction[] = [];
  for (const s of ctx.character_dynamic_states) {
    const p = s.physical_state ?? "";
    if (!p || p === "정상" || p === "없음" || p === "양호") continue;
    const { forbidden, substitute } = buildInjuryConstraint(p);
    forbidden_actions.push({
      character_name: s.character_name,
      body_part: p,
      forbidden_description: forbidden,
      substitute_description: substitute,
    });
  }

  // must_keep_items: dynamic items 우선, 없으면 canonical initial_items 폴백
  const must_keep_items: ItemConstraint[] = [];
  for (const c of ctx.characters) {
    const dyn = ctx.character_dynamic_states.find(d => d.character_name === c.name);
    const entries = (dyn?.items?.length ?? 0) > 0
      ? dyn!.items!
      : (c.initial_items?.length ?? 0) > 0 ? c.initial_items! : [];
    for (const entry of entries) {
      const itemName = typeof entry === "string" ? entry : entry.name;
      must_keep_items.push({ character_name: c.name, item: itemName, must_persist: true });
    }
  }

  // char_budget: EpisodeCharBudget 계산
  const char_budget = resolveCharBudget(cfg);

  // absent_characters: visibility_state 기반 등장 불가 인물
  const absent_characters = ctx.character_dynamic_states
    .filter(d => d.visibility_state === "absent" || d.visibility_state === "cannot_act")
    .map(d => d.character_name);

  // char_summary: planner 프롬프트용 (emotional_state + visibility_state 포함)
  const char_summary = ctx.characters.map(c => {
    const dyn     = ctx.character_dynamic_states.find(d => d.character_name === c.name);
    const loc     = dyn?.location ?? "위치 불명";
    const state   = dyn?.physical_state ?? "정상";
    // dynamic items 우선, 없으면 canonical initial_items 폴백 (첫 화 또는 상태 미기록 시)
    const rawItems = (dyn?.items?.length ?? 0) > 0
      ? dyn!.items!
      : (c.initial_items?.length ?? 0) > 0 ? c.initial_items! : [];
    const items = rawItems.length > 0
      ? rawItems.map(i => typeof i === "string" ? i : (i.condition ? `${i.name}(${i.condition})` : i.name)).join(", ")
      : "없음";
    const goal    = dyn?.recent_goal ?? "";
    const emotion = dyn?.emotional_state;
    const vis     = dyn?.visibility_state;
    let line = `${c.name}(${c.gender}): 위치=${loc}, 상태=${state}, 소지품=${items}${goal ? `, 목표=${goal}` : ""}`;
    if (emotion) line += `, 감정=${emotion}`;
    if (vis && vis !== "present") line += `, 등장=${vis === "absent" ? "불가" : "행동불가"}`;
    return line;
  }).join("\n");

  // prev_event_summary
  const prev_event_summary = [
    prev.ending_event ? `직전 사건: ${prev.ending_event}` : "",
    prev.current_time ? `현재 시각: ${prev.current_time}` : "",
    prev.environment_changes.length ? `환경 변화: ${prev.environment_changes.join(", ")}` : "",
    prev.continuity_notes.length ? `연속성 주의: ${prev.continuity_notes.join(" / ")}` : "",
  ].filter(Boolean).join(" / ");

  // target_length: 중간값 사용
  const target_length = cfg.episodeLength + Math.round(cfg.episodeLengthVar / 2);

  // ending_constraint — resolved_final_episode 우선, 폴백은 totalEpisodes
  const resolvedFinal = cfg.resolved_final_episode ?? cfg.totalEpisodes;
  const ending_constraint: "cliff" | "final" =
    ctx.episode_number >= resolvedFinal ? "final" : "cliff";

  // narrative_contract: 연재 흐름 제약
  const remaining = resolvedFinal - ctx.episode_number;
  const arc_ratio = resolvedFinal > 0 ? ctx.episode_number / resolvedFinal : 0;
  const episode_role: EpisodeRole =
    ending_constraint === "final" ? "final"
    : remaining <= 1             ? "pre-final"
    : remaining <= 5             ? "late"
    : arc_ratio < 0.15           ? "intro"
    : arc_ratio < 0.35           ? "early"
    : "mid";
  const arc_phase: ArcPhase =
    resolvedFinal <= 0   ? "unknown"
    : arc_ratio < 0.15   ? "intro"
    : arc_ratio < 0.35   ? "early"
    : arc_ratio < 0.65   ? "mid"
    : arc_ratio < 0.85   ? "late"
    : arc_ratio < 0.97   ? "pre_final"
    : "final";

  // rule / intervention contract: 규칙/개입 제약
  const absolute_forbidden = ctx.absolute_forbidden ?? [];
  const episode_forbidden  = cfg.forbidden_elements ?? [];
  const episode_required   = cfg.required_elements  ?? [];
  const active_intervention_instructions = (ctx.active_interventions ?? [])
    .filter(i => i.is_active)
    .map(i => i.instruction);

  return {
    opening_location:      openingLoc,
    opening_time_context:  prev.current_time || "시간 미정",
    forbidden_actions,
    must_keep_items,
    pov_contract:          variantCPovRule(cfg.pov),
    tone_contract:         buildToneContract(cfg),
    target_length,
    ending_constraint,
    char_budget,
    absent_characters,
    narrative_contract: { resolved_final: resolvedFinal, remaining_episodes: remaining, episode_role, arc_phase, arc_ratio },
    absolute_forbidden,
    episode_forbidden,
    episode_required,
    active_intervention_instructions,
    char_summary,
    prev_event_summary,
    general_rules:         ctx.general_rules,
    task_goal:             ctx.task.goal,
    ending_hook_direction: ctx.task.ending_hook_direction ?? "",
  };
}
