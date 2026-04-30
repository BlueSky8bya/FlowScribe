/**
 * gemini_client.ts — Google Gemini API 클라이언트 (native v1beta)
 *
 * OpenAI-compatible adapter도 있지만 일부 응답 포맷이 다르므로 native API 사용.
 */

import https from "https";
import type { LLMProviderClient, ChatRequest, ChatResponse } from "./base.js";

export class GeminiClient implements LLMProviderClient {
  readonly provider_name = "gemini";
  private apiKey: string;

  constructor(opts: { apiKey: string }) {
    this.apiKey = opts.apiKey;
  }

  is_available(): boolean {
    return this.apiKey.length > 8;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const t0 = Date.now();
    // system messages → systemInstruction
    const systemMsg = req.messages.find(m => m.role === "system");
    const userParts = req.messages
      .filter(m => m.role !== "system")
      .map(m => ({ text: m.content }))
      .filter(p => p.text);

    const reqBody: any = {
      contents: [{ parts: userParts.length ? userParts : [{ text: "" }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        ...(req.max_tokens ? { maxOutputTokens: req.max_tokens } : {}),
      },
    };
    if (systemMsg) {
      reqBody.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    const body = JSON.stringify(reqBody);
    const text = await new Promise<string>((resolve, reject) => {
      const opts = {
        hostname: "generativelanguage.googleapis.com",
        path: `/v1beta/models/${req.model}:generateContent?key=${this.apiKey}`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        ...(req.timeout_ms ? { timeout: req.timeout_ms } : {}),
      };
      const r = https.request(opts, res => {
        const chunks: Buffer[] = [];
        res.on("data", d => chunks.push(d));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            reject(new Error(`Gemini ${res.statusCode}: ${raw.slice(0, 200)}`));
            return;
          }
          try {
            const env = JSON.parse(raw);
            const candidate = env.candidates?.[0];
            const t = candidate?.content?.parts?.find((p: any) => !p.thought && p.text)?.text ?? "";
            resolve(t);
          } catch (e) {
            reject(new Error(`Gemini parse: ${(e as Error).message}`));
          }
        });
      });
      r.on("error", reject);
      r.write(body);
      r.end();
    });

    return {
      text,
      raw: undefined,
      elapsed_ms: Date.now() - t0,
      provider: "gemini",
      model: req.model,
    };
  }
}
