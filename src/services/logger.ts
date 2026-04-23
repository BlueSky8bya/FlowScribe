import { pool } from "../lib/db.js";
import { logSaveQueue, profileUpdateQueue } from "../queues/index.js";

export interface SessionLogInput {
  book_id: string;
  episode_number: number;
  user_id?: string;           // 유저 단위 프로필 갱신용 (optional, 신규 경로)
  dwell_ms?: number;
  dropout_position?: number;  // 0.0 ~ 1.0
  rewind_count?: number;
  completion_rate?: number;   // 0.0 ~ 1.0
  speed_changes?: number;
  emotion_signals?: Record<string, number>;
}

export async function enqueueLog(data: SessionLogInput): Promise<void> {
  await logSaveQueue.add("save-log", data, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
  await profileUpdateQueue.add("update-profile", data, { attempts: 3, backoff: { type: "exponential", delay: 3000 } });
}

export async function writeLog(data: SessionLogInput): Promise<void> {
  await pool.query(
    `INSERT INTO session_logs
       (book_id, episode_number, dwell_ms, dropout_position, rewind_count,
        completion_rate, speed_changes, emotion_signals, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [
      data.book_id,
      data.episode_number,
      data.dwell_ms    ?? null,
      data.dropout_position ?? null,
      data.rewind_count ?? 0,
      data.completion_rate  ?? null,
      data.speed_changes    ?? 0,
      data.emotion_signals  ? JSON.stringify(data.emotion_signals) : null,
    ]
  );
}

export async function getRecentLogs(book_id: string, limit = 10) {
  const result = await pool.query(
    `SELECT * FROM session_logs WHERE book_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [book_id, limit]
  );
  return result.rows;
}
