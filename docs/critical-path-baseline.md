# Critical Path Baseline — Phase 4.20 R1.5

> 본문 가시 시점까지의 critical path 분해. R2 cleanup / R5 hybrid streaming 후 비교용 baseline.
>
> 측정 시점: 2026-04-30
> 정적 분석 기반 (forensic) + logger 마커 (Phase 4.19C에서 박음)
>
> 동적 측정값(첫 token 시점 등)은 사용자 환경에서 `scripts/measure_generation_baseline.mjs --book-id X --episode 1 --route high_quality_ensemble --runs 1` 한 회 실행 후 본 문서의 §4-§5 표를 채우면 baseline 확정.

---

## 1. 전체 critical path

```
[click]
  ├─ network + SSE handshake                        ~ 50-100 ms
  │
[request_start]
  ├─ DELETE 동일 회차 dynamic_states/foreshadows    ~ 50-100 ms
  ├─ buildEffectiveContext (DB 6-10 read)           ~ 200-500 ms
  ├─ saveEpisodeSnapshot (fire-and-forget)          0
  ├─ detectGenerationMode + buildRegenContract      ~ 50-200 ms (재생성만)
  ├─ recent_hook_types fetch                        ~ 30 ms
  │
[effective_context_done]                            누계 ~ 0.5-1 s
  ├─ creativePlanner LLM                            ~ 5-10 s   ★ blocking
  ├─ planValidator                                  ~ 5-30 ms
  ├─ rendererLLM                                    ~ 5-10 s   ★ blocking, 본문 텍스트 완성
  ├─ sanitizer                                      ~ 5-10 ms
  ├─ continuityCheck (ep>=2)                        ~ 5-30 ms
  ├─ episodeDeltaCheck                              ~ 5-30 ms
  ├─ judgeAndRepair (조건부)                        0 또는 5-15 s ★ 본문 변경 위험
  ├─ commitDynamicStates                            ~ 100-300 ms (DB 5-15 write)
  └─ proseValidation/revision                       현재 off
  │
[pipeline_done]                                     누계 ~ 11-25 s (judge 미발동) / 16-40 s (발동)
  │
[first_token_sent]                                  ~ 10 ms (res.write 본문 한 번에)
  ├─ saveEpisode (DB write)                         ~ 50-200 ms
  ├─ getLatestDynamicStates                         ~ 50-100 ms
  ├─ episode_meta build                             ~ 5 ms
  │
[char_states_fetched + done_sent]                   첫 token부터 ~ 100-400 ms 후
```

## 2. 핵심 인사이트

**`first_token_sent`가 사용자에게 본문이 보이는 시점이지만, 그 시점은 `pipeline_done`과 사실상 동일.**
즉 본문 token은 batch로 한 번에 도착 — SSE 형식이지만 token chunk streaming 아님.

## 3. logger 마커

**채널:** `api:generate:latency`

| 마커 | 시점 | 추가 필드 |
|---|---|---|
| `request_start` | SSE 응답 시작 | book_id, episode, ms=0 |
| `effective_context_done` | buildEffectiveContext 완료 | ms |
| `pipeline_start` | runPlannerPipeline 호출 직전 | ms |
| `pipeline_done` | runPlannerPipeline 반환 직후 | ms, planner_ms, renderer_ms, total_pipeline_ms, chars |
| `first_token_sent` | res.write({token: ...}) 직후 | ms |
| `char_states_fetched` | getLatestDynamicStates 반환 직후 | ms, state_fetch_ms, count |
| `done_sent` | res.write({done: ...}) 직후 | ms |

logger 출력에서 위 마커들을 grep하면 단계별 ms를 직접 확인 가능. raw prompt/response는 logger에 안 남김.

## 4. Click-to-First-Token Baseline (Phase R1.5 measured 2026-05-01)

| route | episode | runs | first_token (ms) | done (ms) | first_token→done | body chars | judge | plan_verdict |
|---|---|---|---|---|---|---|---|---|
| high_quality_ensemble | 1 | 1 | **54,061** | 54,072 | 11 | 2,124 | 미발동 | PASS (80) |

prior run (14:50:34, ep>=2): total_pipeline 88,086 / planner 72,254 / renderer 15,802.

**핵심 finding:**
- forensic 추정(8-15s)의 **2-3배** 더 큼 → forensic은 너무 낙관적이었음.
- first_token→done = 11 ms = 본문 batch (token streaming 0).
- 이번 run은 judge 미발동인데도 54s — **prompt+모델 응답 자체가 큰 비용**.

