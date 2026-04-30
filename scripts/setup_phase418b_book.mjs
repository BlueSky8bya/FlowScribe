/**
 * setup_phase418b_book.mjs — Phase 4.18B 검증용 clean book 생성
 *
 * 새 책을 만들고 다음을 채운다:
 *   - books row (title, user, context_id)
 *   - world_configs (genre, background, mood)
 *   - world_rules (general 5건 + absolute_forbidden 1건)
 *   - canonical_characters 5명 (각자 personality + initial_items)
 *   - reader_profiles default
 *
 * 장르: 현대 미스터리 (이세계 트로프 회피 — 확깨용과 axis가 완전히 다름)
 *
 * Usage:
 *   node scripts/setup_phase418b_book.mjs
 *   --owner-email <email>  (기본 blackspace665@gmail.com)
 *   --reset                (이미 있으면 삭제 후 재생성)
 */
import pg from "pg";
import IORedis from "ioredis";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();

const args = process.argv.slice(2);
const ownerEmail = args.includes("--owner-email") ? args[args.indexOf("--owner-email") + 1] : "blackspace665@gmail.com";
const reset = args.includes("--reset");

const TITLE = "Phase 4.18B 검증 — 잠긴 별빛 도서관";

const WORLD = {
  genre: "현대 미스터리 / 어반 판타지",
  background: "현대 서울. 밤마다 같은 골목에 한 번도 본 적 없는 도서관이 나타나는 도시. 거기서 사라진 사람을 찾아야 하는 일행이 단서 한 조각씩만을 가지고 모인다.",
  mood: "차분하고 묵직한 긴장감. 서로를 의심하지만 한 발씩 양보하며 진실에 다가간다.",
  theme: "잃어버린 사람의 흔적, 책에 새겨진 약속, 도시 한복판에 숨은 비현실",
  common_tone: "현실적이고 절제된 묘사. 감정은 표면 아래에서 출렁인다.",
};

const RULES = [
  { rule_type: "general", content: "이 도서관은 정해진 골목에서만 나타나며, 한 사람에게 보이면 다른 사람에게는 보이지 않을 수 있다." },
  { rule_type: "general", content: "도서관에서 빌린 책은 반드시 같은 자리에 돌려놓아야 한다. 어기면 기억의 일부가 책 속으로 사라진다." },
  { rule_type: "general", content: "사라진 사람의 이름을 큰 소리로 부르면 그 사람의 흔적이 책장 사이에서 잠시 깜빡인다." },
  { rule_type: "general", content: "각 인물은 자기만의 단서를 가지고 있고, 단서는 합쳐졌을 때만 다음 책장이 열린다." },
  { rule_type: "general", content: "도서관에서 시간 감각은 어긋나며, 한 시간이 바깥에서는 한 호흡일 수도, 한 밤일 수도 있다." },
  { rule_type: "absolute_forbidden", content: "이세계 전이, 환생, 게임 시스템 창, 마법 클래스/직업 시스템은 등장하지 않는다." },
];

const CHARS = [
  {
    name: "정유리",
    type: "인간",
    gender: "여성",
    personality:
      "프리랜서 사진기자. 6년 전 동생 정세훈이 골목에서 사라진 뒤로 그 골목을 매일 지나간다. " +
      "감정 표현이 적고 카메라 뷰파인더 너머에서 사람을 본다. " +
      "사실에 집착하고, 누군가의 추측에 쉽게 동의하지 않는다.",
    initial_items: [
      { name: "낡은 디지털 카메라", description: "동생 사라지기 전 마지막 사진이 남아있는 기기" },
      { name: "골목 지도 메모장", description: "6년간 그린 골목 변화 기록" },
      { name: "동생의 도서관 회원증", description: "왜 회원증이 있는지 모름" },
    ],
  },
  {
    name: "한도윤",
    type: "인간",
    gender: "남성",
    personality:
      "구청 도시계획 담당 공무원. 30대 초반, 이성적이고 절차주의자. " +
      "겉으로는 차갑지만 한번 신뢰한 사람의 부탁은 끝까지 챙긴다. " +
      "이 도서관이 행정 기록 어디에도 없다는 사실에 가장 먼저 의문을 품은 사람.",
    initial_items: [
      { name: "이상해진 도시계획 도면", description: "골목 한 칸이 매일 다르게 그려져 있다" },
      { name: "휴대용 측량 거리계", description: "이 골목에서만 작동하지 않음" },
      { name: "구청 신분증", description: "공무원 신분 증명" },
    ],
  },
  {
    name: "이서림",
    type: "인간",
    gender: "여성",
    personality:
      "야간 카페 점장. 인생의 절반을 이 동네에서 살았고 동네 사람들의 사연을 가장 많이 안다. " +
      "다정해 보이지만 사실은 가장 먼저 무엇이 잘못됐는지 알아채는 사람. " +
      "자기 자신에 대한 정보는 거의 흘리지 않는다.",
    initial_items: [
      { name: "단골 노트", description: "동네 손님들의 사소한 변화 기록" },
      { name: "양철 열쇠", description: "어디 열쇠인지 본인도 모르는 오래된 열쇠" },
      { name: "야간 카페 명함", description: "도서관 골목 입구 카페" },
    ],
  },
  {
    name: "박재겸",
    type: "인간",
    gender: "남성",
    personality:
      "고서적 복원가. 손이 거칠고 말이 적다. " +
      "책의 종이만 만져도 그것이 어느 시대 책인지, 어디서 찍힌 잉크인지 안다. " +
      "도서관에 있는 책 한 권이 본인이 5년 전에 복원해 잃어버린 책이라고 의심한다.",
    initial_items: [
      { name: "복원용 핀셋 세트", description: "오래된 종이를 다루는 도구" },
      { name: "잃어버린 책 사진", description: "5년 전 자신이 마지막으로 본 책" },
      { name: "휴대용 자외선 등", description: "잉크 진위 확인용" },
    ],
  },
  {
    name: "최가온",
    type: "인간",
    gender: "여성",
    personality:
      "사회복지사. 실종 가족 지원 단체에서 일하며 이 골목과 관련된 실종 사건을 데이터로 모아왔다. " +
      "감정에 휘둘리지 않으려 노력하지만, 어린 시절 같은 골목에서 친구가 사라진 기억이 있다. " +
      "다른 인물 4명의 이야기를 조각으로 처음 연결해주는 사람.",
    initial_items: [
      { name: "실종 사건 데이터 노트북", description: "30년치 골목 실종 기록" },
      { name: "친구의 사진", description: "20년 전 사라진 어린 시절 친구" },
      { name: "정신건강 지원 핫라인 카드", description: "직업적으로 늘 가지고 있음" },
    ],
  },
];

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

