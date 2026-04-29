/**
 * audit_item_location_ledger.mjs — Phase 4 Item/Location Ledger DB 감사
 *
 * 사용법: node scripts/audit_item_location_ledger.mjs --book-id <book_id>
 */

import pg from "pg";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const bidIdx = args.indexOf("--book-id");
const BOOK_ID = bidIdx !== -1 ? args[bidIdx + 1] : null;

if (!BOOK_ID) {
  console.error("Usage: node scripts/audit_item_location_ledger.mjs --book-id <book_id>");
  process.exit(1);
}

// 스킬 키워드 (item_ledger.ts와 동일 기준)
const SKILL_KEYWORDS = ["스킬", "능력", "특성", "패시브", "액티브", "Lv.", "레벨", "level", "skill", "ability", "passive"];
function isSkillLike(name) {
  if (!name) return false;
  return SKILL_KEYWORDS.some(k => name.includes(k)) ||
    /고유\s*(스킬|능력|특성)/.test(name) ||
    /[가-힣]+\s*(스킬|능력|이능|기술)$/.test(name);
}

// 이름에 상태가 붙은 경우 감지
function hasConditionInName(name) {
  if (!name) return false;
  return /[（(][^）)]+[）)]$/.test(name) ||
    /^(방전된?|파손된?|손상된?|고장난?|낡은|소진된?|분실된?)\s+/.test(name);
}

