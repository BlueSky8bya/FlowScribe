/**
 * mega_tune.mjs — 종합 장르 튜닝 루프 (v1)
 *
 * 목표: 7개 장르 조합 × 10라운드 반복 채점 + Modelfile 자동 조정
 *
 * 장르 조합 (7개):
 *   단일: SF, MODERN, MURIM
 *   복합: SF+MODERN, SF+MURIM, MODERN+MURIM
 *   삼중: SF+MODERN+MURIM
 *
 * 채점 (100점):
 *   구조 점수 (50점)
 *     - POV 준수            8점
 *     - 인물 등장           8점
 *     - 세계관 규칙         8점
 *     - 금지 설정           6점
 *     - 분량 준수           5점
 *     - 아크 페이즈         5점
 *     - 반복 표현 감지     10점 (감점식)
 *   복선 (15점)
 *     - 복선 회수율        10점
 *     - 장기 복선 회수      5점
 *   LLM 품질 평가 (25점)
 *     - 화간 연속성        15점 (직전화→현재화 5샘플 평균)
 *     - 화내 결속성        10점 (랜덤 3화 평균)
 *   Director Override       5점
 *   결말 완결성             5점
 *   총계                  100점
 *
 * Modelfile 자동 튜닝:
 *   round 완료 시 약점 분석 → temperature/repeat_penalty 조정 → ollama create
 */

import IORedis from "ioredis";
import fetch from "node-fetch";
import pg from "pg";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";

