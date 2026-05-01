/**
 * verify_episode_end_state_alignment.mjs — R5B-1.8C / R5B-1.8D superset
 *
 * 정적 contract verifier:
 *   1. pipeline absent guard — 본문 의미 등장이 strong/medium이 아니면 carry-forward absent
 *   2. audit_episode_end_state_alignment.mjs 출력 필드 (LLM verdict, appeared_in_body, etc.)
 *   3. PASS 기준: alignment %, severe = 0, absent_severe = 0
 *   4. dist 산출물
 *
 * R5B-1.8D 전환:
 *   - guard helper는 _bodyAppearCount(R5B-1.8C) → _meaningfulAppearance + isUpdateAllowed(R5B-1.8D).
 *   - 본 verify는 superset으로 둘 중 하나가 있으면 PASS.
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const pipeline = readFileSync("src/pipeline/index.ts", "utf8");
const audit    = readFileSync("scripts/audit_episode_end_state_alignment.mjs", "utf8");

console.log("── [Pipeline] absent guard (R5B-1.8C/1.8D superset) ──");
okIf("R5B-1.8C 또는 R5B-1.8D 주석 헤더",
  /R5B-1\.8C[\s\S]{0,80}본문 등장 빈도/.test(pipeline) ||
  /R5B-1\.8D[\s\S]{0,200}meaningful appearance/.test(pipeline));
okIf("guard helper (legacy _bodyAppearCount or new detectMeaningfulAppearance)",
  /_bodyAppearCount\s*=\s*\(name: string\)[\s\S]{0,300}generatedText\.match/.test(pipeline) ||
  /detectMeaningfulAppearance\s*\(/.test(pipeline));
okIf("update 차단 정책 호출 (threshold or isUpdateAllowed)",
  /_appearCount\s*<\s*_MEANINGFUL_APPEAR_THRESHOLD/.test(pipeline) ||
  /!isUpdateAllowed\(/.test(pipeline));
okIf("absent guard warn 로그 (planner 갱신 무시)",
  /planner 갱신 무시/.test(pipeline));
okIf("guard hit 시 visibility=\"absent\" 강제",
  /pipeline:r5b1_8[cd][\s\S]*?visibility_state:\s*"absent"/.test(pipeline));
okIf("guard hit 시 carry-forward emotional_state",
  /_prevForAbsent\.emotional_state/.test(pipeline));
okIf("guard hit 시 direct commit 스킵 (continue)",
  /continue;\s*\/\/ 다음 stateUpdate로/.test(pipeline));

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
