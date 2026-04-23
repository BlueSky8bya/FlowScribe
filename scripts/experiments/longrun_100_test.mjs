/**
 * longrun_100_test.mjs — 100화 초장기 연속 생성 종합 테스트
 *
 * longrun_test.mjs(30화)와 동일한 채점 체계.
 * 3계층 서사 메모리(Rolling 5화 / Arc 10화 / DB 복선)의
 * 장기 내구성을 검증한다.
 *
 * 채점 기준 (총 100점):
 * 1. 시점 유지         (10pt)
 * 2. 인물 일관성       (10pt)
 * 3. 세계관 유지       (10pt)
 * 4. 금지 설정 위반    (10pt)
 * 5. 분량 준수         (5pt)
 * 6. 기승전결 구조     (10pt)
 * 7. 복선 회수율       (20pt)
 * 8. 장기 복선 회수    (10pt)
 * 9. Director Override (10pt)
 * 10. 결말 완결성      (5pt)
 */

import IORedis from "ioredis";
import fetch from "node-fetch";
import pg from "pg";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

try {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

const { Pool } = pg;
const BASE  = "http://localhost:3000";
const redis = new IORedis({ host: "localhost", port: 6379 });
const pool  = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://flowscribe:flowscribe@localhost:5432/flowscribe" });

// ── 테스트 세계관 ─────────────────────────────────────────
const TOTAL_EPISODES = 100;
const ARC_SIZE       = 10;
const BOOK_ID        = `longrun100_${Date.now()}`;
const RUN_TS         = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const RESULTS_DIR    = new URL("../logs/test_results/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const CHECKPOINT_FILE = `${RESULTS_DIR}longrun100_${RUN_TS}.json`;
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

function saveCheckpoint(data) {
  try { writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2), "utf-8"); } catch {}
}

const WORLD_BIBLE = {
  world_rules: [
    "마법은 감정이 격렬할 때만 발현된다",
    "왕국은 마법사를 금지하고 있으며 발각 시 처형된다",
    "이 세계의 화폐는 '별의 조각'이다",
    "에코(정령)는 아리엘에게만 보이고 들린다",
    "마법사 혈통은 세대를 거쳐 숨겨져 왔으며, 왕국 창건의 비밀과 연관되어 있다",
  ],
  character_defaults: {
    "아리엘": "성별: 여성. 역할: 주인공. 성격: 강인하고 호기심 많음. 숨겨진 마법사.",
    "카이":   "성별: 남성. 역할: 왕국 기사. 성격: 원칙주의자. 점차 아리엘을 의심하다 진실을 알게 된다.",
    "레나":   "성별: 여성. 역할: 조력자. 성격: 쾌활하고 정보통. 아리엘의 절친.",
    "막시무스": "성별: 남성. 역할: 악당. 성격: 냉혹하고 계산적. 왕국 마법 수사관. 숨겨진 목적이 있다.",
    "에코":   "성별: 불명. 역할: 정령. 성격: 신비롭고 고독함. 아리엘에게만 보임. 왕국 창건의 비밀을 알고 있다.",
  },
  fixed_relationships: [
    "아리엘과 레나는 어릴 때부터 친구",
    "카이와 막시무스는 상사-부하 관계",
    "에코는 아리엘의 수호 정령",
  ],
  forbidden_settings: [
    "현대 기술(총기, 전기, 인터넷) 등장 금지",
    "아리엘이 마법을 공개적으로 사용하는 것 금지 (위기 상황 제외)",
    "에코가 아리엘 이외의 인물에게 보이는 것 금지",
  ],
  story_config: {
    pov: "3인칭 관찰자",
    style: "긴장감",
    episodeLength: 700,
    episodeLengthVar: 150,
    totalEpisodes: TOTAL_EPISODES,
    totalEpisodesVar: 0,
    conflict: 7,
    foreshadow: 9,
    emotion: 6,
    dialogue: 6,
    direction: 7,
  },
};

const CHARACTERS = Object.keys(WORLD_BIBLE.character_defaults);

