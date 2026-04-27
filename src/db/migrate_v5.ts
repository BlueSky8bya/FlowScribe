/**
 * migrate_v5.ts — DPO Pair 수집 테이블
 * 실행: npx tsx src/db/migrate_v5.ts
 *
 * 변경 내용:
 * - dpo_pairs: 동일 입력 조건에서 renderer 모델만 다르게 생성한 (chosen, rejected) 쌍 저장
 */

import "dotenv/config";
import { pool } from "../lib/db.js";
import { logInfo, logError } from "../lib/logger.js";

const SQL = `
CREATE TABLE IF NOT EXISTS dpo_pairs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 소스 컨텍스트 (동일 조건 식별)
  book_id                 TEXT        NOT NULL,
  episode_number          INTEGER     NOT NULL,

  -- Chosen (더 나은 출력)
  chosen_trace_id         UUID        NOT NULL REFERENCES run_traces(trace_id),
  chosen_model            TEXT        NOT NULL,
  chosen_verdict          TEXT,
  chosen_score            DOUBLE PRECISION,
  chosen_reward           DOUBLE PRECISION,
  chosen_pov_violation    BOOLEAN     DEFAULT FALSE,
  chosen_state_violation  BOOLEAN     DEFAULT FALSE,

  -- Rejected (덜 나은 출력)
  rejected_trace_id       UUID        NOT NULL REFERENCES run_traces(trace_id),
  rejected_model          TEXT        NOT NULL,
  rejected_verdict        TEXT,
  rejected_score          DOUBLE PRECISION,
  rejected_reward         DOUBLE PRECISION,
  rejected_pov_violation  BOOLEAN     DEFAULT FALSE,
  rejected_state_violation BOOLEAN    DEFAULT FALSE,

  -- 품질 차이
  score_delta             DOUBLE PRECISION,
  reward_delta            DOUBLE PRECISION,

  -- 자동 필터 결과
  filter_passed           BOOLEAN     NOT NULL DEFAULT FALSE,
  filter_reason           TEXT,

  -- 공통 planner model
  planner_model           TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dpo_pairs_book_ep
  ON dpo_pairs (book_id, episode_number);

CREATE INDEX IF NOT EXISTS dpo_pairs_filter
  ON dpo_pairs (filter_passed, score_delta DESC);
`;

export async function runMigrateV5(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    logInfo("db:migrate_v5", "V5 마이그레이션 완료 — dpo_pairs 테이블 생성");
  } catch (err) {
    logError("db:migrate_v5", err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith("migrate_v5.ts") || process.argv[1]?.endsWith("migrate_v5.js")) {
  try {
    await runMigrateV5();
    console.log("✅ V5 마이그레이션 완료 — dpo_pairs 테이블 준비됨");
  } catch (e) {
    console.error("❌ V5 마이그레이션 실패:", e);
  } finally {
    await pool.end();
  }
}
