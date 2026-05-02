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

// Phase 4.20 R5A stabilization — 소지품 설명 sanitizer.
// 정책 (사장 지시):
//   "40자 제한, 40자에서 딱 끊지 말고 그 지점에 속한 문장까지, 간단하게만"
//   → target 40자, sentence-aware cut.
//   1) 종결부(.!?。…)가 있으면 ends 중 가장 적합한 cut 선택:
//        - position 40을 처음으로 넘는 종결부가 있으면 그 위치
//        - 그렇지 않으면 마지막 종결부
//      단, 단일 문장이 너무 길면(>50자) 어절 경계에서 hard trim — "40 제한" 우선.
//   2) 종결부가 없는 long string은 어절 경계 trim + 마침표.
// 사용자 입력(user_desc)은 sanitize 대상 아님 — LLM 결과만 적용.
const _ITEM_DESC_TARGET_CHARS = 40;
const _ITEM_DESC_SENT_HARD = 50; // 단일 문장 최대 — 이걸 넘으면 어절 trim
const _SENT_END_RE = /[\.\?!。…]+/g;
function _wordBoundaryTrim(s: string, maxLen: number): string {
  const cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  let trimmed = lastSpace > maxLen - 15 ? cut.slice(0, lastSpace) : cut;
  trimmed = trimmed.replace(/[\s,，·\-]+$/u, "");
  return trimmed;
}
export function sanitizeLLMItemDescription(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw).trim();
  if (!s) return "";
  // 자주 나오는 prefix echo 제거 (예: "이 아이템은", "[설명]" 등)
  s = s.replace(/^\s*\[?설명\]?[:：]?\s*/u, "");

  // 모든 문장 종결부 위치 (cut point = 종결부 끝 인덱스)
  const ends: number[] = [];
  for (const m of s.matchAll(_SENT_END_RE)) ends.push(m.index! + m[0].length);

  if (ends.length > 0) {
    // position 40을 포함/넘는 첫 종결부, 없으면 마지막 종결부
    const cutIdx = ends.find(e => e >= _ITEM_DESC_TARGET_CHARS) ?? ends[ends.length - 1];
    s = s.slice(0, cutIdx).trim();
    // "그 지점에 속한 문장까지" — 단, 단일 문장이 50자 초과면 너무 길다고 판단,
    // 40자 어절 경계로 hard trim (사장 지시: "40자 제한" 우선).
    if (s.length > _ITEM_DESC_SENT_HARD) {
      s = _wordBoundaryTrim(s, _ITEM_DESC_TARGET_CHARS);
    }
  } else {
    // 종결부 없는 단일 문장 — 40자 어절 경계 trim.
    if (s.length > _ITEM_DESC_TARGET_CHARS) {
      s = _wordBoundaryTrim(s, _ITEM_DESC_TARGET_CHARS);
    }
  }

  // 종결부가 없으면 마침표 보강
  if (s && !/[\.\?!。…]$/u.test(s)) s += ".";
  return s;
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
    // Phase 4.20 R5A stabilization — 카드 안에서 한눈에 읽히도록 아주 짧게.
    "1. description (한국어, 한 문장, 약 30~40자, 마침표로 종료):",
    "   - 독서 보조용 짧은 한 문장 (설정집 문단 아님).",
    "   - 사물의 핵심 용도/특징 1개만. \"이 물건은 무엇이고 어떻게 쓰이는가\".",
    "   - [사용자 입력 설명]이 있으면 핵심 사실만 한 문장으로 압축.",
    "   - [사용자 입력 설명]이 없으면 인물·세계관에서 자연스럽게 한 줄로.",
    "   - 예: \"어두운 곳을 비추는 휴대용 조명이다.\" / \"통신과 기록 확인에 쓰는 개인 스마트폰이다.\"",
    "   - 복문·여러 문장 금지. 40자를 넘기지 않도록.",
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
        // Phase 4.20 R5A stabilization — LLM 생성 description sanitize (60자 max, 1문장).
        // user_desc는 sanitize 대상 아님 — 이미 prompt source로 사용되었고 응답에 반영되어도 짧게 정제됨.
        results.push({
          name:        d.name,
          description: sanitizeLLMItemDescription(d.description),
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
    // Phase 4.20 R5A stabilization — LLM이 작성한 description에 description_source: "llm" 마킹.
    // FE 또는 read-time defensive sanitizer가 source 기반으로 판단할 수 있게 한다.
    // 사용자가 직접 입력한 description은 source 없거나 "user" 그대로 보존.
    const updated = current.map((it: any) => {
      if (descMap[it.name]) {
        return { ...it, description: descMap[it.name], description_source: "llm" };
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

// POST-1 §P1-A — vocab-only 분류 (description / DB items 미터치).
// 스토리 진행 중 새로 등장한 dynamic items는 vocab에 안 들어가서 카테고리 배지가
// "기타" 또는 미표시되는 root cause를 막기 위함.
//
// 호출 정책:
// - char-states 엔드포인트에서 vocab 미등록 dynamic 아이템을 모아 fire-and-forget.
// - description은 절대 덮지 않음 (사용자 입력 보존 정책 + dynamic items는 stateExtractor 출력).
// - item_vocab만 누적 — 다음 char-states 호출 시 vocab lookup이 hit해서 정상 카테고리 부여.
export interface ClassifyOnlyJobData {
  book_id: string;
  // 분류 대상 아이템 이름들. 인물/세계관 컨텍스트 없이 이름만으로 분류
  // (정확도가 generateAndSaveItemDescriptions보다 약간 낮을 수 있으나, fallback 용도로 적절).
  item_names: string[];
}

const _CATEGORY_LIST = ["무기", "방어구", "도구", "소모품", "문서", "마법", "통신", "전자", "기기", "의복", "식량", "귀중품", "악기", "탈것", "기타"];
const _CATEGORY_TO_BADGE: Record<string, string> = Object.fromEntries(_CATEGORY_LIST.map(c => [c, c]));

export async function classifyAndSaveItemCategories(data: ClassifyOnlyJobData): Promise<void> {
  const { book_id, item_names } = data;
  const names = Array.from(new Set((item_names || []).filter(n => n && typeof n === "string"))).slice(0, 30);
  if (!names.length) return;

  // 이미 vocab에 있는 것은 제외 (idempotent)
  let pending = names;
  try {
    const existRes = await pool.query(
      `SELECT name FROM item_vocab WHERE book_id = $1 AND name = ANY($2::text[])`,
      [book_id, names]
    );
    const exist = new Set(existRes.rows.map(r => r.name));
    pending = names.filter(n => !exist.has(n));
  } catch { /* 조회 실패 시 모두 분류 시도 */ }
  if (!pending.length) return;

  const itemLines = pending.map((n, i) => `${i + 1}. ${n}`).join("\n");
  const prompt = [
    `다음 소지품 각각에 대해 카테고리만 분류해주세요.`,
    `카테고리 옵션: ${_CATEGORY_LIST.join(", ")}`,
    ``,
    `반드시 JSON 배열로만 응답: [{"name":"소지품명","category":"카테고리"}]`,
    `다른 텍스트(설명, 코드블록 마커 등) 금지.`,
    ``,
    `[소지품 목록]`,
    itemLines,
  ].join("\n");

  let parsed: Array<{ name: string; category: string }> = [];
  try {
    const client = getLLMClient();
    const resp = await client.chat.completions.create({
      model: getSuggestModel(),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2, // 분류는 결정적
      max_tokens: 800,
    });
    const raw = resp.choices[0]?.message?.content?.trim() ?? "";
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) {
      logWarn("service:item_desc:classify_only", "LLM 응답 JSON 없음", { book_id, names_n: pending.length, raw: raw.slice(0, 200) });
      return;
    }
    const arr = JSON.parse(m[0]);
    parsed = (Array.isArray(arr) ? arr : [])
      .filter(e => e && typeof e === "object" && e.name && e.category)
      .map(e => ({ name: String(e.name), category: _CATEGORY_TO_BADGE[String(e.category)] ? String(e.category) : "기타" }));
  } catch (err) {
    logError("service:item_desc:classify_only", err, { book_id, names_n: pending.length });
    return;
  }
  if (!parsed.length) return;

  // vocab 저장 — ON CONFLICT DO NOTHING (idempotent)
  try {
    for (const r of parsed) {
      const badgeLabel = _CATEGORY_TO_BADGE[r.category] ?? "기타";
      await pool.query(
        `INSERT INTO item_vocab (book_id, name, category, badge_label)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (book_id, name) DO NOTHING`,
        [book_id, r.name, r.category, badgeLabel]
      );
    }
    logInfo("service:item_desc:classify_only", "vocab 누적", {
      book_id, classified: parsed.length, requested: pending.length,
    });
  } catch (err) {
    logError("service:item_desc:classify_only", err, { context: "vocab_save", book_id });
  }
}
