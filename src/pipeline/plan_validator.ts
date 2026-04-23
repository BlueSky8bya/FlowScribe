/**
 * plan_validator.ts — ScenePlan 구조 검증기 (결정론적, LLM 사용 안 함)
 *
 * 역할: 생성된 ScenePlan이 논리·구조적으로 타당한지 검사.
 *   - 문학적 취향 평가가 아니라 논리/구조 검사다.
 *   - EffectiveContext와 ScenePlan의 일관성을 확인한다.
 *   - 자동 보정 가능한 minor 이슈는 plan을 수정 후 WARN으로 처리한다.
 *
 * 검사 항목:
 *   1. opening_location 존재
 *   2. 직전 화 여파 반영 여부
 *   3. 부상 인물의 forbidden_actions 존재 여부
 *   4. 소지품 지속성 계획 (minor)
 *   5. 세계관 규칙 사건화 계획 존재
 *   6. hook 유효성 (type + payload + concrete_event)
 *   7. scene_beats 최소 2개
 *   8. pov_contract 존재
 */

import type { ScenePlan, PlanValidationResult, PlanVerdict, PlanIssue, CarryoverEffect, WorldRuleActivation } from "../types/planner.js";
import type { EffectiveContext } from "../types/canonical.js";

const VALID_HOOK_TYPES = new Set([
  "immediate_threat", "unexpected_discovery", "new_problem", "unresolved_situation",
]);

