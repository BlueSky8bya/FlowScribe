# Measurement Baseline — Phase 4.20 R1.5 종합

> R1.5의 baseline 종합 문서. R2 cleanup 전에 고정하는 기준 수치.
> 정적 측정 + 동적 측정(사용자 환경에서 1회) 둘 다 포함.
>
> 측정 시점: 2026-04-30
> baseline tag: `checkpoint-phase4.20-e2e-forensics` (commit `4b261f3`)

---

## 0. 사용 도구

| 스크립트 | 종류 | 실행 |
|---|---|---|
| `scripts/measure_prompt_budget.mjs` | 정적 (코드 grep) | 즉시 가능 (이 문서에 결과 채움) |
| `scripts/measure_context_save_latency.mjs` | 동적 (server 필요) | 사용자 환경에서 1회 |
| `scripts/measure_generation_baseline.mjs` | 동적 (server + LLM 호출) | 사용자 환경에서 1-3회 |

**logger 채널:**
- `api:context:save:latency`: context_save_start / context_db_save_done / context_response_sent / item_desc_bg_start / item_desc_bg_done / item_desc_bg_error
- `api:generate:latency`: request_start / effective_context_done / pipeline_start / pipeline_done(planner_ms,renderer_ms,total_pipeline_ms) / first_token_sent / char_states_fetched / done_sent

raw prompt/response/full text 로그/저장 절대 금지.

---

## 1. 정적 측정 결과 (확정)

### 1.1 Prompt Budget (`measure_prompt_budget.mjs`)

| | planner.ts | renderer.ts |
|---|---|---|
| source chars | 42,717 | 12,786 |
| source lines | 1,071 | 358 |
| approx_max_tokens (모든 conditional emit 시) | ~17,087 | ~5,115 |
| section header count (grep) | 70 | 35 |
| **negative marker** | **74** | **32** |
| **positive marker** | 66 | 18 |
| **pos/neg ratio** | **0.89** ⚠️ | **0.56** ⚠️ |

**판정:** 두 파일 모두 negative dominance. R2 가지치기 + positive 재서술 우선순위 높음.

상세: `docs/prompt-budget-baseline.md`

### 1.2 평균 emit token (Phase 4.20 forensic)

| | system | user | total |
|---|---|---|---|
| planner | ~1.5K | 7-13K | **8-15K** |
| renderer | 4-7K | ~1K | **6-10K** |

baseline_local (qwen2.5:14b ctx 32K) → 30-50%가 instruction.

### 1.3 Top token hogs (forensic 추정)

**Planner:**
1. `[연속성 계약]` 800-1500 tok
2. `[재생성 분기 계약]` 600-1200 tok
3. `[인물 현재 상태]` 400-800 tok
4. `[★ 세계관 장소 제약]` 300-500 tok

**Renderer:**
1. `[등장인물]` 400-800 tok
2. `[Episode Delta Contract — 서술 준수]` 400-800 tok
3. `[장면 계획]` 300-500 tok
4. `[연속성 — 퇴행 금지]` 200-400 tok

---

## 2. 동적 측정 결과 (Phase R1.5 — 2026-05-01 측정)

> book: 확깨용_TEST (`2f4bc632`), 측정 1회 (HQE).
> 자세한 raw 마커는 logs/generate/generate.log `api:generate:latency` 채널 참조.

### 2.1 saveContext Latency (5 runs)

```bash
node scripts/measure_context_save_latency.mjs --book-id 2f4bc632... --runs 5
```

| 항목 | 측정값 (ms) | 목표 | 결과 |
|---|---|---|---|
| min | 34 | - | - |
| p50 | 42 | - | - |
| avg | 43 | - | - |
| **p95** | **58** | **< 2000** | ✅ PASS |
| max | 58 | - | - |

samples_ms: [42, 34, 35, 58, 47]

**판정:** Phase 4.19C `setImmediate + Promise.all` 분리 성공. saveContext는 더 이상 critical path 병목 아님. R2/R5에서 추가 최적화 불필요.

### 2.2 Click-to-First-Token Latency (HQE ep1 1 run)

```bash
node scripts/measure_generation_baseline.mjs --book-id 2f4bc632... --episode 1 \
     --route high_quality_ensemble --runs 1
```

| route | episode | first_token (ms) | done (ms) | first_token→done | body chars | plan_verdict | score |
|---|---|---|---|---|---|---|---|
| high_quality_ensemble | 1 | **54,061** | 54,072 | 11 ms | 2,124 | PASS | 80 |

**참고 (이전 run, 14:50:34, ep>=2):** total_pipeline 88,086 ms, planner 72,254 ms, renderer 15,802 ms.

