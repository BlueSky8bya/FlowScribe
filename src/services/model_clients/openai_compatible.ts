/**
 * openai_compatible.ts — OpenAI-compatible client (Ollama, DeepSeek, OpenAI 공통)
 *
 * 세 provider 모두 OpenAI Chat Completions API와 호환되므로 이 클라이언트를 공유한다.
 * Gemini는 별도 — gemini_client.ts.
 */

import OpenAI from "openai";
import type { LLMProviderClient, ChatRequest, ChatResponse } from "./base.js";

export class OpenAICompatibleClient implements LLMProviderClient {
  readonly provider_name: string;
  private client: OpenAI;
  private apiKey: string;

  constructor(opts: { provider_name: string; baseURL: string; apiKey: string }) {
    this.provider_name = opts.provider_name;
    this.apiKey = opts.apiKey;
    this.client = new OpenAI({ apiKey: opts.apiKey || "x", baseURL: opts.baseURL });
  }

  is_available(): boolean {
    // ollama는 apiKey 없어도 OK ("ollama"); 그 외는 key 존재 필수
    if (this.provider_name === "ollama") return true;
    return this.apiKey.length > 8;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const t0 = Date.now();

    // Phase 4.20 R5A — onChunk 제공 시 stream=true. 각 delta를 callback으로 emit하고
    // 최종 ChatResponse는 동일한 형태로 조립해 반환한다 (batch 호출자 호환).
    if (req.onChunk) {
      const stream = await this.client.chat.completions.create({
        model: req.model,
        messages: req.messages.map(m => ({ role: m.role, content: m.content })),
        temperature: req.temperature ?? 0.7,
        ...(req.max_tokens !== undefined ? { max_tokens: req.max_tokens } : {}),
        // streaming일 때 OpenAI는 json_mode와 일부 모델 호환성 이슈 있으므로 task측에서 stream을 쓸 때는 json 출력을 안 쓴다고 가정.
        ...(req.json_mode ? { response_format: { type: "json_object" } } : {}),
        stream: true,
        stream_options: { include_usage: true },
      } as any) as any;
      let buffer = "";
      let finishReason: string | undefined;
      let usage: any = undefined;
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content ?? "";
        if (delta) {
          buffer += delta;
          try { req.onChunk(delta); } catch { /* sink callback 오류 — text는 계속 buffer */ }
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) usage = chunk.usage;
      }
      return {
        text: buffer,
        raw: undefined,
        usage: usage ? {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        } : undefined,
        elapsed_ms: Date.now() - t0,
        provider: this.provider_name,
        model: req.model,
        finish_reason: finishReason,
      };
    }

    const completion = await this.client.chat.completions.create({
      model: req.model,
      messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: req.temperature ?? 0.7,
      ...(req.max_tokens !== undefined ? { max_tokens: req.max_tokens } : {}),
      ...(req.json_mode ? { response_format: { type: "json_object" } } : {}),
    } as any);

    const choice = completion.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      raw: undefined, // raw 응답 저장 금지 (key/full prompt 보호)
      usage: completion.usage ? {
        prompt_tokens: completion.usage.prompt_tokens,
        completion_tokens: completion.usage.completion_tokens,
        total_tokens: completion.usage.total_tokens,
      } : undefined,
      elapsed_ms: Date.now() - t0,
      provider: this.provider_name,
      model: req.model,
      finish_reason: choice?.finish_reason,
    };
  }
}
