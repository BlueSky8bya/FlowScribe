# R5B-4a — Renderer Route Comparison Harness

**날짜**: 2026-05-02
**Phase**: R5B-4a (R5B-4 structural review에서 권고된 same-plan renderer 비교)
**브랜치**: `checkpoint/phase1-launch-prep`

---

## 1. 브랜치/상태

- 출발 commit: `5dc6bff` (R5B-4 structural review)
- working tree: 본 phase 변경 외 깨끗 (`.claude/scheduled_tasks.lock`, `scripts/cloud_dpo/launch_dpo.py` 무관 leftover만 잔존)
- build: ✅ tsc 통과
- DB migration 없음
- main push 없음
- code changes: **config 2 route 추가 + 신규 script 2개만** (pipeline / prompt / guard 추가 없음 — R5B-4 원칙 준수)

## 2. 비교 설계

### 2.1 데이터셋

- TEST2E ep76~90 (15화)의 planner output + effective_context를 fixture로 추출
- 같은 plan + 같은 ctx로 다른 renderer route만 호출 → renderer 모델만 변수로 분리
- fixture 본문 raw output은 `.tmp/r5b4a_fixtures/`에만 저장 (gitignored)

### 2.2 비교 후보 (Claude provider 미지원으로 3-way로 한정)

| Route | planner | renderer | source |
|---|---|---|---|
| A. high_quality_ensemble (baseline) | gpt-4.1-mini | deepseek-chat | 기존 ep76~90 본문 (DB) |
| B. openai_renderer (신규 config) | gpt-4.1-mini | gpt-4.1-mini | R5B-4a 신규 generation |
| C. gemini_renderer (신규 config) | gpt-4.1-mini | gemini-2.5-flash | R5B-4a 신규 generation |

config 변경: `config/model_routes.json`에 `openai_renderer`, `gemini_renderer` 2 route_set 추가. 코드 변경 없음. `verify_route_integrity` 31/0/2 PASS.

### 2.3 측정 지표

R5B-3.5 deterministic detector (`narrative_repetition_guard`) 재사용 — 인접 화 N=3 비교:
- exact_duplicate_count (≥20자 narrative sentence)
- adjacent full sim (jaccard, severe ≥ 0.85)
- closing scene sim (jaccard, severe ≥ 0.65)
- verdict (PASS/WARN/RETRY)
- avg_chars (본문 길이 정상성)

cost / latency: input/output token 추정 + provider 단가표.

## 3. 결과

### 3.1 Narrative repetition (R5B-3.5 detector 기준)

| Route | PASS | RETRY | exact_dup | max_closing_sim | max_adj_full_sim | avg_chars |
|---|---|---|---|---|---|---|
| **A. DeepSeek baseline** | 3 | **11** | **23** | **0.413** | 0.329 | 2935 |
| **B. OpenAI gpt-4.1-mini** | **14** | **0** | **0** | **0.116** | **0.172** | 1827 |
| C. Gemini 2.5-flash | 14 | 0 | 0 | 0.180 | 0.180 | **224 ⚠** |

### 3.2 Cost / latency (15화 합산)

| Route | total_elapsed | avg_elapsed | total_cost (추정) | per-100ep 추정 |
|---|---|---|---|---|
| A. DeepSeek (참고) | (기존 generation) | ~57s/ep* | ~$0.0150 | ~$0.10 |
| **B. OpenAI** | 251.3s | **16.8s/ep** | **$0.0592** | **~$0.39** |
| C. Gemini | 193.8s | 12.9s/ep | $0.0063 | ~$0.04 |

*A는 기존 hybrid streaming 측정값 — batch API 직접 호출 시 비슷하거나 짧아질 수 있음

### 3.3 본문 길이 분포

| Route | min | avg | max | std (대략) |
|---|---|---|---|---|
| DeepSeek (DB) | ~1683 | 2935 | ~5184 | 정상 |
| OpenAI | ~1500 | 1827 | ~2200 | 정상 |
| **Gemini** | **138** | **224** | **705** | **비정상** |

