# FlowScribe 아키텍처: 현재 vs 목표

## 현재 구조 (2026-04-23 기준)

```
FlowScribe/
├── src/
│   ├── index.ts                  # Express 서버 엔트리포인트
│   ├── api/                      # 12개 API 라우터
│   │   ├── generate.ts           # Legacy GET SSE 생성 (유지)
│   │   └── generate_v2.ts        # POST 구조화 생성 + planner 옵션 추가됨
│   ├── services/
│   │   ├── story.ts              # Legacy 생성기 (fallback 유지)
│   │   ├── validator.ts          # R7-FREEZE (변경 금지)
│   │   ├── revision.ts           # 동결 (변경 금지)
│   │   ├── effective_context.ts  # DB → EffectiveContext 조립기
│   │   └── character_state.ts, profile.ts, foreshadow.ts, arc_memory.ts, logger.ts
│   ├── pipeline/                 # Planner→Renderer 주 경로
│   │   ├── index.ts              # 7단계 파이프라인 오케스트레이터
│   │   ├── state_extractor.ts    # 결정론적 상태 추출
│   │   ├── planner.ts            # LLM 창의적 계획 (temp=0.4)
│   │   ├── plan_validator.ts     # 구조 검증 (결정론적)
│   │   └── renderer.ts           # 계획→소설 렌더러 (temp=0.85)
│   ├── types/
│   │   ├── canonical.ts          # 전체 공유 타입
│   │   ├── pov_policy.ts         # POV 지원 정책
│   │   ├── character_policy.ts   # 인물 등장/이름 정책
│   │   └── planner.ts            # 파이프라인 전용 타입
│   ├── lib/
│   │   ├── pov_rules.ts          # re-export shim → src/policies/pov_rules.ts
│   │   ├── character_policy_resolver.ts  # re-export shim → src/policies/
│   │   ├── name_classifier.ts
│   │   ├── llm.ts, db.ts, redis.ts, logger.ts, startup.ts
│   ├── policies/                 # 도메인 정책 레이어 (2026-04-23 분리)
│   │   ├── pov_rules.ts          # Variant C POV 규칙 + 미지원 POV 처리 (실제 구현)
│   │   ├── character_policy_resolver.ts  # 인물 등장 정책 리졸버 (실제 구현)
│   │   └── index.ts              # 정책 레이어 공개 API
│   ├── db/
│   │   ├── migrate_v2.ts         # V2 스키마 (실제 사용)
│   │   └── migrate.ts            # V1 스키마 (레거시, 보존)
│   └── queues/
│       ├── index.ts              # 4개 큐 정의
│       └── worker.ts             # log_save, profile_update, audio_sync 워커
│
├── scripts/
│   ├── benchmarks/               # 운영 benchmark (자동화 대상)
│   │   ├── test_runner.ts        # 메인 runner (dev/holdout/smoke/planner_renderer/ab_compare)
│   │   ├── case_generator.ts     # 랜덤 TestCase 생성기
│   │   └── planner_sample_runner.ts  # 단건 pipeline vs legacy 비교
│   ├── fixtures/                 # 고정 케이스 데이터 (재현성 기준선)
│   │   ├── ab_state_persistence_cases.ts  # 14케이스 고정 세트
│   │   ├── pov_diag_cases.ts
│   │   └── protagonist_diag_cases.ts
│   ├── diagnostics/              # 실험/진단 스크립트
│   │   ├── gen_validate.ts       # 단건 생성+검증 CLI
│   │   ├── pov_diag_runner.ts    # POV variant 비교
│   │   ├── protagonist_diag_runner.ts  # 1인칭 주인공 진단
│   │   ├── ab_state_persistence_runner.ts  # state persistence A/B
│   │   └── ab_hook_world_runner.ts         # hook/world 실험 (C 판정, 미채택)
│   └── experiments/              # 레거시 RL/튜닝 실험 (.mjs)
│       └── ... (보존, 추가 실행 없음)
│
└── docs/
    ├── architecture/
    │   ├── current_vs_target.md  # 이 파일
    │   └── pipeline.md           # 파이프라인 상세
    ├── policies/
    │   ├── pov_policy.md
    │   └── character_policy.md
    ├── benchmarks/
    │   └── how_to_run.md
    └── experiments/
        └── summary.md
```

## 레이어 원칙

| 레이어 | 책임 | 변경 주기 |
|---|---|---|
| `src/types/` | 타입 정의만 | 기능 추가 시 |
| `src/lib/` | 순수 유틸, 외부 클라이언트 | 낮음 |
| `src/services/` | 런타임 서비스, DB 접근 | 중간 |
| `src/pipeline/` | 파이프라인 단계 | 실험 후 반영 |
| `src/api/` | HTTP 레이어, 라우팅 | 낮음 |
| `scripts/benchmarks/` | 재현 가능 benchmark | 정책 결정 후 |
| `scripts/diagnostics/` | 일회성 실험 | 자유 |

## 핵심 구조 결정 사항

1. **validator.ts / revision.ts 동결**: R7-FREEZE (2026-04-21). 벤치마크 비교 기준선으로 불변 유지.
2. **story.ts fallback 유지**: generate.ts(레거시 GET), generate_v2.ts use_planner=false 시 사용.
3. **POV 정책 집중화**: `src/types/pov_policy.ts` + `src/lib/pov_rules.ts`. 모델 교체 시 `ACTIVE_POV_POLICY` 상수만 교체.
4. **1인칭 관찰자 자동 변환 금지**: 진단 결과 gemma3:12b에서 100% 위반. 생성 시도는 허용, benchmark 제외.
5. **state persistence A/B/C**: `scripts/benchmarks/test_runner.ts`의 `buildGenPrompt()` 내 적용됨. story.ts와 의도적으로 다르게 유지 (benchmark용 프롬프트 vs 서비스용 프롬프트 분리).
