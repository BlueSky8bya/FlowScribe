/**
 * run_item_smoke_4.mjs — Phase 4 Item Ledger runtime smoke
 *
 * 사용법: node scripts/run_item_smoke_4.mjs [--episodes N]
 */

import pg from "pg";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BOOK_ID = "test_item_smoke_4";
const BASE_URL = "http://localhost:3000";

const args = process.argv.slice(2);
const epCountArg = args.indexOf("--episodes");
const TARGET_EPISODES = epCountArg !== -1 ? parseInt(args[epCountArg + 1] ?? "6") : 6;

const SKILL_KEYWORDS = ["스킬", "능력", "특성", "패시브", "Lv.", "레벨", "skill", "ability", "passive"];
function isSkillLike(name) {
  if (!name) return false;
  return SKILL_KEYWORDS.some(k => name.includes(k)) ||
    /고유\s*(스킬|능력|특성)/.test(name) ||
    /[가-힣]+\s*(스킬|능력|이능|기술)$/.test(name);
}
function hasConditionInName(name) {
  if (!name) return false;
  return /[（(][^）)]+[）)]$/.test(name) ||
    /^(방전된?|파손된?|손상된?|고장난?|낡은|소진된?)\s+/.test(name);
}

async function generateEpisode(episode) {
  const res = await fetch(`${BASE_URL}/api/generate-v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      book_id: BOOK_ID, episode,
      use_planner: true, validate: false, revise: false, enable_trace: true,
      gen_config: {
        totalEpisodes: 15, pov: "3인칭 관찰자", style: "묘사풍부",
        episodeLength: 900, episodeLengthVar: 200,
        conflict: 7, foreshadow: 6, emotion: 7, dialogue: 7, direction: 8,
      },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().then(t => t.slice(0,200))}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let charCount = 0; let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const obj = JSON.parse(line.slice(6));
        if (obj.error) throw new Error(obj.error);
        if (obj.done && obj.chars) charCount = obj.chars;
      } catch {}
    }
  }
  return charCount;
}

async function getDynamicStates(episode) {
  const res = await pool.query(
    `SELECT character_name, items, location, emotional_state
     FROM character_dynamic_states WHERE book_id=$1 AND episode_number=$2
     ORDER BY character_name`,
    [BOOK_ID, episode]
  );
  return res.rows;
}

async function getCanonicalItems() {
  const res = await pool.query(
    "SELECT name, initial_items FROM canonical_characters WHERE book_id=$1 ORDER BY name",
    [BOOK_ID]
  );
  const map = {};
  for (const r of res.rows) {
    const items = Array.isArray(r.initial_items) ? r.initial_items :
      (typeof r.initial_items === "string" ? JSON.parse(r.initial_items) : []);
    map[r.name] = items;
  }
  return map;
}

async function main() {
  console.log(`\n${"═".repeat(65)}`);
  console.log(`Phase 4 Item Smoke — ${TARGET_EPISODES}화 생성`);
  console.log(`book_id: ${BOOK_ID}`);
  console.log(`${"═".repeat(65)}`);

  const canonMap = await getCanonicalItems();
  console.log(`\ncanonical items:`);
  for (const [name, items] of Object.entries(canonMap)) {
    console.log(`  ${name}: [${items.map(i => i.name).join(", ")}]`);
  }

  let totalSkill = 0, totalCondInName = 0, totalDrift = 0, totalMissing = 0, totalEnglish = 0;
  const results = [];

  for (let ep = 1; ep <= TARGET_EPISODES; ep++) {
    process.stdout.write(`\n[ep${ep}] 생성 중...`);
    const t0 = Date.now();
    try {
      const charCount = await generateEpisode(ep);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const states = await getDynamicStates(ep);

      let epSkill = 0, epCondInName = 0, epDrift = 0, epMissing = 0, epEnglish = 0;
      const issues = [];

      for (const s of states) {
        const items = Array.isArray(s.items) ? s.items :
          (typeof s.items === "string" ? JSON.parse(s.items || "[]") : []);
        const charCanon = canonMap[s.character_name] ?? [];

        for (const item of items) {
          const name = typeof item === "string" ? item : item?.name ?? "";
          if (!name) continue;
          if (isSkillLike(name)) { epSkill++; issues.push(`skill:"${name}"`); }
          if (hasConditionInName(name)) { epCondInName++; issues.push(`cond-in-name:"${name}"`); }
          const isDrift = charCanon.some(ci => {
            const cl = ci.name.toLowerCase(), nl = name.toLowerCase();
            return cl !== nl && (cl.includes(nl) || nl.includes(cl)) && nl.length > 2 && cl.length > 2;
          });
          if (isDrift) { epDrift++; issues.push(`drift:"${name}"`); }
        }

        // missing canonical
        const itemNames = items.map(i => typeof i === "string" ? i : i?.name).filter(Boolean);
        for (const ci of charCanon) {
          const found = itemNames.some(n => {
            const nl = n.toLowerCase(), cl = ci.name.toLowerCase();
            return nl === cl || nl.includes(cl) || cl.includes(nl);
          });
          if (!found) { epMissing++; issues.push(`missing:"${ci.name}" (${s.character_name})`); }
        }

        // English state
        if (s.emotional_state && /^[a-zA-Z]/.test(s.emotional_state)) {
          epEnglish++; issues.push(`english-state:"${s.emotional_state.slice(0,20)}"`);
        }
      }

      totalSkill += epSkill; totalCondInName += epCondInName;
      totalDrift += epDrift; totalMissing += epMissing; totalEnglish += epEnglish;

      const ok = epSkill === 0 && epEnglish === 0;
      const tag = ok ? "✅" : (epSkill > 0 || epEnglish > 0 ? "❌" : "⚠️");
      console.log(` ${tag} rows=${states.length} — ${charCount}자, ${elapsed}s`);
      if (issues.length > 0) console.log(`   issues: ${issues.slice(0,5).join(" | ")}`);
      results.push({ ep, ok, epSkill, epCondInName, epDrift, epMissing, epEnglish });
    } catch (e) {
      console.log(` ❌ ERROR: ${e.message}`);
      results.push({ ep, error: e.message });
    }
  }

  console.log(`\n${"═".repeat(65)}`);
  console.log("SUMMARY");
  console.log(`${"─".repeat(65)}`);
  console.log(`skill-like items:        ${totalSkill}   ${totalSkill === 0 ? "✅" : "❌"}`);
  console.log(`condition-in-name:       ${totalCondInName}   ${totalCondInName === 0 ? "✅" : "⚠️"}`);
  console.log(`item name drift:         ${totalDrift}   ${totalDrift === 0 ? "✅" : "⚠️"}`);
  console.log(`missing canonical items: ${totalMissing}   ${totalMissing === 0 ? "✅" : "⚠️"}`);
  console.log(`English emotional_state: ${totalEnglish}   ${totalEnglish === 0 ? "✅" : "❌"}`);

  const pass = totalSkill === 0 && totalEnglish === 0;
  console.log(`\n${"─".repeat(65)}`);
  console.log(pass
    ? "✅  PHASE 4 ITEM SMOKE PASS"
    : "⚠️   PHASE 4 ITEM SMOKE CONDITIONAL"
  );
  console.log(`${"═".repeat(65)}\n`);
  await pool.end();
  process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
