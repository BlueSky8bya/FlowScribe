/**
 * character_state.ts — 인물 동적/추론 상태 관리
 *
 * ── 원칙 ────────────────────────────────────────────────────
 * - canonical_characters는 절대 직접 수정하지 않는다
 * - character_dynamic_states는 회차 단위로 갱신한다
 * - character_inferred_states는 confidence + source를 반드시 남긴다
 * - 검증 실패 상태는 commit하지 않는다
 */

import { pool } from "../lib/db.js";
import { logInfo, logError } from "../lib/logger.js";
import type { CharacterDynamicState, CharacterInferredState, CanonicalCharacter } from "../types/canonical.js";

// ── Canonical 조회 ─────────────────────────────────────────────
export async function getCanonicalCharacters(bookId: string): Promise<CanonicalCharacter[]> {
  try {
    const res = await pool.query(
      `SELECT name, personality, type, gender FROM canonical_characters WHERE book_id = $1 ORDER BY created_at ASC`,
      [bookId]
    );
    return res.rows;
  } catch (err) {
    logError("service:character_state", err, { context: "getCanonicalCharacters", book_id: bookId });
    return [];
  }
}

export async function upsertCanonicalCharacter(bookId: string, char: CanonicalCharacter): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO canonical_characters (book_id, name, personality, type, gender, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (book_id, name) DO UPDATE
         SET personality=$3, type=$4, gender=$5, updated_at=NOW()`,
      [bookId, char.name, char.personality, char.type, char.gender]
    );
  } catch (err) {
    logError("service:character_state", err, { context: "upsertCanonicalCharacter", book_id: bookId, name: char.name });
    throw err;
  }
}

// ── Dynamic State 조회 ─────────────────────────────────────────
export async function getLatestDynamicStates(
  bookId: string,
  upToEpisode: number
): Promise<CharacterDynamicState[]> {
  try {
    const res = await pool.query(
      `SELECT DISTINCT ON (character_name)
         book_id, character_name, episode_number,
         location, physical_state, items, recent_goal,
         relationship_updates, foreshadow_connections, behavior_hints, alias_used,
         emotional_state, visibility_state
       FROM character_dynamic_states
       WHERE book_id = $1 AND episode_number <= $2
       ORDER BY character_name, episode_number DESC`,
      [bookId, upToEpisode]
    );
    return res.rows.map(r => ({
      ...r,
      items: r.items ?? [],
      relationship_updates: r.relationship_updates ?? {},
      foreshadow_connections: r.foreshadow_connections ?? [],
      alias_used: r.alias_used ?? [],
    }));
  } catch (err) {
    logError("service:character_state", err, { context: "getLatestDynamicStates", book_id: bookId });
    return [];
  }
}

/** 검증 통과 후 dynamic state 커밋 */
export async function commitDynamicState(state: CharacterDynamicState): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO character_dynamic_states
         (book_id, character_name, episode_number, location, physical_state,
          items, recent_goal, relationship_updates, foreshadow_connections,
          behavior_hints, alias_used, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (book_id, character_name, episode_number) DO UPDATE
         SET location=$4, physical_state=$5, items=$6, recent_goal=$7,
             relationship_updates=$8, foreshadow_connections=$9,
             behavior_hints=$10, alias_used=$11, updated_at=NOW()`,
      [
        state.book_id, state.character_name, state.episode_number,
        state.location ?? null, state.physical_state ?? null,
        JSON.stringify(state.items ?? []),
        state.recent_goal ?? null,
        JSON.stringify(state.relationship_updates ?? {}),
        JSON.stringify(state.foreshadow_connections ?? []),
        state.behavior_hints ?? null,
        JSON.stringify(state.alias_used ?? []),
      ]
    );
    logInfo("service:character_state", "동적 상태 커밋", {
      book_id: state.book_id, name: state.character_name, episode: state.episode_number,
    });
  } catch (err) {
    logError("service:character_state", err, { context: "commitDynamicState" });
    throw err;
  }
}

