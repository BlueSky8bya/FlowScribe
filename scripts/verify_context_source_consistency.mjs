/**
 * verify_context_source_consistency.mjs — POST-S13.5 P0 정적 verify
 *
 * saveContext API와 repair script가 같은 sync helper(syncWorldContext)를 사용해
 * books.context / world_configs / world_rules / Redis 4중 source가 한 곳에서 갱신됨을 정적 검증.
 *
 * 핵심:
 *   1. src/services/world_context_sync.ts 존재 + syncWorldContext export
 *   2. src/api/context.ts가 syncWorldContext를 import 후 호출
 *   3. src/api/context.ts에 직접 INSERT/UPDATE world_configs/world_rules 잔존 안 함
 *      (helper 외부에서 별도 sync하면 drift 발생)
 *   4. scripts/repair_r7_story_config.mjs가 dist에서 syncWorldContext import
 *   5. scripts/repair_r7_story_config.mjs에 직접 INSERT/UPDATE world_configs/world_rules 잔존 안 함
 *   6. helper가 books.context UPDATE + world_configs upsert + world_rules deactivate/insert + Redis SET 4구간 모두 포함
 *   7. helper가 단일 트랜잭션 (BEGIN/COMMIT/ROLLBACK)
 *   8. config.js의 STORY_CONFIG_DEFAULTS와 auth.js clearWorldSettingsUI 정합성 (POST-S13.5 1차 fix 회귀 방지)
 */

import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const check = (s, c, d) => c ? ok(s) : ng(s, d);

const helperPath = "src/services/world_context_sync.ts";
const apiPath    = "src/api/context.ts";
const repairPath = "scripts/repair_r7_story_config.mjs";
const configJs   = "public/js/config.js";
const authJs     = "public/js/auth.js";

