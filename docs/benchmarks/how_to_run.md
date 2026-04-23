# Benchmark 실행 방법

## 전제 조건

```bash
# 환경 변수 설정 (.env)
LLM_PROVIDER=ollama  # 또는 deepseek, openai, gemini
STORY_MODEL=gemma3:12b
ANTHROPIC_API_KEY=...  # validator/revision용

# DB 마이그레이션 (최초 1회)
npm run db:migrate
```

## 주요 Benchmark 명령

```bash
# Legacy 경로 benchmark
npm run bench:dev             # dev 세트 20케이스, 프롬프트A, revision ON
npm run bench:dev-supported   # 지원 POV 기준만 (1인칭 관찰자 제외)
npm run bench:holdout         # holdout 세트 20케이스, 프롬프트B, revision OFF
npm run bench:smoke           # smoke test 20케이스
npm run bench:full            # dev + holdout

# Planner→Renderer 경로 benchmark
npm run bench:planner         # 고정 14케이스 planner_renderer
npm run bench:ab-compare      # 고정 14케이스 legacy vs planner 동시 비교

# 단건 샘플 비교
npm run bench:sample sp-01    # sp-01 케이스, pipeline vs legacy 상세 비교
```

## 직접 실행 (고급)

```bash
# 케이스 수 지정
npx tsx scripts/benchmarks/test_runner.ts dev 10
npx tsx scripts/benchmarks/test_runner.ts planner_renderer 5
npx tsx scripts/benchmarks/test_runner.ts ab_compare 14

# 진단 스크립트
npx tsx scripts/diagnostics/gen_validate.ts --random medium
npx tsx scripts/diagnostics/pov_diag_runner.ts C
npx tsx scripts/diagnostics/protagonist_diag_runner.ts C raw 10
```

## 결과 저장 위치

```
logs/test_results/
├── dev_TIMESTAMP.json
├── dev_latest.json          # 최신 dev 결과 (항상 최신본)
├── dev_supported_latest.json
├── planner_renderer_TIMESTAMP.json
├── ab_compare_TIMESTAMP.json
└── ...
```

## 결과 해석

- `status: "in_progress"` → 실행 중 체크포인트 (크래시 복구용)
- `pass_rate` ≥ 90%, `fail_rate` = 0% → 종료 조건 달성
- `by_pov` 항목 → POV별 성과 분석
- `hard_violation_freq` → 가장 빈번한 위반 규칙

## 고정 케이스 세트 (fixtures)

`scripts/fixtures/ab_state_persistence_cases.ts` — 14케이스 고정 세트

- 14케이스, supported POV 4종 균형 배분
- 부상 있는 케이스: 7개 (상태 보존 민감성)
- 직전 화 여파 강한 케이스: 8개
- 재현성: 이 파일 자체가 seed, 랜덤 없음

## 유효 baseline

- **dev_supported**: avg=55, PASS 6%, FAIL 41% (2026-04-22, 17케이스)
- **planner sp-01**: WARN 70점 vs legacy FAIL 7점 (Δ+63)

## 주의

- `scripts/diagnostics/`의 스크립트는 일회성 실험용. 결과를 benchmark 기준으로 삼지 말 것.
- `scripts/experiments/`의 .mjs 파일은 레거시 RL 실험. 현재 파이프라인과 호환되지 않을 수 있음.
- test_runner.ts의 `buildGenPrompt()`는 story.ts와 의도적으로 다름 (state persistence A/B/C 적용).
