/**
 * migrate_v8.ts — item_vocab 테이블 추가
 * LLM이 소지품 설명 생성 시 함께 추론한 카테고리를 누적 저장.
 * _qlabel()이 키워드 매칭 실패 시 이 테이블을 조회해 배지를 표시한다.
 */

import "dotenv/config";
import { pool } from "../lib/db.js";
import { logInfo, logError } from "../lib/logger.js";

const SQL = `
CREATE TABLE IF NOT EXISTS item_vocab (
  id          BIGSERIAL PRIMARY KEY,
  book_id     TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  category    TEXT        NOT NULL,
  badge_label TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, name)
);
CREATE INDEX IF NOT EXISTS idx_item_vocab_book ON item_vocab (book_id);
`;

export async function runMigrateV8(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    logInfo("db:migrate_v8", "V8 마이그레이션 완료 — item_vocab 테이블 생성/확인");
  } catch (err) {
    logError("db:migrate_v8", err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith("migrate_v8.ts") || process.argv[1]?.endsWith("migrate_v8.js")) {
  try {
    await runMigrateV8();
    console.log("✅ V8 마이그레이션 완료");
  } catch (e) {
    console.error("❌ V8 마이그레이션 실패:", e);
  } finally {
    await pool.end();
  }
}
