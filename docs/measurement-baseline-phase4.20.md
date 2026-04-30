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

## 2. 동적 측정 결과 (사용자 1회 실행 후 채움)

### 2.1 saveContext Latency

```bash
node scripts/measure_context_save_latency.mjs --book-id <test_book_id> --runs 5
```

| 항목 | 측정값 (ms) | 목표 | 결과 |
|---|---|---|---|
| min | _TBD_ | - | - |
| p50 | _TBD_ | - | - |
| avg | _TBD_ | - | - |
| **p95** | **_TBD_** | **< 2000** | _TBD_ |
| max | _TBD_ | - | - |

Phase 4.19C 가드: `setImmediate + Promise.all`로 item_desc enrich가 응답에 포함 안 됨. 응답 자체는 DB UPSERT 5건 + redis set + canonical_characters insert만.

### 2.2 Click-to-First-Token Latency

```bash
# baseline_local
node scripts/measure_generation_baseline.mjs --book-id <test_book_id> --episode 1 --runs 1

# high_quality_ensemble
node scripts/measure_generation_baseline.mjs --book-id <test_book_id> --episode 1 \
     --route high_quality_ensemble --runs 1
```

| route | episode | first_token p50 (ms) | first_token p95 (ms) | done p50 (ms) | done p95 (ms) |
|---|---|---|---|---|---|
| baseline_local | 1 | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| high_quality_ensemble | 1 | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| baseline_local | 5 | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| high_quality_ensemble | 5 | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

### 2.3 Pipeline 단계별 분해 (logger 마커)

logger 출력에서 추출:

```
api:generate:latency  request_start            book_id=X  episode=1  ms=0
api:generate:latency  effective_context_done   ms=...
api:generate:latency  pipeline_start           ms=...
api:generate:latency  pipeline_done            ms=...  planner_ms=...  renderer_ms=...  total_pipeline_ms=...  chars=...
api:generate:latency  first_token_sent         ms=...
api:generate:latency  char_states_fetched      ms=...  state_fetch_ms=...  count=...
api:generate:latency  done_sent                ms=...
```

| 단계 | ms 평균 (TBD) |
|---|---|
| request_start → effective_context_done | _TBD_ |
| effective_context_done → pipeline_start | _TBD_ (≈ 0) |
| pipeline_start → pipeline_done | _TBD_ ★ |
| pipeline_done → first_token_sent | _TBD_ (≈ ms 단위) |
| first_token_sent → char_states_fetched | _TBD_ |
| char_states_fetched → done_sent | _TBD_ (≈ 0) |

판정 기준:
- 90% 이상의 시간이 `pipeline_start → pipeline_done`이면 → **batch 구조 확정**, R5 hybrid 진행 가치 있음
- planner_ms와 renderer_ms 비교로 어느 쪽이 큰지 확정

### 2.4 judge/repair 발동률

logger에서 `pipeline:coherence` 또는 judgeAndRepair 호출 패턴 grep. 발동 시 추가 ms 비용 측정.

| | 측정값 |
|---|---|
| 5회 중 발동 횟수 | _TBD_ |
| 발동 시 평균 추가 ms | _TBD_ |
| 발동 시 본문 변경 여부 | _TBD_ |

---

## 3. 핵심 질문 답변

| # | 질문 | 답 (R1.5 시점) |
|---|---|---|
| 1 | first_token_latency가 batch 구조 때문에 큰가? | **YES** (정적 확정), 동적 측정으로 정량 — TBD |
| 2 | saveContext latency는 async 분리 후 줄었는가? | TBD (측정 필요), Phase 4.19C 코드는 setImmediate ✓ |
| 3 | planner vs renderer 누가 큰 병목? | logger의 planner_ms / renderer_ms로 분해 — TBD |
| 4 | judge/repair 발동률 + 시간? | TBD |
| 5 | state extraction이 본문 전 blocking? | **YES** — runPlannerPipeline 안에서 처리. R5에서 분리 |
| 6 | prompt token 가장 큰 section? | **`[연속성 계약]` 800-1500 tok / `[재생성 분기 계약]` 600-1200 tok** |
| 7 | negative >> positive? | **YES** (planner 0.89 / renderer 0.56) |
| 8 | high_quality_ensemble route가 의도대로? | verify_route_integrity PASS — YES |
| 9 | active_route 혼선 영향? | per-request override는 trace에 metadata 기록. baseline 측정은 단일 route 분리 → 영향 작음 |
| 10 | R2에서 첫 줄일 항목? | (a) judge 임계 상향, (b) `[연속성 계약]`+`[재생성 분기 계약]` 가지치기, (c) negative→positive, (d) legacy path 차단 |

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
| 동적 latency baseline 측정 | **TBD (사용자 1회 실행)** |
| GPT 더블 체크 | **TBD (사용자 결정)** |
| 사장 R2 착수 승인 | **TBD** |

위 4-6번 만족 시 R2 시작.

---

## 6. R2 후 비교 절차

R2 cleanup 후:

```bash
node scripts/measure_prompt_budget.mjs --json > /tmp/r2-budget.json
node scripts/measure_context_save_latency.mjs --book-id <X> --runs 5
node scripts/measure_generation_baseline.mjs --book-id <X> --episode 1 --route high_quality_ensemble --runs 3
```

본 baseline과 비교해 다음 표 채움:

| 지표 | R0 baseline | R2 후 | 개선 |
|---|---|---|---|
| planner approx_max_tokens | 17,087 | TBD | TBD |
| renderer approx_max_tokens | 5,115 | TBD | TBD |
| planner pos/neg ratio | 0.89 | TBD | TBD |
| renderer pos/neg ratio | 0.56 | TBD | TBD |
| saveContext p95 (ms) | TBD | TBD | TBD |
| first_token p50 HQE ep1 (ms) | TBD | TBD | TBD |
| judge 발동률 | TBD | TBD | TBD |
| 본문 품질 (사용자 주관) | OK | TBD | TBD |

R2 목표: planner -15%, renderer -10%, pos/neg ≥ 1.0, judge 발동률 -50%, 본문 품질 회귀 없음.
