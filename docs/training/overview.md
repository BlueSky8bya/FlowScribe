# FlowScribe 학습 아키텍처 (Training Architecture)

**최초 작성:** 2026-04-23  
**대상:** 운영 파이프라인 → SFT → Preference → RL 순차 확장

---

## 1. 왜 지금 학습 파이프라인이 필요한가

프롬프트 튜닝만으로 개선되지 않는 두 축이 존재한다.

| 문제 | 원인 | 처방 |
|---|---|---|
| 엔딩 훅 약함 | Planner가 hook_concrete_event를 추상적으로 생성 | **Planner RL/SFT** |
| 세계관 규칙 사건화 실패 | Planner의 world_rule 선택 오류 | **Planner SFT** |
| 장기 상태 드리프트 | 컨텍스트 RAG 부재 | Hybrid RAG (별도 작업) |
| revision 고분산 | revision 과잉 범위 | light cleanup으로 축소 |

---

## 2. 운영 경로 + 학습 경로 아키텍처

```
【운영 경로】
EffectiveContext
  → StateExtractor (결정론적)
  → CreativePlanner (LLM, temp=0.4) ← [LoRA adapter: data/checkpoints/planner-*/]
  → PlanMerge (결정론적)
  → PlanValidator (+Repair 예정)
  → Renderer (LLM, temp=0.85) ← [LoRA adapter: data/checkpoints/renderer-*/]
  → LightCleanup (formatting only)
  → ProseValidator (DeepSeek judge)
  → TraceLogger.save()  ← run_traces 테이블에 전체 궤적 저장

【학습 경로】
DB(run_traces)
  → DatasetBuilder (src/training/dataset_builder.ts)
      → data/datasets/planner_sft.jsonl
      → data/datasets/renderer_dpo.jsonl
      → data/datasets/preference_pairs.jsonl
  → RewardAggregator (src/training/reward_aggregator.ts)
      → data/rewards/computed_rewards.jsonl
  → (외부) LlamaFactory / Unsloth / TRL
      → data/checkpoints/planner-sft-v1/
      → data/checkpoints/planner-grpo-v1/
      → data/checkpoints/renderer-dpo-v1/
```

---

## 3. 컴포넌트 설명

### src/training/types.ts
- `RunTrace`: 파이프라인 한 번 실행의 전체 궤적
- `RewardBreakdown`: planner_reward + renderer_reward + combined_reward
- `PlannerSFTExample`: SFT 학습 데이터 형식 (instruction/output)
- `RendererDPOExample`: DPO 학습 데이터 형식 (chosen/rejected)

### src/training/trace_logger.ts
- `TraceLogger`: 파이프라인에서 각 단계 결과를 누적하여 run_traces에 저장
- `tracePool` 옵션으로 활성화 (미전달 시 no-op)
- 운영 미영향: 저장 실패 시 warn 로그만 남기고 계속

### src/training/reward_aggregator.ts
- Planner reward: plan 구조 점수 + hook 구체성 + fallback 페널티
- Renderer reward: prose 점수 + 위반 페널티 + revision 페널티
- RLMR(arXiv 2508.18642) 방식: 주관적 품질 + 객관적 제약 혼합

### src/training/dataset_builder.ts
- `buildPlannerSFTDataset()`: run_traces PASS 케이스 → JSONL
- `buildRendererDPODataset()`: 동일 컨텍스트 두 생성 → (chosen, rejected)
- `exportToJSONL()`: 파일 시스템 저장

### src/training/model_registry.ts
- 각 역할(planner/renderer/revision/judge/summarizer)에 어떤 모델을 쓸지 명시
- `PLANNER_MODEL` env로 planner 모델 독립 지정 가능 (현재 기본: STORY_MODEL과 동일)

### src/training/config.ts
- `PLANNER_SFT_CONFIG`: QLoRA, RTX 3080 기준
- `PLANNER_GRPO_CONFIG`: GRPO + rule-based reward
- `RENDERER_DPO_CONFIG`: DPO preference

---

## 4. DB 스키마 변경

**추가 테이블:**
- `run_traces`: 파이프라인 전체 궤적 저장 (src/db/migrate_v2.ts)

**확장 컬럼 (revision_logs):**
- `revised_text TEXT`: 수정된 전체 텍스트
- `validation_before JSONB`: 수정 전 ValidationResult
- `validation_after JSONB`: 수정 후 ValidationResult

---

## 5. 학습 적용 우선순위 로드맵

### Phase 0 — 지금 (구조 구현, 이번 작업)
- [x] src/training/ 골격 생성
- [x] run_traces 테이블 추가
- [x] plannerModel 레지스트리 분리 (llm.ts)
- [x] TraceLogger 파이프라인 주입
- [ ] seeded case_generator (다음 작업)
- [ ] PlanValidator repairPlan() (다음 작업)

### Phase 1 — 데이터 수집 (2주)
- 운영에서 tracePool 활성화
- PASS 케이스 50+ 수집
- `npm run train:build-planner-sft` 실행
- **목표:** planner_sft.jsonl 50+ 예시

### Phase 2 — Planner SFT
```bash
# LlamaFactory 예시
python llamafactory-cli train \
  --model_name_or_path qwen2.5:14b \
  --template qwen \
  --finetuning_type lora \
  --dataset data/datasets/planner_sft.jsonl \
  --output_dir data/checkpoints/planner-sft-v1 \
  --lora_rank 16
```

### Phase 3 — Planner GRPO (Phase 2 이후)
- TRL GRPOTrainer + rule_based_reward 함수 구현
- reward 함수: PlanValidator 8규칙 통과율 + hook 구체성

### Phase 4 — Renderer DPO
- preference pair 수집 (동일 컨텍스트 두 생성 비교)
- LiteraryTaste 방법론: 사용자 로그(완독률, 재생성 횟수)를 선호 신호로

---

## 6. 외부 참고 자료

| 주제 | 참고 |
|---|---|
| GRPO 장문 생성 | [RLMR arXiv 2508.18642](https://arxiv.org/abs/2508.18642) |
| Planner-Renderer 분리 학습 | [DOC v2 (Facebook Research)](https://github.com/facebookresearch/doc-storygen-v2) |
| 계층 요약 (training-free) | [NexusSum arXiv 2505.24575](https://arxiv.org/abs/2505.24575) |
| 일관성 RAG | [SCORE arXiv 2503.23512](https://arxiv.org/abs/2503.23512) |
| 사용자 선호 DPO | [LiteraryTaste arXiv 2511.09310](https://arxiv.org/abs/2511.09310) |
| QLoRA 구현 | [LlamaFactory](https://github.com/hiyouga/LlamaFactory), [Unsloth](https://unsloth.ai/) |
| 장기 일관성 버그 분류 | [Lost in Stories arXiv 2603.05890](https://arxiv.org/html/2603.05890v1) |

---

## 7. 제약 사항 (불변)

- `src/services/validator.ts`: R7-FREEZE — 변경 금지
- `src/services/revision.ts`: 동결 — 변경 금지  
- `src/services/story.ts`: legacy fallback 유지
- 1인칭 관찰자 자동 변환 금지
- hook/world 강화 프롬프트 운영 반영 금지
- legacy 경로 삭제 금지
