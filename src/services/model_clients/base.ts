/**
 * base.ts — Provider-agnostic LLM client interface
 *
 * 모든 provider client는 이 인터페이스를 구현한다.
 * router는 이 인터페이스만 호출한다.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  /** OpenAI-compatible: response_format json_object 등 */
  json_mode?: boolean;
  timeout_ms?: number;
  /** Phase 4.20 R5A — token chunk callback. 설정 시 stream=true로 호출하고 각 delta를 emit한다. */
  onChunk?: (delta: string) => void;
}

export interface ChatResponse {
  text: string;
  /** 비표준 — provider별 metadata */
  raw?: unknown;
  /** 호출 비용/지연 추적 */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  elapsed_ms: number;
  provider: string;
  model: string;
  /** 응답이 truncated 되었거나 parse 가능한 JSON이었는지 — judge용 */
  finish_reason?: string;
}

export interface LLMProviderClient {
  readonly provider_name: string;
  /** 환경변수/설정으로 사용 가능 여부 */
  is_available(): boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
