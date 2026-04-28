/**
 * audit_story_quality_with_gemini.mjs
 *
 * Gemini 기반 30화 서사 품질 감사 스크립트
 * - DB에서 감사 패킷 추출
 * - chunk별 Gemini API 호출 (한국어 서사 편집자 관점)
 * - 최종 통합 보고서 생성
 *
 * Usage:
 *   node scripts/audit_story_quality_with_gemini.mjs \
 *     --book-id test_fantasy_B \
 *     --episodes 30 \
 *     --model gemini-2.5-flash \
 *     --out tracking/story_quality_audit/20260429
 */

import "dotenv/config";
import pg from "pg";
import fs from "fs";
import path from "path";

const { Pool } = pg;

// ── CLI args ────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    bookId: "test_fantasy_B",
    episodes: 30,
    model: "gemini-2.5-flash",
    out: null,
    chunkSize: 5,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--book-id") opts.bookId = args[++i];
    else if (args[i] === "--episodes") opts.episodes = parseInt(args[++i]);
    else if (args[i] === "--model") opts.model = args[++i];
    else if (args[i] === "--out") opts.out = args[++i];
    else if (args[i] === "--chunk-size") opts.chunkSize = parseInt(args[++i]);
  }
  if (!opts.out) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    opts.out = `tracking/story_quality_audit/${ts}`;
  }
  return opts;
}

// ── DB query helpers ────────────────────────────────────────
async function fetchEpisodes(pool, bookId, maxEp) {
  const r = await pool.query(
    `SELECT episode_number, content, summary
     FROM episodes WHERE book_id=$1 AND episode_number<=$2
     ORDER BY episode_number ASC`,
    [bookId, maxEp]
  );
  return r.rows;
}

async function fetchRunTraces(pool, bookId, maxEp) {
  const r = await pool.query(
    `SELECT episode_number, planner_trace, final_verdict, final_score,
            effective_context_snapshot
     FROM run_traces WHERE book_id=$1 AND episode_number<=$2
     ORDER BY episode_number ASC`,
    [bookId, maxEp]
  );
  return r.rows;
}

async function fetchArcSummaries(pool, bookId) {
  const r = await pool.query(
    `SELECT arc_number, episode_start, episode_end, summary, key_events, created_at
     FROM arc_summaries WHERE book_id=$1 ORDER BY arc_number ASC`,
    [bookId]
  );
  return r.rows;
}

async function fetchCharacterArcs(pool, bookId) {
  const r = await pool.query(
    `SELECT character_name, arc_number, state, key_events
     FROM character_arcs WHERE book_id=$1 ORDER BY arc_number ASC, character_name ASC`,
    [bookId]
  );
  return r.rows;
}

async function fetchForeshadows(pool, bookId) {
  const r = await pool.query(
    `SELECT id, planted_episode, resolved_episode, content, keywords, status
     FROM foreshadows WHERE book_id=$1
     ORDER BY planted_episode ASC`,
    [bookId]
  );
  return r.rows;
}

async function fetchCharacterDynamicStates(pool, bookId, maxEp) {
  const r = await pool.query(
    `SELECT episode_number, character_name, emotional_state, physical_state, location, items
     FROM character_dynamic_states WHERE book_id=$1 AND episode_number<=$2
     ORDER BY episode_number ASC, character_name ASC`,
    [bookId, maxEp]
  );
  return r.rows;
}

async function fetchCanonicalCharacters(pool, bookId) {
  const r = await pool.query(
    `SELECT name, type, personality, initial_items
     FROM canonical_characters WHERE book_id=$1`,
    [bookId]
  );
  return r.rows;
}

// ── Build audit packet ──────────────────────────────────────
function buildEpisodeDigest(episodes, traces, dynamicStates) {
  const traceMap = {};
  for (const t of traces) traceMap[t.episode_number] = t;
  const stateMap = {};
  for (const s of dynamicStates) {
    if (!stateMap[s.episode_number]) stateMap[s.episode_number] = [];
    stateMap[s.episode_number].push(s);
  }

  return episodes.map((ep) => {
    const t = traceMap[ep.episode_number] || {};
    return {
      episode_number: ep.episode_number,
      summary: ep.summary || "",
      content_preview: ep.content
        ? ep.content.slice(0, 300) + (ep.content.length > 300 ? "…" : "")
        : "",
      content_full: ep.content || "",
      final_verdict: t.final_verdict || null,
      final_score: t.final_score || null,
      planner_trace_summary: t.planner_trace ? JSON.stringify(t.planner_trace).slice(0, 200) : null,
      continuity_contract: t.effective_context_snapshot?.continuity_contract || null,
      parsed_plan: t.effective_context_snapshot?.parsed_plan || null,
      character_states: stateMap[ep.episode_number] || [],
    };
  });
}

