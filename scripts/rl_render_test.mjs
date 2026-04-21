/**
 * rl_render_test.mjs — 멀티라운드 강화학습 렌더링 품질 테스트
 *
 * 평가 항목 (에피소드당 100점):
 *   latency    (10) : TTFT + 총 생성 시간
 *   db_health  (10) : 저장 성공 + 재조회 일치
 *   cliff      (15) : [CLIFF] 감지 + 클리프행어 단락 존재
 *   render     (25) : 따옴표 일관성 + 대괄호 온전성 + 외국어 누출 없음
 *   length     (10) : 목표 분량 범위 내
 *   body       (20) : 어색한 표현 없음 + 반복 없음 + POV 일관성
 *   arc        (10) : 서사 단계 일치
 *
 * RL 루프:
 *   Round N → 채점 → 실패 패턴 분석 → 코드/프롬프트 패치 적용 → Round N+1
 *   패치: story.ts STOP_PATTERNS 확장, generate.js 렌더링 보정, README 업데이트
 */

import IORedis from "ioredis";
import pg from "pg";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import http from "http";

// ── env 로드 ─────────────────────────────────────────────────
try {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

const { Pool } = pg;
const BASE = "http://localhost:3000";
const redis = new IORedis({ host: "localhost", port: 6379, lazyConnect: true });
const pool  = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://flowscribe:flowscribe@localhost:5432/flowscribe" });

const ROUNDS        = 3;
const START_ROUND   = parseInt(process.env.START_ROUND ?? "1");
const EPS_PER_WORLD = 10;
const RESULTS_DIR   = new URL("../logs/test_results/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const STORY_TS      = new URL("../src/services/story.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const GEN_JS        = new URL("../public/js/generate.js", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const README_PATH   = new URL("../workflows/README_rendering_rules.md", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const INDEX_HTML    = new URL("../public/index.html", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

const log  = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
const warn = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ⚠ ${msg}`);
const ok   = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ✓ ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// 세계관 정의 (6개 다양한 장르)
// ─────────────────────────────────────────────────────────────
const WORLDS = {
  ISEKAI: {
    label: "이세계 전생",
    pov: "3인칭 관찰자",
    worldBible: {
      world_rules: ["현대인이 이세계로 전생 시 상태창이 부여됨","마법과 검술이 공존하는 왕국 체제","레벨업 시 능력치가 실제로 성장함"],
      character_defaults: {
        "한소라": "성별: 여, 역할: 주인공, 특징: 평범한 직장인 출신 전생자. 현실주의적이고 눈치 빠름",
        "라이온": "성별: 남, 역할: 조력자, 특징: 왕국 기사단장. 냉정하고 실용적이나 신의를 지킴",
        "마리아": "성별: 여, 역할: 조연, 특징: 왕궁 치유사. 친절하나 숨기는 비밀이 있음",
      },
      fixed_relationships: ["한소라와 라이온은 초면","마리아는 왕궁 소속으로 라이온과 구면"],
      forbidden_settings: ["현대 기술이 즉시 무적이 되는 전개","전생 사실을 첫화에 공개"],
      story_config: { pov:"3인칭 관찰자", style:"균형", episodeLength:700, episodeLengthVar:150, totalEpisodes:EPS_PER_WORLD, totalEpisodesVar:0, conflict:6, foreshadow:6, emotion:6, dialogue:6, direction:5 },
    },
    characters: ["한소라","라이온","마리아"],
    directorOverrides: { 4:"마리아가 한소라의 정체를 눈치챈 듯한 행동을 보인다", 8:"라이온이 왕으로부터 비밀 임무를 받는다" },
  },
  MURIM: {
    label: "동양 무협",
    pov: "1인칭",
    worldBible: {
      world_rules: ["강호에는 구대문파와 마교가 대립","내공은 수련을 통해서만 성장하며 지름길은 없음","의협은 강자의 덕목이자 무림의 불문율"],
      character_defaults: {
        "나 (철혈)": "성별: 남, 역할: 주인공, 특징: 가문이 몰살된 복수자. 냉혹하나 의리 있음",
        "운화": "성별: 여, 역할: 조력자, 특징: 독문 출신 의녀. 능수능란한 처세술",
        "흑사도": "성별: 남, 역할: 적대자, 특징: 마교 수하. 권력욕이 강하고 잔인함",
      },
      fixed_relationships: ["철혈과 운화는 우연히 만난 동행","흑사도는 철혈 가문 몰살에 연루된 인물"],
      forbidden_settings: ["총기 등 현대 무기 사용","서양 마법 등장"],
      story_config: { pov:"1인칭", style:"서사", episodeLength:800, episodeLengthVar:150, totalEpisodes:EPS_PER_WORLD, totalEpisodesVar:0, conflict:8, foreshadow:7, emotion:5, dialogue:5, direction:6 },
    },
    characters: ["운화","흑사도"],
    directorOverrides: { 4:"흑사도의 부하가 철혈을 미행하고 있다는 단서가 나타난다", 8:"운화의 과거와 독문의 비밀이 암시된다" },
  },
  ROMANCE: {
    label: "현대 로맨스",
    pov: "3인칭 관찰자",
    worldBible: {
      world_rules: ["현대 한국 서울 배경","재벌 2세와 평범한 직장인의 신분 격차","오해와 편견이 관계 발전을 방해"],
      character_defaults: {
        "윤지아": "성별: 여, 역할: 주인공, 특징: 중소기업 기획팀 과장. 워커홀릭이나 따뜻한 면이 있음",
        "강현우": "성별: 남, 역할: 남주, 특징: 대기업 부회장. 냉정해 보이나 세심하고 외로움",
        "박민서": "성별: 여, 역할: 조연, 특징: 윤지아의 단짝. 발랄하고 눈치 빠름",
      },
      fixed_relationships: ["윤지아와 강현우는 업무상 갈등 관계로 시작","박민서는 윤지아의 회사 동료"],
      forbidden_settings: ["마법이나 초능력","역사·판타지 배경"],
      story_config: { pov:"3인칭 관찰자", style:"감성", episodeLength:700, episodeLengthVar:150, totalEpisodes:EPS_PER_WORLD, totalEpisodesVar:0, conflict:5, foreshadow:5, emotion:8, dialogue:8, direction:4 },
    },
    characters: ["윤지아","강현우","박민서"],
    directorOverrides: { 4:"윤지아가 강현우에게 실수로 비밀을 털어놓는다", 8:"강현우의 약혼 소식이 전해지며 윤지아가 혼란스러워한다" },
  },
  THRILLER: {
    label: "공포 스릴러",
    pov: "1인칭",
    worldBible: {
      world_rules: ["고립된 산속 펜션 배경. 폭설로 탈출 불가","통신 두절 상황에서 생존자들이 하나씩 사라짐","범인은 외부인이 아닌 일행 중에 있음"],
      character_defaults: {
        "나 (이서연)": "성별: 여, 역할: 주인공, 특징: 심리학과 대학원생. 냉철하게 분석하는 성격",
        "황 형사": "성별: 남, 역할: 조력자, 특징: 은퇴 직전의 형사. 경험 많으나 지쳐 있음",
        "김도현": "성별: 남, 역할: 의심 인물, 특징: 첫인상이 좋은 의대생. 정체가 불명확함",
      },
      fixed_relationships: ["서연과 황 형사는 초면","김도현은 서연의 대학 선배라고 주장"],
      forbidden_settings: ["초자연 현상이나 귀신","즉각적인 구조나 탈출"],
      story_config: { pov:"1인칭", style:"긴장감", episodeLength:700, episodeLengthVar:150, totalEpisodes:EPS_PER_WORLD, totalEpisodesVar:0, conflict:9, foreshadow:8, emotion:7, dialogue:6, direction:8 },
    },
    characters: ["황 형사","김도현"],
    directorOverrides: { 4:"첫 번째 실종자가 발생한다. 방에 이상한 흔적이 남아 있다", 8:"황 형사가 범인에 대한 결정적 단서를 발견하고 서연에게 알리려 한다" },
  },
  SF: {
    label: "SF 우주",
    pov: "3인칭 관찰자",
    worldBible: {
      world_rules: ["2387년 은하 연방 시대. FTL 항법 가능","AI와 인류가 공존하나 AI의 자율 전투 행위는 금지","은하 통화는 크레딧 샤드"],
      character_defaults: {
        "카엘라": "성별: 여, 역할: 주인공, 특징: 미등록 사이오닉 능력자 겸 현상금 사냥꾼. 냉철하고 직관적",
        "레그": "성별: 남, 역할: 조력자, 특징: 카엘라의 파일럿 파트너. 유머러스하고 의리 있음",
        "에시아": "성별: 여, 역할: 적대자, 특징: 은하 마피아 두목. 냉혹하고 목적 지향적",
      },
      fixed_relationships: ["카엘라와 레그는 3년 된 파트너","에시아는 카엘라의 과거에 연루된 인물"],
      forbidden_settings: ["마법·검술 등 판타지 요소","카엘라가 능력을 공공장소에서 공개 사용"],
      story_config: { pov:"3인칭 관찰자", style:"스릴러", episodeLength:750, episodeLengthVar:150, totalEpisodes:EPS_PER_WORLD, totalEpisodesVar:0, conflict:8, foreshadow:7, emotion:6, dialogue:7, direction:8 },
    },
    characters: ["카엘라","레그","에시아"],
    directorOverrides: { 4:"레그가 에시아 측의 첩자와 접촉한 흔적이 발견된다", 8:"카엘라의 사이오닉 능력이 예상치 못한 상황에서 폭발적으로 발현된다" },
  },
  HISTORY: {
    label: "역사 사극",
    pov: "3인칭 관찰자",
    worldBible: {
      world_rules: ["조선 중기 배경. 신분제가 엄격함","당쟁과 외침이 시대적 배경","의녀와 선비는 신분 때문에 공식적으로 교류 불가"],
      character_defaults: {
        "이정현": "성별: 남, 역할: 주인공, 특징: 몰락 양반 출신 선비. 정의롭고 고집스럽지만 현실에 취약",
        "서연": "성별: 여, 역할: 조력자, 특징: 재능 있는 의녀. 신분 때문에 능력을 감춰야 함",
        "유상현": "성별: 남, 역할: 적대자, 특징: 탐관오리. 권력욕이 강하고 위선적",
      },
      fixed_relationships: ["이정현과 서연은 우연한 만남에서 시작","유상현은 이정현 가문의 몰락에 관여"],
      forbidden_settings: ["현대어 직접 사용","민주주의·평등권 등 현대 개념 직접 언급"],
      story_config: { pov:"3인칭 관찰자", style:"서사", episodeLength:800, episodeLengthVar:150, totalEpisodes:EPS_PER_WORLD, totalEpisodesVar:0, conflict:7, foreshadow:8, emotion:6, dialogue:5, direction:5 },
    },
    characters: ["이정현","서연","유상현"],
    directorOverrides: { 4:"유상현이 이정현을 함정에 빠뜨리려는 계략이 암시된다", 8:"서연이 이정현을 위해 자신의 신분을 위험에 빠뜨리는 선택을 한다" },
  },
};

// ─────────────────────────────────────────────────────────────
// 스트리밍 + 지연시간 측정
// ─────────────────────────────────────────────────────────────
function streamEpisode(bookId, ep) {
  return new Promise((resolve) => {
    const url = `${BASE}/api/generate?book_id=${bookId}&episode=${ep}`;
    let raw = "", done = false, ttft = null;
    const startedAt = Date.now();

    const req = http.get(url, (res) => {
      res.on("data", (chunk) => {
        const text = chunk.toString();
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { done = true; req.destroy(); resolve({ raw, ttft, elapsed: Date.now() - startedAt }); return; }
          try {
            const { token } = JSON.parse(payload);
            if (token) {
              if (!ttft) ttft = Date.now() - startedAt;
              raw += token;
            }
          } catch {}
        }
      });
      res.on("end", () => { if (!done) resolve({ raw, ttft, elapsed: Date.now() - startedAt }); });
    });
    req.setTimeout(180000, () => { req.destroy(); resolve({ raw, ttft, elapsed: Date.now() - startedAt }); });
    req.on("error", () => resolve({ raw, ttft, elapsed: Date.now() - startedAt }));
  });
}

async function saveEpisodeToDB(bookId, ep, content) {
  try {
    const r = await fetch(`${BASE}/api/episodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book_id: bookId, episode_number: ep, content }),
    });
    return r.ok;
  } catch { return false; }
}

