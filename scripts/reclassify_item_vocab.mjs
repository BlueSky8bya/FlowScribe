/**
 * reclassify_item_vocab.mjs — POST-1 §P1-A reopen-3 (C-lite)
 *
 * item_vocab + canonical_characters.initial_items 두 source의 잘못된 카테고리를
 * 강화된 prompt(classifyItemNamesViaLLM)로 함께 재분류.
 *
 * 본 script는 명시적 --apply 없이는 dry-run only — 절대 DB write 안 함.
 *
 * 사용법:
 *   # 단일 책 전체 재분류 dry-run
 *   node scripts/reclassify_item_vocab.mjs --book-id <book_id>
 *
 *   # 단일 아이템만 dry-run
 *   node scripts/reclassify_item_vocab.mjs --book-id <book_id> --item-name "합성 영양바"
 *
 *   # 실제 UPDATE 적용 (item_vocab + canonical 둘 다)
 *   node scripts/reclassify_item_vocab.mjs --book-id <book_id> --item-name "합성 영양바" --apply
 *
 * 동작:
 *   1. item_vocab + canonical_characters.initial_items 둘 다에서 대상 행 조회
 *   2. classifyItemNamesViaLLM (dist 빌드)에 owner/description/is_initial 컨텍스트 전달
 *   3. dry-run: 각 source별 (current → new) delta 출력
 *   4. --apply: 트랜잭션 안에서 vocab UPDATE + canonical jsonb_set, 실패 시 ROLLBACK
 *
 * 안전:
 *   - book_id 미입력 시 즉시 종료
 *   - --apply 없으면 어떤 INSERT/UPDATE/DELETE도 수행 안 함
 *   - 트랜잭션 사용 — 부분 실패 시 rollback
 *   - id/created_at 보존 (UPDATE 우선)
 */

import pg from "pg";
import { config } from "dotenv";
config();

// dist에서 강화된 분류 함수 import. tsc가 먼저 실행되어야 함 (build 후 실행).
const { classifyItemNamesViaLLM } = await import("../dist/services/item_desc.js");

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const bidIdx  = args.indexOf("--book-id");
const itemIdx = args.indexOf("--item-name");
const APPLY   = args.includes("--apply");
const BOOK_ID  = bidIdx  !== -1 ? args[bidIdx + 1]  : null;
const ITEM_NAME = itemIdx !== -1 ? args[itemIdx + 1] : null;

if (!BOOK_ID) {
  console.error("Usage:");
  console.error("  node scripts/reclassify_item_vocab.mjs --book-id <book_id> [--item-name <name>] [--apply]");
  process.exit(1);
}

const MODE = APPLY ? "APPLY" : "DRY-RUN";

