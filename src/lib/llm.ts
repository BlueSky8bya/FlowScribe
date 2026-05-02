import OpenAI from "openai";
import { logInfo } from "./logger.js";

export type LLMProvider = "ollama" | "deepseek" | "openai" | "gemini";

interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  storyModel: string;    // 소설 본문 생성 — 창의성 + 구조 지시 준수
  plannerModel: string;  // 계획 생성 — JSON 구조 특화 (SFT/LoRA 어댑터 대상)
  rendererModel: string; // 소설 렌더링 전용 — A/B 실험용 분리 모델
  suggestModel: string;  // AI 추천 (인물/규칙/장르) — 창의적 제안
  summaryModel: string;  // 요약/압축/분석 — 롤링 요약, 아크 압축, 복선 분석
}

const PROVIDERS: Record<LLMProvider, ProviderConfig> = {
  ollama: {
    baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
    apiKey: "ollama",
    // qwen2.5:14b: 구조 지시 준수율 높음, RL 테스트 검증 (30화 93/100)
    storyModel:   process.env.STORY_MODEL    ?? "qwen2.5:14b",
    // plannerModel: JSON 계획 생성 전용. Phase 1 SFT 이후 전용 어댑터로 교체 예정.
    // 기본은 storyModel과 동일하나 환경 변수로 분리 가능.
    plannerModel: process.env.PLANNER_MODEL  ?? process.env.STORY_MODEL ?? "qwen2.5:14b",
    // rendererModel: 소설 본문 렌더링 전용. 기본은 storyModel과 동일.
    rendererModel: process.env.RENDERER_MODEL ?? process.env.STORY_MODEL ?? "qwen2.5:14b",
    // gemma3:12b: 창의적 한국어 제안 품질 우수
    suggestModel: process.env.SUGGEST_MODEL  ?? "gemma3:12b",
    // gemma3:12b: 한국어 요약/분석 정확도 우수 (llama3.1:8b 대비)
    summaryModel: process.env.SUMMARY_MODEL  ?? "gemma3:12b",
  },
  // POST-4 §C3 — production path 아님. 현재 model_routes.json에서 비활성
  // (active=openai_renderer, fallback=baseline_local). low-cost / fast route 재도입
  // 옵션으로 보존. 재활성화 시 별도 route matrix 검증(R5B-4 패턴) 필요.
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    storyModel:    "deepseek-chat",
    plannerModel:  "deepseek-chat",
    rendererModel: "deepseek-chat",
    suggestModel:  "deepseek-chat",
    summaryModel:  "deepseek-chat",
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    storyModel:    "gpt-4.1",
    plannerModel:  "gpt-4.1-mini",
    rendererModel: "gpt-4.1",
    suggestModel:  "gpt-4.1-mini",
    summaryModel:  "gpt-4.1-mini",
  },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.GEMINI_API_KEY ?? "",
    storyModel:    "gemini-2.5-pro-preview-05-06",
    plannerModel:  "gemini-2.0-flash",
    rendererModel: "gemini-2.5-pro-preview-05-06",
    suggestModel:  "gemini-2.0-flash",
    summaryModel:  "gemini-2.0-flash",
  },
};

let _activeProvider: LLMProvider =
  (process.env.LLM_PROVIDER as LLMProvider) ?? "ollama";

let _client: OpenAI = buildClient(_activeProvider);

function buildClient(provider: LLMProvider): OpenAI {
  const cfg = PROVIDERS[provider];
  return new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
}

export function getActiveProvider(): LLMProvider {
  return _activeProvider;
}

export function setActiveProvider(provider: LLMProvider): void {
  _activeProvider = provider;
  _client = buildClient(provider);
  logInfo("lib:llm", "프로바이더 변경", {
    provider,
    storyModel: getStoryModel(),
    plannerModel: getPlannerModel(),
    suggestModel: getSuggestModel(),
    summaryModel: getSummaryModel(),
  });
}

export function getLLMClient(): OpenAI {
  return _client;
}

export function getStoryModel(): string {
  return PROVIDERS[_activeProvider].storyModel;
}

export function getPlannerModel(): string {
  return PROVIDERS[_activeProvider].plannerModel;
}

export function getRendererModel(): string {
  return PROVIDERS[_activeProvider].rendererModel;
}

export function getSuggestModel(): string {
  return PROVIDERS[_activeProvider].suggestModel;
}

export function getSummaryModel(): string {
  return PROVIDERS[_activeProvider].summaryModel;
}

export function getProviderList() {
  return (Object.keys(PROVIDERS) as LLMProvider[]).map(p => ({
    id: p,
    storyModel:   PROVIDERS[p].storyModel,
    plannerModel: PROVIDERS[p].plannerModel,
    suggestModel: PROVIDERS[p].suggestModel,
    hasKey: p === "ollama" || !!PROVIDERS[p].apiKey,
  }));
}

logInfo("lib:llm", "LLM 초기화", {
  provider:     _activeProvider,
  storyModel:   getStoryModel(),
  plannerModel: getPlannerModel(),
  suggestModel: getSuggestModel(),
  summaryModel: getSummaryModel(),
});
