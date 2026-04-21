import { redis } from "../lib/redis.js";
import { logInfo, logError } from "../lib/logger.js";
import type { ReaderProfile } from "./story.js";
import type { SessionLogInput } from "./logger.js";

const PROFILE_TTL = 60 * 60 * 24 * 90; // 90일

export const DEFAULT_PROFILE: ReaderProfile = {
  focus: 55,
  sentiment: 55,
  urgency: 50,
  complexity: 55,
  dialogue: 55,
  audio_sync: 40,
};

function clamp(v: number) { return Math.max(0, Math.min(100, Math.round(v))); }

// 로그 데이터로부터 프로필 조정 신호 계산
function computeDelta(log: SessionLogInput): Partial<ReaderProfile> {
  const delta: Partial<ReaderProfile> = {};
  const cr  = log.completion_rate  ?? 0.5;
  const rc  = log.rewind_count     ?? 0;
  const dp  = log.dropout_position;  // 0.0~1.0 or null
  const sc  = log.speed_changes     ?? 0;

  // 완독률 → urgency, focus
  if (cr >= 0.95)      { delta.urgency = +6; delta.focus = +4; }
  else if (cr >= 0.75) { delta.urgency = +2; }
  else if (cr < 0.50)  { delta.urgency = -6; delta.focus = -4; }

  // 되감기 → complexity (3+이면 너무 어렵다는 신호)
  if (rc >= 3 && cr < 0.85)        delta.complexity = -6;
  else if (rc === 0 && cr > 0.85)  delta.complexity = +2;

  // 초반 이탈 → urgency 하락, dialogue 상향
  if (dp !== null && dp !== undefined && dp < 0.3) {
    delta.urgency  = (delta.urgency  ?? 0) - 8;
    delta.dialogue = (delta.dialogue ?? 0) + 4;
  }

  // 속도 변경 多 → 현재 페이싱이 맞지 않음
  if (sc >= 3) delta.urgency = (delta.urgency ?? 0) + 3;

  return delta;
}

// 직접 가중치 조정 (delta 값 자체가 이미 학습률 반영된 크기)
function applyDelta(profile: ReaderProfile, delta: Partial<ReaderProfile>): ReaderProfile {
  const keys = ["focus","sentiment","urgency","complexity","dialogue","audio_sync"] as const;
  const next = { ...profile };
  for (const k of keys) {
    if (delta[k] !== undefined) next[k] = clamp(profile[k] + delta[k]!);
  }
  return next;
}

export async function getProfile(bookId: string): Promise<ReaderProfile> {
  const raw = await redis.get(`profile:${bookId}`);
  if (!raw) return { ...DEFAULT_PROFILE };
  try { return JSON.parse(raw); } catch { return { ...DEFAULT_PROFILE }; }
}

export async function updateProfileFromLog(log: SessionLogInput): Promise<void> {
  try {
    const current = await getProfile(log.book_id);
    const delta   = computeDelta(log);
    const updated = applyDelta(current, delta);
    await redis.set(`profile:${log.book_id}`, JSON.stringify(updated), "EX", PROFILE_TTL);
    logInfo("service:profile", "ReaderProfile 갱신 완료", {
      book_id: log.book_id,
      episode: log.episode_number,
      delta,
      updated,
    });
  } catch (err) {
    logError("service:profile", err, { book_id: log.book_id, episode: log.episode_number });
    throw err;
  }
}
