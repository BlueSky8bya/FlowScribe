/**
 * verify_story_config_reset.mjs — POST-S13.5 fix
 *
 * 책 전환 / 새 책 생성 / context 404 시 storyConfig가 직전 책의 stale 값을 들고 있지 않도록
 * config.js의 STORY_CONFIG_DEFAULTS + auth.js의 clearWorldSettingsUI 정합성 + 호출 path를 정적 verify.
 *
 * 핵심 검증:
 *   1. STORY_CONFIG_DEFAULTS 상수가 config.js에 정의되어 있고, genre/mood 키 명시.
 *   2. emotion/conflict/dialogue/direction/foreshadow 기본값 = 5.
 *   3. episodeLength=2000, episodeLengthVar=500, totalEpisodes=30, totalEpisodesVar=5.
 *   4. storyConfig가 STORY_CONFIG_DEFAULTS spread로 초기화.
 *   5. clearWorldSettingsUI가 storyConfig 모든 키를 delete 후 STORY_CONFIG_DEFAULTS로 reset.
 *   6. clearWorldSettingsUI에 hardcoded reset 객체(emotion:3 등) 잔존 안 함.
 *   7. selectBook → _restoreContextSafely → clearWorldSettingsUI() 호출 path 존재.
 *   8. saveContext가 storyConfig 모듈 전역을 그대로 보냄 (reset이 보장된 상태에서만 stale 차단).
 *   9. resolved_final_episode를 임의 null로 처리하는 코드 없음 (정상 정책 유지).
 *  10. STORY_CONFIG_DEFAULTS가 Object.freeze로 보호.
 */

import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const check = (s, c, d) => c ? ok(s) : ng(s, d);

const configJs = readFileSync("public/js/config.js", "utf8");
const authJs   = readFileSync("public/js/auth.js",   "utf8");
const modalJs  = readFileSync("public/js/modal.js",  "utf8");