export function validatePlan(plan: ScenePlan, ctx: EffectiveContext): PlanValidationResult {
  const issues: PlanIssue[] = [];
  const passed: string[] = [];

  // 1. opening_location 존재
  if (!plan.opening_location || plan.opening_location.trim() === "") {
    issues.push({
      field: "opening_location",
      severity: "critical",
      description: "시작 위치가 비어 있음. 인물 동적 상태에서 위치를 확인할 수 없음.",
    });
  } else {
    passed.push(`opening_location: "${plan.opening_location}"`);
  }

  // 2. 직전 화 여파 반영
  const hasPrevEvent = !!ctx.prev_episode_state.ending_event;
  if (hasPrevEvent && plan.carryover_effects.length === 0) {
    issues.push({
      field: "carryover_effects",
      severity: "major",
      description: `직전 화 사건("${ctx.prev_episode_state.ending_event.slice(0, 40)}")이 있으나 여파 계획이 없음`,
    });
  } else {
    passed.push(`carryover_effects: ${plan.carryover_effects.length}개`);
  }

  // 3. 부상 인물의 forbidden_actions 포함 여부
  const injuredChars = ctx.character_dynamic_states.filter(s => {
    const p = s.physical_state ?? "";
    return p && p !== "정상" && p !== "없음" && p !== "양호";
  });
  for (const injured of injuredChars) {
    const hasFa = plan.forbidden_actions.some(fa => fa.character_name === injured.character_name);
    if (!hasFa) {
      issues.push({
        field: `forbidden_actions[${injured.character_name}]`,
        severity: "major",
        description: `부상 인물 ${injured.character_name}(${injured.physical_state})의 행동 제약이 계획에 없음`,
      });
    } else {
      passed.push(`${injured.character_name} 부상 제약 존재`);
    }
  }

  // 4. 소지품 지속성 (minor — 자동 보정하지 않고 WARN만)
  const charsWithItems = ctx.character_dynamic_states.filter(s => (s.items?.length ?? 0) > 0);
  const coveredItems   = new Set(plan.must_keep_items.map(i => `${i.character_name}:${i.item}`));
  let uncoveredCount   = 0;
  for (const c of charsWithItems) {
    for (const item of c.items ?? []) {
      if (!coveredItems.has(`${c.character_name}:${item}`)) uncoveredCount++;
    }
  }
  if (uncoveredCount > 0) {
    issues.push({
      field: "must_keep_items",
      severity: "minor",
      description: `${uncoveredCount}개 소지품이 지속성 계획에서 누락됨 (렌더러에서 tone_contract로 보완)`,
    });
  } else if (charsWithItems.length > 0) {
    passed.push(`must_keep_items: ${plan.must_keep_items.length}개`);
  }

  // 5. 세계관 규칙 사건화 존재
  const hasWorldRule =
    !!plan.world_rule?.rule_content?.trim() &&
    !!plan.world_rule?.scene_usage?.trim();
  if (!hasWorldRule) {
    issues.push({
      field: "world_rule",
      severity: "major",
      description: "세계관 규칙 사건화 계획이 없음. world_rule.scene_usage가 비어 있음.",
    });
  } else {
    passed.push(`world_rule: "${plan.world_rule.activation_type}" — ${plan.world_rule.scene_usage.slice(0, 40)}...`);
  }

  // 6. hook 유효성
  if (!VALID_HOOK_TYPES.has(plan.hook_type)) {
    issues.push({
      field: "hook_type",
      severity: "major",
      description: `hook_type "${plan.hook_type}"은 유효하지 않음. 유효값: ${[...VALID_HOOK_TYPES].join("|")}`,
    });
  } else {
    passed.push(`hook_type: ${plan.hook_type}`);
  }

  if (!plan.hook_payload || plan.hook_payload.trim().length < 5) {
    issues.push({
      field: "hook_payload",
      severity: "major",
      description: "hook_payload가 비어 있거나 너무 짧음 (최소 5자)",
    });
  } else {
    passed.push("hook_payload 존재");
  }

  if (!plan.hook_concrete_event || plan.hook_concrete_event.trim().length < 10) {
    issues.push({
      field: "hook_concrete_event",
      severity: "major",
      description: "hook_concrete_event가 없거나 너무 짧음. 구체적 사건 묘사 필요 (최소 10자)",
    });
  } else {
    passed.push("hook_concrete_event 존재");
  }

  // hook 세 항목이 모두 통과했을 때 집계 마커 — reward_aggregator가 이 값으로 hook_concreteness 판단
  const hookIssueFields = new Set(issues.filter(i => ["hook_type", "hook_payload", "hook_concrete_event"].includes(i.field)).map(i => i.field));
  if (hookIssueFields.size === 0 && VALID_HOOK_TYPES.has(plan.hook_type)) {
    passed.push("hook_complete");
  }

  // 7. scene_beats 최소 2개
  if (!plan.scene_beats || plan.scene_beats.length < 2) {
    issues.push({
      field: "scene_beats",
      severity: "major",
      description: `scene_beats ${plan.scene_beats?.length ?? 0}개 — 최소 2개 필요`,
    });
  } else {
    passed.push(`scene_beats: ${plan.scene_beats.length}개`);
  }

  // 8. pov_contract 존재
  if (!plan.pov_contract || plan.pov_contract.trim().length < 5) {
    issues.push({
      field: "pov_contract",
      severity: "critical",
      description: "POV 계약이 없음. pov_contract는 필수 필드.",
    });
  } else {
    passed.push("pov_contract 존재");
  }

  // 9. absolute_forbidden 계약 등록 확인 (정보성 — 실제 위반 감지는 prose validator)
  const af = ctx.absolute_forbidden ?? [];
  if (af.length > 0) {
    passed.push(`absolute_forbidden_registered: ${af.length}개`);
  }

  // 10. active_interventions 계약 등록 확인 (정보성)
  const activeInterventions = (ctx.active_interventions ?? []).filter(i => i.is_active);
  if (activeInterventions.length > 0) {
    passed.push(`active_interventions_registered: ${activeInterventions.length}개`);
  }

  // verdict 결정
  const hasCritical = issues.some(i => i.severity === "critical");
  const hasMajor    = issues.some(i => i.severity === "major");
  const verdict: PlanVerdict = hasCritical ? "FAIL" : hasMajor ? "WARN" : "PASS";

  return { verdict, issues, passed_checks: passed, plan };
}

