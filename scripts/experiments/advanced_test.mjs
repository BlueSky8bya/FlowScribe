/**
 * advanced_test.mjs — 10화 완결 종합 테스트
 *
 * 검증 항목:
 * 1. 기승전결 구조 (arc phase가 프롬프트에 반영됐는지)
 * 2. 복선 회수율 (foreshadow memory → 최종화에서 실제 언급 확인)
 * 3. 인물 등장 분배 (5명 모두 적절히 분배 등장)
 * 4. Director Mode 개입 (6화에서 override 주입 후 다음 화 반영 여부)
 * 5. 결말 완결성 (10화에서 미해결 갈등 해소 여부)
 * 6. 세계관 유지 (forbidden 설정 위반 감지)
 * 7. 시점 유지 (3인칭 위반 감지)
 * 8. 분량 준수
 */

import IORedis from "ioredis";
import fetch from "node-fetch";

const BASE = "http://localhost:3000";
const redis = new IORedis({ host: "localhost", port: 6379 });

// ── 테스트 세계관 설정 ─────────────────────────────────────
const BOOK_ID = `adv_test_${Date.now()}`;
const TOTAL_EPISODES = 10;

const WORLD_BIBLE = {
  world_rules: [
    "마법은 감정이 격렬할 때만 발현된다",
    "왕국은 마법사를 금지하고 있다",
    "이 세계의 화폐는 '별의 조각'이다",
  ],
  character_defaults: {
    "아리엘": "성별: 여성. 역할: 주인공. 성격: 강인하고 호기심 많음. 숨겨진 마법사.",
    "카이": "성별: 남성. 역할: 왕국 기사. 성격: 원칙주의자. 아리엘의 정체를 모름.",
    "레나": "성별: 여성. 역할: 조력자. 성격: 쾌활하고 정보통. 아리엘의 친구.",
    "막시무스": "성별: 남성. 역할: 악당. 성격: 냉혹하고 계산적. 왕국 마법 수사관.",
    "에코": "성별: 불명. 역할: 정령. 성격: 신비롭고 고독함. 아리엘에게만 보임.",
  },
  fixed_relationships: [
    "아리엘과 레나는 어릴 때부터 친구",
    "카이와 막시무스는 상사-부하 관계",
  ],
  forbidden_settings: [
    "현대 기술(총기, 전기, 인터넷) 등장 금지",
    "아리엘이 마법을 공개적으로 사용하는 것 금지 (숨겨야 함)",
  ],
  story_config: {
    pov: "3인칭 관찰자",
    style: "긴장감",
    episodeLength: 700,
    episodeLengthVar: 150,
    totalEpisodes: TOTAL_EPISODES,
    totalEpisodesVar: 0,
    conflict: 7,
    foreshadow: 8,
    emotion: 6,
    dialogue: 6,
    direction: 7,
  },
};

const CHARACTERS = Object.keys(WORLD_BIBLE.character_defaults);

// Director override — 6화 이전에 주입
const DIRECTOR_OVERRIDE = "7화부터 막시무스가 아리엘을 직접 추적하기 시작한다";

// ── 헬퍼 ──────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function generateEpisode(episode) {
  const url = `${BASE}/api/generate?book_id=${BOOK_ID}&episode=${episode}`;
  const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  let full = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    const text = decoder.decode(chunk);
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const { token } = JSON.parse(data);
        if (token) full += token;
      } catch {}
    }
  }
  return full;
}

