/**
 * setup_longrun_v5.mjs — Phase 2~4 통합 검증용 30화 테스트북 셋업
 *
 * 세계관: 시간 왜곡 미스터리 / 다크 판타지
 * book_id: test_longrun_v5
 * 제목: 균열의 증인들
 *
 * 핵심 설계 의도:
 * - alias registry: 4명 canonical + 묘사형 존재 1개(비DB)
 * - language guard: 감정/목표/위치 상태 한국어 고정
 * - item ledger: 인물별 소지품 정체성 유지, condition 변화 가능
 * - episode delta: 시간 왜곡 반복 상황에서도 선택과 관계 변화
 * - rolling summary + arc + foreshadow: 30화 장기 구조
 * - 복선 4개 심기, 최종화 회수 설계
 */

import pg from "pg";
import IORedis from "ioredis";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

const BOOK_ID = "test_longrun_v5";
const USER_ID = "efd847a1-79c7-47c5-a020-da37875efb0f";

const worldContext = {
  world_rules: [
    "폐쇄된 지하 연구소 '창문 없는 방'. 외부와의 연결은 차단되어 있다.",
    "이 연구소에는 '시간 균열' 현상이 존재한다 — 특정 조건에서 같은 날이 반복되는 것처럼 느껴지지만, 인물들의 선택과 관계는 매 반복마다 달라진다.",
    "인물들은 자신이 균열 속에 있다는 것을 점점 깨달아 가지만, 탈출 방법은 알지 못한다.",
    "소지품은 균열을 넘어서도 유지된다. 물건은 파손·소진될 수 있지만 이름 자체는 변하지 않는다.",
    "인물에게 초능력·스킬·능력치를 부여하는 것은 금지. 인물은 지식, 신뢰, 선택으로만 행동한다.",
    "묘사형 존재 '그것'은 연구소 깊은 곳에서 감지된다. canonical 인물이 아니며 이름도 없다. DB에 저장하지 않는다.",
    "복선 1: 연구소 설계 도면의 '봉인 구역'은 이후 탈출 경로와 연결된다.",
    "복선 2: 수진의 일지에 적힌 날짜 불일치는 균열의 규칙을 암시한다.",
    "복선 3: 이민이 처음 만날 때부터 주인공을 알아보는 듯한 반응은 나중에 설명된다.",
    "복선 4: 연구소 에너지원 '코어'는 균열을 강화하기도, 끊기도 한다.",
  ],
  character_defaults: {
    "한서진": {
      type: "인간",
      gender: "남성",
      description: "전직 구조대원, 34세. 연구소 사고 조사를 위해 파견됐다가 갇혔다.",
      personality: "침착하고 신뢰를 중시한다. 포기하지 않지만 무모하지 않다. 동료를 먼저 챙긴다.",
      initial_items: [
        { name: "구조대 무전기", description: "배터리가 거의 방전된 상태지만 내부 통신은 가능하다.", grade: "B" },
        { name: "방수 손전등", description: "충격에 강한 구조용 손전등. 교체 배터리 없음.", grade: "B" },
        { name: "구급 파우치", description: "붕대, 지혈제, 진통제가 들어있는 작은 응급 키트.", grade: "C" },
      ],
    },
    "이수진": {
      type: "인간",
      gender: "여성",
      description: "연구소 소속 기록 연구원, 29세. 균열 현상을 처음 문서화한 사람이다.",
      personality: "관찰력이 뛰어나고 기록을 신뢰한다. 감정을 잘 드러내지 않지만 내면은 불안하다.",
      initial_items: [
        { name: "연구 일지", description: "균열 현상 관찰 기록이 빼곡히 적힌 낡은 노트. 날짜가 군데군데 지워져 있다.", grade: "A" },
        { name: "연구소 ID 카드", description: "일부 구역의 잠금장치를 열 수 있다. 봉인 구역은 불가.", grade: "B" },
      ],
    },
    "박이민": {
      type: "인간",
      gender: "남성",
      description: "연구소 시설 관리팀, 41세. 연구소의 구조와 코어 시스템을 가장 잘 안다.",
      personality: "과묵하고 관찰한다. 처음부터 서진을 알아보는 듯한 태도가 이상하다.",
      initial_items: [
        { name: "시설 마스터키", description: "연구소 대부분의 문을 열 수 있다. 봉인 구역 포함.", grade: "A" },
        { name: "공구 가방", description: "렌치, 절단기, 납땜 장비가 든 천 가방. 무겁다.", grade: "C" },
      ],
    },
    "최나래": {
      type: "인간",
      gender: "여성",
      description: "연구소 의료팀, 26세. 사고 이후 부상자를 치료하다가 함께 갇혔다.",
      personality: "직설적이고 솔직하다. 두려움을 인정하고 그럼에도 움직인다.",
      initial_items: [
        { name: "의료 가방", description: "수술 도구, 항생제, 소독약이 든 의료용 가방. 물자가 점점 줄고 있다.", grade: "A" },
        { name: "청진기", description: "나래의 상징 같은 물건. 아버지에게 받은 것.", grade: "B" },
      ],
    },
  },
  forbidden_settings: [
    "인물에게 스킬, 능력치, 초능력을 부여하는 것",
    "묘사형 존재 '그것'을 canonical 인물로 등록하는 것",
    "소지품 이름을 이야기 중에 바꾸는 것",
    "설명 없이 소지품이 사라지는 것",
    "같은 날 같은 사건을 반복할 때 인물의 선택과 관계가 변하지 않는 것",
  ],
  story_config: {
    totalEpisodes: 30,
    pov: "3인칭 관찰자",
    style: "묘사풍부",
    episodeLength: 1000,
    episodeLengthVar: 200,
    conflict: 8,
    foreshadow: 8,
    emotion: 8,
    dialogue: 7,
    direction: 9,
  },
};