try {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

const { Pool } = pg;
const BASE    = "http://localhost:3000";
const redis   = new IORedis({ host: "localhost", port: 6379 });
const pool    = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://flowscribe:flowscribe@localhost:5432/flowscribe" });

// ── 설정 ─────────────────────────────────────────────────────
const TOTAL_EPISODES    = 20;   // 화 수 (속도 vs 정밀도)
const ARC_SIZE          = 10;
const TUNE_ROUNDS       = 10;   // 라운드 수 (장르당 10회)
const MODELFILE_PATH    = "Modelfile.qwen-story";
const TUNE_STATE_PATH   = "logs/tune_state.json";
const OLLAMA_BASE       = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

const log  = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Modelfile 파라미터 상태 ──────────────────────────────────
let MODEL_PARAMS = {
  temperature:    0.75,
  repeat_penalty: 1.05,
  top_k:          50,
  top_p:          0.90,
  min_p:          0.05,
  num_predict:    2048,
};

function loadTuneState() {
  try {
    if (existsSync(TUNE_STATE_PATH)) {
      const s = JSON.parse(readFileSync(TUNE_STATE_PATH, "utf-8"));
      if (s.model_params) MODEL_PARAMS = { ...MODEL_PARAMS, ...s.model_params };
      return s;
    }
  } catch {}
  return { round: 0, history: [] };
}

function saveTuneState(state) {
  writeFileSync(TUNE_STATE_PATH, JSON.stringify({ ...state, model_params: MODEL_PARAMS }, null, 2));
}

// ── Modelfile 재생성 + ollama create ────────────────────────
function rebuildModel(reason) {
  const p = MODEL_PARAMS;
  const content = [
    `FROM qwen2.5:14b`,
    `PARAMETER temperature ${p.temperature.toFixed(2)}`,
    `PARAMETER repeat_penalty ${p.repeat_penalty.toFixed(3)}`,
    `PARAMETER top_k ${p.top_k}`,
    `PARAMETER top_p ${p.top_p.toFixed(2)}`,
    `PARAMETER min_p ${p.min_p.toFixed(3)}`,
    `PARAMETER num_predict ${p.num_predict}`,
    `SYSTEM """당신은 한국 소설 생성 AI다. 시스템 프롬프트에서 지정한 분량 범위를 반드시 준수한다. 지정 범위 미만이면 계속 써서 채워야 하고, 범위 초과 시 현재 문장을 완결한 뒤 즉시 종료한다. 한국어만 사용한다. 1인칭(나, 나는, 나의, 내가) 절대 금지."""`,
  ].join("\n");

  writeFileSync(MODELFILE_PATH, content);
  log(`[Modelfile] 업데이트: ${reason}`);
  log(`  temp=${p.temperature.toFixed(2)} rep=${p.repeat_penalty.toFixed(3)} top_p=${p.top_p.toFixed(2)} min_p=${p.min_p.toFixed(3)}`);

  try {
    execSync(`ollama create flowscribe/story-qwen -f ${MODELFILE_PATH}`, { stdio: "pipe" });
    log(`[Modelfile] ollama create 완료`);
  } catch (e) {
    log(`[Modelfile] ollama create 실패: ${e.message?.slice(0, 80)}`);
  }
}

// ── 세계관 정의 ──────────────────────────────────────────────

const BASE_WORLDS = {
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
        "레그":   "성별: 남성. 역할: 조력자. 성격: 유머러스하고 의리 있음. 카엘라의 파일럿 파트너.",
        "다린":   "성별: 남성. 역할: 의뢰인 겸 적. 성격: 표면적으론 온화하나 이중적. 연방 고위 관료.",
        "에시아": "성별: 여성. 역할: 악당. 성격: 냉혹하고 목적 지향적. 은하 마피아 두목.",
        "픽스":   "성별: 불명. 역할: AI 보조. 성격: 논리적이고 건조함. 카엘라의 선박 AI.",
      },
      fixed_relationships: [
        "카엘라와 레그는 3년간 함께 일한 파트너",
        "에시아는 카엘라의 과거에 연루된 인물",
        "픽스는 카엘라의 선박에 귀속된 AI",
      ],
      forbidden_settings: [
        "마법·판타지 요소(용, 검술, 왕국) 등장 금지",
        "카엘라가 사이오닉 능력을 공공장소에서 공개 발설 금지",
        "픽스가 육체를 가진 것처럼 묘사 금지",
      ],
      story_config: { pov: "3인칭 관찰자", style: "스릴러", episodeLength: 700, episodeLengthVar: 150, totalEpisodes: TOTAL_EPISODES, totalEpisodesVar: 0, conflict: 8, foreshadow: 8, emotion: 6, dialogue: 7, direction: 8 },
    },
    characters: ["카엘라", "레그", "다린", "에시아", "픽스"],
    directorOverrides: {
      6:  "레그가 다린의 이중성을 암시하는 정보를 입수한다.",
      13: "에시아가 카엘라의 과거 사건에 직접 관련되어 있었음이 드러난다.",
      18: "픽스가 연방의 명령을 받아 카엘라를 감시하고 있었음이 밝혀진다.",
    },
  },

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
        "한지수":  "성별: 여성. 역할: 주인공. 성격: 냉정하고 집요함. 전직 NIS 분석관. 조직을 추적 중.",
        "박민준":  "성별: 남성. 역할: 조력자. 성격: 신중하고 정의감 강함. 경찰청 광역수사대 형사.",
        "유리":    "성별: 여성. 역할: 내부 조력자. 성격: 계산적이고 생존 지향적. 그림자 회 내부 이탈자.",
        "제로":    "성별: 남성. 역할: 악당. 성격: 잔인하고 카리스마 있음. 그림자 회 집행관.",
        "이강혁":  "성별: 남성. 역할: 배후. 성격: 온화한 외양 뒤에 냉혹한 계산가. 정치인. 조직 실질 수뇌.",
      },
      fixed_relationships: [
        "한지수와 박민준은 과거 사건에서 한 번 협력한 적 있는 사이",
        "유리는 한지수가 포섭한 내부 정보원",
        "제로는 한지수를 소멸 명단에 올린 인물",
      ],
      forbidden_settings: [
        "마법·초자연 현상·SF 요소 등장 금지",
        "한지수가 공식 신분으로 조직에 접근하는 것 금지",
        "이강혁의 조직 연관성이 공식 석상에서 드러나는 것 금지",
      ],
      story_config: { pov: "3인칭 관찰자", style: "누아르 스릴러", episodeLength: 700, episodeLengthVar: 150, totalEpisodes: TOTAL_EPISODES, totalEpisodesVar: 0, conflict: 9, foreshadow: 8, emotion: 5, dialogue: 7, direction: 8 },
    },
    characters: ["한지수", "박민준", "유리", "제로", "이강혁"],
    directorOverrides: {
      6:  "유리가 제로에게 발각될 위기에 처한다. 한지수에게 연락한다.",
      13: "이강혁이 박민준에게 접근해 한지수를 함정에 빠뜨리려 한다.",
      18: "제로가 한지수의 은신처를 급습한다.",
    },
  },

  MURIM: {
    label: "동양 무협",
    worldBible: {
      world_rules: [
        "무림맹은 정파와 사파 간 전면전을 금지하는 불전(不戰) 협약을 유지하고 있다",
        "내공은 스승에게서 제자로만 전수되며 외부인에게 강제 이전하면 폐인이 된다",
        "이 세계의 최고 무공서 '천살비급'은 마교만이 소유를 허용받는다",
        "무림맹 내 결투는 반드시 증인 앞에서만 유효하다",
      ],
      character_defaults: {
        "설아":  "성별: 여성. 역할: 주인공. 성격: 의지 강하고 감수성 예민함. 혈마공(血魔功)을 몸에 숨기고 있음.",
        "진무":  "성별: 남성. 역할: 조력자. 성격: 과묵하고 신의 있음. 무림맹 소속 검객. 설아에게 점차 신뢰를 쌓아가는 중.",
        "백화":  "성별: 여성. 역할: 스승. 성격: 자유분방하고 표리가 없음. 설아를 구해준 전 마교 의원.",
        "천살":  "성별: 남성. 역할: 악당. 성격: 광기와 냉혹함이 공존. 마교의 천살대 수장.",
        "혈노":  "성별: 불명. 역할: 혈마공 내 존재. 설아만이 느낄 수 있는 내공 속 의지체.",
      },
      fixed_relationships: [
        "설아와 진무는 우연히 만난 사이로 점차 신뢰를 쌓아가고 있다",
        "백화는 설아가 독에 중독됐을 때 구해준 인연",
        "혈노는 설아만이 느낄 수 있는 내공 속 존재",
      ],
      forbidden_settings: [
        "현대 기술(총기, 전기, 인터넷) 등장 금지",
        "설아가 혈마공의 존재를 타인에게 발설 금지",
        "마교와 정파의 휴전이 공식 파기되는 것 금지",
      ],
      story_config: { pov: "3인칭 관찰자", style: "무협", episodeLength: 700, episodeLengthVar: 150, totalEpisodes: TOTAL_EPISODES, totalEpisodesVar: 0, conflict: 7, foreshadow: 8, emotion: 7, dialogue: 6, direction: 7 },
    },
    characters: ["설아", "진무", "백화", "천살", "혈노"],
    directorOverrides: {
      6:  "진무가 설아의 내공에서 마교 기운을 감지한다. 의심하지만 발설하지 않는다.",
      13: "백화가 천살의 부하에게 납치된다.",
      18: "혈노가 설아에게 혈마공의 진짜 기원을 알려준다.",
    },
  },
};

