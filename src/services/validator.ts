/**
 * validator.ts — Claude API 기반 생성 결과 검증기
 *
 * ── 핵심 원칙 ─────────────────────────────────────────────────
 * - 하드 규칙과 소프트 규칙을 완전히 분리
 * - 문학적 취향 차이는 절대 하드 fail로 처리하지 않는다
 * - 한국어 대사에서 동사/조사만으로 대사/지문 분리 위반 판정 금지
 * - 입력에 없는 설정을 상상해서 모순 판정 금지
 * - 검증 프롬프트 A/B 버전을 분리해 과적합 방지
 *
 * 필요: ANTHROPIC_API_KEY 환경 변수
 */

import { getLLMClient, getSummaryModel } from "../lib/llm.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";
import { pool } from "../lib/db.js";
import type { EffectiveContext, ValidationResult, Verdict, QualityScores } from "../types/canonical.js";

const MAX_TOKENS = 2000;

// ══════════════════════════════════════════════════════════════
// 검증 프롬프트 A — 주요 사용 버전
// ══════════════════════════════════════════════════════════════
function buildValidationSystemPromptA(): string {
  return `당신은 한국어 소설 품질 검증 전문가다.
아래 JSON 형식만 출력한다. 다른 텍스트 없이.

{
  "hard_violations": [
    {"rule": "규칙명", "description": "구체적 위반 내용", "severity": "critical|major", "location": "위치(선택)"}
  ],
  "soft_warnings": [
    {"rule": "규칙명", "description": "내용", "severity": "medium|low", "suggestion": "제안(선택)"}
  ],
  "quality_scores": {
    "pov_consistency": 75,
    "scene_clarity": 75,
    "character_consistency": 75,
    "plot_momentum": 75,
    "world_rule_usage": 75,
    "exposition_control": 75,
    "prose_density": 75,
    "ending_hook": 75,
    "style_adherence": 75,
    "intervention_adherence": 75
  },
  "summary": "요약",
  "revision_hints": []
}

[HARD VIOLATIONS — 아래 4가지만, 다른 것은 절대 hard_violations에 넣지 않음]

H1. 따옴표 무결성 (severity: major)
판정: 대사가 곡선 따옴표 "로 시작했으나 "로 닫히지 않은 경우
예외: 한국어 조사·동사가 대사 안에 있는 것은 정상

H2. 인물 이름 혼동 (severity: major)
판정: 설정에 없는 이름 사용, 또는 인물 A 이름 자리에 인물 B 이름 사용
예외: 성씨(이 씨), 호칭(형·선생님·오빠), 별명은 정상

H3. 시점 위반 (severity: major)
판정:
  - 1인칭 시점: 서술부에서 갑자기 "그가/그녀가" 등 3인칭으로 바뀌는 경우
  - 1인칭 관찰자: 서술부에서 타인의 감정/생각을 직접 서술 ("그는 두려웠다" 형식)
  - 3인칭 시점: 서술부에 "나는/나의/내가" 등장
예외: 대사(" " 내부) 안에 있는 1인칭 표현은 위반 아님

H4. 절대금지 위반 (severity: critical)
판정: 입력에서 제공된 절대금지(absolute_forbidden) 항목을 본문이 직접 위반

[SOFT WARNINGS — 위 H1~H4 이외의 모든 문제는 soft_warnings로만]

- 상태보존: 부상 팔/다리를 그 부위가 필요한 동작에 직접 사용 → medium
  (달리기/걷기 등 부상 부위 무관 동작은 경고도 아님; 위치 불일치도 medium)
- 시공간 연결성: 이동 표현/시간 표현이 전혀 없는 장면 전환 → low
- 세계관 규칙 미준수 → medium
- 설정 자산 미활용 → medium
- 엔딩 훅 약함 → medium
- 문체 불일치 → medium
- 어휘 반복 → low
- 젠더 대명사 불일치 → low

[절대 하지 말 것]
- H1~H4 이외를 hard_violations에 추가하지 않는다
- 상태보존 문제를 hard_violations에 넣지 않는다
- 언급 안 한 것을 모순으로 판정하지 않는다
- 입력에 없는 내용을 상상해서 판정하지 않는다

JSON만 출력.`;
}

