/**
 * llm_tasks.ts — Phase 4.12 LLM Task Taxonomy
 *
 * 모든 LLM 호출은 task type을 갖는다. router는 task → provider/model 매핑을 결정한다.
 * 새 호출 사이트는 반드시 task type 중 하나로 분류되어야 한다.
 */

export type LLMTask =
  // 추천 계열 — 빠름/저비용/JSON 안정성 중요
  | "world_setting_suggest"
  | "rules_suggest"
  | "mood_suggest"
  | "character_suggest"
  | "item_detail_suggest"
  | "style_direction_suggest"

  // 생성 코어
  | "planner"               // 장기 문맥 + 상태 일관성 + JSON
  | "renderer"              // 한국어 문장력 + 몰입감
  | "state_extractor"       // JSON 정확도 + 사실 추출

  // 메모리 / 분석
  | "summary_writer"        // 요약/롤링 압축
  | "arc_summary_writer"    // 아크 요약 — 장기 일관성
  | "foreshadow_reasoning"  // 복선 추출/회수 판단
  | "item_description"      // 아이템 묘사

  // 후처리
  | "narrative_repair"      // 단락 단위 수정
  | "post_validator"        // 본문 검증
  | "post_revision"         // 본문 리비전

  // Judge
  | "reader_immersion_judge"   // Gemini/OpenAI dual judge 후보
  | "knowledge_boundary_judge"
  | "action_affordance_judge"
  | "judge_synthesis";          // 다중 judge 합산

export type LLMProvider = "ollama" | "deepseek" | "openai" | "gemini";

export interface ModelRoute {
  provider: LLMProvider;
  model: string;
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;
  retries?: number;
  json_mode?: boolean;
}

export interface RouteSet {
  /** 사람이 읽을 이름 (baseline_local, deepseek_renderer 등) */
  name: string;
  description?: string;
  /** task → route 매핑. 누락 시 default 폴백. */
  routes: Partial<Record<LLMTask, ModelRoute>>;
  /** judge 같은 multi-route task는 배열 허용 */
  multi_routes?: Partial<Record<LLMTask, ModelRoute[]>>;
}

/** task별 sensitivity 메타. router는 fallback 시 이 정보를 참고. */
export const TASK_SENSITIVITY: Record<LLMTask, {
  latency: "low" | "medium" | "high";
  quality: "low" | "medium" | "high";
  cost:    "low" | "medium" | "high";
  failure_impact: "low" | "medium" | "high";
}> = {
  world_setting_suggest:    { latency: "high", quality: "low",    cost: "low",    failure_impact: "low" },
  rules_suggest:            { latency: "high", quality: "low",    cost: "low",    failure_impact: "low" },
  mood_suggest:             { latency: "high", quality: "low",    cost: "low",    failure_impact: "low" },
  character_suggest:        { latency: "high", quality: "medium", cost: "low",    failure_impact: "low" },
  item_detail_suggest:      { latency: "high", quality: "low",    cost: "low",    failure_impact: "low" },
  style_direction_suggest:  { latency: "high", quality: "low",    cost: "low",    failure_impact: "low" },

  planner:                  { latency: "medium", quality: "high",   cost: "medium", failure_impact: "high" },
  renderer:                 { latency: "medium", quality: "high",   cost: "high",   failure_impact: "high" },
  state_extractor:          { latency: "high",   quality: "medium", cost: "low",    failure_impact: "high" },

  summary_writer:           { latency: "medium", quality: "medium", cost: "low",    failure_impact: "medium" },
  arc_summary_writer:       { latency: "medium", quality: "high",   cost: "medium", failure_impact: "high" },
  foreshadow_reasoning:     { latency: "medium", quality: "high",   cost: "medium", failure_impact: "medium" },
  item_description:         { latency: "high",   quality: "low",    cost: "low",    failure_impact: "low" },

  narrative_repair:         { latency: "medium", quality: "high",   cost: "low",    failure_impact: "medium" },
  post_validator:           { latency: "medium", quality: "medium", cost: "low",    failure_impact: "low" },
  post_revision:            { latency: "medium", quality: "high",   cost: "medium", failure_impact: "medium" },

  reader_immersion_judge:   { latency: "low",    quality: "high",   cost: "medium", failure_impact: "low" },
  knowledge_boundary_judge: { latency: "low",    quality: "high",   cost: "low",    failure_impact: "low" },
  action_affordance_judge:  { latency: "low",    quality: "high",   cost: "low",    failure_impact: "low" },
  judge_synthesis:          { latency: "low",    quality: "high",   cost: "low",    failure_impact: "low" },
};

/** task별 task type 카테고리 (taxonomy 그룹) */
export const TASK_CATEGORY: Record<LLMTask, string> = {
  world_setting_suggest:    "SUGGESTION_LIGHT",
  rules_suggest:            "SUGGESTION_LIGHT",
  mood_suggest:             "SUGGESTION_LIGHT",
  character_suggest:        "SUGGESTION_STRUCTURED",
  item_detail_suggest:      "SUGGESTION_LIGHT",
  style_direction_suggest:  "SUGGESTION_LIGHT",
  planner:                  "PLANNER_LONG_CONTEXT",
  renderer:                 "RENDERER_CREATIVE",
  state_extractor:          "STATE_EXTRACTION",
  summary_writer:           "MEMORY_SUMMARY",
  arc_summary_writer:       "MEMORY_SUMMARY",
  foreshadow_reasoning:     "FORESHADOW_REASONING",
  item_description:         "ITEM_DESCRIPTION",
  narrative_repair:         "POSTPROCESS_REPAIR",
  post_validator:           "POSTPROCESS_REPAIR",
  post_revision:            "POSTPROCESS_REPAIR",
  reader_immersion_judge:   "READER_IMMERSION_JUDGE",
  knowledge_boundary_judge: "READER_IMMERSION_JUDGE",
  action_affordance_judge:  "READER_IMMERSION_JUDGE",
  judge_synthesis:          "JUDGE_SYNTHESIS",
};