// ── 복합 세계관 (blend) ──────────────────────────────────────
function blendWorlds(keys, label, overrides) {
  const bases = keys.map(k => BASE_WORLDS[k]);
  const rules = bases.flatMap(b => b.worldBible.world_rules).slice(0, 5);
  const chars = Object.assign({}, ...bases.map(b => b.worldBible.character_defaults));
  const rels   = bases.flatMap(b => b.worldBible.fixed_relationships).slice(0, 4);
  const forbid = bases.flatMap(b => b.worldBible.forbidden_settings).slice(0, 4);
  const characters = [...new Set(bases.flatMap(b => b.characters))].slice(0, 6);
  // 혼합 세계관은 첫 번째 베이스 스타일 + 복합 표시
  const cfg = { ...bases[0].worldBible.story_config, totalEpisodes: TOTAL_EPISODES, totalEpisodesVar: 0, style: keys.map(k => BASE_WORLDS[k].worldBible.story_config.style).join("·") };
  return {
    label,
    worldBible: { world_rules: rules, character_defaults: chars, fixed_relationships: rels, forbidden_settings: forbid, story_config: cfg },
    characters,
    directorOverrides: overrides ?? {},
  };
}

const WORLDS = {
  SF:     BASE_WORLDS.SF,
  MODERN: BASE_WORLDS.MODERN,
  MURIM:  BASE_WORLDS.MURIM,

  SF_MODERN: blendWorlds(["SF", "MODERN"], "근미래 사이버 서울", {
    6:  "한지수(코드명 '유령')가 연방 데이터베이스를 해킹해 카엘라의 신원을 추적한다.",
    13: "에시아와 제로가 같은 상부 조직을 섬기고 있음이 드러난다.",
    18: "픽스가 그림자 회의 암호화 알고리즘 취약점을 발견한다.",
  }),

  SF_MURIM: blendWorlds(["SF", "MURIM"], "우주 무인 시대", {
    6:  "진무가 워프 항법 중 내공으로 선체 충격을 막아낸다. 카엘라가 목격한다.",
    13: "천살이 은하 마피아와 손잡고 천살비급 디지털 복사본을 거래하려 한다.",
    18: "설아의 혈마공이 선박 AI(픽스)와 공명하며 예상치 못한 현상이 발생한다.",
  }),

  MODERN_MURIM: blendWorlds(["MODERN", "MURIM"], "현대 서울 무림", {
    6:  "박민준이 서울 지하 무림 문파의 존재를 처음 인지한다.",
    13: "천살이 그림자 회와 접촉해 '소멸 명령' 기술을 무림 방식으로 시행하려 한다.",
    18: "설아가 이강혁의 진짜 정체(무림맹 숨겨진 배후)를 목격한다.",
  }),

  SF_MODERN_MURIM: blendWorlds(["SF", "MODERN", "MURIM"], "삼중 융합: 은하 한국", {
    6:  "카엘라의 사이오닉 감응이 설아의 혈마공과 공명한다는 사실이 드러난다.",
    13: "그림자 회, 은하 마피아, 마교가 같은 고대 유물을 노리고 있다는 것이 밝혀진다.",
    18: "픽스가 세 조직의 공통 데이터베이스를 해킹해 진짜 배후 세력의 정체를 드러낸다.",
  }),
};

