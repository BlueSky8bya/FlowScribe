/**
 * audit_episode_end_state_alignment.mjs — R5B-1.8C / R5B-1.8D
 *
 * 인물의 episode-end 상태 카드(character_dynamic_states)가 실제 renderer 본문의
 * 마지막 의미 있는 등장 시점과 일치하는지 LLM judge로 검증.
 *
 * R5B-1.8D 추가: deterministic detectMeaningfulAppearance를 (ep, character)별로 같이
 * 계산해 LLM verdict와 함께 기록. detector level=weak/none이면 새 guard 정책상 update가
 * 차단됐을 케이스 — 이를 기준으로 "새 guard 후 잔존 severe"를 추정한다.
 *
 * 핵심 원칙:
 *   - 같은 감정군이 길게 유지되어도 본문상 납득 가능하면 PASS.
 *   - 평가 대상: 본문 마지막 시점 상태와 카드 표시의 정확도.
 *
 * Verdict per (ep, character):
 *   PASS  — 본문 마지막 의미 있는 등장의 묘사·대사·행동이 stored emotional_state·
 *           recent_goal과 자연스럽게 일치.
 *   WARN  — 같은 감정군이지만 본문 마지막 근거가 약함.
 *   FAIL  — severe mismatch.
 *
 * Read-only. 본문 미저장. 결과는 .tmp/r5b1_8c_alignment_<bookId>.json.
 *
 * Usage:
 *   node scripts/audit_episode_end_state_alignment.mjs --book-id <uuid> [--max-ep N] [--ep-range from-to] [--appearance-mode meaningful|legacy]
 */
import pg from "pg";
import { writeFileSync, mkdirSync } from "fs";
import { config } from "dotenv";
import { runLLMTask, resolveTaskMultiRoute } from "../dist/services/model_router.js";
import { detectMeaningfulAppearance, isUpdateAllowed } from "../dist/lib/meaningful_appearance.js";
config();