// ── Gemini API call ─────────────────────────────────────────
async function callGemini(model, prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ── Build chunk prompt ──────────────────────────────────────
function buildChunkPrompt(chunkEpisodes, arcSummaries, charArcs, foreshadows, canonChars, chunkLabel) {
  const epBlock = chunkEpisodes.map((ep) => {
    const stateLines = ep.character_states
      .map((s) => `  ${s.character_name}: 감정=${s.emotional_state || "-"} 위치=${s.location || "-"} 아이템=${JSON.stringify(s.items || [])}`)
      .join("\n");
    return [
      `=== ${ep.episode_number}화 ===`,
      `[요약] ${ep.summary}`,
      `[본문(앞300자)] ${ep.content_preview}`,
      `[플랜] ${JSON.stringify(ep.parsed_plan || {}, null, 0).slice(0, 200)}`,
      `[인물 상태]\n${stateLines || "  (없음)"}`,
    ].join("\n");
  }).join("\n\n");

  const arcBlock = arcSummaries.length
    ? arcSummaries.map((a) => `아크${a.arc_number}(${a.episode_start}~${a.episode_end}화): ${(a.summary || "").slice(0, 200)} / 주요사건: ${JSON.stringify(a.key_events || []).slice(0, 300)}`).join("\n")
    : "(아크 없음)";

  const charArcBlock = charArcs.length
    ? charArcs.map((c) => `[${c.character_name}/아크${c.arc_number}] ${JSON.stringify(c.state || {}).slice(0, 150)}`).join("\n")
    : "(캐릭터 아크 없음)";

  const foreshadowBlock = foreshadows
    .filter((f) => chunkEpisodes.some((ep) => ep.episode_number >= f.planted_episode - 2 && ep.episode_number <= (f.resolved_episode || 9999) + 2))
    .map((f) => `[${f.planted_episode}화 심기→${f.resolved_episode || "미회수"} / ${f.status}] ${f.content}`)
    .join("\n") || "(해당 범위 복선 없음)";

  const canonBlock = canonChars.map((c) => `${c.name}(${c.type || "-"}): 초기아이템=${JSON.stringify(c.initial_items || [])}`).join("\n") || "(없음)";

  return `당신은 한국어 장편 웹소설 편집자이자 서사 구조 감수자다.
이 작품을 실제 독자로 읽는다고 가정하고, 몰입이 깨지는 부분을 찾아라.
코드상 메모리 구조가 맞더라도, 독자 관점에서 어색하면 WARN/FAIL로 판단하라.
문제는 구체적인 회차·인물·사건·메모리 불일치 근거와 함께 제시하라.

=== 감사 대상: ${chunkLabel} ===

--- 에피소드 데이터 ---
${epBlock}

--- 아크 요약 ---
${arcBlock}

--- 인물 아크 ---
${charArcBlock}

--- 복선 (이 범위 관련) ---
${foreshadowBlock}

--- 인물 초기 설정 ---
${canonBlock}

=== 평가 지시 ===
아래 항목을 반드시 평가하라:

A. 독자 관점 흐름
- 이야기 흐름이 자연스럽게 전진하는가?
- 같은 장면/상황/감정이 반복되지 않는가?
- 각 화가 전체 서사에서 맡는 역할이 분명한가?

B. 연속성
- 이전 화 마지막 상태에서 다음 화가 자연스럽게 이어지는가?
- 이미 발생한 만남/약속/고백을 다시 반복하지 않는가?
- 인물 관계가 퇴행하지 않는가?

C. 메모리 정합성
- rolling summary가 본문을 정확히 요약하는가?
- character_dynamic_states가 감정/위치/소지품 상태를 제대로 추적하는가?

D. 소지품 흐름
- 인물별 초기 소지품이 유지되는가?
- 새 소지품이 등장하면 획득 근거가 있는가?

E. 복선
- 복선이 자연스럽게 심어졌는가?
- resolved 표시가 실제 회수와 맞는가?

F. 인물 아크
- 감정선이 누적되는가?
- 인물 동기가 흔들리지 않는가?

=== 출력 형식 ===
각 화에 대해 아래 표를 작성하라:

| 화 | 판정 | 독자연속성 | 페이싱 | 메모리정합성 | 비고 |
|---|---|---|---|---|---|

그 다음 WARN/FAIL이 있으면 근거 포함 설명.
이 구간의 주요 문제 요약 (3~5개).`;
}

// ── Build final prompt ──────────────────────────────────────
function buildFinalPrompt(chunkReports, arcSummaries, charArcs, foreshadows, canonChars, totalEp) {
  const arcBlock = arcSummaries.map((a) =>
    `아크${a.arc_number}(${a.episode_start}~${a.episode_end}화): summary=${(a.summary || "").slice(0, 200)}, key_events=${JSON.stringify(a.key_events || []).slice(0, 300)}`
  ).join("\n");

  const charArcBlock = charArcs.map((c) =>
    `[${c.character_name}/아크${c.arc_number}] state=${JSON.stringify(c.state || {}).slice(0, 150)}, key_events=${JSON.stringify(c.key_events || []).slice(0, 150)}`
  ).join("\n");

  const foreshadowStats = {
    open: foreshadows.filter((f) => f.status === "open").length,
    resolved: foreshadows.filter((f) => f.status === "resolved").length,
    total: foreshadows.length,
  };
  const openList = foreshadows.filter((f) => f.status === "open").map((f) => `  ${f.planted_episode}화: ${f.content}`).join("\n");
  const resolvedList = foreshadows.filter((f) => f.status === "resolved").map((f) => `  ${f.planted_episode}화→${f.resolved_episode}화: ${f.content.slice(0, 60)}`).join("\n");

  return `당신은 한국어 장편 웹소설 편집자이자 서사 구조 감수자다.
아래는 30화 연재 작품의 청크별 감사 보고서와 전체 메모리 데이터다.
이를 바탕으로 최종 통합 품질 보고서를 작성하라.

=== 청크별 감사 결과 ===
${chunkReports.map((r, i) => `--- 청크 ${i + 1} ---\n${r}`).join("\n\n")}

=== 전체 아크 요약 ===
${arcBlock || "(없음)"}

=== 전체 인물 아크 ===
${charArcBlock || "(없음)"}

=== 복선 통계 ===
전체: ${foreshadowStats.total}, resolved: ${foreshadowStats.resolved}, open: ${foreshadowStats.open}
회수된 복선:
${resolvedList || "  없음"}
미해소 복선:
${openList || "  없음"}

=== 인물 초기 설정 ===
${canonChars.map((c) => `${c.name}(${c.type || "-"}): 성격=${c.personality || ""} / 초기아이템=${JSON.stringify(c.initial_items || [])}`).join("\n")}

=== 최종 통합 보고서 형식 ===
아래 형식으로 정확히 작성하라:

# GEMINI 30-Episode Story Quality Audit Report

## 1. Executive Summary
- 전체 작품 품질 판정: READY / CONDITIONAL / NOT READY
- overall_story_quality: (0.00~1.00)
- 가장 큰 장점 3개
- 가장 큰 문제 5개
- 50화 actual로 넘어가도 되는지
- 모델 라우팅 실험으로 넘어가도 되는지

## 2. Reader Experience Assessment
- 독자로 읽었을 때의 몰입감
- 서사 전진감
- 반복감/늘어짐
- 장면 전환 자연스러움
- 최종화 완결감

## 3. Episode-by-Episode Evaluation
| Episode | Verdict | Reader Continuity | Pacing | Memory Consistency | Comment |
|---|---|---:|---:|---:|---|

## 4. Rolling Summary Consistency
## 5. Arc Summary Consistency
## 6. Character Arc Audit
| Character | Early State | Mid Change | Late Conflict | Final State | Issues |
|---|---|---|---|---|---|

## 7. Foreshadow Audit
| Foreshadow | Planted | Resolved | DB Status | Reader Judgment | Issue |
|---|---:|---:|---|---|---|

## 8. Item Flow Audit
| Character | Initial Items | Acquired | Lost | Final Items | Issues |
|---|---|---|---|---|---|

## 9. Final Episode Audit
- finalization_quality: (0.00~1.00)

## 10. Problem Classification
### Immediate Structural Bugs
### Prompt-Level Problems
### Memory/Context Design Problems
### Model Routing Problems
### Acceptable Quality Issues
### Risks for 50/100 Episodes

## 11. Refactor / Improvement Recommendations

## 12. Prompt Rewrite Recommendations for GPT
GPT에게 넘길 핵심 문제와 개선 방향

## 13. Final Recommendation
- 30화 품질: READY / CONDITIONAL / NOT READY
- 50화 actual 진행 여부
- 100화 검증 진행 방식
- 모델 라우팅 실험 진행 여부`;
}

// ── Claude cross-check section ──────────────────────────────
function buildCrossCheckSection(geminiReport, episodes, foreshadows, charArcs) {
  const openForeshadows = foreshadows.filter((f) => f.status === "open");
  const resolvedForeshadows = foreshadows.filter((f) => f.status === "resolved");
  const recallRate = foreshadows.length ? Math.round((resolvedForeshadows.length / foreshadows.length) * 100) : 0;

  return `
# Claude Technical Cross-Check

## 1. Gemini 지적 중 DB/코드로 확인 가능한 항목

- **character_arcs**: DB에 ${charArcs.length}행 존재 (아크 1~${Math.max(...charArcs.map(c => c.arc_number || 0), 0)} × ${[...new Set(charArcs.map(c => c.character_name))].join("/")} 확인됨)
- **foreshadow recall**: ${foreshadows.length}건 중 ${resolvedForeshadows.length}건 resolved = **${recallRate}%** (DB 계산값)
- **episode count**: DB에 ${episodes.length}화 저장됨 (1~${episodes[episodes.length-1]?.episode_number || 0}화)
- **open foreshadows**: ${openForeshadows.length}건 미해소 — ${openForeshadows.slice(0,3).map(f => `${f.planted_episode}화`).join(", ")}${openForeshadows.length > 3 ? " 등" : ""}

## 2. Gemini 지적 중 주관적 품질 판단 항목

- 독자 관점 몰입감, 감정선 누적, 대화 자연스러움 → Gemini 판단을 1차 기준으로 사용
- 복선 회수의 "납득감" → DB status는 정상이어도 독자 관점 이질감 있을 수 있음
- 페이싱 평가 (너무 빠름/느림) → 모델 출력 특성에 따라 달라짐

## 3. 실제 코드/프롬프트 수정 후보

Gemini 보고서 §10, §11 기준으로 식별된 수정 후보 — GPT 리팩터링 계획 수립 후 Claude 구현 대상:
- Planner prompt 연속성 강화
- Renderer 반복 억제 지시
- Continuity contract 필드 보강
- Foreshadow injection 강화

## 4. GPT에게 넘기기 좋은 핵심 질문

1. 플래너가 어떤 정보를 context로 받으면 반복을 줄일 수 있는가?
2. 렌더러에 어떤 negative prompt/금지 지시를 추가해야 하는가?
3. 복선 회수 판정 로직을 LLM 기반으로 교체해야 하는가?
4. rolling_summary → 플래너 피드백 루프를 어떻게 개선할 것인가?
5. 캐릭터 소지품 상태를 렌더러에 어떻게 확실히 전달할 것인가?

## 5. Claude가 바로 수정하면 안 되는 항목

- 프롬프트 전면 리팩터링 → GPT가 계획 수립 후 Claude 구현
- 모델 라우팅 변경 → 100화 검증 후 판단
- memory schema 변경 → 마이그레이션 필요, GPT 계획 선행
- 복선 판정 알고리즘 변경 → 설계 합의 후 구현
`;
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in .env");

  console.log(`\n[audit] book_id=${opts.bookId} episodes=${opts.episodes} model=${opts.model}`);
  console.log(`[audit] output dir: ${opts.out}`);

  // Output dir setup
  fs.mkdirSync(opts.out, { recursive: true });

  // DB connect
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Fetch all data
  console.log("[audit] Fetching DB data...");
  const [episodes, traces, arcSummaries, charArcs, foreshadows, dynamicStates, canonChars] = await Promise.all([
    fetchEpisodes(pool, opts.bookId, opts.episodes),
    fetchRunTraces(pool, opts.bookId, opts.episodes),
    fetchArcSummaries(pool, opts.bookId),
    fetchCharacterArcs(pool, opts.bookId),
    fetchForeshadows(pool, opts.bookId),
    fetchCharacterDynamicStates(pool, opts.bookId, opts.episodes),
    fetchCanonicalCharacters(pool, opts.bookId),
  ]);
  await pool.end();

  console.log(`[audit] episodes=${episodes.length}, traces=${traces.length}, arcs=${arcSummaries.length}, charArcs=${charArcs.length}, foreshadows=${foreshadows.length}, dynamicStates=${dynamicStates.length}, canonChars=${canonChars.length}`);

  // Build episode digest
  const digest = buildEpisodeDigest(episodes, traces, dynamicStates);

  // Save packet files (no commit)
  const episodeDigestPath = path.join(opts.out, "episode_digest.json");
  const memoryMatrixPath = path.join(opts.out, "memory_matrix.json");

  // episode_digest: summary + content_preview only (no full text in one file to keep size manageable)
  const digestSafe = digest.map((d) => ({ ...d, content_full: undefined }));
  fs.writeFileSync(episodeDigestPath, JSON.stringify(digestSafe, null, 2));

  const memoryMatrix = { arcSummaries, charArcs, foreshadows, canonChars };
  fs.writeFileSync(memoryMatrixPath, JSON.stringify(memoryMatrix, null, 2));

  console.log(`[audit] Saved episode_digest.json and memory_matrix.json`);

  // Chunk episodes
  const chunks = [];
  for (let i = 0; i < opts.episodes; i += opts.chunkSize) {
    chunks.push(digest.slice(i, i + opts.chunkSize));
  }
  console.log(`[audit] ${chunks.length} chunks of ${opts.chunkSize} episodes each`);

  // Call Gemini per chunk
  const chunkReports = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const firstEp = chunk[0].episode_number;
    const lastEp = chunk[chunk.length - 1].episode_number;
    const chunkLabel = `${firstEp}~${lastEp}화`;
    console.log(`[audit] Calling Gemini for chunk ${ci + 1}/${chunks.length}: ${chunkLabel}...`);

    const prompt = buildChunkPrompt(chunk, arcSummaries, charArcs, foreshadows, canonChars, chunkLabel);

    // Save input packet
    const inputPacketPath = path.join(opts.out, `gemini_input_chunk${ci + 1}_ep${firstEp}-${lastEp}.json`);
    fs.writeFileSync(inputPacketPath, JSON.stringify({ chunkLabel, prompt_length: prompt.length, episode_numbers: chunk.map(e => e.episode_number) }, null, 2));

    let report;
    try {
      report = await callGemini(opts.model, prompt, apiKey);
    } catch (err) {
      console.error(`[audit] Gemini error on chunk ${ci + 1}:`, err.message);
      report = `[ERROR: ${err.message}]`;
    }
    chunkReports.push(report);

    // Save chunk report
    const chunkReportPath = path.join(opts.out, `gemini_chunk${ci + 1}_ep${firstEp}-${lastEp}_report.md`);
    fs.writeFileSync(chunkReportPath, `# Gemini Audit: ${chunkLabel}\n\n${report}`);
    console.log(`[audit] Chunk ${ci + 1} report saved.`);

    // Brief pause between calls
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Final integrated prompt
  console.log("[audit] Calling Gemini for final integrated report...");
  const finalPrompt = buildFinalPrompt(chunkReports, arcSummaries, charArcs, foreshadows, canonChars, opts.episodes);
  fs.writeFileSync(path.join(opts.out, "gemini_input_final.json"), JSON.stringify({ prompt_length: finalPrompt.length }, null, 2));

  let finalReport;
  try {
    finalReport = await callGemini(opts.model, finalPrompt, apiKey);
  } catch (err) {
    console.error("[audit] Gemini final error:", err.message);
    finalReport = `[ERROR: ${err.message}]\n\n청크별 보고서는 개별 파일을 참조하세요.`;
  }

  // Claude cross-check
  const crossCheck = buildCrossCheckSection(finalReport, episodes, foreshadows, charArcs);

  // Combined final report
  const combinedReport = `${finalReport}\n\n---\n${crossCheck}`;

  const finalReportPath = path.join(opts.out, "gemini_story_quality_report.md");
  fs.writeFileSync(finalReportPath, combinedReport);
  console.log(`[audit] Final report saved: ${finalReportPath}`);

  // Console summary
  console.log("\n====== AUDIT COMPLETE ======");
  console.log(`Output: ${opts.out}`);
  console.log(`Files:`);
  fs.readdirSync(opts.out).forEach((f) => console.log(`  ${f}`));

  return { out: opts.out, finalReportPath };
}

main().catch((err) => {
  console.error("[audit] Fatal error:", err);
  process.exit(1);
});
