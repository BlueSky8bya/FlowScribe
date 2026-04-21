import "dotenv/config";
import { pool } from "../lib/db.js";

async function reset() {
  const client = await pool.connect();
  try {
    await client.query(`DROP TABLE IF EXISTS session_logs`);
    await client.query(`
      CREATE TABLE session_logs (
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
      )
    `);
    console.log("session_logs recreated.");
  } finally {
    client.release();
    await pool.end();
  }
}

reset().catch(err => { console.error(err); process.exit(1); });
