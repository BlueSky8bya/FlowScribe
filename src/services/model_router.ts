/**
 * model_router.ts — Phase 4.12 task → provider/model 라우터
 *
 * 사용:
 *   import { runLLMTask } from "./model_router.js";
 *   const r = await runLLMTask("planner", { messages: [...], json_mode: true });
 *
 * 특징:
 *   - config/model_routes.json 기반 (active_route 선택)
 *   - env 변수 ${VAR:-default} 치환
 *   - per-call route override 가능
 *   - provider availability 자동 fallback
 *   - 호출 단위 latency/usage 로그 (api key는 절대 로그 X)
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { LLMTask, ModelRoute, RouteSet, LLMProvider } from "./llm_tasks.js";
import type { LLMProviderClient, ChatRequest, ChatResponse, ChatMessage } from "./model_clients/base.js";
import { OpenAICompatibleClient } from "./model_clients/openai_compatible.js";
import { GeminiClient } from "./model_clients/gemini_client.js";
import { logInfo, logWarn } from "../lib/logger.js";

// ── env 변수 치환 ─────────────────────────────────────────────
function resolveEnvTemplate(s: string): string {
  return s.replace(/\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g, (_, name, fallback) => {
    return process.env[name] ?? fallback ?? "";
  });
}

function resolveRoute(route: ModelRoute): ModelRoute {
  return {
    ...route,
    model: resolveEnvTemplate(route.model),
  };
}

// ── 클라이언트 캐시 ────────────────────────────────────────────
const _clientCache = new Map<LLMProvider, LLMProviderClient>();

function buildClient(provider: LLMProvider): LLMProviderClient {
  const cached = _clientCache.get(provider);
  if (cached) return cached;
  let client: LLMProviderClient;
  switch (provider) {
    case "ollama":
      client = new OpenAICompatibleClient({
        provider_name: "ollama",
        baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        apiKey: "ollama",
      });
      break;
    case "deepseek":
      client = new OpenAICompatibleClient({
        provider_name: "deepseek",
        baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
        apiKey: process.env.DEEPSEEK_API_KEY ?? "",
      });
      break;
    case "openai":
      client = new OpenAICompatibleClient({
        provider_name: "openai",
        baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY ?? "",
      });
      break;
    case "gemini":
      client = new GeminiClient({ apiKey: process.env.GEMINI_API_KEY ?? "" });
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
  _clientCache.set(provider, client);
  return client;
}

// ── 라우팅 config 로드 ────────────────────────────────────────
interface RoutingConfig {
  active_route: string;
  fallback_route: string;
  route_sets: Record<string, RouteSet>;
}

let _config: RoutingConfig | null = null;

function loadConfig(): RoutingConfig {
  if (_config) return _config;
  const path = process.env.MODEL_ROUTES_FILE
    ?? join(process.cwd(), "config", "model_routes.json");
  try {
    const raw = readFileSync(path, "utf8");
    _config = JSON.parse(raw) as RoutingConfig;
  } catch (err) {
    logWarn("model_router", "config 로드 실패 — 빈 config 사용", { path, error: String(err) });
    _config = { active_route: "baseline_local", fallback_route: "baseline_local", route_sets: {} };
  }
  return _config;
}

export function getActiveRouteName(): string {
  return process.env.MODEL_ROUTE ?? loadConfig().active_route;
}

/** task에 대해 적용될 ModelRoute (env 치환 완료) 반환. 없으면 null. */
export function resolveTaskRoute(task: LLMTask, routeNameOverride?: string): ModelRoute | null {
  const cfg = loadConfig();
  const routeName = routeNameOverride ?? getActiveRouteName();
  const set = cfg.route_sets[routeName];
  if (set?.routes?.[task]) return resolveRoute(set.routes[task]!);
  // fallback set
  const fb = cfg.route_sets[cfg.fallback_route];
  if (fb?.routes?.[task]) return resolveRoute(fb.routes[task]!);
  return null;
}

/** task에 대한 multi-route (judge 같은 경우) 반환. */
export function resolveTaskMultiRoute(task: LLMTask, routeNameOverride?: string): ModelRoute[] {
  const cfg = loadConfig();
  const routeName = routeNameOverride ?? getActiveRouteName();
  const set = cfg.route_sets[routeName];
  const arr = set?.multi_routes?.[task];
  if (arr?.length) return arr.map(resolveRoute);
  const fb = cfg.route_sets[cfg.fallback_route];
  return (fb?.multi_routes?.[task] ?? []).map(resolveRoute);
}

// ── 통합 호출 ──────────────────────────────────────────────────
export interface LLMTaskInput {
  messages: ChatMessage[];
  /** route override (config 무시) */
  route_override?: ModelRoute;
  /** route set override (set은 config에서, task만 다른 set 사용) */
  route_set_override?: string;
  json_mode?: boolean;
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;
  /** Phase 4.20 R5A — token chunk callback. 설정 시 stream=true. */
  onChunk?: (delta: string) => void;
}

export interface LLMTaskResult extends ChatResponse {
  task: LLMTask;
}

/**
 * task별 LLM 호출. router가 provider를 선택하고 클라이언트로 위임.
 */
export async function runLLMTask(
  task: LLMTask,
  input: LLMTaskInput,
): Promise<LLMTaskResult> {
  const route = input.route_override
    ? resolveRoute(input.route_override)
    : resolveTaskRoute(task, input.route_set_override);
  if (!route) {
    throw new Error(`runLLMTask: no route for task=${task}`);
  }
  const client = buildClient(route.provider);
  if (!client.is_available()) {
    throw new Error(`runLLMTask: provider ${route.provider} not available (key/config 확인)`);
  }
  const req: ChatRequest = {
    model: route.model,
    messages: input.messages,
    temperature: input.temperature ?? route.temperature,
    max_tokens: input.max_tokens ?? route.max_tokens,
    json_mode: input.json_mode ?? route.json_mode,
    timeout_ms: input.timeout_ms ?? route.timeout_ms,
    ...(input.onChunk ? { onChunk: input.onChunk } : {}),
  };
  const t0 = Date.now();
  const res = await client.chat(req);
  logInfo("model_router", "task 완료", {
    task,
    provider: route.provider,
    model: route.model,
    elapsed_ms: res.elapsed_ms,
    completion_tokens: res.usage?.completion_tokens,
    finish_reason: res.finish_reason,
    total_elapsed_ms: Date.now() - t0,
  });
  return { ...res, task };
}

/** test/debug용: 모든 route_set 이름 반환 */
export function listRouteSets(): string[] {
  return Object.keys(loadConfig().route_sets);
}

/** test/debug용: 특정 route_set의 task→route 매핑 반환 (env 치환 후) */
export function dumpRouteSet(routeName?: string): {
  name: string;
  routes: Partial<Record<LLMTask, ModelRoute>>;
  multi_routes: Partial<Record<LLMTask, ModelRoute[]>>;
} {
  const cfg = loadConfig();
  const name = routeName ?? cfg.active_route;
  const set = cfg.route_sets[name];
  if (!set) return { name, routes: {}, multi_routes: {} };
  const routes: Partial<Record<LLMTask, ModelRoute>> = {};
  for (const [k, v] of Object.entries(set.routes ?? {})) {
    routes[k as LLMTask] = resolveRoute(v as ModelRoute);
  }
  const multi: Partial<Record<LLMTask, ModelRoute[]>> = {};
  for (const [k, v] of Object.entries(set.multi_routes ?? {})) {
    multi[k as LLMTask] = (v as ModelRoute[]).map(resolveRoute);
  }
  return { name, routes, multi_routes: multi };
}
