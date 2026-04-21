/**
 * mega_tune.mjs — 종합 장르 튜닝 루프 (v2)
 *
 * v1 → v2 주요 개선:
 *   [튜닝 로직]    규칙 충돌 제거 — 가장 약한 지표 1개만 변경 (one-at-a-time)
 *   [롤백]         직전 변경이 점수 하락 유발 시 자동 복구
 *   [이동 평균]    단일 라운드 대신 최근 N라운드 평균으로 판단 (노이즈 감쇠)
 *   [분산 게이트]  라운드 내 σ가 크면 튜닝 유보 (신호/잡음 분리)
 *   [2단계 전략]   R1~R4 그리드 탐색 → R5+ 최적 파라미터 기준 fine-tune
 *   [n-gram 반복]  어절 3-gram/4-gram + 문자 5-gram 기반 정교한 감지
 *   [규칙 매칭]    복합 명사(2어절) 우선 + 희귀 단일어로 보강
 *   [LLM Rubric]   숫자 점수 대신 yes/no 4문항 → 3샘플 중앙값
 *   [체크포인트]   세계관 완료마다 partial 저장 (중단 복구 가능)
 *   [에러 처리]    빈 에피소드 생성 시 세계관 abort / ollama 빌드 실패 시 파라미터 롤백
 *   [조기 종료]    최근 3R 개선 <1점 & σ<1.5면 수렴 판단 후 중단
 *
 * 장르 조합 (7개): SF, MODERN, MURIM, SF+MODERN, SF+MURIM, MODERN+MURIM, SF+MODERN+MURIM
 * 채점 (100점):
 *   구조 50점 (POV 8, 인물 8, 규칙 8, 금지 6, 분량 5, 아크 5, 반복 10) → /47 → /50 정규화
 *   복선 15점 (회수율 10 + 장기 복선 5)
 *   LLM 25점 (화간연속 15 + 화내결속 10)
 *   Director 5점 + 결말 5점
 */

import IORedis from "ioredis";
import fetch from "node-fetch";
import pg from "pg";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";

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

// ── 설정 ─────────────────────────────────────────────────────
const TOTAL_EPISODES        = 20;
const ARC_SIZE              = 10;
const TUNE_ROUNDS           = 10;
const EXPLORATION_ROUNDS    = 4;      // R1..R4 그리드 탐색
const MOVING_AVG_WINDOW     = 2;      // 이동 평균 윈도우
const VARIANCE_SKIP_THRESH  = 10.0;   // 라운드 σ가 이 이상이면 튜닝 유보
const EARLY_STOP_MIN_ROUND  = 7;      // 이 라운드 이후부터 조기종료 판단
const EARLY_STOP_IMPROVEMENT = 1.0;   // 최근 3R 개선이 이 미만이면 수렴
const EARLY_STOP_STD         = 1.5;
const MODELFILE_PATH        = "Modelfile.qwen-story";
const TUNE_STATE_PATH       = "logs/tune_state.json";
const OLLAMA_BASE           = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

try { mkdirSync("logs", { recursive: true }); } catch {}

const log   = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
const sleep = (ms)  => new Promise(r => setTimeout(r, ms));

// ── 통계 유틸 ────────────────────────────────────────────────
const mean   = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const stdev  = xs => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const median = xs => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const mi = Math.floor(s.length / 2); return s.length % 2 ? s[mi] : (s[mi-1] + s[mi]) / 2; };
const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = n => Math.round(n * 100) / 100;
const round3 = n => Math.round(n * 1000) / 1000;

// ── Modelfile 파라미터 & bounds ─────────────────────────────
let MODEL_PARAMS = {
  temperature:    0.75,
  repeat_penalty: 1.05,
  top_k:          50,
  top_p:          0.90,
  min_p:          0.05,
  num_predict:    2048,
};

const PARAM_BOUNDS = {
  temperature:    { min: 0.60, max: 0.88, step: 0.03 },
  repeat_penalty: { min: 1.02, max: 1.12, step: 0.01 },
  top_p:          { min: 0.82, max: 0.95, step: 0.02 },
  min_p:          { min: 0.02, max: 0.08, step: 0.01 },
};

// 탐색 단계 그리드 — 핵심 축(temperature × repeat_penalty) 스윕
const EXPLORATION_GRID = [
  { temperature: 0.72, repeat_penalty: 1.05, top_p: 0.90, min_p: 0.05 },
  { temperature: 0.78, repeat_penalty: 1.05, top_p: 0.90, min_p: 0.05 },
  { temperature: 0.75, repeat_penalty: 1.08, top_p: 0.88, min_p: 0.05 },
  { temperature: 0.75, repeat_penalty: 1.03, top_p: 0.92, min_p: 0.04 },
];

