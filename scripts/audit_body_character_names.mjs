/**
 * audit_body_character_names.mjs
 * 에피소드 본문에서 non-canonical 인물명 감지
 * Usage: node scripts/audit_body_character_names.mjs --book-id <uuid>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookIdIdx = args.indexOf("--book-id");
const BOOK = bookIdIdx !== -1 ? args[bookIdIdx + 1] : null;
if (!BOOK) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 묘사형 일반 명사 허용 목록 (인물처럼 보이지만 실제 인물 아님)
const DESCRIPTIVE_OK = new Set([
  "남자","여자","소년","소녀","아이","노인","병사","기사","상인","목소리",
  "그림자","존재","인물","누군가","사람","인간","흡혈귀","생명체","형체",
]);

async function run() {
  const [canonChars, episodes] = await Promise.all([
    pool.query(`SELECT name FROM canonical_characters WHERE book_id=$1`, [BOOK]),
    pool.query(`SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`, [BOOK]),
  ]);
  const canonNames = canonChars.rows.map(r => r.name);
  const canonSet = new Set(canonNames);

  console.log(`\n[Body Character Name Audit] book=${BOOK}`);
  console.log(`Canonical: ${canonNames.join(', ')}\n`);

  let totalIssues = 0;

  for (const ep of episodes.rows) {
    const content = ep.content;
    // 한국어 고유명사 패턴: 2~4자 한글 + 조사
    const nameCandidates = new Set();
    const patterns = [
      /([가-힣]{2,4})(?:이|가|은|는|을|를|에게|에게서|의|와|과|이라|도|만|조차|까지|부터)(?=[^가-힣]|$)/g,
      /([가-힣]{2,4})(?:이|가)\s/g,
    ];
    for (const pat of patterns) {
      for (const m of content.matchAll(pat)) {
        nameCandidates.add(m[1]);
      }
    }

    const issues = [];
    for (const cand of nameCandidates) {
      if (canonSet.has(cand)) continue;
      if (DESCRIPTIVE_OK.has(cand)) continue;
      if (cand.length < 2) continue;
      // 일반 명사 필터 (동사/형용사 어근 패턴)
      if (/[이하되었있없을]$/.test(cand)) continue;

      // canonical과 유사도 체크 (Levenshtein 1~2 거리)
      let closestCanon = null;
      for (const cn of canonNames) {
        const overlap = [...cand].filter(c => cn.includes(c)).length;
        if (overlap >= Math.min(cand.length, cn.length) - 1 && cand !== cn) {
          closestCanon = cn;
          break;
        }
      }

      // 본문에서 맥락 snippet
      const idx = content.indexOf(cand);
      const snippet = content.slice(Math.max(0, idx - 20), idx + cand.length + 20);
      issues.push({ name: cand, similar_to: closestCanon, snippet: snippet.replace(/\n/g, ' ') });
    }

    if (issues.length > 0) {
      totalIssues += issues.length;
      console.log(`ep${ep.episode_number}: ${issues.length} candidate(s)`);
      issues.slice(0, 5).forEach(i => {
        const sim = i.similar_to ? ` (유사: ${i.similar_to})` : "";
        console.log(`  "${i.name}"${sim} — ...${i.snippet}...`);
      });
    } else {
      console.log(`ep${ep.episode_number}: CLEAN`);
    }
  }

  console.log(`\nTotal issues: ${totalIssues}`);
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
