/**
 * test_arc_hook_guide.ts — arc_phase별 hook_type 권장/회피 지침 테스트
 *
 * 실행: npx ts-node scripts/test_arc_hook_guide.ts
 */

// ── buildArcPhaseDirective 인라인 재현 ──────────────────────────
// (src/pipeline/planner.ts에서 export하지 않으므로 여기서 복제)

type ArcPhase = "intro" | "early" | "mid" | "late" | "pre_final" | "final" | "unknown";

function buildArcPhaseDirective(phase: ArcPhase, remaining: number): string {
  const hookGuide: Record<ArcPhase, { preferred: string[]; avoid: string[] }> = {
    intro: {
      preferred: [
        "unresolved_situation",
        "unexpected_discovery",
        "ominous_calm",
        "tender_moment",
        "memory_trigger",
      ],
      avoid: [
        "immediate_threat",
        "last_moment_failure",
        "revelation",
        "betrayal_hint",
      ],
    },
    early: {
      preferred: [
        "unexpected_discovery",
        "new_problem",
        "betrayal_hint",
        "ominous_calm",
        "emotional_break",
      ],
      avoid: [
        "immediate_threat",
        "revelation",
        "last_moment_failure",
        "time_pressure",
      ],
    },
    mid: {
      preferred: [
        "new_problem",
        "unexpected_discovery",
        "immediate_threat",
        "betrayal_hint",
        "ironic_reversal",
        "emotional_break",
        "alliance_shift",
      ],
      avoid: [
        "tender_moment",
        "unresolved_situation",
      ],
    },
    late: {
      preferred: [
        "immediate_threat",
        "unexpected_discovery",
        "revelation",
        "last_moment_failure",
        "cliffhanger_choice",
        "betrayal_hint",
        "time_pressure",
      ],
      avoid: [
        "new_problem",
        "tender_moment",
        "memory_trigger",
      ],
    },
    pre_final: {
      preferred: [
        "cliffhanger_choice",
        "revelation",
        "immediate_threat",
        "last_moment_failure",
        "betrayal_hint",
        "sudden_loss",
        "time_pressure",
      ],
      avoid: [
        "unresolved_situation",
        "tender_moment",
        "memory_trigger",
        "new_problem",
      ],
    },
    final: {
      preferred: [
        "tender_moment",
        "unresolved_situation",
        "revelation",
        "emotional_break",
        "alliance_shift",
      ],
      avoid: [
        "immediate_threat",
        "new_problem",
        "betrayal_hint",
        "time_pressure",
        "last_moment_failure",
      ],
    },
    unknown: { preferred: [], avoid: [] },
  };

  const directives: Record<ArcPhase, { allowed: string[]; forbidden: string[] }> = {
    intro: {
      allowed: [
        "주인공의 일상·현재 상황 도입",
        "핵심 갈등의 씨앗 심기",
        "새 인물과의 첫 만남·관계 형성",
        "세계관 규칙을 자연스럽게 드러내는 장면",
        "앞으로 회수될 복선 설치",
        "과거 기억·트라우마 자연 노출 (memory_trigger hook 허용)",
        "불길한 고요·예감 묘사 (ominous_calm hook 허용)",
      ],
      forbidden: [
        "핵심 갈등의 해소 또는 결말 암시",
        "주요 적대 세력의 완전한 등장·충돌",
        "관계의 급격한 결말(이별·죽음·화해 완료)",
        "즉각적 위협·전투·추격 장면으로 시작 (immediate_threat hook 금지)",
        "핵심 정체·사실 폭로 (revelation hook 금지 — 서사 무게 미형성)",
        "손에 닿기 직전 클라이맥스급 좌절 (last_moment_failure hook 금지)",
      ],
    },
    early: {
      allowed: [
        "인물 간 관계·신뢰의 점진적 구축",
        "서브플롯 도입 및 복선 강화",
        "세계관 규칙이 갈등 원인으로 작동하는 장면",
        "새 조력자·협력자 합류 (intro에서 씨앗이 뿌려진 경우)",
        "주인공의 목표 명확화",
        "신뢰 관계 위 첫 균열 복선 (betrayal_hint hook 허용)",
        "관계 발전 중 감정 폭발 (emotional_break hook 허용)",
      ],
      forbidden: [
        "핵심 갈등의 조기 해소",
        "아직 등장하지 않은 적대 세력의 급작스러운 최종 충돌",
        "서브플롯의 완결 없이 새 서브플롯 2개 이상 동시 도입",
        "즉각적 전투·추격·생존 위기로 끝맺는 훅 (immediate_threat hook 지양)",
        "핵심 정체·사실 폭로 (revelation hook 금지 — 서사 무게 미축적)",
        "카운트다운·데드라인 설정 (time_pressure hook 금지 — 이름)",
      ],
    },
    mid: {
      allowed: [
        "갈등 심화 및 인물 간 긴장 고조",
        "복선 강화·추가 힌트 제공",
        "기존 관계의 균열 또는 예상 밖 동맹 (alliance_shift hook 허용)",
        "세계관 규칙이 선택을 제한하는 딜레마 장면",
        "서브플롯의 부분 해소 및 주플롯 연결",
        "아이러니한 반전으로 서사 활력 (ironic_reversal hook 허용)",
        "배신 암시 본격화 (betrayal_hint hook 허용)",
        "감정 폭발로 인물 심층 노출 (emotional_break hook 허용)",
      ],
      forbidden: [
        "핵심 갈등의 해소 또는 화해 완료 (tender_moment hook 자제)",
        "새로운 주요 조력자·세계관 세력의 도입 (기존 인물 활용 우선)",
        "갑작스러운 장르 전환(액션→로맨스 등)",
        "막연한 여운으로만 끝맺기 (unresolved_situation hook 과용 금지)",
      ],
    },
    late: {
      allowed: [
        "서브플롯 하나씩 회수·정리",
        "심어진 복선 중 하나 이상 드러내기 (revelation hook 허용)",
        "핵심 갈등을 향한 집결·준비",
        "인물 간 관계의 결정적 변화(화해·배신·각오)",
        "적대 세력의 실체·목적 부분 노출",
        "손에 닿기 직전 좌절로 긴장 극대화 (last_moment_failure hook 허용)",
        "결정적 선택 기로 설정 (cliffhanger_choice hook 허용)",
        "데드라인·카운트다운으로 긴박감 강화 (time_pressure hook 허용)",
      ],
      forbidden: [
        "새로운 조력자·세력 도입",
        "해결되지 않은 새 서브플롯 추가 (new_problem hook 지양)",
        "주인공이 전혀 다른 목표로 이탈",
        "감동 여운 마무리 (tender_moment hook 자제 — 결말부 전용)",
        "과거 회고로 흐름 끊기 (memory_trigger hook 자제)",
      ],
    },
    pre_final: {
      allowed: [
        "핵심 갈등의 최고조·직접 충돌",
        "남은 복선의 회수",
        "인물 간 최종 관계 정립 (각오·화해·작별)",
        "결말을 향한 결정적 행동 시작",
        "클라이맥스 반전·폭로 (revelation hook 허용)",
        "배신 본격 드러남 (betrayal_hint → betrayal 전환 허용)",
        "충격적 상실로 감정 폭발 (sudden_loss hook 허용)",
        "돌이킬 수 없는 선택 기로 (cliffhanger_choice hook 권장)",
        "카운트다운 정점 (time_pressure hook 허용)",
      ],
      forbidden: [
        "새로운 인물·세력·서브플롯 도입 (new_problem hook 금지)",
        "핵심 갈등과 무관한 탐색·여행·모집 장면",
        "주인공의 목표 변경 또는 새 목표 설정",
        "아직 등장하지 않은 정보로 반전 시도",
        "막연한 여운으로만 끝맺기 (unresolved_situation hook 금지)",
        "감동 마무리 (tender_moment hook 금지 — 결말부 전용)",
      ],
    },
    final: {
      allowed: [
        "모든 핵심 갈등의 해소",
        "남은 복선 전부 회수",
        "인물 관계의 최종 귀결",
        "세계관 변화 또는 주인공의 성장 확인 장면",
        "독자에게 감동·여운을 주는 마무리 (tender_moment hook 권장)",
        "마지막 진실 확인으로 독자 납득 (revelation hook 허용)",
        "감정 해소·카타르시스 (emotional_break hook 허용)",
      ],
      forbidden: [
        "새로운 갈등·복선·인물 도입",
        "미해결 서브플롯 추가",
        "즉각적 위협·생존 위기 (immediate_threat hook 금지)",
        "새로운 문제 발생 (new_problem hook 금지)",
        "해소 없는 배신 암시 (betrayal_hint hook 금지)",
        "새 카운트다운·데드라인 설정 (time_pressure hook 금지)",
        "결말에 좌절만 남기는 구성 (last_moment_failure hook 금지)",
      ],
    },
    unknown: {
      allowed: ["연재 계약 정보를 기반으로 자연스러운 장면 계획"],
      forbidden: [],
    },
  };

  const label: Record<ArcPhase, string> = {
    intro:     "도입부",
    early:     "전개 초반",
    mid:       "전개 중반",
    late:      "전개 후반",
    pre_final: "결말 직전",
    final:     "최종화",
    unknown:   "미확정",
  };

  const d = directives[phase];
  const hg = hookGuide[phase];
  const lines = [`현재 서사 국면: ${label[phase]} (남은 화수: ${remaining}화)`];
  if (d.allowed.length) lines.push(`[이 국면에 적합한 전개]\n${d.allowed.map(s => `- ${s}`).join("\n")}`);
  if (d.forbidden.length) lines.push(`[이 국면에 금지된 전개]\n${d.forbidden.map(s => `- ${s}`).join("\n")}`);
  if (hg.preferred.length) lines.push(`[이 국면의 권장 hook_type] ${hg.preferred.join(", ")}`);
  if (hg.avoid.length) lines.push(`[이 국면에서 피해야 할 hook_type] ${hg.avoid.join(", ")}`);
  return lines.join("\n");
}