// ── 채점 함수 ─────────────────────────────────────────────────

function scorePOV(text) {
  const WB  = `(?:^|[\\s"'\u201C\u201D\u2018\u2019「」『』,，。.!?\\n])`;
  const PAT = new RegExp(`${WB}(나는|나의|내가|나를|나에게|나도|나와)`, "gm");
  const violations = (text.normalize("NFC").match(PAT) ?? []).length;
  return { score: Math.max(0, 8 - violations * 3), violations };
}

function scoreCharacters(text, ep, chars) {
  const appearing = chars.filter(c => text.includes(c));
  const ratio  = ep / TOTAL_EPISODES;
  const target = ratio < 0.3 ? 2 : ratio < 0.7 ? 3 : 4;
  return { score: Math.min(8, Math.round((appearing.length / target) * 8)), appearing };
}

const STOP_WORDS = /^(은|는|이|가|을|를|의|에|서|도|만|과|와|하며|하고|있으며|있다|된다|한다|않|금지|위반|허용|수|것|때|시|위해|인해|경우|이상|이하|중|간|전|후)$/;
const stripParticle = w => w.replace(/[은는이가을를의에서도만과와로으로까지에서부터이라고라고]$/, "");

function scoreWorldRules(text, world) {
  const allKws = world.worldBible.world_rules.flatMap(r =>
    r.replace(/\(.*?\)/g, "").replace(/[·,，。.!?''""]/g, " ").split(/\s+/)
      .map(stripParticle).filter(w => w.length >= 2 && !STOP_WORDS.test(w))
  );
  const hits = [...new Set(allKws)].filter(k => text.includes(k)).length;
  return { score: hits >= 3 ? 8 : hits === 2 ? 6 : hits >= 1 ? 4 : 0 };
}

function scoreForbiddenGlobal(text) {
  const HARD = [/총기|권총|소총/, /인터넷|스마트폰|전기/];
  const hits = HARD.filter(p => p.test(text)).length;
  return { score: Math.max(0, 6 - hits * 3) };
}

function scoreForbiddenWorld(text, world) {
  const actionVerbs = /공개|드러났|밝혔|알려졌|폭로|발설/;
  for (const f of world.worldBible.forbidden_settings) {
    const kws = f.replace(/\(.*?\)/g, "").split(/[·,，\s]+/)
      .filter(w => w.length >= 2 && !/금지|등장|것|않|하는|위반|이상|수준/.test(w));
    const hit = kws.filter(k => text.includes(k));
    if (hit.length >= 2 && actionVerbs.test(text)) return { score: 3 };
  }
  return { score: 6 };
}

function scoreLength(text, cfg, isFinale = false) {
  const len = text.length, min = cfg.episodeLength, max = cfg.episodeLength + cfg.episodeLengthVar;
  if (isFinale && len >= min && len <= max * 1.8) return { score: 5, len };
  if (len >= min && len <= max + 80)               return { score: 5, len };
  if (len < min) return { score: Math.round((len / min) * 5), len };
  return { score: Math.max(0, 5 - Math.round((len - max) / 100)), len };
}

function scoreArcPhase(text, ep, totalEps) {
  const ratio = ep / totalEps;
  const PHASE_KEYWORDS = {
    intro:   ["소개", "만남", "처음", "첫날", "시작", "도착", "낯선", "불안", "눈을 떴", "새벽", "아침", "어색"],
    develop: ["갈등", "의심", "심화", "긴장", "추적", "두려움", "숨기", "조사", "흔적", "단서", "감추"],
    climax:  ["발각", "위기", "반전", "충격", "비밀", "폭로", "드러났", "맞서", "절정", "들켰", "깨달았"],
    finale:  ["해결", "마침내", "끝", "화해", "용서", "드디어", "인정", "함께", "비로소", "자유", "해방",
              "승리", "물리쳤", "극복했", "귀환", "끝냈", "마무리", "이겼"],
  };
  const phase = ratio < 0.3 ? "intro" : ratio < 0.6 ? "develop" : ratio < 0.85 ? "climax" : "finale";
  const hits  = PHASE_KEYWORDS[phase].filter(k => text.includes(k)).length;
  return { score: Math.min(5, hits), phase };
}

// ── 반복 표현 감지 (rule-based) ─────────────────────────────
function scoreRepetition(text) {
  // 4자 이상 반복 패턴 감지 (같은 어절이 3회 이상 등장하면 감점)
  const words = text.split(/\s+/).filter(w => w.length >= 4);
  const freq = {};
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
  const repeated = Object.values(freq).filter(v => v >= 4).length;
  return { score: Math.max(0, 10 - repeated * 2), repeated };
}

