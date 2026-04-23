# Phase 1 Launch Guide — Planner Trace 수집 운영 절차

## 상태 요약 (2026-04-24 기준)

| 항목 | 상태 |
|------|------|
| run_traces 테이블 | ✅ DB 생성 완료 (`npm run db:migrate`) |
| TraceLogger 코드 연결 | ✅ `src/training/trace_logger.ts` |
| generate_v2 tracePool 연결 | ✅ `enable_trace: true` 플래그로 활성화 |
| planner eligibility 실측 | ✅ 93% (13/14, seed=planner-eligibility-v1) |
| 수집 시작 가능 여부 | ✅ **즉시 가능** |

---

## 1. trace 수집 시작 방법

### API 요청 파라미터 변경

기존 planner 요청에 `enable_trace: true`를 추가한다.

```json
POST /api/generate-v2
{
  "book_id": "...",
  "episode": 5,
  "use_planner": true,
  "enable_trace": true
}
```

`use_planner: false` (레거시 경로)에서는 `enable_trace`가 무시된다.
`enable_trace` 미전달 시 기본값은 `false` — 기존 동작 유지.

### 저장 경로

`run_traces` 테이블에 자동 저장. 실패는 silent (생성 자체를 중단하지 않음).

---

## 2. 모니터링 항목 (2주 수집 기간)

### 필수 모니터링 (매일)

```sql
-- eligible trace 누적 수
SELECT COUNT(*) FROM run_traces WHERE is_planner_sft_eligible = true;

-- fallback 비율
SELECT
  COUNT(*) FILTER (WHERE (planner_trace->>'fallback_used')::boolean = true) AS fallback_n,
  COUNT(*) AS total
FROM run_traces WHERE trace_type = 'planner';

-- plan_validation 분포
SELECT
  plan_validation->>'verdict' AS verdict,
  COUNT(*) AS n
FROM run_traces
WHERE plan_validation IS NOT NULL
GROUP BY 1;
```

### 목표 수치

| 지표 | 목표 | 중단 기준 |
|------|------|-----------|
| is_planner_sft_eligible | ≥ 50개 (2주 내) | - |
| planner PASS율 | ≥ 85% | < 60% → 즉시 점검 |
| fallback 비율 | ≤ 10% | > 30% → 즉시 점검 |
| 평균 planner_reward | ≥ 0.45 | - |
| trace 저장 실패율 | ≤ 5% | > 20% → DB 점검 |

### 선택 모니터링 (주 1회)

```sql
-- reward 분포
SELECT
  MIN((breakdown->>'planner_reward')::float) AS min_r,
  AVG((breakdown->>'planner_reward')::float) AS avg_r,
  MAX((breakdown->>'planner_reward')::float) AS max_r
FROM run_traces, jsonb_array_elements(COALESCE(plan_validation, '[]')) AS breakdown
WHERE is_planner_sft_eligible = true;

-- 일별 수집량
SELECT
  DATE(created_at) AS day,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE is_planner_sft_eligible) AS eligible
FROM run_traces
GROUP BY 1
ORDER BY 1;
```

---

## 3. 수집 목표

| 기간 | 목표 eligible trace | 비고 |
|------|---------------------|------|
| 1주차 | 25개 이상 | 수집 속도 검증 |
| 2주차 | 50개 이상 | planner SFT 학습 시작 조건 |

`is_planner_sft_eligible = true` 정의:
- `plan_validation.verdict === "PASS"` (repair 후 포함)
- `plan_fallback_used === false`

---

## 4. 비활성화 / 롤백 방법

### trace 수집만 중단 (생성 영향 없음)

`enable_trace: true` 파라미터를 제거하거나 `false`로 변경.  
생성 파이프라인 자체는 변경 없이 계속 작동.

### 전체 planner 비활성화

`use_planner: false` — 레거시 경로로 즉시 폴백.  
기존 `story.ts` 경로 유지 완료.

### run_traces 테이블 격리

수집 중단 후 테이블을 건드리지 않아도 됨.  
`DatasetBuilder`는 `is_planner_sft_eligible = true` 행만 읽으므로  
품질 미달 trace가 학습 데이터에 포함되지 않음.

---

## 5. Phase 1 완료 조건 및 다음 단계

### Phase 1 완료 조건

1. `is_planner_sft_eligible = true` trace ≥ 50개
2. planner PASS율 ≥ 85% (일관성 확인)
3. fallback 비율 ≤ 10%

### 완료 후 즉시 실행

```bash
npm run train:build-planner-sft
# → data/datasets/planner_sft.jsonl 생성
```

### planner SFT 학습 시작

`docs/training/planner_sft_launch.md` 참조 (Phase 1 완료 후 작성 예정).

---

## 참고: 관련 파일

| 파일 | 역할 |
|------|------|
| `src/api/generate_v2.ts` | `enable_trace` 플래그 처리 |
| `src/pipeline/index.ts` | `tracePool` 전달 |
| `src/training/trace_logger.ts` | run_traces 테이블 저장 |
| `src/training/dataset_builder.ts` | eligible trace → jsonl 변환 |
| `src/db/migrate_v2.ts` | run_traces 테이블 DDL |
| `scripts/diagnostics/planner_eligibility_runner.ts` | eligibility 실측 진단 |
