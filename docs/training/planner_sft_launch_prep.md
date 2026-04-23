# Planner SFT Launch Prep — Phase 1 완료 직후 실행 가이드

## 전제 조건

| 조건 | 확인 방법 |
|------|-----------|
| `is_planner_sft_eligible = true` trace ≥ 50개 | DB 쿼리 (아래 참조) |
| planner PASS율 ≥ 85% (최근 100건) | `diag:planner-eligibility` 재실행 |
| fallback 비율 ≤ 10% | DB 쿼리 |
| reward calibration 완료 | `train:calibrate-rewards` 실행 후 std ≥ 0.05 확인 |

```sql
-- 전제 조건 체크 쿼리
SELECT
  COUNT(*) FILTER (WHERE is_planner_sft_eligible) AS eligible,
  COUNT(*) AS total,
  ROUND(
    COUNT(*) FILTER (WHERE is_planner_sft_eligible)::numeric / COUNT(*) * 100, 1
  ) AS eligible_pct
FROM run_traces
WHERE trace_type = 'planner'
  AND created_at >= NOW() - INTERVAL '14 days';
```

---

## Step 1: 데이터셋 생성

```bash
npm run train:build-planner-sft
```

출력: `data/datasets/planner_sft.jsonl`

각 행 구조:
```json
{
  "id": "uuid",
  "instruction": "...(EffectiveContext → planner instruction)",
  "output": "{scene_plan JSON}",
  "metadata": {
    "trace_id": "...",
    "plan_verdict": "PASS",
    "final_score": 82.5,
    "created_at": "2026-05-01T..."
  }
}
```

### 품질 필터 (DatasetBuildConfig 기본값)

| 필터 | 기본값 | 조정 위치 |
|------|--------|-----------|
| `is_planner_sft_eligible` | `true` | DB 쿼리 조건 |
| `trace_type` | `'planner'` | DB 쿼리 조건 |
| `min_reward_delta_for_preference` | `0.1` | `src/training/types.ts` DEFAULT_DATASET_CONFIG |

50개 이하라면 `date_from` 조건을 제거하거나 수집 기간을 늘려라.

---

## Step 2: 데이터셋 검증

```bash
# 행 수 확인
wc -l data/datasets/planner_sft.jsonl

# 샘플 확인
head -1 data/datasets/planner_sft.jsonl | python3 -m json.tool | head -30
```

최소 기준:
- 행 수 ≥ 50
- instruction 필드 비어있지 않음
- output이 유효한 JSON (scene_beats, hook_type 포함)

---

## Step 3: SFT 학습 실행 (LlamaFactory 기준)

### 모델 선택

| 목적 | 권장 베이스 모델 | adapter 경로 |
|------|-----------------|-------------|
| planner SFT 초안 | `Qwen/Qwen2.5-14B-Instruct` | `adapters/planner_sft_v1/` |
| 경량 실험 | `Qwen/Qwen2.5-7B-Instruct` | `adapters/planner_sft_7b_v1/` |

현재 운영 모델: `qwen2.5:14b` (Ollama) — Qwen2.5-14B-Instruct와 동일 베이스.

### LlamaFactory 최소 config

```yaml
# configs/planner_sft_v1.yaml
model_name_or_path: Qwen/Qwen2.5-14B-Instruct
stage: sft
do_train: true
finetuning_type: lora
lora_rank: 16
lora_alpha: 32
lora_target: q_proj,v_proj

dataset: planner_sft
dataset_dir: data/datasets
template: qwen

output_dir: adapters/planner_sft_v1
num_train_epochs: 3
per_device_train_batch_size: 2
gradient_accumulation_steps: 4
learning_rate: 2.0e-4
lr_scheduler_type: cosine
warmup_ratio: 0.1
fp16: true
save_steps: 100
logging_steps: 10
```

### 실행

```bash
# LlamaFactory
llamafactory-cli train configs/planner_sft_v1.yaml

# 또는 Unsloth (메모리 효율)
python scripts/training/run_unsloth_sft.py --config configs/planner_sft_v1.yaml
```

### 데이터셋 포맷 변환 (LlamaFactory dataset_info.json)

```json
{
  "planner_sft": {
    "file_name": "planner_sft.jsonl",
    "columns": {
      "prompt": "instruction",
      "response": "output"
    }
  }
}
```

---

## Step 4: adapter 통합 및 검증

### Ollama 통합 (로컬 운영)

```bash
# GGUF 변환 후 Ollama Modelfile에 adapter 경로 지정
ollama create flowscribe-planner-v1 -f Modelfile
```

### 파이프라인 연결

`src/lib/llm.ts`에서 planner용 모델명을 `flowscribe-planner-v1`으로 변경.  
`src/pipeline/planner.ts`에서 `getPlannerModel()` 반환값 확인.

### 검증

```bash
# SFT 전후 비교
npm run diag:planner-eligibility 20 sft-compare-v1
```

목표: SFT 후 planner PASS율 ≥ 95%, reward 평균 ≥ 0.55.

---

## 참고: 현재 reward 분포 이슈

**현상:** planner_reward가 0.44~0.50에 집중 (std ≈ 0.03)

**원인:** `hook_concreteness`가 거의 모든 케이스에서 1로 평가됨  
→ 이진 분류이므로 분산 기여가 없음

**GRPO 사용 전 필수 조치:**
`reward_aggregator.ts`의 `hook_concreteness` 계산을 다단계로 변경:

```typescript
// 현재 (이진)
const hook_concreteness = planValidation.passed_checks.includes("hook_complete") ? 1 : 0;

// 권장 (다단계)
function scoreHookConcreteness(plan: ScenePlan): number {
  let score = 0;
  if (plan.hook_type)            score += 0.3;
  if (plan.hook_payload)         score += 0.3;
  if (plan.hook_concrete_event && plan.hook_concrete_event.length > 20) score += 0.4;
  return score;
}
```

**단, planner SFT는 reward 분산과 무관하므로 SFT 먼저 진행 가능.**  
GRPO 진입 전까지 calibration 개선.

---

## 타임라인

| 단계 | 조건 | 예상 시점 |
|------|------|-----------|
| Phase 1 수집 시작 | 지금 즉시 | 2026-04-24 |
| Phase 1 완료 | eligible trace 50개 | ~2주 후 |
| planner_sft.jsonl 생성 | Phase 1 완료 | ~2주 후 |
| planner SFT 학습 | jsonl 준비 완료 | ~3주 후 |
| SFT 모델 검증 | 학습 완료 | ~4주 후 |
| GRPO 진입 판단 | SFT 검증 + reward calibration 완료 | ~5-6주 후 |

---

## renderer 경로 (병행)

renderer는 현재 SFT보다 **DPO 우선**이 맞다.

이유:
1. renderer는 "어떤 출력이 더 좋은가" 비교가 SFT보다 효과적
2. planner SFT 후 플래너가 더 나은 plan을 생성하면 renderer DPO의 winning/losing pair 품질도 향상
3. renderer DPO scaffold는 `src/training/dataset_builder.ts`에 이미 존재

renderer DPO 시작 조건: planner SFT 학습 완료 후.
