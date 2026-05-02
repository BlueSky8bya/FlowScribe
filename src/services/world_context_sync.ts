/**
 * world_context_sync.ts — POST-S13.5 P0 fix
 *
 * books.context (jsonb) + world_configs + world_rules + Redis 4중 source를 한 번에 동기화.
 * saveContext API와 repair script가 모두 본 helper를 호출해 source-of-truth drift를 차단한다.
 *
 * 처리:
 *   1. books.context 전체 jsonb UPDATE
 *   2. world_configs upsert (genre/mood/background/theme/common_tone)
 *      - story_config 우선, world_rules의 "장르: ..." prefix는 폴백
 *   3. world_rules — 기존 row is_active=false → general/absolute_forbidden 재INSERT (idempotent)
 *   4. Redis SET context:${book_id} TTL 7일 (DB 성공 후)
 *
 * 안전:
 *   - book_id 미입력 시 throw
 *   - DB 4구간을 단일 트랜잭션으로 묶음 — 중간 실패 시 ROLLBACK
 *   - Redis 실패는 log + 계속 (DB가 truth)
 */

import type { PoolClient } from "pg";
import { pool } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { logInfo, logWarn } from "../lib/logger.js";

const TTL = 60 * 60 * 24 * 7; // 7일

export interface WorldContextPayload {
  story_config?: Record<string, any>;
  world_rules?: string[];
  character_defaults?: Record<string, any>;
  forbidden_settings?: string[];
  fixed_relationships?: any[];
  [k: string]: any;
}

export interface SyncWorldContextResult {
  genre_synced: string;
  general_count: number;
  forbidden_count: number;
}

/**
 * 4중 sync — books.context + world_configs + world_rules + Redis.
 *
 * 외부 트랜잭션 client를 받지 않는다. 본 helper가 자체 트랜잭션을 가진다.
 * (saveContext / repair script가 helper 호출 외에 별도 DB write를 가지면 그건 helper 트랜잭션 밖에서.)
 */
export async function syncWorldContext(book_id: string, payload: WorldContextPayload): Promise<SyncWorldContextResult> {
  if (!book_id) throw new Error("syncWorldContext: book_id required");
  if (!payload) throw new Error("syncWorldContext: payload required");

  // story_config / world_rules 정규화
  const sc = (payload.story_config ?? {}) as Record<string, any>;
  const inputRules: string[] = Array.isArray(payload.world_rules) ? payload.world_rules.map(String) : [];
  const inputForbidden: string[] = Array.isArray(payload.forbidden_settings) ? payload.forbidden_settings.map(String) : [];

  // "장르: ..." prefix 추출 (story_config.genre가 우선)
  let extractedGenre: string | null = null;
  const generalRules: string[] = [];
  for (const r of inputRules) {
    const trimmed = r.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^장르\s*[:：]\s*(.+)$/);
    if (m && !extractedGenre) extractedGenre = m[1].trim();
    else generalRules.push(trimmed);
  }

  const genreFinal      = (sc.genre as string | undefined) ?? extractedGenre ?? "";
  const backgroundFinal = (sc.background as string | undefined) ?? "";
  const moodFinal       = (sc.mood as string | undefined) ?? "";
  const themeFinal      = (sc.theme as string | undefined) ?? null;
  const commonToneFinal = (sc.common_tone as string | undefined) ?? null;

  // ── DB 트랜잭션 (4 구간 중 books + world_configs + world_rules) ──
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // (1) books.context UPDATE
    await client.query(
      `UPDATE books SET context = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(payload), book_id]
    );

    // (2) world_configs upsert
    await client.query(
      `INSERT INTO world_configs (book_id, background, genre, mood, theme, common_tone)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (book_id) DO UPDATE
         SET background = EXCLUDED.background,
             genre      = EXCLUDED.genre,
             mood       = EXCLUDED.mood,
             theme      = EXCLUDED.theme,
             common_tone= EXCLUDED.common_tone,
             updated_at = NOW()`,
      [book_id, backgroundFinal, genreFinal, moodFinal, themeFinal, commonToneFinal]
    );

    // (3) world_rules — 기존 row 모두 비활성화 후 재등록 (idempotent)
    await client.query(`UPDATE world_rules SET is_active = false WHERE book_id = $1`, [book_id]);

    const seen = new Set<string>();
    for (const content of generalRules) {
      const key = `general::${content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await client.query(
        `INSERT INTO world_rules (book_id, rule_type, content, is_active) VALUES ($1, 'general', $2, true)`,
        [book_id, content]
      );
    }
    for (const content of inputForbidden) {
      const trimmed = content.trim();
      if (!trimmed) continue;
      const key = `absolute_forbidden::${trimmed}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await client.query(
        `INSERT INTO world_rules (book_id, rule_type, content, is_active) VALUES ($1, 'absolute_forbidden', $2, true)`,
        [book_id, trimmed]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // (4) Redis SET — DB 성공 후. 실패해도 throw 안 함 (DB가 truth, log + 계속).
  try {
    await redis.set(`context:${book_id}`, JSON.stringify(payload), "EX", TTL);
  } catch (e) {
    logWarn("services:world_context_sync", "Redis 갱신 실패 (DB는 성공)", {
      book_id, error: String((e as any)?.message ?? e),
    });
  }

  logInfo("services:world_context_sync", "4중 sync 완료", {
    book_id,
    genre: genreFinal,
    general_count: generalRules.length,
    forbidden_count: inputForbidden.length,
  });

  return {
    genre_synced: genreFinal,
    general_count: generalRules.length,
    forbidden_count: inputForbidden.length,
  };
}