async function setup() {
  try {
    const tables = [
      "character_dynamic_states",
      "canonical_characters",
      "episodes",
      "episode_snapshots",
      "character_arcs",
      "foreshadows",
      "world_configs",
      "world_rules",
      "books",
    ];
    for (const table of tables) {
      await pool.query(
        `DELETE FROM ${table} WHERE ${table === "books" ? "id" : "book_id"}=$1`,
        [BOOK_ID]
      );
    }

    await pool.query(
      "INSERT INTO books (id, user_id, title) VALUES ($1, $2, $3)",
      [BOOK_ID, USER_ID, "균열의 증인들"]
    );

    await pool.query(
      `INSERT INTO world_configs (book_id, background, genre, mood, theme, common_tone)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        BOOK_ID,
        "외부와 단절된 지하 연구소. 시간 균열이 반복되고, 인물들은 탈출을 위해 서로를 믿거나 배반한다.",
        "다크 판타지 / 미스터리",
        "긴장, 불신, 두려움, 희망의 균열",
        "반복되는 상황 속에서 선택이 관계를 바꾸고, 관계가 탈출을 가능하게 한다",
        "억제된 감정, 긴장감 있는 대화, 군더더기 없는 묘사",
      ]
    );

    for (const rule of worldContext.world_rules) {
      await pool.query(
        "INSERT INTO world_rules (book_id, rule_type, content, is_active) VALUES ($1,'general',$2,true)",
        [BOOK_ID, rule]
      );
    }

    for (const [name, ch] of Object.entries(worldContext.character_defaults)) {
      await pool.query(
        `INSERT INTO canonical_characters (book_id, name, personality, type, gender, initial_items)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [BOOK_ID, name, ch.personality, ch.type, ch.gender, JSON.stringify(ch.initial_items)]
      );
    }

    await redis.set(`context:${BOOK_ID}`, JSON.stringify(worldContext));

    console.log(`✅  테스트북 생성 완료`);
    console.log(`   book_id: ${BOOK_ID}`);
    console.log(`   title:   균열의 증인들`);
    console.log(`   genre:   다크 판타지 / 미스터리`);
    console.log(`   canonical: ${Object.keys(worldContext.character_defaults).join(", ")}`);
    console.log(`   총화수: 30화`);
    console.log(``);
    console.log(`초기 소지품:`);
    for (const [name, ch] of Object.entries(worldContext.character_defaults)) {
      console.log(`   ${name}: ${ch.initial_items.map(i => i.name).join(", ")}`);
    }
    console.log(``);
    console.log(`복선:`);
    const foreshadows = worldContext.world_rules.filter(r => r.startsWith("복선"));
    foreshadows.forEach(f => console.log(`   ${f}`));
    console.log(``);
    console.log(`생성 명령:`);
    console.log(`   node scripts/run_longrun_v5.mjs`);
    console.log(`   node scripts/run_longrun_v5.mjs --episodes 10`);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  } finally {
    redis.disconnect();
    await pool.end();
  }
}

setup();
