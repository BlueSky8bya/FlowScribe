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
import type { NamePostprocessResult, NameReclassifiedItem } from "../types/character_policy.js";
import { resolveCharacterPolicy } from "../lib/character_policy_resolver.js";

const MAX_TOKENS = 3500;

// ══════════════════════════════════════════════════════════════
// 검증 프롬프트 A — 주요 사용 버전
// ══════════════════════════════════════════════════════════════
// ── R7-FREEZE (2026-04-21) — 이 함수는 validator freeze 버전이다. 튜닝 금지. ──
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
    "pov_consistency": 점수,
    "scene_clarity": 점수,
    "character_consistency": 점수,
    "plot_momentum": 점수,
    "world_rule_usage": 점수,
    "exposition_control": 점수,
    "prose_density": 점수,
    "ending_hook": 점수,
    "style_adherence": 점수,
    "intervention_adherence": 점수
  },
  "summary": "요약",
  "revision_hints": []
}

각 점수(점수 자리)는 0~100 사이 정수로 실제 평가 결과를 채운다. 템플릿 값을 그대로 반환하지 말 것.

[하드 위반 — 아래 6가지만 hard_violations에 넣는다. 다른 것은 절대 hard_violations에 넣지 않는다]

1. 절대금지 위반 (severity: critical)
   판정: 입력에서 제공된 절대금지(absolute_forbidden) 항목을 본문이 직접 위반한 경우

2. 따옴표 미닫힘 (severity: major)
   판정: 대사를 여는 " 따옴표가 닫는 "로 닫히지 않은 경우
   예외: 한국어 조사·어미가 대사 안에 있는 것은 정상

3. 인물 이름 혼동 (severity: major)
   판정: 설정에 없는 이름 사용, 인물 A 자리에 인물 B 이름 사용
   예외: 성씨(이 씨, 김 씨), 호칭(형·언니·선생님·오빠·아저씨), 별명, 역할어는 정상

4. 시점 위반 (severity: major)
   판정:
   - 1인칭 주인공: 서술부에서 갑자기 "그가/그녀가" 등 3인칭 전환
   - 1인칭 관찰자: 서술부에서 타인의 감정·생각을 직접 서술 ("그는 두려웠다" 형식)
   - 3인칭 시점: 서술부에 "나는/나의/내가" 등장
   예외: 대사(" " 내부) 안의 1인칭 표현은 위반 아님
         화자 자신의 내면(감정·생각) 서술은 1인칭 시점에서 정상
         교차 시점은 장면 전환마다 시점 인물이 바뀌므로 전환 자체는 위반 아님

5. 상태 보존 직접 모순 (severity: major)
   판정: 이전 상태와 직접적으로 모순되는 경우만
   - 이미 죽은 인물이 살아서 등장
   - 부상당한 특정 팔/다리를 그 부위가 반드시 필요한 동작에 정상적으로 사용 (오른팔 부상인데 오른팔로 물건 집기, 다리 부상인데 달리기)
   - 설정에 없는 소지품을 갑자기 꺼내 사용
   예외:
   - 부상 부위와 무관한 동작은 위반 아님 (오른팔 부상 시 왼팔 사용)
   - 부상/소지품을 언급하지 않은 것만으로는 위반 아님
   - 인물이 예상과 다른 위치에서 시작하는 것은 soft_warnings medium으로만

6. 시공간 연결성 (severity: major)
   판정: 장면 전환이 있는데 이동 동사(갔다/향했다/이동했다/돌아왔다/나왔다 등)도 없고
         시간 표현(후/뒤/밤에/며칠 후/다음 날/그 사이/잠시 뒤 등)도 전혀 없는 경우만
   예외: 같은 장소에서 계속 이야기가 진행되면 판정 불필요
         이동 또는 시간 표현이 한 문장이라도 있으면 통과

[소프트 경고 — 위 6가지 이외의 모든 문제는 soft_warnings로만]