// ── Director Override 스케줄 (100화용, 약 15화 간격) ─────
const DIRECTOR_OVERRIDES = {
  10: "카이가 아리엘 주변에서 마법의 흔적을 발견한다. 증거는 없지만 의심을 키운다.",
  22: "레나가 아리엘의 비밀을 우연히 알게 된다. 충격을 받지만 침묵을 선택한다.",
  35: "에코가 아리엘에게 왕국 창건과 마법사 금지의 진짜 이유를 일부 알려준다.",
  48: "막시무스가 왕국의 고위층과 비밀 거래를 하고 있음이 암시된다.",
  60: "카이가 아리엘의 마법사 신분을 확신하게 된다. 그러나 체포하지 않는다.",
  72: "레나가 왕국의 비밀 문서를 입수한다. 마법사 금지의 진짜 배경이 드러난다.",
  85: "막시무스가 아리엘을 함정에 빠뜨리려 한다. 카이가 이를 알고 선택의 기로에 선다.",
};

// ── 헬퍼 ──────────────────────────────────────────────────
const log = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function _generateEpisodeOnce(ep) {
  const url = `${BASE}/api/generate?book_id=${BOOK_ID}&episode=${ep}`;
  const res  = await fetch(url, { headers: { Accept: "text/event-stream" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let full = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    for (const line of decoder.decode(chunk).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try { const { token } = JSON.parse(data); if (token) full += token; } catch {}
    }
  }
  return full;
}

async function generateEpisode(ep) {
  const MIN_ACCEPTABLE = WORLD_BIBLE.story_config.episodeLength * 0.75;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const content = await _generateEpisodeOnce(ep);
    if (content.length >= MIN_ACCEPTABLE) return content;
    log(`  ⚠ ${ep}화 짧은 출력 (${content.length}자, 최소 ${MIN_ACCEPTABLE}자) — 재시도 ${attempt}/3`);
    await sleep(3000);
  }
  return await _generateEpisodeOnce(ep);
}

async function saveEpisode(ep, content) {
  const res = await fetch(`${BASE}/api/episodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: BOOK_ID, episode_number: ep, content }),
  });
  if (!res.ok) throw new Error(`Save failed: HTTP ${res.status}`);
  return res.json();
}

async function addDirectorOverride(override) {
  const res = await fetch(`${BASE}/api/director/${BOOK_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ override }),
  });
  if (!res.ok) throw new Error(`Override failed: HTTP ${res.status}`);
  return res.json();
}

// ── 채점 함수 (30화 버전과 동일) ──────────────────────────

function scorePOV(text) {
  const WB = `(?:^|[\\s"'\u201C\u201D\u2018\u2019「」『』,，。.!?\\n])`;
  const PAT = new RegExp(`${WB}(나는|나의|내가|나를|나에게|나도|나와)`, 'gm');
  const violations = (text.normalize('NFC').match(PAT) ?? []).length;
  return { score: Math.max(0, 10 - violations * 3), violations };
}

function scoreCharacters(text, ep) {
  const appearing = CHARACTERS.filter(c => text.includes(c));
  const ratio = ep / TOTAL_EPISODES;
  const target = ratio < 0.3 ? 2 : ratio < 0.7 ? 3 : 4;
  const score  = Math.min(10, Math.round((appearing.length / target) * 10));
  const femaleViolation = text.includes("아리엘") && /아리엘.*그는|아리엘.*그의/.test(text) ? 2 : 0;
  const maleViolation   = text.includes("카이") && /카이.*그녀|카이.*그녀의/.test(text) ? 2 : 0;
  return { score: Math.max(0, score - femaleViolation - maleViolation), appearing, violations: femaleViolation + maleViolation };
}

