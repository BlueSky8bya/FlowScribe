/**
 * verify_r5b1_7_emotional_contract.mjs — R5B-1.7
 *
 * 정적 contract 검증:
 *   1. planner system prompt — character_emotional_beats 스키마 + cluster 개념
 *   2. planner extractor — extractEmotionalBeats 함수 export
 *   3. pipeline carry-forward gating — emotional_progression warn 로직
 *   4. renderer system prompt — [감정 장면화] 섹션
 *   5. audit forensic — cluster streak 추가
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
const audit     = readFileSync("scripts/audit_emotional_progression_forensics.mjs", "utf8");

console.log("── [Planner] system prompt — character_emotional_beats schema ──");
okIf("character_emotional_beats 스키마 라인 존재", /character_emotional_beats/.test(planner));
okIf("emotion_cause / goal_delta / behavior_delta 필드 정의", /emotion_cause[\s\S]{0,400}goal_delta[\s\S]{0,400}behavior_delta/.test(planner));
okIf("R5B-1.7 character_emotional_beats 가이드 헤더", /R5B-1\.7 character_emotional_beats/.test(planner));
okIf("같은 cluster 단어 변경 fake progression 명시", /같은 cluster 내 단어 변경[\s\S]{0,200}fake progression/.test(planner));
okIf("같은 emotional_state 유지 시 behavior_delta 변화 강제", /같은 emotional_state가 유지되어도 OK[\s\S]{0,150}behavior_delta는 반드시 변해야 한다/.test(planner));

console.log("\n── [Planner] extractor — extractEmotionalBeats ──");
okIf("extractEmotionalBeats 함수 정의", /function extractEmotionalBeats/.test(planner));
okIf("CharacterEmotionalBeat interface export", /export interface CharacterEmotionalBeat/.test(planner));
okIf("rawParsed에서 character_emotional_beats 추출 호출", /extractEmotionalBeats\(rawParsed\)/.test(planner));
okIf("parsed에 character_emotional_beats 저장", /character_emotional_beats\s*=\s*emotionalBeats/.test(planner));

console.log("\n── [Pipeline] carry-forward gating ──");
okIf("emotionalBeats 추출 (scenePlan)", /character_emotional_beats[\s\S]{0,80}\?\?\s*\[\]/.test(pipeline));
okIf("_beatByName 인물 이름 매칭 Map", /_beatByName\s*=\s*new Map/.test(pipeline));
okIf("appearedInBeats 검출 (scene_beats characters_involved)", /_isAppearedInBeats[\s\S]{0,200}characters_involved/.test(pipeline));
okIf("emotion same + goal same 비교", /_emoSame[\s\S]{0,400}_goalSame/.test(pipeline));
okIf("hasDelta 검사 (cause/goal_delta/behavior_delta)", /_hasDelta[\s\S]{0,200}emotion_cause[\s\S]{0,80}goal_delta[\s\S]{0,80}behavior_delta/.test(pipeline));
okIf("carry_forward_without_delta warn 로그", /carry_forward_without_delta — fake progression risk/.test(pipeline));

console.log("\n── [Renderer] 감정 장면화 ──");
okIf("[감정 장면화] section 헤더", /\[★ R5B-1\.7 감정 장면화\]/.test(renderer));
okIf("'단어로 직접 설명하지 말고' 라인", /단어[\s\S]{0,40}로 직접 설명하지 말고/.test(renderer));
okIf("나쁨/좋음 예시", /나쁨:[\s\S]{0,150}좋음:/.test(renderer));
okIf("character_emotional_beats 본문 구현 instruction", /character_emotional_beats[\s\S]{0,200}본문 행동·대사·결정으로 실제 구현/.test(renderer));

console.log("\n── [Audit] cluster streak 추가 ──");
okIf("maxClusterStreak 변수", /maxClusterStreak/.test(audit));
okIf("currentClusterStreak 변수", /currentClusterStreak/.test(audit));
okIf("max cluster streak 출력", /max cluster streak/.test(audit));

console.log("\n── [Build] dist 산출물 ──");
okIf("dist/pipeline/planner.js", existsSync("dist/pipeline/planner.js"));
okIf("dist/pipeline/index.js", existsSync("dist/pipeline/index.js"));
okIf("dist/pipeline/renderer.js", existsSync("dist/pipeline/renderer.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
