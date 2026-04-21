import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT     = join(__dirname, "../../");
const LOGS_DIR = join(ROOT, "logs");

// ── 로그 파일 경로 (도메인별 분리) ───────────────────────────
const LOG_FILES = {
  app:      join(LOGS_DIR, "app", "app.log"),       // 전체 통합
  generate: join(LOGS_DIR, "generate", "generate.log"), // 스토리 생성
  suggest:  join(LOGS_DIR, "suggest",  "suggest.log"),  // AI 추천
  story:    join(LOGS_DIR, "story",    "story.log"),    // 스트림/필터
  error:    join(LOGS_DIR, "error",    "error.log"),    // 에러 전용
  system:   join(LOGS_DIR, "system",   "system.log"),   // 시작/DB/Redis/큐
} as const;

type LogFile = keyof typeof LOG_FILES;

// ctx 접두어 → 파일 라우팅
const CTX_ROUTING: Array<[RegExp, LogFile]> = [
  [/^api:generate|^story:/,                                                      "generate"],
  [/^api:suggest/,                                                               "suggest"],
  [/^startup|^lib:redis|^lib:db|^lib:llm|^worker:|^queue:|^service:profile/, "system"],
];

function resolveFile(ctx: string): LogFile {
  for (const [pattern, file] of CTX_ROUTING) {
    if (pattern.test(ctx)) return file;
  }
  return "app";
}

// ── 디렉터리 초기화 ──────────────────────────────────────────
for (const file of Object.values(LOG_FILES)) {
  const dir = join(file, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const MAX_BYTES = 10 * 1024 * 1024; // 10MB per file

// 파일별 누적 바이트 추정값 (statSync를 매 write마다 호출하지 않기 위해 메모리에서 추적)
const fileSizeCache = new Map<string, number>();

function initSizeCache(file: string) {
  if (fileSizeCache.has(file)) return;
  try {
    fileSizeCache.set(file, existsSync(file) ? statSync(file).size : 0);
  } catch {
    fileSizeCache.set(file, 0);
  }
}

function rotate(file: string, lineLen: number) {
  try {
    initSizeCache(file);
    const est = (fileSizeCache.get(file) ?? 0) + lineLen;
    if (est <= MAX_BYTES) { fileSizeCache.set(file, est); return; }
    // 실제 크기로 재확인 후 로테이션
    if (!existsSync(file) || statSync(file).size <= MAX_BYTES) {
      fileSizeCache.set(file, statSync(file).size);
      return;
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    renameSync(file, file.replace(".log", `.${ts}.log`));
    fileSizeCache.set(file, 0);
  } catch {}
}

// ── 포매터 ──────────────────────────────────────────────────
function format(level: LogLevel, ctx: string, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length
    ? "\n  context: " + JSON.stringify(meta, null, 2).replace(/\n/g, "\n  ")
    : "";
  return `[${ts}] [${level.padEnd(5)}] [${ctx}] ${msg}${metaStr}`;
}

function write(file: string, line: string) {
  try {
    const bytes = Buffer.byteLength(line + "\n", "utf-8");
    rotate(file, bytes);
    appendFileSync(file, line + "\n", "utf-8");
  } catch {}
}

// ── 레벨 정의 ────────────────────────────────────────────────
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
const LEVEL_RANK: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const MIN_CONSOLE_LEVEL: LogLevel = process.env.NODE_ENV === "production" ? "INFO" : "DEBUG";

// ── 핵심 로그 함수 ───────────────────────────────────────────
function log(level: LogLevel, ctx: string, msg: string, meta?: Record<string, unknown>) {
  const line = format(level, ctx, msg, meta);

  if (LEVEL_RANK[level] >= LEVEL_RANK[MIN_CONSOLE_LEVEL]) {
    if      (level === "ERROR") console.error(line);
    else if (level === "WARN")  console.warn(line);
    else                        console.log(line);
  }

  if (LEVEL_RANK[level] >= LEVEL_RANK["INFO"]) {
    const domainFile = LOG_FILES[resolveFile(ctx)];
    write(domainFile, line);
    write(LOG_FILES.app, line);           // 통합 로그에도 항상 기록
    if (level === "ERROR") write(LOG_FILES.error, line);
  }
}

// ── 공개 API ─────────────────────────────────────────────────
export function logDebug(ctx: string, msg: string, meta?: Record<string, unknown>) {
  log("DEBUG", ctx, msg, meta);
}
export function logInfo(ctx: string, msg: string, meta?: Record<string, unknown>) {
  log("INFO", ctx, msg, meta);
}
export function logWarn(ctx: string, msg: string, meta?: Record<string, unknown>) {
  log("WARN", ctx, msg, meta);
}
export function logError(ctx: string, errOrMsg: unknown, meta?: Record<string, unknown>) {
  const isErr = errOrMsg instanceof Error;
  const msg   = isErr ? errOrMsg.message : String(errOrMsg);
  const stack = isErr && errOrMsg.stack
    ? "\n  stack: " + errOrMsg.stack.split("\n").slice(1, 6).map(s => s.trim()).join("\n         ")
    : "";
  const line = format("ERROR", ctx, msg, meta) + stack;
  console.error(line);
  const domainFile = LOG_FILES[resolveFile(ctx)];
  write(domainFile, line);
  write(LOG_FILES.app, line);
  write(LOG_FILES.error, line);
}
