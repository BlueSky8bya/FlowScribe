/**
 * narrative_coherence.ts — Phase 4.10 Runtime Narrative Coherence Judge + Repair
 *
 * 역할:
 * - 생성 후 본문이 독자 납득 가능한지 검사 (knowledge leak / affordance / transition / body-state)
 * - fatal candidate에 한해 Gemini judge 호출 (selective)
 * - fatal 확정 시 targeted repair (해당 paragraph만 재작성)
 * - 전체 본문 재생성 금지, 최대 1회 repair
 *
 * 사용:
 *   const judge = await runNarrativeCoherenceCheck({ episode, content, states, prevStates });
 *   if (judge.fatalIssues.length) {
 *     const repaired = await repairNarrativeCoherenceIssues(content, judge.fatalIssues);
 *   }
 *
 * 비용 정책:
 * - deterministic check (sanitizer, audit)에서 fatal 후보 없으면 skip
 * - 하나라도 있으면 Gemini judge 호출
 * - Gemini judge가 fatal 확정 → repair 1회
 * - repair 결과를 다시 judge에 통과시켜 새 fatal 발생 검증 (1회만)
 */

import https from "https";
import { logInfo, logWarn, logError } from "../lib/logger.js";

const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
const MODEL = "gemini-2.5-flash";

export interface CoherenceIssue {
  category: "knowledge_leak" | "affordance" | "transition" | "body_state" | "other";
  severity: "fatal" | "major" | "minor";
  character?: string;
  violation: string;
  evidence: string;       // body 인용
  paragraph_index?: number; // 0-indexed paragraph 위치
}

export interface CoherenceJudgeResult {
  fatalIssues: CoherenceIssue[];
  majorIssues: CoherenceIssue[];
  minorIssues: CoherenceIssue[];
  judgeCalled: boolean;
  judgeError?: string;
}

export interface CoherenceCheckInput {
  episode_number: number;
  content: string;
  // 이번 화 인물 상태 (post-commit 또는 planner 산출)
  states: Array<{
    character_name: string;
    location?: string | null;
    physical_state?: string | null;
    emotional_state?: string | null;
    items?: any[];
    visibility_state?: string | null;
  }>;
  // 이전 화까지의 누적 컨텍스트 (요약용 — 너무 크지 않게)
  prevSummary?: string;
  // deterministic 후보 issue (있으면 judge에 hint로 전달)
  hints?: string[];
}

function geminiRequest(promptText: string, maxTokens = 3000): Promise<{ status: number; body: string }> {
  const reqBody = JSON.stringify({
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 },
  });
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(reqBody) },
    };
    const req = https.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.on("error", reject);
    req.write(reqBody);
    req.end();
  });
}

function repairTruncatedJSON(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let escape = false;
  let lastColon = -1;
  let lastValueStart = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') {
      if (!inStr) lastValueStart = i;
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === ":") { lastColon = i; lastValueStart = -1; }
    else if (c === "{") { stack.push("}"); lastValueStart = i; }
    else if (c === "[") { stack.push("]"); lastValueStart = i; }
    else if (c === "}" || c === "]") { stack.pop(); lastValueStart = i; }
    else if (c !== " " && c !== "\n" && c !== "\t" && c !== ",") { lastValueStart = i; }
  }
  let prefix = "";
  let suffix = "";
  if (inStr) suffix += '"';
  else if (lastColon > lastValueStart) prefix = "null";
  suffix += stack.reverse().join("");
  return s + prefix + suffix;
}

function parseGeminiJSON<T = any>(raw: string): T | { _parse_error: string } {
  let clean: string;
  try {
    const env = JSON.parse(raw);
    const text =
      env.candidates?.[0]?.content?.parts?.find((p: any) => !p.thought && p.text)?.text ?? "";
    clean = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
  } catch (e) {
    return { _parse_error: `envelope: ${(e as Error).message}` };
  }
  // direct parse
  try { return JSON.parse(clean) as T; } catch {}
  // truncation repair
  try {
    const repaired = repairTruncatedJSON(clean);
    return JSON.parse(repaired) as T;
  } catch (e2) {
    return { _parse_error: `repair failed: ${(e2 as Error).message}` };
  }
}

/**
 * Gemini judge — 4개 범주(knowledge/affordance/transition/body)를 한 번에 검사.
 * paragraphs 단위 인덱싱을 위해 본문을 paragraph 단위로 자른다.
 */
