import { pool } from "./db.js";
import { redis } from "./redis.js";
import { runMigrateV2 } from "../db/migrate_v2.js";
import { runMigrateV8 } from "../db/migrate_v8.js";
import { logInfo, logWarn, logError } from "./logger.js";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, "../../");
const STATE_FILE = join(ROOT, "state.json");

function writeState(patch: Record<string, unknown>) {
  try {
    const raw     = existsSync(STATE_FILE) ? readFileSync(STATE_FILE, "utf-8") : "{}";
    const current = JSON.parse(raw);
    writeFileSync(STATE_FILE, JSON.stringify(
      { ...current, ...patch, last_updated: new Date().toISOString() }, null, 2
    ));
  } catch (e) { logError("startup:state", e); }
}

// ── 자동 마이그레이션 ────────────────────────────────────────
const MIGRATE_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reader_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  static_profile JSONB NOT NULL DEFAULT '{}',
  dynamic_profile JSONB NOT NULL DEFAULT '{}',
  genre_profile JSONB NOT NULL DEFAULT '{}',
  session_pacing JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS story_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  world_bible JSONB NOT NULL DEFAULT '{}',
  rolling_summary JSONB NOT NULL DEFAULT '{}',
  foreshadow_memory JSONB NOT NULL DEFAULT '[]',
  director_overrides JSONB NOT NULL DEFAULT '[]',
  current_episode INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id TEXT NOT NULL,
  episode_number INT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, episode_number)
);
CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT, personality TEXT, type TEXT, gender TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  first_appeared_episode INT,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, name)
);
CREATE TABLE IF NOT EXISTS session_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id TEXT NOT NULL,
  episode_number INT NOT NULL,
  dwell_ms INT, dropout_position FLOAT,
  rewind_count INT DEFAULT 0, speed_changes INT DEFAULT 0,
  completion_rate FLOAT, emotion_signals JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);`;

async function checkDb(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query(MIGRATE_SQL);
    logInfo("startup:db", "PostgreSQL connected — all tables verified/created");
    return true;
  } catch (err) {
    logError("startup:db", err, { hint: "DB 연결 또는 마이그레이션 실패. DATABASE_URL 확인 필요" });
    return false;
  } finally { client.release(); }
}

async function checkRedis(): Promise<boolean> {
  try {
    await redis.ping();
    logInfo("startup:redis", "Redis connected");
    return true;
  } catch (err) {
    logError("startup:redis", err, { hint: "Redis 연결 실패. REDIS_URL 확인 필요" });
    return false;
  }
}

async function checkOllama(): Promise<boolean> {
  try {
    const base        = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1").replace("/v1", "");
    const storyModel  = process.env.STORY_MODEL   ?? "qwen2.5:14b";
    const suggestModel= process.env.SUGGEST_MODEL ?? "gemma3:12b";
    const res   = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data  = await res.json() as { models?: { name: string; size_vram?: number }[] };
    const names = (data.models ?? []).map(m => m.name);
    const storyOk   = names.some(n => n.startsWith(storyModel));
    const suggestOk = names.some(n => n.startsWith(suggestModel));
    const found = storyOk || suggestOk;
    if (storyOk && suggestOk) {
      logInfo("startup:ollama", `Ollama OK — story: '${storyModel}', suggest: '${suggestModel}'`, { available_models: names });
    } else {
      logWarn("startup:ollama", `모델 부분 누락 — story:${storyOk} suggest:${suggestOk}`, { available_models: names, story_model: storyModel, suggest_model: suggestModel });
    }
    return found;
  } catch (err) {
    logWarn("startup:ollama", "Ollama 응답 없음 — 생성 기능 불가", { error: String(err) });
    return false;
  }
}

export async function runStartup(): Promise<void> {
  logInfo("startup", "FlowScribe 서버 시작 중...");
  const [db, redisOk, ollama] = await Promise.all([checkDb(), checkRedis(), checkOllama()]);
  if (db) {
    try { await runMigrateV2(); } catch (e) { logWarn("startup", "V2 마이그레이션 실패 — 무시하고 계속", { error: String(e) }); }
    try { await runMigrateV8(); } catch (e) { logWarn("startup", "V8 마이그레이션 실패 — 무시하고 계속", { error: String(e) }); }
  }
  const status = {
    pipeline_status: db && redisOk ? "ready" : "degraded",
    db_connected: db, redis_connected: redisOk, ollama_available: ollama,
  };
  writeState(status);
  if (!db || !redisOk) {
    logError("startup", "필수 서비스 연결 실패 — logs/error.log 확인");
  } else {
    logInfo("startup", `서버 준비 완료 — DB:✅ Redis:✅ Ollama:${ollama ? "✅" : "⚠️"}`);
  }
}

// ── 전역 uncaught 에러 캐처 ──────────────────────────────────
process.on("uncaughtException",  err => logError("process:uncaughtException",  err));
process.on("unhandledRejection", err => logError("process:unhandledRejection", err));
