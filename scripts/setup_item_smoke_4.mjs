/**
 * setup_item_smoke_4.mjs — Phase 4 Item Ledger smoke 테스트북 셋업
 *
 * initial_items에 고성능 손전등, S20, 가방을 설정.
 * 방전·파손·스킬 등장 가능한 현대 도심 스릴러 세계관.
 */

import pg from "pg";
import IORedis from "ioredis";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

const BOOK_ID = "test_item_smoke_4";
const USER_ID = "efd847a1-79c7-47c5-a020-da37875efb0f";

const worldContext = {
  world_rules: [
    "현대 도심 배경. 낡은 아파트 단지와 지하 공사 현장이 주 무대.",
    "전기가 자주 끊기는 환경 — 손전등은 생존 필수품이지만 배터리가 방전될 수 있다.",
    "인물들은 각자 현실적인 소지품만 가질 수 있다. 스킬·능력·특성 부여 금지.",
    "물건은 이야기 진행 중 파손·분실·소진될 수 있다. 단, 이름 자체는 변하지 않는다.",
    "각 화는 직전 화의 결과에서 반드시 시작해야 하며, 소지품 상태는 유지된다.",
  ],
  character_defaults: {
    "민준": {
      type: "인간",
      gender: "남성",
      description: "전직 소방관, 38세. 폐건물 조사 전문가.",
      personality: "침착하고 실용적. 위기 상황에서 판단이 빠르다. 동료를 먼저 챙긴다.",
      initial_items: [
        { name: "고성능 손전등", description: "어두운 지하를 비추는 방수 LED 손전등. 배터리 잔량이 항상 문제다.", grade: "B" },
        { name: "가방", description: "구조 장비를 담는 검은 더플백. 어깨끈이 낡았다.", grade: "C" },
      ],
    },
    "수아": {
      type: "인간",
      gender: "여성",
      description: "탐사 저널리스트, 31세. 폐건물 실종 사건을 취재 중.",
      personality: "호기심이 강하고 끈질기다. 위험을 과소평가하는 경향이 있다.",
      initial_items: [
        { name: "S20", description: "오래된 갤럭시 스마트폰. 배터리 수명이 짧고 화면에 균열이 있다.", grade: "C" },
        { name: "소형 녹음기", description: "취재 전용 디지털 녹음기. 배터리 3시간 분량.", grade: "B" },
      ],
    },
    "준혁": {
      type: "인간",
      gender: "남성",
      description: "건물 관리인, 52세. 이 건물에서 20년째 일했다.",
      personality: "과묵하고 비밀이 많다. 건물에 무슨 일이 있는지 알고 있는 것 같다.",
      initial_items: [
        { name: "마스터 열쇠 묶음", description: "단지 전체 잠금장치를 열 수 있는 열쇠 묶음.", grade: "A" },
      ],
    },
  },
  forbidden_settings: [
    "인물에게 스킬·능력·특성을 부여하는 것",
    "item 이름을 이야기 중에 바꾸는 것",
    "소지품이 설명 없이 사라지는 것",
  ],
  story_config: {
    totalEpisodes: 15,
    pov: "3인칭 관찰자",
    style: "묘사풍부",
    episodeLength: 900,
    episodeLengthVar: 200,
    conflict: 7,
    foreshadow: 6,
    emotion: 7,
    dialogue: 7,
    direction: 8,
  },
};

async function setup() {
  try {
    // 기존 데이터 정리
    for (const table of ["character_dynamic_states","canonical_characters","episodes","episode_snapshots","character_arcs","foreshadows","world_configs","world_rules","books"]) {
      await pool.query(`DELETE FROM ${table} WHERE ${table === "books" ? "id" : "book_id"}=$1`, [BOOK_ID]);
    }

    await pool.query(
      "INSERT INTO books (id, user_id, title) VALUES ($1, $2, $3)",
      [BOOK_ID, USER_ID, "[4] 지하의 증언"]
    );

    await pool.query(
      `INSERT INTO world_configs (book_id, background, genre, mood, theme, common_tone)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [BOOK_ID,
        "현대 도심의 낡은 아파트 단지. 지하 공사 현장에서 연속 실종 사건이 발생한다.",
        "도시 스릴러",
        "긴장, 불안, 집착, 의혹",
        "숨겨진 진실을 찾아가는 사람들의 이야기",
        "절제된 묘사, 현실적 긴장감",
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
    console.log(`   title:   [4] 지하의 증언`);
    console.log(`   canonical: ${Object.keys(worldContext.character_defaults).join(", ")}`);
    console.log(`   initial_items: 고성능 손전등, 가방, S20, 소형 녹음기, 마스터 열쇠 묶음`);
    console.log(`\n생성 명령:`);
    console.log(`   node scripts/run_item_smoke_4.mjs`);
    console.log(`   node scripts/run_item_smoke_4.mjs --episodes 6`);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  } finally {
    redis.disconnect();
    await pool.end();
  }
}

setup();
