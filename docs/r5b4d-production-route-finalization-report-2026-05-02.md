# R5B-4d — Production Route Finalization + Trace Metadata Hotfix

**날짜**: 2026-05-02
**Phase**: R5B-4d (R5B-4c 후속 — production 전환 + trace recording bug fix + R5B-3.5 audit-only 격하)
**브랜치**: `checkpoint/phase1-launch-prep`

---

## 1. 브랜치 / 상태

- 출발 commit: `f4fabaf` (R5B-4c OpenAI Renderer 100EP Actual)
- working tree: 본 phase 변경 외 깨끗 (`.claude/scheduled_tasks.lock`, `scripts/cloud_dpo/launch_dpo.py` 무관 leftover만 잔존)
- build: ✅ tsc 통과
- DB migration 없음
- main push 없음
- DeepSeek route 보존 (deepseek_renderer / deepseek_planner / deepseek_full / high_quality_ensemble / gemini_planner_deepseek_renderer / gemma3_27b_planner_deepseek_renderer 모두 유지)

## 2. 변경 내용

### 2.1 active_route 전환 (`config/model_routes.json`)

```diff
- "active_route": "baseline_local",
+ "active_route": "openai_renderer",
  "fallback_route": "baseline_local",
```

- production 기본 route를 `openai_renderer`로 전환
- `MODEL_ROUTE` env 없이도 default가 `openai/gpt-4.1-mini` planner + renderer
- `fallback_route`는 `baseline_local` 유지 (안전망 — OpenAI 장애 시 local fallback)
- DeepSeek, gemma3, high_quality_ensemble 등 다른 route_set 모두 보존

### 2.2 Trace recording bug fix (planner.ts + index.ts)

**기존 버그**: `pipeline/index.ts:167`이 `tracer.setPlannerTrace.model_used`에 `getPlannerModel()` (legacy `process.env.PLANNER_MODEL` default — gemma3:12b 등) 반환값을 기록 → 실제 OpenAI router 호출과 무관하게 잘못된 model 기록.

**수정**:

1. `pipeline/planner.ts` — `runCreativePlanner` 반환값에 `model_used` + `provider` 추가
   ```diff
   export async function runCreativePlanner(
     ctx, sc, modelOverride?, routeSetOverride?,
   - ): Promise<{ plan, fallback_used, raw_output }> {
   + ): Promise<{ plan, fallback_used, raw_output, model_used: string, provider: string }> {
     const route = resolveTaskRoute("planner", routeSetOverride);
     const useRouter = !modelOverride && route && (route.provider !== getActiveProvider() || route.model !== getPlannerModel());
     const model = modelOverride ?? (useRouter ? route!.model : getPlannerModel());
   + const provider = useRouter ? route!.provider : getActiveProvider();
     ...
   - return { plan, fallback_used: false, raw_output: raw };
   + return { plan, fallback_used: false, raw_output: raw, model_used: model, provider };
   ```

2. `pipeline/index.ts` — trace에 router-resolved 값 기록
   ```diff
   - const { plan, fallback_used, raw_output } = await runCreativePlanner(...);
   + const { plan, fallback_used, raw_output, model_used: plannerModelUsed, provider: plannerProvider } = await runCreativePlanner(...);
     tracer?.setPlannerTrace({
       ...
   -   model_used: plannerModelOverride ?? (await import("../lib/llm.js")).getPlannerModel(),
   +   model_used: plannerModelUsed,
   +   provider:   plannerProvider,
     });
   ```

### 2.3 Renderer trace에 provider 추가 (renderer.ts + index.ts)

기존: `RenderResult.model_used`만 있었음. provider도 router-resolved 기준으로 정확히 기록되도록 추가.

```diff
  export interface RenderResult {
    text: string;
    ...
    model_used: string;
+   provider: string;
    elapsed_ms: number;
  }
```

```diff
  return {
    text,
    ...
    model_used: model,
+   provider,
    elapsed_ms: Date.now() - t0,
  };
```

```diff
  tracer?.setRendererTrace({
    ...
    model_used: renderResult.model_used,
+   provider:   renderResult.provider,
  });
```

