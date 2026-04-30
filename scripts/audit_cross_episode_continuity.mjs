/**
 * audit_cross_episode_continuity.mjs — Phase 4.11 cross-episode 일관성 감사
 *
 * 검사 대상:
 *   - ep_N → ep_N+1 위치 변경 시 transition phrase 존재 여부
 *   - ep_N에서 absent/미등장이던 인물이 ep_N+1에서 단정 행동
 *   - ep_N에서 소지하던 아이템이 ep_N+1에서 사라진 경우 (이미 audit_item에서 일부 처리)
 *
 * deterministic only — Gemini 미사용.
 *
 * Usage: node scripts/audit_cross_episode_continuity.mjs --book-id <uuid>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
if (!bookId) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 범용 transition phrase: 이동/등장/시간 경과/하강/상승/끌림 등
// 한국어 동사 활용형 커버: "들어가/들어갔/들어와/들어왔" 등을 포괄하기 위해 어간 단위로 매칭
const TRANSITION_RE = /(이동|향해|향하|걸어|걸었|걷는|걷던|들어[가갔간갈와왔]|나오[다았]|나와|나갔|나가|나섰|나서[고는며다]|복도|문을\s*열|계단|시간이\s*흘렀|얼마\s*후|잠시\s*후|마침내\s*도착|당도|내려[가갔간갈오왔]|내려섰|올라[가갔간갈오왔]|올라섰|떨어[졌져진]|굴러|추락|끌[려렸린]|잡[혀혔힌]|이끌[려렸]|기어|기다|뛰어|뛰었|달려|달렸|이르렀|진입|진[입출]|발을\s*들|발걸음|돌아[와왔])/;
const ABSENT_VIS = new Set(["absent", "cannot_act"]);

// 인물 이름 주변 transition 검사 — 본문에 인물 이름과 transition phrase가 함께 등장하는지
function hasTransitionForCharacter(body, charName) {
  // 인물 이름 등장 위치마다 ±200자 윈도우에서 transition phrase 검사
  let idx = 0;
  while ((idx = body.indexOf(charName, idx)) !== -1) {
    const window = body.slice(Math.max(0, idx - 150), idx + 250);
    if (TRANSITION_RE.test(window)) return true;
    idx += charName.length;
  }
  return false;
}

async function main() {
  const epRes = await pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
    [bookId]
  );
  const stRes = await pool.query(
    `SELECT episode_number, character_name, location, visibility_state, items
     FROM character_dynamic_states WHERE book_id=$1 ORDER BY episode_number, character_name`,
    [bookId]
  );
  await pool.end();

  if (epRes.rows.length < 2) {
    console.log("cross-episode 감사는 2화 이상 필요");
    process.exit(0);
  }

  const stateByEp = {};
  for (const r of stRes.rows) {
    if (!stateByEp[r.episode_number]) stateByEp[r.episode_number] = {};
    stateByEp[r.episode_number][r.character_name] = r;
  }

  const W = 70;
  console.log(`\n${"═".repeat(W)}`);
  console.log(` AUDIT — Cross-Episode Continuity (book: ${bookId.slice(0, 8)}...)`);
  console.log("═".repeat(W));

  let fatalLocationJump = 0;
  let fatalAbsentRevival = 0;
  const issues = [];

  for (let i = 1; i < epRes.rows.length; i++) {
    const prevEp = epRes.rows[i - 1];
    const currEp = epRes.rows[i];
    const prevSt = stateByEp[prevEp.episode_number] ?? {};
    const currSt = stateByEp[currEp.episode_number] ?? {};
    const currBody = currEp.content;

    const epIssues = [];

    for (const charName of Object.keys(currSt)) {
      const prev = prevSt[charName];
      const curr = currSt[charName];
      if (!prev || !curr) continue;

      // ── 위치 변경 검사 ──
      const prevLoc = (prev.location ?? "").trim();
      const currLoc = (curr.location ?? "").trim();
      if (prevLoc && currLoc && prevLoc !== currLoc &&
          prevLoc !== "미등장" && currLoc !== "미등장" &&
          prevLoc !== "위치 불명" && currLoc !== "위치 불명") {
        // 같은 zone 판정: 공통 토큰 (한국어 명사 ≥ 2자)이 있으면 same zone
        // 예: "도시 외곽, 독소 구역" vs "독소 구역" → 공통 "독소", "구역" → same
        const tokenize = s => s.replace(/[,()（）\-]/g, " ")
          .split(/\s+/).filter(t => t.length >= 2);
        const prevTokens = new Set(tokenize(prevLoc));
        const currTokens = new Set(tokenize(currLoc));
        const common = [...prevTokens].filter(t => currTokens.has(t));
        const sameZone = common.length > 0;
        if (!sameZone) {
          // 본문에 인물 이름 주변 transition phrase가 있는지 확인 (per-character check)
          if (!hasTransitionForCharacter(currBody, charName)) {
            epIssues.push({
              type: "location_jump",
              char: charName,
              from: prevLoc,
              to: currLoc,
              detail: `${charName} 주변 transition phrase 없음`,
            });
            fatalLocationJump++;
          }
        }
      }

      // ── visibility 부활 검사 ──
      const prevVis = prev.visibility_state ?? "present";
      const currVis = curr.visibility_state ?? "present";
      if (ABSENT_VIS.has(prevVis) && !ABSENT_VIS.has(currVis)) {
        // 본문에 인물 이름이 등장하는지 + 등장 계기가 있는지 (간단히 이름만 등장하면 OK처리)
        if (currBody.includes(charName)) {
          // 등장 bridge 단서: "도착", "합류", "나타났", "들이닥쳤", "그제야", "마침내"
          const revivalRe = /(도착|합류|나타났|등장|들이닥쳤|마침내|그제야|돌아왔)/;
          if (!revivalRe.test(currBody)) {
            epIssues.push({
              type: "absent_revival",
              char: charName,
              detail: `prev visibility=${prevVis} → curr=${currVis}, 등장 bridge 없음`,
            });
            fatalAbsentRevival++;
          }
        }
      }
    }

    if (epIssues.length) {
      issues.push({ ep_pair: `${prevEp.episode_number}→${currEp.episode_number}`, items: epIssues });
      console.log(`\n🔴 ep${prevEp.episode_number}→ep${currEp.episode_number}: ${epIssues.length}건`);
      for (const it of epIssues.slice(0, 5)) {
        if (it.type === "location_jump") {
          console.log(`   [${it.type}] ${it.char}: ${it.from} → ${it.to} (${it.detail})`);
        } else {
          console.log(`   [${it.type}] ${it.char}: ${it.detail}`);
        }
      }
    } else {
      console.log(`\n✅ ep${prevEp.episode_number}→ep${currEp.episode_number}: 위반 없음`);
    }
  }

  console.log(`\n${"─".repeat(W)}`);
  console.log(`location_jump_fatal: ${fatalLocationJump}건 | absent_revival_fatal: ${fatalAbsentRevival}건`);
  const totalFatal = fatalLocationJump + fatalAbsentRevival;
  if (totalFatal === 0) {
    console.log("✅ CROSS-EPISODE CONTINUITY: PASS");
    process.exit(0);
  } else {
    console.error("❌ CROSS-EPISODE CONTINUITY: FAIL");
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