async function main() {
  // 1. 사용자 찾기
  const userRes = await pool.query("SELECT id FROM users WHERE email=$1 LIMIT 1", [ownerEmail]);
  if (!userRes.rows.length) {
    console.error(`user '${ownerEmail}' not found`);
    process.exit(1);
  }
  const userId = userRes.rows[0].id;

  // 2. 기존 동명 책 처리
  const existing = await pool.query("SELECT id FROM books WHERE user_id=$1 AND title=$2", [userId, TITLE]);
  if (existing.rows.length) {
    if (!reset) {
      console.log(`이미 존재: ${existing.rows[0].id} (--reset 으로 재생성)`);
      console.log(existing.rows[0].id);
      await pool.end();
      await redis.quit();
      return;
    }
    const oldId = existing.rows[0].id;
    console.log(`기존 책 삭제: ${oldId}`);
    // CASCADE 의존하지 않고 명시적 cleanup
    for (const tbl of [
      "run_traces", "episodes", "character_dynamic_states", "foreshadows",
      "arc_summaries", "character_arcs", "canonical_characters",
      "world_rules", "world_configs", "episode_snapshots",
      "session_logs", "validation_logs", "revision_logs", "ending_rewards",
      "trajectory_rewards", "dpo_pairs", "story_states",
    ]) {
      await pool.query(`DELETE FROM ${tbl} WHERE book_id=$1`, [oldId]).catch(() => {});
    }
    await pool.query("DELETE FROM books WHERE id=$1", [oldId]);
    await redis.del(`context:${oldId}`).catch(() => {});
  }

  // 3. 새 책 생성
  const ins = await pool.query(
    `INSERT INTO books (id, user_id, title, current_episode)
     VALUES (gen_random_uuid(), $1, $2, 1) RETURNING id`,
    [userId, TITLE]
  );
  const bookId = ins.rows[0].id;

  // 4. world_configs
  await pool.query(
    `INSERT INTO world_configs (book_id, genre, background, mood, theme, common_tone)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [bookId, WORLD.genre, WORLD.background, WORLD.mood, WORLD.theme, WORLD.common_tone]
  );

  // 5. world_rules
  for (const r of RULES) {
    await pool.query(
      `INSERT INTO world_rules (book_id, rule_type, content) VALUES ($1, $2, $3)`,
      [bookId, r.rule_type, r.content]
    );
  }

  // 6. canonical_characters
  for (const c of CHARS) {
    await pool.query(
      `INSERT INTO canonical_characters (book_id, name, type, gender, personality, initial_items)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bookId, c.name, c.type, c.gender, c.personality, JSON.stringify(c.initial_items)]
    );
  }

  // 7. reader_profile은 user_id 기준이므로 별도 setup 불필요 (book_id 컬럼 없음)

  console.log(`✓ created: ${bookId}`);
  console.log(`  title: ${TITLE}`);
  console.log(`  genre: ${WORLD.genre}`);
  console.log(`  rules: ${RULES.length}`);
  console.log(`  chars: ${CHARS.length}`);
  console.log(bookId);  // last line = book_id (스크립트 chaining 용)

  await pool.end();
  await redis.quit();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
