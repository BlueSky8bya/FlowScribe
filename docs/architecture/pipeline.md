# FlowScribe 생성 파이프라인 구조

## 경로 선택 흐름

```
POST /api/generate-v2
    │
    ├─ use_planner=false (기본값) → Legacy 경로
    │     story.ts:streamEpisode() → SSE 스트리밍 → (선택) validate → (선택) revise
    │
    └─ use_planner=true          → Planner 파이프라인 경로
          src/pipeline/index.ts:runPlannerPipeline()
              │
              ├─ Step 1: StateExtractor (결정론적, LLM 없음)
              │     src/pipeline/state_extractor.ts:extractStateConstraints()
              │     → opening_location, forbidden_actions, must_keep_items, pov_contract, tone_contract
              │
              ├─ Step 2: CreativePlanner (LLM, temp=0.4)
              │     src/pipeline/planner.ts:runCreativePlanner()
              │     → JSON: carryover_effects, world_rule, scene_beats, hook_type/payload/concrete_event
              │     → 파싱 실패 시 결정론적 fallback 자동 사용
              │
              ├─ Step 3: Plan Merge (결정론적)
              │     ScenePlan = StateExtractor 결정론적 필드 + CreativePlanner 창의적 필드
              │
              ├─ Step 4: PlanValidator (결정론적, LLM 없음)
              │     src/pipeline/plan_validator.ts:validatePlan()
              │     → 8개 검사: location/carryover/injuries/items/world_rule/hook/beats/pov
              │     → PASS / WARN / FAIL
              │
              ├─ Step 5: Renderer (LLM, temp=0.85)
              │     src/pipeline/renderer.ts:renderFromPlan()
              │     → 계획 구조를 시스템 프롬프트로 변환, 본문 생성
              │
              ├─ Step 6: ProseValidator (기존 validator.ts, 동결)
              │     src/services/validator.ts:validate()
              │
              └─ Step 7: Revision (기존 revision.ts, 동결, 선택적)
                    src/services/revision.ts:reviseUntilPass()
```

## 두 경로 공유 컴포넌트

| 컴포넌트 | 경로 | 상태 |
|---|---|---|
| `validator.ts` | `src/services/validator.ts` | **동결** (R7-FREEZE, 2026-04-21) |
| `revision.ts` | `src/services/revision.ts` | **동결** |
| `pov_rules.ts` | `src/lib/pov_rules.ts` | Variant C 채택, 변경 시 benchmark 재실행 필요 |
| `effective_context.ts` | `src/services/effective_context.ts` | 두 경로 모두 DB→EffectiveContext 조립에 사용 |

## 핵심 설계 결정

**StateExtractor가 결정론적인 이유:**  
위치/부상/소지품은 LLM 판단이 필요 없는 사실이다. LLM에게 "지시"하는 대신 계획 단계에서 구조로 확정하면 Renderer가 반드시 따를 수밖에 없다. 상태 보존 문제의 근본 원인을 프롬프트 강화가 아닌 아키텍처로 해결한다.

**Planner가 JSON only인 이유:**  
temperature=0.4 + JSON 전용 시스템 프롬프트로 구조적 계획만 생성. 창의성(scene beats, hook)은 허용하되 상태 보존 책임은 제거. 파싱 실패 시 3-tier 복구 → 결정론적 fallback.

**benchmark에서의 검증 결과:**  
sp-01 케이스(1인칭주인공, 팔 부상, easy):
- Planner→Renderer: WARN, score=70, hard violation 0
- Legacy: FAIL, score=7, hard violation 3 (시점위반+상태모순+시공간)
