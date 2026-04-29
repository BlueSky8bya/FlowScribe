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

    // ── deterministic evidence: arc 구간 character_dynamic_states 집계 ──
    type CharEvidence = {
      episode_count: number;
      latest_emotional_state: string | null;
      latest_physical_state: string | null;
      latest_location: string | null;
      latest_recent_goal: string | null;
    };
    const charEvidenceMap: Record<string, CharEvidence> = {};
    if (characterNames.length) {
      try {
        const evidenceRes = await pool.query(
          `SELECT character_name,
                  COUNT(DISTINCT episode_number)::int AS episode_count,
                  (ARRAY_AGG(emotional_state ORDER BY episode_number DESC))[1] AS latest_emotional_state,
                  (ARRAY_AGG(physical_state  ORDER BY episode_number DESC))[1] AS latest_physical_state,
                  (ARRAY_AGG(location        ORDER BY episode_number DESC))[1] AS latest_location,
                  (ARRAY_AGG(recent_goal     ORDER BY episode_number DESC))[1] AS latest_recent_goal
           FROM character_dynamic_states
           WHERE book_id = $1 AND episode_number BETWEEN $2 AND $3
             AND character_name = ANY($4)
           GROUP BY character_name`,
          [bookId, epStart, epEnd, characterNames]
        );
        for (const row of evidenceRes.rows) {
          charEvidenceMap[row.character_name] = {
            episode_count: row.episode_count,
            latest_emotional_state: row.latest_emotional_state,
            latest_physical_state: row.latest_physical_state,
            latest_location: row.latest_location,
            latest_recent_goal: row.latest_recent_goal,
          };
        }
      } catch (err) {
        logWarn("service:arc_memory", "character_dynamic_states evidence 수집 실패 (arc summary는 계속)", { err });
      }
    }

    // 인물별 등장 evidence 주입 텍스트 생성
    const charEvidenceText = characterNames.map(name => {
      const ev = charEvidenceMap[name];
      if (!ev || ev.episode_count === 0) return `${name}: 이 아크에서 DB 기록 없음 (미등장 가능성)`;
      const parts = [`등장 ${ev.episode_count}화`];
      if (ev.latest_emotional_state) parts.push(`최근감정: ${ev.latest_emotional_state}`);
      if (ev.latest_physical_state)  parts.push(`신체: ${ev.latest_physical_state}`);
      if (ev.latest_location)         parts.push(`위치: ${ev.latest_location}`);
      if (ev.latest_recent_goal)      parts.push(`목표: ${ev.latest_recent_goal.slice(0, 40)}`);
      return `${name}: ${parts.join(" | ")}`;
    }).join("\n");

    // 아크 요약 생성 — deterministic evidence 주입
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
            "[인물 현재 상태] 각 인물의 상태를 '이름: 한 문장' 형식으로 한 줄씩 나열한다. '그', '그녀' 대신 반드시 이름을 쓴다.",
            "⚠ 중요: '인물 등장 데이터' 섹션에서 해당 인물의 등장 화수가 1 이상이면 절대 '미등장'이라고 쓰지 않는다. 대신 최근 감정·위치·목표를 기반으로 상태를 한 문장으로 기술한다.",
            "등장 화수가 0인 인물만 '이름: 이 아크에서 미등장'으로 기록 가능하다.",
            "[미해결 긴장] 다음 아크로 이어지는 갈등·복선·의문 1~2문장. 반드시 인물 이름을 직접 사용한다.",
            "모든 출력은 한국어만 허용한다.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `등장인물 목록: ${charList}`,
            "",
            `[인물 등장 데이터 — 이 데이터를 기반으로 인물 상태를 작성할 것]`,
            charEvidenceText,
            "",
            `${epStart}화~${epEnd}화 에피소드 요약:`,
            epSummaries,
            "",
            "위 3개 섹션 형식으로 아크 요약을 작성해줘.",
          ].join("\n"),
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
    });
    const rawArcSummary = arcRes.choices[0]?.message?.content?.trim() ?? "";

    // ── post-validation: DB에 row가 있는 인물이 "미등장"이면 수정 ────
    let arcSummary = rawArcSummary;
    for (const name of characterNames) {
      const ev = charEvidenceMap[name];
      if (!ev || ev.episode_count === 0) continue;  // 실제 미등장이면 그대로
      // "이름: ... 미등장" 패턴 감지
      const miPattern = new RegExp(`${name}\\s*:\\s*[^\\n]*미등장`, "g");
      if (miPattern.test(arcSummary)) {
        const parts = [`등장 ${ev.episode_count}화`];
        if (ev.latest_emotional_state) parts.push(`감정 상태: ${ev.latest_emotional_state}`);
        if (ev.latest_location)         parts.push(`위치: ${ev.latest_location}`);
        const fallback = `${name}: ${parts.join(", ")} — 세부 상황은 에피소드 본문 참조`;
        arcSummary = arcSummary.replace(miPattern, fallback);
        logWarn("service:arc_memory", "arc summary 미등장 hallucination 보정", {
          book_id: bookId, arc_number: arcNumber, character: name,
          episode_count: ev.episode_count,
        });
      }
    }

    // 인물별 상태 생성 — evidence 기반으로 LLM 호출
    const charArcs: { name: string; state: string }[] = [];
    if (characterNames.length) {
      const charRes = await getLLMClient().chat.completions.create({
        model: getSummaryModel(),
        messages: [
          {
            role: "system",
            content: [
              "소설 아크 데이터에서 각 인물의 현재 상태를 한 문장으로 요약한다.",
              "⚠ 등장 화수가 1 이상인 인물은 절대 '미등장'으로 표시하지 않는다.",
              "등장 화수가 0인 인물만 '미등장'으로 표시 가능하다.",
              '반드시 JSON 형식만 출력한다. 형식: [{"name":"인물명","state":"상태 한 문장"}]',
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `인물 목록: ${characterNames.join(", ")}`,
              "",
              "[인물 등장 데이터]",
              charEvidenceText,
              "",
              "[아크 요약]",
              arcSummary,
              "",
              "각 인물의 현재 상태를 JSON으로 출력해줘.",
            ].join("\n"),
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
      });
      const rawChar = charRes.choices[0]?.message?.content ?? "[]";
      const matchChar = rawChar.match(/\[[\s\S]*\]/);
      if (matchChar) {
        const parsed: { name: string; state: string }[] = JSON.parse(matchChar[0]);
        // post-validation: DB row 있는데 state에 "미등장"이면 fallback
        for (const c of parsed.filter(x => x.name && x.state)) {
          const ev = charEvidenceMap[c.name];
          if (ev && ev.episode_count > 0 && /미등장/.test(c.state)) {
            const parts = [ev.latest_emotional_state, ev.latest_location].filter(Boolean);
            c.state = parts.length
              ? `이 아크 ${ev.episode_count}화 등장, ${parts.join(", ")}`
              : `이 아크 ${ev.episode_count}화 등장`;
            logWarn("service:arc_memory", "character_arcs 미등장 hallucination 보정", {
              book_id: bookId, arc_number: arcNumber, character: c.name,
            });
          }
          charArcs.push(c);
        }
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
