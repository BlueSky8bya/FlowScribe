/**
 * verify_r5b1_5_motif_dedup_discovery_guard.mjs — R5B-1.5
 *
 * 정적 contract 검증:
 *   1. foreshadow extractor system prompt — Discovery Event Guard 조항
 *   2. foreshadow dedup — Jaccard 0.4 + normalized signature + 최근 3화 제한
 *   3. planner system prompt — emotional_state/recent_goal 필수 emit
 *   4. planner user prompt — open_thread instruction 변경 (재발견 금지)
 *   5. planner user prompt — [이미 발생한 사건 — 재현 금지] 섹션
 *   6. dist 산출물
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const foreshadow = readFileSync("src/services/foreshadow.ts", "utf8");
const planner    = readFileSync("src/pipeline/planner.ts", "utf8");

console.log("── [Foreshadow] Discovery Event Guard (extractor prompt) ──");
okIf("'복선이란 — 추출 대상' 헤더", /\[복선이란 — 추출 대상\]/.test(foreshadow));
okIf("'복선 아님 — 절대 추출 금지' 헤더", /\[복선 아님 — 절대 추출 금지\]/.test(foreshadow));
okIf("'본문에서 인물이 직접 발견·확인한 흔적·단서·증거' 라인", /본문에서 인물이 직접 발견·확인한 흔적·단서·증거/.test(foreshadow));
okIf("'본문에서 이미 일어난 검증·조사·실험 행위' 라인", /본문에서 이미 일어난 검증·조사·실험 행위/.test(foreshadow));
okIf("0~4개 추출 (빈 배열 허용)", /0~4개 추출/.test(foreshadow));
okIf("발견 사건 부정 예시", /나쁨[\s\S]{0,200}발견 사건은 이미 일어남[\s\S]{0,80}복선 아님/.test(foreshadow));
okIf("질문 형태 긍정 예시", /좋음[\s\S]{0,200}아직 답이 없는 질문/.test(foreshadow));

console.log("\n── [Foreshadow] dedup 강화 ──");
okIf("RECENT_WINDOW = 3 (최근 화 제한)", /RECENT_WINDOW\s*=\s*3/.test(foreshadow));
okIf("planted_episode >= ... 절 (최근 화 제한 SQL)", /planted_episode\s*>=\s*\$3/.test(foreshadow));
okIf("DEDUP_THRESHOLD 0.4 (이전 0.6)", /DEDUP_THRESHOLD\s*=\s*0\.4/.test(foreshadow) && !/DEDUP_THRESHOLD\s*=\s*0\.6/.test(foreshadow));
okIf("normalize: 한글 조사 제거 (_normToken)", /_normToken[\s\S]{0,200}_STOPWORD_PARTICLE/.test(foreshadow));
okIf("content signature 생성 함수 (_contentSig)", /_contentSig\s*=/.test(foreshadow));
okIf("keyword + content signature 양쪽 비교 OR 조건", /kwSim\s*>=\s*DEDUP_THRESHOLD\s*\|\|\s*sigSim\s*>=\s*DEDUP_THRESHOLD/.test(foreshadow));

console.log("\n── [Planner] system prompt — state emission ──");
okIf("R5B-1.5 [필수 출력] 마커", /R5B-1\.5 \[필수 출력\]/.test(planner));
okIf("emotional_state, recent_goal 항상 출력 명시", /emotional_state, recent_goal[\s\S]{0,80}항상 출력/.test(planner));
okIf("'감정 단어만 바꾸는 fake progression 금지' 조항", /감정 단어만 바꾸는 fake progression 금지/.test(planner));
okIf("'억지 갱신 금지' 조항 (등장 안 하는 인물)", /억지 갱신 금지/.test(planner));

console.log("\n── [Planner] user prompt — open_thread 재발견 금지 ──");
okIf("'발견 행위 반복 금지' 헤더", /\[발견 행위 반복 금지\]/.test(planner));
okIf("'마치 처음 발견한 것처럼' 금지 라인", /마치 처음 발견한 것처럼/.test(planner));
okIf("진전 방식 — 의미 해석/추적/위험 노출/관계 변화", /의미 해석[\s\S]{0,80}정체 추적[\s\S]{0,80}위험 노출/.test(planner));

console.log("\n── [Planner] user prompt — [이미 발생한 사건 — 재현 금지] ──");
okIf("'이미 발생한 사건 — 재현·재발견·재발화 금지' 섹션", /\[이미 발생한 사건 — 재현·재발견·재발화 금지\]/.test(planner));
okIf("'직전 화까지 본문에서 실제로 발생한 사건의 요약' 헤더", /직전 화까지 본문에서 실제로 발생한 사건의 요약/.test(planner));
okIf("'결과\\/의미\\/대응\\/추적' 진전 방식 명시", /결과\/의미\/대응\/추적/.test(planner));
okIf("storyFlowText 사용 (rolling_summary reframe)", /storyFlowText/.test(planner) && /이미 발생한 사건[\s\S]{0,500}storyFlowText/.test(planner));

console.log("\n── [Build] dist 산출물 ──");
okIf("dist/services/foreshadow.js", existsSync("dist/services/foreshadow.js"));
okIf("dist/pipeline/planner.js", existsSync("dist/pipeline/planner.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