const args = process.argv.slice(2);
const bookId = args[args.indexOf("--book-id") + 1];
const maxEp = parseInt(args[args.indexOf("--max-ep") + 1] ?? "15", 10);
const epRange = args.includes("--ep-range") ? args[args.indexOf("--ep-range") + 1] : null;
const appearanceMode = args.includes("--appearance-mode") ? args[args.indexOf("--appearance-mode") + 1] : "legacy";
if (!bookId) {
  console.error("Usage: --book-id <uuid> [--max-ep 15] [--ep-range 1-15] [--appearance-mode meaningful|legacy]");
  process.exit(1);
}
if (appearanceMode !== "meaningful" && appearanceMode !== "legacy") {
  console.error(`appearance-mode must be 'meaningful' or 'legacy', got '${appearanceMode}'`);
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let epFrom = 1, epTo = maxEp;
if (epRange) {
  const m = epRange.match(/^(\d+)-(\d+)$/);
  if (m) { epFrom = parseInt(m[1], 10); epTo = parseInt(m[2], 10); }
}

function _bodyExcerpt(content) {
  // 본문 전체 — LLM이 인물의 "마지막 의미 있는 등장"을 직접 찾도록.
  // 후반부만 자르면 본문 전반부에 등장한 인물이 absent로 잘못 판정될 수 있음.
  // 화당 평균 ~3000자, 4000자까지 허용.
  return (content ?? "").slice(0, 4000);
}

async function main() {
  const eps = (await pool.query(
    `SELECT episode_number, content FROM episodes
     WHERE book_id=$1 AND episode_number BETWEEN $2 AND $3
     ORDER BY episode_number`,
    [bookId, epFrom, epTo]
  )).rows;
  const dyn = (await pool.query(
    `SELECT episode_number, character_name, emotional_state, recent_goal, location, visibility_state
     FROM character_dynamic_states
     WHERE book_id=$1 AND episode_number BETWEEN $2 AND $3
     ORDER BY episode_number, character_name`,
    [bookId, epFrom, epTo]
  )).rows;

  const dynByEp = {};
  const charSet = new Set();
  for (const r of dyn) {
    if (!dynByEp[r.episode_number]) dynByEp[r.episode_number] = [];
    dynByEp[r.episode_number].push(r);
    charSet.add(r.character_name);
  }

  console.log(`book_id: ${bookId}  episodes: ${eps.length}  characters: ${charSet.size}`);
  console.log("");

  // judge route — gpt-4.1-mini 사용 (속도+비용)
  const routes = resolveTaskMultiRoute("reader_immersion_judge");
  const route = routes.find(r => r.provider === "openai") ?? routes[0];
  if (!route) { console.error("no judge route"); process.exit(1); }
  console.log(`[judge] ${route.provider}/${route.model}`);

  const allRecords = [];
  for (const e of eps) {
    const charsForEp = dynByEp[e.episode_number] ?? [];
    if (charsForEp.length === 0) continue;
    // body 본문 등장 추정 — 본문에 인물명 포함 여부
    const bodyAppeared = {};
    for (const ch of charSet) bodyAppeared[ch] = e.content.includes(ch);

    const body = _bodyExcerpt(e.content);
    const fullBody = e.content ?? "";
    const bodyAppearCount = {};
    const detectorResults = {};
    for (const ch of charSet) {
      const re = new RegExp(ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      bodyAppearCount[ch] = (body.match(re) ?? []).length;
      // R5B-1.8D: deterministic detector — full body 기준 (excerpt 아님, 전체 본문)
      detectorResults[ch] = detectMeaningfulAppearance(fullBody, ch);
    }
    const charsBlock = charsForEp.map(c => ({
      character_name: c.character_name,
      stored_emotional_state: c.emotional_state,
      stored_recent_goal: c.recent_goal,
      visibility_state: c.visibility_state,
      body_name_count: bodyAppearCount[c.character_name] ?? 0,
    }));

    const prompt = `당신은 소설 episode-end state alignment 평가자다.
한 화의 본문 전체와 그 화의 인물별 stored state가 주어진다.
각 인물에 대해, 본문 안 _마지막 의미 있는 등장_ 시점(직접 행동·대사·감정 반응·결정)과 stored state가 일치하는지 PASS/WARN/FAIL로 판정한다.

판정 원칙:
- 본문 전체를 훑어 그 인물의 "마지막 의미 있는 등장"을 찾는다 (이름만 언급/다른 인물의 회상/단순 메타 언급은 제외).
- 같은 감정군이 유지되어도 그 마지막 등장의 행동·대사·결정과 stored가 자연스럽게 어울리면 PASS.
- 마지막 등장 근거가 약하거나 본문 행동이 stored와 약간 어긋나면 WARN.
- severe mismatch는 FAIL:
  (a) 본문 마지막 의미 있는 등장에 명확히 다른 감정인데 stored가 다른 감정
  (b) body_name_count=0 또는 의미 있는 등장 없음(이름만 잠깐 언급)인데 stored가 갱신됨 = absent_update
  (c) stored recent_goal이 본문 행동·결정과 모순됨

[본문 전체]
${body}

[stored state — 각 인물의 episode-end 카드]
${JSON.stringify(charsBlock, null, 2)}

[출력 — JSON 한 객체. 각 인물별 verdict + 근거]
{
  "episode": ${e.episode_number},
  "evaluations": [
    {
      "character": "이름",
      "appeared_in_body": true|false,
      "last_appearance_position": "early|mid|late|absent",
      "rendered_last_summary": "본문 마지막 의미 있는 등장 1줄 요약 (없으면 'absent')",
      "verdict": "PASS|WARN|FAIL",
      "reason": "한 줄. mismatch 시 어떤 종류 (label_mismatch|goal_mismatch|absent_update|weak_evidence|other)"
    }
  ]
}
주의: appeared_in_body는 의미 있는 등장(직접 행동·대사·결정)이 _본문 어디에라도_ 있으면 true. 본문 전체에서 이름만 1~2회 언급되고 직접 행동/대사가 전혀 없으면 false.`;

    process.stdout.write(`  ep${e.episode_number} ... `);
    try {
      const res = await runLLMTask("reader_immersion_judge", {
        route_override: route,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.0,
        max_tokens: 2400,
        json_mode: true,
        timeout_ms: 60000,
      });
      const txt = res.text ?? "";
      let parsed = null;
      try { parsed = JSON.parse(txt); } catch {}
      if (!parsed) {
        const start = txt.indexOf("{");
        const end = txt.lastIndexOf("}");
        if (start >= 0 && end > start) try { parsed = JSON.parse(txt.slice(start, end + 1)); } catch {}
      }
      if (parsed && Array.isArray(parsed.evaluations)) {
        // R5B-1.8D: 각 evaluation에 detector 결과를 attach
        const enriched = parsed.evaluations.map(ev => {
          const det = detectorResults[ev.character];
          return det ? {
            ...ev,
            detector_level: det.level,
            detector_strong_count: det.strong_count,
            detector_medium_count: det.medium_count,
            detector_weak_count: det.weak_count,
            detector_occurrence: det.occurrence_count,
            detector_evidence_types: det.evidence_types,
            detector_would_block: !isUpdateAllowed(det.level),  // weak/none = block
          } : ev;
        });
        const counts = enriched.reduce((acc, ev) => {
          acc[ev.verdict] = (acc[ev.verdict] ?? 0) + 1;
          return acc;
        }, {});
        const blocked = enriched.filter(ev => ev.detector_would_block).length;
        console.log(`PASS=${counts.PASS ?? 0} WARN=${counts.WARN ?? 0} FAIL=${counts.FAIL ?? 0} | block=${blocked} (${res.elapsed_ms}ms)`);
        allRecords.push({ episode: e.episode_number, evaluations: enriched, elapsed_ms: res.elapsed_ms });
      } else {
        console.log(`PARSE_FAIL (${res.elapsed_ms}ms) raw_head: ${txt.slice(0, 120)}`);
        allRecords.push({ episode: e.episode_number, error: "parse_fail", raw_head: txt.slice(0, 200) });
      }
    } catch (err) {
      console.log(`ERR: ${err.message}`);
      allRecords.push({ episode: e.episode_number, error: err.message });
    }
  }

  // ── aggregate ──
  // absent_update 엄격 정의:
  //   appeared_in_body=false + verdict != PASS → severe (실제 alignment 위반)
  //   appeared_in_body=false + verdict == PASS → borderline (carry-forward 정상)
  // R5B-1.8D detector 추가 컬럼:
  //   detector_block       — detector가 weak/none으로 block했을 케이스 수
  //   would_remain_severe  — LLM이 FAIL/absent_severe인데 detector level=strong/medium → 새 guard도 못 잡음
  //   detector_caught      — LLM absent_severe + detector weak/none = 새 guard가 잡았을 것
  console.log("");
  console.log("── [Per-character summary] ──");
  console.log("char    | total | PASS | WARN | FAIL | absent_severe | absent_border | det_block | det_caught | remain_sev");
  const charAgg = {};
  for (const rec of allRecords) {
    if (!Array.isArray(rec.evaluations)) continue;
    for (const ev of rec.evaluations) {
      const k = ev.character;
      if (!charAgg[k]) charAgg[k] = {
        total: 0, PASS: 0, WARN: 0, FAIL: 0,
        absent_severe: 0, absent_border: 0,
        label_mismatch: 0, goal_mismatch: 0,
        detector_block: 0, detector_caught_severe: 0, would_remain_severe: 0,
      };
      charAgg[k].total++;
      charAgg[k][ev.verdict] = (charAgg[k][ev.verdict] ?? 0) + 1;
      const reason = (ev.reason ?? "").toLowerCase();
      const isAbsentSevere = (ev.appeared_in_body === false && ev.verdict !== "PASS");
      if (ev.appeared_in_body === false) {
        if (ev.verdict !== "PASS") charAgg[k].absent_severe++;
        else                         charAgg[k].absent_border++;
      }
      if (reason.includes("label_mismatch") || ev.verdict === "FAIL") charAgg[k].label_mismatch++;
      if (reason.includes("goal_mismatch")) charAgg[k].goal_mismatch++;
      if (ev.detector_would_block) charAgg[k].detector_block++;
      if (isAbsentSevere) {
        if (ev.detector_would_block) charAgg[k].detector_caught_severe++;
        else                          charAgg[k].would_remain_severe++;
      }
    }
  }
  for (const [name, c] of Object.entries(charAgg)) {
    console.log(`${name.padEnd(7)} | ${String(c.total).padStart(5)} | ${String(c.PASS).padStart(4)} | ${String(c.WARN).padStart(4)} | ${String(c.FAIL).padStart(4)} | ${String(c.absent_severe).padStart(13)} | ${String(c.absent_border).padStart(13)} | ${String(c.detector_block).padStart(9)} | ${String(c.detector_caught_severe).padStart(10)} | ${String(c.would_remain_severe).padStart(10)}`);
  }

  // ── totals ──
  console.log("");
  console.log("── [Aggregate] ──");
  let total = 0, pass = 0, warn = 0, fail = 0, absent_severe = 0, absent_border = 0;
  let detector_block = 0, detector_caught = 0, would_remain_severe = 0;
  for (const c of Object.values(charAgg)) {
    total += c.total; pass += c.PASS; warn += c.WARN; fail += c.FAIL;
    absent_severe += c.absent_severe; absent_border += c.absent_border;
    detector_block += c.detector_block;
    detector_caught += c.detector_caught_severe;
    would_remain_severe += c.would_remain_severe;
  }
  const passRate = total ? (pass / total) : 0;
  console.log(`appeared evaluations: ${total}`);
  console.log(`PASS: ${pass} (${(passRate*100).toFixed(1)}%)`);
  console.log(`WARN: ${warn}`);
  console.log(`FAIL: ${fail} ${fail>0?"⚠":""}`);
  console.log(`absent_severe (본문 미등장 + verdict != PASS): ${absent_severe} ${absent_severe>0?"✗":""}`);
  console.log(`absent_border (본문 미등장 + carry-forward PASS): ${absent_border} (정상 carry-forward)`);
  console.log("");
  console.log("── [R5B-1.8D detector simulation — read-only] ──");
  console.log(`detector_block (weak/none → guard가 update 차단): ${detector_block}`);
  console.log(`detector_caught_severe (기존 absent_severe 중 새 detector가 잡았을 것): ${detector_caught} / ${absent_severe}`);
  console.log(`would_remain_severe (새 guard 적용 후 잔존 severe 추정): ${would_remain_severe}`);

  // ── PASS criteria ──
  console.log("");
  console.log(`── [PASS criteria — appearance-mode=${appearanceMode}] ──`);
  const checks = appearanceMode === "meaningful" ? [
    // R5B-1.8D: 새 guard 적용 시 잔존 severe만 본다
    { name: "alignment PASS ≥ 90%",                          pass: passRate >= 0.90 },
    { name: "would_remain_severe (잔존 absent_severe) = 0",  pass: would_remain_severe === 0 },
    { name: "detector_caught_severe = absent_severe",        pass: detector_caught === absent_severe },
  ] : [
    { name: "alignment PASS ≥ 85%",                    pass: passRate >= 0.85 },
    { name: "severe mismatch (FAIL) = 0",              pass: fail === 0 },
    { name: "absent_severe = 0",                       pass: absent_severe === 0 },
  ];
  for (const c of checks) console.log(`  ${c.pass?"✓":"✗"} ${c.name}`);
  const passed = checks.filter(c => c.pass).length;
  console.log("");
  const phaseLabel = appearanceMode === "meaningful" ? "R5B-1.8D" : "R5B-1.8C";
  console.log(`${phaseLabel}: ${passed}/${checks.length} ${passed===checks.length?"✅ READY":"⚠ CONDITIONAL or NOT READY"}`);

  // save
  mkdirSync(".tmp", { recursive: true });
  const outSuffix = appearanceMode === "meaningful" ? "_meaningful" : "";
  const outPath = `.tmp/r5b1_8c_alignment_${bookId}${outSuffix}.json`;
  writeFileSync(outPath, JSON.stringify({
    book_id: bookId, episodes: { from: epFrom, to: epTo },
    appearance_mode: appearanceMode,
    judge: { provider: route.provider, model: route.model },
    records: allRecords,
    summary: {
      total, pass, warn, fail, absent_severe, absent_border, pass_rate: passRate,
      detector_block, detector_caught_severe: detector_caught, would_remain_severe,
    },
    criteria: { passed, total: checks.length, checks },
  }, null, 2), "utf8");
  console.log("");
  console.log(`written: ${outPath}`);

  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e); pool.end(); process.exit(1); });