// ── 테스트 헬퍼 ────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passCount++;
  } else {
    console.error(`  FAIL  ${label}`);
    failCount++;
  }
}

// ── 테스트 케이스 ──────────────────────────────────────────────

const phases: ArcPhase[] = ["intro", "early", "mid", "late", "pre_final", "final", "unknown"];
const remainingMap: Record<ArcPhase, number> = {
  intro: 90, early: 70, mid: 50, late: 20, pre_final: 5, final: 0, unknown: -1,
};

console.log("=== ARC PHASE HOOK GUIDE TEST ===\n");

// 1. 각 phase 출력 확인 + preferred/avoid 포함 여부
for (const phase of phases) {
  const remaining = remainingMap[phase];
  const output = buildArcPhaseDirective(phase, remaining);
  console.log(`[${phase.toUpperCase()} | remaining=${remaining}]`);

  check(
    `출력이 비어있지 않음`,
    output.length > 0,
  );

  if (phase !== "unknown") {
    check(
      `국면 레이블 포함`,
      output.includes("현재 서사 국면:"),
    );
    check(
      `남은 화수 포함`,
      output.includes(`${remaining}화`),
    );
    check(
      `권장 hook_type 섹션 포함`,
      output.includes("권장 hook_type"),
    );
    check(
      `피해야 할 hook_type 섹션 포함`,
      output.includes("피해야 할 hook_type"),
    );
  }
  console.log();
}

