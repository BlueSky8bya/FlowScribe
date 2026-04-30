# Model Routing Ops Proposal — Phase 4.20

> 본 문서는 `config/model_routes.json`의 9개 route + 6개 task slot 매핑을 정리하고,
> 운영/개발/오프라인/평가 4개 환경별 default route를 제안한다.

---

## 1. 현재 상태

```jsonc
{
  "active_route": "baseline_local",
  "fallback_route": "baseline_local",
  "available": [
    "baseline_local",
    "deepseek_renderer",
    "deepseek_planner",
    "deepseek_full",
    "gemini_planner_deepseek_renderer",
    "high_quality_ensemble",
    "gemma3_12b_fast_local",
    "gemma3_27b_full_local",
    "gemma3_27b_planner_deepseek_renderer"
  ]
}
```

각 route는 6+개 task slot을 정의:
- `world_setting_suggest`
- `planner`
- `renderer`
- `narrative_repair`
- `post_validator`
- `post_revision`
- (추가) `reader_immersion_judge` (multi_routes)

총 ~54개 mapping.

---

## 2. 진단

### 2.1 의미 라벨 부재

route 이름은 model 조합을 묘사하지만 **운영 의도** 라벨이 없다:
- `baseline_local` — 운영용? 개발용? 오프라인용?
- `high_quality_ensemble` — 운영 default여야 하나? smoke용?
- `gemma3_27b_full_local` — production 후보?

사용자(오너)가 매번 결정해야 하는 상태. 100화 actual 전 `active_route` 영구 전환 결정 보류 중인 것도 이 모호성 때문.

### 2.2 per-request override의 일관성

`?model_route=high_quality_ensemble` 가능 (Phase 4.18B). 그러나:
- 사용자가 UI에서 평소엔 baseline_local로 생성하다가 한 번 HQE로 생성하면 그 회차의 trace에 route_metadata가 다르게 남음
- 다음 회차가 HQE 회차를 prev_episode_tail로 사용하면 모델별 문체 변화 누적
- DPO/training trace에서 route 혼합 데이터 → reward signal noise

### 2.3 legacy path

`use_planner=false` legacy path는 model_router를 거치지 않고 `getRendererModel()` 직접 호출. route 관리 외부.

### 2.4 multi_routes (judge)

`reader_immersion_judge`가 Gemini + OpenAI 2개 모델 병렬. 비용/시간 큼. 일반 generation에는 불필요.

---

## 3. 제안: 운영 의도 라벨 + 4개 default

### 3.1 의도 라벨

각 route에 `intent` 필드 추가 (코드 변경 없이 metadata):

```jsonc
{
  "available": [
    {
      "name": "baseline_local",
      "intent": "offline_dev",        // 인터넷 없이 개발
      "description": "ollama qwen/gemma 단독, 외부 API 의존 없음"
    },
    {
      "name": "high_quality_ensemble",
      "intent": "production",         // 운영 default 후보
      "description": "OpenAI planner + DeepSeek renderer, 최고 품질"
    },
    {
      "name": "gemma3_27b_full_local",
      "intent": "production_offline", // 외부 API 차단 시 운영 후보
      "description": "Gemma3 27B 단독, API 없이 고품질"
    },
    {
      "name": "deepseek_full",
      "intent": "cost_optimized",     // 양 vs 가격 균형
      "description": "DeepSeek planner+renderer, 저비용 합리"
    },
    {
      "name": "gemma3_12b_fast_local",
      "intent": "smoke_local",        // 빠른 sanity check
      "description": "Gemma3 12B 단독 fast"
    },
    // ... 등
  ]
}
```

### 3.2 4개 default

| Mode | 기본 route | 사용 시점 |
|---|---|---|
| `production` | `high_quality_ensemble` | 사용자 운영 — 100화 actual, smoke book 평가 |
| `production_offline` | `gemma3_27b_full_local` | API 차단 시 fallback |
| `offline_dev` | `baseline_local` | 인터넷 없이 코드 개발 |
| `smoke_local` | `gemma3_12b_fast_local` | 빠른 회귀 테스트 |

`active_route`를 직접 지정하지 않고 mode 선언:

```jsonc
{
  "active_mode": "production",     // production / production_offline / offline_dev / smoke_local
  "modes": {
    "production":          "high_quality_ensemble",
    "production_offline":  "gemma3_27b_full_local",
    "offline_dev":         "baseline_local",
    "smoke_local":         "gemma3_12b_fast_local"
  },
  // 기존 active_route는 backward compat 위해 유지
  "active_route": "baseline_local",
  "fallback_route": "baseline_local"
}
```

resolveTaskRoute()에서 `active_mode` 우선, 없으면 `active_route` fallback.

### 3.3 per-request override 일관화

`?model_route=` 외에 `?intent=production`도 허용. 라벨 기반.

trace에 `route_metadata.intent` 기록 → DPO 수집 시 의도 별 분리 가능.

### 3.4 legacy path 차단

`use_planner=false` 받으면:
- 412 응답 + "use_planner=true 필수" 에러
- 또는 자동으로 use_planner=true로 강제

DPO 수집 누락 방지 + route 일원화.

---

## 4. judge multi_route 비용 절감

`reader_immersion_judge`는 현재 Gemini + OpenAI 2개 병렬. 평가용으로만 사용:
- training/audit path에서만 호출
- generation critical path 절대 미진입 (이미 그러함, 확인)
- 운영 default에서는 single model (예: Gemini만)
- production_offline에서는 disable

config:
```jsonc
{
  "multi_routes": {
    "reader_immersion_judge": {
      "production":         { "models": ["gemini", "openai"] },
      "production_offline": { "models": [] },             // disable
      "offline_dev":        { "models": [] },
      "smoke_local":        { "models": ["gemini"] }
    }
  }
}
```

---

## 5. route metadata 검증

### 5.1 각 route의 task slot 완전성

`scripts/verify_route_integrity.mjs` 이미 있음. 다음 체크 추가:
- 각 route에 6개 task slot 모두 정의
- `intent` 필드 존재
- multi_route mode별 정의

### 5.2 trace에 route 기록

`trace_logger.ts`의 `route_metadata`:
- `route_name`
- `intent`
- 각 task별 model
- (추가) request에서 override 여부

---

## 6. 100화 actual 전 결정사항

| 항목 | 결정 필요 |
|---|---|
| active_mode = "production"으로 영구 전환할 것인가? | 사용자 결정 |
| HQE 비용 (OpenAI gpt-4.1-mini × planner 100회 + DeepSeek × renderer 100회) | 견적 필요 |
| API key 누출 방지 — production mode 전환 시 .env 점검 | spec 명시됨 |
| fallback_route를 production_offline (gemma3_27b)으로 둘 것인가? | 외부 API 차단 시 자동 fallback |

---

## 7. 단계적 적용 (R9)

### R9.0 — Mode metadata 추가
- config에 `active_mode`, `modes`, `intent` 필드 추가
- `active_route`는 backward compat 유지
- model_router에서 active_mode 우선 read

### R9.1 — Trace metadata 강화
- route_metadata에 intent 기록
- 평가 dashboards intent별 split

### R9.2 — Legacy path 차단
- use_planner=false → 412 또는 auto-redirect

### R9.3 — Mode 영구 전환
- 사용자가 `active_mode: "production"` 결정 후 commit
- HQE 100화 actual 전 한 회차 smoke로 비용/품질 확인

---

## 8. 결론

route 9개 × task 6개 = 54 매핑은 풍부하지만 **운영 의도가 모호**. mode 라벨 4개로 정리하고 default를 명확히. legacy path 차단으로 일원화. R9 단계적 적용.