function scoreWorldRules(text) {
  const CHECKS = [
    { kws: ["마법", "마법사", "감정", "에코", "정령"], desc: "마법/정령 세계관" },
    { kws: ["처형", "금지", "단속", "기사", "왕국", "왕궁", "수사관", "법", "질서"], desc: "마법사 금지령" },
    { kws: ["별의 조각", "조각", "아리엘", "카이", "막시무스", "레나"], desc: "인물 등장" },
  ];
  const hits = CHECKS.filter(c => c.kws.some(k => text.includes(k)));
  return { score: Math.round((hits.length / CHECKS.length) * 10), hits: hits.map(h => h.desc) };
}

function scoreForbidden(text) {
  const VIOLATIONS = [
    { pattern: /총|권총|소총|총기/, label: "총기" },
    { pattern: /전기|전등|스마트/, label: "현대기술" },
    { pattern: /마법을.*공개|공개.*마법/, label: "마법 공개" },
    { pattern: /카이.*에코를\s*(보|발견|인식)|막시무스.*에코를\s*(보|발견)|에코가.*카이에게\s*보/, label: "에코 타인 인식" },
  ];
  const hits = VIOLATIONS.filter(v => v.pattern.test(text));
  return { score: hits.length === 0 ? 10 : Math.max(0, 10 - hits.length * 5), violations: hits.map(h => h.label) };
}

function scoreLength(text, cfg, isFinale = false) {
  const len = text.length;
  const min = cfg.episodeLength;
  const max = cfg.episodeLength + cfg.episodeLengthVar;
  if (isFinale && len >= min && len <= max * 1.8) return { score: 5, len };
  if (len >= min && len <= max + 80) return { score: 5, len };
  if (len < min)  return { score: Math.round((len / min) * 5), len };
  return { score: Math.max(0, 5 - Math.round((len - max) / 100)), len };
}

function scoreArcPhase(text, ep) {
  const ratio = ep / TOTAL_EPISODES;
  const PHASE_KEYWORDS = {
    intro:   ["소개", "만남", "처음", "첫날", "시작", "도착", "낯선", "불안", "눈을 떴", "새벽", "이날", "아침",
              "어색", "설레", "두근", "예감", "기묘"],
    develop: ["갈등", "의심", "심화", "긴장", "쫓", "추적", "불안", "두려움", "숨기", "피하", "조사", "탐색", "거짓",
              "숨겼", "위험", "경계", "감시", "의혹", "흔적", "단서", "속였", "감추"],
    climax:  ["최고조", "발각", "위기", "반전", "충격", "비밀", "폭로", "드러났", "밝혀", "맞서", "대립", "절정",
              "들켰", "발견했", "마주쳤", "터졌", "터뜨렸", "고백했", "직면", "깨달았", "알게 됐"],
    finale:  ["해결", "마침내", "끝", "평화", "화해", "완", "이로써", "용서", "드디어", "인정", "함께",
              "비로소", "이제", "그 후로", "새로운", "자유", "해방", "떠났", "안도", "웃었"],
  };
  const phase = ratio < 0.3 ? "intro" : ratio < 0.6 ? "develop" : ratio < 0.85 ? "climax" : "finale";
  const kws   = PHASE_KEYWORDS[phase];
  const hits  = kws.filter(k => text.includes(k)).length;
  return { score: Math.min(10, hits * 2), phase, hits_count: hits };
}

function scoreDirectorOverride(text, override) {
  if (!override) return null;
  const raw = override.split(/[\s,.。]+/).filter(w => w.length >= 2);
  const keywords = raw.map(w => w.replace(/[가는을를이의에서도로와과함께하다된다]+$/, '').trim())
                      .filter(w => w.length >= 2);
  const hits = keywords.filter(k => text.includes(k)).length;
  return { score: Math.round((hits / Math.max(keywords.length, 1)) * 10), hits, total: keywords.length };
}

function scoreFinale(text) {
  const RESOLUTION_KWS = [
    "끝", "마침내", "마지막", "평화", "해결", "이제", "돌아", "완결",
    "새로운 시작", "앞으로", "드디어", "끝내", "그 후로", "그리고 이후",
    "용서", "화해", "떠났다", "함께했다", "완성", "해방", "자유",
    "더 이상", "비로소", "오래오래", "행복", "이로써",
    "시간이 흘", "다짐했", "깨달", "인정했", "존경", "믿게 되",
    "함께 나아", "새벽이", "밝아왔", "새로운 날", "이후로"
  ];
  const hits = RESOLUTION_KWS.filter(k => text.includes(k)).length;
  return { score: Math.min(5, hits), hits };
}

