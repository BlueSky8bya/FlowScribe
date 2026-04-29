/**
 * audit_character_aliases.mjs — character alias 오염 진단
 *
 * 사용법:
 *   node scripts/audit_character_aliases.mjs --book-id <book_id>
 *   node scripts/audit_character_aliases.mjs --all
 */

import pg from "pg";
import { readFileSync } from "fs";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── 묘사형 패턴 (entity_resolver.ts와 동일 기준) ────────────
const GENERIC_NOUNS = new Set([
  "아이", "어린아이", "아기", "소년", "소녀", "청년", "청녀",
  "남자", "여자", "남성", "여성", "사내", "여인",
  "노인", "할아버지", "할머니", "어르신",
  "누군가", "누군가가", "사람", "인물", "자", "자신",
  "기사", "병사", "경비", "경비병", "경호원", "근위병",
  "상인", "장사꾼", "행상", "농부", "어부",
  "마법사", "술사", "치료사", "사제", "성직자", "수도사",
  "왕", "왕비", "왕자", "공주", "귀족", "영주", "기병",
  "자객", "암살자", "도둑", "강도", "전사", "용사",
  "영웅", "현자", "예언자", "탐정", "형사", "군인",
  "목소리", "그림자", "존재", "형체", "형상",
  "실루엣", "그것", "무언가",
]);
const DESCRIPTIVE_PREFIXES = [
  "낯선", "모르는", "알 수 없는",
  "검은", "붉은", "흰", "하얀", "어두운",
  "어린", "늙은", "젊은",
  "그림자 속", "어둠 속", "빛 속",
  "작은", "큰", "키 큰", "키 작은",
  "수수께끼의", "정체불명의", "이름 모를",
];

function isDescriptive(name) {
  if (GENERIC_NOUNS.has(name)) return true;
  for (const p of DESCRIPTIVE_PREFIXES) if (name.startsWith(p)) return true;
  const tokens = name.split(/\s+/);
  if (tokens.length >= 2 && GENERIC_NOUNS.has(tokens[tokens.length - 1])) return true;
  return false;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}