console.log("── [1] helper 존재 + export ──");
check("src/services/world_context_sync.ts exists", existsSync(helperPath));
const helper = existsSync(helperPath) ? readFileSync(helperPath, "utf8") : "";
check(
  "syncWorldContext export 존재",
  /export\s+async\s+function\s+syncWorldContext\s*\(/.test(helper)
);
check(
  "WorldContextPayload interface export",
  /export\s+interface\s+WorldContextPayload/.test(helper)
);

console.log("\n── [2] helper 4구간 모두 포함 ──");
check(
  "books.context UPDATE 포함",
  /UPDATE\s+books\s+SET\s+context/.test(helper)
);
check(
  "world_configs upsert 포함",
  /INSERT\s+INTO\s+world_configs[\s\S]*?ON\s+CONFLICT\s*\(\s*book_id\s*\)\s+DO\s+UPDATE/i.test(helper)
);
check(
  "world_rules deactivate (is_active = false) 포함",
  /UPDATE\s+world_rules\s+SET\s+is_active\s*=\s*false/.test(helper)
);
check(
  "world_rules INSERT general + absolute_forbidden 포함",
  /INSERT\s+INTO\s+world_rules[\s\S]*?'general'/.test(helper) &&
  /INSERT\s+INTO\s+world_rules[\s\S]*?'absolute_forbidden'/.test(helper)
);
check(
  "Redis SET context:${book_id} 포함",
  /redis\.set\s*\(\s*`context:\$\{book_id\}`/.test(helper)
);
check(
  "Redis TTL 7일 (60*60*24*7)",
  /60\s*\*\s*60\s*\*\s*24\s*\*\s*7/.test(helper)
);

console.log("\n── [3] helper 단일 트랜잭션 ──");
check("BEGIN 호출",   /client\.query\s*\(\s*["']BEGIN["']\s*\)/.test(helper));
check("COMMIT 호출",  /client\.query\s*\(\s*["']COMMIT["']\s*\)/.test(helper));
check("ROLLBACK 처리", /client\.query\s*\(\s*["']ROLLBACK["']\s*\)/.test(helper));
check("client.release() 호출", /client\.release\s*\(\s*\)/.test(helper));

console.log("\n── [4] api/context.ts helper 사용 ──");
const api = existsSync(apiPath) ? readFileSync(apiPath, "utf8") : "";
check(
  "syncWorldContext import",
  /import\s*\{[^}]*\bsyncWorldContext\b[^}]*\}\s*from\s*["'][^"']*world_context_sync[^"']*["']/.test(api)
);
check(
  "syncWorldContext 호출",
  /\bsyncWorldContext\s*\(/.test(api)
);
check(
  "직접 INSERT INTO world_configs 잔존 안 함 (helper에 위임)",
  !/INSERT\s+INTO\s+world_configs/i.test(api)
);
check(
  "직접 INSERT INTO world_rules 잔존 안 함",
  !/INSERT\s+INTO\s+world_rules/i.test(api)
);
check(
  "직접 UPDATE world_rules SET is_active 잔존 안 함",
  !/UPDATE\s+world_rules\s+SET\s+is_active/i.test(api)
);
check(
  "직접 UPDATE books SET context 잔존 안 함 (helper 위임)",
  !/UPDATE\s+books\s+SET\s+context\s*=\s*\$1::jsonb/i.test(api)
);

console.log("\n── [5] repair_r7_story_config helper 사용 ──");
const repair = existsSync(repairPath) ? readFileSync(repairPath, "utf8") : "";
check(
  "dist/services/world_context_sync.js import",
  /import\s*\([\s\S]*?dist\/services\/world_context_sync\.js[\s\S]*?\)/.test(repair) ||
  /from\s*["'][^"']*dist\/services\/world_context_sync\.js["']/.test(repair)
);
check(
  "syncWorldContext 호출",
  /syncWorldContext\s*\(/.test(repair)
);
check(
  "직접 INSERT INTO world_configs 잔존 안 함",
  !/INSERT\s+INTO\s+world_configs/i.test(repair)
);
check(
  "직접 INSERT INTO world_rules 잔존 안 함",
  !/INSERT\s+INTO\s+world_rules/i.test(repair)
);
check(
  "직접 UPDATE books SET context jsonb 잔존 안 함 (helper 위임)",
  !/UPDATE\s+books\s+SET\s+context\s*=\s*\$1::jsonb/i.test(repair)
);

console.log("\n── [6] R7 가드 + dry-run 기본 ──");
check(
  "EXPECTED_TITLE = R7_회색지대_생존기_CANARY",
  /EXPECTED_TITLE\s*=\s*"R7_회색지대_생존기_CANARY"/.test(repair)
);
check(
  "title 정확 일치 검증",
  /book\.title\s*!==\s*EXPECTED_TITLE/.test(repair)
);
check(
  "DRY-RUN 기본 (APPLY false면 종료)",
  /if\s*\(\s*!APPLY\s*\)\s*\{[\s\S]{0,400}return;\s*\}/.test(repair)
);
check(
  "TARGET_STORY_CONFIG에 resolved_final_episode 부재 (보존)",
  !/TARGET_STORY_CONFIG[\s\S]{0,400}resolved_final_episode/.test(repair)
);

console.log("\n── [7] config.js + auth.js 정합성 (POST-S13.5 1차 fix 회귀 방지) ──");
const config = existsSync(configJs) ? readFileSync(configJs, "utf8") : "";
const auth   = existsSync(authJs)   ? readFileSync(authJs,   "utf8") : "";
check(
  "STORY_CONFIG_DEFAULTS Object.freeze 정의",
  /const\s+STORY_CONFIG_DEFAULTS\s*=\s*Object\.freeze\s*\(/.test(config)
);
check(
  "STORY_CONFIG_DEFAULTS에 genre/mood 키 명시",
  /\bgenre\s*:\s*["']["']/.test(config) && /\bmood\s*:\s*["']["']/.test(config)
);
check(
  "clearWorldSettingsUI: 모든 키 delete 후 STORY_CONFIG_DEFAULTS reset",
  /for\s*\(\s*const\s+\w+\s+of\s+Object\.keys\s*\(\s*storyConfig\s*\)\s*\)\s*delete\s+storyConfig\[/.test(auth) &&
  /Object\.assign\s*\(\s*storyConfig\s*,\s*STORY_CONFIG_DEFAULTS\s*\)/.test(auth)
);
check(
  "auth.js에 hardcoded reset 객체(emotion:3 등) 잔존 안 함",
  !/conflict\s*:\s*3\s*,\s*foreshadow\s*:\s*3/.test(auth)
);

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