**측정 명령 (재현용):**
```bash
node scripts/measure_generation_baseline.mjs --book-id 2f4bc632... --episode 1 \
     --route high_quality_ensemble --runs 1
```

## 5. saveContext Baseline (Phase R1.5 measured 2026-05-01)

```bash
node scripts/measure_context_save_latency.mjs --book-id 2f4bc632... --runs 5
```

| | min (ms) | p50 (ms) | avg (ms) | p95 (ms) | max (ms) | pass (target < 2000) |
|---|---|---|---|---|---|---|
| Phase 4.19C 후 | 34 | 42 | 43 | **58** | 58 | **✅ PASS** |

samples: [42, 34, 35, 58, 47]

Phase 4.19C `setImmediate + Promise.all` 분리 효과 확인. saveContext는 더 이상 critical path 병목 아님. R2/R5 우선순위에서 제외.

## 6. Step별 분리 가능성 (R5 hybrid)

| Step | 본문 가시성 | R5 후 위치 |
|---|---|---|
| buildEffectiveContext | 필수 | critical (그대로) |
| creativePlanner LLM | 필수 | critical |
| planValidator | 필수 | critical |
| rendererLLM | 필수 (token 단위) | critical, **stream=true로 분할** |
| sanitizer | 필수 (token 단위) | critical (inline buffer) |
| continuityCheck | 후처리 | **background → audit log** |
| episodeDeltaCheck | 후처리 | **background → audit log** |
| judgeAndRepair | 본문 변경 위험 | **background → 다음 회차 ctx만 반영, 사용자 본문은 변경 안 함** |
| commitDynamicState | 후처리 | **background → frontend polling** |
| proseValidation/revision | optional, off | optional |

**예상 R5 후:**
- click_to_first_token p50 → **5-12 s** (renderer 시작 직후 chunk 도착)
- click_to_done p50 → 동일 (background commit + state polling 추가 1-3s)
- click_to_full_state_card → 8-15 s (state polling 도착 시)

→ 50-70% 개선 가능.

## 7. 핵심 질문 (R1.5에서 답해야 함)

| # | 질문 | 답 |
|---|---|---|
| 1 | first_token_latency가 정말 batch 구조 때문에 큰가? | **YES 정량 확정** — pipeline 99.6%, batch 11ms |
| 2 | saveContext latency는 async 분리 후 줄었는가? | **YES 확정** — p95=58ms (target<2000) |
| 3 | planner와 renderer 중 어느 쪽이 더 큰 병목인가? | **planner > renderer** — measured 31.7s vs 22.0s, prior 72s vs 16s. planner가 더 크고 변동성 큼 |
| 4 | judge/repair 발동률 + 시간? | 1/1 미발동 (PASS score=80). 그래도 54s — judge 없는 base latency가 이미 큼 |
| 5 | state extraction이 본문 표시 전 blocking? | YES — runPlannerPipeline 안에서 처리, R5에서 background 분리 |
| 6 | prompt token 가장 큰 구간? | `[연속성 계약]` 800-1500, `[재생성 분기 계약]` 600-1200 — `prompt-budget-baseline.md` |
| 7 | negative >> positive? | YES — planner 0.89, renderer 0.56 (정적 측정 확정) |
| 8 | high_quality_ensemble route가 의도된 provider/model? | `verify_route_integrity` PASS → YES, 다만 측정 시 logger의 route_metadata 확인 |
| 9 | active_route 혼선이 baseline 측정에 영향? | per-request override 시 trace에 metadata 기록되나 baseline 측정은 단일 route 1회씩 — 큰 영향 없음 |
| 10 | R2에서 가장 먼저 줄여야 할 critical path 요소? | (a) **judge 발동 임계 상향** (가장 큰 가변 cost), (b) **prompt 가지치기 [연속성 계약] / [재생성 분기 계약]**, (c) **legacy path 차단** |

## 8. R2 진행 결정 기준

R2 착수 가능: **YES** — 단, 사용자가 측정 1회 실행해 §4-§5 baseline 채운 후.

R2 우선순위:
1. judge 발동 임계 상향 (가장 큰 ROI)
2. `[연속성 계약]` / `[재생성 분기 계약]` 가지치기
3. negative 표현 → positive 재서술
4. legacy path 차단 (use_planner=false → 412 또는 auto-true)
5. system prompt의 `[반복 패턴 금지]` 안내문 압축

각 항목은 baseline 대비 측정해 효과 검증.

## 9. R5 hybrid streaming 결정 기준

R2 후에도 first_token p95 > 8-10s이면 R5 진행. 그 외엔 R2 효과만으로 충분할 수 있음 — 측정 후 판단.