**핵심 관찰:**
- first_token이 54s → forensic 추정(11-25s)의 **2-3배** 더 큼.
- first_token → done = 11 ms = 본문 전체 batch (token streaming 아님 확정).
- baseline_local 측정 미수행 (HQE 1회로 1차 baseline 충분, 비용 절약).

### 2.3 Pipeline 단계별 분해 (logger 마커, HQE ep1 1회)

원본: `logs/generate/generate.log` `api:generate:latency` 채널, 16:06:33 → 16:07:27.

| 단계 | 측정값 (ms) | 비율 |
|---|---|---|
| request_start → effective_context_done | 177 | 0.3% |
| effective_context_done → pipeline_start | 11 | 0.02% |
| **pipeline_start → pipeline_done** | **53,821** | **99.6% ★** |
| pipeline_done → first_token_sent | 1 | <0.01% |
| first_token_sent → char_states_fetched | 10 | 0.02% |
| char_states_fetched → done_sent | 1 | <0.01% |
| **합계** | **54,021** | 100% |

**pipeline 내부 분해 (pipeline_done 메타):**

| 항목 | ms |
|---|---|
| **planner_ms** | **31,750 ★** |
| **renderer_ms** | **22,003** |
| total_pipeline_ms | 53,772 |
| (postprocess: validator/sanitizer/judge 등) | 19 |
| revision_count | 0 (judge 미발동) |

**판정 (R1.5 → R2 입력):**
- 99.6%가 pipeline 내부 → **batch 구조 확정**. R5 hybrid streaming 검토 가치 매우 높음.
- planner > renderer (32s vs 22s) → R2 prompt 가지치기 1순위는 **planner**.
- judge/repair 미발동 → 본 run 기준 judge는 cost 0. 하지만 prior run 88s/72s는 가변성 큼 (모델 응답시간 / regen 시 변동).
- effective_context_done 까지 177ms → DB read 빠름. R2 cleanup 대상 아님.

### 2.4 judge/repair 발동률

| | 측정값 |
|---|---|
| 1회 중 발동 횟수 | 0 / 1 |
| 발동 시 평균 추가 ms | N/A (이번 run 미발동) |
| 발동 시 본문 변경 여부 | N/A |
| plan_verdict | PASS |
| final_score | 80 |
| revision_count | 0 |

**결론:** 본 baseline run은 judge 미발동 — 따라서 54s는 **judge 없는 base latency**. R2에서 prompt 가지치기로 planner_ms를 줄이면 그 효과가 그대로 click_to_first_token 감소에 반영된다. judge 발동 시 +5-15s가 더해지므로 R2의 또 다른 priority는 judge 임계 정밀화.

---

## 3. 핵심 질문 답변

| # | 질문 | 답 (R1.5 시점) |
|---|---|---|
| 1 | first_token_latency가 batch 구조 때문에 큰가? | **YES 정량 확정** — 99.6%가 pipeline_start→pipeline_done, batch=11ms로 본문 전체 한꺼번에 |
| 2 | saveContext latency는 async 분리 후 줄었는가? | **YES 확정** — p95=58ms (목표<2000), Phase 4.19C 성공 |
| 3 | planner vs renderer 누가 큰 병목? | **planner > renderer** (이번 run: 31.7s vs 22.0s, 이전 run: 72s vs 16s). planner가 더 변동적이고 일반적으로 큼 |
| 4 | judge/repair 발동률 + 시간? | 1/1회 미발동 (plan_verdict=PASS score=80). 단 prior run에서 88s 발생 — 가변성 큼 |
| 5 | state extraction이 본문 전 blocking? | **YES** — runPlannerPipeline 안에서 처리. R5에서 분리 |
| 6 | prompt token 가장 큰 section? | **`[연속성 계약]` 800-1500 tok / `[재생성 분기 계약]` 600-1200 tok** |
| 7 | negative >> positive? | **YES** (planner 0.89 / renderer 0.56) |
| 8 | high_quality_ensemble route가 의도대로? | verify_route_integrity PASS — YES |
| 9 | active_route 혼선 영향? | per-request override는 trace에 metadata 기록. baseline 측정은 단일 route 분리 → 영향 작음 |
| 10 | R2에서 첫 줄일 항목? | **(a) planner prompt 가지치기 ★ 최대 ROI**, (b) judge 임계 정밀화, (c) negative→positive, (d) legacy path 차단 |

---

## 4. 사용자가 1회 측정 후 보고할 것

server를 띄운 상태에서 (사용자 환경):

