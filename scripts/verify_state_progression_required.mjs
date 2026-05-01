/**
 * verify_state_progression_required.mjs — R5B-1.8
 *
 * 정적 contract verifier:
 *   1. planner system prompt — emotional_state, recent_goal 필수 출력 (R5B-1.5 그대로)
 *   2. planner 6-delta(cause/goal/behavior/relationship/decision/consequence) JSON 출력 슬롯
 *   3. pipeline에서 라벨 변경(cluster shift)이 cause 없이 발생하면 warn
 *   4. audit script가 plausibility 지표 출력 — 6-delta별 카운트, sameC+/sameC-/implaus
 *
 * runtime: planner JSON에서 의미 있는 delta가 ≥1개 들어오는지는 audit_emotional_plausibility로
 * 검증한다(이 verify는 코드 contract만 체크).
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const planner   = readFileSync("src/pipeline/planner.ts", "utf8");
const pipeline  = readFileSync("src/pipeline/index.ts", "utf8");
const audit     = readFileSync("scripts/audit_emotional_plausibility.mjs", "utf8");

console.log("── [Planner] 필수 상태 출력 contract ──");
okIf("emotional_state 필수 출력 명시",
  /emotional_state[\s\S]{0,500}항상 출력. 생략 금지/.test(planner));
okIf("recent_goal 필수 출력 명시",
  /recent_goal[\s\S]{0,300}항상 출력. 생략 금지/.test(planner) || /emotional_state, recent_goal[\s\S]{0,200}항상 출력/.test(planner));

console.log("\n── [Planner] 6-delta JSON 슬롯 ──");
okIf("emotion_cause 슬롯",       /character_emotional_beats[\s\S]{0,1500}"emotion_cause"/.test(planner));
okIf("goal_delta 슬롯",          /character_emotional_beats[\s\S]{0,1500}"goal_delta"/.test(planner));
okIf("behavior_delta 슬롯",      /character_emotional_beats[\s\S]{0,1500}"behavior_delta"/.test(planner));
okIf("relationship_delta 슬롯",  /character_emotional_beats[\s\S]{0,1500}"relationship_delta"/.test(planner));
okIf("decision_delta 슬롯",      /character_emotional_beats[\s\S]{0,1500}"decision_delta"/.test(planner));
okIf("consequence_delta 슬롯",   /character_emotional_beats[\s\S]{0,1500}"consequence_delta"/.test(planner));

console.log("\n── [Pipeline] cause 없는 cluster shift 감지 ──");
okIf("label_change_without_cause warn 호출",
  /label_change_without_cause/.test(pipeline));
okIf("_hasCauseSignal 사용 (emotion_cause/decision/consequence)",
  /_hasCauseSignal[\s\S]{0,400}emotion_cause/.test(pipeline));
okIf("appeared 인물에 한해서만 평가 (_isAppearedInBeats)",
  /_isAppearedInBeats[\s\S]{0,400}label_change_without_cause/.test(pipeline));

console.log("\n── [Audit] plausibility 지표 6-delta 카운트 출력 ──");
okIf("emotionCauseDeltaCount 카운트",       /emotionCauseDeltaCount/.test(audit));
okIf("goalDeltaCount 카운트",               /goalDeltaCount/.test(audit));
okIf("behaviorDeltaCount 카운트",           /behaviorDeltaCount/.test(audit));
okIf("relationshipDeltaCount 카운트",       /relationshipDeltaCount/.test(audit));
okIf("decisionDeltaCount 카운트",           /decisionDeltaCount/.test(audit));
okIf("consequenceDeltaCount 카운트",        /consequenceDeltaCount/.test(audit));
okIf("same_cluster_with_valid_delta 출력",  /same_cluster_with_valid_delta/.test(audit));
okIf("same_cluster_without_delta 출력",     /same_cluster_without_delta/.test(audit));
okIf("implausible_emotion_shift 출력",      /implausible_emotion_shift/.test(audit));
okIf("fake_progression_risk 출력",          /fake_progression_risk/.test(audit));
okIf("genuine_progression 출력",            /genuine_progression/.test(audit));
okIf("R5B-1.8 PASS criteria 5개 체크",      /R5B-1\.8 PASS criteria/.test(audit));

console.log("\n── [Build] dist 산출물 ──");
okIf("dist/pipeline/planner.js",  existsSync("dist/pipeline/planner.js"));
okIf("dist/pipeline/index.js",    existsSync("dist/pipeline/index.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
