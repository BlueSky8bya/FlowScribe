/**
 * src/training/config.ts — 학습 설정 스키마 및 기본값
 *
 * 환경 변수 또는 data/training_config.json으로 오버라이드 가능.
 */

export interface TrainingConfig {
  // 학습 대상 모델
  base_model: string;
  adapter_output_dir: string;

  // 학습 방식
  method: "sft" | "dpo" | "grpo" | "kto";
  use_qlora: boolean;
  lora_rank: number;
  lora_alpha: number;
  lora_dropout: number;

  // 데이터
  train_dataset: string;
  eval_dataset?: string;
  max_seq_length: number;

  // 학습 파라미터
  per_device_train_batch_size: number;
  gradient_accumulation_steps: number;
  learning_rate: number;
  num_train_epochs: number;
  warmup_ratio: number;
  lr_scheduler_type: string;

  // GRPO 전용
  grpo?: {
    reward_funcs: string[];   // reward function 이름 목록
    num_generations: number;  // 그룹 크기 (default: 8)
    max_new_tokens: number;
    temperature: number;
    beta: number;             // KL divergence 페널티 계수
  };

  // 로깅
  logging_steps: number;
  save_steps: number;
  eval_steps: number;
}

/** Planner SFT 기본 설정 (QLoRA, RTX 3080 기준) */
export const PLANNER_SFT_CONFIG: TrainingConfig = {
  base_model: process.env.STORY_MODEL ?? "qwen2.5:14b",
  adapter_output_dir: "data/checkpoints/planner-sft-v1",
  method: "sft",
  use_qlora: true,
  lora_rank: 16,
  lora_alpha: 32,
  lora_dropout: 0.05,
  train_dataset: "data/datasets/planner_sft.jsonl",
  eval_dataset: "data/datasets/planner_sft_eval.jsonl",
  max_seq_length: 4096,
  per_device_train_batch_size: 1,
  gradient_accumulation_steps: 8,
  learning_rate: 2e-4,
  num_train_epochs: 3,
  warmup_ratio: 0.1,
  lr_scheduler_type: "cosine",
  logging_steps: 10,
  save_steps: 100,
  eval_steps: 50,
};

/** Planner GRPO 기본 설정 */
export const PLANNER_GRPO_CONFIG: TrainingConfig = {
  ...PLANNER_SFT_CONFIG,
  adapter_output_dir: "data/checkpoints/planner-grpo-v1",
  method: "grpo",
  learning_rate: 1e-5,
  num_train_epochs: 1,
  grpo: {
    reward_funcs: ["plan_structure_reward", "hook_concreteness_reward"],
    num_generations: 8,
    max_new_tokens: 512,
    temperature: 0.4,
    beta: 0.04,
  },
};

/** Renderer DPO 기본 설정 */
export const RENDERER_DPO_CONFIG: TrainingConfig = {
  ...PLANNER_SFT_CONFIG,
  adapter_output_dir: "data/checkpoints/renderer-dpo-v1",
  method: "dpo",
  train_dataset: "data/datasets/renderer_dpo.jsonl",
  lora_rank: 32,
  learning_rate: 5e-5,
};
