/**
 * verify_prev_episode_titles_propagation.mjs
 *
 * 이전 화 제목 contract가 EffectiveContext → renderer prompt로 전달되어
 * 동일·유사 제목 재사용을 LLM이 회피할 수 있는 정보 경로가 갖춰졌는지 정적 검증.
 *
 * 검증 항목:
 *   1. EffectiveContext 타입에 prev_episode_titles 필드 존재
 *   2. effective_context.ts가 episodes 테이블에서 최근 N화 제목을 추출하는 쿼리/추출 로직 보유
 *   3. effective_context.ts가 ctx 반환 객체에 prev_episode_titles 채워서 반환
 *   4. renderer.ts 프롬프트가 prev_episode_titles 섹션을 포함
 *   5. renderer.ts 출력 규칙 라인이 이전 제목 회피를 명시
 *   6. dist 산출물 빌드됨
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

const canonical = readFileSync("src/types/canonical.ts", "utf8");
const effective = readFileSync("src/services/effective_context.ts", "utf8");
const renderer  = readFileSync("src/pipeline/renderer.ts", "utf8");

console.log("── [Type] EffectiveContext.prev_episode_titles ──");
okIf(
  "prev_episode_titles?: string[] 필드 정의",
  /prev_episode_titles\?\s*:\s*string\[\]/.test(canonical)
);

console.log("\n── [Service] effective_context.ts 추출 로직 ──");
okIf(
  "최근 화 제목 쿼리 (episodes content head)",
  /SELECT[\s\S]{0,200}episode_number[\s\S]{0,200}content[\s\S]{0,200}episodes[\s\S]{0,200}episode_number\s*<\s*\$2[\s\S]{0,200}LIMIT/m.test(effective)
);
okIf(
  "TITLE_LINE 정규식으로 첫 줄 추출",
  /_TITLE_LINE_RE\s*=\s*\/\^#/.test(effective)
);
okIf(
  "ctx 반환 객체에 prev_episode_titles 키 포함",
  /prev_episode_titles:\s*prevEpisodeTitles/.test(effective)
);

console.log("\n── [Renderer] prompt 섹션 ──");
okIf(
  "prevTitlesSection 변수 정의",
  /prevTitlesSection\s*=/.test(renderer)
);
okIf(
  "ctx.prev_episode_titles 참조",
  /ctx\.prev_episode_titles/.test(renderer)
);
okIf(
  "[이전 화 제목 — ... 재사용·유사 변형 금지] 헤더",
  /이전 화 제목 — 이번 화 제목으로 재사용·유사 변형 금지/.test(renderer)
);
okIf(
  "prompt template에 ${prevTitlesSection} 삽입",
  /\$\{prevTitlesSection\}/.test(renderer)
);
okIf(
  "출력 규칙 라인이 이전 제목 회피 명시",
  /\[이전 화 제목\][\s\S]{0,80}동일·유사 금지/.test(renderer)
);

console.log("\n── [Build] dist 산출물 ──");
okIf("dist/services/effective_context.js", existsSync("dist/services/effective_context.js"));
okIf("dist/pipeline/renderer.js", existsSync("dist/pipeline/renderer.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
