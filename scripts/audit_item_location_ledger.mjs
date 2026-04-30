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

  // ── 동시 소유 감지 (같은 아이템을 여러 인물이 같은 에피소드에서 소지) ──
  let totalDualOwnership = 0;
  const dualOwnershipIssues = [];

  for (const ep of Object.keys(epGroups).sort((a, b) => +a - +b)) {
    // ep 내 모든 인물의 아이템 수집 (이름 기준 정규화)
    const itemOwnerMap = {}; // normalizedName → [charName]
    for (const row of epGroups[ep]) {
      const items = Array.isArray(row.items) ? row.items :
        (typeof row.items === "string" ? JSON.parse(row.items || "[]") : []);
      for (const item of items) {
        const rawName = typeof item === "string" ? item : item?.name ?? "";
        if (!rawName || rawName.length < 2) continue;
        // 괄호 조건 제거해서 canonical name만 비교
        const norm = rawName.replace(/[（(][^）)]+[）)]/g, "").trim().toLowerCase();
        if (norm.length < 2) continue;
        if (!itemOwnerMap[norm]) itemOwnerMap[norm] = [];
        itemOwnerMap[norm].push(row.character_name);
      }
    }
    // 2명 이상이 같은 아이템 소지
    for (const [normName, owners] of Object.entries(itemOwnerMap)) {
      if (owners.length >= 2) {
        totalDualOwnership++;
        const msg = `ep${ep}: 동시 소유 "${normName}" — [${owners.join(", ")}]`;
        dualOwnershipIssues.push(msg);
        console.log(`  🔴 ${msg}`);
      }
    }
  }

  // ── 아이템 소실 감지 (소지하다가 이후 에피소드에서 사라진 경우) ──
  let totalUnexplainedLoss = 0;
  const lossIssues = [];

  // 인물별 아이템 히스토리 구성
  const charItemHistory = {}; // charName → { ep: Set<normalizedName> }
  for (const ep of Object.keys(epGroups).sort((a, b) => +a - +b)) {
    for (const row of epGroups[ep]) {
      if (!charItemHistory[row.character_name]) charItemHistory[row.character_name] = {};
      const items = Array.isArray(row.items) ? row.items :
        (typeof row.items === "string" ? JSON.parse(row.items || "[]") : []);
      const normNames = new Set(items.map(i => {
        const raw = typeof i === "string" ? i : i?.name ?? "";
        return raw.replace(/[（(][^）)]+[）)]/g, "").trim().toLowerCase();
      }).filter(n => n.length >= 2));
      charItemHistory[row.character_name][ep] = normNames;
    }
  }

  // 각 인물에 대해, 연속적으로 소지하던 아이템이 갑자기 사라지면 flag
  for (const [charName, epMap] of Object.entries(charItemHistory)) {
    const epNums = Object.keys(epMap).sort((a, b) => +a - +b);
    for (let idx = 1; idx < epNums.length; idx++) {
      const prevEp = epNums[idx - 1];
      const currEp = epNums[idx];
      // 연속 에피소드만 체크 (1 차이)
      if (+currEp - +prevEp !== 1) continue;
      const prevItems = epMap[prevEp];
      const currItems = epMap[currEp];
      for (const item of prevItems) {
        if (item.length < 2) continue;
        // 환경 오브젝트 키워드 스킵
        if (/^(문|벽|바닥|천장|복도|계단|방|창문|의자|책상|테이블)$/.test(item)) continue;
        if (!currItems.has(item)) {
          // 이전 ep에 2화 이상 연속 소지하던 아이템만 flag
          const prevPrevEp = epNums[idx - 2];
          const hadBefore = prevPrevEp && epMap[prevPrevEp]?.has(item);
          if (hadBefore) {
            totalUnexplainedLoss++;
            const msg = `ep${prevEp}→ep${currEp}: ${charName} 아이템 소실 "${item}" (ep${prevPrevEp}부터 소지)`;
            lossIssues.push(msg);
          }
        }
      }
    }
  }
  if (lossIssues.length) {
    console.log("\n── 아이템 소실 감지 ──");
    for (const m of lossIssues) console.log(`  🟡 ${m}`);
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
  console.log(`dual ownership (same item, 2+ chars): ${totalDualOwnership}   ${totalDualOwnership === 0 ? "✅" : "❌"}`);
  console.log(`unexplained item loss:            ${totalUnexplainedLoss}   ${totalUnexplainedLoss === 0 ? "✅" : "⚠️"}`);
  console.log(`location changes (across eps):    ${abruptLocationChanges}   (정보용)`);

  const overallPass = totalSkillItems === 0 && totalEnglishState === 0 && totalDualOwnership === 0;
  console.log(`\n${"─".repeat(65)}`);
  console.log(overallPass
    ? "✅  PHASE 4 ITEM/LOCATION LEDGER AUDIT PASS"
    : totalDualOwnership > 0
      ? "❌  PHASE 4 ITEM/LOCATION LEDGER AUDIT FAIL (dual ownership)"
      : "⚠️   PHASE 4 ITEM/LOCATION LEDGER AUDIT CONDITIONAL"
  );
  console.log(`${"═".repeat(65)}\n`);

  await pool.end();
  process.exit(overallPass ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
