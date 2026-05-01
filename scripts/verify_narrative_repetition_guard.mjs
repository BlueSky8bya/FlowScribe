/**
 * verify_narrative_repetition_guard.mjs — R5B-3.5
 *
 * deterministic narrative repetition guard 라이브러리 + pipeline integration + retry contract 검증.
 */
import { readFileSync, existsSync } from "fs";
import {
  extractNarrativeSentences,
  extractNarrativeTokens,
  checkNarrativeRepetition,
  RETRY_INSTRUCTION,
} from "../dist/lib/narrative_repetition_guard.js";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

console.log("── [A] extractNarrativeSentences ──");
{
  const body = `리아가 마법진을 그렸다. 그녀는 깊게 숨을 쉬었다.
"이게 마지막이야." 빅토리가 말했다.
브론이 방패를 들어 올리며 문가에 섰다.
"준비됐어?"
고개를 끄덕였다.`;
  const sents = extractNarrativeSentences(body);
  okIf("narrative sentence ≥ 20자만 추출",
    sents.every(s => s.length >= 20));
  okIf("dialogue 안 문장 제외",
    !sents.some(s => s.includes("이게 마지막이야") || s.includes("준비됐어")));
  okIf("trivial 동작('고개를 끄덕였다') 제외",
    !sents.some(s => s.trim() === "고개를 끄덕였다"));
}

console.log("\n── [B] checkNarrativeRepetition — exact narrative duplicate detection ──");
{
  // ep80↔81 word-for-word identical 시뮬레이션
  const newBody = `빅토리가 핸드폰을 들어 마나 샘의 방향을 확인했다. 그녀의 시선은 화면에 고정되었다.`;
  const recent = [{
    episode_number: 80,
    content: `빅토리가 핸드폰을 들어 마나 샘의 방향을 확인했다. 잠시 후 그녀가 고개를 들었다.`,
  }];
  const r = checkNarrativeRepetition(newBody, recent);
  okIf("exact narrative duplicate 검출 (≥1)", r.exact_duplicate_count >= 1);
  okIf("verdict = RETRY", r.verdict === "RETRY");
}

console.log("\n── [C] adjacent full narrative similarity ──");
{
  // 동일한 narrative 본문 (jaccard ≥ 0.85)
  const a = `리아가 검을 들어 올렸다. 그녀의 눈이 빛났다. 빅토리는 책상 앞에 앉았다.`;
  const b = `리아가 검을 들어 올렸다. 그녀의 눈이 빛났다. 빅토리는 책상 앞에 앉았다.`;
  const r = checkNarrativeRepetition(b, [{ episode_number: 1, content: a }]);
  okIf("adjacent full sim ≥ 0.85 → RETRY", r.adjacent_full_similarity >= 0.85 && r.verdict === "RETRY");
  console.log(`    actual adjacent_full_sim = ${r.adjacent_full_similarity.toFixed(3)}`);
}

console.log("\n── [D] closing scene similarity ──");
{
  const ep54 = `…
브론이 그녀의 곁에 섰다.
"응. 끝났어."
"이제 우리 차례야."
빅토리가 고개를 끄덕였다.
"이제 원래 세계로 돌아갈 방법을 찾아야 해."
브론이 그녀 옆에 앉았다.
"함께 찾자."
그리고 그들은 새로운 여정을 시작했다.`;
  const ep55 = `…
브론이 그녀 옆에 섰다.
"응. 끝났어."
"이제 우리 차례야."
빅토리가 고개를 들었다.
"원래 세계로 돌아갈 방법을 찾아야 해."
브론이 고개를 끄덕였다.
"함께 찾자."
그리고 그들은 새로운 여정을 시작했다.`;
  const r = checkNarrativeRepetition(ep55, [{ episode_number: 54, content: ep54 }]);
  okIf("ep54-style closing → closing_sim ≥ 0.65 RETRY", r.closing_scene_similarity >= 0.65 && r.verdict === "RETRY");
  console.log(`    actual closing_scene_sim = ${r.closing_scene_similarity.toFixed(3)}`);
}

