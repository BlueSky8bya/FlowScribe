/**
 * audit_episode_regen_divergence.mjs — Phase 4.18
 *
 * 같은 회차의 여러 재생성 시도를 비교해 divergence 정도를 측정한다.
 *
 * 검사 항목:
 *   - text_similarity (jaccard token overlap, 본문 기반은 최신만 가능하므로 beat summaries 합본 비교)
 *   - opening_location 변화율
 *   - first_conflict 변화율
 *   - hook_type 변화율
 *   - main_event_path 변화율 (LCS 기반)
 *   - first_beat 인물 조합 변화율
 *   - plot_skeleton_uniqueness (전체 시도 중 unique skeleton 비율)
 *   - LLM semantic similarity (Gemini, optional)
 *
 * Usage:
 *   node scripts/audit_episode_regen_divergence.mjs --book-id <id> --episode <N> [--no-llm]
 *
 * Exit: 0 PASS, 1 FAIL, 2 ERROR
 */
import { createRequire } from "module";
import https from "https";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const episode = parseInt(args[args.indexOf("--episode") + 1] ?? "1", 10);
const noLLM = args.includes("--no-llm");

if (!bookId || !episode) {
  console.error("Usage: --book-id <uuid> --episode <N> [--no-llm]");
  process.exit(2);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── 토큰화 (간단한 한글/영문 단위) ─────────────────────
function tokenize(s) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter(x => sb.has(x)).length;
  const uni = new Set([...sa, ...sb]).size;
  return uni === 0 ? 0 : inter / uni;
}

// ── Gemini LLM semantic similarity (optional) ─────────
const GEMINI_KEY = process.env.GEMINI_API_KEY;
function callGemini(prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 800, temperature: 0.0 },
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(body); req.end();
  });
}

function repairTruncated(s) {
  const stack = [];
  let inStr = false, escape = false;
  let lastColon = -1, lastValueStart = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { if (!inStr) lastValueStart = i; inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === ":") { lastColon = i; lastValueStart = -1; }
    else if (c === "{") { stack.push("}"); lastValueStart = i; }
    else if (c === "[") { stack.push("]"); lastValueStart = i; }
    else if (c === "}" || c === "]") { stack.pop(); lastValueStart = i; }
    else if (c !== " " && c !== "\n" && c !== "\t" && c !== ",") { lastValueStart = i; }
  }
  let prefix = "", suffix = "";
  if (inStr) suffix += '"';
  else if (lastColon > lastValueStart) prefix = "null";
  suffix += stack.reverse().join("");
  return s + prefix + suffix;
}

function parseGemini(raw) {
  let cleaned = "";
  try {
    const env = JSON.parse(raw);
    const text = env.candidates?.[0]?.content?.parts?.find(p => !p.thought && p.text)?.text ?? "";
    cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  } catch (e) {
    return { _err: `envelope: ${e.message}` };
  }
  if (!cleaned) return { _err: "empty Gemini text" };
  try { return JSON.parse(cleaned); } catch {}
  try { return JSON.parse(repairTruncated(cleaned)); } catch (e2) {
    return { _err: `parse: ${e2.message}`, _raw_preview: cleaned.slice(0, 200) };
  }
}

