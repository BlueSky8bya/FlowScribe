# 실험 이력 요약

## 채택된 실험 결과

### 1. POV Variant C 채택 (2026-04-22)
- **파일:** `scripts/diagnostics/pov_diag_runner.ts`
- **결과:** Variant C (rules-only) avg=67 POV위반=2, FAIL=0 → 최우수
- **채택:** `src/lib/pov_rules.ts:variantCPovRule()` — benchmark/service 공유
- **영구 금지:** Variant B (few-shot): 교차 시점 위반 0→5

### 2. 1인칭 주인공 오프닝 앵커 (2026-04-22)
- **파일:** `scripts/diagnostics/protagonist_diag_runner.ts`
- **결과:** Variant C(앵커): POV위반 7→5, avg 57→61
- **주의:** revision이 1인칭 주인공 케이스를 오히려 악화 (FAIL 3→4)
- **채택:** `src/lib/pov_rules.ts` 1인칭 주인공 규칙에 앵커 포함

### 3. State Persistence A/B/C (2026-04-22)
- **파일:** `scripts/diagnostics/ab_state_persistence_runner.ts`
- **케이스:** `scripts/fixtures/ab_state_persistence_cases.ts` (14케이스 고정)
- **결과:** A+B+C 조합이 일관된 개선 (위반 감소)
- **채택:** `scripts/benchmarks/test_runner.ts:buildGenPrompt()` 내 적용

### 4. Planner→Renderer 파이프라인 (2026-04-23)
- **파일:** `src/pipeline/`, `scripts/benchmarks/planner_sample_runner.ts`
- **결과:** sp-01 케이스: Planner WARN 70점 vs Legacy FAIL 7점 (Δ+63)
- **채택:** `src/pipeline/index.ts:runPlannerPipeline()` — 주 경로 후보
- **진입점:** `POST /api/generate-v2` + `use_planner=true`

## 거부된 실험 결과

### Hook/World 강화 프롬프트 (2026-04-22)
- **파일:** `scripts/diagnostics/ab_hook_world_runner.ts`
- **결과:** C 판정 — avg -8점, FAIL +29%, 상태 모순 0→2 (오히려 악화)
- **결론:** 본 반영 금지. 파일은 실험 기록으로 보존.

## 레거시 RL 실험 (`scripts/experiments/`)

| 파일 | 설명 | 상태 |
|---|---|---|
| `longrun_test.mjs` | 30화 장기 연속 생성 | 아카이브 (qwen2.5:14b 기준 93/100) |
| `longrun_100_test.mjs` | 100화 장기 생성 | 아카이브 (87/100) |
| `mega_tune.mjs`, `mega_tune_v2.mjs` | Modelfile 자동 튜닝 | 아카이브 |
| `multi_world_test.mjs` | 다중 세계관 테스트 | 아카이브 |
| `advanced_test.mjs` | 10화 완결 종합 | 아카이브 |

결과 JSON: `logs/archives/rl_tuning/`

## 진행 중인 실험

없음 (2026-04-23 기준). 다음 실험 후보:
- Planner 14케이스 배치 ab_compare로 전체 효과 측정
- Plan Validator auto-repair (WARN → PASS 전환)
- Structured output 기반 Renderer (hook 마커 보장)