export async function runNarrativeCoherenceCheck(
  input: CoherenceCheckInput,
): Promise<CoherenceJudgeResult> {
  const empty: CoherenceJudgeResult = {
    fatalIssues: [], majorIssues: [], minorIssues: [], judgeCalled: false,
  };
  if (!GEMINI_KEY) {
    logWarn("narrative_coherence", "GEMINI_API_KEY 미설정 — judge skip", {});
    return empty;
  }

  // paragraph indexing
  const paragraphs = input.content.split(/\n\n+/);
  const indexedBody = paragraphs.map((p, i) => `[P${i}] ${p}`).join("\n\n");

  // state brief
  const stateBrief = input.states.map(s => {
    const items = Array.isArray(s.items) ? s.items : [];
    const itemNames = items.map(it => {
      if (typeof it === "string") return it;
      const cond = it?.condition ? `(${it.condition})` : "";
      return `${it?.name ?? ""}${cond}`;
    }).filter(Boolean).join(", ");
    return `${s.character_name}: phys=${s.physical_state ?? "?"}, loc=${s.location ?? "?"}, items=[${itemNames}], vis=${s.visibility_state ?? "?"}`;
  }).join("\n");

  const prompt = [
    "당신은 서사 narrative coherence 감사관이다. 본문이 독자 몰입을 깨뜨리는지 4가지 범주를 한 번에 검사한다.",
    "",
    "범주:",
    "1. knowledge_leak: 인물이 알 수 없는 정보를 단정적으로 알고 행동/발화 (단, 추측·의심·질문은 제외)",
    "2. affordance: 부상·기절·구속·빈손 상태에서 불가능한 행동 (회복 묘사가 있으면 OK)",
    "3. transition: 위치가 바뀌었는데 이동 이유/방법/시간 단서가 부족해 독자가 납득 불가",
    "4. body_state: 본문 행동/소지가 dynamic state와 단정적으로 모순 (예: state에는 없는 무기 사용)",
    "",
    "주의:",
    "- 1~2문장 bridge가 있으면 fatal 아님",
    "- absent/미등장 visibility 인물이 본문에 단정 행동하면 fatal",
    "- 사소한 표현 차이는 minor 또는 무시",
    "",
    `[ep${input.episode_number} 인물 상태]`,
    stateBrief,
    "",
    input.prevSummary ? `[이전 화 누적 요약]\n${input.prevSummary.slice(0, 4000)}\n` : "",
    `[ep${input.episode_number} 본문 — 문단별 [P0] [P1] ... 색인]`,
    indexedBody.slice(0, 6000),
    "",
    input.hints?.length ? `[deterministic 감사 hint]\n${input.hints.join("\n")}\n` : "",
    "출력 형식 (JSON만, 다른 텍스트 금지):",
    `{"issues":[{"category":"knowledge_leak|affordance|transition|body_state","severity":"fatal|major|minor","character":"이름 또는 null","violation":"한 줄 설명","evidence":"본문 인용 60자 이내","paragraph_index":0}]}`,
    "위반 후보 없으면 issues는 빈 배열.",
  ].join("\n");

  try {
    const { status, body } = await geminiRequest(prompt, 3000);
    if (status !== 200) {
      logWarn("narrative_coherence", "judge HTTP non-200", { status });
      return { ...empty, judgeCalled: true, judgeError: `HTTP ${status}` };
    }
    const parsed = parseGeminiJSON<{ issues?: CoherenceIssue[] }>(body);
    if ("_parse_error" in parsed) {
      logWarn("narrative_coherence", "judge JSON parse failed", { err: parsed._parse_error });
      return { ...empty, judgeCalled: true, judgeError: parsed._parse_error };
    }
    const issues = parsed.issues ?? [];
    const fatalIssues = issues.filter(i => i.severity === "fatal");
    const majorIssues = issues.filter(i => i.severity === "major");
    const minorIssues = issues.filter(i => i.severity === "minor");
    logInfo("narrative_coherence", "judge 완료", {
      episode: input.episode_number,
      fatal: fatalIssues.length, major: majorIssues.length, minor: minorIssues.length,
    });
    return { fatalIssues, majorIssues, minorIssues, judgeCalled: true };
  } catch (err) {
    logError("narrative_coherence", err, { context: "runNarrativeCoherenceCheck" });
    return { ...empty, judgeCalled: true, judgeError: String(err) };
  }
}

/**
 * targeted repair — fatal 단락만 최소 수정해 새 본문 반환.
 * 전체 재생성 금지. 단락 인덱스 + violation 설명을 LLM에 주고 그 단락만 다시 받는다.
 */
