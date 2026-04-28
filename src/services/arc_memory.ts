/**
 * arc_memory.ts — 아크 단위(10화) 장기 기억 관리
 *
 * 핵심 원칙:
 * - 10화 완료 시마다 아크 요약 + 인물 상태 자동 생성
 * - 100화 이상에서도 O(arc_count) 토큰으로 전체 서사 맥락 주입 가능
 * - 각 아크 요약은 "주요 사건 + 인물 변화 + 미해결 긴장" 3요소 포함
 */

import { getLLMClient, getSummaryModel } from "../lib/llm.js";
import { pool } from "../lib/db.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";

const ARC_SIZE = 10; // 화 단위

export interface ArcSummary {
  arc_number: number;
  episode_start: number;
  episode_end: number;
  summary: string;
  key_events: string[];
}

export interface CharacterArc {
  character_name: string;
  arc_number: number;
  state: string;
  key_events: string[];
}

// ── 아크 요약 목록 조회 ──────────────────────────────────
export async function getArcSummaries(bookId: string): Promise<ArcSummary[]> {
  try {
    const res = await pool.query<ArcSummary>(
      `SELECT arc_number, episode_start, episode_end, summary, key_events
       FROM arc_summaries WHERE book_id = $1 ORDER BY arc_number ASC`,
      [bookId]
    );
    logInfo("service:arc_memory", "아크 요약 조회", { book_id: bookId, count: res.rows.length });
    return res.rows;
  } catch (err) {
    logError("service:arc_memory", err, { context: "getArcSummaries", book_id: bookId });
    return [];
  }
}

// ── 최신 인물 아크 상태 조회 ─────────────────────────────
export async function getLatestCharacterArcs(
  bookId: string,
  characterNames: string[]
): Promise<Record<string, CharacterArc>> {
  if (!characterNames.length) return {};
  try {
    const res = await pool.query(
      `SELECT DISTINCT ON (character_name) character_name, arc_number, state, key_events
       FROM character_arcs WHERE book_id = $1 AND character_name = ANY($2)
       ORDER BY character_name, arc_number DESC`,
      [bookId, characterNames]
    );
    const result: Record<string, CharacterArc> = {};
    for (const row of res.rows) result[row.character_name] = row;
    logInfo("service:arc_memory", "인물 아크 조회", {
      book_id: bookId,
      requested: characterNames.length,
      found: Object.keys(result).length,
    });
    return result;
  } catch (err) {
    logError("service:arc_memory", err, { context: "getLatestCharacterArcs", book_id: bookId });
    return {};
  }
}