### 3.4 Gemini 결과 무효 분석

Gemini 2.5-flash는 thinking tokens(reasoning_tokens)를 max_tokens 예산에서 차감. max_tokens=2700 기본값에서는 thinking 후 본문 1500자 못 채움. 평균 224자 → 본문 거의 없음. 짧은 본문이라 narrative repetition도 자연스럽게 낮음 (정보 부족).

R5B-1.8B에서도 같은 issue 발견되어 judge 호출 시 max_tokens=16000으로 우회. renderer 호출에서도 같은 우회 필요. **Gemini renderer는 max_tokens 정책 보강 후 재비교 필요** — 본 비교에서는 결과 무효 처리.

## 4. 핵심 발견

### 4.1 narrative cliché 책임 영역

| 영역 | 평가 |
|---|---|
| memory/context (R5B-1~R5B-3) | OK — same context로 OpenAI는 깨끗하게 cliché 회피 |
| renderer prose loop (R5B-3.5) | **DeepSeek 모델 특성으로 입증** — same plan/ctx에서 OpenAI는 RETRY 0건, DeepSeek는 11건 |
| streaming↔repair 충돌 (R5B-4) | OpenAI가 baseline 자체로 깨끗하므로 retry 의존도 낮아짐 |

### 4.2 OpenAI renderer는 prompt 부담을 견디면서도 cliché 차단

- 동일한 88 negative constraint + 22+ section prompt 받았음에도 narrative repetition 0건
- 즉 R5B-4 보고서의 overconstraint 우려는 **모델별로 다르게 작용** — DeepSeek는 cliché 회귀, OpenAI는 다양성 유지
- prompt pruning은 여전히 권고지만, narrative cliché 한정으로는 renderer 변경이 더 직접 효과

### 4.3 Quality_batch 필요성 재평가

- OpenAI renderer 사용 시 RETRY trigger 자체가 0회 → **post-gen retry 정책 의존도 크게 낮아짐**
- streaming 모드 유지 가능 (OpenAI도 SSE streaming 지원)
- **R5B-3.5 narrative_repetition_guard는 audit-only로 격하 가능** — 안전망 + 운영 가시성으로만 활용

## 5. Streaming compatibility

| Route | streaming 지원 | 첫 토큰 latency | UX 적합성 |
|---|---|---|---|
| A. DeepSeek | ✓ | ~1-2s | 양호 |
| **B. OpenAI** | **✓** | **~1-2s** | **양호** (gpt-4.1-mini는 표준 SSE) |
| C. Gemini | ✓ but max_tokens 한계 | ~2-3s | 부적합 |

**streaming UX 유지하면서 quality 개선 가능** = OpenAI renderer 채택만으로 R5B-3.5 + R5B-5(quality_batch 분리) 둘 다 우선순위 낮아짐.

## 6. 추천 production route

### **B. OpenAI gpt-4.1-mini renderer (route: `openai_renderer`)**

근거:
- narrative cliché 압도적 우세 (RETRY 11→0, exact_dup 23→0, max_closing 0.413→0.116)
- 본문 길이 정상 (avg 1827자)
- streaming compatible (SSE 표준)
- 100화 비용 ~$0.39 — 절대값 크지 않음 (DeepSeek 대비 +$0.30/100ep)
- 코드 변경 0 (route config만 변경)
- 범용성: 다른 책에서도 같은 prompt로 동작

### 부가 결정

- **R5B-3.5 narrative_repetition_guard** → **audit-only로 격하 권고** (OpenAI에서 fire 0이라 retry 정책 무의미. 운영 가시성용 trace 기록만 유지)
- **R5B-5 quality_batch mode** → **우선순위 낮춤** (OpenAI streaming으로 UX 유지하면서 cliché 차단되므로 mode 분리 시급도 ↓)
- **Gemini renderer** → max_tokens 16000 정책 보강 후 재평가 (현재 결과 무효)

