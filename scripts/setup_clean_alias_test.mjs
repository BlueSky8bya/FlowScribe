/**
 * setup_clean_alias_test.mjs — Phase 2C clean alias smoke test용 테스트북 셋업
 *
 * 묘사형 존재(아이, 그림자, 목소리 등)가 본문에 등장하기 쉬운 세계관.
 * 하지만 해당 존재들은 canonical 인물로 등록하지 않음.
 * Phase 2 entity resolver가 실제 생성 중 이들을 차단하는지 검증.
 */

import pg from "pg";
import IORedis from "ioredis";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

const BOOK_ID = "test_alias_smoke_2C";
const USER_ID = "efd847a1-79c7-47c5-a020-da37875efb0f";

// ── 세계관: 시간 왜곡 다크 판타지 ────────────────────────────
// 묘사형 존재(아이, 그림자, 목소리)가 자주 등장하는 설정이지만
// canonical 인물로는 등록하지 않음
const worldContext = {
  world_rules: [
    "시간의 균열이 열리면 과거의 환영이 나타난다",
    "그림자와 목소리는 실체가 없는 잔상이다 — 직접 상호작용 불가",
    "봉인된 고대 신전에는 접근 불가",
    "마법 사용 시 시간 왜곡이 심화된다",
    "주인공들은 서로의 기억을 공유할 수 없다",
  ],
  character_defaults: {
    "카엘": {
      type: "인간",
      gender: "남성",
      description: "시간 연구자, 30대, 냉철하고 집착적. 과거를 되돌리려 함.",
      personality: "냉철하고 분석적. 목적을 위해서라면 수단을 가리지 않는다. 과거에 잃은 것에 집착한다.",
      initial_items: ["시간 측정 장치", "낡은 연구 일지"],
    },
    "리아": {
      type: "인간",
      gender: "여성",
      description: "기억 치유사, 20대, 온화하지만 단호함. 균열을 막으려 함.",
      personality: "온화하고 공감 능력이 뛰어나다. 타인의 고통을 감지한다. 그러나 경계가 명확하다.",
      initial_items: ["치유 수정", "기억 봉인 부적"],
    },
    "도른": {
      type: "엘프",
      gender: "남성",
      description: "고대 수호자, 수백 살, 냉담하고 고집스러움. 균열의 원인을 안다.",
      personality: "냉담하고 말이 없다. 수백 년의 고독으로 인해 인간을 신뢰하지 않는다.",
      initial_items: ["봉인 문양 반지", "고대 지도 조각"],
    },
    "세린": {
      type: "인간",
      gender: "여성",
      description: "균열 추적자, 28세, 거칠고 실용적. 생존이 최우선.",
      personality: "거칠고 직설적. 감정을 숨긴다. 과거의 트라우마가 있다. 동료를 잃은 경험.",
      initial_items: ["균열 감지 나침반", "단검"],
    },
  },
  forbidden_settings: [
    "아군끼리 살상",
    "1화에서 균열 완전 해결",
    "그림자나 목소리가 독립 인물로 등장",
  ],
  story_config: {
    totalEpisodes: 20,
    pov: "3인칭 관찰자",
    style: "묘사풍부",
    episodeLength: 900,
    episodeLengthVar: 200,
    conflict: 7,
    foreshadow: 8,
    emotion: 7,
    dialogue: 6,
    direction: 8,
  },
};

async function setup() {
  try {
    // 기존 테스트북 정리 (재실행 안전)
    await pool.query("DELETE FROM character_dynamic_states WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM canonical_characters WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM episodes WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM episode_snapshots WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM character_arcs WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM foreshadows WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM world_configs WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM world_rules WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM books WHERE id=$1", [BOOK_ID]);

    // 책 생성
    await pool.query(
      "INSERT INTO books (id, user_id, title) VALUES ($1, $2, $3)",
      [BOOK_ID, USER_ID, "[2C] 시간의 균열"]
    );

    // world_configs
    await pool.query(
      `INSERT INTO world_configs (book_id, background, genre, mood, theme, common_tone)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        BOOK_ID,
        "시간 균열이 열린 고대 신전. 과거의 환영과 그림자가 출몰하는 세계.",
        "다크 판타지",
        "미스터리, 긴장, 불안",
        "균열을 막으려는 자와 이용하려는 자의 갈등",
        "묘사풍부하고 긴장감 있는 문체",
      ]
    );

    // world_rules
    for (const rule of worldContext.world_rules) {
      await pool.query(
        "INSERT INTO world_rules (book_id, rule_type, content, is_active) VALUES ($1,'general',$2,true)",
        [BOOK_ID, rule]
      );
    }

    // canonical_characters (4명만, 묘사형 존재 미포함)
    for (const [name, ch] of Object.entries(worldContext.character_defaults)) {
      await pool.query(
        `INSERT INTO canonical_characters (book_id, name, personality, type, gender, initial_items)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [BOOK_ID, name, ch.personality, ch.type, ch.gender, JSON.stringify(ch.initial_items)]
      );
    }

    // Redis context 저장 (generate API가 읽는 경로)
    await redis.set(`context:${BOOK_ID}`, JSON.stringify(worldContext));

    console.log(`✅  테스트북 생성 완료`);
    console.log(`   book_id: ${BOOK_ID}`);
    console.log(`   title:   [2C] 시간의 균열`);
    console.log(`   canonical: ${Object.keys(worldContext.character_defaults).join(", ")}`);
    console.log(`   world rules: ${worldContext.world_rules.length}개`);
    console.log(`   genre: ${worldContext.story_config.pov}, ${worldContext.story_config.style}`);
    console.log(`\n생성 명령:`)
    console.log(`   node scripts/run_alias_smoke_generation.mjs`);

  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  } finally {
    redis.disconnect();
    await pool.end();
  }
}

setup();