console.log("\n── [E] PASS case (independent narrative) ──");
{
  const a = `리아가 검을 뽑았다. 마물이 다가왔다.`;
  const b = `빅토리는 핸드폰 데이터를 분석했다. 새로운 패턴이 보였다.`;
  const r = checkNarrativeRepetition(b, [{ episode_number: 1, content: a }]);
  okIf("독립 narrative → verdict = PASS", r.verdict === "PASS");
  console.log(`    sims: adjacent=${r.adjacent_full_similarity.toFixed(3)} closing=${r.closing_scene_similarity.toFixed(3)}`);
}

console.log("\n── [F] RETRY_INSTRUCTION 형식 ──");
okIf("RETRY_INSTRUCTION 존재 (★ R5B-3.5 narrative)",
  /★ R5B-3\.5 narrative/.test(RETRY_INSTRUCTION));
okIf("retry instruction 6개 변경 옵션 포함",
  /행동 방식/.test(RETRY_INSTRUCTION) &&
  /대사 방향/.test(RETRY_INSTRUCTION) &&
  /장면 마무리 구조/.test(RETRY_INSTRUCTION) &&
  /선택/.test(RETRY_INSTRUCTION) &&
  /대응 방식/.test(RETRY_INSTRUCTION) &&
  /공간 활용/.test(RETRY_INSTRUCTION));

console.log("\n── [G] pipeline integration ──");
{
  const pipeline = readFileSync("src/pipeline/index.ts", "utf8");
  okIf("checkNarrativeRepetition import",
    /import\s*{\s*checkNarrativeRepetition[\s\S]{0,200}narrative_repetition_guard\.js"/.test(pipeline));
  okIf("R5B-3.5 guard 호출 (sanitize 후, pre-storage)",
    /R5B-3\.5: narrative cliché runtime guard/.test(pipeline) &&
    /checkNarrativeRepetition\(generatedText/.test(pipeline));
  okIf("verdict==='RETRY' 시 retry 시도",
    /_narrativeRepCheck\.verdict\s*===\s*"RETRY"[\s\S]{0,200}_narrativeRetryAttempted\s*=\s*true/.test(pipeline));
  okIf("retry 시 NARRATIVE_RETRY_INSTRUCTION + temp override 0.92",
    /NARRATIVE_RETRY_INSTRUCTION[\s\S]{0,80}0\.92|0\.92[\s\S]{0,80}NARRATIVE_RETRY_INSTRUCTION/.test(pipeline));
  okIf("hybrid streaming 중에는 retry skip (UX 안전)",
    /!onRendererChunk/.test(pipeline));
  okIf("retry 결과 sanitize + 재검사",
    /retrySanitized[\s\S]{0,200}checkNarrativeRepetition\(retrySanitized\.text/.test(pipeline));
  okIf("retry 1회만 (재귀 retry 없음)",
    /\/\/ retry 1회만/.test(pipeline) || (pipeline.match(/_narrativeRetryAttempted\s*=\s*true/g) ?? []).length === 1);
  okIf("trace에 narrative_repetition_check 기록",
    /setNarrativeRepetitionCheck/.test(pipeline));
}

console.log("\n── [H] renderer extraSystem 지원 ──");
{
  const renderer = readFileSync("src/pipeline/renderer.ts", "utf8");
  okIf("renderFromPlanWithTrace에 extraSystem? parameter 추가",
    /extraSystem\?:\s*string/.test(renderer));
  okIf("extraSystem이 있으면 systemPrompt 끝에 append",
    /extraSystem\s*\?\s*`[\s\S]{0,30}\$\{baseSystemPrompt\}[\s\S]{0,30}\$\{extraSystem\}/.test(renderer));
}

console.log("\n── [I] trace_logger setNarrativeRepetitionCheck ──");
{
  const tracer = readFileSync("src/training/trace_logger.ts", "utf8");
  okIf("setNarrativeRepetitionCheck method 정의",
    /setNarrativeRepetitionCheck\(check:\s*Record<string,\s*unknown>\)/.test(tracer));
  okIf("renderer_trace.narrative_repetition_check에 병합",
    /renderer_trace as any\)\.narrative_repetition_check\s*=\s*check/.test(tracer));
}

console.log("\n── [J] dist 산출물 ──");
okIf("dist/lib/narrative_repetition_guard.js", existsSync("dist/lib/narrative_repetition_guard.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
