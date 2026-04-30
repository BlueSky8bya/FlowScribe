/**
 * item_desc.ts — 소지품 설명 LLM 작성 (Phase 4.19 리팩터)
 *
 * 모든 initial_items에 대해 인물 성격·이름·성별·세계관 + 사용자가 입력한
 * 초기 설명(있으면)을 source로 LLM이 description을 작성한다.
 * 배지(category)는 frontend의 키워드 분류가 우선이므로 백엔드는 가능한 경우만
 * 보조적으로 vocab에 누적한다.
 *
 * 원칙:
 * - 사용자 user_desc가 있으면 그것을 LLM 입력의 source로 사용 (그대로 베끼지 않고 풀어쓰기)
 * - LLM 출력이 없으면 기존 description 유지 (덮어쓰지 않음)
 * - description은 약 90자 이내 한국어 — 인물의 시선/감정/관계가 묻어나는 짧은 묘사
 * - LLM 호출 실패 시 조용히 종료 (API 응답에 영향 없음)
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
  // Phase 4.19 — 모든 아이템 (사용자가 입력한 user_desc 포함). 없으면 LLM이 새로 작성.
  items_without_desc: Array<{
    name: string;
    grade?: string | null;
    condition?: string | null;
    user_desc?: string | null;
  }>;
}

// 카테고리 → 배지 레이블 매핑
const CATEGORY_BADGE: Record<string, string> = {
  무기:   "무기",
  방어구: "방어구",
  도구:   "도구",
  소모품: "소모품",
  문서:   "문서",
  마법:   "마법",
  통신:   "통신",
  전자:   "전자",
  기기:   "기기",   // Phase 4.19 — 스마트폰·태블릿·노트북·컴퓨터 등 디지털 디바이스
  의복:   "의복",
  식량:   "식량",
  귀중품: "귀중품",
  악기:   "악기",
  탈것:   "탈것",
  기타:   "기타",
};

export async function generateAndSaveItemDescriptions(data: ItemDescJobData): Promise<void> {
  const { book_id, char_name, items_without_desc } = data;
  if (!items_without_desc.length) return;

  // 세계관 컨텍스트 fetch (Redis 우선 → DB 폴백)
  let genreLine = "";
  let worldBackgroundLine = "";
  let worldRulesSnippet = "";
  let forbiddenSnippet = "";
  try {
    const raw = await redis.get(`context:${book_id}`);
    const ctx = raw ? JSON.parse(raw) : null;
    if (ctx?.world_rules?.length) {
      const rules: string[] = ctx.world_rules.map((r: any) => (typeof r === "string" ? r : r.content ?? "")).filter(Boolean);
      genreLine = rules[0] ?? "";
      worldRulesSnippet = rules.slice(1, 4).join(" / ");
    }
    if (ctx?.story_config?.background) worldBackgroundLine = String(ctx.story_config.background).slice(0, 200);
    if (Array.isArray(ctx?.forbidden_settings) && ctx.forbidden_settings.length) {
      forbiddenSnippet = ctx.forbidden_settings.slice(0, 3).map(String).join(" / ");
    }
  } catch { /* 컨텍스트 없어도 인물 정보만으로 진행 */ }

  // 인물 풀 personality (slice 80 → 250). LLM이 인물의 시선·말투에 맞춰 묘사하도록 충분한 정보 제공.
  const charSummary = [
    `${char_name}`,
    data.char_gender || data.char_type
      ? `(${[data.char_gender, data.char_type].filter(Boolean).join(", ")})`
      : "",
    data.char_personality ? `— ${data.char_personality.slice(0, 250)}` : "",
  ].filter(Boolean).join(" ");

  // 각 아이템에 사용자가 입력한 user_desc(있으면) 같이 노출 → LLM이 그것을 source로 풀어쓰기
  const itemLines = items_without_desc
    .map((it, i) => {
      const tags = [it.grade ? `${it.grade}등급` : "", it.condition ?? ""].filter(Boolean).join(", ");
      const ud = it.user_desc?.trim();
      const udPart = ud ? `\n   [사용자 입력 설명] ${ud}` : "";
      return `${i + 1}. ${it.name}${tags ? ` (${tags})` : ""}${udPart}`;
    })
    .join("\n");

  const categoryList = Object.keys(CATEGORY_BADGE).join(", ");

  const prompt = [
    genreLine            ? `[세계관] ${genreLine}`               : "",
    worldBackgroundLine  ? `[배경] ${worldBackgroundLine}`        : "",
    worldRulesSnippet    ? `[일반 규칙] ${worldRulesSnippet}`     : "",
    forbiddenSnippet     ? `[절대 규칙] ${forbiddenSnippet}`      : "",
    `[인물] ${charSummary}`,
    "",
    "위 인물의 소지품 각 항목에 대해 다음 두 가지를 작성하세요.",
    "",
    "1. description (한국어, 60~90자, 한 문장):",
    "   - 이 인물의 성격·시선·세계관 분위기가 묻어나는 짧은 묘사",
    "   - 단순 사물 정의가 아니라 \"누구의 어떤 물건인지\"가 느껴지게",
    "   - [사용자 입력 설명]이 있으면 사실은 유지하되 인물·세계관 톤으로 풀어쓰기",
    "   - [사용자 입력 설명]이 없으면 인물 성격과 세계관에서 자연스럽게 추론",
    "   - 설명충처럼 '~이다, ~할 수 있다' 나열 금지. 한 호흡의 묘사로.",
    "",
    `2. category: ${categoryList} 중 하나 (해당 없으면 "기타")`,
    "",
    `반드시 JSON 배열 형식으로만 응답하세요: [{"name":"소지품명","description":"설명","category":"유형"}]`,
    "다른 텍스트(설명, 코드블록 마커 등)는 출력하지 마세요.",
    "",
    "[소지품 목록]",
    itemLines,
  ].filter(s => s !== "").join("\n");

  let results: Array<{ name: string; description: string; category: string }> = [];
  try {
    const client = getLLMClient();
    const resp = await client.chat.completions.create({
      model: getSuggestModel(),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.55, // 묘사 다양성 조금 ↑
      max_tokens: 1200,  // description 길어진 만큼 ↑
    });

    const raw = resp.choices[0]?.message?.content?.trim() ?? "";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logWarn("service:item_desc", "LLM 응답 JSON 없음", { book_id, char_name, raw: raw.slice(0, 200) });
      return;
    }
    const parsed: Array<{ name: string; description: string; category?: string }> = JSON.parse(jsonMatch[0]);
    for (const d of parsed) {
      if (d.name && d.description) {
        results.push({
          name:        d.name,
          description: d.description.slice(0, 140), // Phase 4.19 — 60 → 140자 (몰입감)
          category:    d.category && CATEGORY_BADGE[d.category] ? d.category : "기타",
        });
      }
    }
  } catch (err) {
    logError("service:item_desc", err, { book_id, char_name });
    return;
  }

  if (!results.length) return;

  const descMap: Record<string, string>     = {};
  const catMap:  Record<string, string>     = {};
  for (const r of results) { descMap[r.name] = r.description; catMap[r.name] = r.category; }

  // DB 업데이트: description 없는 아이템만 채움 (idempotent)
  try {
    const result = await pool.query(
      `SELECT initial_items FROM canonical_characters WHERE book_id = $1 AND name = $2`,
      [book_id, char_name]
    );
    const current: any[] = (result.rows[0]?.initial_items ?? []).map((it: any) =>
      typeof it === "string" ? { name: it } : it
    );
    // Phase 4.19 — LLM이 작성한 결과로 description 덮어쓴다.
    // 사용자가 입력한 user_desc는 LLM prompt의 source로 이미 사용됐으므로 결과에 반영됨.
    // LLM 결과가 없는 경우(매칭 실패)에만 기존 description 유지.
    const updated = current.map((it: any) => {
      if (descMap[it.name]) {
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
      book_id, char_name, count: results.length,
    });
  } catch (err) {
    logError("service:item_desc", err, { context: "db_update", book_id, char_name });
    return;
  }

  // item_vocab 저장 — 이미 있으면 무시 (INSERT ... ON CONFLICT DO NOTHING)
  try {
    for (const r of results) {
      const badgeLabel = CATEGORY_BADGE[r.category] ?? "기타";
      await pool.query(
        `INSERT INTO item_vocab (book_id, name, category, badge_label)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (book_id, name) DO NOTHING`,
        [book_id, r.name, r.category, badgeLabel]
      );
    }
    logInfo("service:item_desc", "item_vocab 저장 완료", {
      book_id, char_name, count: results.length,
    });
  } catch (err) {
    logError("service:item_desc", err, { context: "vocab_save", book_id, char_name });
    // vocab 실패는 무시 — description은 이미 저장됨
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
