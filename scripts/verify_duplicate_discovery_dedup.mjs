/**
 * verify_duplicate_discovery_dedup.mjs — R5B-3
 *
 * deterministic discovery_signature.ts + audit / planner contract 통합 검증.
 *
 * 검사:
 *   [A] discovery_signature 라이브러리
 *      - extractDiscoveryEvents가 narrative 안 발견 동사만 추출 (quote 안 dialogue 제외)
 *      - 의지·명령형 dialogue("찾아야 해", "남았어", "확인해야") 제외 (false positive 방지)
 *      - jaccard similarity가 의미 중복 detection
 *      - isClosingSceneSimilar가 ep54-56 형태 ending 잡음
 *   [B] audit script가 새 lib 사용 + R5B-3 PASS criteria 출력
 *   [C] planner system prompt에 "★ R5B-3 발견·결말 반복 방지" section 존재
 */
import { readFileSync, existsSync } from "fs";
import {
  extractDiscoveryEvents,
  extractClosingScene,
  isDiscoveryDuplicate,
  isClosingSceneSimilar,
  jaccardSim,
} from "../dist/lib/discovery_signature.js";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

console.log("── [A] discovery_signature 라이브러리 ──");

// A.1: narrative 안 발견 동사만 추출
{
  const body = `리아가 마법진을 그렸다. 빅토리는 책상 위에서 이상한 흔적을 발견했다.
"이건 뭐지?"
"흔적을 찾아야 해."
"마나가 남았어?"`;
  const evs = extractDiscoveryEvents(body, 5);
  okIf("narrative 안 '발견했다' 1회 추출", evs.length === 1 && evs[0].raw_phrase.includes("발견했"));
  okIf("quote 안 '찾아야 해' / '남았어' false positive 차단",
    !evs.some(e => e.raw_phrase.includes("찾아야") || e.raw_phrase.includes("남았어")));
}

// A.2: discovery 이벤트 다중 매치 + 토큰화
{
  const body = `이상한 흔적을 발견했다. 잠시 후 새로운 흔적이 또 확인됐다. 적의 발자국을 감지했다.`;
  const evs = extractDiscoveryEvents(body, 7);
  okIf("3개 narrative 발견 동사 모두 추출", evs.length === 3);
  okIf("각 event의 tokens 한글 2~5자 추출됨",
    evs.every(e => Array.isArray(e.tokens) && e.tokens.length > 0));
}

// A.3: jaccard similarity
{
  const a = ["흔적", "발견", "리아", "마법진"];
  const b = ["흔적", "발견", "리아", "방패"];
  const sim = jaccardSim(a, b);
  okIf("jaccard 3/5 계산 (3 inter / 5 union = 0.6)", Math.abs(sim - 0.6) < 0.001);
}

// A.4: isDiscoveryDuplicate — 인접 ep + sim ≥ 0.6 catch
{
  const e1 = { episode: 5, raw_phrase: "이상한 흔적을 발견했다", tokens: ["이상한", "흔적", "발견"] };
  const e2 = { episode: 7, raw_phrase: "이상한 흔적이 또 발견됐다", tokens: ["이상한", "흔적", "발견"] };
  const r = isDiscoveryDuplicate(e2, [e1], { threshold: 0.6, window: 5 });
  okIf("동일 흔적 발견 → duplicate=true", r.duplicate === true && r.sim >= 0.6);
}

// A.5: isClosingSceneSimilar — ep54/55 같은 closing 잡음
{
  const ep54 = extractClosingScene(`...
"끝났어."
브론이 그녀의 곁에 섰다.
"응. 끝났어."
"이제 우리 차례야."
빅토리가 고개를 끄덕였다.
"응. 우리 차례."
"이제 원래 세계로 돌아갈 방법을 찾아야 해."
브론이 그녀 옆에 앉았다.
"함께 찾자."
"고마워, 브론."
그리고 그들은 새로운 여정을 시작했다.`, 54, 300);

  const ep55 = extractClosingScene(`...
"끝났네."
브론이 그녀 옆에 섰다.
"응. 끝났어."
"이제 우리 차례야."
빅토리가 고개를 들었다.
"그래. 우리 차례."
"원래 세계로 돌아갈 방법을 찾아야 해."
브론이 고개를 끄덕였다.
"함께 찾자."
"고마워, 브론."
그리고 그들은 새로운 여정을 시작했다.`, 55, 300);

  const r = isClosingSceneSimilar(ep55, ep54, { threshold: 0.45 });
  okIf("ep54↔ep55 closing scene similar (sim ≥ 0.45)", r.similar === true);
  console.log("    actual sim = " + r.sim.toFixed(3));
}

// A.6: 다른 closing은 false 반환
{
  const c1 = extractClosingScene(`...리아가 검을 들어 올렸다. "지금 가야 해." 그녀가 뛰었다.`, 10, 200);
  const c2 = extractClosingScene(`...빅토리가 책상에 앉았다. "오늘은 끝." 그녀가 잠들었다.`, 11, 200);
  const r = isClosingSceneSimilar(c2, c1, { threshold: 0.45 });
  okIf("다른 closing scene → similar=false", r.similar === false);
  console.log("    actual sim = " + r.sim.toFixed(3));
}

console.log("\n── [B] audit_duplicate_discovery_events.mjs R5B-3 통합 ──");
{
  const audit = readFileSync("scripts/audit_duplicate_discovery_events.mjs", "utf8");
  okIf("R5B-3 lib import",
    /from "\.\.\/dist\/lib\/discovery_signature\.js"/.test(audit) &&
    /extractDiscoveryEvents[\s\S]{0,80}extractClosingScene/.test(audit));
  okIf("[4] R5B-3 narrative-only discovery section",
    /\[4\] R5B-3 narrative-only discovery events/.test(audit));
  okIf("[5] R5B-3 closing scene repetition section",
    /\[5\] R5B-3 closing scene repetition/.test(audit));
  okIf("R5B-3 PASS criteria 출력",
    /R5B-3 PASS criteria/.test(audit) && /closing scene 반복 = 0/.test(audit));
  okIf("R5B-3 audit verdict (READY/CONDITIONAL)",
    /R5B-3 audit:.*READY|R5B-3 audit:.*CONDITIONAL/.test(audit));
}

console.log("\n── [C] planner.ts system prompt 보강 ──");
{
  const planner = readFileSync("src/pipeline/planner.ts", "utf8");
  okIf("★ R5B-3 발견·결말 반복 방지 section 존재",
    /★ R5B-3 발견·결말 반복 방지/.test(planner));
  okIf("이미 발견된 단서 → 해석·추적·대응·결과·결정 전환 안내",
    /이미 발견된 단서[\s\S]{0,100}해석.{0,5}추적.{0,5}대응.{0,5}결과.{0,5}결정/.test(planner));
  okIf("closing scene 반복 방지 안내",
    /closing scene[\s\S]{0,100}반복되지 않는다|결의 dialogue/.test(planner));
  okIf("cliché dialogue 1회 한정 안내",
    /다짐 dialogue[\s\S]{0,150}cliché[\s\S]{0,30}1회로 한정/.test(planner));
}

console.log("\n── [D] dist 산출물 ──");
okIf("dist/lib/discovery_signature.js", existsSync("dist/lib/discovery_signature.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
