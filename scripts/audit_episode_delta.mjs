/**
 * audit_episode_delta.mjs — episode delta contract 위반 진단
 *
 * 사용법:
 *   node scripts/audit_episode_delta.mjs --book-id <book_id>
 *   node scripts/audit_episode_delta.mjs --book-id <book_id> --episodes 10
 */

import pg from "pg";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 반복 위험 패턴 (validator와 동일 기준)
const REPEAT_PATTERNS = [
  { re: /의식을?\s*(잃|잃어|상실)/, label: "의식 상실" },
  { re: /기절/, label: "기절" },
  { re: /쓰러|쓰러짐/, label: "쓰러짐" },
  { re: /혼란|혼돈|혼수/, label: "혼란/혼수" },
  { re: /처음\s*(만|발견|알게)/, label: "처음 만남/발견" },
  { re: /다시\s*(처음|새롭게|또\s*다시)/, label: "다시 처음" },
  { re: /균열.{0,15}(나타|열|발생)/, label: "균열 반복" },
];

function bigramSimilarity(a, b) {
  if (!a || !b) return 0;
  const ngrams = s => {
    const chars = [...s.replace(/\s+/g, "")];
    const set = new Set();
    for (let i = 0; i < chars.length - 1; i++) set.add(chars[i] + chars[i + 1]);
    return set;
  };
  const sa = ngrams(a), sb = ngrams(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  return (2 * inter) / (sa.size + sb.size);
}

async function auditBook(bookId, maxEpisodes) {
  const epRes = await pool.query(
    `SELECT episode_number, content, summary
     FROM episodes WHERE book_id=$1
     ORDER BY episode_number
     ${maxEpisodes ? `LIMIT ${maxEpisodes}` : ""}`,
    [bookId]
  );
  const episodes = epRes.rows;
  if (episodes.length === 0) {
    console.log(`  (에피소드 없음)`);
    return;
  }

  const title = (await pool.query("SELECT title FROM books WHERE id=$1", [bookId])).rows[0]?.title ?? bookId;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`BOOK: ${title} (${bookId}) — ${episodes.length}화`);
  console.log(`${"─".repeat(60)}`);

  let totalWarn = 0;
  const patternCounts = {};

  for (let i = 1; i < episodes.length; i++) {
    const prev = episodes[i - 1];
    const curr = episodes[i];
    const text = curr.content ?? "";
    const prevText = prev.content ?? "";

    const warns = [];

    // 1. 반복 패턴이 연속 2화 이상 나타나는지
    for (const { re, label } of REPEAT_PATTERNS) {
      if (re.test(text) && re.test(prevText)) {
        warns.push(`'${label}' 패턴이 ep${prev.episode_number}와 ep${curr.episode_number} 연속 등장`);
        patternCounts[label] = (patternCounts[label] ?? 0) + 1;
      }
    }

    // 2. 직전 화 tail vs 이번 화 opening 유사도
    const prevTail = prevText.slice(-300);
    const opening = text.slice(0, 300);
    const sim = bigramSimilarity(prevTail, opening);
    if (sim >= 0.35) {
      warns.push(`직전 화 말미 ↔ 이번 화 첫 부분 bigram 유사도 ${(sim * 100).toFixed(0)}% (threshold: 35%)`);
    }

    // 3. 명시적 반복 지시어
    const REPEAT_MARKERS = ["다시 처음", "처음으로 돌아", "여전히 같은", "또다시 같은"];
    for (const m of REPEAT_MARKERS) {
      if (text.includes(m)) warns.push(`반복 지시어 감지: "${m}"`);
    }

    if (warns.length > 0) {
      console.log(`\n  ep${curr.episode_number} ⚠️  WARN (${warns.length}건):`);
      warns.forEach(w => console.log(`    - ${w}`));
      totalWarn += warns.length;
    } else {
      console.log(`  ep${curr.episode_number} ✓ PASS`);
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`총 WARN: ${totalWarn}건`);
  if (Object.keys(patternCounts).length > 0) {
    console.log(`반복 패턴 집계:`);
    for (const [label, cnt] of Object.entries(patternCounts)) {
      console.log(`  '${label}': ${cnt}회`);
    }
  }
  const verdict = totalWarn === 0 ? "✅ PASS" : `⚠️  WARN (${totalWarn}건)`;
  console.log(`\n판정: ${verdict}`);
}

async function main() {
  const args = process.argv.slice(2);
  const idIdx = args.indexOf("--book-id");
  const epIdx = args.indexOf("--episodes");
  if (idIdx === -1 || !args[idIdx + 1]) {
    console.error("Usage: node scripts/audit_episode_delta.mjs --book-id <id> [--episodes N]");
    process.exit(1);
  }
  const bookId = args[idIdx + 1];
  const maxEpisodes = epIdx !== -1 ? parseInt(args[epIdx + 1] ?? "0") : 0;
  try {
    await auditBook(bookId, maxEpisodes || null);
  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