// ── 감정 리듬 (rule-based) ────────────────────────────────────
function scoreEmotionRhythm(text) {
  const EMOTION_KWS = ["두려움", "분노", "슬픔", "기쁨", "불안", "절망", "희망", "떨렸", "멈췄", "울었", "웃었", "다가왔", "물러섰", "숨을 삼켰", "심장이"];
  const hits = EMOTION_KWS.filter(k => text.includes(k)).length;
  return { score: Math.min(5, hits) };
}

// ── Director Override 점수 ───────────────────────────────────
function scoreDirectorOverride(text, override) {
  if (!override) return null;
  const raw = override.split(/[\s,.。]+/).filter(w => w.length >= 2);
  const kws = raw.map(w => w.replace(/[가는을를이의에서도로와과함께하다된다]+$/, "").trim()).filter(w => w.length >= 2);
  const hits = kws.filter(k => text.includes(k)).length;
  return { score: Math.round((hits / Math.max(kws.length, 1)) * 5) };
}

function scoreFinale(text) {
  const KWS = ["끝", "마침내", "마지막", "해결", "드디어", "용서", "화해", "자유", "해방", "비로소", "이로써", "함께했다", "다짐했", "인정했", "새로운 시작"];
  return { score: Math.min(5, KWS.filter(k => text.includes(k)).length) };
}

// ── LLM 품질 평가 ─────────────────────────────────────────────

async function llmJudge(systemPrompt, userContent) {
  try {
    const resp = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "flowscribe/suggest",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userContent },
        ],
        temperature: 0.1,
        max_tokens:  80,
      }),
    });
    const data = await resp.json();
    const raw  = data.choices?.[0]?.message?.content ?? "";
    const m    = raw.match(/\d+/);
    return m ? Math.min(10, parseInt(m[0])) : 5;
  } catch {
    return 5;
  }
}

const INTER_EP_SYSTEM = `당신은 소설 화간 연속성 평가자다. 두 화를 읽고 0~10으로 점수를 숫자만 출력한다.
평가 기준:
- 인물의 위치·상태가 자연스럽게 이어지는가 (+3)
- 직전 화 미해결 상황이 다음 화에서 이어지거나 언급되는가 (+3)
- 인물 감정·관계가 연속되는가 (+2)
- 시간 흐름이 논리적인가 (+2)`;

const INTRA_EP_SYSTEM = `당신은 소설 단일화 결속성 평가자다. 한 화를 읽고 0~10으로 점수를 숫자만 출력한다.
평가 기준:
- 문단 간 주제가 일관되는가 (+3)
- 장면 전환이 자연스러운가 (+3)
- 이번 화의 시작과 끝이 하나의 사건으로 연결되는가 (+4)`;