// ══════════════════════════════════════════════════════════════
// repairPlan — 결정론적 자동 보정 (LLM 없음)
//
// 검증 후 FAIL/WARN 케이스에 대해, 단순 누락 필드를 컨텍스트에서
// 채워 PASS/WARN으로 전환한다.
// 보정 불가(critical 필드 내용 없음 등)는 원본 반환.
// ══════════════════════════════════════════════════════════════

export interface RepairResult {
  plan: ScenePlan;
  repaired: boolean;
  repairs_applied: string[];
}

export function repairPlan(result: PlanValidationResult, ctx: EffectiveContext): RepairResult {
  const { verdict, issues, plan } = result;
  if (verdict === "PASS") return { plan, repaired: false, repairs_applied: [] };

  const repaired = { ...plan };
  const repairs: string[] = [];

  for (const issue of issues) {
    switch (issue.field) {
      // ── carryover_effects 누락 → 직전 화 이벤트에서 자동 생성 ─
      case "carryover_effects": {
        if (ctx.prev_episode_state.ending_event && repaired.carryover_effects.length === 0) {
          const charName = ctx.characters[0]?.name ?? "주인공";
          const effect: CarryoverEffect = {
            character_name: charName,
            description: `직전 화 사건(${ctx.prev_episode_state.ending_event.slice(0, 50)})의 여파가 이번 화 초반 행동에 영향을 준다`,
            must_appear_in_opening: true,
          };
          repaired.carryover_effects = [effect];
          repairs.push("carryover_effects: 직전 화 이벤트에서 자동 생성");
        }
        break;
      }

      // ── world_rule 누락 → general_rules[0]에서 최소 계획 생성 ─
      case "world_rule": {
        const firstRule = ctx.general_rules[0];
        if (firstRule && (!repaired.world_rule?.scene_usage?.trim())) {
          const worldRule: WorldRuleActivation = {
            rule_content: firstRule,
            activation_type: "constraint",
            scene_usage: `"${firstRule}" 규칙이 이번 화 인물의 행동 선택지를 제한한다`,
          };
          repaired.world_rule = worldRule;
          repairs.push("world_rule: general_rules[0]에서 자동 생성");
        }
        break;
      }

      // ── hook_payload 부실 → hook_concrete_event에서 파생 ─────
      case "hook_payload": {
        if (repaired.hook_concrete_event && repaired.hook_concrete_event.trim().length >= 10) {
          repaired.hook_payload = repaired.hook_concrete_event.slice(0, 80);
          repairs.push("hook_payload: hook_concrete_event에서 파생");
        }
        break;
      }

      // ── hook_concrete_event 부실 → hook_payload에서 파생 ────
      case "hook_concrete_event": {
        if (repaired.hook_payload && repaired.hook_payload.trim().length >= 5) {
          repaired.hook_concrete_event = `${repaired.hook_payload} — 이 상황이 마지막 장면에서 직접적으로 드러난다`;
          repairs.push("hook_concrete_event: hook_payload에서 파생");
        }
        break;
      }

      // ── scene_beats 1개뿐 → 두 번째 비트 자동 추가 ──────────
      case "scene_beats": {
        if (repaired.scene_beats.length === 1) {
          const firstBeat = repaired.scene_beats[0];
          repaired.scene_beats = [
            firstBeat,
            {
              beat_number: 2,
              summary: ctx.task.required_events?.[0]
                ? `${ctx.task.required_events[0]} 사건이 전개된다`
                : "갈등이 고조되며 훅 상황으로 이어진다",
              characters_involved: firstBeat.characters_involved,
              location: firstBeat.location,
            },
          ];
          repairs.push("scene_beats: 두 번째 비트 자동 추가");
        }
        break;
      }
    }
  }

  if (repairs.length === 0) {
    return { plan, repaired: false, repairs_applied: [] };
  }

  return { plan: repaired, repaired: true, repairs_applied: repairs };
}
