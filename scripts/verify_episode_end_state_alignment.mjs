/**
 * verify_episode_end_state_alignment.mjs — R5B-1.8C
 *
 * 정적 contract verifier:
 *   1. pipeline absent_in_body guard — 본문 등장 < 임계 시 carry-forward absent로 강제
 *   2. audit_episode_end_state_alignment.mjs 출력 필드 (LLM verdict, appeared_in_body, etc.)
 *   3. PASS 기준 3개: alignment ≥ 85%, FAIL = 0, absent_severe = 0
 *   4. dist 산출물
 *
 * 본 verify는 정책 contract만 점검한다. 실제 alignment %는 audit_episode_end_state_alignment에서.
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const pipeline = readFileSync("src/pipeline/index.ts", "utf8");
const audit    = readFileSync("scripts/audit_episode_end_state_alignment.mjs", "utf8");

console.log("── [Pipeline] R5B-1.8C absent_in_body guard ──");
okIf("R5B-1.8C 주석 헤더",
  /R5B-1\.8C[\s\S]{0,80}본문 등장 빈도/.test(pipeline));
okIf("_MEANINGFUL_APPEAR_THRESHOLD 상수",
  /_MEANINGFUL_APPEAR_THRESHOLD\s*=\s*\d+/.test(pipeline));
okIf("_bodyAppearCount helper 함수",
  /_bodyAppearCount\s*=\s*\(name: string\)[\s\S]{0,300}generatedText\.match/.test(pipeline));
okIf("absent_in_body warn 로그 호출",
  /absent_in_body[\s\S]{0,200}planner 갱신 무시/.test(pipeline));
okIf("absent_in_body 시 visibility=\"absent\" 강제",
  /absent_in_body[\s\S]*?visibility_state:\s*"absent"/.test(pipeline));
okIf("absent_in_body 시 carry-forward emotional_state",
  /_prevForAbsent\.emotional_state/.test(pipeline));
okIf("absent_in_body 시 direct commit 스킵 (continue)",
  /absent_in_body[\s\S]*?continue; \/\/ 다음 stateUpdate로/.test(pipeline));

console.log("\n── [Audit] R5B-1.8C alignment audit 출력 필드 ──");
okIf("LLM judge prompt PASS/WARN/FAIL 구분",
  /PASS\|WARN\|FAIL/.test(audit));
okIf("appeared_in_body 필드 요청",
  /appeared_in_body[\s\S]{0,40}true\|false/.test(audit));
okIf("last_appearance_position 필드",
  /last_appearance_position/.test(audit));
okIf("rendered_last_summary 필드",
  /rendered_last_summary/.test(audit));
okIf("absent_severe 카운터 (verdict != PASS)",
  /absent_severe[\s\S]*?verdict !== "PASS"/.test(audit));
okIf("absent_border 카운터 (carry-forward PASS)",
  /absent_border/.test(audit));

console.log("\n── [Audit] PASS 기준 3개 ──");
okIf("alignment PASS ≥ 85% 체크",
  /alignment PASS ≥ 85%/.test(audit));
okIf("severe mismatch (FAIL) = 0 체크",
  /severe mismatch \(FAIL\) = 0/.test(audit));
okIf("absent_severe = 0 체크",
  /absent_severe = 0/.test(audit));

console.log("\n── [Build] dist 산출물 ──");
okIf("dist/pipeline/index.js", existsSync("dist/pipeline/index.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