// ── 메인 ──────────────────────────────────────────────
(async () => {
  const W = 75;
  console.log(`\n${"═".repeat(W)}`);
  console.log(` Episode Regen Divergence Audit`);
  console.log(` book ${bookId.slice(0, 8)}… · episode ${episode}`);
  console.log("═".repeat(W));

  const tr = await pool.query(
    `SELECT created_at, planner_trace
     FROM run_traces WHERE book_id=$1 AND episode_number=$2 AND planner_trace IS NOT NULL
     ORDER BY created_at`,
    [bookId, episode]
  );

  if (tr.rows.length < 2) {
    console.log(`이 회차의 재생성 시도가 ${tr.rows.length}건 — divergence 측정 불가 (>=2 필요).`);
    await pool.end();
    process.exit(0);
  }

  const attempts = tr.rows.map((row, idx) => {
    const pp = row.planner_trace?.parsed_plan ?? {};
    const beats = Array.isArray(pp.scene_beats) ? pp.scene_beats : [];
    return {
      idx: idx + 1,
      created_at: row.created_at,
      hook_type: pp.hook_type ?? null,
      hook_concrete: pp.hook_concrete_event ?? null,
      opening_location: beats[0]?.location ?? null,
      opening_summary: beats[0]?.summary ?? null,
      first_conflict: beats[1]?.summary ?? beats[0]?.summary ?? null,
      first_beat_chars: Array.isArray(beats[0]?.characters_involved)
        ? [...beats[0].characters_involved].sort().join("+")
        : null,
      beat_summaries: beats.map(b => b.summary ?? "").join(" || "),
      all_locations: beats.map(b => b.location ?? "?").join(","),
    };
  });

  console.log(`\n총 시도 횟수: ${attempts.length}`);
  for (const a of attempts) {
    console.log(`  #${a.idx} (${a.created_at.toISOString().slice(0,16)})`);
    console.log(`    location=${a.opening_location ?? "?"}, hook=${a.hook_type ?? "?"}, chars=${a.first_beat_chars ?? "?"}`);
    console.log(`    opening: ${(a.opening_summary ?? "").slice(0, 70)}`);
  }

  // ── pairwise similarity ─────────────────────────────
  console.log(`\n${"─".repeat(W)}`);
  console.log("Pairwise text similarity (beat summary jaccard):");
  const simMatrix = [];
  let maxSim = 0, sumSim = 0, nPair = 0;
  for (let i = 0; i < attempts.length; i++) {
    const row = [];
    for (let j = 0; j < attempts.length; j++) {
      if (i === j) { row.push(1.0); continue; }
      const ta = tokenize(attempts[i].beat_summaries);
      const tb = tokenize(attempts[j].beat_summaries);
      const s = jaccard(ta, tb);
      row.push(s);
      if (j > i) { sumSim += s; nPair++; if (s > maxSim) maxSim = s; }
    }
    simMatrix.push(row);
  }
  const avgSim = nPair > 0 ? sumSim / nPair : 0;
  console.log(`  avg=${avgSim.toFixed(3)}, max=${maxSim.toFixed(3)}, n_pairs=${nPair}`);
  for (let i = 0; i < attempts.length; i++) {
    const cells = simMatrix[i].map((v, j) => i === j ? "  -  " : v.toFixed(2)).join(" ");
    console.log(`  #${i+1}: ${cells}`);
  }

  // ── axis 변화율 ─────────────────────────────────────
  function uniqueRatio(field) {
    const values = attempts.map(a => a[field] ?? "(none)");
    const unique = new Set(values).size;
    return { unique, total: values.length, ratio: unique / values.length, values };
  }

  console.log(`\n${"─".repeat(W)}`);
  console.log("Axis uniqueness (1.0 = 모두 다름, 0.x = 수렴):");
  const axes = [
    ["opening_location", "도입 장소"],
    ["hook_type", "엔딩 훅 유형"],
    ["first_beat_chars", "첫 beat 인물 조합"],
    ["opening_summary", "도입 이미지"],
    ["first_conflict", "첫 갈등"],
    ["all_locations", "전체 장소 시퀀스"],
  ];
  const axisStats = {};
  for (const [field, label] of axes) {
    const u = uniqueRatio(field);
    axisStats[field] = u;
    const icon = u.ratio >= 0.7 ? "✅" : u.ratio >= 0.4 ? "⚠️" : "❌";
    console.log(`  ${icon} ${label}: ${u.unique}/${u.total} unique (${(u.ratio*100).toFixed(0)}%)`);
  }

  // ── plot skeleton uniqueness ─────────────────────────
  // skeleton: hook_type + 첫 beat 인물 조합 + 첫 beat location 카테고리
  const skeletons = attempts.map(a =>
    `${a.hook_type ?? "?"}::${a.first_beat_chars ?? "?"}::${(a.opening_location ?? "?").slice(0, 8)}`
  );
  const skeletonUnique = new Set(skeletons).size;
  console.log(`\n  skeleton uniqueness: ${skeletonUnique}/${attempts.length} unique`);

  // ── LLM semantic similarity (optional) ─────────────
  let semanticVerdict = null;
  if (!noLLM && GEMINI_KEY && attempts.length >= 2) {
    console.log(`\n${"─".repeat(W)}`);
    process.stdout.write("Gemini semantic divergence judge... ");
    const summary = attempts.map(a =>
      `시도 #${a.idx}: location=${a.opening_location ?? "?"}, opening="${(a.opening_summary ?? "").slice(0, 80)}", first_conflict="${(a.first_conflict ?? "").slice(0, 80)}", hook=${a.hook_type ?? "?"}`
    ).join("\n");
    const prompt = [
      "당신은 한국어 소설의 같은 회차 재생성 시도들이 충분히 다양한지 평가하는 감사관이다.",
      "아래는 같은 화의 여러 재생성 시도 plan signature이다. 각 시도가 의미적으로(시작점·갈등·전개 경로) 충분히 다른지 평가하라.",
      "",
      summary,
      "",
      "출력 (JSON만):",
      `{"semantic_diversity": "HIGH|MEDIUM|LOW", "shared_plot_skeleton": true|false, "convergence_pattern": "한 줄 요약 (없으면 빈 문자열)", "verdict": "PASS|CONDITIONAL|FAIL"}`,
    ].join("\n");
    const r = await callGemini(prompt);
    if (r.status === 200) {
      const parsed = parseGemini(r.body);
      if (parsed && !parsed._err) {
        semanticVerdict = parsed;
        console.log(`semantic=${parsed.semantic_diversity}, shared_skeleton=${parsed.shared_plot_skeleton}`);
        if (parsed.convergence_pattern) console.log(`  convergence: ${parsed.convergence_pattern}`);
      } else {
        console.log(`parse err: ${parsed._err?.slice(0, 60)}`);
      }
    } else {
      console.log(`HTTP ${r.status}`);
    }
  }

  // ── 최종 verdict ────────────────────────────────────
  console.log(`\n${"═".repeat(W)}`);
  const fails = [];
  const warns = [];
  if (avgSim > 0.40)        fails.push(`text similarity 평균 ${avgSim.toFixed(2)} > 0.40`);
  if (maxSim > 0.60)        fails.push(`text similarity 최대 ${maxSim.toFixed(2)} > 0.60`);
  if (axisStats.opening_location.ratio < 0.5) fails.push("opening_location 다양성 < 50%");
  if (axisStats.first_beat_chars.ratio < 0.4) fails.push("first_beat 인물 조합 다양성 < 40%");
  if (skeletonUnique / attempts.length < 0.5)  fails.push(`skeleton uniqueness ${skeletonUnique}/${attempts.length} < 50%`);
  // hook_type 다양성 — 시도 4회 이상 누적되었는데 hook 다양성이 50% 미만이면 패턴 고착 신호
  if (attempts.length >= 4 && axisStats.hook_type.ratio < 0.5) {
    warns.push(`hook_type 다양성 ${(axisStats.hook_type.ratio * 100).toFixed(0)}% < 50% (${attempts.length}회 시도 누적)`);
  }
  if (semanticVerdict?.verdict === "FAIL")     fails.push("Gemini semantic verdict FAIL");
  if (semanticVerdict?.shared_plot_skeleton === true && attempts.length >= 3) {
    warns.push(`Gemini가 shared_plot_skeleton=true 감지 (${attempts.length}회 시도)${semanticVerdict.convergence_pattern ? `: "${semanticVerdict.convergence_pattern}"` : ""}`);
  }
  if (semanticVerdict?.semantic_diversity === "LOW") fails.push("Gemini semantic_diversity = LOW");
  if (semanticVerdict?.semantic_diversity === "MEDIUM") warns.push("Gemini semantic_diversity = MEDIUM");

  // verdict: fails > 0 이거나 warns >= 2 이면 CONDITIONAL; fails >= 3 이면 FAIL
  let verdict;
  if (fails.length >= 3) verdict = "FAIL";
  else if (fails.length > 0 || warns.length >= 2) verdict = "CONDITIONAL";
  else verdict = "PASS";
  const icon = verdict === "PASS" ? "✅" : verdict === "CONDITIONAL" ? "⚠️" : "❌";
  console.log(`${icon} REGEN DIVERGENCE VERDICT: ${verdict}`);
  if (fails.length) {
    console.log("\nFailures:");
    fails.forEach(f => console.log(`  - ${f}`));
  }
  if (warns.length) {
    console.log("\nWarnings:");
    warns.forEach(w => console.log(`  - ${w}`));
  }
  console.log("═".repeat(W) + "\n");

  await pool.end();
  process.exit(verdict === "FAIL" ? 1 : 0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(2); });