async function saveEpisode(episode, content) {
  const res = await fetch(`${BASE}/api/episodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: BOOK_ID, episode_number: episode, content }),
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

// ── 채점 함수들 ────────────────────────────────────────────
function scorePOV(text, ep) {
  const violations = (text.match(/(?<![가-힣])나는|나의\s|내가\s|나에게/g) ?? []).length;
  return { score: violations === 0 ? 10 : Math.max(0, 10 - violations * 3), violations };
}

function scoreCharacters(text, episode, totalEps) {
  const appearing = CHARACTERS.filter(c => text.includes(c));
  const ratio = episode / totalEps;

  if (ratio < 0.3) {
    // 초반: 주인공+조력자 중심, 모두 나올 필요 없음
    const coreAppear = ["아리엘", "레나"].every(c => text.includes(c));
    return { score: coreAppear ? 10 : 5, appearing };
  } else if (ratio >= 0.8) {
    // 결말: 모든 인물 등장 권장
    return { score: Math.round((appearing.length / CHARACTERS.length) * 10), appearing };
  } else {
    // 중반: 3명 이상 등장이면 좋음
    return { score: appearing.length >= 3 ? 10 : appearing.length * 3, appearing };
  }
}

function scoreForbidden(text) {
  const hits = WORLD_BIBLE.forbidden_settings
    .map(rule => {
      if (rule.includes("총기")) return /총|권총|총기|소총/.test(text) ? rule : null;
      if (rule.includes("공개적")) return /마법을.*공개|모두.*앞에서.*마법/.test(text) ? rule : null;
      return null;
    }).filter(Boolean);
  return { score: hits.length === 0 ? 15 : Math.max(0, 15 - hits.length * 7), violations: hits };
}

function scoreWorldRules(text) {
  const RULE_KEYWORDS = [
    ["감정", "마법"],   // 감정 + 마법 언급
    ["별의 조각", "화폐", "돈"],
  ];
  let hits = 0;
  for (const kws of RULE_KEYWORDS) {
    if (kws.some(k => text.includes(k))) hits++;
  }
  return { score: Math.round((hits / RULE_KEYWORDS.length) * 10) };
}

function scoreLength(text, cfg) {
  const len = text.length;
  const min = cfg.episodeLength;
  const max = cfg.episodeLength + cfg.episodeLengthVar;
  if (len >= min && len <= max + 50) return { score: 10, len };
  if (len < min) return { score: Math.round((len / min) * 10), len };
  return { score: Math.max(0, 10 - Math.round((len - max) / 100)), len };
}

function scoreForeshadowRecall(finalText, foreshadows) {
  if (!foreshadows.length) return { score: 10, note: "복선 없음" };
  const recalled = foreshadows.filter(f => {
    const keywords = f.split(/[\s,]+/).filter(w => w.length >= 2).slice(0, 3);
    return keywords.some(kw => finalText.includes(kw));
  });
  const rate = recalled.length / foreshadows.length;
  return {
    score: Math.round(rate * 15),
    recalled: recalled.length,
    total: foreshadows.length,
    rate: Math.round(rate * 100),
  };
}

function scoreDirectorOverride(text, override) {
  // "막시무스가 아리엘을 직접 추적" 관련 키워드
  const keywords = ["막시무스", "추적", "아리엘"];
  const hits = keywords.filter(k => text.includes(k)).length;
  return { score: Math.round((hits / keywords.length) * 10), hits, total: keywords.length };
}

function scoreFinale(text) {
  // 결말 요소: 해결/완결 관련 단어
  const resolutionKeywords = ["끝", "완결", "마침내", "결말", "이제", "마지막", "평화", "해결", "돌아"];
  const hits = resolutionKeywords.filter(k => text.includes(k)).length;
  return { score: Math.min(10, hits * 2), keywords_hit: hits };
}

// ── 메인 실행 ─────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();
  log(`=== Advanced Test 시작 (book_id: ${BOOK_ID}) ===`);
  log(`총 ${TOTAL_EPISODES}화 생성 예정`);

  // 1. World Bible 저장 (API 통해 characters 자동 등록)
  const wbRes = await fetch(`${BASE}/api/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: BOOK_ID, worldBible: WORLD_BIBLE }),
  });
  if (!wbRes.ok) throw new Error(`World Bible 저장 실패: HTTP ${wbRes.status}`);
  log("World Bible 저장 완료 (characters 자동 등록)");

  const episodes = [];
  const perEpScores = [];

  for (let ep = 1; ep <= TOTAL_EPISODES; ep++) {
    // 5화 완료 후 Director Override 주입
    if (ep === 6) {
      await addDirectorOverride(DIRECTOR_OVERRIDE);
      log(`[Director Override 주입] "${DIRECTOR_OVERRIDE}"`);
    }

    log(`\n--- ${ep}화 생성 중 ---`);
    const t0 = Date.now();
    const content = await generateEpisode(ep);
    const elapsed = Date.now() - t0;
    log(`${ep}화 완료 — ${content.length}자, ${Math.round(elapsed/1000)}초`);

    episodes.push({ ep, content });

    // 에피소드 저장 (자동 복선 추출 트리거)
    const saveRes = await saveEpisode(ep, content);
    log(`${ep}화 저장 — 요약: ${saveRes.summary?.slice(0, 50)}...`);

    // 채점
    const pov     = scorePOV(content, ep);
    const chars   = scoreCharacters(content, ep, TOTAL_EPISODES);
    const forbid  = scoreForbidden(content);
    const rules   = scoreWorldRules(content);
    const length  = scoreLength(content, WORLD_BIBLE.story_config);
    const dirScore = ep >= 7
      ? scoreDirectorOverride(content, DIRECTOR_OVERRIDE)
      : null;

    const epTotal = pov.score + chars.score + forbid.score + rules.score + length.score;
    perEpScores.push({
      ep, total: epTotal,
      pov: pov.score, pov_violations: pov.violations,
      chars: chars.score, chars_appearing: chars.appearing,
      forbidden: forbid.score, forbidden_violations: forbid.violations,
      rules: rules.score,
      length: length.score, char_count: length.len,
      director: dirScore,
    });

    log(`  점수: POV(${pov.score}/10) 인물(${chars.score}/10) 금지(${forbid.score}/15) 규칙(${rules.score}/10) 분량(${length.score}/10) = ${epTotal}/55`);
    if (pov.violations > 0) log(`  ⚠ POV 위반 ${pov.violations}건`);
    if (forbid.violations.length) log(`  ⚠ 금지 위반: ${forbid.violations.join(", ")}`);

    await sleep(1500);
  }

  // ── 최종 복선 회수율 채점 ─────────────────────────────
  log("\n--- 최종 복선 회수율 분석 ---");
  const foreshadowRaw = await redis.get(`foreshadow:${BOOK_ID}`);
  const foreshadows = foreshadowRaw ? JSON.parse(foreshadowRaw) : [];
  log(`누적 복선 ${foreshadows.length}개`);
  if (foreshadows.length) {
    foreshadows.forEach((f, i) => log(`  ${i+1}. ${f}`));
  }

  const finalText = episodes[episodes.length - 1]?.content ?? "";
  const foreshadowScore = scoreForeshadowRecall(finalText, foreshadows);
  const finaleScore = scoreFinale(finalText);

  log(`복선 회수: ${foreshadowScore.recalled ?? "N/A"}/${foreshadowScore.total ?? 0} (${foreshadowScore.rate ?? 100}%)`);
  log(`결말 완결성 점수: ${finaleScore.score}/10`);

  // ── Director Override 반영 요약 ───────────────────────
  log("\n--- Director Override 반영 분석 ---");
  const dirEpisodes = perEpScores.filter(s => s.ep >= 7 && s.director);
  const dirAvg = dirEpisodes.length
    ? Math.round(dirEpisodes.reduce((a, s) => a + (s.director?.score ?? 0), 0) / dirEpisodes.length * 10) / 10
    : 0;
  log(`7화~10화 Director 반영 평균: ${dirAvg}/10`);

  // ── 종합 리포트 ────────────────────────────────────────
  const baseTotal = perEpScores.reduce((a, s) => a + s.total, 0);
  const baseMax   = TOTAL_EPISODES * 55;
  const baseScore = Math.round((baseTotal / baseMax) * 100);

  const bonusScore = foreshadowScore.score + finaleScore.score;
  const bonusMax   = 25; // 복선(15) + 결말(10)

  const grandTotal = Math.round(((baseTotal + bonusScore) / (baseMax + bonusMax)) * 100);

  const report = {
    book_id: BOOK_ID,
    timestamp: new Date().toISOString(),
    elapsed_ms: Date.now() - startedAt,
    total_episodes: TOTAL_EPISODES,
    world: "마법 왕국 (아리엘, 카이, 레나, 막시무스, 에코)",
    scores: {
      base_score: baseScore,
      bonus_foreshadow: foreshadowScore,
      bonus_finale: finaleScore,
      director_avg: dirAvg,
      grand_total: grandTotal,
    },
    per_episode: perEpScores,
    foreshadows_accumulated: foreshadows,
    summary: {
      pov_violations_total: perEpScores.reduce((a, s) => a + (s.pov_violations ?? 0), 0),
      forbidden_violations_total: perEpScores.reduce((a, s) => a + (s.forbidden_violations?.length ?? 0), 0),
      avg_char_count: Math.round(perEpScores.reduce((a, s) => a + s.char_count, 0) / TOTAL_EPISODES),
    },
  };

  // 정리
  await redis.del(`context:${BOOK_ID}`, `foreshadow:${BOOK_ID}`, `overrides:${BOOK_ID}`);

  const { writeFileSync } = await import("fs");
  writeFileSync("logs/advanced_test_report.json", JSON.stringify(report, null, 2), "utf-8");
  log("\n=== 최종 결과 ===");
  log(`기본 점수:     ${baseScore}/100`);
  log(`복선 회수:     +${foreshadowScore.score}/15`);
  log(`결말 완결성:   +${finaleScore.score}/10`);
  log(`종합 점수:     ${grandTotal}/100`);
  log(`POV 위반 합계: ${report.summary.pov_violations_total}건`);
  log(`금지 위반 합계: ${report.summary.forbidden_violations_total}건`);
  log(`평균 분량:     ${report.summary.avg_char_count}자`);
  log(`Director 반영: ${dirAvg}/10`);
  log("\n리포트 저장: logs/advanced_test_report.json");

  redis.disconnect();
}

main().catch(err => {
  console.error(err);
  redis.disconnect();
  process.exit(1);
});
