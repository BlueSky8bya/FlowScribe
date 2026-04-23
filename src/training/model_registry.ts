/**
 * src/training/model_registry.ts — 모델 역할 레지스트리
 *
 * 각 파이프라인 역할에 어떤 모델을 쓸지 명시적으로 관리한다.
 * 환경 변수로 오버라이드 가능.
 *
 * 현재: Planner/Renderer 모두 storyModel 사용
 * 목표: Planner 전용 LoRA 어댑터 학습 후 plannerModel로 분리
 */

import { getStoryModel, getSummaryModel } from "../lib/llm.js";

export type ModelRole =
  | "planner"    // CreativePlanner — JSON 구조 생성 (temp=0.4)
  | "renderer"   // Renderer — 소설 본문 생성 (temp=0.85)
  | "revision"   // Revision — light cleanup (temp=0.5)
  | "judge"      // ProseValidator — 품질 평가 (DeepSeek 고정)
  | "summarizer" // Rolling summary, arc memory 압축

export interface ModelConfig {
  role: ModelRole;
  model_id: string;
  temperature: number;
  adapter_path?: string;  // LoRA 어댑터 경로 (학습 후 활성화)
  notes: string;
}

/** 현재 활성 모델 역할 설정 */
export function getModelConfigs(): ModelConfig[] {
  return [
    {
      role: "planner",
      model_id: process.env.PLANNER_MODEL ?? getStoryModel(),
      temperature: 0.4,
      adapter_path: process.env.PLANNER_ADAPTER_PATH,
      notes: "JSON 구조 생성 특화. Phase 1 SFT 이후 전용 어댑터로 교체 예정.",
    },
    {
      role: "renderer",
      model_id: process.env.RENDERER_MODEL ?? getStoryModel(),
      temperature: 0.85,
      adapter_path: process.env.RENDERER_ADAPTER_PATH,
      notes: "창의적 소설 본문 생성. Phase 2 DPO 이후 전용 어댑터 옵션.",
    },
    {
      role: "revision",
      model_id: process.env.REVISION_MODEL ?? getStoryModel(),
      temperature: 0.5,
      notes: "light cleanup 전용. 전체 재생성 아님. revision.ts R7-FREEZE 유지.",
    },
    {
      role: "judge",
      model_id: "deepseek-chat",
      temperature: 0.1,
      notes: "DeepSeek API 고정. validator.ts R7-FREEZE 유지.",
    },
    {
      role: "summarizer",
      model_id: process.env.SUMMARY_MODEL ?? getSummaryModel(),
      temperature: 0.3,
      notes: "롤링 요약, 아크 압축. NexusSum 계층화 예정.",
    },
  ];
}

export function getModelForRole(role: ModelRole): string {
  return getModelConfigs().find(c => c.role === role)?.model_id ?? getStoryModel();
}

export function getAdapterForRole(role: ModelRole): string | undefined {
  return getModelConfigs().find(c => c.role === role)?.adapter_path;
}

export function printModelRegistry(): void {
  console.log("\n[ModelRegistry] 현재 모델 역할 할당:");
  for (const cfg of getModelConfigs()) {
    const adapter = cfg.adapter_path ? ` [adapter: ${cfg.adapter_path}]` : "";
    console.log(`  ${cfg.role.padEnd(12)}: ${cfg.model_id}${adapter}`);
  }
  console.log();
}
