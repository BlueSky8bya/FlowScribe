/**
 * verify_story_continuity.mjs
 * 다음 화 연속성 계약 검증 스크립트
 *
 * 검사 항목:
 * 1. effective_context.ts: prevEpisodeTail 900자 이상 수집
 * 2. types/canonical.ts: ContinuityContract 타입 존재
 * 3. effective_context.ts: buildContinuityContract() 함수 존재
 * 4. pipeline/planner.ts: continuity_contract 섹션 삽입
 * 5. pipeline/planner.ts: 모순 지시 제거 (regen 분기 분리)
 * 6. pipeline/renderer.ts: prev_episode_tail 반영
 * 7. pipeline/renderer.ts: continuitySection 반영
 * 8. pipeline/index.ts: continuity_check 로직
 * 9. Fixture: 나쁜 2화 → WARN/FAIL, 좋은 2화 → PASS
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, "..");

function readFile(rel) {
  return readFileSync(resolve(root, rel), "utf8");
}

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

const effectiveCtx  = readFile("src/services/effective_context.ts");
const canonicalTs   = readFile("src/types/canonical.ts");
const plannerTs     = readFile("src/pipeline/planner.ts");
const rendererTs    = readFile("src/pipeline/renderer.ts");
const pipelineTs    = readFile("src/pipeline/index.ts");

// ── 1. prevEpisodeTail 길이 ──────────────────────────────────────
check("prevEpisodeTail: 900자 수집",
  effectiveCtx.includes("content.slice(-900)"));
check("prevEpisodeTail: 300자 이하 버전 제거됨",
  !effectiveCtx.includes("content.slice(-300)"));

// ── 2. ContinuityContract 타입 ──────────────────────────────────
check("ContinuityContract 인터페이스 선언",
  canonicalTs.includes("export interface ContinuityContract"));
check("ContinuityContract.mode: next_episode",
  canonicalTs.includes(`mode: "next_episode"`));
check("ContinuityContract.known_facts",
  canonicalTs.includes("known_facts: string[]"));
check("ContinuityContract.forbidden_regressions",
  canonicalTs.includes("forbidden_regressions: string[]"));
check("ContinuityContract.open_threads",
  canonicalTs.includes("open_threads: string[]"));
check("ContinuityContract.relationship_state",
  canonicalTs.includes("relationship_state: string[]"));
check("EffectiveContext.continuity_contract 필드",
  canonicalTs.includes("continuity_contract?: ContinuityContract"));

// ── 3. buildContinuityContract 함수 ────────────────────────────
check("buildContinuityContract() 함수 정의",
  effectiveCtx.includes("function buildContinuityContract"));
check("buildContinuityContract: ep >= 2 조건",
  effectiveCtx.includes("episodeNumber >= 2"));
check("buildContinuityContract: known_facts 조립",
  effectiveCtx.includes("known_facts"));
check("buildContinuityContract: forbidden_regressions 조립",
  effectiveCtx.includes("forbidden_regressions"));
check("buildContinuityContract: open_threads 조립",
  effectiveCtx.includes("open_threads"));
check("buildContinuityContract: last_state 조립",
  effectiveCtx.includes("last_state"));
check("ContinuityContract import 추가",
  effectiveCtx.includes("ContinuityContract"));

// ── 4. planner: continuity_contract 섹션 ────────────────────────
check("planner: ctx.continuity_contract 접근",
  plannerTs.includes("ctx.continuity_contract"));
check("planner: [연속성 계약 — 절대 준수] 섹션",
  plannerTs.includes("[연속성 계약 — 절대 준수]"));
check("planner: known_facts 섹션 출력",
  plannerTs.includes("이미 알려진 사실 — 처음 일어난 것처럼 반복 금지"));
check("planner: forbidden_regressions 섹션 출력",
  plannerTs.includes("[금지된 퇴행 — 절대 금지]"));
check("planner: open_threads 섹션 출력",
  plannerTs.includes("[열린 플롯 스레드 — 이번 화에서 최소 1~2개 이어야 한다]"));

// ── 5. planner: 모순 지시 제거 (regen 분기 분리) ────────────────
check("planner: regen 분기 분리 (if regenPrev)",
  plannerTs.includes("if (regenPrev)"));
check("planner: 모순 지시 '완전히 다른 감정적 출발점' 제거됨",
  !plannerTs.includes("완전히 다른 감정적 출발점에서 시작해야 한다"));
check("planner: 연속성 깨는 새 출발점 금지 지시",
  plannerTs.includes("연속성을 깨는 새 출발점 금지"));

// ── 6. renderer: prev_episode_tail 반영 ─────────────────────────
check("renderer: ctx.prev_episode_tail 접근",
  rendererTs.includes("ctx.prev_episode_tail"));
check("renderer: [직전 화 말미 — 이 장면 직후부터 이번 화가 이어진다]",
  rendererTs.includes("직전 화 말미 — 이 장면 직후부터 이번 화가 이어진다"));
check("renderer: prevTailSection 변수",
  rendererTs.includes("prevTailSection"));

// ── 7. renderer: continuitySection 반영 ─────────────────────────
check("renderer: continuitySection 변수",
  rendererTs.includes("continuitySection"));
check("renderer: forbidden_regressions 반영",
  rendererTs.includes("forbidden_regressions"));
check("renderer: known_facts 반영",
  rendererTs.includes("known_facts"));
check("renderer: [연속성 — 퇴행 금지]",
  rendererTs.includes("[연속성 — 퇴행 금지]"));

// ── 8. pipeline/index.ts: continuity_check ──────────────────────
check("pipeline: continuity_check 로직",
  pipelineTs.includes("continuity_check"));
check("pipeline: ctx.episode_number >= 2 조건",
  pipelineTs.includes("ctx.episode_number >= 2 && generatedText"));
check("pipeline: 처음 만남 퇴행 패턴 감지",
  pipelineTs.includes("처음\\s*보|낯선\\s*사람|처음 만|누구십니까|처음 뵙"));
check("pipeline: open_threads 반영 검사",
  pipelineTs.includes("open_threads"));
check("pipeline: input_contract에 has_continuity_contract",
  pipelineTs.includes("has_continuity_contract"));
check("training/types.ts: has_continuity_contract 타입",
  readFile("src/training/types.ts").includes("has_continuity_contract"));

// ── 9. Fixture: 연속성 체커 로직 단위 테스트 ─────────────────────
console.log("\n── 연속성 체커 fixture 검증 ────────────────────────────────");

// 인라인으로 continuity check 로직을 직접 재현해 테스트
function runContinuityCheck(text, characterArcs, openThreads) {
  const issues = [];

  // 1. 직전 화 인물 접촉/약속 key_event가 있는 인물에 대해 "처음 만남" 패턴 감지
  for (const [name, arc] of Object.entries(characterArcs)) {
    const hasContact = arc.key_events.some(ev => /만남|대화|약속|돕기|신뢰|발견/.test(ev));
    if (hasContact) {
      if (/처음\s*보|낯선\s*사람|처음 만|누구십니까|처음 뵙/.test(text)) {
        issues.push(`${name} 관련 이미 발생한 만남·접촉이 다시 처음처럼 표현될 수 있음`);
      }
    }
  }

  // 2. open_threads 중 최소 1개 반영 여부
  if (openThreads.length >= 2) {
    const reflected = openThreads.filter(th => {
      const kw = th.replace(/[^가-힣\w]/g, " ").split(/\s+/).filter(w => w.length >= 2);
      return kw.some(w => text.includes(w));
    });
    if (reflected.length === 0) {
      issues.push("직전 화에서 열린 플롯 스레드(복선/B플롯)가 이번 화 본문에 전혀 반영되지 않음");
    }
  }

  return { verdict: issues.length === 0 ? "PASS" : "WARN", issues };
}

// 1화 fixture 상태
const ep1Arcs = {
  "강현우": { state: "박지훈에게 과거에서 왔다고 고백한 상태", key_events: ["박지훈과 대화함", "과거에서 왔다고 말함", "춤을 멈추려 하지만 몸이 말을 듣지 않음"] },
  "박지훈": { state: "강현우를 돕기로 결심한 상태", key_events: ["강현우를 발견함", "강현우와 대화함", "강현우를 돕기로 함"] },
};
const ep1Threads = [
  "강현우의 춤이 식물의 시듦과 부활을 반복시킨다",
  "청자 상감운학문매병이 시간 왜곡의 핵심 단서다",
  "시간 관리국이 시간 흔적을 감지했다",
  "윤진서는 조선 시대 나침반의 위험성을 알고 있다",
];

// 나쁜 2화 예시
const bad2화 = `
박지훈은 멀리서 처음 보는 사람이 홀로 춤을 추는 것을 관찰했다.
낯선 사람의 움직임은 기묘했다.
"누구십니까?" 박지훈이 조심스럽게 접근하며 물었다.
강현우는 기억을 잃은 것 같았다.
`;

// 좋은 2화 예시
const good2화 = `
박지훈은 강현우의 어깨를 잡으려 했지만, 몸이 저절로 움직이는 그를 멈출 수 없었다.
청자 상감운학문매병이 희미하게 빛을 발하며 주변 시간을 흔들기 시작했다.
"좀 더 가까이 가야 해." 박지훈은 돕기로 한 약속을 되새기며 결심을 굳혔다.
시간 관리국 기지에서는 최민준이 포천 숲의 시간 흔적 좌표를 특정하고 있었다.
`;

const bad = runContinuityCheck(bad2화, ep1Arcs, ep1Threads);
const good = runContinuityCheck(good2화, ep1Arcs, ep1Threads);

check(`나쁜 2화 → WARN (verdict=${bad.verdict}, issues=${bad.issues.length})`,
  bad.verdict === "WARN" && bad.issues.length > 0);
check(`좋은 2화 → PASS (verdict=${good.verdict})`,
  good.verdict === "PASS");
check("나쁜 2화: 처음 만남 퇴행 감지됨",
  bad.issues.some(i => i.includes("만남")));
check("좋은 2화: issues 없음",
  good.issues.length === 0);

// ── 10. regen_prev_text 분리 확인 ────────────────────────────────
check("planner: regen_prev_text 1화 재생성 전용 조건 유지",
  plannerTs.includes("regen_prev_text"));
check("planner: episode_number === 1 재생성 전용 진입점 다양성 지시",
  plannerTs.includes("ctx.episode_number === 1"));

console.log(`\n${"─".repeat(60)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
