import pg from "pg";
import { logInfo, logError } from "./logger.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  logError("lib:db", "DATABASE_URL 환경변수 미설정 — PostgreSQL 연결 불가");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 항상 UTF-8 클라이언트 인코딩 강제 — node dist 실행 시 OS 코드페이지(CP949) 오염 방지
  options: "--client_encoding=UTF8",
});

pool.on("connect",        () => logInfo("lib:db",  "PostgreSQL 클라이언트 연결"));
pool.on("error",   (err) => logError("lib:db", err));