// brace-match로 STORY_CONFIG_DEFAULTS 객체 본문 추출
function extractFrozenObject(src, anchor) {
  const idx = src.indexOf(anchor);
  if (idx < 0) return "";
  const open = src.indexOf("{", idx);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

function extractFunctionBody(src, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return "";
  const open = src.indexOf("{", m.index + m[0].length);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

console.log("── [1] STORY_CONFIG_DEFAULTS 상수 정의 ──");
const defaultsBody = extractFrozenObject(configJs, "STORY_CONFIG_DEFAULTS");
check(
  "STORY_CONFIG_DEFAULTS 상수 정의 존재",
  /const\s+STORY_CONFIG_DEFAULTS\s*=\s*Object\.freeze\s*\(/.test(configJs)
);
check("Object.freeze로 보호됨", /Object\.freeze\s*\(\s*\{[\s\S]*?\}\s*\)/.test(configJs));
check("genre 키 명시 (빈 문자열 default)", /\bgenre\s*:\s*["']["']/.test(defaultsBody));
check("mood 키 명시 (빈 문자열 default)", /\bmood\s*:\s*["']["']/.test(defaultsBody));
check("pov: \"3인칭 관찰자\"",      /pov\s*:\s*["']3인칭 관찰자["']/.test(defaultsBody));
check("style: \"균형\"",              /style\s*:\s*["']균형["']/.test(defaultsBody));

console.log("\n── [2] 슬라이더/길이 기본값 ──");
check("emotion: 5",     /\bemotion\s*:\s*5\b/.test(defaultsBody));
check("conflict: 5",    /\bconflict\s*:\s*5\b/.test(defaultsBody));
check("dialogue: 5",    /\bdialogue\s*:\s*5\b/.test(defaultsBody));
check("direction: 5",   /\bdirection\s*:\s*5\b/.test(defaultsBody));
check("foreshadow: 5",  /\bforeshadow\s*:\s*5\b/.test(defaultsBody));
check("episodeLength: 2000",     /episodeLength\s*:\s*2000\b/.test(defaultsBody));
check("episodeLengthVar: 500",   /episodeLengthVar\s*:\s*500\b/.test(defaultsBody));
check("totalEpisodes: 30",       /totalEpisodes\s*:\s*30\b/.test(defaultsBody));
check("totalEpisodesVar: 5",     /totalEpisodesVar\s*:\s*5\b/.test(defaultsBody));

console.log("\n── [3] storyConfig 초기화 ──");
check(
  "storyConfig가 STORY_CONFIG_DEFAULTS spread로 초기화",
  /const\s+storyConfig\s*=\s*\{\s*\.\.\.STORY_CONFIG_DEFAULTS\s*\}/.test(configJs)
);

console.log("\n── [4] clearWorldSettingsUI reset 정책 ──");
const cwBody = extractFunctionBody(authJs, "clearWorldSettingsUI");
check(
  "clearWorldSettingsUI: 모든 키 delete 후 reset (stale 키 차단)",
  /for\s*\(\s*const\s+\w+\s+of\s+Object\.keys\s*\(\s*storyConfig\s*\)\s*\)\s*delete\s+storyConfig\[/.test(cwBody)
);
check(
  "clearWorldSettingsUI: STORY_CONFIG_DEFAULTS로 갈아끼움",
  /Object\.assign\s*\(\s*storyConfig\s*,\s*STORY_CONFIG_DEFAULTS\s*\)/.test(cwBody)
);
check(
  "hardcoded reset 객체(emotion:3 등) 제거",
  !/conflict\s*:\s*3\s*,\s*foreshadow\s*:\s*3/.test(cwBody)
);
check(
  "슬라이더 % 계산 — STORY_CONFIG_DEFAULTS와 동기 (5 → 44.4%)",
  /\(\s*storyConfig\[key\]\s*-\s*1\s*\)\s*\/\s*9\s*\*\s*100/.test(cwBody)
);
check(
  "고정 % \"22.2%\" 잔존 안 함 (옛 default=3 흔적)",
  !/setProperty\s*\(\s*["']--pct["']\s*,\s*["']22\.2%["']\s*\)/.test(cwBody)
);

console.log("\n── [5] selectBook → clearWorldSettingsUI 호출 path ──");
check(
  "_restoreContextSafely 함수가 clearWorldSettingsUI를 첫 단계에서 호출",
  /async\s+function\s+_restoreContextSafely[\s\S]{0,200}clearWorldSettingsUI\s*\(\s*\)/.test(authJs)
);
check(
  "selectBook이 _restoreContextSafely(book.id)를 호출",
  /async\s+function\s+selectBook[\s\S]{0,3000}_restoreContextSafely\s*\(\s*book\.id\s*\)/.test(authJs)
);

console.log("\n── [6] context 404 시 restoreContextUI 미호출 ──");
const restoreCtxBody = extractFunctionBody(authJs, "_restoreContextSafely");
check(
  "fetch /api/context 응답 res.ok일 때만 restoreContextUI 호출",
  /if\s*\(\s*res\.ok\s*\)\s*\{[\s\S]{0,200}restoreContextUI\s*\(/.test(restoreCtxBody)
);

console.log("\n── [7] saveContext payload ──");
check(
  "modal.js saveContext가 storyConfig 모듈 전역을 그대로 전송 (reset이 보장된 상태에서 stale 차단됨)",
  /storyConfig\s*:\s*_storyConfig/.test(modalJs)
);
check(
  "_storyConfig 참조가 모듈 전역 storyConfig",
  /const\s+_storyConfig\s*=\s*typeof\s+storyConfig\s*!==\s*["']undefined["']\s*\?\s*storyConfig\s*:/.test(modalJs)
);

console.log("\n── [8] resolved_final_episode 정책 유지 ──");
check(
  "auth.js: resolved_final_episode를 임의 null 처리하는 코드 없음",
  !/storyConfig\.resolved_final_episode\s*=\s*null/.test(authJs)
);
check(
  "modal.js: resolved_final_episode를 임의 null 처리하는 코드 없음",
  !/storyConfig\.resolved_final_episode\s*=\s*null/.test(modalJs)
);
check(
  "config.js: STORY_CONFIG_DEFAULTS에 resolved_final_episode 강제 포함 안 함 (서버 자동 계산)",
  !/resolved_final_episode\s*:/.test(defaultsBody)
);

console.log("\n── [9] 산출물 ──");
check("public/js/config.js exists", existsSync("public/js/config.js"));
check("public/js/auth.js exists",   existsSync("public/js/auth.js"));
check("public/js/modal.js exists",  existsSync("public/js/modal.js"));

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅ ALL PASSED" : `❌ ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
