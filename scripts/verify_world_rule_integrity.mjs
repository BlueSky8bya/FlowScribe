/**
 * verify_world_rule_integrity.mjs — Phase 4.19
 *
 * world_rule 흐름 정적 검증:
 *   1) /api/context POST가 world_configs/world_rules 테이블 동기화 코드를 가지고 있는가
 *   2) effective_context가 두 테이블 + books.context fallback 모두 다루는가
 *   3) planner의 [절대 규칙] 섹션이 의미 안내문(부정형/긍정형/전제) 포함하는가
 *   4) renderer가 absolute_forbidden을 직접 prompt에 주입하는가
 *   5) dist 빌드 산출물이 존재하는가
 */
import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const check = (s, c, d) => c ? ok(s) : ng(s, d);

const ctxApi = readFileSync("src/api/context.ts", "utf8");
const ec     = readFileSync("src/services/effective_context.ts", "utf8");
const planner = readFileSync("src/pipeline/planner.ts", "utf8");
const renderer = readFileSync("src/pipeline/renderer.ts", "utf8");

console.log("── [1] /api/context → world_configs/world_rules sync ──");
check("INSERT INTO world_configs (book_id ...) ON CONFLICT DO UPDATE", /INSERT INTO world_configs[\s\S]{0,200}ON CONFLICT/.test(ctxApi));
check("INSERT INTO world_rules (rule_type='general')", /INSERT INTO world_rules[\s\S]{0,120}'general'/.test(ctxApi));
check("INSERT INTO world_rules (rule_type='absolute_forbidden')", /'absolute_forbidden'/.test(ctxApi));
check("기존 world_rules row deactivate (재진입 시 idempotent)", /UPDATE world_rules SET is_active = false/.test(ctxApi));
check("'장르: ...' prefix를 world_configs.genre로 추출", ctxApi.includes("장르") && /extractedGenre/.test(ctxApi));

console.log("\n── [2] effective_context fallback ──");
check("worldConfigRow + story_config fallback for background", /background:\s*wConfigRow\?\.background\s*\|\|\s*_sc\?\.background/.test(ec));
check("worldConfigRow + story_config fallback for genre", /genre:\s*wConfigRow\?\.genre\s*\|\|\s*_sc\?\.genre/.test(ec));
check("legacyWorldBible.world_rules → generalRules push", /legacyWorldBible\.world_rules\?\.length\)\s*generalRules\.push/.test(ec));
check("legacyWorldBible.forbidden_settings → absoluteForbid push", /legacyWorldBible\.forbidden_settings\?\.length\)\s*absoluteForbid\.push/.test(ec));

console.log("\n── [3] planner [절대 규칙] 의미 안내 ──");
check("'[절대 규칙' 또는 '[절대 규칙 — 본문에서 반드시 준수' 섹션", /\[절대 규칙[\s—\-—]/.test(planner));
check("부정형/긍정형/전제 분기 안내문 존재", planner.includes("부정형") && planner.includes("긍정형") && planner.includes("전제"));
check("도입 전제 안내 (전이·각성·만남)", /도입.{0,20}\(전이|전이·각성/.test(planner));
check("ep1 분기 — 본문에서 명시적으로 그려지게", /1화 본문 안에서/.test(planner) || /이번 1화 본문 안에서/.test(planner));

console.log("\n── [4] renderer 절대 규칙 직접 주입 ──");
check("absoluteRulesSection 변수 정의", /absoluteRulesSection/.test(renderer));
check("'★ 절대 규칙' header 출력", /\[★ 절대 규칙/.test(renderer));
check("ctx.absolute_forbidden을 enumerate", /ctx\.absolute_forbidden\.map/.test(renderer));
check("system prompt 안에 absoluteRulesSection 삽입", /\$\{absoluteRulesSection\}/.test(renderer));

console.log("\n── [5] dist 빌드 산출물 ──");
check("dist/api/context.js", existsSync("dist/api/context.js"));
check("dist/services/effective_context.js", existsSync("dist/services/effective_context.js"));
check("dist/pipeline/planner.js", existsSync("dist/pipeline/planner.js"));
check("dist/pipeline/renderer.js", existsSync("dist/pipeline/renderer.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
