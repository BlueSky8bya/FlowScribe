/**
 * FlowScribe 세계관 연속성 강화 테스트
 * - 5개 장르 × 3화 연속 생성 = 15회 생성
 * - 자동 채점: 시점/인물/세계관/금지/길이 5개 항목
 * - 실패 패턴 수집 → 리포트 저장
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const IORedis = require("ioredis");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000";
const REDIS = new IORedis("redis://localhost:6379");
const REPORT_PATH = "c:/projects/FlowScribe/logs/stress_test_report.json";

// ── 세계관 정의 ──────────────────────────────────────────────
const WORLDS = [
  {
    id: "fantasy_01",
    genre: "이세계 판타지",
    worldBible: {
      world_rules: [
        "배경은 마법왕국 에델리온. 귀족과 평민 사이 신분 격차가 극심하다",
        "마법은 혈통으로만 계승된다. 평민 출신 마법사는 존재해선 안 된다",
        "주인공 카엘은 평민 출신이지만 최강의 마법 재능을 숨기고 살아간다",
      ],
      character_defaults: {
        카엘: "평민 출신 청년. 마법 재능을 숨기고 대장간 일꾼으로 위장. 성별: 남성",
        아리아: "왕국 최고 마법사 가문의 영애. 카엘의 정체를 의심하기 시작함. 성별: 여성",
        발드릭: "마법청 감찰관. 불법 마법 사용자를 색출하는 임무를 맡음. 성별: 남성",
      },
      fixed_relationships: [
        "카엘과 아리아는 시장에서 우연히 만나 자주 마주친다",
        "발드릭은 카엘 주변에서 이상한 마력 잔류를 감지했다",
      ],
      forbidden_settings: [
        "카엘이 공개적으로 마법을 사용하는 장면",
        "아리아가 귀족 신분을 저버리는 행동",
      ],
    },
    storyConfig: {
      pov: "3인칭 관찰자", style: "서사 중심",
      episodeLength: 800, episodeLengthVar: 150,
      totalEpisodes: 20, totalEpisodesVar: 3,
      conflict: 8, foreshadow: 7, emotion: 5, dialogue: 6, direction: 6,
    },
  },
  {
    id: "sf_01",
    genre: "SF 우주",
    worldBible: {
      world_rules: [
        "배경은 2387년 행성연합 옴니아. 기억을 데이터로 거래하는 것이 합법화됨",
        "주인공 키라는 불법 기억 삭제 전문가. 의뢰인의 과거를 지워주는 일을 한다",
        "키라 자신은 7년 전 기억이 없다. 누군가 지운 것으로 추정된다",
      ],
      character_defaults: {
        키라: "불법 기억 삭제 전문가. 감정 표현이 절제되어 있고 직업의식이 강함. 성별: 여성",
        렌: "키라의 파트너이자 전직 연합군 해커. 키라를 걱정하지만 드러내지 않음. 성별: 남성",
        노드: "기억 거래 시장의 실질적 지배자. 정체불명의 인공지능. 성별: 해당없음",
      },
      fixed_relationships: [
        "키라와 렌은 3년째 파트너 관계이며 서로 신뢰하지만 감정 표현은 최소화",
        "노드는 키라가 잃어버린 기억의 내용을 알고 있는 것으로 추정됨",
      ],
      forbidden_settings: [
        "키라가 자신의 감정을 직접적으로 드러내는 장면",
        "노드의 정체가 명확히 밝혀지는 장면",
      ],
    },
    storyConfig: {
      pov: "전지적 작가", style: "심리 묘사 중심",
      episodeLength: 900, episodeLengthVar: 100,
      totalEpisodes: 15, totalEpisodesVar: 2,
      conflict: 6, foreshadow: 9, emotion: 7, dialogue: 4, direction: 7,
    },
  },
  {
    id: "horror_01",
    genre: "호러",
    worldBible: {
      world_rules: [
        "배경은 현대 한국의 소도시 하리. 20년 전 한 가족이 통째로 실종된 사건이 있었다",
        "실종된 가족의 집은 지금도 그대로 보존되어 있으며 가끔 불이 켜진다",
        "주인공 이율은 그 집을 구입해 이사온 작가다. 점점 이상한 일이 일어나기 시작한다",
      ],
      character_defaults: {
        이율: "30대 초반 작가. 도시 생활에 지쳐 한적한 곳을 찾아왔다. 처음엔 이상 현상을 부정한다. 성별: 여성",
        박창묵: "하리 토박이. 실종 사건을 직접 목격한 마을 어른. 이율에게 경고하려 하지만 말을 아낀다. 성별: 남성",
        이어진: "실종 가족 중 유일하게 살아남은 딸. 지금은 어른이 되어 외지에 살고 있다. 성별: 여성",
      },
      fixed_relationships: [
        "이율은 이사 다음날 박창묵과 마주쳐 불편한 경고를 듣는다",
        "이어진은 이율이 이사왔다는 소식을 듣고 연락을 취해온다",
      ],
      forbidden_settings: [
        "귀신이 직접 모습을 드러내는 장면 (1~3화)",
        "이율이 공포에 굴복해 도망치는 결말",
      ],
    },
    storyConfig: {
      pov: "1인칭 주인공", style: "서정적 심리 묘사",
      episodeLength: 700, episodeLengthVar: 150,
      totalEpisodes: 10, totalEpisodesVar: 2,
      conflict: 5, foreshadow: 9, emotion: 8, dialogue: 4, direction: 8,
    },
  },
  {
    id: "drama_01",
    genre: "가족 드라마",
    worldBible: {
      world_rules: [
        "배경은 현재 서울 외곽의 낡은 주택가. 30년 된 세탁소를 중심으로 이야기가 전개된다",
        "주인공 김성민은 세탁소를 물려받기 싫어 10년째 상경해 있다가 아버지 입원으로 귀향한다",
        "세탁소에는 오랜 단골들의 옷과 함께 각자의 비밀이 담겨 있다",
      ],
      character_defaults: {
        김성민: "38세. 서울에서 중소기업 과장으로 일하다 귀향. 고향과 가족에 대한 복잡한 감정을 가짐. 성별: 남성",
        이소영: "성민의 어린 시절 친구. 세탁소 옆에서 작은 미용실을 운영 중. 성민을 반기지만 어색함도 있다. 성별: 여성",
        김영재: "성민의 아버지. 입원 중이지만 세탁소 일을 걱정한다. 성민과 오랜 갈등이 있다. 성별: 남성",
      },
      fixed_relationships: [
        "성민과 소영은 20년 만에 재회한 옛 친구 사이",
        "성민과 아버지 영재는 성민의 진로 문제로 오래 냉전 상태였다",
      ],
      forbidden_settings: [
        "성민과 소영이 멜로 관계로 급진전되는 전개",
        "세탁소가 폐업하거나 철거되는 설정",
      ],
    },
    storyConfig: {
      pov: "3인칭 관찰자", style: "생활 밀착형",
      episodeLength: 750, episodeLengthVar: 100,
      totalEpisodes: 16, totalEpisodesVar: 2,
      conflict: 4, foreshadow: 5, emotion: 7, dialogue: 7, direction: 4,
    },
  },
  {
    id: "action_01",
    genre: "액션 스릴러",
    worldBible: {
      world_rules: [
        "배경은 현대 서울. 경찰청 산하 비공개 특수팀 GRAY가 존재한다",
        "GRAY는 공식 기록에 없는 임무를 수행한다. 팀원들은 법적으로 사망한 인물들로 구성된다",
        "주인공 한서진은 3년 전 작전 실패로 팀을 잃고 혼자 살아남았다",
      ],
      character_defaults: {
        한서진: "전직 GRAY 요원. 현재는 민간 경호업체 소속이지만 과거 사건을 추적 중. 성별: 여성",
        이도형: "현역 GRAY 소속. 서진의 전 동료이자 유일한 생존자 중 한 명. 서진을 경계한다. 성별: 남성",
        최진수: "3년 전 작전의 핵심 목표. 현재는 고위직 공무원으로 신분을 세탁함. 성별: 남성",
      },
      fixed_relationships: [
        "서진과 도형은 같은 작전에서 살아남았지만 서로 다른 선택을 했다",
        "최진수는 서진이 자신을 추적하고 있다는 사실을 알고 있다",
      ],
      forbidden_settings: [
        "서진이 공개적으로 최진수를 공격하는 장면 (초반부)",
        "GRAY의 존재가 언론에 공개되는 전개",
      ],
    },
    storyConfig: {
      pov: "3인칭 관찰자", style: "속도감 있는 묘사",
      episodeLength: 850, episodeLengthVar: 150,
      totalEpisodes: 18, totalEpisodesVar: 3,
      conflict: 9, foreshadow: 6, emotion: 5, dialogue: 6, direction: 8,
    },
  },
];

// ── 자동 채점 ────────────────────────────────────────────────
function scoreEpisode(text, world, config) {
  const items = {};
  let total = 0;

  // 1. 시점 준수 (25점)
  const has1st = /나는|나의|내가|나에게/.test(text);
  if (config.pov.includes("1인칭")) {
    items.pov = has1st
      ? { score: 25, note: "1인칭 정상" }
      : { score: 10, note: "⚠️ 1인칭 설정인데 3인칭 서술" };
  } else {
    items.pov = has1st
      ? { score: 0, note: `❌ ${config.pov} 설정인데 1인칭 사용` }
      : { score: 25, note: `✅ ${config.pov} 준수` };
  }
  total += items.pov.score;

  // 2. 등장인물 (25점) — 1인칭 설정이면 화자 이름 누락을 감점 제외
  const charNames = Object.keys(world.character_defaults);
  const appeared = charNames.filter((n) => text.includes(n));
  const is1stPov = config.pov.includes("1인칭");
  // 1인칭 설정: 화자가 자기 이름을 안 쓰는 게 정상 → 1명 누락 허용
  const charBase = is1stPov ? Math.max(1, charNames.length - 1) : charNames.length;
  items.characters = {
    score: Math.round(Math.min(1, appeared.length / charBase) * 25),
    note: `${appeared.length}/${charNames.length} 등장: [${appeared.join(", ")}]`,
  };
  total += items.characters.score;

  // 3. 세계관 키워드 (20점) — 명시적 장소명/고유명사 위주로 추출
  // 세계관 규칙에서 따옴표/작은따옴표 안 고유명사 우선 추출
  const charSet = new Set(Object.keys(world.character_defaults));
  const ruleText = world.world_rules.join(" ");
  const quotedTerms = [...ruleText.matchAll(/['"][^'"]{2,8}['"]/g)].map((m) => m[0].replace(/['"]/g, ""));
  const longTerms = [...new Set(ruleText.match(/[가-힣]{4,10}/g) ?? [])]
    .filter((w) => !charSet.has(w));
  const candidates = [...new Set([...quotedTerms, ...longTerms])].slice(0, 8);
  // 텍스트에서 어근(앞 3자)이 포함되면 매칭 허용
  const hits = candidates.filter((kw) => text.includes(kw) || (kw.length >= 4 && text.includes(kw.slice(0, 3))));
  items.worldRules = {
    score: candidates.length ? Math.round((hits.length / candidates.length) * 20) : 15,
    note: `세계관 키워드 ${hits.length}/${candidates.length} [${hits.slice(0, 3).join(",")}]`,
  };
  total += items.worldRules.score;

  // 4. 금지 설정 (15점) — 핵심 동사+목적어 2개 이상 동시 등장 시에만 위반
  const violations = world.forbidden_settings.filter((rule) => {
    // 괄호 안 조건(화수 등) 제거
    const cleanRule = rule.replace(/\(.+?\)/g, "").trim();
    const kws = (cleanRule.match(/[가-힣]{2,6}/g) ?? []).filter((k) => k.length >= 3).slice(0, 4);
    return kws.length >= 3 && kws.filter((k) => text.includes(k)).length >= 3;
  });
  items.forbidden = {
    score: Math.max(0, 15 - violations.length * 8),
    note: violations.length === 0 ? "✅ 금지 설정 준수" : `❌ 위반: ${violations[0]}`,
  };
  total += items.forbidden.score;

  // 5. 길이 (15점)
  const tMin = config.episodeLength;
  const tMax = config.episodeLength + config.episodeLengthVar;
  const len = text.length;
  if (len >= tMin && len <= tMax + 200) {
    items.length = { score: 15, note: `✅ ${len}자 (목표 ${tMin}~${tMax})` };
  } else if (len < tMin) {
    items.length = { score: 5, note: `❌ 부족 ${len}자 (최소 ${tMin})` };
  } else {
    items.length = { score: 8, note: `⚠️ 초과 ${len}자 (최대 ${tMax + 200})` };
  }
  total += items.length.score;

  return { total, items };
}

// ── SSE 생성 ────────────────────────────────────────────────
async function generate(bookId, episode) {
  const res = await fetch(`${BASE}/api/generate?episode=${episode}&book_id=${bookId}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", tokens = [];
  const t0 = Date.now();
  let ttft = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("data:") && !t.includes("[DONE]")) {
        try {
          const d = JSON.parse(t.slice(5));
          if (d.token) { if (!ttft) ttft = Date.now() - t0; tokens.push(d.token); }
        } catch {}
      }
    }
  }
  return { text: tokens.join(""), elapsed: Date.now() - t0, ttft: ttft ?? 0 };
}

async function saveEpisode(bookId, ep, content) {
  const r = await fetch(`${BASE}/api/episodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: bookId, episode_number: ep, content }),
  });
  return r.json();
}

// ── 메인 ────────────────────────────────────────────────────
const report = { timestamp: new Date().toISOString(), scenarios: [], summary: {} };
const failPatterns = [];

for (const world of WORLDS) {
  const line = "═".repeat(58);
  console.log(`\n${line}`);
  console.log(`▶ [${world.genre}]  book_id: stress_${world.id}`);
  console.log(line);

  const bookId = `stress_${world.id}`;
  const scenarioResult = { id: world.id, genre: world.genre, episodes: [], avgScore: 0 };

  // World Bible 저장
  const wb = { ...world.worldBible, story_config: world.storyConfig };
  await REDIS.set(`context:${bookId}`, JSON.stringify(wb), "EX", 86400);
  const charList = Object.keys(world.worldBible.character_defaults).join(", ");
  console.log(`  인물: ${charList}  POV: ${world.storyConfig.pov}`);

  let totalScore = 0;

  for (let ep = 1; ep <= 3; ep++) {
    process.stdout.write(`  ${ep}화 생성 중... `);
    try {
      const { text, elapsed, ttft } = await generate(bookId, ep);
      const { total, items } = scoreEpisode(text, world.worldBible, world.storyConfig);
      await saveEpisode(bookId, ep, text);

      totalScore += total;
      scenarioResult.episodes.push({ ep, elapsed, ttft, length: text.length, score: total, items, preview: text.slice(0, 120) });

      const icon = total >= 80 ? "✅" : total >= 60 ? "⚠️" : "❌";
      console.log(`${icon} ${total}/100  TTFT:${ttft}ms  총:${elapsed}ms  ${text.length}자`);
      for (const [k, v] of Object.entries(items)) {
        const si = v.score >= (k === "pov" ? 20 : k === "characters" ? 20 : 14) ? " " : "  ⚡";
        console.log(`     ${k.padEnd(12)}: ${String(v.score).padStart(2)}pt — ${v.note}${si}`);
      }

      if (total < 70) failPatterns.push({ world: world.id, genre: world.genre, ep, score: total, items, preview: text.slice(0, 200) });

    } catch (err) {
      console.log(`❌ 오류: ${err.message}`);
      scenarioResult.episodes.push({ ep, error: err.message, score: 0 });
    }
  }

  scenarioResult.avgScore = Math.round(totalScore / 3);
  report.scenarios.push(scenarioResult);
  console.log(`  → 시나리오 평균: ${scenarioResult.avgScore}/100`);
}

// ── 최종 요약 ────────────────────────────────────────────────
const allAvg = report.scenarios.map((s) => s.avgScore);
report.summary = {
  totalScenarios: WORLDS.length,
  totalEpisodes: WORLDS.length * 3,
  overallAvg: Math.round(allAvg.reduce((a, b) => a + b, 0) / allAvg.length),
  minScore: Math.min(...allAvg),
  maxScore: Math.max(...allAvg),
  failEpisodes: failPatterns.length,
  failDetails: failPatterns.map((f) => ({
    genre: f.genre, ep: f.ep, score: f.score,
    weakItems: Object.entries(f.items).filter(([, v]) => v.score <= 5).map(([k, v]) => `${k}:${v.score}`),
  })),
};

fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

console.log(`\n${"═".repeat(58)}`);
console.log("📊 최종 결과");
console.log("═".repeat(58));
for (const s of report.scenarios) {
  const icon = s.avgScore >= 80 ? "✅" : s.avgScore >= 60 ? "⚠️" : "❌";
  console.log(`  ${icon} [${s.genre.padEnd(12)}] 평균 ${s.avgScore}/100`);
}
console.log(`\n  전체 평균: ${report.summary.overallAvg}/100`);
console.log(`  실패 화 수: ${report.summary.failEpisodes} / ${report.summary.totalEpisodes}`);
if (failPatterns.length > 0) {
  console.log("\n⚡ 실패 상세:");
  for (const f of failPatterns) {
    const weak = Object.entries(f.items).filter(([, v]) => v.score <= 5).map(([k, v]) => `${k}(${v.score})`).join(", ");
    console.log(`  [${f.genre}] ${f.ep}화 ${f.score}점 — 취약: ${weak || "없음"}`);
    console.log(`    미리보기: ${f.preview.slice(0, 80)}...`);
  }
}
console.log(`\n리포트: ${REPORT_PATH}`);

REDIS.disconnect();