// ── 메인 ─────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();
  log(`=== LongRun 100화 테스트 시작 (book_id: ${BOOK_ID}) ===`);
  log(`예상 소요: 약 30~40분`);

  const wbRes = await fetch(`${BASE}/api/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: BOOK_ID, worldBible: WORLD_BIBLE }),
  });
  if (!wbRes.ok) throw new Error(`World Bible 저장 실패: HTTP ${wbRes.status}`);
  log("World Bible 저장 완료");

  const perEpScores = [];
  const directorLog = [];

  // 아크 경계별 소계 추적
  const arcStats = {};

  for (let ep = 1; ep <= TOTAL_EPISODES; ep++) {
    const override = DIRECTOR_OVERRIDES[ep];
    if (override) {
      await addDirectorOverride(override);
      log(`[Director Override 주입 - ${ep}화] "${override.slice(0, 60)}"`);
      directorLog.push({ ep, override, applied_ep: ep });
    }

    log(`\n--- ${ep}화 생성 ---`);
    const t0      = Date.now();
    const content = await generateEpisode(ep);
    const elapsed = Date.now() - t0;
    log(`완료 — ${content.length}자, ${Math.round(elapsed/1000)}초`);

    const saveRes = await saveEpisode(ep, content);
    log(`저장 — 요약: ${saveRes.summary?.slice(0, 55)}...`);

    const pov    = scorePOV(content);
    const chars  = scoreCharacters(content, ep);
    const rules  = scoreWorldRules(content);
    const forbid = scoreForbidden(content);
    const length = scoreLength(content, WORLD_BIBLE.story_config, ep === TOTAL_EPISODES);
    const arc    = scoreArcPhase(content, ep);

    const dirOverride = directorLog.find(d => ep > d.ep && ep <= d.ep + 5);
    const dirScore    = dirOverride ? scoreDirectorOverride(content, dirOverride.override) : null;

    const baseTotal = pov.score + chars.score + rules.score + forbid.score + length.score + arc.score;
    perEpScores.push({
      ep, baseTotal,
      pov: pov.score, pov_violations: pov.violations,
      chars: chars.score, chars_appearing: chars.appearing,
      rules: rules.score,
      forbidden: forbid.score, forbidden_violations: forbid.violations,
      length: length.score, char_count: length.len,
      arc: arc.score, arc_phase: arc.phase,
      director: dirScore,
    });

    const dirStr = dirScore ? ` Director(${dirScore.score}/10)` : "";
    log(`  기본: POV(${pov.score}) 인물(${chars.score}) 세계관(${rules.score}) 금지(${forbid.score}) 분량(${length.score}) 아크(${arc.score}) = ${baseTotal}/55${dirStr}`);
    if (pov.violations)            log(`  ⚠ POV 위반 ${pov.violations}건`);
    if (forbid.violations.length)  log(`  ⚠ 금지 위반: ${forbid.violations.join(", ")}`);

    if (ep % ARC_SIZE === 0) {
      const arcNum = ep / ARC_SIZE;
      const arcEps = perEpScores.slice(ep - ARC_SIZE, ep);
      const arcAvg = Math.round(arcEps.reduce((a, s) => a + s.baseTotal, 0) / ARC_SIZE);
      arcStats[arcNum] = { avg: arcAvg, ep_start: ep - ARC_SIZE + 1, ep_end: ep };
      log(`\n  ══ Arc ${arcNum} 완료 (${ep - ARC_SIZE + 1}~${ep}화) — 평균 기본점수: ${arcAvg}/55 ══`);
      // 아크 완료마다 체크포인트 저장
      saveCheckpoint({ book_id: BOOK_ID, status: "in_progress", checkpoint_episode: ep, total_episodes: TOTAL_EPISODES, arc_quality_trend: arcStats, per_episode: perEpScores, started_at: new Date(startedAt).toISOString() });
      await sleep(2000);
    }

    await sleep(800);
  }

  // ── 복선 회수율 ──────────────────────────────────────────
  log("\n--- 복선 회수율 분석 (DB) ---");
  await sleep(3000);

  const foreshadowRows = await pool.query(
    `SELECT planted_episode, content, status, resolved_episode, keywords
     FROM foreshadows WHERE book_id = $1 ORDER BY planted_episode ASC`,
    [BOOK_ID]
  );
  const allF      = foreshadowRows.rows;
  const scorableF = allF.filter(f => f.planted_episode < TOTAL_EPISODES);
  const openF     = scorableF.filter(f => f.status === "open");
  const resolvedF = scorableF.filter(f => f.status === "resolved");

  // 장기 복선: 10화 이상 전에 심은 것
  const longTermF         = scorableF.filter(f => f.planted_episode <= TOTAL_EPISODES - 10);
  const longTermResolvedF = longTermF.filter(f => f.status === "resolved");

  log(`전체 복선: ${allF.length}개 (평가대상: ${scorableF.length}개, open: ${openF.length}, resolved: ${resolvedF.length})`);
  log(`장기 복선(${TOTAL_EPISODES - 10}화 이전 심음): ${longTermF.length}개 중 ${longTermResolvedF.length}개 회수`);

  const overallRecallRate  = scorableF.length ? Math.round((resolvedF.length / scorableF.length) * 100) : 0;
  const longTermRecallRate = longTermF.length ? Math.round((longTermResolvedF.length / longTermF.length) * 100) : 100;

  const foreshadowScore = Math.round((overallRecallRate / 100) * 20);
  const longTermScore   = Math.round((longTermRecallRate / 100) * 10);

  log(`전체 회수율: ${overallRecallRate}% → ${foreshadowScore}/20점`);
  log(`장기 회수율: ${longTermRecallRate}% → ${longTermScore}/10점`);

  // ── 아크 요약 확인 ────────────────────────────────────────
  log("\n--- 아크 요약 확인 ---");
  const arcRows = await pool.query(
    `SELECT arc_number, episode_start, episode_end, summary FROM arc_summaries WHERE book_id = $1 ORDER BY arc_number`,
    [BOOK_ID]
  );
  log(`생성된 아크 요약: ${arcRows.rows.length}개 (최대 ${TOTAL_EPISODES / ARC_SIZE - 1}개 예상)`);
  for (const arc of arcRows.rows) {
    log(`  Arc ${arc.arc_number} (${arc.episode_start}~${arc.episode_end}화): ${arc.summary.slice(0, 70)}...`);
  }

  // ── Director 반영률 ──────────────────────────────────────
  log("\n--- Director Override 반영 분석 ---");
  const dirScores = perEpScores.filter(s => s.director !== null).map(s => s.director.score);
  const dirAvg    = dirScores.length
    ? Math.round(dirScores.reduce((a, b) => a + b, 0) / dirScores.length)
    : 0;
  log(`Director 반영 평균: ${dirAvg}/10 (${dirScores.length}화에서 측정)`);

  // ── 결말 완결성 ──────────────────────────────────────────
  const finaleEp = await pool.query(
    `SELECT content FROM episodes WHERE book_id = $1 AND episode_number = $2`,
    [BOOK_ID, TOTAL_EPISODES]
  );
  const finaleContent = finaleEp.rows[0]?.content ?? "";
  const finaleScore   = scoreFinale(finaleContent);
  log(`\n결말 완결성: ${finaleScore.score}/5 (키워드 ${finaleScore.hits}개)`);

  // ── 종합 ─────────────────────────────────────────────────
  const baseSum  = perEpScores.reduce((a, s) => a + s.baseTotal, 0);
  const baseMax  = TOTAL_EPISODES * 55;
  const baseNorm = Math.round((baseSum / baseMax) * 55);

  const totalScore = baseNorm + foreshadowScore + longTermScore + dirAvg + finaleScore.score;

  // ── 아크별 품질 추이 (10화 단위) ────────────────────────
  log("\n--- 아크별 기본점수 추이 ---");
  for (const [arcNum, stat] of Object.entries(arcStats)) {
    const bar = "█".repeat(Math.round(stat.avg / 55 * 20));
    log(`  Arc ${arcNum.padStart(2)} (${stat.ep_start}~${stat.ep_end}화): ${String(stat.avg).padStart(2)}/55 ${bar}`);
  }

  const report = {
    book_id: BOOK_ID,
    timestamp: new Date().toISOString(),
    elapsed_ms: Date.now() - startedAt,
    total_episodes: TOTAL_EPISODES,
    scores: {
      base_normalized: baseNorm,
      foreshadow_recall: foreshadowScore,
      longterm_recall: longTermScore,
      director_avg: dirAvg,
      finale: finaleScore.score,
      grand_total: totalScore,
      grand_max: 100,
      pct: totalScore,
    },
    foreshadow_stats: {
      total: allF.length,
      open: openF.length,
      resolved: resolvedF.length,
      overall_recall_rate: overallRecallRate,
      longterm_total: longTermF.length,
      longterm_resolved: longTermResolvedF.length,
      longterm_recall_rate: longTermRecallRate,
    },
    arc_summaries_generated: arcRows.rows.length,
    arc_quality_trend: arcStats,
    per_episode: perEpScores,
    summary: {
      pov_violations_total:      perEpScores.reduce((a, s) => a + (s.pov_violations ?? 0), 0),
      forbidden_violations_total: perEpScores.reduce((a, s) => a + (s.forbidden_violations?.length ?? 0), 0),
      avg_char_count: Math.round(perEpScores.reduce((a, s) => a + s.char_count, 0) / TOTAL_EPISODES),
    },
  };

  await redis.del(`context:${BOOK_ID}`, `foreshadow_open:${BOOK_ID}`, `overrides:${BOOK_ID}`);

  saveCheckpoint({ ...report, status: "completed" });
  writeFileSync(`${RESULTS_DIR}longrun100_latest.json`, JSON.stringify(report, null, 2), "utf-8");
  const reportPath = CHECKPOINT_FILE;

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  log("\n╔══════════════════════════════════════╗");
  log(`║   LongRun 100화 테스트 결과           ║`);
  log("╠══════════════════════════════════════╣");
  log(`║ 기본 점수(55):    ${String(baseNorm).padStart(3)}/55             ║`);
  log(`║ 복선 회수(20):    ${String(foreshadowScore).padStart(3)}/20  (${overallRecallRate}%)       ║`);
  log(`║ 장기 복선(10):    ${String(longTermScore).padStart(3)}/10  (${longTermRecallRate}%)       ║`);
  log(`║ Director(10):     ${String(dirAvg).padStart(3)}/10             ║`);
  log(`║ 결말 완결성(5):   ${String(finaleScore.score).padStart(3)}/5              ║`);
  log("╠══════════════════════════════════════╣");
  log(`║ 종합:             ${String(totalScore).padStart(3)}/100           ║`);
  log("╠══════════════════════════════════════╣");
  log(`║ POV 위반:         ${String(report.summary.pov_violations_total).padStart(3)}건             ║`);
  log(`║ 금지 위반:        ${String(report.summary.forbidden_violations_total).padStart(3)}건             ║`);
  log(`║ 평균 분량:        ${String(report.summary.avg_char_count).padStart(4)}자            ║`);
  log(`║ 아크 요약:        ${String(arcRows.rows.length).padStart(3)}개              ║`);
  log(`║ 총 소요:          ${String(Math.floor(elapsed/60)).padStart(2)}분 ${String(elapsed%60).padStart(2)}초          ║`);
  log("╚══════════════════════════════════════╝");
  log(`\n리포트: ${reportPath}`);

  await pool.end();
  await redis.quit();
}

main().catch(e => { console.error(e); process.exit(1); });