// ══════════════════════════════════════════════════════════════
// 검증 프롬프트 B — holdout 분리 버전 (과적합 방지)
// ══════════════════════════════════════════════════════════════
function buildValidationSystemPromptB(): string {
  return `당신은 한국어 소설 독자이자 편집자다. 제공된 소설 화를 읽고 품질을 평가한다.

다음 JSON 형식만 출력한다:
{
  "hard_violations": [{"rule":"","description":"","severity":"critical|major","location":""}],
  "soft_warnings": [{"rule":"","description":"","severity":"medium|low","suggestion":""}],
  "quality_scores": {
    "pov_consistency":0~100, "scene_clarity":0~100, "character_consistency":0~100,
    "plot_momentum":0~100, "world_rule_usage":0~100, "exposition_control":0~100,
    "prose_density":0~100, "ending_hook":0~100, "style_adherence":0~100,
    "intervention_adherence":0~100
  },
  "summary":"",
  "revision_hints":[]
}

평가 기준:
■ 하드 위반 (hard_violations) — 독자가 읽다가 명백히 이상한 오류만:
  • 대사 따옴표(" ") 미닫힘
  • 설정된 이름과 완전히 다른 이름 사용 또는 두 인물 이름 혼동 (성씨·호칭 사용은 정상)
  • 설정된 시점 위반 — 서술부 기준 (대사 안 1인칭, 전지적 내면 묘사는 정상)
    1인칭 관찰자: 화자 자신의 내면(감정·생각)은 정상 — 다른 인물 내면 묘사만 위반
  • 이전 상태와 명백한 모순: 죽은 인물 등장, 부상 부위(해당 팔/다리)를 직접 정상 사용, 없는 소지품 사용, 설정에 없는 새 부상 추가
    (단, 부상/소지품 언급 안 함, 부상과 무관한 동작, 부상 고통 묘사 안 함은 위반 아님)
  • 시공간 연결성: 이동 동사(이동/향했다/갔다 등)도 없고 시간 표현(후/뒤/밤에/며칠 후 등)도 전혀 없을 때만 soft_warnings의 low 경고; 절대 hard_violations에 넣지 마라
  • 절대금지 항목 위반
  • ※ 시공간 연결성(장면 전환 시 이동 설명)은 hard_violations 아님 — soft_warnings의 low 경고만 허용

■ 소프트 경고 (soft_warnings) — 개선 권고:
  • 설정 자산 미활용, 어휘 반복, 엔딩 훅 약함, 오프닝 반복, 문체 불일치

■ 절대 금지 판정:
  • 표현 방식 선호를 하드 fail로 판정하지 않는다
  • 조사/어미가 있다는 이유만으로 대사/지문 오류 판정 금지
  • 설정에 없는 내용으로 모순 판정 금지
  • 이전 상태를 언급하지 않은 것을 위반으로 판정하지 않는다
  • 부상 부위 대신 다른 부위로 대체하는 행동은 위반이 아님 — 올바른 상태 반영
  • 세계관 general 규칙 미준수는 soft_warnings — 절대금지 위반만 critical hard violation
  • 성씨·호칭·별명은 이름 불일치 아님
  • 대사(따옴표 내부) 안의 1인칭은 절대 시점 위반 아님

JSON만 출력.`;
}