export async function repairNarrativeCoherenceIssues(
  content: string,
  fatalIssues: CoherenceIssue[],
  context: { episode_number: number; states: CoherenceCheckInput["states"] },
): Promise<{ repaired: string; appliedCount: number; failed: number }> {
  if (!GEMINI_KEY || !fatalIssues.length) {
    return { repaired: content, appliedCount: 0, failed: 0 };
  }
  const paragraphs = content.split(/\n\n+/);
  let appliedCount = 0;
  let failed = 0;

  // group by paragraph_index — 동일 단락 다중 issue는 한 번에 repair
  const byPara = new Map<number, CoherenceIssue[]>();
  for (const iss of fatalIssues) {
    const idx = iss.paragraph_index;
    if (typeof idx !== "number" || idx < 0 || idx >= paragraphs.length) continue;
    if (!byPara.has(idx)) byPara.set(idx, []);
    byPara.get(idx)!.push(iss);
  }

  for (const [idx, issues] of byPara.entries()) {
    const original = paragraphs[idx];
    const stateBrief = context.states.map(s => {
      const items = Array.isArray(s.items) ? s.items : [];
      const itemNames = items.map(it => typeof it === "string" ? it : it?.name).filter(Boolean).join(",");
      return `${s.character_name}: phys=${s.physical_state ?? "?"}, loc=${s.location ?? "?"}, items=[${itemNames}], vis=${s.visibility_state ?? "?"}`;
    }).join("\n");

    const prompt = [
      "당신은 서사 narrative coherence 수정 전문가다. 단락 하나만 최소 수정해 위반을 해결하라.",
      "",
      "엄격 규칙:",
      "- 원래 단락의 분위기·시점·길이를 유지하라 (±20% 이내)",
      "- 새 인물·새 사건·새 설정을 추가하지 마라",
      "- 기존 인물 상태/소지품을 변경하지 마라",
      "- 위반 사실만 추측·의심·질문 형태로 약화하거나, 짧은 bridge 1문장을 추가하라",
      "- 결과는 단락 텍스트만 (JSON 아님, 설명 아님)",
      "",
      `[ep${context.episode_number} 인물 상태]`,
      stateBrief,
      "",
      "[수정 대상 단락 원본]",
      original,
      "",
      "[해결할 위반]",
      issues.map(i => `- (${i.category}/${i.severity}) ${i.violation} | evidence: "${(i.evidence ?? "").slice(0, 60)}"`).join("\n"),
      "",
      "수정된 단락만 출력하라:",
    ].join("\n");

    try {
      const { status, body } = await geminiRequest(prompt, 1200);
      if (status !== 200) { failed++; continue; }
      const env = JSON.parse(body);
      const text = env.candidates?.[0]?.content?.parts?.find((p: any) => !p.thought && p.text)?.text ?? "";
      const cleaned = text.trim().replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      if (cleaned.length < 20 || cleaned.length > original.length * 2) {
        failed++;
        logWarn("narrative_coherence", "repair 결과 길이 비정상 — skip", {
          episode: context.episode_number, paragraph: idx,
          orig_len: original.length, new_len: cleaned.length,
        });
        continue;
      }
      paragraphs[idx] = cleaned;
      appliedCount++;
      logInfo("narrative_coherence", "단락 repair 적용", {
        episode: context.episode_number, paragraph: idx,
        violations: issues.length,
      });
    } catch (err) {
      failed++;
      logError("narrative_coherence", err, {
        context: "repairNarrativeCoherenceIssues", paragraph: idx,
      });
    }
  }

  const repaired = paragraphs.join("\n\n");
  return { repaired, appliedCount, failed };
}

/**
 * 통합 entry point — selective judge + 1회 repair.
 * trigger: deterministic audit에서 후보가 발견됐거나, force=true.
 */
export async function judgeAndRepair(
  input: CoherenceCheckInput,
  options: { force?: boolean; allowRepair?: boolean } = {},
): Promise<{
  finalContent: string;
  judge: CoherenceJudgeResult;
  repaired: { applied: number; failed: number };
}> {
  // 후보 트리거 없으면 skip
  if (!options.force && !(input.hints && input.hints.length)) {
    return {
      finalContent: input.content,
      judge: { fatalIssues: [], majorIssues: [], minorIssues: [], judgeCalled: false },
      repaired: { applied: 0, failed: 0 },
    };
  }

  const judge = await runNarrativeCoherenceCheck(input);
  if (!options.allowRepair || judge.fatalIssues.length === 0) {
    return { finalContent: input.content, judge, repaired: { applied: 0, failed: 0 } };
  }

  const { repaired, appliedCount, failed } = await repairNarrativeCoherenceIssues(
    input.content,
    judge.fatalIssues,
    { episode_number: input.episode_number, states: input.states },
  );

  return {
    finalContent: repaired,
    judge,
    repaired: { applied: appliedCount, failed },
  };
}