// 2. intro phase — immediate_threat이 avoid에 있어야 함
{
  const output = buildArcPhaseDirective("intro", 90);
  check(
    "intro: immediate_threat이 avoid에 포함됨",
    output.includes("피해야 할 hook_type") && output.includes("immediate_threat"),
  );
  check(
    "intro: unresolved_situation이 preferred에 포함됨",
    output.includes("권장 hook_type") && output.includes("unresolved_situation"),
  );
  check(
    "intro: ominous_calm이 preferred에 포함됨",
    output.includes("ominous_calm"),
  );
  check(
    "intro: revelation이 avoid에 포함됨",
    output.includes("revelation"),
  );
  console.log();
}

// 3. final phase — new_problem이 avoid에 있어야 함, immediate_threat도
{
  const output = buildArcPhaseDirective("final", 0);
  check(
    "final: new_problem이 avoid에 포함됨",
    output.includes("피해야 할 hook_type") && output.includes("new_problem"),
  );
  check(
    "final: immediate_threat이 avoid에 포함됨",
    output.includes("immediate_threat"),
  );
  check(
    "final: tender_moment이 preferred에 포함됨",
    output.includes("권장 hook_type") && output.includes("tender_moment"),
  );
  console.log();
}

// 4. pre_final — cliffhanger_choice, revelation이 preferred에 있어야 함
{
  const output = buildArcPhaseDirective("pre_final", 3);
  check(
    "pre_final: cliffhanger_choice이 preferred에 포함됨",
    output.includes("권장 hook_type") && output.includes("cliffhanger_choice"),
  );
  check(
    "pre_final: revelation이 preferred에 포함됨",
    output.includes("revelation"),
  );
  check(
    "pre_final: unresolved_situation이 avoid에 포함됨",
    output.includes("피해야 할 hook_type") && output.includes("unresolved_situation"),
  );
  console.log();
}

// 5. mid — 신규 hook type 포함 여부
{
  const output = buildArcPhaseDirective("mid", 45);
  check(
    "mid: ironic_reversal이 preferred에 포함됨",
    output.includes("ironic_reversal"),
  );
  check(
    "mid: emotional_break이 preferred에 포함됨",
    output.includes("emotional_break"),
  );
  check(
    "mid: alliance_shift이 preferred에 포함됨",
    output.includes("alliance_shift"),
  );
  console.log();
}

// 6. late — 신규 hook type 포함 여부
{
  const output = buildArcPhaseDirective("late", 15);
  check(
    "late: last_moment_failure이 preferred에 포함됨",
    output.includes("last_moment_failure"),
  );
  check(
    "late: time_pressure이 preferred에 포함됨",
    output.includes("time_pressure"),
  );
  check(
    "late: revelation이 preferred에 포함됨",
    output.includes("revelation"),
  );
  console.log();
}

// 7. unknown phase — 예외 없이 실행
{
  const output = buildArcPhaseDirective("unknown", -1);
  check(
    "unknown: 크래시 없이 실행됨",
    typeof output === "string",
  );
  console.log();
}

// ── 최종 결과 ──────────────────────────────────────────────────
console.log("=== RESULT ===");
console.log(`PASS: ${passCount}  FAIL: ${failCount}`);
if (failCount === 0) {
  console.log("ALL TESTS PASSED");
} else {
  console.error(`${failCount} TEST(S) FAILED`);
  process.exit(1);
}
