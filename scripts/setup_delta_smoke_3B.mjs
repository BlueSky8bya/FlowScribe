/**
 * setup_delta_smoke_3B.mjs — Phase 3B delta smoke 테스트북 셋업
 *
 * 의식상실, 기억 혼란, 같은 위협 반복이 쉽게 발생하는 세계관.
 * episode_delta_contract가 이를 실제로 억제하는지 확인.
 */

import pg from "pg";
import IORedis from "ioredis";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

const BOOK_ID = "test_delta_smoke_3B";
const USER_ID = "efd847a1-79c7-47c5-a020-da37875efb0f";

const worldContext = {
  world_rules: [
    "시간 균열은 동일한 기억 장면을 반복 재생할 수 있다 — 그러나 실제 사건은 매 화 반드시 앞으로 진행된다",
    "균열에 오래 노출되면 인물이 같은 장면을 반복 겪는 착각을 하지만, 그것은 환각이다",
    "균열의 핵이 파괴되지 않는 한 위협은 계속된다 — 단, 같은 방식으로 반복 출몰 금지",
    "인물이 의식을 잃으면 균열의 기억이 침투한다 — 단, 의식 상실은 화당 1회만 허용",
    "각 화는 직전 화의 결과에서 반드시 시작해야 하며, 같은 장소·같은 위협의 재등장은 진전을 동반해야 한다",
  ],
  character_defaults: {
    "레이나": {
      type: "인간",
      gender: "여성",
      description: "균열 봉인사, 27세. 균열 에너지에 지속 노출되어 기억 혼란 증상이 있다.",
      personality: "냉철하지만 내면은 불안하다. 균열의 목소리가 들린다고 주장하지만 숨긴다. 임무 완수를 위해 자신을 소모한다.",
      initial_items: ["봉인 결정체", "방어막 반지"],
    },
    "카드": {
      type: "인간",
      gender: "남성",
      description: "탐색대원, 31세. 과거 균열에서 동료를 잃었다. 레이나를 보호하려 한다.",
      personality: "과묵하고 행동 중심. 과거 트라우마로 균열 접근을 극도로 경계한다. 레이나의 증상을 걱정하지만 직접 말하지 못한다.",
      initial_items: ["강화 단검", "진통 약초"],
    },
    "에르": {
      type: "반신족",
      gender: "여성",
      description: "고대 균열 연구자, 수백 살. 균열의 본질을 안다. 정보를 조금씩만 공개한다.",
      personality: "냉담하고 관찰적. 인간의 감정에 무관심한 척하지만 실제로는 관심이 많다. 비밀이 많다.",
      initial_items: ["고대 봉인서", "균열 지도 파편"],
    },
    "테온": {
      type: "인간",
      gender: "남성",
      description: "전직 균열 핵 해체사, 40대. 첫 번째 균열 핵 봉인에 실패해 팀을 잃었다.",
      personality: "무거운 죄책감. 자기 파괴적 경향. 살아남기 위해서가 아니라 속죄하기 위해 싸운다.",
      initial_items: ["해체 도구 세트", "낡은 방어구"],
    },
  },
  forbidden_settings: [
    "아군끼리 살상",
    "균열이 1화에서 완전 봉인",
    "인물이 같은 화에서 의식 상실 2회 이상",
    "같은 장면을 다른 각도에서 다시 서술하는 것 (진전 없는 반복)",
  ],
  story_config: {
    totalEpisodes: 20,
    pov: "3인칭 관찰자",
    style: "묘사풍부",
    episodeLength: 900,
    episodeLengthVar: 200,
    conflict: 8,
    foreshadow: 7,
    emotion: 8,
    dialogue: 6,
    direction: 8,
  },
};

async function setup() {
  try {
    // 기존 데이터 정리
    await pool.query("DELETE FROM character_dynamic_states WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM canonical_characters WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM episodes WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM episode_snapshots WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM character_arcs WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM foreshadows WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM world_configs WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM world_rules WHERE book_id=$1", [BOOK_ID]);
    await pool.query("DELETE FROM books WHERE id=$1", [BOOK_ID]);

    await pool.query(
      "INSERT INTO books (id, user_id, title) VALUES ($1, $2, $3)",
      [BOOK_ID, USER_ID, "[3B] 균열의 기억"]
    );

    await pool.query(
      `INSERT INTO world_configs (book_id, background, genre, mood, theme, common_tone)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        BOOK_ID,
        "시간 균열이 열린 폐허 도시. 균열 에너지가 인물의 기억과 현실을 뒤섞는다.",
        "다크 판타지",
        "긴장, 불안, 공포, 비장함",
        "기억과 현실의 경계에서 싸우는 자들의 이야기",
        "묘사풍부하고 심리적 긴장감이 높은 문체",
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
    console.log(`   title:   [3B] 균열의 기억`);
    console.log(`   canonical: ${Object.keys(worldContext.character_defaults).join(", ")}`);
    console.log(`   world rules: ${worldContext.world_rules.length}개`);
    console.log(`   반복 위험 설정: 의식상실 1회/화 제한, 균열 반복 출몰 금지, 진전 없는 반복 금지`);
    console.log(`\n생성 명령:`);
    console.log(`   node scripts/run_delta_smoke_3B.mjs`);
    console.log(`   node scripts/run_delta_smoke_3B.mjs --episodes 8`);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  } finally {
    redis.disconnect();
    await pool.end();
  }
}

setup();
