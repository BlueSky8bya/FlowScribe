/**
 * verify_genuine_progression_guard.mjs — R5B-1.8
 *
 * 정적 contract verifier:
 *   1. planner system prompt — R5B-1.8 emotional plausibility 가이드 + 6-delta 스키마
 *   2. planner extractor — relationship/decision/consequence/plausibility_note + countMeaningfulBeatDeltas export
 *   3. pipeline gating — fake_label_change + carry_forward_without_delta 둘 다 detect
 *   4. renderer — R5B-1.8 [감정 납득성] 헤더 + "사건이 만든 감정 흐름" 가이드
 *   5. cluster streak는 강제 FAIL 조건이 아님 (planner prompt에 cluster 강제 금지 명시)
 *   6. dist 산출물
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const planner   = readFileSync("src/pipeline/planner.ts", "utf8");
const pipeline  = readFileSync("src/pipeline/index.ts", "utf8");
const renderer  = readFileSync("src/pipeline/renderer.ts", "utf8");

console.log("── [Planner] R5B-1.8 emotional plausibility schema ──");
okIf("R5B-1.8 character_emotional_beats 가이드 헤더",
  /R5B-1\.8 character_emotional_beats/.test(planner));
okIf("relationship_delta 스키마 라인",  /relationship_delta/.test(planner));
okIf("decision_delta 스키마 라인",      /decision_delta/.test(planner));
okIf("consequence_delta 스키마 라인",   /consequence_delta/.test(planner));
okIf("plausibility_note 스키마 라인",   /plausibility_note/.test(planner));

console.log("\n── [Planner] cluster 강제 차별화 로직 제거 + 납득성 프레임 ──");
okIf("같은 감정군 유지 자연스러움 명시",
  /같은 감정군이 여러 화에 걸쳐 유지되는 것은 자연스럽다/.test(planner));
okIf("감정군 휙휙 바뀜이 부자연스럽다 명시",
  /부자연스러운 것은[\s\S]{0,80}감정군이 휙휙 바뀌는/.test(planner));
okIf("fake 정의: 라벨 바꿨는데 delta 없음 (cluster 미변경 ≠ fake)",
  /라벨을 바꿨는데[\s\S]{0,200}fake progression이다/.test(planner));
okIf("최소 2개 delta 기준 (cluster 강제 아님)",
  /최소 2개가 explicit하게 채워져/.test(planner));

console.log("\n── [Planner] extractor — countMeaningfulBeatDeltas + 6-delta 추출 ──");
okIf("CharacterEmotionalBeat interface relationship_delta 필드",
  /CharacterEmotionalBeat[\s\S]{0,400}relationship_delta\?: string/.test(planner));
okIf("CharacterEmotionalBeat interface decision_delta 필드",
  /CharacterEmotionalBeat[\s\S]{0,400}decision_delta\?: string/.test(planner));
okIf("CharacterEmotionalBeat interface consequence_delta 필드",
  /CharacterEmotionalBeat[\s\S]{0,500}consequence_delta\?: string/.test(planner));
okIf("CharacterEmotionalBeat interface plausibility_note 필드",
  /CharacterEmotionalBeat[\s\S]{0,500}plausibility_note\?: string/.test(planner));
okIf("countMeaningfulBeatDeltas export 함수",
  /export function countMeaningfulBeatDeltas/.test(planner));
okIf("_isMeaningfulDelta helper export",
  /export function _isMeaningfulDelta/.test(planner));
okIf("extractEmotionalBeats relationship_delta 매핑",
  /extractEmotionalBeats[\s\S]{0,1500}relationship_delta:/.test(planner));
okIf("extractEmotionalBeats decision_delta 매핑",
  /extractEmotionalBeats[\s\S]{0,1500}decision_delta:/.test(planner));

console.log("\n── [Pipeline] gating — fake_label_change + carry_forward_without_delta ──");
okIf("countMeaningfulBeatDeltas import",
  /import\s*{\s*[^}]*countMeaningfulBeatDeltas[^}]*}\s*from\s*"\.\/planner\.js"/.test(pipeline));
okIf("R5B-1.8 gating 주석",
  /R5B-1\.8[\s\S]{0,120}emotional plausibility/.test(pipeline));
okIf("carry_forward_without_delta 6-delta 검사",
  /carry_forward_without_delta[\s\S]{0,400}6개 delta 모두 없음/.test(pipeline));
okIf("label_change_without_cause warn (implausible shift)",
  /label_change_without_cause[\s\S]{0,200}implausible shift/.test(pipeline));
okIf("_hasCauseSignal: emotion_cause/decision_delta/consequence_delta",
  /_hasCauseSignal[\s\S]{0,300}emotion_cause[\s\S]{0,80}decision_delta[\s\S]{0,80}consequence_delta/.test(pipeline));

console.log("\n── [Renderer] R5B-1.8 감정 납득성 ──");
okIf("[★ R5B-1.8 감정 납득성] 헤더",
  /\[★ R5B-1\.8 감정 납득성/.test(renderer));
okIf("같은 감정 여러 화 유지 자연스러움 명시",
  /같은 감정이 여러 화에 걸쳐 유지되는 것은 자연스럽다/.test(renderer));
okIf("감정군 바뀔 때 사건 명시 요구",
  /감정군이 바뀔 때[\s\S]{0,150}본문에 그 변화를 만든 사건/.test(renderer));
okIf("6-delta 본문 구현 instruction",
  /relationship_delta[\s\S]{0,80}decision_delta[\s\S]{0,80}consequence_delta/.test(renderer));

console.log("\n── [Build] dist 산출물 ──");
okIf("dist/pipeline/planner.js",  existsSync("dist/pipeline/planner.js"));
okIf("dist/pipeline/index.js",    existsSync("dist/pipeline/index.js"));
okIf("dist/pipeline/renderer.js", existsSync("dist/pipeline/renderer.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
