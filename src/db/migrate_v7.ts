/**
 * migrate_v7.ts — canonical_characters: initial_items 컬럼 추가
 * 실행: npx tsx src/db/migrate_v7.ts
 *
 * 변경 내용:
 * - canonical_characters: initial_items JSONB 추가 (캐릭터 초기 소지품)
 */

import "dotenv/config";
import { pool } from "../lib/db.js";
import { logInfo, logError } from "../lib/logger.js";

const SQL = `
ALTER TABLE canonical_characters
  ADD COLUMN IF NOT EXISTS initial_items JSONB NOT NULL DEFAULT '[]';
`;

export async function runMigrateV7(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    logInfo("db:migrate_v7", "V7 마이그레이션 완료 — canonical_characters.initial_items 추가");
  } catch (err) {
    logError("db:migrate_v7", err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith("migrate_v7.ts") || process.argv[1]?.endsWith("migrate_v7.js")) {
  try {
    await runMigrateV7();
    console.log("✅ V7 마이그레이션 완료");
  } catch (e) {
    console.error("❌ V7 마이그레이션 실패:", e);
  } finally {
    await pool.end();
  }
}
