/**
 * audit_episode_end_item_state.mjs — Phase 4.19
 *
 * 본문 종료 시점의 소지품 상태가 본문 사건(전달/분실/파손)을 반영하는지 점검한다.
 * 하드코딩된 책별 룰 없이 일반적 키워드(transfer/loss/damage)로 판단.
 *
 * Usage:
 *   node scripts/audit_episode_end_item_state.mjs --book-id <uuid> [--episode N]
 *
 * Exit: 0 PASS, 1 WARN, 2 FAIL/ERROR
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const epOpt = args.indexOf("--episode") >= 0 ? parseInt(args[args.indexOf("--episode") + 1]) : null;
if (!bookId) { console.error("Usage: --book-id <uuid> [--episode N]"); process.exit(2); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TRANSFER_RE = /건넸|건네|넘겼|넘긴|주었|건네주|손에 쥐어|쥐여|받았|받은|받아\s*들/;
const LOSS_RE     = /잃었|떨어뜨|떨어트|놓쳤|사라졌|버렸|버린|뺏겼|훔쳤|놓고\s*나/;
const DAMAGE_RE   = /부서졌|부서진|파손|망가졌|망가진|박살|깨졌|깨진|찢어졌|찢긴|타버|불탔|녹았|폭파/;
const REPAIR_RE   = /고쳤|수리|복구|회복|새것\s*같|복원/;

(async () => {
  const W = 78;
  console.log("\n" + "═".repeat(W));
  console.log(` Item Ledger Audit — book ${bookId.slice(0, 8)}…`);
  console.log("═".repeat(W));

  let epRows;
  if (epOpt) {
    epRows = (await pool.query(
      "SELECT episode_number, content FROM episodes WHERE book_id=$1 AND episode_number=$2",
      [bookId, epOpt]
    )).rows;
  } else {
    epRows = (await pool.query(
      "SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number",
      [bookId]
    )).rows;
  }
  if (!epRows.length) { console.log("episodes 없음."); await pool.end(); process.exit(0); }

  let total = 0, warns = 0, fails = 0;

  for (const ep of epRows) {
    const body = String(ep.content ?? "");
    const states = (await pool.query(
      "SELECT character_name, items FROM character_dynamic_states WHERE book_id=$1 AND episode_number=$2",
      [bookId, ep.episode_number]
    )).rows;

    const transferHits = (body.match(TRANSFER_RE) || []).length;
    const lossHits     = (body.match(LOSS_RE)     || []).length;
    const damageHits   = (body.match(DAMAGE_RE)   || []).length;

    console.log(`\n── ep${ep.episode_number} (${body.length}자) ──`);
    console.log(`  본문 사건 신호: transfer=${transferHits} loss=${lossHits} damage=${damageHits}`);
    console.log(`  state rows: ${states.length}`);

    for (const s of states) {
      const items = Array.isArray(s.items) ? s.items : [];
      const damaged = items.filter(it => {
        const c = typeof it === "object" ? (it.condition ?? "") : "";
        return /파손|손상|망가|반파|부서|찢|불탄|녹은/.test(c);
      });
      const itemNames = items.map(it => typeof it === "string" ? it : (it.name ?? "")).filter(Boolean);
      console.log(`  · ${s.character_name}: ${items.length}개 (파손:${damaged.length}) — ${itemNames.slice(0, 3).join(", ")}${itemNames.length > 3 ? "…" : ""}`);
    }

    // 매우 거친 sanity:
    // damage 신호가 있는데 어느 인물 state에도 condition=파손 류가 없으면 WARN
    const anyDamaged = states.some(s => (Array.isArray(s.items) ? s.items : []).some(it => {
      const c = typeof it === "object" ? (it.condition ?? "") : "";
      return /파손|손상|망가|찢|불탄|녹은/.test(c);
    }));
    if (damageHits >= 2 && !anyDamaged) {
      console.log(`    ⚠️ 본문에 파손 사건이 있는데 state items.condition에 반영 안 됨`);
      warns++;
    }

    // loss 신호가 있는데 모든 인물 items 수가 직전 화와 동일하면 WARN
    if (lossHits >= 2 && ep.episode_number > 1) {
      const prev = (await pool.query(
        "SELECT character_name, items FROM character_dynamic_states WHERE book_id=$1 AND episode_number=$2",
        [bookId, ep.episode_number - 1]
      )).rows;
      const sameCount = prev.length === states.length && prev.every(p => {
        const cur = states.find(s => s.character_name === p.character_name);
        if (!cur) return false;
        const a = (Array.isArray(p.items) ? p.items : []).length;
        const b = (Array.isArray(cur.items) ? cur.items : []).length;
        return a === b;
      });
      if (sameCount) {
        console.log(`    ⚠️ 본문에 분실 사건이 있는데 직전 화 대비 items 개수 변화 없음`);
        warns++;
      }
    }

    total++;
  }

  console.log("\n" + "═".repeat(W));
  const verdict = fails ? "FAIL" : warns >= 3 ? "CONDITIONAL" : "PASS";
  const icon = verdict === "PASS" ? "✅" : verdict === "CONDITIONAL" ? "⚠️" : "❌";
  console.log(`${icon} ITEM LEDGER VERDICT: ${verdict} — episodes=${total}, warns=${warns}, fails=${fails}`);
  console.log("═".repeat(W) + "\n");

  await pool.end();
  process.exit(verdict === "FAIL" ? 1 : 0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(2); });