// ══════════════════════════════════════════════════════════════
// 검증 요청 페이로드 조립
// ══════════════════════════════════════════════════════════════
function buildValidationUserPrompt(
  generatedText: string,
  ctx: EffectiveContext,
  prevSummary?: string
): string {
  const charList = ctx.characters.map(c =>
    `${c.name}(${c.gender}, ${c.type}): ${c.personality}`
  ).join("\n");

  const dynStates = ctx.character_dynamic_states
    .map(s => [
      `${s.character_name}:`,
      s.location && `  위치: ${s.location}`,
      s.physical_state && `  상태: ${s.physical_state}`,
      s.items?.length && `  소지품: ${s.items.join(", ")}`,
    ].filter(Boolean).join("\n"))
    .join("\n");

  const absoluteForbid = ctx.absolute_forbidden.join("\n") || "없음";
  const generalRules   = ctx.general_rules.join("\n") || "없음";
  const interventions  = ctx.active_interventions.map(i => i.instruction).join("\n") || "없음";

  return `[검증 대상 설정]
시점: ${ctx.gen_config.pov}
문체: ${ctx.gen_config.style}
갈등강도: ${ctx.gen_config.conflict}/10, 복선빈도: ${ctx.gen_config.foreshadow}/10
감정묘사: ${ctx.gen_config.emotion}/10, 대사비중: ${ctx.gen_config.dialogue}/10
연출강도: ${ctx.gen_config.direction}/10

[인물 설정]
${charList || "없음"}

[인물 현재 상태 (직전 화 기준)]
${dynStates || "없음"}

[세계관 규칙]
${generalRules}

[절대금지 규칙]
${absoluteForbid}

[작가 개입]
${interventions}

${prevSummary ? `[직전 화 요약]\n${prevSummary}\n` : ""}
[이번 화 목표]
${ctx.task.goal}
${ctx.task.required_events?.length ? `필수 사건: ${ctx.task.required_events.join(", ")}` : ""}
${ctx.task.ending_hook_direction ? `엔딩 훅: ${ctx.task.ending_hook_direction}` : ""}

[생성된 소설 본문]
---
${generatedText}
---

위 본문을 설정 기준으로 평가해줘.`;
}

// ══════════════════════════════════════════════════════════════
// LLM 검증 호출 (기존 Ollama/DeepSeek/OpenAI 클라이언트 재사용)
// ══════════════════════════════════════════════════════════════
// DeepSeek 검증 전용 클라이언트 (생성기와 독립)
import OpenAI from "openai";
function getValidatorClient(): { client: OpenAI; model: string } {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY 환경변수가 없습니다");
  return {
    client: new OpenAI({ apiKey, baseURL: "https://api.deepseek.com/v1" }),
    model: "deepseek-chat",
  };
}

async function callLLMValidator(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const { client, model } = getValidatorClient();
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: MAX_TOKENS,
  } as any);
  return (res as any).choices?.[0]?.message?.content ?? "{}";
}

// ══════════════════════════════════════════════════════════════
// 검증 결과 파싱 + 판정
// ══════════════════════════════════════════════════════════════
function parseValidationResult(raw: string): ValidationResult {
  let parsed: any = {};
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch {
    logWarn("service:validator", "JSON 파싱 실패 — 기본값 반환", { raw: raw.slice(0, 200) });
  }

  const hard_violations = (parsed.hard_violations ?? []) as ValidationResult["hard_violations"];
  const soft_warnings   = (parsed.soft_warnings   ?? []) as ValidationResult["soft_warnings"];

  const rawScores = parsed.quality_scores ?? {};
  const quality_scores: QualityScores = {
    pov_consistency:       clamp(rawScores.pov_consistency       ?? 70),
    scene_clarity:         clamp(rawScores.scene_clarity         ?? 70),
    character_consistency: clamp(rawScores.character_consistency ?? 70),
    plot_momentum:         clamp(rawScores.plot_momentum         ?? 70),
    world_rule_usage:      clamp(rawScores.world_rule_usage      ?? 70),
    exposition_control:    clamp(rawScores.exposition_control    ?? 70),
    prose_density:         clamp(rawScores.prose_density         ?? 70),
    ending_hook:           clamp(rawScores.ending_hook           ?? 70),
    style_adherence:       clamp(rawScores.style_adherence       ?? 70),
    intervention_adherence:clamp(rawScores.intervention_adherence ?? 70),
  };

  const total_score = computeTotalScore(quality_scores, hard_violations, soft_warnings);
  const verdict     = computeVerdict(hard_violations, soft_warnings, total_score);

  return {
    verdict,
    hard_violations,
    soft_warnings,
    quality_scores,
    total_score,
    summary: parsed.summary ?? "",
    revision_hints: parsed.revision_hints ?? [],
  };
}

function clamp(v: number): number { return Math.max(0, Math.min(100, Math.round(v))); }