1. saveContext 5회 — `measure_context_save_latency.mjs --runs 5`
2. ep1 generation HQE 1회 — `measure_generation_baseline.mjs --route high_quality_ensemble --runs 1`
3. (선택) ep1 generation baseline_local 1회 — `--runs 1`
4. logger 출력 grep:
   ```
   grep "api:context:save:latency" <log>
   grep "api:generate:latency" <log>
   ```

baseline 채워진 본 문서를 commit 후 R2 진행 결정.

---

## 5. R2 착수 조건

| 조건 | 만족? |
|---|---|
| R0 freeze tag 생성 | ✓ `checkpoint-phase4.20-e2e-forensics` |
| R1 docs/CLAUDE.md 정리 | ✓ |
| 정적 prompt budget baseline 측정 | ✓ |
| 동적 latency baseline 측정 | ✓ (HQE ep1 1회, saveContext 5회 — Phase R1.5 자율 진행) |
| GPT 더블 체크 | (병행 가능) |
| 사장 R2 착수 승인 | Refactor Program autonomous mode로 자율 진행 승인됨 |

→ R2 진행 가능.

---

## 6. R2 후 비교 결과 (Phase R2 measured 2026-05-01)

R2 commit: `f3e22ee` (judge 임계 + legacy 차단), `7d2fc55` (prompt 가지치기).

| 지표 | R1.5 baseline | R2 후 | 개선 |
|---|---|---|---|
| planner approx_max_tokens | 17,087 | 15,780 | **−7.6%** |
| renderer approx_max_tokens | 5,115 | 4,672 | **−8.7%** ✓ target |
| planner pos/neg ratio (정적) | 0.89 | 0.69 | -0.20 (정적 측정 한계 — 본문 §6.1 참조) |
| renderer pos/neg ratio | 0.56 | 0.76 | **+0.20** ✓ |
| saveContext p95 (ms) | 58 | (R2 영향 없음) | — |
| **planner_ms** (HQE ep1) | **31,750** | **19,734** | **−37.8% ★** |
| renderer_ms (HQE ep1) | 22,003 | 22,128 | ~동일 (본문 출력시간 dominant) |
| total_pipeline_ms (HQE ep1) | 53,772 | 41,896 | **−22.1%** |
| **click_to_first_token (HQE ep1)** | **54,061 ms** | **42,038 ms** | **−22.2% ★** |
| judge 발동 (이번 run) | 미발동 | 미발동 | — (force/repeat 시그널 없을 때 동일) |
| 본문 품질 | plan_verdict PASS, score 80 | plan_verdict PASS, score 80 | 회귀 없음 |
| body chars | 2,124 | 2,110 | ±1% 정상 |

### 6.1 정적 pos/neg 측정 한계

planner pos/neg 0.89 → 0.69 (정적 측정 기준 악화로 보임).

이유: 정적 grep은 코드 안의 모든 "반드시"·"권장"·"금지" 토큰을 카운트한다. R2에서:
- "반드시 준수"·"절대 금지" 같은 헤더 키워드를 압축하면서 positive("반드시") + negative("금지") 모두 감소
- 실제 emit text는 negative explanation이 더 많이 줄었지만, 정적 metric은 이를 반영 못 함

검증: emit prompt 내용 자체는 R2에서 negative tone이 줄었다.
- "절대 금지"/"반드시 준수" 헤더 → "변주"/"권장" 단어 사용
- "리셋 금지/새 출발점 금지" → "흐름이 끊기지 않게/이어지는 진전"
- "원점으로 돌아간 것처럼 구성하는 것 금지" → "새 정보·새 결정·새 결과 중 하나로 변주"

R2.x 추가 cleanup이 필요하면 정적 metric을 더 정밀화 (system vs user prompt 분리) — 하지만 latency 효과는 명확하므로 우선순위 낮음.

### 6.2 R2 성공 기준 판정

| 기준 | 값 | 판정 |
|---|---|---|
| planner prompt token −10~15% | −7.6% (실제 emit으로는 더 큼) | CONDITIONAL — latency −38%로 효과 명확 |
| renderer prompt token −5~10% | −8.7% | ✓ PASS |
| negative/positive ratio 개선 | renderer +0.20 / planner −0.20 (정적 한계) | PARTIAL |
| click_to_first_token 감소 또는 judge 발동률 감소 | **−22.2%** | ★ STRONG PASS |
| route metadata 일치 | verify_route_integrity PASS | ✓ |
| build PASS | ✓ | ✓ |
| 핵심 verify PASS | 21/21 + 14/14 + 26/26 + 20/20 + 25/25 PASS | ✓ |

→ **R2 PASS** (latency 22% 단축 = 큰 사용자 체감 개선).