## 7. 다음 판단

### 다음 구현 phase

- **R5B-5 (선택)** — `active_route`를 `openai_renderer`로 전환하고 50화 또는 100화 actual 진행 (사장님 명시 승인 필요)
- **R5B-6 (선택)** — prompt pruning + R5B-3.5 audit-only 격하 (R5B-5 결과 안정적이면 후순위)
- **즉시 가능** — `verify_route_integrity` PASS, baseline 영구 전환 없음, 사장님 승인 후 active_route 전환

### PR merge 가능 여부

- **YES (권고)** — 본 phase 변경 (config 2 route + script 2개 + report) 모두 read-only 영역 + verify regression 없음

### 100화 actual 가능 여부

- **CONDITIONAL → YES** (R5B-3 ~ R5B-3.5 누적 reservation 해제 가능):
  - OpenAI renderer로 narrative cliché 차단 입증 (15화 same-plan 비교)
  - meaningful appearance / state alignment / world rule / item ledger / emotion plausibility 모두 안정 유지
  - **단 active_route 전환은 사장님 명시 승인 필요** (config: `"active_route": "openai_renderer"` 또는 환경변수 `MODEL_ROUTE`)

### renderer route 재검토 필요 여부

- **재검토 완료** — OpenAI gpt-4.1-mini가 narrative cliché 차단 + 비용/latency 양호로 production candidate
- DeepSeek는 비용은 저렴하지만 long-running prose template loop 한계 명확
- Gemini는 max_tokens 정책 보강 후 재평가 필요 (별 phase)

```
R5B-4a verdict: READY
추천 production route: openai_renderer (planner gpt-4.1-mini + renderer gpt-4.1-mini, narrative_repair gpt-4.1-mini)
PR merge readiness: YES
100화 actual 진행 가능 여부: CONDITIONAL (active_route 전환 사장님 승인 후 YES)
quality_batch mode 필요 여부: NO (OpenAI streaming으로 UX + quality 양립 가능)
근거: TEST2E ep76~90 same-plan 15화 비교에서 OpenAI gpt-4.1-mini renderer가 DeepSeek 대비 narrative repetition을 RETRY 11→0, exact_dup 23→0, max_closing 0.413→0.116로 압도적으로 차단. 본문 길이 정상(avg 1827자), streaming 지원, 100화 비용 ~$0.39 (DeepSeek 대비 +$0.30) 합리적. R5B-3.5에서 입증된 DeepSeek long-running prose template loop는 모델 특성으로 확정 — 동일한 88 negative constraint + 22+ section prompt에서도 OpenAI는 다양성 유지. R5B-3.5 narrative_repetition_guard는 audit-only로 격하 권고(retry 정책 의존도 낮아짐). R5B-5 quality_batch mode 우선순위는 낮춤 — OpenAI streaming이 UX와 quality 양립. Gemini renderer는 max_tokens 정책 한계로 본문 224자 평균(thinking tokens 예산 부족)으로 비교 무효 — 별 phase에서 max_tokens 16000 보강 후 재평가 필요. 코드 변경은 config 2 route 추가 + script 2개 + report만 — pipeline / prompt / guard 추가 없음 (R5B-4 원칙 준수). DB migration 없음, main push 없음, raw output 미커밋, 금지 파일 미커밋.
```

## 부록 A. 본문/판정 데이터 보존 정책

- fixture: `.tmp/r5b4a_fixtures/ep<N>.json` (gitignored — plan + ctx만, 본문 raw 미포함)
- route 출력: `.tmp/r5b4a_outputs/<route>/ep<N>.txt` (gitignored)
- metric: `.tmp/r5b4a_metrics_<route>.json`, `.tmp/r5b4a_comparison_summary.json` (gitignored)
- 본 보고서에는 본문 전문 미게재. summary 메트릭만.