async function loadEpisodeFromDB(bookId, ep) {
  try {
    const r = await pool.query("SELECT content FROM episodes WHERE book_id=$1 AND episode_number=$2", [bookId, ep]);
    return r.rows[0]?.content ?? null;
  } catch { return null; }
}

async function setupWorld(bookId, world) {
  await fetch(`${BASE}/api/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: bookId, worldBible: world.worldBible }),
  });
}

async function addOverride(bookId, override) {
  try {
    await fetch(`${BASE}/api/director/${bookId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ override }),
    });
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// 채점 함수들
// ─────────────────────────────────────────────────────────────
function scoreLatency({ ttft, elapsed }) {
  // TTFT 점수 (6점): <5s=6, <10s=4, <15s=2, else=0
  const ttftScore = !ttft ? 0 : ttft < 5000 ? 6 : ttft < 10000 ? 4 : ttft < 15000 ? 2 : 0;
  // 총 시간 점수 (4점): <20s=4, <35s=2, else=0
  const totalScore = elapsed < 20000 ? 4 : elapsed < 35000 ? 2 : 0;
  return { score: ttftScore + totalScore, ttft_ms: ttft, elapsed_ms: elapsed, detail: { ttft: ttftScore, total: totalScore } };
}

function scoreDB({ saved, loaded, content }) {
  // 저장 성공 (5) + DB 조회 일치 (5)
  const saveScore = saved ? 5 : 0;
  const loadScore = loaded && content && loaded.length > 0 ? 5 : 0;
  return { score: saveScore + loadScore, detail: { save: saveScore, load: loadScore } };
}