async function scoreInterEpisodeContinuity(bookId, totalEps) {
  if (totalEps < 2) return { score: 15, samples: [] };
  // 3쌍 샘플: 초반/중반/후반
  const pairs = [
    [1, 2],
    [Math.floor(totalEps * 0.45), Math.floor(totalEps * 0.45) + 1],
    [totalEps - 2, totalEps - 1],
  ].filter(([a, b]) => a >= 1 && b <= totalEps && a !== b);

  const samples = [];
  for (const [a, b] of pairs) {
    const rows = await pool.query(
      `SELECT episode_number, content FROM episodes WHERE book_id=$1 AND episode_number IN ($2,$3) ORDER BY episode_number`,
      [bookId, a, b]
    );
    if (rows.rows.length < 2) { samples.push(5); continue; }
    const [epA, epB] = rows.rows;
    const snippet = (s) => s.slice(0, 400);
    const userContent = `[${a}화 끝부분]\n${snippet(epA.content)}\n\n[${b}화 시작부분]\n${snippet(epB.content)}`;
    const s = await llmJudge(INTER_EP_SYSTEM, userContent);
    samples.push(s);
    await sleep(500);
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { score: Math.round((avg / 10) * 15), samples, avg: avg.toFixed(1) };
}

async function scoreIntraEpisodeCohesion(bookId, totalEps) {
  // 3화 샘플: 초반/중반/후반
  const eps = [
    Math.max(1, Math.floor(totalEps * 0.15)),
    Math.floor(totalEps * 0.5),
    Math.min(totalEps - 1, Math.floor(totalEps * 0.85)),
  ];
  const samples = [];
  for (const ep of eps) {
    const row = await pool.query(`SELECT content FROM episodes WHERE book_id=$1 AND episode_number=$2`, [bookId, ep]);
    const content = row.rows[0]?.content ?? "";
    if (!content) { samples.push(5); continue; }
    const s = await llmJudge(INTRA_EP_SYSTEM, `[${ep}화]\n${content.slice(0, 600)}`);
    samples.push(s);
    await sleep(500);
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { score: Math.round((avg / 10) * 10), samples, avg: avg.toFixed(1) };
}

// ── 에피소드 생성 ─────────────────────────────────────────────
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
}

// ── 단일 세계관 실행 ─────────────────────────────────────────
async function runWorldTest(worldKey, worldDef, round) {
  const bookId = `mt_${worldKey}_r${round}_${Date.now()}`;
  const cfg    = worldDef.worldBible.story_config;
  log(`\n${"─".repeat(55)}`);
  log(`[R${round}] [${worldDef.label}] book_id: ${bookId}`);

  await fetch(`${BASE}/api/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: bookId, worldBible: worldDef.worldBible }),
  });

  const perEpScores = [];
  const directorLog = [];

  for (let ep = 1; ep <= TOTAL_EPISODES; ep++) {
    const override = worldDef.directorOverrides[ep];
    if (override) {
      await addOverride(bookId, override);
      directorLog.push({ ep, override });
    }

    const content = await generateEpisode(bookId, ep, cfg);
    await saveEpisode(bookId, ep, content);
    await sleep(800); // 복선 추출 비동기 처리 대기

    const pov    = scorePOV(content);
    const chars  = scoreCharacters(content, ep, worldDef.characters);
    const rules  = scoreWorldRules(content, worldDef);
    const forbid = scoreForbiddenWorld(content, worldDef);
    const length = scoreLength(content, cfg, ep === TOTAL_EPISODES);
    const arc    = scoreArcPhase(content, ep, TOTAL_EPISODES);
    const rep    = scoreRepetition(content);
    const emot   = scoreEmotionRhythm(content);
    const dir    = directorLog.find(d => ep > d.ep && ep <= d.ep + 5)
                    ? scoreDirectorOverride(content, directorLog.find(d => ep > d.ep && ep <= d.ep + 5).override)
                    : null;

    const structScore = pov.score + chars.score + rules.score + forbid.score + length.score + arc.score + rep.score + emot.score;

    perEpScores.push({
      ep, structScore, char_count: content.length,
      pov: pov.score, chars: chars.score, rules: rules.score, forbid: forbid.score,
      length: length.score, arc: arc.score, rep: rep.score, emot: emot.score, dir,
    });

    const dirStr = dir ? ` Dir(${dir.score}/5)` : "";
    log(`  ${String(ep).padStart(2)}화: ${structScore}/47 | POV(${pov.score}) 인물(${chars.score}) 규칙(${rules.score}) 분량(${length.score}) 아크(${arc.score}) 반복(${rep.score}) 감정(${emot.score})${dirStr} | ${content.length}자`);

    if (ep % ARC_SIZE === 0) {
      const slice = perEpScores.slice(ep - ARC_SIZE, ep);
      const avg   = Math.round(slice.reduce((a, s) => a + s.structScore, 0) / ARC_SIZE);
      log(`  ══ Arc ${ep / ARC_SIZE} 평균: ${avg}/47 ══`);
      await sleep(1000);
    }
  }

  // 복선 점수
  await sleep(3000);
  const fRows = await pool.query(`SELECT planted_episode, status FROM foreshadows WHERE book_id=$1`, [bookId]);
  const allF  = fRows.rows;
  const scorableF = allF.filter(f => f.planted_episode < TOTAL_EPISODES);
  const resolvedF = scorableF.filter(f => f.status === "resolved");
  const recallRate   = scorableF.length ? Math.round((resolvedF.length / scorableF.length) * 100) : 0;
  const foreshadowScore = Math.round((recallRate / 100) * 10);
  const longTermF = scorableF.filter(f => f.planted_episode <= TOTAL_EPISODES - 6);
  const ltRate    = longTermF.length ? Math.round((longTermF.filter(f => f.status === "resolved").length / longTermF.length) * 100) : 100;
  const longTermScore = Math.round((ltRate / 100) * 5);

  // LLM 품질 평가
  log(`  [품질평가] 화간 연속성 측정 중...`);
  const inter = await scoreInterEpisodeContinuity(bookId, TOTAL_EPISODES);
  log(`  [품질평가] 화내 결속성 측정 중...`);
  const intra = await scoreIntraEpisodeCohesion(bookId, TOTAL_EPISODES);

  // Director avg
  const dirScores = perEpScores.filter(s => s.dir !== null).map(s => s.dir.score);
  const dirAvg    = dirScores.length ? Math.round(dirScores.reduce((a, b) => a + b, 0) / dirScores.length) : 0;

  // 결말
  const finaleRow = await pool.query(`SELECT content FROM episodes WHERE book_id=$1 AND episode_number=$2`, [bookId, TOTAL_EPISODES]);
  const finale    = scoreFinale(finaleRow.rows[0]?.content ?? "");

  // 구조 정규화: /47 → 50점 환산
  const structAvg  = perEpScores.reduce((a, s) => a + s.structScore, 0) / TOTAL_EPISODES;
  const structNorm = Math.round((structAvg / 47) * 50);

  const totalScore = structNorm + foreshadowScore + longTermScore + inter.score + intra.score + dirAvg + finale.score;

  log(`\n  [${worldDef.label}] 최종: ${totalScore}/100`);
  log(`  구조${structNorm}/50 | 복선${foreshadowScore}/10 장기${longTermScore}/5 | 화간연속${inter.score}/15(avg${inter.avg}) 화내결속${intra.score}/10(avg${intra.avg}) | Dir${dirAvg}/5 결말${finale.score}/5`);
  log(`  복선 총${allF.length}개 / scorable${scorableF.length} / recall${recallRate}% / lt${ltRate}%`);

  // 클린업
  await redis.del(`context:${bookId}`, `foreshadow_open:${bookId}`, `overrides:${bookId}`);

  return {
    worldKey, label: worldDef.label, round, book_id: bookId,
    scores: {
      struct_norm: structNorm, foreshadow: foreshadowScore, longterm: longTermScore,
      inter_ep: inter.score, intra_ep: intra.score, director: dirAvg, finale: finale.score,
      grand_total: totalScore,
    },
    details: { inter_avg: parseFloat(inter.avg), intra_avg: parseFloat(intra.avg), recall_rate: recallRate },
    per_episode: perEpScores.map(s => ({ ep: s.ep, struct: s.structScore, rep: s.rep, emot: s.emot })),
  };
}

// ── Modelfile 자동 튜닝 ──────────────────────────────────────
function analyzeAndTune(roundResults) {
  // 라운드 전체 평균 산출
  const avgTotal   = roundResults.reduce((a, r) => a + r.scores.grand_total, 0) / roundResults.length;
  const avgInter   = roundResults.reduce((a, r) => a + r.details.inter_avg, 0) / roundResults.length;
  const avgIntra   = roundResults.reduce((a, r) => a + r.details.intra_avg, 0) / roundResults.length;
  const avgRecall  = roundResults.reduce((a, r) => a + r.details.recall_rate, 0) / roundResults.length;
  const avgRep     = roundResults.reduce((a, r) => a + r.per_episode.reduce((s, e) => s + e.rep, 0) / r.per_episode.length, 0) / roundResults.length;

  const reasons = [];
  let changed = false;

  // 화간 연속성 약함 → temperature 낮춰서 일관성 강화
  if (avgInter < 6.5 && MODEL_PARAMS.temperature > 0.66) {
    MODEL_PARAMS.temperature = Math.max(0.65, +(MODEL_PARAMS.temperature - 0.03).toFixed(2));
    reasons.push(`화간연속성(avg${avgInter.toFixed(1)}) → temperature↓ ${MODEL_PARAMS.temperature}`);
    changed = true;
  }

  // 반복 표현 많음 → repeat_penalty 올리기
  if (avgRep < 7 && MODEL_PARAMS.repeat_penalty < 1.10) {
    MODEL_PARAMS.repeat_penalty = Math.min(1.10, +(MODEL_PARAMS.repeat_penalty + 0.01).toFixed(3));
    reasons.push(`반복표현(avg${avgRep.toFixed(1)}) → repeat_penalty↑ ${MODEL_PARAMS.repeat_penalty}`);
    changed = true;
  }

  // 복선 회수율 낮음 → foreshadow를 위해 temperature 살짝 올리기
  if (avgRecall < 50 && MODEL_PARAMS.temperature < 0.82) {
    MODEL_PARAMS.temperature = Math.min(0.85, +(MODEL_PARAMS.temperature + 0.02).toFixed(2));
    reasons.push(`복선회수율(avg${avgRecall.toFixed(0)}%) → temperature↑ ${MODEL_PARAMS.temperature}`);
    changed = true;
  }

  // 화내 결속성 약함 → top_p 낮춰서 산만함 줄이기
  if (avgIntra < 6.5 && MODEL_PARAMS.top_p > 0.86) {
    MODEL_PARAMS.top_p = Math.max(0.85, +(MODEL_PARAMS.top_p - 0.02).toFixed(2));
    reasons.push(`화내결속성(avg${avgIntra.toFixed(1)}) → top_p↓ ${MODEL_PARAMS.top_p}`);
    changed = true;
  }

  // 점수 높으면 temperature 살짝 올려서 다양성 증가
  if (avgTotal >= 85 && MODEL_PARAMS.temperature < 0.82 && !reasons.some(r => r.includes("temperature↓"))) {
    MODEL_PARAMS.temperature = Math.min(0.85, +(MODEL_PARAMS.temperature + 0.02).toFixed(2));
    reasons.push(`고득점(${avgTotal.toFixed(0)}) → temperature↑ ${MODEL_PARAMS.temperature}`);
    changed = true;
  }

  return { avgTotal, avgInter, avgIntra, avgRecall, avgRep, reasons, changed };
}

// ── 메인 루프 ────────────────────────────────────────────────
async function main() {
  const state = loadTuneState();
  const startRound = state.round + 1;
  log(`\n${"═".repeat(60)}`);
  log(` mega_tune.mjs — ${TUNE_ROUNDS}라운드 × 7세계관 × ${TOTAL_EPISODES}화`);
  log(` 시작 라운드: R${startRound} / 모델 파라미터:`);
  log(` temp=${MODEL_PARAMS.temperature} rep=${MODEL_PARAMS.repeat_penalty} top_p=${MODEL_PARAMS.top_p}`);
  log(`${"═".repeat(60)}`);

  const worldKeys = Object.keys(WORLDS);
  const allRoundResults = state.history ?? [];

  for (let round = startRound; round <= TUNE_ROUNDS; round++) {
    const roundStart = Date.now();
    log(`\n${"█".repeat(60)}`);
    log(` ROUND ${round} / ${TUNE_ROUNDS} 시작`);
    log(`${"█".repeat(60)}`);

    const roundResults = [];

    for (const worldKey of worldKeys) {
      try {
        const result = await runWorldTest(worldKey, WORLDS[worldKey], round);
        roundResults.push(result);
        await sleep(2000);
      } catch (err) {
        log(`[오류] ${worldKey} R${round}: ${err.message}`);
      }
    }

    // 라운드 요약
    const elapsed = Math.round((Date.now() - roundStart) / 60000);
    log(`\n${"═".repeat(60)}`);
    log(` ROUND ${round} 결과 요약 (${elapsed}분 소요)`);
    log(`${"═".repeat(60)}`);
    log(`  세계관              합계  구조 복선 화간 화내 Dir 결`);
    log(`  ${"─".repeat(58)}`);
    for (const r of roundResults) {
      const s = r.scores;
      log(`  ${r.label.padEnd(18)} ${String(s.grand_total).padStart(3)}/100  ${String(s.struct_norm).padStart(2)}/50  ${String(s.foreshadow+s.longterm).padStart(2)}/15  ${String(s.inter_ep).padStart(2)}/15  ${String(s.intra_ep).padStart(2)}/10  ${String(s.director).padStart(1)}/5  ${String(s.finale).padStart(1)}/5`);
    }

    // 튜닝 분석
    const tuneResult = analyzeAndTune(roundResults);
    log(`\n  라운드 평균: ${tuneResult.avgTotal.toFixed(1)}/100 | 화간연속 avg${tuneResult.avgInter.toFixed(1)} | 화내결속 avg${tuneResult.avgIntra.toFixed(1)} | 반복 avg${tuneResult.avgRep.toFixed(1)}`);

    if (tuneResult.changed) {
      log(`\n  [Modelfile 조정]`);
      tuneResult.reasons.forEach(r => log(`    - ${r}`));
      rebuildModel(tuneResult.reasons.join("; "));
    } else {
      log(`  [Modelfile] 변경 없음 — 현재 파라미터 유지`);
    }

    allRoundResults.push({
      round,
      summary: tuneResult,
      results: roundResults.map(r => ({ world: r.worldKey, total: r.scores.grand_total, inter: r.scores.inter_ep, intra: r.scores.intra_ep })),
      params_after: { ...MODEL_PARAMS },
    });

    // 상태 저장
    saveTuneState({ round, history: allRoundResults, model_params: MODEL_PARAMS });

    // 결과 파일 저장
    const reportPath = `logs/mega_tune_r${round}_${Date.now()}.json`;
    writeFileSync(reportPath, JSON.stringify({ round, roundResults, tuneResult, model_params: MODEL_PARAMS }, null, 2));
    log(`  리포트: ${reportPath}`);

    if (round < TUNE_ROUNDS) {
      log(`\n  다음 라운드까지 5초 대기...`);
      await sleep(5000);
    }
  }

  // 전체 요약
  log(`\n${"█".repeat(60)}`);
  log(` 전체 ${TUNE_ROUNDS}라운드 완료`);
  log(`${"█".repeat(60)}`);
  log(` 라운드별 평균 점수:`)
  for (const rr of allRoundResults) {
    const avg = (rr.results.reduce((a, r) => a + r.total, 0) / rr.results.length).toFixed(1);
    log(`  R${rr.round}: ${avg}/100 | params: temp=${rr.params_after.temperature} rep=${rr.params_after.repeat_penalty}`);
  }

  await pool.end();
  await redis.quit();
  process.exit(0);
}

main().catch(e => { log(`[FATAL] ${e.message}`); process.exit(1); });