async function main() {
  console.log(`\n${"═".repeat(65)}`);
  console.log(`Phase 4 Item/Location Ledger Audit`);
  console.log(`book_id: ${BOOK_ID}`);
  console.log(`${"═".repeat(65)}`);

  // canonical items 조회
  const canonRes = await pool.query(
    "SELECT name, initial_items FROM canonical_characters WHERE book_id=$1 ORDER BY name",
    [BOOK_ID]
  );
  const canonMap = {};
  for (const row of canonRes.rows) {
    const items = Array.isArray(row.initial_items) ? row.initial_items :
      (typeof row.initial_items === "string" ? JSON.parse(row.initial_items) : []);
    canonMap[row.name] = items;
  }
  const canonNames = Object.keys(canonMap);
  console.log(`\ncanonical characters: [${canonNames.join(", ")}]`);

  // dynamic states 조회
  const dynRes = await pool.query(
    `SELECT episode_number, character_name, items, location, emotional_state
     FROM character_dynamic_states
     WHERE book_id=$1
     ORDER BY episode_number, character_name`,
    [BOOK_ID]
  );

  let totalSkillItems = 0;
  let totalConditionInName = 0;
  let totalMissingCanonical = 0;
  let totalItemNameDrift = 0;
  let totalEnglishState = 0;
  let abruptLocationChanges = 0;

  const epGroups = {};
  for (const row of dynRes.rows) {
    const ep = row.episode_number;
    if (!epGroups[ep]) epGroups[ep] = [];
    epGroups[ep].push(row);
  }

  const prevLocations = {};

  for (const ep of Object.keys(epGroups).sort((a, b) => +a - +b)) {
    const rows = epGroups[ep];
    const epIssues = [];

    // row completeness
    const presentChars = new Set(rows.map(r => r.character_name));
    const missingChars = canonNames.filter(n => !presentChars.has(n));
    if (missingChars.length > 0) {
      epIssues.push(`missing rows: [${missingChars.join(", ")}]`);
      totalMissingCanonical += missingChars.length;
    }

    for (const row of rows) {
      const items = Array.isArray(row.items) ? row.items :
        (typeof row.items === "string" ? JSON.parse(row.items || "[]") : []);

      for (const item of items) {
        const name = typeof item === "string" ? item : item?.name ?? "";
        if (!name) continue;

        // skill check
        if (isSkillLike(name)) {
          epIssues.push(`⚠️ ep${ep} ${row.character_name}: skill-like item "${name}"`);
          totalSkillItems++;
        }

        // condition in name check
        if (hasConditionInName(name)) {
          epIssues.push(`⚠️ ep${ep} ${row.character_name}: condition-in-name "${name}"`);
          totalConditionInName++;
        }

        // item name drift check (canonical names vs actual names)
        const charCanon = canonMap[row.character_name] ?? [];
        if (charCanon.length > 0 && !charCanon.some(ci => ci.name === name)) {
          // check if it's a known alias/abbreviation
          const isDrift = charCanon.some(ci => {
            const cl = ci.name.toLowerCase(), nl = name.toLowerCase();
            return (cl.includes(nl) || nl.includes(cl)) && nl !== cl && nl.length > 2 && cl.length > 2;
          });
          if (isDrift) {
            epIssues.push(`⚠️ ep${ep} ${row.character_name}: item drift "${name}"`);
            totalItemNameDrift++;
          }
        }
      }

      // canonical items missing check
      const charCanon = canonMap[row.character_name] ?? [];
      const itemNames = items.map(i => typeof i === "string" ? i : i?.name).filter(Boolean);
      for (const ci of charCanon) {
        if (!itemNames.includes(ci.name)) {
          // allow if carry-forward (check by exact name match or alias)
          const hasAlias = itemNames.some(n => {
            const nl = n.toLowerCase(), cl = ci.name.toLowerCase();
            return nl.includes(cl) || cl.includes(nl);
          });
          if (!hasAlias) {
            epIssues.push(`⚠️ ep${ep} ${row.character_name}: missing canonical item "${ci.name}"`);
            totalMissingCanonical++;
          }
        }
      }

      // English state check
      const emState = row.emotional_state ?? "";
      if (emState && /^[a-zA-Z]/.test(emState)) {
        epIssues.push(`⚠️ ep${ep} ${row.character_name}: English emotional_state "${emState.slice(0,30)}"`);
        totalEnglishState++;
      }

      // location abrupt change
      const prevLoc = prevLocations[row.character_name];
      const currLoc = row.location;
      if (prevLoc && currLoc && prevLoc !== "미등장" && currLoc !== "미등장" && prevLoc !== currLoc) {
        // 단순 이전/현재 위치가 달라진 경우 — 실제로는 story 맥락이 필요하지만 단순 카운트
        abruptLocationChanges++;
      }
      prevLocations[row.character_name] = currLoc;
    }

    const statusTag = epIssues.length === 0 ? "✅" : "⚠️";
    console.log(`\nep${ep}: ${statusTag} ${rows.length} rows`);
    if (epIssues.length > 0) {
      for (const issue of epIssues.slice(0, 5)) console.log(`  ${issue}`);
      if (epIssues.length > 5) console.log(`  ... +${epIssues.length - 5} more`);
    }
  }

  // SUMMARY
  console.log(`\n${"═".repeat(65)}`);
  console.log("SUMMARY");
  console.log(`${"─".repeat(65)}`);
  console.log(`skill-like items stored:          ${totalSkillItems}   ${totalSkillItems === 0 ? "✅" : "❌"}`);
  console.log(`condition-in-name:                ${totalConditionInName}   ${totalConditionInName === 0 ? "✅" : "⚠️"}`);
  console.log(`item name drift:                  ${totalItemNameDrift}   ${totalItemNameDrift === 0 ? "✅" : "⚠️"}`);
  console.log(`missing canonical items (per ep): ${totalMissingCanonical}   ${totalMissingCanonical === 0 ? "✅" : "⚠️"}`);
  console.log(`English emotional_state:          ${totalEnglishState}   ${totalEnglishState === 0 ? "✅" : "❌"}`);
  console.log(`location changes (across eps):    ${abruptLocationChanges}   (정보용)`);

  const overallPass = totalSkillItems === 0 && totalEnglishState === 0;
  console.log(`\n${"─".repeat(65)}`);
  console.log(overallPass
    ? "✅  PHASE 4 ITEM/LOCATION LEDGER AUDIT PASS"
    : "⚠️   PHASE 4 ITEM/LOCATION LEDGER AUDIT CONDITIONAL"
  );
  console.log(`${"═".repeat(65)}\n`);

  await pool.end();
  process.exit(overallPass ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
