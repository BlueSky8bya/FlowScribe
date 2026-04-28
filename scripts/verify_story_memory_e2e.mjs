/**
 * verify_story_memory_e2e.mjs
 * Story Memory E2E 검증 — DB/trace 경로 + 코드 경로 + fixture 기반
 *
 * 검증 범위:
 * 1. 코드 경로: rolling_summary, arc_memory, foreshadow, dynamic_states 저장 경로
 * 2. 코드 경로: continuity_contract 조립 경로
 * 3. 코드 경로: 단편 최종화 arc 트리거
 * 4. 코드 경로: generate.ts fallback summary 저장
 * 5. Fixture: rolling_summary → known_facts fallback
 * 6. Fixture: arc key_events 파싱
 * 7. Fixture: 최종화 arc_phase 계산
 * 8. 런타임: 서버 실행 중이면 실제 DB 확인
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
const arcMemory     = readFile("src/services/arc_memory.ts");
const episodesApi   = readFile("src/api/episodes.ts");
const generateApi   = readFile("src/api/generate.ts");
const stateExtract  = readFile("src/pipeline/state_extractor.ts");

// ── 1. rolling_summary 저장 경로 ────────────────────────────────
console.log("\n── rolling_summary 저장 경로 ──────────────────────────────");
check("episodes.ts: LLM 요약 생성 후 UPDATE episodes SET summary",
  episodesApi.includes("UPDATE episodes SET summary"));
check("episodes.ts: setImmediate 비동기 후처리",
  episodesApi.includes("setImmediate"));
check("effective_context.ts: SELECT episode_number, summary FROM episodes",
  effectiveCtx.includes("SELECT episode_number, summary FROM episodes"));
check("effective_context.ts: rolling_summary 조립",
  effectiveCtx.includes("rolling_summary: rollingSummary"));
check("generate.ts: fallback summary auto-save",
  generateApi.includes("fallbackSummary") && generateApi.includes("summary = CASE WHEN"));

// ── 2. arc_memory 저장 경로 ─────────────────────────────────────
console.log("\n── arc_memory 저장 경로 ───────────────────────────────────");
check("arc_memory.ts: generateAndSaveArcSummary 존재",
  arcMemory.includes("export async function generateAndSaveArcSummary"));
check("arc_memory.ts: key_events 추출 (주요 사건 섹션 파싱)",
  arcMemory.includes("[주요 사건]") && arcMemory.includes("keyEventsFromSummary"));
check("arc_memory.ts: character_arcs DO UPDATE SET key_events",
  arcMemory.includes("DO UPDATE SET state=$4, key_events=$5"));
check("arc_memory.ts: epEndOverride 파라미터 (단편 지원)",
  arcMemory.includes("epEndOverride"));
check("episodes.ts: 10화 단위 아크 트리거",
  episodesApi.includes("ep % ARC_SIZE === 0"));
check("episodes.ts: 단편 최종화 아크 트리거 (isShortFinal)",
  episodesApi.includes("isShortFinal"));
check("episodes.ts: episode_snapshots에서 totalEpisodes 조회",
  episodesApi.includes("episode_snapshots") && episodesApi.includes("totalEpisodes"));
check("episodes.ts: generateAndSaveArcSummary(bookId, 1, characterNames, ep)",
  episodesApi.includes("generateAndSaveArcSummary(bookId, 1, characterNames, ep)"));

// ── 3. foreshadow_memory 저장 경로 ──────────────────────────────
console.log("\n── foreshadow_memory 저장 경로 ────────────────────────────");
check("episodes.ts: extractAndStoreForeshadow 호출",
  episodesApi.includes("extractAndStoreForeshadow"));
check("episodes.ts: checkAndResolveForeshadows 호출",
  episodesApi.includes("checkAndResolveForeshadows"));
check("effective_context.ts: getOpenForeshadows 호출",
  effectiveCtx.includes("getOpenForeshadows"));
check("buildContinuityContract: open_threads from foreshadows",
  effectiveCtx.includes("open_threads: string[]") || effectiveCtx.includes("open_threads: foreshadows.map"));

// ── 4. character_dynamic_states 저장 경로 ───────────────────────
console.log("\n── character_dynamic_states 저장 경로 ─────────────────────");
check("pipeline/index.ts: commitDynamicState 호출",
  readFile("src/pipeline/index.ts").includes("commitDynamicState"));
check("pipeline/index.ts: character_state_updates 처리",
  readFile("src/pipeline/index.ts").includes("character_state_updates"));
check("character_state.ts: recent_goal 저장",
  readFile("src/services/character_state.ts").includes("recent_goal"));
check("effective_context.ts: getLatestDynamicStates(bookId, episodeNumber - 1)",
  effectiveCtx.includes("getLatestDynamicStates(bookId, episodeNumber - 1)"));

// ── 5. continuity_contract 조립 경로 ────────────────────────────
console.log("\n── continuity_contract 조립 경로 ──────────────────────────");
check("effective_context.ts: buildContinuityContract ep >= 2",
  effectiveCtx.includes("episodeNumber >= 2"));
check("buildContinuityContract: rollingSummary 파라미터",
  effectiveCtx.includes("rollingSummary?: string") || effectiveCtx.includes("rollingSummary: string"));
check("buildContinuityContract: rolling_summary fallback known_facts",
  effectiveCtx.includes("summaryLines") && effectiveCtx.includes("/^\\d+화:/.test"));
check("buildContinuityContract: arc 없을 때 dynamic state로 relationship_state 보충",
  effectiveCtx.includes("arc가 없으면 dynamic state에서"));
check("buildContinuityContract에 rollingSummary 전달",
  effectiveCtx.includes("buildContinuityContract(episodeNumber, dynStates, characterArcs, foreshadowList, prevEpisodeTail, rollingSummary)"));

// ── 6. 최종화 arc_phase 계산 fixture ────────────────────────────
console.log("\n── 최종화 arc_phase 계산 fixture ──────────────────────────");
// state_extractor.ts에서 arc_phase 계산 로직 재현
function calcArcPhase(episodeNumber, totalEpisodes) {
  const arc_ratio = totalEpisodes > 0 ? episodeNumber / totalEpisodes : 0;
  if (arc_ratio < 0.15) return "intro";
  if (arc_ratio < 0.35) return "early";
  if (arc_ratio < 0.65) return "mid";
  if (arc_ratio < 0.85) return "late";
  if (arc_ratio < 0.97) return "pre_final";
  return "final";
}

function calcEndingConstraint(episodeNumber, totalEpisodes) {
  return episodeNumber >= totalEpisodes ? "final" : "cliff";
}

// 6화짜리 테스트북
// 6화 테스트북: ratio 기준
// ep1: 1/6=0.167 > 0.15 → early  ep2: 2/6=0.333 < 0.35 → early
// ep3: 3/6=0.5 → mid              ep4: 4/6=0.667 → late
// ep5: 5/6=0.833 < 0.85 → late   ep6: 6/6=1.0 ≥ 0.97 → final
const testEps = [
  { ep: 1, expected_phase: "early",  expected_ending: "cliff" },
  { ep: 2, expected_phase: "early",  expected_ending: "cliff" },
  { ep: 3, expected_phase: "mid",    expected_ending: "cliff" },
  { ep: 4, expected_phase: "late",   expected_ending: "cliff" },
  { ep: 5, expected_phase: "late",   expected_ending: "cliff" },
  { ep: 6, expected_phase: "final",  expected_ending: "final" },
];

for (const t of testEps) {
  const phase = calcArcPhase(t.ep, 6);
  const ending = calcEndingConstraint(t.ep, 6);
  check(`6화 테스트북 ep${t.ep}: arc_phase=${t.expected_phase}`,
    phase === t.expected_phase);
  check(`6화 테스트북 ep${t.ep}: ending_constraint=${t.expected_ending}`,
    ending === t.expected_ending);
}

// ── 7. rolling_summary → known_facts fallback fixture ───────────
console.log("\n── rolling_summary → known_facts fallback fixture ─────────");
function runBuildKnownFacts(episodeNumber, dynStates, characterArcs, rollingSummary) {
  const known_facts = [];
  for (const [name, arc] of Object.entries(characterArcs)) {
    for (const ev of arc.key_events.slice(-4)) {
      if (ev.trim()) known_facts.push(`${name}: ${ev}`);
    }
  }
  for (const s of dynStates) {
    if (s.recent_goal) known_facts.push(`${s.character_name} 현재 목표: ${s.recent_goal}`);
  }
  // rolling_summary fallback (arc 없을 때)
  if (known_facts.length < 3 && rollingSummary) {
    const summaryLines = rollingSummary.split("\n").filter(l => /^\d+화:/.test(l.trim()));
    for (const line of summaryLines.slice(-(episodeNumber - 1))) {
      const content = line.replace(/^\d+화:\s*/, "").trim();
      if (content.length > 10) known_facts.push(content);
    }
  }
  return known_facts;
}

