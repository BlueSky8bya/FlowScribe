/**
 * multi_world_test.mjs — 3개 세계관 × 30화 다양성 검증 테스트
 *
 * 목적: 서로 다른 장르/설정에서도 내러티브 로직 버그 없이 안정적으로 작동하는지 검증
 * 세계관:
 *   World A: SF 우주 (우주선, 이종족, 은하 전쟁)
 *   World B: 현대 도시 스릴러 (서울, 비밀 조직, 현실)
 *   World C: 동양 무협 (무림, 내공, 문파 대립)
 *
 * 내러티브 로직 버그 자동 감지:
 *   - 소개 전 이름 호칭 (정보 역설)
 *   - 감정 부재 (과도한 평온)
 *   - 인과 오류 ("갑자기", "어느새" 단독 해결)
 *   - 연속성 오류 (인물 설명 모순)
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

const TOTAL_EPISODES = 30;
const ARC_SIZE = 10;
const RUN_TS      = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const RESULTS_DIR = new URL("../logs/test_results/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const CHECKPOINT_FILE = `${RESULTS_DIR}multi_world_${RUN_TS}.json`;
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

const log = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let _checkpoint = { status: "in_progress", started_at: new Date().toISOString(), worlds: {} };
function saveCheckpoint() {
  try { writeFileSync(CHECKPOINT_FILE, JSON.stringify(_checkpoint, null, 2), "utf-8"); } catch {}
}

// ── 세계관 정의 ───────────────────────────────────────────

const WORLDS = {

  // ── World A: SF 우주 스릴러 ────────────────────────────
  SF: {
    label: "SF 우주",
    worldBible: {
      world_rules: [
        "은하 연방은 이종족 간 전투를 금지하며 위반 시 전함 압류와 추방형에 처한다",
        "워프 항법은 항성 중력권 내에서는 사용 불가 — 진입 시 선체 붕괴 위험",
        "이 세계의 통화는 '크레딧 샤드'다",
        "사이오닉(정신 감응) 능력자는 연방 등록 의무가 있으며 미등록 시 불법",
      ],
      character_defaults: {
        "카엘라": "성별: 여성. 역할: 주인공. 성격: 냉철하고 직관적. 미등록 사이오닉 능력자. 현상금 사냥꾼.",
        "레그": "성별: 남성. 역할: 조력자. 성격: 유머러스하고 의리 있음. 카엘라의 파일럿 파트너.",
        "다린": "성별: 남성. 역할: 의뢰인 겸 적. 성격: 표면적으론 온화하나 이중적. 연방 고위 관료.",
        "에시아": "성별: 여성. 역할: 악당. 성격: 냉혹하고 목적 지향적. 은하 마피아 두목.",
        "픽스": "성별: 불명. 역할: AI 보조. 성격: 논리적이고 건조함. 카엘라의 선박 AI.",
      },
      fixed_relationships: [
        "카엘라와 레그는 3년간 함께 일한 파트너",
        "에시아는 카엘라의 과거에 연루된 인물",
        "픽스는 카엘라의 선박에 귀속된 AI",
      ],
      forbidden_settings: [
        "마법·판타지 요소(용, 검술, 왕국) 등장 금지",
        "카엘라가 사이오닉 능력을 공공장소에서 공개 사용 금지",
        "픽스가 육체를 가진 것처럼 묘사 금지",
      ],
      story_config: {
        pov: "3인칭 관찰자", style: "스릴러",
        episodeLength: 700, episodeLengthVar: 150,
        totalEpisodes: TOTAL_EPISODES, totalEpisodesVar: 0,
        conflict: 8, foreshadow: 7, emotion: 6, dialogue: 7, direction: 8,
      },
    },
    characters: ["카엘라", "레그", "다린", "에시아", "픽스"],
    directorOverrides: {
      8:  "레그가 다린의 이중성을 암시하는 정보를 입수한다. 카엘라에게 말할지 고민한다.",
      18: "에시아가 카엘라의 과거 사건에 직접 관련되어 있었음이 드러난다.",
      25: "픽스가 연방의 명령을 받아 카엘라를 감시하고 있었음이 밝혀진다.",
    },
  },

  // ── World B: 현대 서울 스릴러 ──────────────────────────
  MODERN: {
    label: "현대 도시 스릴러",
    worldBible: {
      world_rules: [
        "비밀 조직 '그림자 회'는 서울 지하 금융망을 실질적으로 통제한다",
        "그림자 회 내부 문건은 48시간 이후 자동 파기되도록 암호화되어 있다",
        "조직 이탈자는 '소멸 명령'을 받으며 흔적 없이 처리된다",
        "조직원은 본명 대신 코드명만 사용한다",
      ],
      character_defaults: {
        "한지수": "성별: 여성. 역할: 주인공. 성격: 냉정하고 집요함. 전직 NIS 분석관. 조직을 추적 중.",
        "박민준": "성별: 남성. 역할: 조력자. 성격: 신중하고 정의감 강함. 경찰청 광역수사대 형사.",
        "유리": "성별: 여성. 역할: 내부 조력자. 성격: 계산적이고 생존 지향적. 그림자 회 내부 이탈자.",
        "제로": "성별: 남성. 역할: 악당. 성격: 잔인하고 카리스마 있음. 그림자 회 집행관. 코드명 제로.",
        "이강혁": "성별: 남성. 역할: 배후 세력. 성격: 권위적이고 철저히 위장된. 국회의원. 그림자 회 배후.",
      },
      fixed_relationships: [
        "한지수와 박민준은 과거 사건에서 한 번 협력한 적 있는 사이",
        "유리는 한지수가 포섭한 내부 정보원",
        "제로는 한지수를 소멸 명단에 올린 인물",
      ],
      forbidden_settings: [
        "마법·초자연 현상·SF 요소 등장 금지",
        "한지수가 공식 신분으로 조직에 접근하는 것 금지 (이미 신분 노출됨)",
        "이강혁의 조직 연관성이 공식 석상에서 드러나는 것 금지 (아직 위장 중)",
      ],
      story_config: {
        pov: "3인칭 관찰자", style: "긴장감",
        episodeLength: 700, episodeLengthVar: 150,
        totalEpisodes: TOTAL_EPISODES, totalEpisodesVar: 0,
        conflict: 9, foreshadow: 8, emotion: 5, dialogue: 7, direction: 8,
      },
    },
    characters: ["한지수", "박민준", "유리", "제로", "이강혁"],
    directorOverrides: {
      8:  "유리가 제로로부터 소멸 명령을 받은 사실을 한지수에게 털어놓는다.",
      18: "박민준이 이강혁과 연결된 계좌 내역을 발견한다. 그러나 보고를 망설인다.",
      25: "제로가 한지수의 실제 위치를 파악한다. 포위망이 좁혀진다.",
    },
  },

  // ── World C: 동양 무협 ─────────────────────────────────
  MURIM: {
    label: "동양 무협",
    worldBible: {
      world_rules: [
        "내공은 감정이 극도로 격해질 때 폭주할 수 있으며 이는 인체에 치명적이다",
        "무림맹은 정파 문파 간 사결(私鬪)을 금지하며 위반 시 문파 폐문 처분한다",
        "이 세계의 화폐는 '금전(金錢)'이다",
        "마교는 중원 서쪽에서 활동하며 정파와 100년 간 휴전 중이다",
      ],
      character_defaults: {
        "설아": "성별: 여성. 역할: 주인공. 성격: 강직하고 의협심 강함. 혈마공(마교 비기)을 익힌 정파 제자.",
        "진무": "성별: 남성. 역할: 동반자. 성격: 여유롭고 꿰뚫어 보는 눈. 무림맹 검증관.",
        "백화": "성별: 여성. 역할: 조력자. 성격: 명랑하고 독술 전문. 독문(毒門) 문주의 딸.",
        "천살": "성별: 남성. 역할: 악당. 성격: 냉혹하고 야망 큼. 마교 천살부 부주.",
        "혈노": "성별: 불명. 역할: 수수께끼. 성격: 예측 불가. 설아의 내공 안에 깃든 과거 마교인의 잔영.",
      },
      fixed_relationships: [
        "설아와 진무는 우연히 만난 사이로 점차 신뢰를 쌓아가고 있다",
        "백화는 설아가 독에 중독됐을 때 구해준 인연",
        "혈노는 설아만이 느낄 수 있는 내공 속 존재",
      ],
      forbidden_settings: [
        "현대 기술(총기, 전기, 인터넷) 등장 금지",
        "설아가 혈마공의 존재를 타인에게 공개하는 것 금지",
        "마교와 정파의 휴전이 공식 파기되는 것 금지 (아직 내전 수준)",
      ],
      story_config: {
        pov: "3인칭 관찰자", style: "서정적 긴장감",
        episodeLength: 700, episodeLengthVar: 150,
        totalEpisodes: TOTAL_EPISODES, totalEpisodesVar: 0,
        conflict: 7, foreshadow: 8, emotion: 7, dialogue: 6, direction: 7,
      },
    },
    characters: ["설아", "진무", "백화", "천살", "혈노"],
    directorOverrides: {
      8:  "진무가 설아의 내공에서 마교 기운을 감지한다. 의심하지만 발설하지 않는다.",
      18: "백화가 천살의 부하에게 납치된다. 설아는 혈마공 폭주 위험을 감수하고 추격한다.",
      25: "혈노가 설아에게 혈마공의 진짜 기원을 알려준다. 예상치 못한 충격적 사실이다.",
    },
  },
};

// ── 내러티브 로직 버그 감지기 ────────────────────────────
function detectLogicBugs(text, ep, worldKey, world) {
  const bugs = [];
  const chars = world.characters;

  // 1. 인과 오류: "갑자기" + 해결 동사가 같은 문장 안에 있는 경우
  //    (단, "갑자기 나타나다"는 등장 묘사이므로 제외, 진짜 해결만 체크)
  const suddenSolve = /갑자기[^.!?\n]{0,30}(해결됐|해결되었|끝났|끝나버렸|사라졌|해냈다|성공했)/;
  if (suddenSolve.test(text)) bugs.push("인과오류: 갑자기 해결");

  // 2. 감정 부재: 명백한 위기어 + 과도한 평온 표현이 같은 문장
  const calmCrisis = /(살해당|처형|폭발|즉사|전멸).{0,40}(아무렇지 않|태연히 웃|평온하게 대답|침착하게 웃)/;
  if (calmCrisis.test(text)) bugs.push("감정부재: 위기 중 과도한 평온");

  // 3. 정보역설: 1화에서 주인공이 아닌 다른 인물의 이름을
  //    소개 장면 없이 100자 이내에 호칭 (주인공 이름은 3인칭 서술자가 알 수 있으므로 제외)
  if (ep === 1) {
    const protagonist = chars[0]; // 첫 번째 = 주인공
    const others = chars.slice(1); // 나머지 = 타 인물
    for (const name of others) {
      const idx = text.indexOf(name);
      if (idx > 0 && idx < 120) {
        const before = text.slice(0, idx);
        // 소개 근거: 이름 직접 언급하며 소개, 혹은 직전에 인물 묘사
        const hasIntro = /소개|이름은|불렸|알고\s있|이름이|자신을|그의 이름|그녀의 이름/.test(before);
        if (!hasIntro) bugs.push(`정보역설: 1화 초반 "${name}"(비주인공) 소개 없이 호칭`);
      }
    }
  }

  // 4. 금지 설정 위반: 실제 행위 동사와 함께 등장해야 진짜 위반
  //    (단순 언급은 오탐 — "혈마공의 압박을 느꼈다"는 합법)
  const forbidden = world.worldBible.forbidden_settings;
  for (const f of forbidden) {
    // 공개·사용·드러남 등 실제 위반 동사가 함께 있을 때만 버그로 인정
    const actionVerbs = /공개|드러났|밝혔|알려졌|폭로|발설/;
    const kws = f.replace(/\(.*?\)/g, "").split(/[·,，\s]+/)
      .filter(w => w.length >= 2 && !/금지|등장|것|않|하는|위반|이상|수준/.test(w));
    const hit = kws.filter(k => text.includes(k));
    if (hit.length >= 2 && actionVerbs.test(text)) {
      bugs.push(`금지위반: "${hit.slice(0,2).join(", ")}" + 공개·사용 동사 감지`);
    }
  }

  // 5. 연속성 오류: 죽은/부재한 인물 갑작스러운 등장 (롤링 요약 기반은 어렵지만 간단 체크)
  // 전화 내용 없이 특정 키워드로 체크하기 어려우므로 skip (DB 기반 체크 필요)

  return bugs;
}

// ── 채점 함수 ─────────────────────────────────────────────
function scorePOV(text) {
  const WB = `(?:^|[\\s"'\u201C\u201D\u2018\u2019「」『』,，。.!?\\n])`;
  const PAT = new RegExp(`${WB}(나는|나의|내가|나를|나에게|나도|나와)`, 'gm');
  const violations = (text.normalize('NFC').match(PAT) ?? []).length;
  return { score: Math.max(0, 10 - violations * 3), violations };
}

function scoreCharacters(text, ep, chars) {
  const appearing = chars.filter(c => text.includes(c));
  const ratio = ep / TOTAL_EPISODES;
  const target = ratio < 0.3 ? 2 : ratio < 0.7 ? 3 : 4;
  const score  = Math.min(10, Math.round((appearing.length / target) * 10));
  return { score, appearing };
}

function scoreWorldRules(text, world) {
  const stopWords = /^(은|는|이|가|을|를|의|에|서|도|만|과|와|하며|하고|있으며|있다|된다|한다|않|금지|위반|처분|허용|수|것|때|시|위해|인해|경우|이상|이하|이후|중|간|전|후)$/;
  // 조사 제거: "무림맹은" → "무림맹", "내공이" → "내공"
  const stripParticle = w => w.replace(/[은는이가을를의에서도만과와로으로까지에서부터이라고라고]$/, '');
  const allKws = world.worldBible.world_rules.flatMap(r =>
    r.replace(/\(.*?\)/g, "")
      .replace(/[·,，。.!?''""]/g, " ")
      .split(/\s+/)
      .map(stripParticle)
      .filter(w => w.length >= 2 && !stopWords.test(w))
  );
  const unique = [...new Set(allKws)];
  const hits = unique.filter(k => text.includes(k)).length;
  // 완화된 점수: 1히트도 5점, 2개=7점, 3개+=10점
  return { score: hits >= 3 ? 10 : hits === 2 ? 7 : hits >= 1 ? 5 : 0 };
}

function scoreForbidden(text) {
  const VIOLATIONS = [
    { pattern: /총|권총|소총|총기/, label: "총기" },
    { pattern: /전기|전등|스마트폰|인터넷/, label: "현대기술" },
  ];
  const hits = VIOLATIONS.filter(v => v.pattern.test(text));
  return { score: hits.length === 0 ? 10 : Math.max(0, 10 - hits.length * 5), violations: hits.map(h => h.label) };
}

function scoreLength(text, cfg, isFinale = false) {
  const len = text.length, min = cfg.episodeLength, max = cfg.episodeLength + cfg.episodeLengthVar;
  if (isFinale && len >= min && len <= max * 1.8) return { score: 5, len };
  if (len >= min && len <= max + 80) return { score: 5, len };
  if (len < min) return { score: Math.round((len / min) * 5), len };
  return { score: Math.max(0, 5 - Math.round((len - max) / 100)), len };
}

function scoreArcPhase(text, ep) {
  const ratio = ep / TOTAL_EPISODES;
  const PHASE_KEYWORDS = {
    intro:   ["소개", "만남", "처음", "첫날", "시작", "도착", "낯선", "불안", "눈을 떴", "새벽", "아침", "어색", "설레"],
    develop: ["갈등", "의심", "심화", "긴장", "추적", "불안", "두려움", "숨기", "피하", "조사", "흔적", "단서", "감추"],
    climax:  ["발각", "위기", "반전", "충격", "비밀", "폭로", "드러났", "맞서", "절정", "들켰", "마주쳤", "깨달았"],
    finale:  ["해결", "마침내", "끝", "화해", "용서", "드디어", "인정", "함께", "비로소", "자유", "해방", "안도",
              "승리", "물리쳤", "극복했", "돌아갔", "귀환", "끝냈", "마무리", "새 길", "이겼"],
  };
  const phase = ratio < 0.3 ? "intro" : ratio < 0.6 ? "develop" : ratio < 0.85 ? "climax" : "finale";
  const hits  = PHASE_KEYWORDS[phase].filter(k => text.includes(k)).length;
  return { score: Math.min(10, hits * 2), phase };
}

function scoreDirectorOverride(text, override) {
  if (!override) return null;
  const raw = override.split(/[\s,.。]+/).filter(w => w.length >= 2);
  const keywords = raw.map(w => w.replace(/[가는을를이의에서도로와과함께하다된다]+$/, '').trim()).filter(w => w.length >= 2);
  const hits = keywords.filter(k => text.includes(k)).length;
  return { score: Math.round((hits / Math.max(keywords.length, 1)) * 10), hits, total: keywords.length };
}

function scoreFinale(text) {
  const KWS = ["끝", "마침내", "마지막", "평화", "해결", "드디어", "용서", "화해", "자유", "해방", "비로소", "이로써", "새로운 시작", "앞으로", "함께했다", "시간이 흘", "다짐했", "인정했"];
  return { score: Math.min(5, KWS.filter(k => text.includes(k)).length) };
}

// ── 에피소드 생성 + 재시도 ────────────────────────────────
async function generateEpisode(bookId, ep, cfg) {
  const MIN = cfg.episodeLength * 0.75;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const url = `${BASE}/api/generate?book_id=${bookId}&episode=${ep}`;
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
    if (full.length >= MIN) return full;
    log(`  ⚠ ${ep}화 짧은 출력 (${full.length}자) — 재시도 ${attempt}/3`);
    await sleep(2000);
  }
  return "";
}

async function saveEpisode(bookId, ep, content) {
  const res = await fetch(`${BASE}/api/episodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: bookId, episode_number: ep, content }),
  });
  if (!res.ok) throw new Error(`Save failed: HTTP ${res.status}`);
  return res.json();
}

async function addOverride(bookId, override) {
  const res = await fetch(`${BASE}/api/director/${bookId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ override }),
  });
  if (!res.ok) throw new Error(`Override failed: HTTP ${res.status}`);
  return res.json();
}

// ── 단일 세계관 테스트 ────────────────────────────────────
async function runWorldTest(worldKey, worldDef) {
  const bookId = `mw_${worldKey}_${Date.now()}`;
  const cfg    = worldDef.worldBible.story_config;
  log(`\n${"═".repeat(55)}`);
  log(`[${worldDef.label}] 테스트 시작 — book_id: ${bookId}`);
  log(`${"═".repeat(55)}`);

  // World Bible 저장
  await fetch(`${BASE}/api/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: bookId, worldBible: worldDef.worldBible }),
  });

  const perEpScores = [];
  const directorLog = [];
  const allBugs     = [];

  for (let ep = 1; ep <= TOTAL_EPISODES; ep++) {
    const override = worldDef.directorOverrides[ep];
    if (override) {
      await addOverride(bookId, override);
      log(`  [Director ${ep}화] "${override.slice(0, 50)}"`);
      directorLog.push({ ep, override });
    }

    const content = await generateEpisode(bookId, ep, cfg);
    const saveRes = await saveEpisode(bookId, ep, content);

    const pov    = scorePOV(content);
    const chars  = scoreCharacters(content, ep, worldDef.characters);
    const rules  = scoreWorldRules(content, worldDef);
    const forbid = scoreForbidden(content);
    const length = scoreLength(content, cfg, ep === TOTAL_EPISODES);
    const arc    = scoreArcPhase(content, ep);
    const bugs   = detectLogicBugs(content, ep, worldKey, worldDef);

    const dirOverride = directorLog.find(d => ep > d.ep && ep <= d.ep + 5);
    const dirScore    = dirOverride ? scoreDirectorOverride(content, dirOverride.override) : null;

    const baseTotal = pov.score + chars.score + rules.score + forbid.score + length.score + arc.score;

    if (bugs.length) {
      allBugs.push({ ep, bugs });
      log(`  ⚠ ${ep}화 로직 버그: ${bugs.join(" | ")}`);
    }

    perEpScores.push({
      ep, baseTotal, bugs: bugs.length,
      pov: pov.score, chars: chars.score, rules: rules.score,
      forbidden: forbid.score, length: length.score, arc: arc.score,
      char_count: content.length, director: dirScore,
    });

    const dirStr = dirScore ? ` Dir(${dirScore.score}/10)` : "";
    log(`  ${ep}화: ${baseTotal}/55 | POV(${pov.score}) 인물(${chars.score}) 세계관(${rules.score}) 금지(${forbid.score}) 분량(${length.score}) 아크(${arc.score})${dirStr} | ${content.length}자${bugs.length ? ` ⚠버그${bugs.length}` : ""}`);

    if (ep % ARC_SIZE === 0) {
      const arcEps = perEpScores.slice(ep - ARC_SIZE, ep);
      const arcAvg = Math.round(arcEps.reduce((a, s) => a + s.baseTotal, 0) / ARC_SIZE);
      log(`  ══ Arc ${ep / ARC_SIZE} (${ep - ARC_SIZE + 1}~${ep}화) 평균: ${arcAvg}/55 ══`);
      await sleep(1500);
    }

    // 에피소드마다 체크포인트 저장
    _checkpoint.worlds[worldKey] = { label: worldDef.label, checkpoint_episode: ep, per_episode: perEpScores, bugs: allBugs };
    saveCheckpoint();

    await sleep(600);
  }

  // 복선 회수율
  await sleep(2000);
  const foreshadowRows = await pool.query(
    `SELECT planted_episode, status FROM foreshadows WHERE book_id = $1`,
    [bookId]
  );
  const allF      = foreshadowRows.rows;
  const scorableF = allF.filter(f => f.planted_episode < TOTAL_EPISODES);
  const resolvedF = scorableF.filter(f => f.status === "resolved");
  const recallRate = scorableF.length ? Math.round((resolvedF.length / scorableF.length) * 100) : 0;
  const foreshadowScore = Math.round((recallRate / 100) * 20);
  const longTermF = scorableF.filter(f => f.planted_episode <= TOTAL_EPISODES - 10);
  const ltResolved = longTermF.filter(f => f.status === "resolved");
  const ltRate = longTermF.length ? Math.round((ltResolved.length / longTermF.length) * 100) : 100;
  const longTermScore = Math.round((ltRate / 100) * 10);

  // Director avg
  const dirScores = perEpScores.filter(s => s.director !== null).map(s => s.director.score);
  const dirAvg = dirScores.length ? Math.round(dirScores.reduce((a, b) => a + b, 0) / dirScores.length) : 0;

  // Finale
  const finaleRow = await pool.query(`SELECT content FROM episodes WHERE book_id=$1 AND episode_number=$2`, [bookId, TOTAL_EPISODES]);
  const finaleScore = scoreFinale(finaleRow.rows[0]?.content ?? "");

  const baseNorm = Math.round(perEpScores.reduce((a, s) => a + s.baseTotal, 0) / TOTAL_EPISODES);
  const totalScore = baseNorm + foreshadowScore + longTermScore + dirAvg + finaleScore.score;

  const result = {
    world: worldKey,
    label: worldDef.label,
    book_id: bookId,
    scores: { base_normalized: baseNorm, foreshadow_recall: foreshadowScore, longterm_recall: longTermScore, director_avg: dirAvg, finale: finaleScore.score, grand_total: totalScore },
    logic_bugs: { total: allBugs.reduce((a, b) => a + b.bugs.length, 0), by_episode: allBugs },
    foreshadow_stats: { total: allF.length, recall_rate: recallRate, longterm_rate: ltRate },
    avg_char_count: Math.round(perEpScores.reduce((a, s) => a + s.char_count, 0) / TOTAL_EPISODES),
    pov_violations: perEpScores.reduce((a, s) => a + (10 - s.pov), 0) / 3,
    per_episode: perEpScores,
  };

  log(`\n[${worldDef.label}] 결과: ${totalScore}/100 | 기본${baseNorm} 복선${foreshadowScore} 장기복선${longTermScore} Dir${dirAvg} 결말${finaleScore.score} | 로직버그 총 ${result.logic_bugs.total}건`);

  // 클린업
  await redis.del(`context:${bookId}`, `foreshadow_open:${bookId}`, `overrides:${bookId}`);

  return result;
}

// ── 메인 ─────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();
  log(`=== Multi-World Test 시작 (3개 세계관 × ${TOTAL_EPISODES}화) ===`);
  log(`예상 소요: 약 90~120분`);

  const results = [];
  for (const [key, world] of Object.entries(WORLDS)) {
    const result = await runWorldTest(key, world);
    results.push(result);
    await sleep(3000);
  }

  // ── 종합 리포트 ───────────────────────────────────────
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  log(`\n${"═".repeat(60)}`);
  log(`   Multi-World Test 종합 결과 (${Math.floor(elapsed/60)}분 ${elapsed%60}초)`);
  log(`${"═".repeat(60)}`);
  log(`  세계관              종합   기본  복선  Dir  버그`);
  log(`  ${"─".repeat(55)}`);
  for (const r of results) {
    const s = r.scores;
    log(`  ${r.label.padEnd(18)} ${String(s.grand_total).padStart(3)}/100  ${String(s.base_normalized).padStart(2)}/55  ${String(s.foreshadow_recall+s.longterm_recall).padStart(2)}/30  ${String(s.director_avg).padStart(2)}/10  ${r.logic_bugs.total}건`);
  }
  log(`${"═".repeat(60)}`);

  if (results.some(r => r.logic_bugs.total > 0)) {
    log(`\n⚠ 로직 버그 상세:`);
    for (const r of results.filter(r => r.logic_bugs.total > 0)) {
      log(`  [${r.label}]`);
      for (const b of r.logic_bugs.by_episode) {
        log(`    ${b.ep}화: ${b.bugs.join(", ")}`);
      }
    }
  } else {
    log(`\n✓ 전 세계관 로직 버그 0건`);
  }

  _checkpoint = { status: "completed", started_at: _checkpoint.started_at, results, elapsed_sec: elapsed };
  saveCheckpoint();
  writeFileSync(`${RESULTS_DIR}multi_world_latest.json`, JSON.stringify({ results, elapsed_sec: elapsed }, null, 2), "utf-8");
  log(`\n리포트: ${CHECKPOINT_FILE}`);

  await pool.end();
  await redis.quit();
}

main().catch(e => { console.error(e); process.exit(1); });
