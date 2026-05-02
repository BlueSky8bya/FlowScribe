/**
 * reclassify_item_vocab.mjs — POST-1 §P1-A reopen
 *
 * item_vocab DB에 잘못 저장된 카테고리를 강화된 prompt로 재분류.
 * INSERT ... ON CONFLICT DO NOTHING 정책 때문에 prompt만 고쳐도 기존 행은 갱신 안 됨.
 * 본 script는 명시적 --apply 없이는 dry-run only — 절대 DB write 안 함.
 *
 * 사용법:
 *   # 단일 책 전체 재분류 dry-run
 *   node scripts/reclassify_item_vocab.mjs --book-id <book_id>
 *
 *   # 단일 아이템만 dry-run
 *   node scripts/reclassify_item_vocab.mjs --book-id <book_id> --item-name "합성 영양바"
 *
 *   # 실제 UPDATE 적용
 *   node scripts/reclassify_item_vocab.mjs --book-id <book_id> --apply
 *   node scripts/reclassify_item_vocab.mjs --book-id <book_id> --item-name "합성 영양바" --apply
 *
 * 동작:
 *   1. item_vocab에서 대상 행 조회 (현재 category 포함)
 *   2. classifyItemNamesViaLLM (dist 빌드 산출)에 owner/description/is_initial 컨텍스트 함께 전달
 *   3. 새 분류 결과를 현재 category와 비교
 *   4. dry-run: 변경 후보를 표 형식으로 출력만
 *   5. --apply: 변경되는 행만 UPDATE (delta 없으면 skip)
 *
 * 안전:
 *   - book_id 미입력 시 즉시 종료
 *   - --apply 없으면 어떤 INSERT/UPDATE/DELETE도 수행 안 함
 *   - 트랜잭션 사용 — 부분 실패 시 rollback
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

  // 1. 대상 vocab 행 조회
  const vocabRes = ITEM_NAME
    ? await pool.query(
        "SELECT name, category, badge_label FROM item_vocab WHERE book_id = $1 AND name = $2",
        [BOOK_ID, ITEM_NAME]
      )
    : await pool.query(
        "SELECT name, category, badge_label FROM item_vocab WHERE book_id = $1 ORDER BY name",
        [BOOK_ID]
      );
  if (!vocabRes.rows.length) {
    console.log(`\n대상 vocab 행 없음. ${ITEM_NAME ? '(item-name 매칭 없음)' : '(이 책에 vocab 등록 0건)'}`);
    return;
  }
  console.log(`\n대상 vocab 행: ${vocabRes.rows.length}건`);

  // 2. canonical_characters에서 owner / description / is_initial 정보 fetch
  //    아이템 이름 → owner 매핑 (canonical_characters.initial_items)
  //    아이템 이름 → description 매핑 (initial_items의 description)
  const canonRes = await pool.query(
    "SELECT name AS owner, COALESCE(initial_items, '[]'::jsonb) AS initial_items FROM canonical_characters WHERE book_id = $1",
    [BOOK_ID]
  );
  const ownerByItem = new Map();
  const descByItem  = new Map();
  for (const r of canonRes.rows) {
    const items = Array.isArray(r.initial_items) ? r.initial_items
                : (typeof r.initial_items === "string" ? JSON.parse(r.initial_items) : []);
    for (const it of items) {
      const nm = typeof it === "string" ? it : it?.name;
      if (!nm) continue;
      if (!ownerByItem.has(nm)) ownerByItem.set(nm, r.owner);
      if (!descByItem.has(nm) && it?.description) descByItem.set(nm, it.description);
    }
  }
  // dynamic states에서도 owner 보강 (canonical에 없는 dynamic 아이템)
  const dynRes = await pool.query(
    "SELECT character_name, items FROM character_dynamic_states WHERE book_id = $1",
    [BOOK_ID]
  );
  for (const r of dynRes.rows) {
    const items = Array.isArray(r.items) ? r.items
                : (typeof r.items === "string" ? JSON.parse(r.items) : []);
    for (const it of items) {
      const nm = typeof it === "string" ? it : it?.name;
      if (!nm) continue;
      if (!ownerByItem.has(nm)) ownerByItem.set(nm, r.character_name);
      if (!descByItem.has(nm) && it?.description) descByItem.set(nm, it.description);
    }
  }

  // 3. LLM 호출용 input 구성
  const initialNames = new Set(ownerByItem.keys()); // canonical에서 발견된 이름은 initial로 본다 (근사)
  const llmInput = vocabRes.rows.map(r => ({
    name: r.name,
    description: descByItem.get(r.name) ?? null,
    owner: ownerByItem.get(r.name) ?? null,
    is_initial: initialNames.has(r.name),
  }));

  console.log(`\nLLM 분류 호출 중 (${llmInput.length}건, batch=30)...`);
  const newCategories = new Map();
  // 30개씩 batch
  for (let i = 0; i < llmInput.length; i += 30) {
    const chunk = llmInput.slice(i, i + 30);
    const result = await classifyItemNamesViaLLM({
      book_id: BOOK_ID,
      items: chunk,
    });
    for (const r of result) newCategories.set(r.name, r.category);
  }
  console.log(`LLM 응답: ${newCategories.size}건 분류됨`);

  // 4. delta 계산
  const deltas = [];
  for (const r of vocabRes.rows) {
    const newCat = newCategories.get(r.name);
    if (!newCat) continue; // LLM 응답 없으면 skip
    if (newCat === r.category) continue; // 동일하면 skip
    deltas.push({
      name: r.name,
      from: r.category,
      to:   newCat,
    });
  }

  // 5. 출력
  console.log(`\n${"─".repeat(72)}`);
  console.log(`RECLASSIFY DELTA (${deltas.length}건)`);
  console.log("─".repeat(72));
  if (!deltas.length) {
    console.log("변경 후보 없음 — 모든 행이 강화된 prompt로도 동일 category 유지.");
  } else {
    const w = Math.max(...deltas.map(d => d.name.length), 12);
    console.log(`${"name".padEnd(w)}  | ${"from".padEnd(8)} → ${"to".padEnd(8)}`);
    console.log(`${"-".repeat(w)}  | ${"-".repeat(8)} → ${"-".repeat(8)}`);
    for (const d of deltas) {
      console.log(`${d.name.padEnd(w)}  | ${d.from.padEnd(8)} → ${d.to.padEnd(8)}`);
    }
  }

  // 6. apply
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
  console.log(`APPLY — UPDATE item_vocab × ${deltas.length}건 (transaction)`);
  console.log("─".repeat(72));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const d of deltas) {
      await client.query(
        `UPDATE item_vocab
         SET category = $3, badge_label = $3
         WHERE book_id = $1 AND name = $2`,
        [BOOK_ID, d.name, d.to]
      );
    }
    await client.query("COMMIT");
    console.log(`✓ COMMIT — ${deltas.length}건 갱신 완료.`);
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