function computeTotalScore(
  scores: QualityScores,
  hardViolations: ValidationResult["hard_violations"],
  softWarnings: ValidationResult["soft_warnings"]
): number {
  const weights: Record<keyof QualityScores, number> = {
    pov_consistency: 15, scene_clarity: 10, character_consistency: 15,
    plot_momentum: 12, world_rule_usage: 10, exposition_control: 8,
    prose_density: 8, ending_hook: 10, style_adherence: 6, intervention_adherence: 6,
  };

  let weighted = 0;
  let totalW   = 0;
  for (const [k, w] of Object.entries(weights)) {
    weighted += scores[k as keyof QualityScores] * w;
    totalW += w;
  }
  let base = Math.round(weighted / totalW);

  // 하드 위반 패널티
  const criticalCount = hardViolations.filter(v => v.severity === "critical").length;
  const majorCount    = hardViolations.filter(v => v.severity === "major").length;
  base -= criticalCount * 25 + majorCount * 10;

  // 소프트 경고 패널티 (경미)
  const mediumCount = softWarnings.filter(w => w.severity === "medium").length;
  base -= mediumCount * 3;

  return Math.max(0, Math.min(100, base));
}

function computeVerdict(
  hardViolations: ValidationResult["hard_violations"],
  softWarnings: ValidationResult["soft_warnings"],
  totalScore: number
): Verdict {
  const criticals = hardViolations.filter(v => v.severity === "critical").length;
  const majors    = hardViolations.filter(v => v.severity === "major").length;
  const mediums   = softWarnings.filter(w => w.severity === "medium").length;

  if (criticals > 0 || (majors >= 2)) return "FAIL";
  if (majors >= 1 || mediums >= 3 || totalScore < 60) return "WARN";
  if (totalScore >= 85) return "PASS_STRONG";
  return "PASS";
}

// ══════════════════════════════════════════════════════════════
// 공개 API
// ══════════════════════════════════════════════════════════════

/**
 * validate — 생성 결과를 검증하고 ValidationResult를 반환
 *
 * @param promptVersion  "A" (기본) | "B" (holdout 분리용)
 */
export async function validate(
  generatedText: string,
  ctx: EffectiveContext,
  opts: {
    bookId?: string;
    episodeNumber?: number;
    iteration?: number;
    promptVersion?: "A" | "B";
    prevSummary?: string;
  } = {}
): Promise<ValidationResult> {
  const version = opts.promptVersion ?? "A";
  const sysPrompt = version === "B" ? buildValidationSystemPromptB() : buildValidationSystemPromptA();
  const userPrompt = buildValidationUserPrompt(generatedText, ctx, opts.prevSummary);

  logInfo("service:validator", "검증 시작", {
    book_id: opts.bookId, episode: opts.episodeNumber, iteration: opts.iteration,
    text_chars: generatedText.length, prompt_version: version,
  });

  let raw = "{}";
  try {
    raw = await callLLMValidator(sysPrompt, userPrompt);
  } catch (err) {
    logError("service:validator", err, { context: "callClaudeValidator" });
    // API 실패 시 기본 WARN 반환 (생성 결과를 버리지 않음)
    return {
      verdict: "WARN",
      hard_violations: [],
      soft_warnings: [{ rule: "검증기 오류", description: String(err), severity: "medium" }],
      quality_scores: { pov_consistency:70, scene_clarity:70, character_consistency:70,
        plot_momentum:70, world_rule_usage:70, exposition_control:70,
        prose_density:70, ending_hook:70, style_adherence:70, intervention_adherence:70 },
      total_score: 70,
      summary: "검증기 API 오류로 인해 기본값 반환",
    };
  }

  const result = parseValidationResult(raw);

  logInfo("service:validator", "검증 완료", {
    book_id: opts.bookId, episode: opts.episodeNumber,
    verdict: result.verdict, score: result.total_score,
    hard_violations: result.hard_violations.length,
    soft_warnings: result.soft_warnings.length,
  });

  // DB 저장
  if (opts.bookId && opts.episodeNumber) {
    try {
      await pool.query(
        `INSERT INTO validation_logs
           (book_id, episode_number, iteration, generated_text_chars, verdict,
            hard_violations, soft_warnings, quality_scores, total_score, claude_raw_response)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          opts.bookId, opts.episodeNumber, opts.iteration ?? 1,
          generatedText.length, result.verdict,
          JSON.stringify(result.hard_violations),
          JSON.stringify(result.soft_warnings),
          JSON.stringify(result.quality_scores),
          result.total_score, raw.slice(0, 4000),
        ]
      );
    } catch (dbErr) {
      logError("service:validator", dbErr, { context: "validation_logs 저장 실패" });
    }
  }

  return result;
}
