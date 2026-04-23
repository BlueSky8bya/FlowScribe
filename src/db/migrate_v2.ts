/**
 * migrate_v2.ts — V2 DB 마이그레이션
 * 실행: npx tsx src/db/migrate_v2.ts
 *
 * 추가 테이블:
 * - canonical_characters   : 인물 사전 설정 (이름/성격/유형/성별)
 * - world_configs          : 작품 기본 설정 (배경/장르/분위기)
 * - world_rules            : 일반규칙 / 절대금지 분리
 * - author_interventions   : 작가 개입 (지속 범위 / 충돌 검사)
 * - character_dynamic_states : 회차별 동적 상태 (위치/부상/소지품 등)
 * - character_inferred_states: 추론 후보 상태 (confidence + source)
 * - episode_snapshots      : 회차 시작 시점 스냅샷
 * - validation_logs        : Claude 검증 결과
 * - revision_logs          : 리비전 이력
 */

import "dotenv/config";
import { pool } from "../lib/db.js";
import { logInfo, logError } from "../lib/logger.js";

const SQL = `
-- ── Canonical Characters ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS canonical_characters (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id        TEXT NOT NULL,
  name           TEXT NOT NULL,
  personality    TEXT NOT NULL DEFAULT '',
  type           TEXT NOT NULL DEFAULT '인간',
  gender         TEXT NOT NULL DEFAULT '해당없음',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, name)
);

-- ── World Configs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS world_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id     TEXT NOT NULL UNIQUE,
  background  TEXT NOT NULL DEFAULT '',
  genre       TEXT NOT NULL DEFAULT '',
  mood        TEXT NOT NULL DEFAULT '',
  theme       TEXT DEFAULT NULL,
  common_tone TEXT DEFAULT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── World Rules (general / absolute_forbidden 분리) ───────────
CREATE TABLE IF NOT EXISTS world_rules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id    TEXT NOT NULL,
  rule_type  TEXT NOT NULL CHECK (rule_type IN ('general','absolute_forbidden')),
  content    TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_world_rules_book
  ON world_rules(book_id, rule_type, is_active);

-- ── Author Interventions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS author_interventions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id            TEXT NOT NULL,
  episode_number     INT,
  instruction        TEXT NOT NULL,
  target_scope       TEXT NOT NULL DEFAULT 'episode',
  duration           TEXT NOT NULL DEFAULT 'single_episode'
                     CHECK (duration IN ('single_episode','arc','persistent')),
  overrides_rules    TEXT[] DEFAULT '{}',
  conflicts_absolute BOOLEAN DEFAULT false,
  applied_episodes   INT[]  DEFAULT '{}',
  is_active          BOOLEAN DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_interventions_book_active
  ON author_interventions(book_id, is_active);

-- ── Character Dynamic States ──────────────────────────────────
CREATE TABLE IF NOT EXISTS character_dynamic_states (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id               TEXT NOT NULL,
  character_name        TEXT NOT NULL,
  episode_number        INT  NOT NULL,
  location              TEXT,
  physical_state        TEXT,
  items                 JSONB DEFAULT '[]',
  recent_goal           TEXT,
  relationship_updates  JSONB DEFAULT '{}',
  foreshadow_connections JSONB DEFAULT '[]',
  behavior_hints        TEXT,
  alias_used            JSONB DEFAULT '[]',
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, character_name, episode_number)
);
CREATE INDEX IF NOT EXISTS idx_char_dynamic_book_ep
  ON character_dynamic_states(book_id, episode_number);

-- ── Character Inferred States ─────────────────────────────────
CREATE TABLE IF NOT EXISTS character_inferred_states (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id        TEXT NOT NULL,
  character_name TEXT NOT NULL,
  field          TEXT NOT NULL,
  value          TEXT NOT NULL,
  confidence     FLOAT NOT NULL DEFAULT 0.5,
  source_episode INT,
  source_text    TEXT,
  status         TEXT NOT NULL DEFAULT 'candidate'
                 CHECK (status IN ('candidate','confirmed','rejected')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inferred_book_char
  ON character_inferred_states(book_id, character_name, status);

-- ── Episode Snapshots ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS episode_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id           TEXT NOT NULL,
  episode_number    INT  NOT NULL,
  gen_config        JSONB NOT NULL DEFAULT '{}',
  world_config      JSONB NOT NULL DEFAULT '{}',
  prev_episode_state JSONB NOT NULL DEFAULT '{}',
  task              JSONB NOT NULL DEFAULT '{}',
  effective_context JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, episode_number)
);

-- ── Validation Logs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS validation_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id             TEXT NOT NULL,
  episode_number      INT  NOT NULL,
  iteration           INT  DEFAULT 1,
  generated_text_chars INT,
  verdict             TEXT,
  hard_violations     JSONB DEFAULT '[]',
  soft_warnings       JSONB DEFAULT '[]',
  quality_scores      JSONB DEFAULT '{}',
  total_score         FLOAT,
  claude_raw_response TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_validation_book_ep
  ON validation_logs(book_id, episode_number);

-- ── Revision Logs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS revision_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_log_id UUID,
  book_id           TEXT NOT NULL,
  episode_number    INT  NOT NULL,
  iteration         INT,
  revised_chars     INT,
  improvement_notes TEXT,
  rules_improved    TEXT[],
  verdict_before    TEXT,
  verdict_after     TEXT,
  -- 학습 추적용 필드 (추가)
  revised_text      TEXT,           -- 수정된 전체 텍스트
  validation_before JSONB,          -- iteration 직전 ValidationResult
  validation_after  JSONB,          -- iteration 직후 ValidationResult
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Run Traces (학습 파이프라인용) ────────────────────────────
-- 파이프라인 한 번 실행의 전체 궤적.
-- TraceLogger (src/training/trace_logger.ts) 가 기록.
-- DatasetBuilder (src/training/dataset_builder.ts) 가 읽어서 학습 데이터 생성.
CREATE TABLE IF NOT EXISTS run_traces (
  trace_id                UUID PRIMARY KEY,
  trace_type              TEXT NOT NULL DEFAULT 'planner'
                          CHECK (trace_type IN ('planner', 'legacy')),
  book_id                 TEXT,
  episode_number          INT  NOT NULL,
  created_at              TIMESTAMPTZ DEFAULT NOW(),

  -- 스냅샷
  effective_context_snapshot JSONB NOT NULL DEFAULT '{}',

  -- 각 단계 trace (nullable — 단계별 실패 허용)
  planner_trace           JSONB,    -- PlannerTrace
  plan_validation         JSONB,    -- PlanValidationResult
  renderer_trace          JSONB,    -- RendererTrace
  prose_validation        JSONB,    -- ValidationResult
  revision_traces         JSONB DEFAULT '[]',

  -- 집계
  final_verdict           TEXT,
  final_score             FLOAT,
  revision_count          INT  DEFAULT 0,
  total_elapsed_ms        INT,

  -- 학습 적합성 레이블 (자동 계산)
  is_planner_sft_eligible   BOOLEAN DEFAULT false,
  is_renderer_sft_eligible  BOOLEAN DEFAULT false,
  is_preference_eligible    BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_run_traces_created
  ON run_traces(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_traces_eligible
  ON run_traces(is_planner_sft_eligible, is_renderer_sft_eligible);
CREATE INDEX IF NOT EXISTS idx_run_traces_book_ep
  ON run_traces(book_id, episode_number);
`;

export async function runMigrateV2(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    logInfo("db:migrate_v2", "V2 마이그레이션 완료 — 11개 테이블 생성/확인 (run_traces, revision_logs 확장 포함)");
  } catch (err) {
    logError("db:migrate_v2", err);
    throw err;
  } finally {
    client.release();
  }
}

// ── 직접 실행 ─────────────────────────────────────────────────
if (process.argv[1]?.endsWith("migrate_v2.ts") || process.argv[1]?.endsWith("migrate_v2.js")) {
  const { pool: _pool } = await import("../lib/db.js");
  try {
    await runMigrateV2();
    console.log("✅ V2 마이그레이션 완료");
  } catch (e) {
    console.error("❌ V2 마이그레이션 실패:", e);
  } finally {
    await _pool.end();
  }
}
