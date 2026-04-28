/**
 * item_desc.ts — 소지품 설명 LLM 자동 생성
 *
 * description이 비어 있는 canonical_characters.initial_items 아이템에 대해
 * 세계관/인물 컨텍스트를 활용한 설명을 생성하고 DB + Redis 캐시에 저장한다.
 *
 * 원칙:
 * - 기존 description이 있으면 절대 덮어쓰지 않는다
 * - LLM 호출 실패 시 조용히 종료 (API 응답에 영향 없음)
 * - description은 60자 이내로 제한한다
 */

import { pool } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { getLLMClient, getSuggestModel } from "../lib/llm.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";

export interface ItemDescJobData {
  book_id: string;
  char_name: string;
  char_personality: string;
  char_type: string;
  char_gender: string;
  items_without_desc: Array<{ name: string; grade?: string | null; condition?: string | null }>;
}

export async function generateAndSaveItemDescriptions(data: ItemDescJobData): Promise<void> {
  const { book_id, char_name, items_without_desc } = data;
  if (!items_without_desc.length) return;

  // 세계관 컨텍스트 fetch (Redis 우선 → DB 폴백)
  let genreLine = "";
  let worldRulesSnippet = "";
  try {
    const raw = await redis.get(`context:${book_id}`);
    const ctx = raw ? JSON.parse(raw) : null;
    if (ctx?.world_rules?.length) {
      const rules: string[] = ctx.world_rules.map((r: any) => (typeof r === "string" ? r : r.content ?? "")).filter(Boolean);
      // 첫 항목이 "장르: ..." 형태인 경우가 많음
      genreLine = rules[0] ?? "";
      worldRulesSnippet = rules.slice(1, 4).join(" / ");
    }
  } catch { /* 컨텍스트 없어도 인물 정보만으로 진행 */ }

  const charSummary = [
    char_name,
    data.char_gender || data.char_type
      ? `(${[data.char_gender, data.char_type].filter(Boolean).join(", ")})`
      : "",
    data.char_personality ? `— ${data.char_personality.slice(0, 80)}` : "",
  ].filter(Boolean).join(" ");

  const itemLines = items_without_desc
    .map((it, i) => {
      const tags = [it.grade ? `${it.grade}등급` : "", it.condition ?? ""].filter(Boolean).join(", ");
      return `${i + 1}. ${it.name}${tags ? ` (${tags})` : ""}`;
    })
    .join("\n");

  const prompt = [
    genreLine         ? `세계관: ${genreLine}`           : "",
    worldRulesSnippet ? `배경 규칙: ${worldRulesSnippet}` : "",
    `인물: ${charSummary}`,
    "",
    "아래 소지품 각각에 대해, 이 인물과 세계관에 어울리는 짧은 설명을 한 문장(30자 이내 한국어)으로 작성하세요.",
    `반드시 JSON 배열 형식으로만 응답하세요: [{"name":"소지품명","description":"설명"}]`,
    "",
    "소지품:",
    itemLines,
  ].filter(s => s !== undefined).join("\n");

  let descMap: Record<string, string> = {};
  try {
    const client = getLLMClient();
    const resp = await client.chat.completions.create({
      model: getSuggestModel(),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 400,
    });

    const raw = resp.choices[0]?.message?.content?.trim() ?? "";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logWarn("service:item_desc", "LLM 응답 JSON 없음", { book_id, char_name, raw: raw.slice(0, 200) });
      return;
    }
    const parsed: Array<{ name: string; description: string }> = JSON.parse(jsonMatch[0]);
    for (const d of parsed) {
      if (d.name && d.description) {
        descMap[d.name] = d.description.slice(0, 60);
      }
    }
  } catch (err) {
    logError("service:item_desc", err, { book_id, char_name });
    return;
  }

  if (!Object.keys(descMap).length) return;

  // DB 업데이트: description 없는 아이템만 채움 (idempotent)
  try {
    const result = await pool.query(
      `SELECT initial_items FROM canonical_characters WHERE book_id = $1 AND name = $2`,
      [book_id, char_name]
    );
    const current: any[] = result.rows[0]?.initial_items ?? [];
    const updated = current.map((it: any) => {
      if (!it.description && descMap[it.name]) {
        return { ...it, description: descMap[it.name] };
      }
      return it;
    });
    await pool.query(
      `UPDATE canonical_characters SET initial_items = $3, updated_at = NOW()
       WHERE book_id = $1 AND name = $2`,
      [book_id, char_name, JSON.stringify(updated)]
    );
    logInfo("service:item_desc", "소지품 설명 저장 완료", {
      book_id, char_name, count: Object.keys(descMap).length,
    });
  } catch (err) {
    logError("service:item_desc", err, { context: "db_update", book_id, char_name });
    return;
  }

  // Redis 캐시 갱신 (context character_defaults에도 반영)
  try {
    const ctxRaw = await redis.get(`context:${book_id}`);
    if (!ctxRaw) return;
    const ctx = JSON.parse(ctxRaw);
    const def = ctx.character_defaults?.[char_name];
    if (def && typeof def === "object" && Array.isArray(def.initial_items)) {
      def.initial_items = def.initial_items.map((it: any) => {
        if (!it.description && descMap[it.name]) return { ...it, description: descMap[it.name] };
        return it;
      });
      await redis.set(`context:${book_id}`, JSON.stringify(ctx), "KEEPTTL");
    }
  } catch { /* Redis 갱신 실패는 무시 — DB가 source of truth */ }
}
