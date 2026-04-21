import "dotenv/config";
import { pool } from "../lib/db.js";

const sql = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS calibration JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS calibration_done BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS picture_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_idx ON users(google_id) WHERE google_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '새 이야기',
  context JSONB NOT NULL DEFAULT '{}',
  current_episode INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS books_user_id_idx ON books(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS books_user_title_idx ON books(user_id, title);

CREATE TABLE IF NOT EXISTS reader_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  static_profile JSONB NOT NULL DEFAULT '{}',
  dynamic_profile JSONB NOT NULL DEFAULT '{}',
  genre_profile JSONB NOT NULL DEFAULT '{}',
  session_pacing JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  world_bible JSONB NOT NULL DEFAULT '{}',
  rolling_summary JSONB NOT NULL DEFAULT '{}',
  foreshadow_memory JSONB NOT NULL DEFAULT '[]',
  director_overrides JSONB NOT NULL DEFAULT '[]',
  current_episode INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id TEXT NOT NULL,
  episode_number INT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, episode_number)
);

CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  personality TEXT,
  type TEXT,
  gender TEXT,
  source TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'ai_generated'
  first_appeared_episode INT,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, name)
);

-- 구조화 복선 추적: 심은 화~회수 화 상태 관리
CREATE TABLE IF NOT EXISTS foreshadows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id TEXT NOT NULL,
  planted_episode INT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'resolved' | 'abandoned'
  resolved_episode INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS foreshadows_book_status ON foreshadows(book_id, status);

-- 아크 요약: 10화 단위 압축 메모리
CREATE TABLE IF NOT EXISTS arc_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id TEXT NOT NULL,
  arc_number INT NOT NULL,
  episode_start INT NOT NULL,
  episode_end INT NOT NULL,
  summary TEXT NOT NULL,
  key_events JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, arc_number)
);

-- 인물 아크 상태: 아크 단위 인물 현황
CREATE TABLE IF NOT EXISTS character_arcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  arc_number INT NOT NULL,
  state TEXT NOT NULL,
  key_events JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, character_name, arc_number)
);

-- ── Voice Archive (SOP §16) ────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  description TEXT,
  -- 동의 (Normative: SOP §16.4)
  consent_status TEXT NOT NULL DEFAULT 'pending', -- 'confirmed' | 'pending' | 'revoked'
  consent_version TEXT NOT NULL DEFAULT '1.0',
  consented_at TIMESTAMPTZ,
  -- 사용 범위 (SOP §16.3)
  scope_level TEXT NOT NULL DEFAULT 'private', -- 'private' | 'shared' | 'public'
  -- 허용 정책 (SOP §16.2)
  ai_narration_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  character_voice_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  commercial_use_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  adult_content_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  redistribution_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  genre_restriction TEXT[],  -- null = 무제한
  -- TTS 파라미터
  tts_engine TEXT NOT NULL DEFAULT 'web_speech', -- 'web_speech' | 'elevenlabs' | 'f5tts'
  tts_voice_id TEXT,  -- 시스템 보이스 ID 또는 외부 API ID
  default_rate FLOAT NOT NULL DEFAULT 1.0,
  default_pitch FLOAT NOT NULL DEFAULT 1.0,
  style_tags TEXT[] NOT NULL DEFAULT '{}',      -- ['warm','deep','bright',...]
  character_types TEXT[] NOT NULL DEFAULT '{}', -- ['narrator','hero','villain',...]
  -- 음성 샘플
  sample_path TEXT,
  sample_duration_ms INT,
  -- 상태
  active BOOLEAN NOT NULL DEFAULT TRUE,
  delete_requested BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS va_owner_idx   ON voice_archive(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS va_scope_idx   ON voice_archive(scope_level, active) WHERE deleted_at IS NULL AND consent_status = 'confirmed';

-- 음성 학습 메타데이터 (SOP §18.6) — 감사 추적용, 삭제 안 함
CREATE TABLE IF NOT EXISTS voice_training_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_id UUID NOT NULL REFERENCES voice_archive(id) ON DELETE CASCADE,
  training_session_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  source_owner_id UUID NOT NULL REFERENCES users(id),
  consent_version TEXT NOT NULL DEFAULT '1.0',
  sample_count INT NOT NULL DEFAULT 0,
  total_duration_ms INT NOT NULL DEFAULT 0,
  model_version TEXT,
  tuning_config JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'processing'|'ready'|'failed'
  audit_log JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 캐릭터 → 보이스 매핑 (책 단위)
CREATE TABLE IF NOT EXISTS voice_character_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  voice_id UUID REFERENCES voice_archive(id) ON DELETE SET NULL,
  narrator_role TEXT NOT NULL DEFAULT 'character', -- 'narrator' | 'character'
  pan_position FLOAT NOT NULL DEFAULT 0.0, -- -1.0(L) ~ 1.0(R), Spatial Audio SOP §15.2
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, character_name)
);
CREATE INDEX IF NOT EXISTS vcm_book_idx ON voice_character_map(book_id);

CREATE TABLE IF NOT EXISTS session_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id TEXT NOT NULL,
  episode_number INT NOT NULL,
  dwell_ms INT,
  dropout_position FLOAT,
  rewind_count INT DEFAULT 0,
  speed_changes INT DEFAULT 0,
  completion_rate FLOAT,
  emotion_signals JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log("Migration complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