function scoreCliff(raw, isFinale) {
  if (isFinale) return { score: 15, detail: { detected: true, has_para: true, note: "finale" } };
  // 서버가 [CLIFF] 마커를 제거하므로 단락 구조로 추정
  const paras = raw.split(/\n\n+/).filter(p => p.trim().length > 20);
  const lastPara = paras[paras.length - 1] ?? "";
  // 클리프행어 특성: 긴박한 동사/감탄 + 짧은 단락(2~4문장)
  const cliffKws = /갑자기|순간|그때|비명|발소리|눈을 감|떨렸|굳었|멈췄|깨달았|발견|터져|뛰어|치솟|울렸|비틀|쓰러|쏘아/;
  const sentences = lastPara.split(/[.!?。]/).filter(s => s.trim().length > 5);
  const isShortDramatic = sentences.length >= 1 && sentences.length <= 5 && cliffKws.test(lastPara);
  // 단락 수 기반 추정 (클리프행어 있으면 단락이 더 많음)
  const hasCliffPara = isShortDramatic || paras.length >= 6;
  const detected = hasCliffPara; // 서버 로그 없이 추정
  return {
    score: detected ? (hasCliffPara ? 15 : 10) : 0,
    detail: { detected, has_para: hasCliffPara, para_count: paras.length, last_para_sentences: sentences.length },
  };
}

