/**
 * migrate_v6.ts — Trajectory + Ending Reward 컬럼 추가
 * 실행: npx tsx src/db/migrate_v6.ts
 *
 * 변경 내용:
 * - run_traces: trajectory_reward JSONB, ending_reward JSONB 추가
 * - trajectory_rewards: 책 단위 슬라이딩 윈도우 결과 전용 테이블
 */

import "dotenv/config";
import { pool } from "../lib/db.js";
import { logInfo, logError } from "../lib/logger.js";

const SQL = `
-- ── run_traces: trajectory + ending reward 컬럼 ──────────────
ALTER TABLE run_traces
  ADD COLUMN IF NOT EXISTS trajectory_reward  JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ending_reward       JSONB DEFAULT NULL;

-- ── trajectory_rewards: 책 단위 슬라이딩 윈도우 결과 ─────────
CREATE TABLE IF NOT EXISTS trajectory_rewards (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id             TEXT        NOT NULL,
  window_size         INTEGER     NOT NULL,
  start_episode       INTEGER     NOT NULL,
  end_episode         INTEGER     NOT NULL,

  -- 계산된 점수
  scores              JSONB       NOT NULL DEFAULT '{}',
  window_score        DOUBLE PRECISION,

  -- 메타
  arc_phase           TEXT,
  includes_final_episode BOOLEAN  DEFAULT FALSE,
  resolved_final_episode INTEGER  DEFAULT 0,

  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (book_id, window_size, start_episode, end_episode)
);

CREATE INDEX IF NOT EXISTS traj_rewards_book
  ON trajectory_rewards (book_id, window_size);

CREATE INDEX IF NOT EXISTS traj_rewards_final
  ON trajectory_rewards (book_id, includes_final_episode)
  WHERE includes_final_episode = TRUE;

-- ── ending_rewards: 책 단위 결말 품질 전용 테이블 ─────────────
CREATE TABLE IF NOT EXISTS ending_rewards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id               TEXT        NOT NULL,
  final_episode_number  INTEGER     NOT NULL,
  resolved_final_episode INTEGER    NOT NULL,

  -- 양수 점수 (0~1)
  ending_readiness            DOUBLE PRECISION,
  central_conflict_resolution DOUBLE PRECISION,
  foreshadow_payoff_coverage  DOUBLE PRECISION,
  character_arc_resolution    DOUBLE PRECISION,
  emotional_resolution        DOUBLE PRECISION,
  ending_proportionality      DOUBLE PRECISION,
  ending_surprise_earned      DOUBLE PRECISION,
  sequel_open_hook_balance    DOUBLE PRECISION,

  -- 패널티 (≤ 0)
  unresolved_critical_thread_penalty DOUBLE PRECISION DEFAULT 0,
  deus_ex_machina_penalty            DOUBLE PRECISION DEFAULT 0,
  premature_closure_penalty          DOUBLE PRECISION DEFAULT 0,
  overextended_delay_penalty         DOUBLE PRECISION DEFAULT 0,
  overexplained_ending_penalty       DOUBLE PRECISION DEFAULT 0,

  -- 종합
  pre_final_convergence_score DOUBLE PRECISION,
  final_closure_score         DOUBLE PRECISION,

  judge_summary               TEXT,
  judge_model                 TEXT,
  computed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (book_id, final_episode_number)
);

CREATE INDEX IF NOT EXISTS ending_rewards_book
  ON ending_rewards (book_id);
`;

export async function runMigrateV6(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    logInfo("db:migrate_v6",
      "V6 마이그레이션 완료 — run_traces(+2 cols) + trajectory_rewards + ending_rewards 테이블 생성");
  } catch (err) {
    logError("db:migrate_v6", err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith("migrate_v6.ts") || process.argv[1]?.endsWith("migrate_v6.js")) {
  try {
    await runMigrateV6();
    console.log("✅ V6 마이그레이션 완료");
  } catch (e) {
    console.error("❌ V6 마이그레이션 실패:", e);
  } finally {
    await pool.end();
  }
}