async function main() {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`reclassify_item_vocab — ${MODE}`);
  console.log(`book_id:   ${BOOK_ID}`);
  console.log(`item_name: ${ITEM_NAME ?? "(전체)"}`);
  console.log("═".repeat(72));

  // 책 메타
  const bookRes = await pool.query("SELECT title FROM books WHERE id = $1", [BOOK_ID]);
  if (!bookRes.rows.length) {
    console.error(`\n✗ book_id 미존재: ${BOOK_ID}`);
    process.exit(2);
  }
  console.log(`title: ${bookRes.rows[0].title}`);

  // 1. item_vocab 대상 행
  const vocabRes = ITEM_NAME
    ? await pool.query(
        "SELECT name, category, badge_label FROM item_vocab WHERE book_id = $1 AND name = $2",
        [BOOK_ID, ITEM_NAME]
      )
    : await pool.query(
        "SELECT name, category, badge_label FROM item_vocab WHERE book_id = $1 ORDER BY name",
        [BOOK_ID]
      );
  const vocabByName = new Map();
  for (const r of vocabRes.rows) vocabByName.set(r.name, { category: r.category, badge_label: r.badge_label });

  // 2. canonical_characters.initial_items에서 같은 이름의 row + owner 매핑
  const canonRes = await pool.query(
    "SELECT name AS owner, COALESCE(initial_items, '[]'::jsonb) AS initial_items FROM canonical_characters WHERE book_id = $1",
    [BOOK_ID]
  );
  // canonByName: item name → [{owner, current_category, current_badge, description}]
  const canonByName = new Map();
  for (const r of canonRes.rows) {
    const items = Array.isArray(r.initial_items) ? r.initial_items
                : (typeof r.initial_items === "string" ? JSON.parse(r.initial_items) : []);
    for (const it of items) {
      const nm = typeof it === "string" ? it : it?.name;
      if (!nm) continue;
      if (ITEM_NAME && nm !== ITEM_NAME) continue;
      const arr = canonByName.get(nm) ?? [];
      arr.push({
        owner: r.owner,
        current_category: typeof it === "object" ? (it.category ?? null) : null,
        current_badge:    typeof it === "object" ? (it.badge_label ?? null) : null,
        description:      typeof it === "object" ? (it.description ?? null) : null,
      });
      canonByName.set(nm, arr);
    }
  }

  // 3. dynamic_states에서 description / owner 보강 (canonical에 없는 dynamic-only)
  const dynRes = await pool.query(
    "SELECT character_name, items FROM character_dynamic_states WHERE book_id = $1",
    [BOOK_ID]
  );
  const ownerByDynName = new Map();
  const descByDynName  = new Map();
  for (const r of dynRes.rows) {
    const items = Array.isArray(r.items) ? r.items
                : (typeof r.items === "string" ? JSON.parse(r.items) : []);
    for (const it of items) {
      const nm = typeof it === "string" ? it : it?.name;
      if (!nm) continue;
      if (!ownerByDynName.has(nm)) ownerByDynName.set(nm, r.character_name);
      if (!descByDynName.has(nm) && it?.description) descByDynName.set(nm, it.description);
    }
  }

  // 4. 통합 대상 names: vocab 또는 canonical 어느 한 쪽에라도 있는 이름
  const targetNames = new Set();
  for (const n of vocabByName.keys()) targetNames.add(n);
  for (const n of canonByName.keys()) targetNames.add(n);
  if (!targetNames.size) {
    console.log(`\n대상 이름 없음. ${ITEM_NAME ? '(item-name 매칭 없음)' : '(vocab/canonical 둘 다 비어있음)'}`);
    return;
  }
  console.log(`\n대상 이름: ${targetNames.size}개 (vocab=${vocabByName.size}, canonical=${[...canonByName.values()].reduce((a, b) => a + b.length, 0)})`);

  // 5. LLM 호출용 input — 각 이름 1개씩 (canonical에 multi-owner면 첫 owner만 prompt에 사용)
  const llmInput = [...targetNames].map(nm => {
    const canonList = canonByName.get(nm) ?? [];
    const firstCanon = canonList[0];
    const description = firstCanon?.description ?? descByDynName.get(nm) ?? null;
    const owner = firstCanon?.owner ?? ownerByDynName.get(nm) ?? null;
    const is_initial = canonList.length > 0;
    return { name: nm, description, owner, is_initial };
  });
  console.log(`\nLLM 분류 호출 중 (${llmInput.length}건, batch=30)...`);
  const newCategories = new Map();
  for (let i = 0; i < llmInput.length; i += 30) {
    const chunk = llmInput.slice(i, i + 30);
    const result = await classifyItemNamesViaLLM({ book_id: BOOK_ID, items: chunk });
    for (const r of result) newCategories.set(r.name, r.category);
  }
  console.log(`LLM 응답: ${newCategories.size}건 분류됨`);

  // 6. delta 계산 — vocab + canonical 양 source 별
  const deltas = []; // { name, vocabDelta, canonDeltas: [{owner, from, to}] }
  for (const nm of targetNames) {
    const newCat = newCategories.get(nm);
    if (!newCat) continue; // LLM 응답 없으면 skip

    const v = vocabByName.get(nm);
    const vocabDelta = v && v.category !== newCat ? { from: v.category, to: newCat } : null;

    const canonList = canonByName.get(nm) ?? [];
    const canonDeltas = canonList
      .map(c => ({ owner: c.owner, from: c.current_category ?? "(없음)", to: newCat }))
      .filter(d => d.from !== d.to);

    if (vocabDelta || canonDeltas.length) {
      deltas.push({ name: nm, vocabDelta, canonDeltas });
    }
  }

  // 7. 출력
  console.log(`\n${"─".repeat(72)}`);
  console.log(`RECLASSIFY DELTA (${deltas.length} item)`);
  console.log("─".repeat(72));
  if (!deltas.length) {
    console.log("변경 후보 없음 — 모든 source가 강화된 prompt 결과와 일치.");
  } else {
    for (const d of deltas) {
      console.log(`\n• ${d.name}`);
      if (d.vocabDelta) console.log(`    item_vocab:                ${d.vocabDelta.from} → ${d.vocabDelta.to}`);
      else if (vocabByName.has(d.name)) console.log(`    item_vocab:                (no change)`);
      else console.log(`    item_vocab:                (vocab 행 없음)`);
      for (const cd of d.canonDeltas) {
        console.log(`    canonical (${cd.owner}):  ${cd.from} → ${cd.to}`);
      }
      if (!d.canonDeltas.length && canonByName.has(d.name)) {
        console.log(`    canonical:                 (no change)`);
      }
    }
  }

  // 8. apply
  if (!APPLY) {
    console.log(`\n${"─".repeat(72)}`);
    console.log("DRY-RUN 종료. DB 미수정. 변경 적용하려면 --apply 인자 추가하세요.");
    return;
  }
  if (!deltas.length) {
    console.log("\nAPPLY 모드이지만 delta 없음 — UPDATE 안 함.");
    return;
  }

  console.log(`\n${"─".repeat(72)}`);
  console.log(`APPLY — vocab UPDATE + canonical jsonb UPDATE (transaction)`);
  console.log("─".repeat(72));
  const client = await pool.connect();
  let vocabCount = 0;
  let canonCount = 0;
  try {
    await client.query("BEGIN");
    for (const d of deltas) {
      // vocab UPDATE
      if (d.vocabDelta) {
        await client.query(
          `UPDATE item_vocab
           SET category = $3, badge_label = $3
           WHERE book_id = $1 AND name = $2`,
          [BOOK_ID, d.name, d.vocabDelta.to]
        );
        vocabCount++;
      }
      // canonical jsonb UPDATE — 각 owner row에 대해
      for (const cd of d.canonDeltas) {
        await client.query(
          `UPDATE canonical_characters
           SET initial_items = (
             SELECT COALESCE(jsonb_agg(
               CASE
                 WHEN elem->>'name' = $3
                 THEN jsonb_set(
                   jsonb_set(elem, '{category}',    to_jsonb($4::text)),
                              '{badge_label}', to_jsonb($4::text)
                 )
                 ELSE elem
               END
             ), '[]'::jsonb)
             FROM jsonb_array_elements(COALESCE(initial_items, '[]'::jsonb)) elem
           )
           WHERE book_id = $1 AND name = $2`,
          [BOOK_ID, cd.owner, d.name, cd.to]
        );
        canonCount++;
      }
    }
    await client.query("COMMIT");
    console.log(`✓ COMMIT — vocab ${vocabCount}건 + canonical ${canonCount}건 갱신 완료.`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`✗ ROLLBACK — UPDATE 실패. 변경 사항 없음.`);
    console.error(err);
    process.exit(3);
  } finally {
    client.release();
  }
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => pool.end());
