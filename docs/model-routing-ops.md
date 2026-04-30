# Model Routing Ops SOP

> `config/model_routes.json` 9개 route × 6+ task slot 운영 지침.
> 상세 진단·구현안: `model-routing-ops-proposal.md`.

---

## 1. 현재 상태

```jsonc
{
  "active_route": "baseline_local",     // ★ qwen2.5:14b 단독 (Ollama)
  "fallback_route": "baseline_local",
  "available": [
    "baseline_local",                      // 운영용? 개발용? 라벨 없음
    "deepseek_renderer",
    "deepseek_planner",
    "deepseek_full",
    "gemini_planner_deepseek_renderer",
    "high_quality_ensemble",               // OpenAI planner + DeepSeek renderer
    "gemma3_12b_fast_local",
    "gemma3_27b_full_local",
    "gemma3_27b_planner_deepseek_renderer"
  ]
}
```

각 route는 task slot을 정의:
- `world_setting_suggest`
- `planner`
- `renderer`
- `narrative_repair`
- `post_validator`
- `post_revision`
- (multi) `reader_immersion_judge`

총 ~54 mapping.

## 2. per-request override

```
GET /api/generate?...&model_route=high_quality_ensemble
```

per-request로 active_route를 override 가능 (Phase 4.18B). 단:
- trace에 `route_metadata` 기록되나 intent 라벨 없음 → DPO 분석 시 모델 혼합 데이터 위험
- 현재 사용자가 평소엔 baseline_local, smoke 시 HQE 사용 — **혼합 trace 유의**

## 3. R9 (proposal)에서 도입할 intent mode

```jsonc
{
  "active_mode": "production",
  "modes": {
    "production":         "high_quality_ensemble",
    "production_offline": "gemma3_27b_full_local",
    "offline_dev":        "baseline_local",
    "smoke_local":        "gemma3_12b_fast_local"
  },
  "active_route":  "baseline_local",      // backward compat
  "fallback_route":"baseline_local"
}
```

각 route에 `intent` 필드 추가. trace metadata에 mode/intent 기록.

## 4. 현재 알려진 문제

- 100화 actual 전 `active_route` 영구 전환 결정 보류 — **사장 결정 필요**
- legacy path (`use_planner=false`)는 model_router를 거치지 않음 — R9.2에서 차단
- `reader_immersion_judge` multi_route는 Gemini + OpenAI 2개 병렬 — 비용/시간. R9에서 mode별 차등화

## 5. 변경 시 verify

```bash
node scripts/verify_route_integrity.mjs
```

각 route의 task slot 완전성 + intent 필드 (R9 후) 확인.

## 6. 운영 결정 포인트

- **언제 active_route를 production으로 전환?** R10.0 smoke 5화에서 비용/품질 확인 후 사장 결정
- **fallback은 production_offline?** 외부 API 차단/장애 시 자동 전환
- **DPO 수집 trace의 route 일관성?** intent 라벨로 split 가능

## 7. 디버깅 체크리스트

### "high_quality_ensemble로 호출했는데 baseline_local 응답"
1. URL 파라미터 `?model_route=` spelling 확인
2. `verify_route_integrity` PASS 확인
3. logger의 `route_metadata` 필드 확인
4. legacy path로 빠지지 않았는지 (`use_planner=true`)

### "Gemini 가 호출 안 됨"
1. `.env`에 GOOGLE_API_KEY 설정 확인 (커밋 절대 금지)
2. resolveTaskRoute()에서 provider 사용 가능 여부 체크
3. multi_route mode 정의 확인

## 8. 금지

- ❌ 사장 승인 없는 `active_route` 영구 변경
- ❌ API key를 logger / commit / 응답에 노출
- ❌ legacy path에 새 route 도입 (R9.2 차단 예정)
- ❌ 비용 큰 multi_route를 critical path에 활성화 (judge는 audit-only)
