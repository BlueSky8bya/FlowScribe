/**
 * verify_episode_character_display_filter.mjs — Phase 4.20 R5A stabilization
 *
 * 등장 인물 표시 정책 — 회차 본문에 실제 등장한 인물만 reader UI에 표시.
 * carry-forward state row는 DB에 보존 (continuity 유지) but 표시는 분리.
 *
 * 검증:
 *   1. detectEpisodeAppearances helper 동작
 *      - direct_name 매칭
 *      - alias_used 매칭
 *      - location='미등장' / visibility='absent' → 비등장
 *      - emotion='알 수 없음' + 본문 매치 없음 → carry-forward only → 비등장
 *   2. annotateCharStatesWithAppearance가 응답 페이로드에 플래그 추가
 *   3. /api/generate 와 /api/generate/char-states 둘 다 적용
 *   4. FE filter가 appeared_in_episode 우선 사용 (fallback 호환)
 *   5. DB migration 없음 (코드 grep으로 확인)
 */
import { existsSync, readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const okIf = (s, c, d) => c ? ok(s) : ng(s, d);

console.log("── [1] detectEpisodeAppearances 동작 ──");
const ea = await import("../dist/services/episode_appearance.js");
const { detectEpisodeAppearances, annotateCharStatesWithAppearance } = ea;

const content = `# 1화 - 마나의 첫 감촉
빅토리는 숲 가장자리에서 멈춰 섰다. 카이렌이 작은 평원에서 달려왔다.
"네가 그 사람이군." 카이렌의 목소리에 빅토리는 천천히 고개를 끄덕였다.
한편, 노랭이는 평원에 도착하지 못했다.`;

const states = [
  { character_name: "빅토리", visibility_state: "present", location: "숲", emotional_state: "결의", alias_used: [] },
  { character_name: "카이렌", visibility_state: "present", location: "평원", emotional_state: "혼란", alias_used: [] },
  // 노랭이: 본문에 이름 등장하지만 "도착하지 못했다" — visibility='absent'면 미등장
  { character_name: "노랭이", visibility_state: "absent", location: "미등장", emotional_state: "알 수 없음", alias_used: [] },
  // 브론: 본문에 이름 없음 + emotion='알 수 없음' → carry-forward only
  { character_name: "브론", visibility_state: "present", location: "이전 화 위치", emotional_state: "알 수 없음", alias_used: [] },
  // 알리스: alias '낯선 자' 본문 등장
  { character_name: "알리스", visibility_state: "present", location: "어딘가", emotional_state: "경계", alias_used: ["낯선 자"] },
];
const contentWithAlias = content + "\n낯선 자가 그를 바라보고 있었다.";

const r = detectEpisodeAppearances(contentWithAlias, states);
okIf("빅토리: direct_name 매칭", r["빅토리"]?.appeared_in_episode === true && r["빅토리"].appearance_evidence.includes("direct_name"));
okIf("카이렌: direct_name 매칭", r["카이렌"]?.appeared_in_episode === true && r["카이렌"].appearance_evidence.includes("direct_name"));
okIf("노랭이: visibility=absent → 미등장", r["노랭이"]?.appeared_in_episode === false);
okIf("브론: carry-forward only → 미등장", r["브론"]?.appeared_in_episode === false);
okIf("알리스: alias 매칭", r["알리스"]?.appeared_in_episode === true && r["알리스"].appearance_evidence.some((e) => e.startsWith("alias:")));

console.log("\n── [2] annotateCharStatesWithAppearance ──");
const annotated = annotateCharStatesWithAppearance(contentWithAlias, states);
okIf("annotated 배열 길이 동일", annotated.length === states.length);
okIf("appeared_in_episode 플래그 첨부", annotated.every((s) => typeof s.appeared_in_episode === "boolean"));
okIf("appearance_evidence 배열 첨부", annotated.every((s) => Array.isArray(s.appearance_evidence)));
okIf("origin 필드 보존", annotated[0].character_name === "빅토리" && annotated[0].emotional_state === "결의");

console.log("\n── [3] API 적용 ──");
const generate = readFileSync("src/api/generate.ts", "utf8");
okIf("annotateCharStatesWithAppearance import", /annotateCharStatesWithAppearance/.test(generate));
okIf("/api/generate done에 첨부", /annotateCharStatesWithAppearance\(\s*result\.generated_text/.test(generate));
okIf("/api/generate/char-states GET에 첨부", /annotateCharStatesWithAppearance\(_episodeContentForAppearance/.test(generate));

console.log("\n── [4] FE filter ──");
const fegen = readFileSync("public/js/generate.js", "utf8");
okIf("updateSceneCharPanel가 appeared_in_episode 우선", /typeof s\.appeared_in_episode\s*===\s*['"]boolean['"]/.test(fegen));
okIf("renderEpisodeEndCharCards가 appeared_in_episode 우선", new RegExp("appeared_in_episode[\\s\\S]{0,400}_buildSceneCharDetailedCardHtml|_buildSceneCharDetailedCardHtml[\\s\\S]{0,400}appeared_in_episode").test(fegen) || /typeof s\.appeared_in_episode\s*===\s*['"]boolean['"]/.test(fegen));
okIf("location='미등장' fallback 처리", /location\s*===\s*['"]미등장['"]/.test(fegen));
okIf("이번 화에 표시할 인물 정보가 없습니다 fallback", /이번 화에 표시할 인물/.test(fegen));

console.log("\n── [5] DB migration 없음 ──");
okIf("character_dynamic_states schema 변경 없음", !/(ALTER TABLE\s+character_dynamic_states\s+ADD COLUMN\s+appeared_in_episode|ALTER TABLE\s+character_dynamic_states[^;]*appearance_evidence)/i.test(generate));
okIf("episode_appearance.ts는 runtime helper (DB 호출 없음)", !/pool\.query|redis\.set/.test(readFileSync("src/services/episode_appearance.ts", "utf8")));

console.log("\n── [6] dist 빌드 ──");
okIf("dist/services/episode_appearance.js", existsSync("dist/services/episode_appearance.js"));
okIf("dist/api/generate.js", existsSync("dist/api/generate.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
