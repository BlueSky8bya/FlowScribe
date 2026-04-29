/**
 * run_longrun_v5.mjs — Phase 2~4 통합 검증 30화 실제 생성
 *
 * 사용법:
 *   node scripts/run_longrun_v5.mjs               # 30화 전체
 *   node scripts/run_longrun_v5.mjs --episodes 10  # 일부
 *   node scripts/run_longrun_v5.mjs --from 11 --to 20  # 구간
 */

import pg from "pg";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BOOK_ID = "test_longrun_v5";
const BASE_URL = "http://localhost:3000";

const args = process.argv.slice(2);
const epArg   = args.indexOf("--episodes");
const fromArg = args.indexOf("--from");
const toArg   = args.indexOf("--to");

const FROM_EP = fromArg !== -1 ? parseInt(args[fromArg + 1]) : 1;
const TO_EP   = toArg   !== -1 ? parseInt(args[toArg + 1])   :
                epArg   !== -1 ? parseInt(args[epArg + 1])   : 30;

async function generateEpisode(episode) {
  const res = await fetch(`${BASE_URL}/api/generate-v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      book_id: BOOK_ID,
      episode,
      use_planner: true,
      validate: true,
      revise: true,
      enable_trace: true,
      gen_config: {
        totalEpisodes: 30,
        pov: "3인칭 관찰자",
        style: "묘사풍부",
        episodeLength: 1000,
        episodeLengthVar: 200,
        conflict: 8,
        foreshadow: 8,
        emotion: 8,
        dialogue: 7,
        direction: 9,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().then(t => t.slice(0, 300));
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let charCount = 0;
  let buf = "";
  let lastMeta = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const obj = JSON.parse(line.slice(6));
        if (obj.error) throw new Error(obj.error);
        if (obj.done) { charCount = obj.chars ?? 0; lastMeta = obj; }
      } catch {}
    }
  }

  return { charCount, meta: lastMeta };
}

async function getDynamicStates(episode) {
  const res = await pool.query(
    `SELECT character_name, items, location, emotional_state, recent_goal
     FROM character_dynamic_states WHERE book_id=$1 AND episode_number=$2
     ORDER BY character_name`,
    [BOOK_ID, episode]
  );
  return res.rows;
}

async function getCanonicals() {
  const res = await pool.query(
    "SELECT name, initial_items FROM canonical_characters WHERE book_id=$1 ORDER BY name",
    [BOOK_ID]
  );
  const map = {};
  for (const r of res.rows) {
    const items = Array.isArray(r.initial_items) ? r.initial_items
      : (typeof r.initial_items === "string" ? JSON.parse(r.initial_items) : []);
    map[r.name] = items;
  }
  return map;
}

const SKILL_KEYWORDS = ["스킬", "능력", "특성", "패시브", "Lv.", "레벨", "skill", "ability", "passive"];
function isSkillLike(name) {
  if (!name) return false;
  return SKILL_KEYWORDS.some(k => name.includes(k)) ||
    /고유\s*(스킬|능력|특성)/.test(name) ||
    /[가-힣]+\s*(스킬|능력|이능|기술)$/.test(name);
}

async function main() {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`Phase 2~4 통합 검증 — 30화 실제 생성`);
  console.log(`book_id: ${BOOK_ID}  (ep${FROM_EP} → ep${TO_EP})`);
  console.log(`${"═".repeat(70)}`);

  const canonMap = await getCanonicals();
  const canonNames = Object.keys(canonMap);
  console.log(`\ncanonical: [${canonNames.join(", ")}]`);

  let totalSkill = 0, totalEnglish = 0, totalMissing = 0, totalRowsMissing = 0;
  let errors = 0;
  const results = [];

  for (let ep = FROM_EP; ep <= TO_EP; ep++) {
    process.stdout.write(`\n[ep${ep.toString().padStart(2, "0")}] 생성 중...`);
    const t0 = Date.now();

    try {
      const { charCount } = await generateEpisode(ep);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const states = await getDynamicStates(ep);

      const presentNames = new Set(states.map(s => s.character_name));
      const missingNames = canonNames.filter(n => !presentNames.has(n));
      if (missingNames.length) totalRowsMissing += missingNames.length;

      let epSkill = 0, epEnglish = 0, epMissing = missingNames.length;
      const issues = [];

      for (const s of states) {
        const items = Array.isArray(s.items) ? s.items
          : (typeof s.items === "string" ? JSON.parse(s.items || "[]") : []);
        for (const item of items) {
          const name = typeof item === "string" ? item : item?.name ?? "";
          if (isSkillLike(name)) { epSkill++; issues.push(`skill:"${name}"`); }
        }
        if (s.emotional_state && /^[a-zA-Z]/.test(s.emotional_state)) {
          epEnglish++; issues.push(`eng-state:"${s.emotional_state.slice(0, 20)}"`);
        }
        if (s.recent_goal && /^[a-zA-Z]/.test(s.recent_goal)) {
          epEnglish++; issues.push(`eng-goal:"${s.recent_goal.slice(0, 20)}"`);
        }
      }

      totalSkill   += epSkill;
      totalEnglish += epEnglish;
      totalMissing += epMissing;

      const ok  = epSkill === 0 && epEnglish === 0 && epMissing === 0;
      const tag = ok ? "✅" : (epSkill > 0 || epEnglish > 0 ? "❌" : "⚠️");
      console.log(` ${tag} rows=${states.length} — ${charCount}자, ${elapsed}s`);
      if (missingNames.length) console.log(`   missing rows: [${missingNames.join(", ")}]`);
      if (issues.length)       console.log(`   issues: ${issues.slice(0, 5).join(" | ")}`);

      results.push({ ep, ok, epSkill, epEnglish, epMissing, rows: states.length, charCount });
    } catch (e) {
      console.log(` ❌ ERROR: ${e.message}`);
      results.push({ ep, error: e.message });
      errors++;
    }
  }

  const generated = TO_EP - FROM_EP + 1;
  const passed    = results.filter(r => r.ok).length;

  console.log(`\n${"═".repeat(70)}`);
  console.log("SUMMARY");
  console.log(`${"─".repeat(70)}`);
  console.log(`생성 완료:               ${generated - errors}/${generated}화`);
  console.log(`episode PASS:            ${passed}/${generated - errors}화`);
  console.log(`skill-like items:        ${totalSkill}   ${totalSkill   === 0 ? "✅" : "❌"}`);
  console.log(`English state/goal:      ${totalEnglish}   ${totalEnglish === 0 ? "✅" : "❌"}`);
  console.log(`missing dynamic rows:    ${totalRowsMissing}   ${totalRowsMissing === 0 ? "✅" : "⚠️"}`);
  console.log(`generation errors:       ${errors}   ${errors === 0 ? "✅" : "❌"}`);

  const pass = errors === 0 && totalSkill === 0 && totalEnglish === 0;
  console.log(`\n${"─".repeat(70)}`);
  console.log(pass
    ? "✅  LONGRUN V5 GENERATION PASS"
    : "⚠️   LONGRUN V5 GENERATION CONDITIONAL — 감사 스크립트로 상세 확인"
  );
  console.log(`book_id: ${BOOK_ID}`);
  console.log(`${"═".repeat(70)}\n`);

  await pool.end();
  process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