// ── 상태 관리 ────────────────────────────────────────────────
function loadTuneState() {
  try {
    if (existsSync(TUNE_STATE_PATH)) {
      const s = JSON.parse(readFileSync(TUNE_STATE_PATH, "utf-8"));
      if (s.model_params) MODEL_PARAMS = { ...MODEL_PARAMS, ...s.model_params };
      return { round: s.round ?? 0, history: s.history ?? [], last_change: s.last_change ?? null, partial: s.partial ?? null };
    }
  } catch {}
  return { round: 0, history: [], last_change: null, partial: null };
}

function saveTuneState(state) {
  writeFileSync(TUNE_STATE_PATH, JSON.stringify({ ...state, model_params: MODEL_PARAMS }, null, 2));
}

// ── Modelfile 재빌드 (실패 시 false 반환 → 호출자 롤백) ────
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
    execSync(`ollama create flowscribe/story-qwen -f ${MODELFILE_PATH}`, { stdio: "pipe", timeout: 120_000 });
    log(`[Modelfile] ollama create 완료`);
    return true;
  } catch (e) {
    log(`[Modelfile] ollama create 실패: ${e.message?.slice(0, 120)}`);
    return false;
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
      // 고유명사 태그 (v2: 규칙 매칭 정확도용) — 없으면 자동 추출 fallback
      specific_terms: ["은하 연방", "워프 항법", "크레딧 샤드", "사이오닉", "항성 중력권", "연방 등록"],
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
      specific_terms: ["그림자 회", "소멸 명령", "지하 금융망", "코드명", "광역수사대", "NIS 분석관"],
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
      specific_terms: ["무림맹", "정파", "사파", "천살비급", "혈마공", "마교", "불전 협약"],
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

// ── 복합 세계관 (v2: 수치 설정을 평균으로) ───────────────────
function blendWorlds(keys, label, overrides) {
  const bases = keys.map(k => BASE_WORLDS[k]);
  const rules  = bases.flatMap(b => b.worldBible.world_rules).slice(0, 5);
  const chars  = Object.assign({}, ...bases.map(b => b.worldBible.character_defaults));
  const rels   = bases.flatMap(b => b.worldBible.fixed_relationships).slice(0, 4);
  const forbid = bases.flatMap(b => b.worldBible.forbidden_settings).slice(0, 4);
  const terms  = [...new Set(bases.flatMap(b => b.worldBible.specific_terms ?? []))];
  const characters = [...new Set(bases.flatMap(b => b.characters))].slice(0, 6);

  // v2: 수치 설정 평균
  const cfgs = bases.map(b => b.worldBible.story_config);
  const avgField = (f) => Math.round(mean(cfgs.map(c => c[f])));
  const cfg = {
    pov: "3인칭 관찰자",
    style: keys.map(k => BASE_WORLDS[k].worldBible.story_config.style).join("·"),
    episodeLength:    avgField("episodeLength"),
    episodeLengthVar: avgField("episodeLengthVar"),
    totalEpisodes:    TOTAL_EPISODES,
    totalEpisodesVar: 0,
    conflict:   avgField("conflict"),
    foreshadow: avgField("foreshadow"),
    emotion:    avgField("emotion"),
    dialogue:   avgField("dialogue"),
    direction:  avgField("direction"),
  };

  return {
    label,
    worldBible: {
      world_rules: rules, character_defaults: chars,
      fixed_relationships: rels, forbidden_settings: forbid,
      specific_terms: terms, story_config: cfg,
    },
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

// ── 채점 함수들 ───────────────────────────────────────────────

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

// v2: 고유명사(복합 명사구) 우선 + 희귀 단일어 보조
const STOP_WORDS = /^(은|는|이|가|을|를|의|에|서|도|만|과|와|하며|하고|있으며|있다|된다|한다|않|금지|위반|허용|수|것|때|시|위해|인해|경우|이상|이하|중|간|전|후|모든|이들|그들|대한|대해|통해|자동|의무|실질|반드시|처한다)$/;
const stripParticle = w => w.replace(/[은는이가을를의에서도만과와로으로까지에서부터이라고하며하고있으며있다된다한다]+$/, "");

function extractSpecificTerms(rule) {
  const cleaned = rule.replace(/\(.*?\)/g, " ").replace(/[·,，。.!?'"""—]/g, " ");
  const tokens  = cleaned.split(/\s+/).map(stripParticle).filter(w => w.length >= 2 && !STOP_WORDS.test(w));
  // 복합어(연속 2어절) 우선
  const compound = [];
  for (let i = 0; i < tokens.length - 1; i++) compound.push(`${tokens[i]} ${tokens[i+1]}`);
  return { single: [...new Set(tokens)], compound: [...new Set(compound)] };
}

function scoreWorldRules(text, world) {
  const explicit = world.worldBible.specific_terms ?? [];
  let hitRules = 0;

  for (const rule of world.worldBible.world_rules) {
    const { single, compound } = extractSpecificTerms(rule);
    // 1) 미리 태깅된 고유명사가 본문에 있으면 강력 매치
    const explicitHit = explicit.some(t => rule.includes(t) && text.includes(t));
    // 2) 복합어(2어절) 매치도 강력 매치
    const compoundHit = compound.some(c => text.includes(c));
    // 3) 단일어 2개 이상 동시 등장도 인정
    const singleHits  = single.filter(s => text.includes(s)).length;

    if (explicitHit || compoundHit || singleHits >= 2) hitRules++;
  }

  const ratio = hitRules / Math.max(world.worldBible.world_rules.length, 1);
  return { score: Math.round(ratio * 8), hitRules };
}

function scoreForbiddenWorld(text, world) {
  const HARD = [/총기|권총|소총/, /인터넷|스마트폰|전기|컴퓨터/];
  // MURIM 세계관만 현대기술 금지 강제 — 다른 세계관에는 미적용
  const isMurimOnly = world.label === "동양 무협";
  if (isMurimOnly) {
    const hits = HARD.filter(p => p.test(text)).length;
    if (hits > 0) return { score: Math.max(0, 6 - hits * 3) };
  }

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

// v2: 어절 3-gram/4-gram + 문자 5-gram 기반 반복 감지
function scoreRepetition(text) {
  const norm  = text.replace(/\s+/g, " ").trim();
  const words = norm.split(" ").filter(Boolean);

  const countFreq = (arr) => {
    const f = {};
    for (const x of arr) f[x] = (f[x] ?? 0) + 1;
    return f;
  };

  const ngrams = (arr, n) => {
    const out = [];
    for (let i = 0; i <= arr.length - n; i++) out.push(arr.slice(i, i + n).join(" "));
    return out;
  };

  const f3 = countFreq(ngrams(words, 3));
  const f4 = countFreq(ngrams(words, 4));
  const rep3 = Object.values(f3).filter(v => v >= 3).length; // 3-gram이 3회+
  const rep4 = Object.values(f4).filter(v => v >= 2).length; // 4-gram이 2회+

  // 문자 5-gram (공백/구두점 제거)
  const chars = norm.replace(/[\s,\.。!?'"""—]/g, "");
  const c5 = [];
  for (let i = 0; i <= chars.length - 5; i++) c5.push(chars.slice(i, i + 5));
  const fc5 = countFreq(c5);
  const repC = Object.values(fc5).filter(v => v >= 4).length;

  const penalty = rep3 * 1.5 + rep4 * 2 + repC * 0.4;
  return {
    score: Math.max(0, Math.round(10 - penalty)),
    rep3, rep4, repC,
    topRep: Object.entries(f3).filter(([,v]) => v >= 3).sort((a,b) => b[1]-a[1]).slice(0, 3).map(([k,v]) => `"${k}"×${v}`),
  };
}

function scoreEmotionRhythm(text) {
  const EMOTION_KWS = ["두려움", "분노", "슬픔", "기쁨", "불안", "절망", "희망", "떨렸", "멈췄", "울었", "웃었", "다가왔", "물러섰", "숨을 삼켰", "심장이"];
  const hits = EMOTION_KWS.filter(k => text.includes(k)).length;
  return { score: Math.min(5, hits) };
}

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

// ── LLM Judge (v2: binary rubric + 중앙값) ────────────────

const INTER_EP_RUBRIC = `당신은 소설 화간 연속성 평가자다. 두 화를 읽고 아래 4개 질문에 각각 yes 또는 no로만 답한다.
반드시 아래 형식으로만 출력:
Q1: yes/no
Q2: yes/no
Q3: yes/no
Q4: yes/no

평가 항목:
Q1: 인물의 위치·상태가 자연스럽게 이어지는가?
Q2: 직전 화의 미해결 상황이 다음 화에서 이어지거나 언급되는가?
Q3: 인물 감정·관계가 연속되는가?
Q4: 시간 흐름이 논리적인가?`;

const INTRA_EP_RUBRIC = `당신은 소설 단일화 결속성 평가자다. 한 화를 읽고 아래 4개 질문에 각각 yes 또는 no로만 답한다.
반드시 아래 형식으로만 출력:
Q1: yes/no
Q2: yes/no
Q3: yes/no
Q4: yes/no

평가 항목:
Q1: 문단 간 주제가 일관되는가?
Q2: 장면 전환이 자연스러운가?
Q3: 이번 화의 시작과 끝이 하나의 사건으로 연결되는가?
Q4: 중복·군더더기 없이 집중된 전개인가?`;

function parseRubricYesRatio(text) {
  const matches = [...text.toLowerCase().matchAll(/q\d+\s*[::]\s*(yes|no|예|아니오|네|아니요)/g)];
  if (matches.length === 0) return 0.5;
  let yes = 0;
  for (const m of matches) if (/yes|예|네/.test(m[1])) yes++;
  return yes / matches.length; // 0..1
}

async function llmRubricCall(systemPrompt, userContent, temperature) {
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
        temperature,
        max_tokens: 80,
      }),
    });
    const data = await resp.json();
    const raw  = data.choices?.[0]?.message?.content ?? "";
    return parseRubricYesRatio(raw);
  } catch {
    return 0.5;
  }
}

async function llmRubricMedian(systemPrompt, userContent, samples = 3) {
  const ratios = [];
  for (let i = 0; i < samples; i++) {
    ratios.push(await llmRubricCall(systemPrompt, userContent, 0.1 + i * 0.08));
    await sleep(250);
  }
  return median(ratios); // 0..1
}

async function scoreInterEpisodeContinuity(bookId, totalEps) {
  if (totalEps < 2) return { score: 15, samples: [], avg: "15.0" };
  const pairs = [
    [1, 2],
    [Math.floor(totalEps * 0.45), Math.floor(totalEps * 0.45) + 1],
    [totalEps - 2, totalEps - 1],
  ].filter(([a, b]) => a >= 1 && b <= totalEps && a !== b);

  const ratios = [];
  for (const [a, b] of pairs) {
    const rows = await pool.query(
      `SELECT episode_number, content FROM episodes WHERE book_id=$1 AND episode_number IN ($2,$3) ORDER BY episode_number`,
      [bookId, a, b]
    );
    if (rows.rows.length < 2) { ratios.push(0.5); continue; }
    const [epA, epB] = rows.rows;
    const snippet = (s) => s.slice(0, 400);
    const userContent = `[${a}화 끝부분]\n${snippet(epA.content)}\n\n[${b}화 시작부분]\n${snippet(epB.content)}`;
    ratios.push(await llmRubricMedian(INTER_EP_RUBRIC, userContent, 3));
  }
  const avgRatio = mean(ratios);
  return { score: Math.round(avgRatio * 15), samples: ratios.map(r => (r * 10).toFixed(1)), avg: (avgRatio * 10).toFixed(1) };
}

async function scoreIntraEpisodeCohesion(bookId, totalEps) {
  const eps = [
    Math.max(1, Math.floor(totalEps * 0.15)),
    Math.floor(totalEps * 0.5),
    Math.min(totalEps - 1, Math.floor(totalEps * 0.85)),
  ];
  const ratios = [];
  for (const ep of eps) {
    const row = await pool.query(`SELECT content FROM episodes WHERE book_id=$1 AND episode_number=$2`, [bookId, ep]);
    const content = row.rows[0]?.content ?? "";
    if (!content) { ratios.push(0.5); continue; }
    ratios.push(await llmRubricMedian(INTRA_EP_RUBRIC, `[${ep}화]\n${content.slice(0, 600)}`, 3));
  }
  const avgRatio = mean(ratios);
  return { score: Math.round(avgRatio * 10), samples: ratios.map(r => (r * 10).toFixed(1)), avg: (avgRatio * 10).toFixed(1) };
}

// ── 에피소드 생성/저장 ───────────────────────────────────────
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

// ── 단일 세계관 실행 (v2: abort 지원) ───────────────────────
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
    if (!content || content.length < 100) {
      log(`  ❌ ${ep}화 생성 실패(${content.length}자) — 세계관 abort`);
      await redis.del(`context:${bookId}`, `foreshadow_open:${bookId}`, `overrides:${bookId}`);
      return null;
    }

    await saveEpisode(bookId, ep, content);
    await sleep(800);

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
    const repStr = rep.topRep.length ? ` 반복:${rep.topRep.join(",")}` : "";
    log(`  ${String(ep).padStart(2)}화: ${structScore}/55 | POV${pov.score} 인물${chars.score} 규칙${rules.score} 분량${length.score} 아크${arc.score} 반복${rep.score} 감정${emot.score}${dirStr} | ${content.length}자${repStr}`);

    if (ep % ARC_SIZE === 0) {
      const slice = perEpScores.slice(ep - ARC_SIZE, ep);
      const avg   = Math.round(mean(slice.map(s => s.structScore)));
      log(`  ══ Arc ${ep / ARC_SIZE} 평균: ${avg}/57 ══`);
      await sleep(1000);
    }
  }

  // 복선 점수
  await sleep(3000);
  const fRows = await pool.query(`SELECT planted_episode, status FROM foreshadows WHERE book_id=$1`, [bookId]);
  const allF  = fRows.rows;
  const scorableF = allF.filter(f => f.planted_episode < TOTAL_EPISODES);
  const resolvedF = scorableF.filter(f => f.status === "resolved");
  const recallRate      = scorableF.length ? Math.round((resolvedF.length / scorableF.length) * 100) : 0;
  const foreshadowScore = Math.round((recallRate / 100) * 10);
  const longTermF = scorableF.filter(f => f.planted_episode <= TOTAL_EPISODES - 6);
  const ltRate    = longTermF.length ? Math.round((longTermF.filter(f => f.status === "resolved").length / longTermF.length) * 100) : 100;
  const longTermScore = Math.round((ltRate / 100) * 5);

  // LLM 품질 평가
  log(`  [품질평가] 화간 연속성...`);
  const inter = await scoreInterEpisodeContinuity(bookId, TOTAL_EPISODES);
  log(`  [품질평가] 화내 결속성...`);
  const intra = await scoreIntraEpisodeCohesion(bookId, TOTAL_EPISODES);

  const dirScores = perEpScores.filter(s => s.dir !== null).map(s => s.dir.score);
  const dirAvg    = dirScores.length ? Math.round(mean(dirScores)) : 0;

  const finaleRow = await pool.query(`SELECT content FROM episodes WHERE book_id=$1 AND episode_number=$2`, [bookId, TOTAL_EPISODES]);
  const finale    = scoreFinale(finaleRow.rows[0]?.content ?? "");

  // 구조 정규화: /57 → /50 (POV 8 + 인물 8 + 규칙 8 + 금지 6 + 분량 5 + 아크 5 + 반복 10 + 감정 5 + 일부 Dir = max ~57)
  // 실제 상한을 정확히 반영: pov(8)+chars(8)+rules(8)+forbid(6)+length(5)+arc(5)+rep(10)+emot(5) = 55
  const STRUCT_MAX = 55;
  const structAvg  = mean(perEpScores.map(s => s.structScore));
  const structNorm = Math.round((structAvg / STRUCT_MAX) * 50);

  const avgRep  = mean(perEpScores.map(s => s.rep));
  const avgEmot = mean(perEpScores.map(s => s.emot));

  const totalScore = structNorm + foreshadowScore + longTermScore + inter.score + intra.score + dirAvg + finale.score;

  log(`\n  [${worldDef.label}] 최종: ${totalScore}/100`);
  log(`  구조${structNorm}/50 | 복선${foreshadowScore}/10 장기${longTermScore}/5 | 화간${inter.score}/15(${inter.avg}) 화내${intra.score}/10(${intra.avg}) | Dir${dirAvg}/5 결말${finale.score}/5`);
  log(`  복선 총${allF.length}/스코어${scorableF.length}/회수${recallRate}%/장기${ltRate}% | 반복평균${avgRep.toFixed(1)} 감정평균${avgEmot.toFixed(1)}`);

  await redis.del(`context:${bookId}`, `foreshadow_open:${bookId}`, `overrides:${bookId}`);

  return {
    worldKey, label: worldDef.label, round, book_id: bookId,
    scores: {
      struct_norm: structNorm, foreshadow: foreshadowScore, longterm: longTermScore,
      inter_ep: inter.score, intra_ep: intra.score, director: dirAvg, finale: finale.score,
      grand_total: totalScore,
    },
    details: {
      inter_avg:  parseFloat(inter.avg),
      intra_avg:  parseFloat(intra.avg),
      recall_rate: recallRate,
      avg_rep:    round2(avgRep),
      avg_emot:   round2(avgEmot),
    },
  };
}

// ── v2: 튜닝 로직 — 한 번에 하나, 이동평균, 분산 게이트, 롤백 ──
function analyzeAndTune(allRoundResults, state) {
  const latest = allRoundResults[allRoundResults.length - 1];
  const latestScores = latest.results.map(r => r.total);

  // 이동 평균 집합 (최근 N라운드)
  const window = allRoundResults.slice(-MOVING_AVG_WINDOW);
  const windowResults = window.flatMap(rr => rr.results);
  const avgTotal  = mean(windowResults.map(r => r.total));
  const avgInter  = mean(windowResults.map(r => r.inter));
  const avgIntra  = mean(windowResults.map(r => r.intra));
  const avgRecall = mean(windowResults.map(r => r.recall));
  const avgRep    = mean(windowResults.map(r => r.avg_rep));

  const latestStd = stdev(latestScores);
  const summary = { avgTotal, avgInter, avgIntra, avgRecall, avgRep, latestStd };

  // 게이트 1: 최근 라운드 분산이 너무 크면 튜닝 유보
  if (latestStd > VARIANCE_SKIP_THRESH) {
    return { changed: false, skipped: `variance σ=${latestStd.toFixed(1)} > ${VARIANCE_SKIP_THRESH}`, ...summary };
  }

  // 게이트 2: 직전 변경이 점수 나빠뜨렸으면 롤백 (rollback 직후 또다시 rollback하지 않게 플래그 관리)
  if (state.last_change && !state.last_change.was_rollback && allRoundResults.length >= 2) {
    const prev = allRoundResults[allRoundResults.length - 2];
    const prevAvg = mean(prev.results.map(r => r.total));
    const curAvg  = mean(latest.results.map(r => r.total));
    const prevStd = stdev(prev.results.map(r => r.total));
    // 드랍 임계: max(σ*0.6, 2점)
    const dropThresh = Math.max(prevStd * 0.6, 2);

    if (prevAvg - curAvg > dropThresh) {
      Object.assign(MODEL_PARAMS, state.last_change.params_before);
      state.last_change = { ...state.last_change, was_rollback: true };
      return {
        changed: true,
        rollback: true,
        reasons: [`롤백 ${state.last_change.reason} (${prevAvg.toFixed(1)}→${curAvg.toFixed(1)}, Δ${(prevAvg-curAvg).toFixed(1)} > 임계 ${dropThresh.toFixed(1)})`],
        ...summary,
      };
    }
  }

  // 가장 약한 지표 하나만 변경
  const weaknesses = [
    { name: "화간연속", norm: avgInter / 15,  target: 0.65, param: "temperature",    dir: -PARAM_BOUNDS.temperature.step },
    { name: "화내결속", norm: avgIntra / 10,  target: 0.65, param: "top_p",          dir: -PARAM_BOUNDS.top_p.step },
    { name: "복선회수", norm: avgRecall / 100, target: 0.50, param: "temperature",   dir: +PARAM_BOUNDS.temperature.step },
    { name: "반복억제", norm: avgRep / 10,    target: 0.75, param: "repeat_penalty", dir: +PARAM_BOUNDS.repeat_penalty.step },
  ].filter(w => w.norm < w.target)
   .sort((a, b) => (a.norm - a.target) - (b.norm - b.target)); // 목표와 격차 큰 순

  // 모든 지표 양호: 고득점이면 다양성 시도, 아니면 유지
  if (weaknesses.length === 0) {
    if (avgTotal >= 82 && MODEL_PARAMS.temperature < PARAM_BOUNDS.temperature.max) {
      const before = { ...MODEL_PARAMS };
      MODEL_PARAMS.temperature = clamp(MODEL_PARAMS.temperature + PARAM_BOUNDS.temperature.step,
        PARAM_BOUNDS.temperature.min, PARAM_BOUNDS.temperature.max);
      if (MODEL_PARAMS.temperature !== before.temperature) {
        state.last_change = { params_before: before, reason: "다양성↑", was_rollback: false };
        return { changed: true, reasons: [`고득점(${avgTotal.toFixed(0)}) → temperature↑ ${round2(MODEL_PARAMS.temperature)}`], ...summary };
      }
    }
    return { changed: false, skipped: "all_metrics_ok", ...summary };
  }

  const worst  = weaknesses[0];
  const before = { ...MODEL_PARAMS };
  const bnds   = PARAM_BOUNDS[worst.param];
  MODEL_PARAMS[worst.param] = clamp(MODEL_PARAMS[worst.param] + worst.dir, bnds.min, bnds.max);

  if (MODEL_PARAMS[worst.param] === before[worst.param]) {
    return { changed: false, skipped: `${worst.param} at boundary`, ...summary };
  }

  state.last_change = { params_before: before, reason: worst.name, was_rollback: false };
  return {
    changed: true,
    reasons: [`${worst.name} ${(worst.norm*100).toFixed(0)}%<${(worst.target*100).toFixed(0)}% → ${worst.param}${worst.dir>0?"↑":"↓"} ${round3(MODEL_PARAMS[worst.param])}`],
    ...summary,
  };
}

// ── 조기 종료 판정 ────────────────────────────────────────────
function shouldEarlyStop(allRoundResults, round) {
  if (round < EARLY_STOP_MIN_ROUND) return false;
  if (allRoundResults.length < 3) return false;
  const recent3 = allRoundResults.slice(-3).map(rr => mean(rr.results.map(r => r.total)));
  const improvement = recent3[2] - recent3[0];
  const sigma = stdev(recent3);
  if (Math.abs(improvement) < EARLY_STOP_IMPROVEMENT && sigma < EARLY_STOP_STD) {
    log(`[조기종료] 최근 3R 평균: [${recent3.map(n => n.toFixed(1)).join(", ")}] Δ=${improvement.toFixed(2)} σ=${sigma.toFixed(2)} — 수렴 판단`);
    return true;
  }
  return false;
}

// ── 메인 루프 ────────────────────────────────────────────────
async function main() {
  const state = loadTuneState();
  const startRound = state.round + 1;

  log(`\n${"═".repeat(60)}`);
  log(` mega_tune v2 — 최대 ${TUNE_ROUNDS}R × 7세계관 × ${TOTAL_EPISODES}화`);
  log(` 시작: R${startRound} | 탐색단계: R1~R${EXPLORATION_ROUNDS} | 수렴단계: R${EXPLORATION_ROUNDS+1}+`);
  log(` 현재: temp=${MODEL_PARAMS.temperature} rep=${MODEL_PARAMS.repeat_penalty} top_p=${MODEL_PARAMS.top_p}`);
  log(`${"═".repeat(60)}`);

  const worldKeys = Object.keys(WORLDS);
  const allRoundResults = state.history ?? [];

  outerLoop:
  for (let round = startRound; round <= TUNE_ROUNDS; round++) {
    const roundStart = Date.now();
    log(`\n${"█".repeat(60)}`);
    log(` ROUND ${round} / ${TUNE_ROUNDS} ${round <= EXPLORATION_ROUNDS ? "[탐색]" : "[수렴]"}`);
    log(`${"█".repeat(60)}`);

    // ── 라운드 시작 시 파라미터 결정 ────────────────────
    if (round <= EXPLORATION_ROUNDS) {
      // 탐색 단계: 그리드에서 파라미터 가져오기
      Object.assign(MODEL_PARAMS, EXPLORATION_GRID[round - 1]);
      if (!rebuildModel(`탐색 R${round} grid[${round-1}]`)) {
        log(`[Abort] 모델 빌드 실패 — 라운드 중단`);
        break;
      }
    } else if (round === EXPLORATION_ROUNDS + 1) {
      // 수렴 단계 진입: 탐색 단계 최고 성적 파라미터 복원
      const expHistory = allRoundResults.filter(h => h.round <= EXPLORATION_ROUNDS);
      if (expHistory.length > 0) {
        const best = [...expHistory].sort((a, b) => mean(b.results.map(r => r.total)) - mean(a.results.map(r => r.total)))[0];
        Object.assign(MODEL_PARAMS, best.params_after);
        const bestAvg = mean(best.results.map(r => r.total));
        log(`[수렴 시작] R${best.round}가 최고 (avg ${bestAvg.toFixed(1)}) — 해당 파라미터 복원`);
        if (!rebuildModel(`수렴 시작: R${best.round} 복원`)) {
          log(`[Abort] 모델 빌드 실패`);
          break;
        }
      }
      // last_change 리셋 (새 단계)
      state.last_change = null;
    } else {
      // 수렴 단계 R+2 이상: 직전 라운드 결과 기반 튜닝
      const tuneResult = analyzeAndTune(allRoundResults, state);
      if (tuneResult.changed) {
        const paramsBefore = { ...MODEL_PARAMS };
        log(`\n  [Tune] ${tuneResult.reasons.join("; ")}`);
        if (!rebuildModel(tuneResult.reasons.join("; "))) {
          // 빌드 실패 → 파라미터 원복
          Object.assign(MODEL_PARAMS, tuneResult.rollback ? paramsBefore : state.last_change.params_before);
          log(`  [Tune] 파라미터 롤백됨`);
          state.last_change = null;
        }
      } else {
        log(`\n  [Tune] 변경 없음 (${tuneResult.skipped ?? "no-op"}) — 현재 파라미터 유지`);
      }
    }

    // ── 7개 세계관 실행 (세계관별 partial checkpoint) ────
    const roundResults = [];
    for (const worldKey of worldKeys) {
      try {
        const result = await runWorldTest(worldKey, WORLDS[worldKey], round);
        if (result) {
          roundResults.push(result);
          // partial 저장 (중단 복구용)
          saveTuneState({
            round: round - 1, // 완료된 최신 라운드는 startRound-1
            history: allRoundResults,
            last_change: state.last_change,
            partial: { round, completed_worlds: roundResults.map(r => r.worldKey) },
          });
        } else {
          log(`[Skip] ${worldKey} abort됨 — 라운드에 제외`);
        }
        await sleep(2000);
      } catch (err) {
        log(`[오류] ${worldKey} R${round}: ${err.message}`);
      }
    }

    if (roundResults.length === 0) {
      log(`[Abort] R${round} 전체 세계관 실패 — 루프 중단`);
      break;
    }

    // ── 라운드 요약 ────────────────────────────────────
    const elapsed = Math.round((Date.now() - roundStart) / 60000);
    log(`\n${"═".repeat(60)}`);
    log(` ROUND ${round} 결과 요약 (${elapsed}분, ${roundResults.length}/${worldKeys.length}개 완료)`);
    log(`${"═".repeat(60)}`);
    log(`  세계관              합계  구조 복선 화간 화내 Dir 결`);
    log(`  ${"─".repeat(58)}`);
    for (const r of roundResults) {
      const s = r.scores;
      log(`  ${r.label.padEnd(18)} ${String(s.grand_total).padStart(3)}/100  ${String(s.struct_norm).padStart(2)}/50  ${String(s.foreshadow+s.longterm).padStart(2)}/15  ${String(s.inter_ep).padStart(2)}/15  ${String(s.intra_ep).padStart(2)}/10  ${String(s.director).padStart(1)}/5  ${String(s.finale).padStart(1)}/5`);
    }

    // ── 이번 라운드 객체 생성 (다음 분석의 입력) ─────────
    const roundObj = {
      round,
      phase: round <= EXPLORATION_ROUNDS ? "exploration" : "exploitation",
      results: roundResults.map(r => ({
        world: r.worldKey,
        total: r.scores.grand_total,
        inter: r.scores.inter_ep,
        intra: r.scores.intra_ep,
        recall: r.details.recall_rate,
        avg_rep: r.details.avg_rep,
      })),
      params_after: { ...MODEL_PARAMS },
    };
    const roundAvg = mean(roundObj.results.map(r => r.total));
    const roundStd = stdev(roundObj.results.map(r => r.total));
    log(`\n  라운드 평균: ${roundAvg.toFixed(1)}/100 (σ=${roundStd.toFixed(1)})`);
    roundObj.round_avg = round2(roundAvg);
    roundObj.round_std = round2(roundStd);

    allRoundResults.push(roundObj);

    // 상태 저장 (정식 라운드 완료)
    saveTuneState({ round, history: allRoundResults, last_change: state.last_change, partial: null });

    // 리포트 파일
    const reportPath = `logs/mega_tune_r${round}_${Date.now()}.json`;
    writeFileSync(reportPath, JSON.stringify({ round, phase: roundObj.phase, roundResults, model_params: MODEL_PARAMS }, null, 2));
    log(`  리포트: ${reportPath}`);

    // ── 조기 종료 체크 ──────────────────────────────────
    if (shouldEarlyStop(allRoundResults, round)) {
      log(`  ─── 조기 종료 ───`);
      break outerLoop;
    }

    if (round < TUNE_ROUNDS) {
      log(`\n  다음 라운드까지 5초 대기...`);
      await sleep(5000);
    }
  }

  // ── 전체 요약 ───────────────────────────────────────
  log(`\n${"█".repeat(60)}`);
  log(` 튜닝 완료 — 총 ${allRoundResults.length}라운드 실행`);
  log(`${"█".repeat(60)}`);
  log(`\n 라운드별 성적:`);
  for (const rr of allRoundResults) {
    const avg = mean(rr.results.map(r => r.total));
    log(`  [${rr.phase.padEnd(12)}] R${rr.round}: ${avg.toFixed(1)}/100 (σ=${rr.round_std}) | temp=${rr.params_after.temperature} rep=${rr.params_after.repeat_penalty} top_p=${rr.params_after.top_p}`);
  }

  // 베스트 파라미터
  const best = [...allRoundResults].sort((a, b) => mean(b.results.map(r => r.total)) - mean(a.results.map(r => r.total)))[0];
  if (best) {
    const bestAvg = mean(best.results.map(r => r.total));
    log(`\n  ★ 최고 성적: R${best.round} (${bestAvg.toFixed(1)}/100)`);
    log(`    temp=${best.params_after.temperature} rep=${best.params_after.repeat_penalty} top_p=${best.params_after.top_p} min_p=${best.params_after.min_p}`);
  }

  await pool.end();
  await redis.quit();
  process.exit(0);
}

main().catch(e => { log(`[FATAL] ${e.message}\n${e.stack}`); process.exit(1); });