// ── 아크 완료 시 요약 생성 + 저장 ────────────────────────
export async function generateAndSaveArcSummary(
  bookId: string,
  arcNumber: number,
  characterNames: string[],
  /** 단편 최종화용 명시적 epEnd 오버라이드 (미지정 시 arcNumber * ARC_SIZE) */
  epEndOverride?: number,
): Promise<void> {
  const epStart = (arcNumber - 1) * ARC_SIZE + 1;
  const epEnd   = epEndOverride ?? arcNumber * ARC_SIZE;

  try {
    const epRes = await pool.query(
      `SELECT episode_number, content FROM episodes
       WHERE book_id = $1 AND episode_number BETWEEN $2 AND $3
       ORDER BY episode_number ASC`,
      [bookId, epStart, epEnd]
    );

    if (!epRes.rows.length) {
      logWarn("service:arc_memory", "아크 화 없음 — 요약 생략", { book_id: bookId, arc_number: arcNumber });
      return;
    }

    // 각 화 요약만 사용 (토큰 절약)
    const summaryRes = await pool.query(
      `SELECT episode_number, summary FROM episodes
       WHERE book_id = $1 AND episode_number BETWEEN $2 AND $3
       ORDER BY episode_number ASC`,
      [bookId, epStart, epEnd]
    );
    const epSummaries = summaryRes.rows
      .map(r => `${r.episode_number}화: ${r.summary}`)
      .join("\n");

    logInfo("service:arc_memory", "아크 요약 생성 시작", {
      book_id: bookId,
      arc_number: arcNumber,
      ep_range: `${epStart}~${epEnd}`,
      episodes_found: epRes.rows.length,
    });

    // 아크 요약 생성 — 구조화 포맷으로 인물명 보존 강제
    const charList = characterNames.join(", ");
    const arcRes = await getLLMClient().chat.completions.create({
      model: getSummaryModel(),
      messages: [
        {
          role: "system",
          content: [
            "당신은 소설 아크 분석 전문가다.",
            "반드시 아래 3개 섹션 형식을 정확히 지켜서 출력한다. 다른 형식 금지.",
            "[주요 사건] 이 아크에서 일어난 핵심 사건 2~3문장. 반드시 인물 이름을 직접 사용한다.",
            "[인물 현재 상태] 각 인물의 상태를 '이름: 한 문장' 형식으로 한 줄씩 나열한다. '그', '그녀' 대신 반드시 이름을 쓴다. 등장하지 않은 인물도 '이름: 이 아크에서 미등장' 형식으로 기록한다.",
            "[미해결 긴장] 다음 아크로 이어지는 갈등·복선·의문 1~2문장. 반드시 인물 이름을 직접 사용한다.",
            "모든 출력은 한국어만 허용한다.",
          ].join("\n"),
        },
        {
          role: "user",
          content: `등장인물 목록(반드시 이름 직접 사용): ${charList}\n\n${epStart}화~${epEnd}화 요약:\n\n${epSummaries}\n\n위 3개 섹션 형식으로 아크 요약을 작성해줘.`,
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
    });
    const arcSummary = arcRes.choices[0]?.message?.content?.trim() ?? "";

    // 인물별 상태 생성
    const charArcs: { name: string; state: string }[] = [];
    if (characterNames.length) {
      const charRes = await getLLMClient().chat.completions.create({
        model: getSummaryModel(),
        messages: [
          {
            role: "system",
            content: [
              "소설 요약에서 각 인물의 현재 상태를 한 문장으로 추출한다.",
              "등장하지 않은 인물은 '미등장'으로 표시한다.",
              '반드시 JSON 형식만 출력한다. 형식: [{"name":"인물명","state":"상태 한 문장"}]',
            ].join("\n"),
          },
          {
            role: "user",
            content: `인물 목록: ${characterNames.join(", ")}\n\n아크 요약:\n${arcSummary}\n\n각 인물의 현재 상태를 JSON으로 출력해줘.`,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
      });
      const rawChar = charRes.choices[0]?.message?.content ?? "[]";
      const matchChar = rawChar.match(/\[[\s\S]*\]/);
      if (matchChar) {
        const parsed: { name: string; state: string }[] = JSON.parse(matchChar[0]);
        charArcs.push(...parsed.filter(c => c.name && c.state));
      }
    }

    // arc_summary의 "[주요 사건]" 섹션에서 key_events 추출
    const keyEventsFromSummary: string[] = [];
    const mainEventMatch = arcSummary.match(/\[주요 사건\]([\s\S]*?)(?=\[|$)/);
    if (mainEventMatch?.[1]) {
      keyEventsFromSummary.push(
        ...mainEventMatch[1].trim().split(/[.。]\s+/).filter(s => s.trim().length > 4).slice(0, 5)
      );
    }

    // DB 저장
    await pool.query(
      `INSERT INTO arc_summaries (book_id, arc_number, episode_start, episode_end, summary, key_events)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (book_id, arc_number) DO UPDATE SET summary=$5, key_events=$6`,
      [bookId, arcNumber, epStart, epEnd, arcSummary, JSON.stringify(keyEventsFromSummary)]
    );

    if (charArcs.length) {
      // character_arcs key_events: arc summary의 "[인물 현재 상태]" 섹션에서 해당 인물 관련 문장 추출
      const charStateSection = arcSummary.match(/\[인물 현재 상태\]([\s\S]*?)(?=\[|$)/)?.[1] ?? "";
      await Promise.all(charArcs.map(c => {
        // 해당 인물 이름이 포함된 문장들 → key_events
        const charKeyEvents = charStateSection
          .split(/\n+/)
          .filter(line => line.includes(c.name) && line.trim().length > 4)
          .map(line => line.replace(/^-?\s*/, "").trim())
          .slice(0, 4);
        return pool.query(
          `INSERT INTO character_arcs (book_id, character_name, arc_number, state, key_events)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (book_id, character_name, arc_number) DO UPDATE SET state=$4, key_events=$5`,
          [bookId, c.name, arcNumber, c.state, JSON.stringify(charKeyEvents)]
        );
      }));
    }

    logInfo("service:arc_memory", "아크 요약 저장 완료", {
      book_id: bookId,
      arc_number: arcNumber,
      summary_chars: arcSummary.length,
      char_arcs_saved: charArcs.length,
      chars: charArcs.map(c => ({ name: c.name, state: c.state.slice(0, 40) })),
    });
  } catch (err) {
    logError("service:arc_memory", err, { context: "generateAndSaveArcSummary", book_id: bookId, arc_number: arcNumber });
  }
}

export { ARC_SIZE };