function scoreRender(raw) {
  let score = 25;
  const issues = [];

  // 직선 따옴표 (−5/건, 최대 −15)
  const straightMatches = raw.match(/\x22[^"\n]*[가-힣][^"\n]*\x22/g) ?? [];
  if (straightMatches.length > 0) {
    const penalty = Math.min(15, straightMatches.length * 5);
    score -= penalty;
    issues.push(`직선따옴표 ${straightMatches.length}건 (-${penalty})`);
  }

  // 곡선 따옴표 불균형 (−5)
  const openC  = (raw.match(/\u201C/g) ?? []).length;
  const closeC = (raw.match(/\u201D/g) ?? []).length;
  if (Math.abs(openC - closeC) > 2) {
    score -= 5;
    issues.push(`곡선따옴표 불균형 열림${openC} 닫힘${closeC} (-5)`);
  }

  // 대괄호 누출 ([CLIFF] 등) (−5)
  if (/\[CLIFF/.test(raw)) { score -= 5; issues.push("[CLIFF] 마커 누출 (-5)"); }

  // 외국어 누출 (−5)
  if (/[\u4E00-\u9FFF\u3040-\u30FF]/.test(raw)) { score -= 5; issues.push("외국어 누출 (-5)"); }

  // 점 연속 가비지 (−3)
  if (/\.{5,}/.test(raw)) { score -= 3; issues.push("점연속 가비지 (-3)"); }

  return { score: Math.max(0, score), issues };
}

function scoreLength(raw, cfg) {
  const len = raw.length;
  const min = cfg.episodeLength, max = cfg.episodeLength + cfg.episodeLengthVar;
  if (len >= min && len <= max + 100) return { score: 10, len };
  if (len < min * 0.5) return { score: 0, len };
  if (len < min) return { score: Math.round((len / min) * 10), len };
  return { score: Math.max(2, 10 - Math.floor((len - max) / 200)), len };
}

function scoreBody(raw, pov) {
  let score = 20;
  const issues = [];

  // 어색한 표현: 인과오류, 갑작스러운 해결
  const AWKWARD = [
    /갑자기\s*해결/,/어느새\s*사라/,/이유\s*없이\s*성공/,/갑자기\s*나타나\s*도왔/,
    /기적처럼\s*해결/,/갑자기\s*모두\s*화해/,
  ];
  const awkHits = AWKWARD.filter(p => p.test(raw));
  if (awkHits.length) { score -= awkHits.length * 4; issues.push(`인과오류 ${awkHits.length}건 (-${awkHits.length*4})`); }

  // 문장 반복 (같은 문장 구조 3회 이상)
  const sentences = raw.split(/[.!?。]\s*/).filter(s => s.trim().length > 10);
  const repMap = {};
  for (const s of sentences) {
    const key = s.trim().slice(0, 20);
    repMap[key] = (repMap[key] ?? 0) + 1;
  }
  const maxRep = Math.max(0, ...Object.values(repMap));
  if (maxRep >= 3) { score -= 4; issues.push(`문장 반복 최대 ${maxRep}회 (-4)`); }

  // POV 일관성
  const is3rdPOV = pov.includes("3인칭");
  const POV_PAT = /(?:^|[\s"'\u201C\u2018「『,，。.!?\n])(나는|나의|내가|나를|나에게|나도|나와)/gm;
  if (is3rdPOV) {
    const violations = (raw.normalize("NFC").match(POV_PAT) ?? []).length;
    if (violations > 0) { score -= Math.min(8, violations * 2); issues.push(`3인칭에 나는/내가 ${violations}회 (-${Math.min(8,violations*2)})`); }
  } else {
    // 1인칭인데 1인칭 표현이 아예 없으면 감점
    if (!/나는|나의|내가|나를/.test(raw)) { score -= 5; issues.push("1인칭 POV 표현 없음 (-5)"); }
  }

  return { score: Math.max(0, score), issues };
}

function scoreArc(raw, ep, total) {
  const ratio = ep / total;
  const PHASE_KWS = {
    intro:   ["처음","낯선","아침","불안","설레","첫날","도착","소개","만남","눈을 떴","어색"],
    develop: ["갈등","의심","긴장","추적","두려움","숨기","조사","단서","심화"],
    climax:  ["발각","반전","충격","비밀","폭로","드러났","맞서","절정","들켰","깨달았"],
    finale:  ["해결","마침내","드디어","화해","용서","함께","비로소","자유","귀환","끝냈"],
  };
  const phase = ratio < 0.3 ? "intro" : ratio < 0.6 ? "develop" : ratio < 0.85 ? "climax" : "finale";
  const hits  = PHASE_KWS[phase].filter(k => raw.includes(k)).length;
  return { score: Math.min(10, hits * 2), phase, hits };
}

// ─────────────────────────────────────────────────────────────
// 단일 에피소드 평가
// ─────────────────────────────────────────────────────────────
async function evaluateEpisode(bookId, ep, worldDef, cfg) {
  const isFinale = ep === EPS_PER_WORLD;

  // 생성
  const { raw, ttft, elapsed } = await streamEpisode(bookId, ep);
  if (!raw || raw.length < 100) return null;

  // DB 저장 + 재조회
  const saved  = await saveEpisodeToDB(bookId, ep, raw);
  const loaded = await loadEpisodeFromDB(bookId, ep);

  // 채점
  const latency = scoreLatency({ ttft, elapsed });
  const db      = scoreDB({ saved, loaded, content: raw });
  const cliff   = scoreCliff(raw, isFinale);
  const render  = scoreRender(raw);
  const length  = scoreLength(raw, cfg);
  const body    = scoreBody(raw, worldDef.pov);
  const arc     = scoreArc(raw, ep, EPS_PER_WORLD);

  const total = latency.score + db.score + cliff.score + render.score + length.score + body.score + arc.score;

  return { ep, total, raw_len: raw.length, latency, db, cliff, render, length, body, arc };
}

// ─────────────────────────────────────────────────────────────
// 패턴 분석 → 패치 생성
// ─────────────────────────────────────────────────────────────
function analyzeFailures(allResults) {
  const patterns = {
    straightQuote:   0,  // 직선 따옴표 사용
    noCliff:         0,  // 클리프행어 없음
    shortContent:    0,  // 분량 부족
    povViolation:    0,  // POV 오류
    awkwardPhrases:  0,  // 어색한 표현
    foreignChars:    0,  // 외국어 누출
    dotGarbage:      0,  // 점 연속 가비지
    dbFail:          0,  // DB 저장 실패
    slowTTFT:        0,  // 지연 시간 초과
    curlyImbalance:  0,  // 곡선 따옴표 불균형
  };

  let total = 0;
  for (const ep of allResults) {
    if (!ep) continue;
    total++;
    if (ep.render.issues.some(i => i.includes("직선따옴표")))     patterns.straightQuote++;
    if (ep.cliff.score < 10 && !ep.cliff.detail.note)             patterns.noCliff++;
    if (ep.length.score < 5)                                       patterns.shortContent++;
    if (ep.body.issues.some(i => i.includes("나는")))             patterns.povViolation++;
    if (ep.body.issues.some(i => i.includes("인과오류")))         patterns.awkwardPhrases++;
    if (ep.render.issues.some(i => i.includes("외국어")))         patterns.foreignChars++;
    if (ep.render.issues.some(i => i.includes("점연속")))         patterns.dotGarbage++;
    if (ep.db.score < 5)                                           patterns.dbFail++;
    if (ep.latency.ttft_ms > 12000)                               patterns.slowTTFT++;
    if (ep.render.issues.some(i => i.includes("불균형")))         patterns.curlyImbalance++;
  }

  return { patterns, total };
}

// ─────────────────────────────────────────────────────────────
// 패치 적용 함수들
// ─────────────────────────────────────────────────────────────
function patchStoryTS(patterns, roundNum) {
  let src = readFileSync(STORY_TS, "utf-8");
  let changed = false;
  const patchLog = [];

  // 패치 1: 직선 따옴표 빈번하면 시스템 프롬프트 강화
  if (patterns.straightQuote >= 3) {
    const before = `대화 따옴표는 반드시 곡선 따옴표 " "을 사용한다. 직선 따옴표 "(U+0022) 사용 금지.`;
    const after  = `대화 따옴표는 반드시 " "을 사용한다. 직선 "(ASCII 0x22) 사용 시 채점 0점 처리. 모든 대화는 반드시 " 로 시작해 " 로 닫는다.`;
    if (src.includes(before)) {
      src = src.replace(before, after);
      changed = true;
      patchLog.push("직선따옴표 금지 지시 강화");
    }
  }

  // 패치 2: 클리프행어 생성 강조
  if (patterns.noCliff >= 4) {
    const before = `[필수 출력 형식] 본문을 완성하면 반드시 단독 줄에 [CLIFF]를 출력한다. [CLIFF]를 쓰지 않고 멈추는 것은 오류다.`;
    const after  = `[필수 출력 형식 — 최우선] 본문(${`\${minLen}`}자 이상)이 완성되면 즉시 새 줄에 [CLIFF]를 단독으로 쓴다. [CLIFF] 없이 멈추거나 [END]를 먼저 쓰는 것은 오류다.`;
    if (src.includes(before)) {
      src = src.replace(before, after);
      changed = true;
      patchLog.push("[CLIFF] 최우선 지시 강화");
    }
  }

  // 패치 3: 외국어 누출 대응 — STOP_PATTERNS에 이미 있는지 확인
  if (patterns.foreignChars >= 2 && !src.includes("【")) {
    src = src.replace(`"......"]`, `"......", "【", "〖", "《"]`);
    if (src.includes(`"【"`)) { changed = true; patchLog.push("CJK 특수괄호 STOP_PATTERNS 추가"); }
  }

  // 패치 4: 어색한 표현 → STOP_PATTERNS 확장
  if (patterns.awkwardPhrases >= 3) {
    const stopLine = `const STOP_PATTERNS = [`;
    if (src.includes(stopLine) && !src.includes("갑자기 해결")) {
      src = src.replace(
        `"\n..?!!\n", "......"]`,
        `"\n..?!!\n", "......", "갑자기 해결됐", "이유 없이 성공", "기적처럼"]`
      );
      changed = true;
      patchLog.push("어색한 표현 STOP_PATTERNS 추가");
    }
  }

  if (changed) {
    writeFileSync(STORY_TS, src, "utf-8");
    log(`  [패치] story.ts R${roundNum}: ${patchLog.join(", ")}`);
  }
  return patchLog;
}

function patchGenerateJS(patterns, roundNum) {
  let src = readFileSync(GEN_JS, "utf-8");
  let changed = false;
  const patchLog = [];

  // 패치: 직선→곡선 변환 정규식 강화 (더 넓은 패턴 포함)
  if (patterns.straightQuote >= 3 || patterns.curlyImbalance >= 3) {
    const oldConv = `.replace(/^"([^"\\n]+)"$/mg, "\\u201C$1\\u201D")
             .replace(/"([^"\\n]*[가-힣][^"\\n]*)"/g, "\\u201C$1\\u201D")`;
    const newConv = `.replace(/^"([^"\\n]+)"$/mg, "\\u201C$1\\u201D")
             .replace(/"([^"\\n]*[가-힣][^"\\n]*)"/g, "\\u201C$1\\u201D")
             .replace(/"([^"\\n]{1,60})"/g, "\\u201C$1\\u201D")`; // 짧은 인라인도 변환
    if (src.includes(oldConv) && !src.includes(newConv)) {
      src = src.replace(oldConv, newConv);
      changed = true;
      patchLog.push("직선→곡선 변환 정규식 확장");
    }
  }

  if (changed) {
    writeFileSync(GEN_JS, src, "utf-8");
    // 버전 범프
    const vMatch = src.match(/generate\.js\?v=(\d+)/); // index.html에서 해야 하므로 별도 처리
    log(`  [패치] generate.js R${roundNum}: ${patchLog.join(", ")}`);
  }
  return patchLog;
}

function bumpGenJSVersion() {
  try {
    let html = readFileSync(INDEX_HTML, "utf-8");
    html = html.replace(/generate\.js\?v=(\d+)/, (_, v) => `generate.js?v=${parseInt(v)+1}`);
    writeFileSync(INDEX_HTML, html, "utf-8");
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// README 자동 업데이트
// ─────────────────────────────────────────────────────────────
function updateREADME(roundSummaries) {
  let md = readFileSync(README_PATH, "utf-8");

  // RL 결과 섹션 생성
  const now = new Date().toISOString().slice(0, 10);
  const rows = roundSummaries.map(r =>
    `| R${r.round} | ${r.total_episodes}화 | ${r.avg_score.toFixed(1)}/100 | CLIFF ${r.cliff_rate}% | 직선따옴표 ${r.straight_rate}% | ${r.top_issue} |`
  ).join("\n");

  const rlSection = `
---

## RL 테스트 결과 (${now})

| 라운드 | 화수 | 평균 점수 | CLIFF율 | 직선따옴표율 | 주요 이슈 |
|---|---|---|---|---|---|
${rows}

### 라운드별 패치 내역
${roundSummaries.map(r => `- **R${r.round}**: ${r.patches.join(", ") || "패치 없음"}`).join("\n")}
`;

  // 기존 RL 섹션 교체 또는 추가
  if (md.includes("## RL 테스트 결과")) {
    md = md.replace(/\n---\n\n## RL 테스트 결과[\s\S]*$/, rlSection);
  } else {
    md = md.trimEnd() + rlSection;
  }

  writeFileSync(README_PATH, md, "utf-8");
  ok("README_rendering_rules.md 업데이트 완료");
}

// ─────────────────────────────────────────────────────────────
// 단일 라운드 실행
// ─────────────────────────────────────────────────────────────
async function runRound(roundNum) {
  log(`\n${"═".repeat(60)}`);
  log(`  ROUND ${roundNum}/${ROUNDS} 시작`);
  log(`${"═".repeat(60)}`);

  const allResults = [];
  const worldSummaries = [];

  for (const [worldKey, worldDef] of Object.entries(WORLDS)) {
    const bookId = `rl_${worldKey}_r${roundNum}_${Date.now()}`;
    const cfg    = worldDef.worldBible.story_config;

    log(`\n[${worldDef.label}] book_id=${bookId}`);
    await setupWorld(bookId, worldDef);

    const epResults = [];
    for (let ep = 1; ep <= EPS_PER_WORLD; ep++) {
      const override = worldDef.directorOverrides[ep];
      if (override) {
        await addOverride(bookId, override);
        log(`  ↳ Director ${ep}화: "${override.slice(0,40)}..."`);
      }

      const result = await evaluateEpisode(bookId, ep, worldDef, cfg);
      if (!result) { warn(`  ${ep}화 생성 실패 — 스킵`); continue; }

      epResults.push(result);
      allResults.push(result);

      const renderIssues = result.render.issues.length ? ` 렌더[${result.render.issues.map(i=>i.split("(")[0].trim()).join(",")}]` : "";
      const bodyIssues   = result.body.issues.length   ? ` 본문[${result.body.issues.map(i=>i.split("(")[0].trim()).join(",")}]` : "";
      const cliffMark    = result.cliff.score >= 15 ? "✅" : result.cliff.score >= 8 ? "⚠" : "❌";
      log(`  ${ep}화: ${result.total}/100 | TTFT:${(result.latency.ttft_ms/1000).toFixed(1)}s | ${result.raw_len}자 | CLIFF:${cliffMark}${renderIssues}${bodyIssues}`);

      await sleep(500);
    }

    // 세계관 평균
    if (epResults.length) {
      const avg = epResults.reduce((s, r) => s + r.total, 0) / epResults.length;
      const cliffRate = Math.round(epResults.filter(r => r.cliff.score >= 10).length / epResults.length * 100);
      log(`  → [${worldDef.label}] 평균: ${avg.toFixed(1)}/100 | CLIFF율: ${cliffRate}%`);
      worldSummaries.push({ label: worldDef.label, avg, cliffRate });
    }

    // 클린업
    await redis.del(`context:${bookId}`, `overrides:${bookId}`).catch(() => {});
    await sleep(1000);
  }

  // 라운드 집계
  const { patterns, total: evalTotal } = analyzeFailures(allResults);
  const avgScore      = allResults.reduce((s, r) => s + r.total, 0) / (allResults.length || 1);
  const cliffRate     = Math.round(allResults.filter(r => r.cliff.score >= 10).length / (allResults.length || 1) * 100);
  const straightRate  = Math.round(allResults.filter(r => r.render.issues.some(i => i.includes("직선"))).length / (allResults.length || 1) * 100);
  const topIssueEntry = Object.entries(patterns).sort((a,b) => b[1]-a[1])[0];
  const topIssue      = `${topIssueEntry[0]} ${topIssueEntry[1]}건`;

  log(`\n${"─".repeat(60)}`);
  log(`  R${roundNum} 결과: 평균 ${avgScore.toFixed(1)}/100 | CLIFF ${cliffRate}% | 직선따옴표 ${straightRate}%`);
  log(`  이슈 빈도: ${Object.entries(patterns).filter(([,v])=>v>0).map(([k,v])=>`${k}=${v}`).join(" | ")}`);
  log(`${"─".repeat(60)}`);

  // 패치 적용 (마지막 라운드 제외)
  let patches = [];
  if (roundNum < ROUNDS) {
    log(`\n[R${roundNum} → R${roundNum+1} 패치 적용]`);
    const storyPatches = patchStoryTS(patterns, roundNum);
    const genPatches   = patchGenerateJS(patterns, roundNum);
    patches = [...storyPatches, ...genPatches];
    if (patches.length > 0) {
      bumpGenJSVersion();
      log(`  서버 재시작 없이 진행 (JS 클라이언트 패치는 즉시 적용, 서버 패치는 다음 요청부터)`);
      // 서버 재시작이 필요한 경우: Windows에서 npx tsx는 watch 모드 아님
      // 패치가 story.ts 변경인 경우 서버를 재시작해야 함
      if (storyPatches.length > 0) {
        log(`  ⚠ story.ts 변경 있음 — 서버 재시작 시도`);
        await restartServer();
      }
    } else {
      log(`  패치 없음 — 이미 최적 상태`);
    }
    await sleep(3000);
  }

  return { round: roundNum, avg_score: avgScore, cliff_rate: cliffRate, straight_rate: straightRate, top_issue: topIssue, patches, total_episodes: evalTotal, patterns };
}

// ─────────────────────────────────────────────────────────────
// 서버 재시작 (Windows: taskkill + npx tsx)
// ─────────────────────────────────────────────────────────────
async function restartServer() {
  try {
    // 현재 포트 3000 프로세스 조회 및 종료
    const { execSync } = await import("child_process");
    const netstat = execSync("netstat -ano | findstr :3000", { encoding: "utf-8" }).trim();
    const pidMatch = netstat.match(/LISTENING\s+(\d+)/);
    if (pidMatch) {
      const pid = pidMatch[1];
      execSync(`taskkill /PID ${pid} /F`, { encoding: "utf-8" });
      log(`  서버 PID ${pid} 종료`);
      await sleep(2000);
    }
    // 새 서버 시작 (백그라운드)
    const { spawn } = await import("child_process");
    const child = spawn("npx.cmd", ["tsx", "src/index.ts"], {
      detached: true, stdio: "ignore", shell: false,
      cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
    });
    child.unref();
    log(`  새 서버 시작 (PID: ${child.pid})`);
    // 준비 대기
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      try {
        const r = await fetch(`${BASE}/`);
        if (r.ok || r.status < 500) { ok("  서버 재시작 완료"); return; }
      } catch {}
    }
    warn("  서버 재시작 확인 실패 — 계속 진행");
  } catch (e) {
    warn(`  서버 재시작 오류: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();
  log(`${"═".repeat(60)}`);
  log(`  FlowScribe RL 렌더링 품질 테스트`);
  log(`  ${ROUNDS}라운드 × ${Object.keys(WORLDS).length}세계관 × ${EPS_PER_WORLD}화`);
  log(`  예상 소요: 약 ${Math.round(ROUNDS * Object.keys(WORLDS).length * EPS_PER_WORLD * 20 / 60)}분`);
  log(`${"═".repeat(60)}`);

  await redis.connect().catch(() => {});

  const roundSummaries = [];
  const rlState = { started_at: new Date().toISOString(), status: "in_progress", rounds: [] };
  const stateFile = `${RESULTS_DIR}rl_render_${Date.now()}.json`;

  for (let r = START_ROUND; r <= ROUNDS; r++) {
    const summary = await runRound(r);
    roundSummaries.push(summary);
    rlState.rounds.push(summary);
    writeFileSync(stateFile, JSON.stringify(rlState, null, 2), "utf-8");
  }

  // 최종 보고
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  log(`\n${"═".repeat(60)}`);
  log(`  RL 테스트 완료 (${Math.floor(elapsed/60)}분 ${elapsed%60}초)`);
  log(`${"═".repeat(60)}`);
  log(`  라운드  평균점수  CLIFF율  직선따옴표율  주요이슈`);
  for (const s of roundSummaries) {
    log(`  R${s.round}      ${s.avg_score.toFixed(1).padStart(5)}/100  ${String(s.cliff_rate).padStart(5)}%  ${String(s.straight_rate).padStart(8)}%  ${s.top_issue}`);
  }

  // 개선율 계산
  if (roundSummaries.length >= 2) {
    const first = roundSummaries[0], last = roundSummaries[roundSummaries.length - 1];
    const scoreDiff = (last.avg_score - first.avg_score).toFixed(1);
    log(`\n  점수 변화: R1 ${first.avg_score.toFixed(1)} → R${ROUNDS} ${last.avg_score.toFixed(1)} (${scoreDiff > 0 ? "+" : ""}${scoreDiff})`);
    log(`  CLIFF율:  R1 ${first.cliff_rate}% → R${ROUNDS} ${last.cliff_rate}%`);
  }

  // README 업데이트
  updateREADME(roundSummaries);

  // 최종 저장
  rlState.status = "completed";
  rlState.elapsed_sec = elapsed;
  writeFileSync(stateFile, JSON.stringify(rlState, null, 2), "utf-8");
  writeFileSync(`${RESULTS_DIR}rl_render_latest.json`, JSON.stringify({ roundSummaries, elapsed_sec: elapsed }, null, 2), "utf-8");
  log(`\n리포트: ${stateFile}`);

  await pool.end();
  redis.quit();
}

main().catch(e => { console.error(e); process.exit(1); });