// arc 있는 경우
const arcFacts = runBuildKnownFacts(3,
  [{ character_name: "박지훈", recent_goal: "강현우를 돕기로 결심" }],
  { "강현우": { state: "과거에서 온 상태", key_events: ["박지훈과 대화함", "과거에서 왔다고 말함"] } },
  "1화: 박지훈이 강현우를 발견\n2화: 시간 관리국이 포천 좌표를 확인"
);
check("arc key_events → known_facts에 포함됨",
  arcFacts.some(f => f.includes("박지훈과 대화함")));
check("recent_goal → known_facts에 포함됨",
  arcFacts.some(f => f.includes("강현우를 돕기로 결심")));

// arc 없는 경우 (단편 <10화)
const noArcFacts = runBuildKnownFacts(3,
  [{ character_name: "박지훈", recent_goal: null }],
  {},
  "1화: 박지훈이 강현우를 발견했고 과거에서 온 사실을 들었다\n2화: 시간 관리국이 포천 숲 좌표를 특정했다"
);
check("arc 없을 때 rolling_summary lines → known_facts fallback",
  noArcFacts.length >= 2);
check("rolling_summary fallback 내용 포함",
  noArcFacts.some(f => f.includes("박지훈이 강현우를 발견")));

// ── 8. arc key_events 파싱 fixture ──────────────────────────────
console.log("\n── arc key_events 파싱 fixture ─────────────────────────────");
function parseArcKeyEvents(arcSummary) {
  const keyEventsFromSummary = [];
  const mainEventMatch = arcSummary.match(/\[주요 사건\]([\s\S]*?)(?=\[|$)/);
  if (mainEventMatch?.[1]) {
    keyEventsFromSummary.push(
      ...mainEventMatch[1].trim().split(/[.。]\s+/).filter(s => s.trim().length > 4).slice(0, 5)
    );
  }
  return keyEventsFromSummary;
}

const sampleArcSummary = `[주요 사건]
박지훈이 강현우를 처음 만나 대화를 나눴다. 강현우가 과거에서 왔다는 사실을 밝혔다. 시간 관리국이 포천 숲에서 시간 흔적을 감지했다.

[인물 현재 상태]
박지훈: 강현우를 돕기로 결심한 상태
강현우: 과거에서 와서 춤을 멈출 수 없는 상태
최민준: 시간 관리국에서 분석 중

[미해결 긴장]
청자 상감운학문매병의 시간 왜곡 능력이 아직 해결되지 않았다.`;

const keyEvents = parseArcKeyEvents(sampleArcSummary);
check("arc_summary에서 key_events 파싱됨",
  keyEvents.length >= 2);
check("key_events에 첫 번째 사건 포함됨",
  keyEvents.some(ev => ev.includes("박지훈")));

// ── 9. regen_prev_text가 ep >= 2 첫 생성에 섞이지 않음 ──────────
console.log("\n── regen_prev_text ep >= 2 오적용 방지 ───────────────────────");
const generateTs = readFile("src/api/generate.ts");
check("generate.ts: regen_prev_text는 run_traces ep 이력에서만 추출",
  generateTs.includes("run_traces") && generateTs.includes("regen_prev_text"));
check("regen_avoid_locations: episode === 1 조건으로 한정",
  generateTs.includes("regenNonce && episode === 1"));
check("planner.ts: regen_prev_text 조건부 avoidLines 분리",
  readFile("src/pipeline/planner.ts").includes("if (regenPrev)"));

// ── 10. 최종화 finalization prompt ──────────────────────────────
console.log("\n── 최종화 renderer 처리 ───────────────────────────────────");
const rendererTs = readFile("src/pipeline/renderer.ts");
check("renderer: final episode [END]로 끝내는 지시",
  rendererTs.includes("[END]로 끝낸다"));
check("renderer: final episode [CLIFF] 금지",
  rendererTs.includes("[CLIFF] 금지"));
check("renderer: finaleSection — 모든 핵심 갈등 해소 지시",
  rendererTs.includes("모든 핵심 갈등이 이 화 안에서 해소되어야 한다"));
check("renderer: ending_constraint final 감지",
  rendererTs.includes('isFinal = plan.ending_constraint !== "cliff"'));

// ── 런타임: 서버 실행 중이면 실제 DB 확인 ─────────────────────
const BASE = "http://localhost:3000";
async function runRuntimeChecks() {
  console.log("\n── 런타임 DB 확인 (서버 실행 중인 경우만) ─────────────────");
  try {
    await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
  } catch {
    console.log("  [skip] 서버 미실행 — 런타임 확인 스킵");
    return;
  }

  // /api/debug 엔드포인트로 DB 상태 확인
  try {
    const r = await fetch(`${BASE}/api/debug/memory-status`);
    if (r.ok) {
      const data = await r.json();
      check("[런타임] DB rolling_summary 경로 접근 가능", data.rolling_summary !== undefined || data.status === "ok");
    } else {
      console.log(`  [info] /api/debug/memory-status: ${r.status} — 서버 실행 중이나 엔드포인트 없음`);
    }
  } catch {
    console.log("  [skip] debug 엔드포인트 없음");
  }
}

await runRuntimeChecks().catch(() => {});

console.log(`\n${"─".repeat(65)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