### 2.4 PlannerTrace / RendererTrace 타입에 provider 추가 (`src/training/types.ts`)

```diff
  export interface PlannerTrace {
    ...
    model_used?: string;
+   provider?: string;  // R5B-4d
  }

  export interface RendererTrace {
    ...
    model_used?: string;
+   provider?: string;  // R5B-4d
  }
```

### 2.5 R5B-3.5 narrative_repetition_guard → audit-only 격하

R5B-4a/4b/4c에서 OpenAI renderer가 narrative repetition RETRY=0를 입증했으므로 runtime retry 의존도 제거. deterministic detector + trace recording은 유지하여 audit / DPO data quality 분석에 활용.

`src/pipeline/index.ts` 변경:

- `RETRY_INSTRUCTION as NARRATIVE_RETRY_INSTRUCTION` import 제거 (사용 안 함)
- runtime retry 블록 (renderFromPlanWithTrace 재호출 + retrySanitized 등) **삭제**
- RETRY verdict 시 audit log만 남김 (`pipeline:r5b3_5_audit`)
- trace 기록은 유지 — `retry_attempted: false`, `retry_succeeded: false` 고정 (schema 호환)

```diff
- // ── R5B-3.5: narrative cliché runtime guard (post-gen, pre-storage) ──
+ // ── R5B-3.5: narrative cliché audit guard (audit-only, no runtime retry) ──
  let _narrativeRepCheck;
- let _narrativeRetryAttempted = false;
- let _narrativeRetrySucceeded = false;
  if (generatedText && ctx.episode_number >= 2) {
    ...
    _narrativeRepCheck = checkNarrativeRepetition(generatedText, _recent);
-   if (_narrativeRepCheck.verdict === "RETRY" && !onRendererChunk) {
-     _narrativeRetryAttempted = true;
-     ...renderFromPlanWithTrace(scenePlan, ctx, ..., NARRATIVE_RETRY_INSTRUCTION) 호출 + retry...
-   }
+   if (_narrativeRepCheck.verdict === "RETRY") {
+     logWarn("pipeline:r5b3_5_audit", "narrative cliché 반복 검출 (audit-only — 본문은 그대로 사용)", {...});
+   }
  }
```

### 2.6 verify_narrative_repetition_guard 갱신

기존 verify는 runtime retry 동작을 검사 (5개 check). audit-only contract에 맞게 갱신:

```diff
  okIf("R5B-3.5 audit guard 호출 (sanitize 후, audit-only)",
    /R5B-3\.5: narrative cliché audit guard/.test(pipeline) &&
    /checkNarrativeRepetition\(generatedText/.test(pipeline));
- okIf("verdict==='RETRY' 시 retry 시도", ...);
- okIf("retry 시 NARRATIVE_RETRY_INSTRUCTION + temp override 0.92", ...);
- okIf("retry 결과 sanitize + 재검사", ...);
- okIf("retry 1회만 (재귀 retry 없음)", ...);
+ okIf("RETRY verdict 시 audit log만 (retry 트리거 없음)",
+   /pipeline:r5b3_5_audit/.test(pipeline) && /audit-only/i.test(pipeline));
+ okIf("RETRY_INSTRUCTION import 제거 (runtime retry 사용 안 함)",
+   !/RETRY_INSTRUCTION as NARRATIVE_RETRY_INSTRUCTION/.test(pipeline));
+ okIf("renderer retry 호출 없음 (R5B-3.5 path)",
+   !/renderFromPlanWithTrace[\s\S]{0,400}NARRATIVE_RETRY_INSTRUCTION/.test(pipeline));
```

22 checks total, all PASS.

## 3. Smoke 결과

### 3.1 환경

- 서버: `npm run start` (MODEL_ROUTE env 미설정 — config의 active_route만 사용)
- book: 신규 smoke clean book (`1980fbdc-4d10-435f-b50d-e4cedef5d2f5`, 4 canonical_characters 정상 복사) — smoke 후 정리 (DB cleanup)
- 생성: ep1, ep2 (hybrid streaming)

### 3.2 결과

