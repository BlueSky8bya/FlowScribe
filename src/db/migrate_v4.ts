/**
 * migrate_v4.ts — Background Audit 지원 마이그레이션
 * 실행: npx tsx src/db/migrate_v4.ts
 *
 * 변경 내용:
 * - run_traces: computed_reward JSONB 컬럼 추가 (background audit reward breakdown 저장)
 * - run_traces: audit_elapsed_ms INTEGER 컬럼 추가 (audit 소요 시간)
 * - character_dynamic_states: recent_goal TEXT 컬럼 추가 (플래너 최근 목표)
 */

import "dotenv/config";
import { pool } from "../lib/db.js";
import { logInfo, logError } from "../lib/logger.js";

const SQL = `
-- ── run_traces: background audit 결과 ───────────────────────
ALTER TABLE run_traces
  ADD COLUMN IF NOT EXISTS computed_reward   JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS audit_elapsed_ms  INTEGER DEFAULT NULL;

-- ── character_dynamic_states: recent_goal ────────────────────
ALTER TABLE character_dynamic_states
  ADD COLUMN IF NOT EXISTS recent_goal TEXT DEFAULT NULL;

-- ── canonical_characters 백필: characters 테이블에서 복사 ────
INSERT INTO canonical_characters (book_id, name, personality, type, gender, updated_at)
SELECT
  c.book_id,
  c.name,
  COALESCE(c.personality, '') AS personality,
  ''                          AS type,
  COALESCE(c.gender, '')      AS gender,
  NOW()
FROM characters c
WHERE NOT EXISTS (
  SELECT 1 FROM canonical_characters cc
  WHERE cc.book_id = c.book_id AND cc.name = c.name
);
`;

export async function runMigrateV4(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    logInfo("db:migrate_v4", "V4 마이그레이션 완료 — run_traces(+computed_reward, +audit_elapsed_ms) + character_dynamic_states(+recent_goal) + canonical_characters 백필");
  } catch (err) {
    logError("db:migrate_v4", err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith("migrate_v4.ts") || process.argv[1]?.endsWith("migrate_v4.js")) {
  try {
    await runMigrateV4();
    console.log("✅ V4 마이그레이션 완료");
  } catch (e) {
    console.error("❌ V4 마이그레이션 실패:", e);
  } finally {
    await pool.end();
  }
}
