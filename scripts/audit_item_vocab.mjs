/**
 * audit_item_vocab.mjs — POST-1 §P1-B / POST-4 §C1
 *
 * 인물카드 카테고리 배지 누락(예: 합성 영양바)의 root cause 진단용 read-only audit.
 * book_id 별로 다음을 비교한다:
 *   1. canonical_characters.initial_items 안 unique item names
 *   2. character_dynamic_states.items 안 unique item names (모든 episode 누적)
 *   3. item_vocab 등록된 names
 *
 * 출력 (기본 — summary):
 *   - canonical/dynamic 등록률, vocab 미등록 dynamic items 리스트
 *   - "기타" 카테고리로 분류된 vocab 비율 (LLM이 카테고리 결정 못한 케이스)
 *
 * 출력 (--detail):
 *   - 위 summary 모두 포함
 *   - category별 vocab count 분포
 *   - vocab vs canonical category mismatch (P1-A reopen-3 source priority 충돌 검출)
 *   - 키워드 휴리스틱 단순화 가능성 평가용 정착도 수치
 *
 * 사용법:
 *   node scripts/audit_item_vocab.mjs --book-id <book_id>            # summary
 *   node scripts/audit_item_vocab.mjs --book-id <book_id> --detail   # detail
 *   node scripts/audit_item_vocab.mjs --all                          # active book 전체 summary
 *   node scripts/audit_item_vocab.mjs --all --detail                 # 전체 detail (출력 큼)
 *
 * read-only — 어떤 DB write도 수행하지 않음.
 */

import pg from "pg";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const args = process.argv.slice(2);
const bidIdx = args.indexOf("--book-id");
const ALL    = args.includes("--all");
const DETAIL = args.includes("--detail");
const BOOK_ID = bidIdx !== -1 ? args[bidIdx + 1] : null;

if (!BOOK_ID && !ALL) {
  console.error("Usage:");
  console.error("  node scripts/audit_item_vocab.mjs --book-id <book_id> [--detail]");
  console.error("  node scripts/audit_item_vocab.mjs --all [--detail]");
  process.exit(1);
}

// item_ledger와 동일 기준 — 스킬류는 audit 대상에서 제외 (vocab 분류 대상 아님)
const SKILL_RE = /스킬|능력|특성|패시브|액티브|Lv\.|레벨|level|skill|ability|passive|고유\s*(스킬|능력|특성)|[가-힣]+\s*(스킬|능력|이능|기술)$/;

function _itemName(it) {
  return typeof it === "string" ? it : (it && it.name) || null;
}