| ep | score | chars | elapsed | planner trace | renderer trace |
|---|---|---|---|---|---|
| 1 | 80 | 1,443 | 24,026 ms | **openai/gpt-4.1-mini** ✅ | **openai/gpt-4.1-mini** ✅ |
| 2 | 80 | 1,686 | 34,085 ms | **openai/gpt-4.1-mini** ✅ | **openai/gpt-4.1-mini** ✅ |

이전 (R5B-4c)에서는 `planner_trace.model_used`가 `gemma3:12b` (legacy default)로 잘못 기록됐으나, R5B-4d 수정 후 **`openai/gpt-4.1-mini`로 정확히 기록됨**.

### 3.3 Server log 일치 여부

```
[INFO] [pipeline:planner]  창의적 장면 계획 생성  { episode: 1, model: "gpt-4.1-mini", provider: "openai", via: "router", route_set_override: undefined }
[INFO] [pipeline:renderer] 렌더링 시작              { episode: 1, model: "gpt-4.1-mini", provider: "openai", via: "router", streaming: true }
```

server log의 provider/model = run_traces.planner_trace + renderer_trace 일치 ✅.

## 4. Verify 결과

### Build

```
> npm run build
> tsc
(no errors)
```

### verify_route_integrity

```
PASS 31 | FAIL 0 | SKIP 2
```

### 핵심 verify suite (13개)

| Verify | result |
|---|---|
| `verify_route_integrity` | ✅ PASS 31 / FAIL 0 / SKIP 2 |
| `verify_meaningful_appearance_guard` | ✅ 17/17 |
| **`verify_narrative_repetition_guard`** | **✅ 22/22 (audit-only contract로 갱신 후)** |
| `verify_duplicate_discovery_dedup` | ✅ 18/18 |
| `verify_episode_end_state_alignment` | ✅ 17/17 |
| `verify_episode_character_display_filter` | ✅ 20/20 |
| `verify_state_taxonomy` | ✅ 36/36 |
| `verify_world_rule_integrity` | ✅ 21/21 |
| `verify_hybrid_streaming_contract` | ✅ 32/32 |
| `verify_emotion_label_normalization` | ✅ 21/21 |
| `verify_genuine_progression_guard` | ✅ 29/29 |
| `verify_state_progression_required` | ✅ 25/25 |
| `verify_regen_degradation_fix` | ✅ 32/32 |

**전체 verify: 13 script 통과, regression 없음.**

## 5. 최종 판단

| 항목 | 결과 |
|---|---|
| **R5B-4d verdict** | **READY** |
| **PR merge readiness** | **YES** |
| **production route** | `openai_renderer` (config active_route — env 없이도 default) |
| **추가 hotfix 필요 여부** | NO |

### 다음 권장 단계 (사장님 판단)

1. **PR merge** — 본 phase 완료 시점에서 merge 준비 완료 (사장님이 직접 진행)
2. **R5B-3.5 narrative_repetition_guard** → audit-only로 격하 완료 (이번 phase에 포함)
3. **R5B-1.8D meaningful appearance guard** → 그대로 유지
4. **R5B-6 prompt pruning** → 후순위 (OpenAI는 88 negative + 22+ section 견디며 cliché 회피)
5. **world rule audit heuristic 개선** → 별도 phase 권고 (audit script만, runtime 영향 없음)

### 변경된 파일 (commit 대상)

- `config/model_routes.json` — active_route 전환
- `src/pipeline/planner.ts` — runCreativePlanner 반환값 확장
- `src/pipeline/renderer.ts` — RenderResult.provider 추가
- `src/pipeline/index.ts` — trace 기록 fix + R5B-3.5 retry 제거 (audit-only)
- `src/training/types.ts` — PlannerTrace/RendererTrace.provider 필드 추가
- `scripts/verify_narrative_repetition_guard.mjs` — audit-only contract 검사로 갱신
- `docs/r5b4d-production-route-finalization-report-2026-05-02.md` — 본 보고서

