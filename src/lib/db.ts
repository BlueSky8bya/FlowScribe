import pg from "pg";
import { logInfo, logError } from "./logger.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  logError("lib:db", "DATABASE_URL 환경변수 미설정 — PostgreSQL 연결 불가");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on("connect",        () => logInfo("lib:db",  "PostgreSQL 클라이언트 연결"));
pool.on("error",   (err) => logError("lib:db", err));
