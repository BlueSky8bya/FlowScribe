/**
 * revision.ts — 자동 리비전 루프
 *
 * ── 원칙 ────────────────────────────────────────────────────
 * - 전체 재생성보다 문제 구간 수정 우선
 * - 절대금지 규칙 위반은 즉시 차단 (revision 없이 FAIL 확정)
 * - 핵심 실패 축: 상태 보존 / 시점 무결성 / 대사지문 분리 / 엔딩 훅 / 설정 활용
 * - 리비전마다 어떤 규칙이 개선됐는지 로그 저장
 */

import { getLLMClient, getStoryModel } from "../lib/llm.js";
import { logInfo, logWarn, logError } from "../lib/logger.js";
import { pool } from "../lib/db.js";
import { validate } from "./validator.js";
import type { EffectiveContext, ValidationResult, Verdict } from "../types/canonical.js";

const MAX_REVISION_ITERATIONS = 3;

export interface RevisionResult {
  final_text: string;
  final_verdict: Verdict;
  final_score: number;
  iterations: number;
  validation_history: ValidationResult[];
  absolute_blocked: boolean;
}

// ══════════════════════════════════════════════════════════════
// 리비전 프롬프트 조립
// ══════════════════════════════════════════════════════════════
function buildRevisionPrompt(
  originalText: string,
  validation: ValidationResult,
  ctx: EffectiveContext
): { system: string; user: string } {
  const hardList = validation.hard_violations
    .map((v, i) => `${i + 1}. [${v.severity.toUpperCase()}] ${v.rule}: ${v.description}${v.location ? ` (위치: ${v.location})` : ""}`)
    .join("\n");

  const softList = validation.soft_warnings
    .filter(w => w.severity === "medium")
    .map((w, i) => `${i + 1}. ${w.rule}: ${w.description}`)
    .join("\n");

  const hints = validation.revision_hints?.join("\n") ?? "";

  const charNames  = ctx.characters.map(c => c.name).join(", ") || "없음";
  const dynStates  = ctx.character_dynamic_states.map(s =>
    `${s.character_name}: 위치=${s.location ?? "미정"}, 상태=${s.physical_state ?? "정상"}` +
    (s.items?.length ? `, 소지품=${s.items.join(",")}` : "")
  ).join("\n") || "없음";
  const prevEnding = ctx.prev_episode_state.ending_event || "없음";
  const continuityNotes = ctx.prev_episode_state.continuity_notes.join(" / ") || "없음";

  const system = `당신은 소설 편집 전문가다.
아래 지적된 문제점들을 수정해서 전체 본문을 다시 출력한다.

[수정 원칙]
1. 문제 있는 부분만 최소한으로 수정한다 (전체 재작성 금지)
2. 시점: ${ctx.gen_config.pov} — 반드시 유지
3. 허용 인물 이름: ${charNames} — 이 목록 외 이름 사용 금지, 합성·오기 금지
4. 대사 따옴표: " "(곡선) 만 사용
5. 절대금지: ${ctx.absolute_forbidden.join(", ") || "없음"}
6. 수정 설명 없이 소설 본문만 출력

[상태 보존 — 수정 시 반드시 유지]
직전 화 엔딩: ${prevEnding}
인물 현재 상태: ${dynStates}
연속성 주의: ${continuityNotes}

[장소 이동 규칙]
장면이 다른 장소로 바뀔 때 반드시 이동 과정이나 시간 경과를 한 문장 이상 서술한다.
설명 없이 갑자기 다른 장소에 인물이 등장하면 안 된다.`;

  const user = `[하드 규칙 위반 — 반드시 수정]
${hardList || "없음"}

[소프트 경고 — 가능하면 개선]
${softList || "없음"}

[추가 힌트]
${hints || "없음"}

[원본 소설 본문]
---
${originalText}
---

위 문제점들을 모두 수정한 전체 본문을 출력해줘.`;

  return { system, user };
}

// ══════════════════════════════════════════════════════════════
// 절대금지 위반 체크
// ══════════════════════════════════════════════════════════════
function hasAbsoluteViolation(validation: ValidationResult): boolean {
  return validation.hard_violations.some(v =>
    v.rule === "절대금지 규칙" || v.severity === "critical"
  );
}

// ══════════════════════════════════════════════════════════════
// 단일 리비전 수행
// ══════════════════════════════════════════════════════════════
async function performRevision(
  text: string,
  validation: ValidationResult,
  ctx: EffectiveContext
): Promise<string> {
  const { system, user } = buildRevisionPrompt(text, validation, ctx);

  const res = await getLLMClient().chat.completions.create({
    model: getStoryModel(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.5,
    max_tokens: Math.ceil((ctx.gen_config.episodeLength + ctx.gen_config.episodeLengthVar) * 0.65 * 1.5),
  } as any);

  return (res as any).choices?.[0]?.message?.content ?? text;
}

// ══════════════════════════════════════════════════════════════
// DB 리비전 로그 저장
// ══════════════════════════════════════════════════════════════
async function saveRevisionLog(opts: {
  bookId: string;
  episodeNumber: number;
  iteration: number;
  revisedChars: number;
  rulesImproved: string[];
  verdictBefore: Verdict;
  verdictAfter: Verdict;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO revision_logs
         (book_id, episode_number, iteration, revised_chars, rules_improved, verdict_before, verdict_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        opts.bookId, opts.episodeNumber, opts.iteration, opts.revisedChars,
        opts.rulesImproved,
        opts.verdictBefore, opts.verdictAfter,
      ]
    );
  } catch (err) {
    logError("service:revision", err, { context: "saveRevisionLog" });
  }
}

