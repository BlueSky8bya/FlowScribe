/**
 * migrate_v3.ts — Story Contract Freeze 마이그레이션
 * 실행: npx tsx src/db/migrate_v3.ts
 *
 * 변경 내용:
 * - run_traces: schema_version / planner_schema_version / reward_schema_version 컬럼 추가
 * - character_dynamic_states: emotional_state / visibility_state 컬럼 추가
 */

import "dotenv/config";
import { pool } from "../lib/db.js";
import { logInfo, logError } from "../lib/logger.js";

const SQL = `
-- ── run_traces: schema versioning ────────────────────────────
ALTER TABLE run_traces
  ADD COLUMN IF NOT EXISTS schema_version          TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS planner_schema_version  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reward_schema_version   TEXT DEFAULT NULL;

-- ── character_dynamic_states: 최소 확장 ──────────────────────
ALTER TABLE character_dynamic_states
  ADD COLUMN IF NOT EXISTS emotional_state   TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS visibility_state  TEXT DEFAULT NULL
    CHECK (visibility_state IN ('present', 'absent', 'cannot_act'));
`;

export async function runMigrateV3(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    logInfo("db:migrate_v3", "V3 마이그레이션 완료 — run_traces(+3 cols) + character_dynamic_states(+2 cols)");
  } catch (err) {
    logError("db:migrate_v3", err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith("migrate_v3.ts") || process.argv[1]?.endsWith("migrate_v3.js")) {
  const { pool: _pool } = await import("../lib/db.js");
  try {
    await runMigrateV3();
    console.log("✅ V3 마이그레이션 완료");
  } catch (e) {
    console.error("❌ V3 마이그레이션 실패:", e);
  } finally {
    await _pool.end();
  }
}
