/**
 * setup_smoke_47.mjs
 * Phase 4.7 Mini Smoke용 clean book 생성
 * Usage: node scripts/setup_smoke_47.mjs
 */
import { createRequire } from "module";
import { randomUUID } from "crypto";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");
const IORedis = require("ioredis");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

const bookId = randomUUID();
const TITLE = "[4.7] 전환 검증";

const worldBible = {
  genre: "폐쇄 공간 / 미스터리 / 시간 균열",
  setting: "지하 연구시설 '아르크(ARC)'. 2045년. 실험 중 시간 균열이 발생해 외부와 차단됨. 시설 내 전력은 72시간 분량만 남아 있다.",
  world_rules: [
    "시간 균열이 발생한 구역은 균열 전 상태로 되돌아간다 — 인물이 그 구역에서 죽으면 시간이 되감긴다.",
    "균열 구역 이동 시 반드시 '안정화 장치'가 필요하다 — 없으면 기억이 흐릿해진다.",
    "시설 내 통신은 내선 전화만 가능하다 — 외부와 완전 차단.",
    "각 구역은 A동(실험실), B동(거주동), C동(에너지 코어), D동(격리동)으로 구분된다.",
    "균열이 확장되면 인접 구역으로 퍼진다 — 현재 D동에서 C동으로 확장 중.",
    "시설 내 AI 관리 시스템 'ARCA'는 비상 모드에서 일부 구역 잠금 권한을 갖는다.",
    "격리 대상 실험체 'K-7'은 D동에 봉인되어 있다 — 균열과 연결되어 있을 가능성이 있다.",
    "전력 코어에 접근하려면 두 명의 인증이 동시에 필요하다."
  ],
  character_defaults: {
    "강이준": {
      type: "인간",
      gender: "남성",
      description: "35세 수석 연구원. 시간 균열 실험 책임자. 냉정하고 계산적이나 숨기는 죄책감이 있다.",
      initial_items: ["연구 노트 (일부 페이지 찢어짐)", "안정화 장치 (배터리 20%)", "내선 전화기"],
      location: "A동 실험실"
    },
    "서민아": {
      type: "인간",
      gender: "여성",
      description: "28세 보안 담당. 시설 구조를 가장 잘 아는 인물. 의심이 많고 직접적이다. 내부 고발자일 가능성이 있다.",
      initial_items: ["보안 카드 (B동·A동 접근 가능)", "손전등", "메모지 (암호로 쓰인 메모)"],
      location: "B동 거주동"
    },
    "오현석": {
      type: "인간",
      gender: "남성",
      description: "42세 시설 관리자. 현실적이고 규칙 중심. 갈등 상황에서 쉽게 굳어버리는 경향이 있다. 비활성화되기 쉬운 구조.",
      initial_items: ["마스터 키 (C동 제외 전 구역)", "비상 매뉴얼", "구급 키트"],
      location: "B동 거주동"
    },
    "이하린": {
      type: "인간",
      gender: "여성",
      description: "24세 신입 연구원. 시간 균열 직후 D동 인근에서 발견됨. 사고 전 기억이 일부 없다. 감정 기복이 심하다.",
      initial_items: ["균열 반응 측정기 (고장)", "개인 메모장", "마지막 실험 데이터 USB"],
      location: "A동 실험실"
    }
  },
  forbidden_settings: [
    "1화 내 사건 완결",
    "전력 완전 소진 (72시간 이전)",
    "균열 즉시 해결",
    "K-7 실체 1화 공개"
  ],
  foreshadow_seeds: [
    { id: "fs_notebook", hint: "강이준의 연구 노트 — 찢어진 페이지에 무엇이 있었는가?", target_episode: 5 },
    { id: "fs_k7", hint: "K-7의 봉인이 균열 이전부터 이미 불안정했다는 증거", target_episode: 7 }
  ],
  story_config: {
    totalEpisodes: 10,
    pov: "3인칭 관찰자",
    style: "균형",
    episodeLength: 900,
    episodeLengthVar: 150,
    conflict: 8,
    foreshadow: 7,
    emotion: 7,
    dialogue: 7,
    direction: 8
  }
};

// DB insert
const userRes = await pool.query(
  "INSERT INTO users (email) VALUES ('test@flowscribe.test') ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
);
const userId = userRes.rows[0].id;

await pool.query(
  "INSERT INTO books (id, user_id, title) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
  [bookId, userId, TITLE]
);

// canonical characters
for (const [name, data] of Object.entries(worldBible.character_defaults)) {
  await pool.query(
    `INSERT INTO canonical_characters (book_id, name, personality, type, gender, initial_items)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (book_id, name) DO NOTHING`,
    [bookId, name, data.description, data.type, data.gender,
     JSON.stringify(data.initial_items)]
  );
}

await redis.set("context:" + bookId, JSON.stringify(worldBible));

await pool.end();
await redis.quit();

console.log(`\n✅  SMOKE BOOK CREATED`);
console.log(`   book_id : ${bookId}`);
console.log(`   title   : ${TITLE}`);
console.log(`   chars   : ${Object.keys(worldBible.character_defaults).join(", ")}`);
console.log(`   rules   : ${worldBible.world_rules.length}개`);
console.log(`   genre   : ${worldBible.genre}`);
console.log(`\nexport SMOKE_BOOK_ID=${bookId}`);