// ══════════════════════════════════════════════════════════════
// 개선된 규칙 추적
// ══════════════════════════════════════════════════════════════
function findImprovedRules(before: ValidationResult, after: ValidationResult): string[] {
  const beforeHardRules = new Set(before.hard_violations.map(v => v.rule));
  const afterHardRules  = new Set(after.hard_violations.map(v => v.rule));
  const improved: string[] = [];
  for (const rule of beforeHardRules) {
    if (!afterHardRules.has(rule)) improved.push(rule);
  }
  return improved;
}

// ══════════════════════════════════════════════════════════════
// 공개 API — reviseUntilPass
// ══════════════════════════════════════════════════════════════

/**
 * reviseUntilPass — FAIL/WARN 시 자동 리비전 루프
 *
 * 1회 검증 후:
 * - 절대금지 위반 → 즉시 FAIL 반환 (리비전 없음)
 * - PASS/PASS_STRONG → 즉시 반환
 * - FAIL/WARN → 최대 MAX_REVISION_ITERATIONS 회 리비전 후 재검증
 */
export async function reviseUntilPass(
  generatedText: string,
  initialValidation: ValidationResult,
  ctx: EffectiveContext,
  opts: {
    bookId?: string;
    episodeNumber?: number;
    promptVersion?: "A" | "B";
  } = {}
): Promise<RevisionResult> {
  const history: ValidationResult[] = [initialValidation];

  // 절대금지 위반 시 즉시 차단
  if (hasAbsoluteViolation(initialValidation)) {
    logWarn("service:revision", "절대금지 위반 — 리비전 없이 FAIL 확정", {
      book_id: opts.bookId, episode: opts.episodeNumber,
      violations: initialValidation.hard_violations.filter(v => v.severity === "critical").map(v => v.rule),
    });
    return {
      final_text: generatedText,
      final_verdict: "FAIL",
      final_score: initialValidation.total_score,
      iterations: 0,
      validation_history: history,
      absolute_blocked: true,
    };
  }

  // 이미 PASS 이상이면 즉시 반환
  if (initialValidation.verdict === "PASS" || initialValidation.verdict === "PASS_STRONG") {
    return {
      final_text: generatedText,
      final_verdict: initialValidation.verdict,
      final_score: initialValidation.total_score,
      iterations: 0,
      validation_history: history,
      absolute_blocked: false,
    };
  }

  let currentText       = generatedText;
  let currentValidation = initialValidation;
  let revisionCount     = 0;

  for (let iter = 1; iter <= MAX_REVISION_ITERATIONS; iter++) {
    logInfo("service:revision", `리비전 ${iter}/${MAX_REVISION_ITERATIONS} 시작`, {
      book_id: opts.bookId, episode: opts.episodeNumber,
      verdict_before: currentValidation.verdict, score_before: currentValidation.total_score,
    });

    try {
      const revised = await performRevision(currentText, currentValidation, ctx);
      const newValidation = await validate(revised, ctx, {
        bookId: opts.bookId,
        episodeNumber: opts.episodeNumber,
        iteration: iter + 1,
        promptVersion: opts.promptVersion,
      });

      const improved = findImprovedRules(currentValidation, newValidation);

      if (opts.bookId && opts.episodeNumber) {
        await saveRevisionLog({
          bookId: opts.bookId,
          episodeNumber: opts.episodeNumber,
          iteration: iter,
          revisedChars: revised.length,
          rulesImproved: improved,
          verdictBefore: currentValidation.verdict,
          verdictAfter: newValidation.verdict,
        });
      }

      logInfo("service:revision", `리비전 ${iter} 완료`, {
        verdict_after: newValidation.verdict, score_after: newValidation.total_score,
        improved_rules: improved,
      });

      history.push(newValidation);
      revisionCount = iter;

      // 절대금지 위반이 리비전 결과에서 발생하면 이전 결과 유지
      if (hasAbsoluteViolation(newValidation)) {
        logWarn("service:revision", "리비전 결과에서 절대금지 위반 발생 — 이전 결과 유지");
        break;
      }

      currentText       = revised;
      currentValidation = newValidation;

      if (newValidation.verdict === "PASS" || newValidation.verdict === "PASS_STRONG") {
        logInfo("service:revision", `리비전 ${iter}에서 PASS 달성`);
        break;
      }
    } catch (err) {
      logError("service:revision", err, { iteration: iter });
      break;
    }
  }

  return {
    final_text: currentText,
    final_verdict: currentValidation.verdict,
    final_score: currentValidation.total_score,
    iterations: revisionCount,
    validation_history: history,
    absolute_blocked: false,
  };
}
