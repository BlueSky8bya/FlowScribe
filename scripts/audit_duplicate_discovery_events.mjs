/**
 * audit_duplicate_discovery_events.mjs — R5B-1.6
 *
 * cross-episode 발견 사건 중복 감사. R5A-D0 forensic의 ep2/ep4 사례
 * (같은 흔적·단서를 다른 인물이 다른 화에서 처음 발견하듯 재발화)를 자동 감지.
 *
 * 검사 항목:
 *   1. 발견 동사 phrase (발견/찾/흔적/남아/감지/확인) cross-ep exact 매치
 *   2. quotation 12+ chars cross-ep 정확 매치 (의례적 동작 제외 화이트리스트)
 *   3. 인접 ep 간 발견 phrase keyword 80%+ 유사도 (re-discovery 패턴)
 *
 * read-only. 본문 미저장. summary/score만.
 *
 * Usage:
 *   node scripts/audit_duplicate_discovery_events.mjs --book-id <uuid> [--max-ep N]
 */
import pg from "pg";
import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const maxEp = parseInt(args[args.indexOf("--max-ep") + 1] ?? "30", 10);
if (!bookId) { console.error("Usage: --book-id <uuid> [--max-ep N]"); process.exit(1); }

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 의례적 동작 — duplicate라도 무시 (false positive 차단)
const TRIVIAL_RE = /^[가-힣\s]{0,15}(고개를\s*끄덕|고개를\s*저|미소를\s*지|숨을\s*들이|입술을\s*깨|눈을\s*감|손을\s*들|손을\s*내|어깨를)/;

// 발견 phrase candidate detection
const DISCOVERY_PHRASE_RE = /([\"“][^\"”\n]{8,80}(흔적|발견|남아|찾아|남았|감지|확인했|확인된)[^\"”\n]{0,50}[\"”])|([가-힣\s]{4,30}(누군가|어떤이가|적이|침입자가|방문자가)[가-힣\s]{0,40}(지나간|머문|다녀간|있었))/g;

const _normalize = (s) => (s || "").replace(/[\s 　]+/g, "").replace(/[\.,!?。·\-]/g, "");

// 토큰 set Jaccard
const _tokSet = (s) => new Set((s || "").match(/[가-힣]{2,5}/g) ?? []);
const _jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const k of a) if (b.has(k)) inter++;
  return inter / (a.size + b.size - inter);
};

async function main() {
  const eps = (await pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 AND episode_number<=$2 ORDER BY episode_number`,
    [bookId, maxEp]
  )).rows;
  if (!eps.length) { console.error("no episodes"); process.exit(0); }

  console.log(`book_id: ${bookId}  episodes: ${eps.length}`);
  console.log("");

  // 1. cross-ep exact sentence duplicates (12+ chars, 의례적 동작 제외)
  console.log("── [1] Cross-ep exact sentence duplicates (12+ chars) ──");
  const sentenceMap = new Map();
  for (const e of eps) {
    const sents = e.content.split(/[.!?。]+|\n+/).map(s => s.trim()).filter(s => s.length >= 12 && s.length <= 70);
    for (const s of sents) {
      if (TRIVIAL_RE.test(s)) continue; // 의례적 동작 skip
      if (!sentenceMap.has(s)) sentenceMap.set(s, []);
      sentenceMap.get(s).push(e.episode_number);
    }
  }
  const duplicates = [...sentenceMap.entries()]
    .filter(([_, eps]) => new Set(eps).size > 1)
    .sort((a, b) => b[1].length - a[1].length);
  console.log(`  count: ${duplicates.length}` + (duplicates.length === 0 ? " ✓" : " ⚠"));
  for (const [s, _eps] of duplicates.slice(0, 5)) {
    console.log(`    eps=${JSON.stringify([...new Set(_eps)])} sentence=${JSON.stringify(s.slice(0, 80))}`);
  }

  // 2. discovery phrase cross-ep occurrence
  console.log("");
  console.log("── [2] Discovery phrase cross-ep occurrence ──");
  const phrasesByEp = {};
  for (const e of eps) {
    const matches = [...e.content.matchAll(DISCOVERY_PHRASE_RE)].map(m => m[0].trim());
    if (matches.length) phrasesByEp[e.episode_number] = matches;
  }
  // cross-ep keyword similarity (인접 ep 또는 ep 간격 ≤ 5)
  const epList = Object.keys(phrasesByEp).map(Number).sort((a,b)=>a-b);
  const crossEpHits = [];
  for (let i = 0; i < epList.length; i++) {
    for (let j = i + 1; j < epList.length; j++) {
      const a = epList[i], b = epList[j];
      if (b - a > 5) break; // 5화 이상 떨어지면 자연스러운 회귀 허용
      for (const pa of phrasesByEp[a]) {
        for (const pb of phrasesByEp[b]) {
          const sim = _jaccard(_tokSet(pa), _tokSet(pb));
          if (sim >= 0.6) crossEpHits.push({ epA: a, epB: b, sim: sim.toFixed(2), pa: pa.slice(0,60), pb: pb.slice(0,60) });
        }
      }
    }
  }
  console.log(`  cross-ep similar discovery phrases (sim ≥ 0.6, ep gap ≤ 5): ${crossEpHits.length}` + (crossEpHits.length === 0 ? " ✓" : " ⚠"));
  for (const h of crossEpHits.slice(0, 5)) {
    console.log(`    ep${h.epA} ↔ ep${h.epB}  sim=${h.sim}`);
    console.log(`      A: ${JSON.stringify(h.pa)}`);
    console.log(`      B: ${JSON.stringify(h.pb)}`);
  }

  // 3. discovery phrase ep별 분포 (요약)
  console.log("");
  console.log("── [3] Discovery phrase per-ep count ──");
  for (const ep of epList) {
    console.log(`  ep${String(ep).padStart(2)}: ${phrasesByEp[ep].length}건`);
  }

  // ── verdict ──
  console.log("");
  console.log("── [Verdict] ──");
  const flags = [];
  if (duplicates.length > 0) flags.push(`exact duplicate ${duplicates.length}건`);
  if (crossEpHits.length > 0) flags.push(`similar discovery ${crossEpHits.length}건 (gap≤5)`);
  console.log(flags.length ? `  DUPLICATE DISCOVERY FLAGS: ${flags.join(" | ")}` : "  DUPLICATE DISCOVERY FLAGS: 없음 ✓");

  await pool.end();
}

main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(1); });