async function auditBook(bookId, opts = {}) {
  const { afterEpisode = 0, ignoreLegacy = false } = opts;

  // afterEpisode > 0이면 해당 화 이후에 생성된 row만 검사 (legacy 오염 분리)
  const dynEpFilter = afterEpisode > 0 ? ` AND episode_number > ${afterEpisode}` : "";

  const [bookRes, canonRes, dynRes, arcRes, foresRes, epRes] = await Promise.all([
    pool.query("SELECT title FROM books WHERE id=$1", [bookId]),
    pool.query("SELECT name FROM canonical_characters WHERE book_id=$1 ORDER BY created_at", [bookId]),
    pool.query(`SELECT DISTINCT character_name FROM character_dynamic_states WHERE book_id=$1${dynEpFilter} ORDER BY character_name`, [bookId]),
    pool.query("SELECT DISTINCT character_name FROM character_arcs WHERE book_id=$1 ORDER BY character_name", [bookId]),
    pool.query("SELECT keywords FROM foreshadows WHERE book_id=$1", [bookId]),
    pool.query("SELECT COUNT(*) as cnt FROM episodes WHERE book_id=$1", [bookId]),
  ]);

  const title = bookRes.rows[0]?.title ?? bookId;
  const canonNames = canonRes.rows.map(r => r.name);
  const dynNames = dynRes.rows.map(r => r.character_name);
  const arcNames = arcRes.rows.map(r => r.character_name);
  const epCount = parseInt(epRes.rows[0]?.cnt ?? "0");
  const auditMode = afterEpisode > 0 ? `ep${afterEpisode + 1}+ only` : ignoreLegacy ? "legacy-ignored" : "all episodes";

  const nonCanonDyn = dynNames.filter(n => !canonNames.includes(n));
  const nonCanonArc = arcNames.filter(n => !canonNames.includes(n));

  // 묘사형 vs 가능한 신규 인물
  const descriptive = nonCanonDyn.filter(isDescriptive);
  const possibleNew = nonCanonDyn.filter(n => !isDescriptive(n));

  // 유사 alias 그룹 (edit distance ≤ 2 또는 prefix 관계)
  const aliasGroups = [];
  const visited = new Set();
  for (const a of nonCanonDyn) {
    if (visited.has(a)) continue;
    const group = [a];
    for (const b of nonCanonDyn) {
      if (a === b || visited.has(b)) continue;
      if (levenshtein(a, b) <= 2 || a.startsWith(b) || b.startsWith(a) ||
          (a.includes(b.replace(/\s+/g,"")) || b.includes(a.replace(/\s+/g,"")))) {
        group.push(b);
        visited.add(b);
      }
    }
    visited.add(a);
    if (group.length > 1) aliasGroups.push(group);
  }

  // foreshadow contamination
  const foresCharNames = new Set(foresRes.rows.flatMap(r => r.keywords ?? []));
  const foresNonCanon = [...foresCharNames].filter(n => !canonNames.includes(n));

  // episode-level alias appearances
  let epAliasRows = [];
  if (nonCanonDyn.length > 0) {
    const epAliasRes = await pool.query(
      `SELECT character_name, episode_number FROM character_dynamic_states
       WHERE book_id=$1 AND character_name = ANY($2::text[])
       ORDER BY episode_number, character_name`,
      [bookId, nonCanonDyn]
    );
    epAliasRows = epAliasRes.rows;
  }

  // non-canonical row count
  let nonCanonRowCount = 0;
  if (nonCanonDyn.length > 0) {
    const cnt = await pool.query(
      `SELECT COUNT(*) as c FROM character_dynamic_states WHERE book_id=$1 AND character_name = ANY($2::text[])`,
      [bookId, nonCanonDyn]
    );
    nonCanonRowCount = parseInt(cnt.rows[0]?.c ?? "0");
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`BOOK: ${title} (${bookId})`);
  console.log(`Episodes: ${epCount}  |  Audit mode: ${auditMode}`);
  console.log(`${"─".repeat(60)}`);

  console.log("\n── canonical characters ──");
  canonNames.forEach(n => console.log(`  ✓ ${n}`));

  console.log("\n── dynamic state names (all distinct) ──");
  dynNames.forEach(n => {
    const tag = canonNames.includes(n) ? "✓ canonical" : isDescriptive(n) ? "✗ descriptive" : "? non-canonical";
    console.log(`  [${tag}] ${n}`);
  });

  if (nonCanonDyn.length === 0) {
    console.log("\n✅  No alias contamination — all dynamic names are canonical");
    return { bookId, title, nonCanonCount: 0, nonCanonRowCount: 0 };
  }

  console.log(`\n── non-canonical in character_dynamic_states (${nonCanonDyn.length} names, ${nonCanonRowCount} rows) ──`);
  nonCanonDyn.forEach(n => console.log(`  ✗ ${n}`));

  if (descriptive.length > 0) {
    console.log(`\n── descriptive mentions (should be filtered by Phase 2) ──`);
    descriptive.forEach(n => console.log(`  📛 ${n}`));
  }

  if (possibleNew.length > 0) {
    console.log(`\n── possible new characters (proper noun form) ──`);
    possibleNew.forEach(n => console.log(`  ❓ ${n}`));
  }

  if (aliasGroups.length > 0) {
    console.log("\n── suspected alias groups ──");
    aliasGroups.forEach(g => console.log(`  🔗 ${g.join(" / ")}`));
  }

  if (nonCanonArc.length > 0) {
    console.log(`\n── character_arcs contamination ──`);
    nonCanonArc.forEach(n => console.log(`  ⚠️  ${n}`));
  } else {
    console.log("\n── character_arcs: canonical only ✓ ──");
  }

  if (foresNonCanon.length > 0) {
    console.log(`\n── foreshadow contamination ──`);
    foresNonCanon.forEach(n => console.log(`  ⚠️  ${n}`));
  }

  if (epAliasRows.length > 0) {
    console.log("\n── episode alias appearances (first/last) ──");
    const byName = {};
    for (const r of epAliasRows) {
      if (!byName[r.character_name]) byName[r.character_name] = [];
      byName[r.character_name].push(r.episode_number);
    }
    for (const [name, eps] of Object.entries(byName)) {
      const sorted = eps.sort((a, b) => a - b);
      console.log(`  ${name}: ep${sorted[0]}~ep${sorted[sorted.length - 1]} (${eps.length} rows)`);
    }
  }

  return { bookId, title, nonCanonCount: nonCanonDyn.length, nonCanonRowCount };
}

async function main() {
  const args = process.argv.slice(2);
  const allBooks = args.includes("--all");
  let bookIds = [];

  const afterIdx = args.indexOf("--after-episode");
  const afterEpisode = afterIdx !== -1 ? parseInt(args[afterIdx + 1] ?? "0", 10) : 0;
  const ignoreLegacy = args.includes("--ignore-legacy");
  const auditOpts = { afterEpisode, ignoreLegacy };

  if (allBooks) {
    const res = await pool.query(
      `SELECT b.id FROM books b
       WHERE EXISTS (SELECT 1 FROM character_dynamic_states WHERE book_id=b.id)
       ORDER BY b.created_at DESC`
    );
    bookIds = res.rows.map(r => r.id);
  } else {
    const idx = args.indexOf("--book-id");
    if (idx !== -1 && args[idx + 1]) {
      bookIds = [args[idx + 1]];
    } else {
      console.error("Usage: node scripts/audit_character_aliases.mjs --book-id <id> | --all [--after-episode N] [--ignore-legacy]");
      process.exit(1);
    }
  }

  const results = [];
  for (const id of bookIds) {
    try {
      results.push(await auditBook(id, auditOpts));
    } catch (e) {
      console.error(`Error auditing ${id}:`, e.message);
    }
  }

  if (results.length > 1) {
    console.log(`\n${"═".repeat(60)}`);
    console.log("SUMMARY");
    console.log(`${"─".repeat(60)}`);
    const contaminated = results.filter(r => r.nonCanonCount > 0);
    console.log(`Total books: ${results.length}, contaminated: ${contaminated.length}`);
    contaminated.forEach(r => console.log(`  ✗ ${r.title} (${r.bookId}): ${r.nonCanonCount} names, ${r.nonCanonRowCount} rows`));
    const clean = results.filter(r => r.nonCanonCount === 0);
    clean.forEach(r => console.log(`  ✓ ${r.title}`));
  }

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