async function auditBook(bookId) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`book_id: ${bookId}`);
  console.log("─".repeat(72));

  // 책 메타
  const bookRes = await pool.query("SELECT title FROM books WHERE id = $1", [bookId]);
  const title = bookRes.rows[0]?.title ?? "(unknown)";
  console.log(`title: ${title}`);

  // 1. canonical initial_items
  const canonRes = await pool.query(
    "SELECT name, COALESCE(initial_items, '[]'::jsonb) AS initial_items FROM canonical_characters WHERE book_id = $1",
    [bookId]
  );
  const canonItems = new Set();
  for (const r of canonRes.rows) {
    const items = Array.isArray(r.initial_items) ? r.initial_items
                : (typeof r.initial_items === "string" ? JSON.parse(r.initial_items) : []);
    for (const it of items) {
      const nm = _itemName(it);
      if (nm && !SKILL_RE.test(nm)) canonItems.add(nm);
    }
  }

  // 2. dynamic states items (모든 episode)
  const dynRes = await pool.query(
    "SELECT items FROM character_dynamic_states WHERE book_id = $1",
    [bookId]
  );
  const dynItems = new Set();
  for (const r of dynRes.rows) {
    const items = Array.isArray(r.items) ? r.items
                : (typeof r.items === "string" ? JSON.parse(r.items) : []);
    for (const it of items) {
      const nm = _itemName(it);
      if (nm && !SKILL_RE.test(nm)) dynItems.add(nm);
    }
  }

  // 3. item_vocab
  const vocabRes = await pool.query(
    "SELECT name, category, badge_label FROM item_vocab WHERE book_id = $1",
    [bookId]
  );
  const vocabMap = new Map();
  for (const r of vocabRes.rows) vocabMap.set(r.name, { category: r.category, badge_label: r.badge_label });

  // 통계
  const canonRegistered = [...canonItems].filter(n => vocabMap.has(n)).length;
  const dynRegistered   = [...dynItems].filter(n => vocabMap.has(n)).length;
  const dynOnly         = [...dynItems].filter(n => !canonItems.has(n));    // 스토리 진행 중 새로 등장
  const dynOnlyVocabMissing = dynOnly.filter(n => !vocabMap.has(n));
  const etcCount        = [...vocabMap.values()].filter(v => v.category === "기타").length;

  console.log(`\n[counts]`);
  console.log(`  canonical items (unique): ${canonItems.size}`);
  console.log(`  dynamic items (unique):   ${dynItems.size}`);
  console.log(`  dynamic-only items:       ${dynOnly.length}  (스토리 진행 중 신규 등장)`);
  console.log(`  vocab registered:         ${vocabMap.size}`);

  console.log(`\n[coverage]`);
  console.log(`  canonical → vocab:    ${canonRegistered}/${canonItems.size}  (${canonItems.size ? Math.round(canonRegistered / canonItems.size * 100) : 0}%)`);
  console.log(`  dynamic   → vocab:    ${dynRegistered}/${dynItems.size}      (${dynItems.size ? Math.round(dynRegistered / dynItems.size * 100) : 0}%)`);
  console.log(`  dynamic-only vocab miss: ${dynOnlyVocabMissing.length}/${dynOnly.length}  (${dynOnly.length ? Math.round(dynOnlyVocabMissing.length / dynOnly.length * 100) : 0}%)`);
  console.log(`  vocab "기타" 비율:    ${etcCount}/${vocabMap.size}  (${vocabMap.size ? Math.round(etcCount / vocabMap.size * 100) : 0}%)`);

  if (dynOnlyVocabMissing.length) {
    console.log(`\n[dynamic-only items vocab 미등록 (max 50)]`);
    for (const n of dynOnlyVocabMissing.slice(0, 50)) console.log(`  - ${n}`);
    if (dynOnlyVocabMissing.length > 50) console.log(`  … (+${dynOnlyVocabMissing.length - 50} more)`);
  }

  const canonMissing = [...canonItems].filter(n => !vocabMap.has(n));
  if (canonMissing.length) {
    console.log(`\n[canonical items vocab 미등록 (max 30)]`);
    for (const n of canonMissing.slice(0, 30)) console.log(`  - ${n}`);
    if (canonMissing.length > 30) console.log(`  … (+${canonMissing.length - 30} more)`);
  }

  // verdict
  const totalUnique = canonItems.size + dynOnly.length;
  const totalRegistered = canonRegistered + (dynOnly.length - dynOnlyVocabMissing.length);
  const overallCoverage = totalUnique ? Math.round(totalRegistered / totalUnique * 100) : 0;
  console.log(`\n[verdict]`);
  console.log(`  overall vocab coverage: ${overallCoverage}%`);
  if (dynOnlyVocabMissing.length > 0) {
    console.log(`  ⚠ dynamic-only vocab miss ${dynOnlyVocabMissing.length}건 — 스토리 진행 중 등장한 신규 아이템이 LLM 분류를 거치지 않음.`);
    console.log(`     → 클라이언트는 server _inferItemBadge 키워드 fallback에 의존, 미매칭 시 "기타" 또는 배지 미표시.`);
  } else if (overallCoverage === 100) {
    console.log(`  ✅ 모든 아이템이 vocab에 등록됨.`);
  }

  // POST-4 §C1 — --detail 출력
  if (!DETAIL) {
    return { bookId, title, canonItems: canonItems.size, dynItems: dynItems.size,
             vocabSize: vocabMap.size, etcCount, overallCoverage,
             dynOnlyVocabMissing: dynOnlyVocabMissing.length, mismatchCount: 0 };
  }

  // category별 count
  const catCount = new Map();
  for (const v of vocabMap.values()) catCount.set(v.category, (catCount.get(v.category) ?? 0) + 1);
  const catSorted = [...catCount.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n[category 분포 — vocab ${vocabMap.size}건 기준]`);
  const w = Math.max(...catSorted.map(([k]) => k.length), 6);
  for (const [cat, n] of catSorted) {
    const pct = vocabMap.size ? Math.round(n / vocabMap.size * 100) : 0;
    console.log(`  ${cat.padEnd(w)}  ${String(n).padStart(3)}  (${pct}%)`);
  }

  // vocab vs canonical category mismatch — P1-A reopen-3 source priority 충돌 검출.
  // canonical_characters.initial_items 안 각 item에 category가 박힌 경우, vocab의
  // category와 비교하여 다른 행을 식별한다.
  const canonCatMap = new Map();  // name → category (canonical 첫 매칭)
  for (const r of canonRes.rows) {
    const items = Array.isArray(r.initial_items) ? r.initial_items
                : (typeof r.initial_items === "string" ? JSON.parse(r.initial_items) : []);
    for (const it of items) {
      if (typeof it === "object" && it?.name && it?.category) {
        if (!canonCatMap.has(it.name)) canonCatMap.set(it.name, it.category);
      }
    }
  }
  const mismatches = [];
  for (const [name, v] of vocabMap.entries()) {
    const cc = canonCatMap.get(name);
    if (cc && cc !== v.category) {
      mismatches.push({ name, vocab: v.category, canonical: cc });
    }
  }
  console.log(`\n[vocab vs canonical category mismatch]`);
  if (!mismatches.length) {
    console.log(`  ✅ 0건 — vocab과 canonical category 모두 일치 (source priority 충돌 없음)`);
  } else {
    console.log(`  ⚠ ${mismatches.length}건 — char-states API에서 vocab > canonical priority가 적용되어야 client에 정확한 카테고리 emit됨 (POST-1 §P1-A reopen-3 적용 후 정상).`);
    const wn = Math.max(...mismatches.map(m => m.name.length), 12);
    for (const m of mismatches.slice(0, 30)) {
      console.log(`    - ${m.name.padEnd(wn)} | vocab=${m.vocab.padEnd(8)} | canonical=${m.canonical}`);
    }
    if (mismatches.length > 30) console.log(`    … (+${mismatches.length - 30} more)`);
  }

  // 키워드 fallback 단순화 정착도 — overall coverage가 높고 mismatch 0이면 fallback 단순화 검토 가능.
  console.log(`\n[키워드 fallback 단순화 정착도]`);
  const settled = overallCoverage >= 95 && mismatches.length === 0 && etcCount === 0;
  if (settled) {
    console.log(`  ✅ 본 책은 vocab 정착 완료 — coverage ${overallCoverage}%, "기타" 0건, mismatch 0건. 키워드 fallback 호출 빈도 0 가능.`);
  } else {
    const reasons = [];
    if (overallCoverage < 95) reasons.push(`coverage ${overallCoverage}% < 95%`);
    if (etcCount > 0)         reasons.push(`"기타" ${etcCount}건`);
    if (mismatches.length)    reasons.push(`mismatch ${mismatches.length}건`);
    console.log(`  ⏳ 정착 미완 — ${reasons.join(" / ")}. 키워드 fallback 유지 필요.`);
  }

  return { bookId, title, canonItems: canonItems.size, dynItems: dynItems.size,
           vocabSize: vocabMap.size, etcCount, overallCoverage,
           dynOnlyVocabMissing: dynOnlyVocabMissing.length, mismatchCount: mismatches.length };
}

async function main() {
  const summaries = [];
  try {
    if (BOOK_ID) {
      const s = await auditBook(BOOK_ID);
      if (s) summaries.push(s);
    } else {
      // --all: active books (current_episode > 0)
      const booksRes = await pool.query(
        "SELECT id, title FROM books WHERE COALESCE(current_episode, 0) > 0 ORDER BY updated_at DESC NULLS LAST LIMIT 30"
      );
      console.log(`\nactive books (limit 30): ${booksRes.rows.length}`);
      for (const r of booksRes.rows) {
        const s = await auditBook(r.id);
        if (s) summaries.push(s);
      }
    }

    // POST-4 §C1 — --detail + --all 시 책 간 정착도 종합 표
    if (DETAIL && summaries.length > 1) {
      console.log(`\n${"═".repeat(72)}`);
      console.log(`AGGREGATE SUMMARY (${summaries.length} books)`);
      console.log("═".repeat(72));
      const wn = Math.max(...summaries.map(s => (s.title ?? "").length), 12);
      console.log(`${"title".padEnd(wn)}  | cov%  | etc | dynMiss | mismatch`);
      console.log(`${"-".repeat(wn)}  | ----- | --- | ------- | --------`);
      for (const s of summaries) {
        console.log(`${(s.title ?? "").padEnd(wn)}  | ${String(s.overallCoverage).padStart(4)}% | ${String(s.etcCount).padStart(3)} | ${String(s.dynOnlyVocabMissing).padStart(7)} | ${String(s.mismatchCount).padStart(8)}`);
      }
      const fullySettled = summaries.filter(s => s.overallCoverage >= 95 && s.etcCount === 0 && s.mismatchCount === 0);
      console.log(`\n정착 완료(coverage≥95% + 기타 0 + mismatch 0): ${fullySettled.length}/${summaries.length}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