- 위치 불일치: 인물이 예상 위치가 아닌 곳에서 시작 → medium
- 부상 제약 미반영: 부상 부위 사용 시 고통/제한 묘사 없음 → medium
- 세계관 일반 규칙 미준수 → medium
- 설정 자산 미활용 → medium
- 엔딩 훅 약함 → medium
- 문체 불일치 → medium
- 어휘 반복 → low
- 젠더 대명사 불일치 → low

[절대 하지 말 것]
- 위 6가지 이외를 hard_violations에 추가하지 않는다
- 언급하지 않은 것을 모순으로 판정하지 않는다
- 입력에 없는 내용을 상상해서 판정하지 않는다
- 세계관 general 규칙 미준수를 hard_violations에 넣지 않는다
- 위치 불일치를 hard_violations에 넣지 않는다
- 시점 교차 전환 자체를 시점 위반으로 판정하지 않는다

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
  let parseError = false;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    else parseError = true;
  } catch {
    logWarn("service:validator", "JSON 파싱 실패 — WARN 기본값 반환", { raw: raw.slice(0, 200) });
    parseError = true;
  }

  // JSON 파싱 실패 시 PASS가 아닌 WARN 반환
  if (parseError) {
    const defScores: QualityScores = {
      pov_consistency:70, scene_clarity:70, character_consistency:70, plot_momentum:70,
      world_rule_usage:70, exposition_control:70, prose_density:70, ending_hook:55,
      style_adherence:70, intervention_adherence:70,
    };
    return {
      verdict: "WARN", hard_violations: [],
      soft_warnings: [{ rule: "검증기 파싱 오류", description: "LLM 응답을 JSON으로 파싱 실패", severity: "medium" }],
      quality_scores: defScores, total_score: 55,
      summary: "JSON 파싱 실패로 인한 기본값", revision_hints: [],
    };
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

function clamp(v: unknown, fallback = 70): number {
  const n = Number(v);
  return isNaN(n) ? fallback : Math.max(0, Math.min(100, Math.round(n)));
}

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
// 이름 관련 hard_violation 후처리 레이어
// ── R7-FREEZE 본체를 건드리지 않고 판정 해석력만 보강 ──────────
// ══════════════════════════════════════════════════════════════

/**
 * postprocessNameViolations
 *
 * validator LLM이 반환한 hard_violations 중 "인물 이름 혼동"을 4종으로 재분류:
 *   canonical_name_confusion       → hard 유지
 *   alias_or_reference_usage       → soft 강등 (validator 예외 항목 오탐)
 *   named_new_character_introduction → policy에 따라 hard 유지 또는 soft 강등
 *   gender_pronoun_mismatch        → soft 강등 (이름 혼동이 아님)
 *
 * verdict / total_score는 변경된 violations 기준으로 재계산.
 */
function postprocessNameViolations(
  result: ValidationResult,
  ctx: EffectiveContext
): ValidationResult {
  const nameViolations = result.hard_violations.filter(v => v.rule === "인물 이름 혼동");
  if (nameViolations.length === 0) return result;

  const policy = resolveCharacterPolicy(ctx.gen_config.character_policy, ctx.world_config);

  const reclassified: NameReclassifiedItem[] = [];
  const hardToKeep: ValidationResult["hard_violations"] = [];
  const newSoftWarnings: ValidationResult["soft_warnings"] = [...result.soft_warnings];

  for (const v of result.hard_violations) {
    if (v.rule !== "인물 이름 혼동") { hardToKeep.push(v); continue; }

    const desc = v.description;

    // ① 젠더 대명사 오기 — "그녀"/"그" 대명사 + 성별 설정 불일치
    //   이름 자체가 틀린 게 아니므로 soft 강등
    const isGenderPronoun =
      /남성.*설정.*그녀|여성.*설정.*그[^녀]|대명사.*(그녀|그[^녀])/.test(desc) ||
      /성별.*설정.*(남성|여성).*(대명사|그녀|그[^녀])/.test(desc) ||
      (desc.includes("그녀") && (desc.includes("남성") || desc.includes("성별 설정")));

    if (isGenderPronoun) {
      reclassified.push({ original_rule: "인물 이름 혼동", original_description: desc,
        new_kind: "alias_or_reference_usage", action: "demoted_soft",
        reason: "젠더 대명사 불일치 — 이름 혼동이 아닌 대명사 오기" });
      newSoftWarnings.push({ rule: "젠더 대명사 불일치", description: desc,
        severity: "medium", suggestion: "설정 성별에 맞는 대명사를 사용하세요." });
      continue;
    }

    // ② alias / 호칭 / 성씨 오탐 — 프롬프트 예외 항목인데 LLM이 잘못 hard로 판정한 경우
    const isAlias = /성씨|호칭|별명|역할어|씨\)|님\)|선배|선생님|형\)|언니|오빠|아저씨/.test(desc);
    if (isAlias) {
      reclassified.push({ original_rule: "인물 이름 혼동", original_description: desc,
        new_kind: "alias_or_reference_usage", action: "demoted_soft",
        reason: "validator 예외 항목(성씨/호칭/별명)에 해당 — soft 강등" });
      newSoftWarnings.push({ rule: "별칭/호칭 사용 (참고)", description: desc,
        severity: "low", suggestion: "성씨·호칭·별명은 이름 혼동으로 판정하지 않습니다." });
      continue;
    }

    // ③ 신규 인물 도입 — 설정에 없는 이름 등장
    const isNewChar = /설정에 없는|등장하지 않는|새로운 인물|등록되지 않은|인물 목록에/.test(desc);
    if (isNewChar) {
      const policyAllows = policy.new_character_policy === "named_with_gate"
        || policy.new_character_policy === "open_cast";
      if (policyAllows) {
        reclassified.push({ original_rule: "인물 이름 혼동", original_description: desc,
          new_kind: "named_new_character_introduction", action: "demoted_soft",
          reason: `신규 인물 도입 — policy(${policy.new_character_policy}) 상 허용, soft 강등` });
        newSoftWarnings.push({ rule: "신규 인물 도입", description: desc,
          severity: "medium", suggestion: "첫 등장 시 역할·기존 인물과의 관계를 명시하세요." });
      } else {
        reclassified.push({ original_rule: "인물 이름 혼동", original_description: desc,
          new_kind: "named_new_character_introduction", action: "kept_hard",
          reason: `신규 인물 도입 — policy(${policy.new_character_policy}) 위반` });
        hardToKeep.push({ ...v, rule: "신규 인물 도입 (정책 위반)" });
      }
      continue;
    }

    // ④ 그 외 — 실제 인물 이름 교차 혼동 또는 오기 → hard 유지
    reclassified.push({ original_rule: "인물 이름 혼동", original_description: desc,
      new_kind: "canonical_name_confusion", action: "kept_hard",
      reason: "실제 인물 이름 교차 혼동 또는 오기" });
    hardToKeep.push(v);
  }

  const name_analysis: NamePostprocessResult = {
    original_name_violations: nameViolations.length,
    reclassified,
    final_name_violations: hardToKeep.filter(
      v => v.rule === "인물 이름 혼동" || v.rule === "신규 인물 도입 (정책 위반)"
    ).length,
    policy_violations: reclassified
      .filter(r => r.action === "kept_hard" && r.new_kind === "named_new_character_introduction")
      .map(r => r.original_description),
  };

  // violations 변경이 있으면 score/verdict 재계산
  const demoted = reclassified.some(r => r.action === "demoted_soft");
  if (!demoted) return { ...result, hard_violations: hardToKeep, name_analysis };

  const newTotal  = computeTotalScore(result.quality_scores, hardToKeep, newSoftWarnings);
  const newVerdict = computeVerdict(hardToKeep, newSoftWarnings, newTotal);

  logInfo("service:validator", "이름 판정 후처리 완료", {
    original_name_violations: name_analysis.original_name_violations,
    demoted: reclassified.filter(r => r.action === "demoted_soft").length,
    verdict_before: result.verdict, verdict_after: newVerdict,
  });

  return {
    ...result,
    hard_violations: hardToKeep,
    soft_warnings: newSoftWarnings,
    total_score: newTotal,
    verdict: newVerdict,
    name_analysis,
  };
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

  const result = postprocessNameViolations(parseValidationResult(raw), ctx);

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