```
R5B-4d verdict: READY
PR merge readiness: YES
production route: openai_renderer
추가 hotfix 필요 여부: NO
근거: config/model_routes.json active_route를 baseline_local에서 openai_renderer로 전환 완료. fallback_route는 baseline_local 유지(안전망), DeepSeek/gemma3/high_quality_ensemble 등 다른 route_set 모두 보존. pipeline/index.ts:167의 trace recording bug 수정 — runCreativePlanner가 router-resolved model_used + provider를 반환하도록 변경, pipeline에서 그 값을 그대로 trace에 기록. RendererTrace에도 provider 필드 추가, RenderResult가 router-resolved provider 반환. PlannerTrace/RendererTrace 타입에 provider 필드 추가. R5B-3.5 narrative_repetition_guard runtime retry 블록 제거(R5B-4a/4b/4c에서 OpenAI renderer RETRY=0 입증), audit-only로 격하 — checkNarrativeRepetition 호출과 trace 기록은 유지하여 audit visibility 보존, RETRY_INSTRUCTION import 제거, renderFromPlanWithTrace 재호출 경로 삭제. verify_narrative_repetition_guard도 audit-only contract 검사로 갱신(22/22 PASS). MODEL_ROUTE env 없이 신규 smoke book 1980fbdc-4d10-435f-b50d-e4cedef5d2f5(4 canonical_characters)에서 ep1+ep2 hybrid streaming 생성 — 두 episode 모두 score=80 PASS, 그리고 run_traces.planner_trace.provider/model_used와 renderer_trace.provider/model_used 모두 openai/gpt-4.1-mini로 정확히 기록됨(이전 버그 fix 입증), server log 메시지와 100% 일치. smoke book은 검증 후 DB cleanup. tsc build PASS, verify_route_integrity 31/0/2 PASS, 13개 verify script 전부 PASS — regression 없음. main push 없음, DB migration 없음, raw output 미커밋, 금지 파일(.claude/scheduled_tasks.lock, scripts/cloud_dpo/launch_dpo.py) 미커밋. DeepSeek route는 low-cost/fast mode로 보존(삭제 안 함). PR merge 직접 진행하지 않음 — 사장님 명시 승인/수행 대기.
```

## 부록 A. 트레이스 fix 검증 evidence

이전 (R5B-4c 시점, `f4fabaf` 직전):
```
ep10: planner_trace.model_used = "gemma3:12b"  ← 잘못 기록 (legacy default)
ep10: renderer_trace.model_used = "gpt-4.1-mini"  ← 정상 (renderer는 이미 router-resolved 사용)
```

이후 (R5B-4d 수정 후 smoke):
```
ep1: planner_trace.provider="openai" model_used="gpt-4.1-mini"  ✅
ep1: renderer_trace.provider="openai" model_used="gpt-4.1-mini" ✅
ep2: planner_trace.provider="openai" model_used="gpt-4.1-mini"  ✅
ep2: renderer_trace.provider="openai" model_used="gpt-4.1-mini" ✅
```

server log:
```
[pipeline:planner]  창의적 장면 계획 생성  { model: "gpt-4.1-mini", provider: "openai", via: "router" }
[pipeline:renderer] 렌더링 시작              { model: "gpt-4.1-mini", provider: "openai", via: "router" }
```

trace metadata와 server log 100% 일치.

## 부록 B. R5B-4 series 요약

| Phase | 핵심 결과 | verdict |
|---|---|---|
| R5B-4 | analysis-only 구조 검토 — DeepSeek prose loop, overconstraint, streaming-repair 충돌 진단 | READY (분석) |
| R5B-4a | same-plan 15화 비교 (DeepSeek vs OpenAI vs Gemini) — OpenAI RETRY 11→0 입증 | READY |
| R5B-4b | TEST2F 30화 live canary — OpenAI streaming hybrid 안정성 입증 | READY |
| R5B-4c | TEST2G 100화 actual — production scale PASS, DeepSeek 대비 narrative cliché −83~−100% | READY |
| **R5B-4d (본 phase)** | **production active_route 전환 + trace bug fix + R5B-3.5 audit-only 격하** | **READY** |

5단계 series 완료. PR merge 준비 완료.
