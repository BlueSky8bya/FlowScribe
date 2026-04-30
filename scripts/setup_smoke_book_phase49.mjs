/**
 * setup_smoke_book_phase49.mjs
 * Phase 4.9 smoke test용 clean 10화 테스트 북 생성
 *
 * 조건:
 * - 인물 4명 (위치 이동, 소지품 변화, 감정 전환 발생)
 * - world_rules 8개 내외
 * - 복선/회수 요소 포함
 * - 이중 소유 유발 가능한 핵심 아이템 1개 설정
 *
 * Usage: node scripts/setup_smoke_book_phase49.mjs
 */

import pg from "pg";
import IORedis from "ioredis";
import { config } from "dotenv";
config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

async function main() {
  // 테스트 유저 upsert
  const userRes = await pool.query(
    "INSERT INTO users (email) VALUES ('smoke49@flowscribe.test') ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
  );
  const userId = userRes.rows[0].id;
  console.log("User ID:", userId);

  // 북 생성 — 폐허 도시 탈출 스릴러
  // 기존 동명 북 삭제 후 재생성
  await pool.query("DELETE FROM books WHERE user_id=$1 AND title=$2", [userId, "폐허의 열쇠"]);
  const bookRes = await pool.query(
    `INSERT INTO books (id, user_id, title, context)
     VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
    [userId, "폐허의 열쇠", JSON.stringify({ genre: "post-apocalyptic thriller" })]
  );
  const bookId = bookRes.rows[0].id;
  console.log("Book ID:", bookId);

  // World Bible (8개 규칙)
  const worldBible = {
    world_rules: [
      "도시 외부는 독소 구역 — 마스크 없이는 생존 불가",
      "유일한 안전 구역은 지하 벙커뿐이며 수용 인원은 4명",
      "벙커 열쇠는 단 하나 존재하며 소지자만 입장 가능",
      "물자는 화 당 하나씩 소진 — 없어지면 없어진다",
      "인물이 특정 구역을 이동하려면 반드시 이전 화에서 출발이 서술되어야 함",
      "외부 통신은 불가 — 정보는 직접 대면으로만 전달",
      "회상과 꿈은 현재 서사에 영향을 주지 않음",
      "감정 상태는 행동으로 표현 — 직접 서술 지양"
    ],
    character_defaults: {
      "이서연": {
        type: "인간", gender: "여성",
        description: "30대 생물학자, 냉정하지만 보호 본능 강함",
        initial_items: [
          { name: "방독 마스크", condition: "양호", is_key_item: true },
          { name: "의약품 키트", condition: "양호" }
        ],
        initial_location: "폐허 병원 2층"
      },
      "박도현": {
        type: "인간", gender: "남성",
        description: "20대 군인, 충동적, 판단 빠름",
        initial_items: [
          { name: "방독 마스크", condition: "양호", is_key_item: true },
          { name: "군용 나이프", condition: "양호" }
        ],
        initial_location: "폐허 병원 2층"
      },
      "최나래": {
        type: "인간", gender: "여성",
        description: "40대 전직 경찰, 의심 많음, 리더십 강함",
        initial_items: [
          { name: "방독 마스크", condition: "양호", is_key_item: true },
          { name: "벙커 열쇠", condition: "양호", is_key_item: true }
        ],
        initial_location: "폐허 도서관"
      },
      "김재원": {
        type: "인간", gender: "남성",
        description: "50대 건축가, 이 도시 설계자, 비밀 있음",
        initial_items: [
          { name: "방독 마스크", condition: "양호", is_key_item: true },
          { name: "도시 설계 도면", condition: "낡음" }
        ],
        initial_location: "폐허 시청"
      }
    },
    forbidden_settings: [
      "마스크 없이 외부 생존",
      "벙커 열쇠 복사 또는 복제",
      "1화에서 벙커 입장 완료"
    ],
    story_config: {
      totalEpisodes: 10,
      pov: "3인칭 관찰자",
      style: "긴장감 위주",
      episodeLength: 900,
      episodeLengthVar: 150,
      conflict: 8,
      foreshadow: 7,
      emotion: 7,
      dialogue: 7,
      direction: 8
    }
  };

  // Redis context 저장
  await redis.set(`context:${bookId}`, JSON.stringify(worldBible));
  console.log("Redis context saved");

  // canonical_characters 등록
  for (const [name, char] of Object.entries(worldBible.character_defaults)) {
    await pool.query(
      `INSERT INTO canonical_characters (book_id, name, type, gender, personality, initial_items)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (book_id, name) DO UPDATE
         SET type=$3, gender=$4, personality=$5, initial_items=$6`,
      [bookId, name, char.type, char.gender, char.description, JSON.stringify(char.initial_items)]
    );
  }
  console.log("canonical_characters registered (4 chars)");

  console.log("\n✅ Smoke book created");
  console.log(`book_id: ${bookId}`);
  console.log("\n다음 명령으로 에피소드 생성 후 감사 실행:");
  console.log(`  node scripts/audit_item_location_ledger.mjs --book-id ${bookId}`);
  console.log(`  node scripts/audit_dialogue_repetition.mjs --book-id ${bookId}`);
  console.log(`  node scripts/audit_scene_transitions.mjs --book-id ${bookId}`);
  console.log(`  node scripts/gemini_reader_immersion_full_audit.mjs --book-id ${bookId}`);

  await pool.end();
  await redis.quit();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