// ── Inferred State 관리 ────────────────────────────────────────
export async function getInferredStates(
  bookId: string,
  characterName?: string,
  statusFilter: "candidate" | "confirmed" | "all" = "confirmed"
): Promise<CharacterInferredState[]> {
  try {
    const conditions = ["book_id = $1"];
    const params: unknown[] = [bookId];
    if (characterName) { conditions.push(`character_name = $${params.length + 1}`); params.push(characterName); }
    if (statusFilter !== "all") { conditions.push(`status = $${params.length + 1}`); params.push(statusFilter); }

    const res = await pool.query(
      `SELECT id, book_id, character_name, field, value, confidence, source_episode, source_text, status
       FROM character_inferred_states WHERE ${conditions.join(" AND ")} ORDER BY confidence DESC`,
      params
    );
    return res.rows;
  } catch (err) {
    logError("service:character_state", err, { context: "getInferredStates" });
    return [];
  }
}

export async function addInferredCandidate(state: Omit<CharacterInferredState, "id">): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO character_inferred_states
         (book_id, character_name, field, value, confidence, source_episode, source_text, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'candidate')`,
      [state.book_id, state.character_name, state.field, state.value,
       state.confidence, state.source_episode ?? null, state.source_text ?? null]
    );
  } catch (err) {
    logError("service:character_state", err, { context: "addInferredCandidate" });
  }
}

export async function confirmInferredState(id: string): Promise<void> {
  await pool.query(`UPDATE character_inferred_states SET status='confirmed' WHERE id=$1`, [id]);
}

export async function rejectInferredState(id: string): Promise<void> {
  await pool.query(`UPDATE character_inferred_states SET status='rejected' WHERE id=$1`, [id]);
}

// ── Author Interventions 관리 ──────────────────────────────────
import type { AuthorIntervention, WorldRule } from "../types/canonical.js";

export async function getActiveInterventions(
  bookId: string,
  episodeNumber: number
): Promise<AuthorIntervention[]> {
  try {
    const res = await pool.query(
      `SELECT id, book_id, episode_number, instruction, target_scope, duration,
              overrides_rules, conflicts_absolute, is_active
       FROM author_interventions
       WHERE book_id = $1 AND is_active = true
         AND (
           (duration = 'single_episode' AND episode_number = $2)
           OR duration IN ('arc', 'persistent')
         )
       ORDER BY created_at ASC`,
      [bookId, episodeNumber]
    );
    return res.rows;
  } catch (err) {
    logError("service:character_state", err, { context: "getActiveInterventions" });
    return [];
  }
}

export async function addIntervention(intervention: Omit<AuthorIntervention, "id">): Promise<string> {
  // 절대금지 규칙과 충돌하면 저장 거부
  if (intervention.conflicts_absolute) {
    throw new Error("절대금지 규칙과 충돌하는 작가 개입은 저장할 수 없습니다");
  }
  const res = await pool.query(
    `INSERT INTO author_interventions
       (book_id, episode_number, instruction, target_scope, duration,
        overrides_rules, conflicts_absolute, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true)
     RETURNING id`,
    [
      intervention.book_id, intervention.episode_number ?? null,
      intervention.instruction, intervention.target_scope, intervention.duration,
      intervention.overrides_rules ?? [], false,
    ]
  );
  return res.rows[0].id;
}

/** single_episode 개입을 완료 처리 (applied_episodes 기록) */
export async function markInterventionApplied(id: string, episodeNumber: number): Promise<void> {
  await pool.query(
    `UPDATE author_interventions
     SET applied_episodes = array_append(applied_episodes, $2),
         is_active = CASE WHEN duration='single_episode' THEN false ELSE is_active END
     WHERE id = $1`,
    [id, episodeNumber]
  );
}

// ── World Rules 관리 ──────────────────────────────────────────
export async function getWorldRules(bookId: string): Promise<WorldRule[]> {
  try {
    const res = await pool.query(
      `SELECT id, rule_type, content, is_active FROM world_rules
       WHERE book_id = $1 AND is_active = true ORDER BY rule_type, created_at ASC`,
      [bookId]
    );
    return res.rows;
  } catch (err) {
    logError("service:character_state", err, { context: "getWorldRules" });
    return [];
  }
}

export async function addWorldRule(bookId: string, rule: Omit<WorldRule, "id" | "is_active">): Promise<void> {
  await pool.query(
    `INSERT INTO world_rules (book_id, rule_type, content) VALUES ($1,$2,$3)`,
    [bookId, rule.rule_type, rule.content]
  );
}
