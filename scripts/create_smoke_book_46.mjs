/**
 * create_smoke_book_46.mjs
 * Phase 4.6 clean smoke book 생성
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");
const { randomUUID } = require("crypto");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const userId = "0720b196-e456-474e-85d1-f51473af9f68";

const bookId = randomUUID();

const context = {
  genre: "미스터리 / 폐쇄 공간 / 시간 균열",
  total_planned_episodes: 10,
  characters: [
    {
      name: "이준서",
      role: "주인공 — 건축가, 30대 초반, 냉정한 관찰자",
      initial_items: ["낡은 설계도", "손전등"],
      goal: "붕괴 직전 건물에서 탈출 경로를 찾는다"
    },
    {
      name: "한유리",
      role: "물리학자, 20대 후반, 시간 균열 현상을 추적하던 중 갇혔다",
      initial_items: ["측정 장치", "녹취록"],
      goal: "시간 균열의 원인을 파악해 붕괴를 막는다"
    },
    {
      name: "오민혁",
      role: "경비원, 40대, 이 건물에서 10년 근무, 비밀을 숨기고 있다",
      initial_items: ["마스터 키", "회중전등"],
      goal: "자신의 과거 실수를 감추면서 생존한다"
    },
    {
      name: "서채린",
      role: "인턴 기자, 20대 초반, 사건을 취재하러 왔다가 갇혔다",
      initial_items: ["소형 카메라", "메모장"],
      goal: "진실을 기록하고 탈출한다"
    }
  ],
  world_rules: [
    "건물 내부에서 시간이 불규칙하게 흐른다 — 어떤 층은 과거 어떤 층은 현재",
    "외부와의 통신은 완전히 차단되어 있다",
    "건물 구조는 매 주기마다 미세하게 변한다 — 복도가 길어지거나 방이 사라진다",
    "특정 방에 들어가면 그 방에서 일어난 과거 사건의 잔상이 보인다",
    "마스터 키는 모든 문을 열 수 있지만 한 번 열린 문은 다시 닫혀야 한다",
    "시간 균열이 심해지면 물리 법칙이 부분적으로 무너진다 — 중력 빛 소리에 이상이 생긴다",
    "건물에는 단 하나의 실제 탈출구가 있으며 그 위치는 시간에 따라 이동한다",
    "등장인물이 서로 다른 시간대에 위치할 경우 목소리만 들리고 실체는 보이지 않는다"
  ],
  absolute_forbidden: [
    "정체불명의 새 인물 추가 금지",
    "마법이나 초자연적 능력 부여 금지",
    "탈출구를 1화에서 발견하게 하는 전개 금지"
  ],
  planned_foreshadows: [
    { id: "F1", content: "설계도에 표시된 없어야 할 방 B-7이 실제로 존재한다", plant_ep: 2, resolve_ep: 8 },
    { id: "F2", content: "오민혁이 숨기는 10년 전 사고와 시간 균열의 연관성", plant_ep: 3, resolve_ep: 9 },
    { id: "F3", content: "한유리의 측정 장치가 기록한 이상 신호가 반복 패턴임을 발견", plant_ep: 4, resolve_ep: 10 }
  ]
};

async function run() {
  const res = await pool.query(
    `INSERT INTO books (id, user_id, title, context, current_episode, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, NOW(), NOW()) RETURNING id, title`,
    [bookId, userId, "[4.6] 깨끗한 균열 테스트", JSON.stringify(context)]
  );
  console.log("BOOK_ID=" + res.rows[0].id);
  console.log("TITLE=" + res.rows[0].title);

  // Insert canonical characters (personality = role description, type = human)
  for (const ch of context.characters) {
    await pool.query(
      `INSERT INTO canonical_characters (id, book_id, name, personality, type, initial_items, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [randomUUID(), bookId, ch.name, ch.role, "human", JSON.stringify(ch.initial_items)]
    );
    console.log("  char: " + ch.name);
  }

  // Insert world rules
  for (const rule of context.world_rules) {
    await pool.query(
      `INSERT INTO world_rules (id, book_id, rule, created_at) VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), bookId, rule]
    ).catch(() => {}); // table may not exist — handled by Redis path
  }

  // Cache world rules in Redis
  const Redis = require("ioredis");
  const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  const payload = {
    world_rules: context.world_rules,
    absolute_forbidden: context.absolute_forbidden,
    characters: context.characters,
    genre: context.genre
  };
  await redis.set(`context:${bookId}`, JSON.stringify(payload));
  redis.quit();
  console.log("  redis context cached: world_rules=" + context.world_rules.length);

  await pool.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
