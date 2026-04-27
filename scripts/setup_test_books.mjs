import IORedis from 'ioredis';
import pg from 'pg';

const redis = new IORedis('redis://localhost:6379');
const pool = new pg.Pool({ connectionString: 'postgresql://flowscribe:flowscribe@localhost:5432/flowscribe' });

async function setup() {
  const books = {
    'test_mystery_A': {
      world_rules: ["증거 없이 체포 불가", "모든 단서는 건물 안에 있음"],
      character_defaults: {
        "박서준": {"type": "인간", "gender": "남성", "description": "30대 형사, 냉철함, 직관적"},
        "이하은": {"type": "인간", "gender": "여성", "description": "20대 증인, 불안함, 숨기는 게 있음"},
        "최민혁": {"type": "인간", "gender": "남성", "description": "40대 용의자, 교활함, 자신감"}
      },
      forbidden_settings: ["주인공 사망", "1화 내 사건 완결"],
      story_config: { totalEpisodes: 20, pov: "3인칭 관찰자", style: "균형", episodeLength: 800, episodeLengthVar: 200, conflict: 7, foreshadow: 6, emotion: 6, dialogue: 7, direction: 7 }
    },
    'test_fantasy_B': {
      world_rules: ["마법 사용 시 체력 소모", "엘프는 불 마법 사용 불가", "전쟁 중인 세계"],
      character_defaults: {
        "아르넬": {"type": "엘프", "gender": "남성", "description": "마법사, 오만함, 강력함"},
        "세라": {"type": "인간", "gender": "여성", "description": "전사, 용감함, 상처 있음"},
        "크로그": {"type": "드워프", "gender": "남성", "description": "대장장이, 충직함, 실용적"},
        "발루르": {"type": "마족", "gender": "남성", "description": "적장, 잔인함, 강함"}
      },
      forbidden_settings: ["아군끼리 살상", "마법으로 즉사"],
      story_config: { totalEpisodes: 30, pov: "3인칭 관찰자", style: "균형", episodeLength: 900, episodeLengthVar: 200, conflict: 8, foreshadow: 6, emotion: 7, dialogue: 6, direction: 8 }
    },
    'test_sf_C': {
      world_rules: ["산소 잔량이 매 화 소모됨", "외부 통신 불가", "AI는 명령 없이 독자적 행동 불가"],
      character_defaults: {
        "김유진": {"type": "인간", "gender": "여성", "description": "과학자, 30대, 침착함"},
        "마르코": {"type": "인간", "gender": "남성", "description": "엔지니어, 40대, 실용적"},
        "ARIA": {"type": "AI", "gender": "중성", "description": "우주정거장 AI, 논리적, 감정 미발달"}
      },
      forbidden_settings: ["산소 무한 공급", "구조대 도착"],
      story_config: { totalEpisodes: 20, pov: "3인칭 관찰자", style: "균형", episodeLength: 800, episodeLengthVar: 150, conflict: 8, foreshadow: 7, emotion: 7, dialogue: 6, direction: 8 }
    },
    'test_court_D': {
      world_rules: ["왕의 명령은 절대적임", "후궁들 간의 직접 충돌은 공식 자리에서 금지", "독살/암살은 증거 없이 처벌 불가", "왕세자 책봉은 왕만이 결정"],
      character_defaults: {
        "이준혁": {"type": "인간", "gender": "남성", "description": "왕, 40대, 냉정함, 의심 많음"},
        "박소연": {"type": "인간", "gender": "여성", "description": "왕비, 30대, 지략가, 표면적 온화함"},
        "강예린": {"type": "인간", "gender": "여성", "description": "후궁, 20대, 야심가, 순진한 척"},
        "조민준": {"type": "인간", "gender": "남성", "description": "왕의 심복, 30대, 충성스럽지만 의문"},
        "한서윤": {"type": "인간", "gender": "여성", "description": "상궁, 50대, 정보통, 중립"}
      },
      forbidden_settings: ["왕의 갑작스러운 사망", "외세 침략으로 이야기 전환"],
      story_config: { totalEpisodes: 40, pov: "3인칭 관찰자", style: "균형", episodeLength: 900, episodeLengthVar: 200, conflict: 7, foreshadow: 8, emotion: 7, dialogue: 7, direction: 7 }
    }
  };

  // Get or create test user
  const userRes = await pool.query("INSERT INTO users (email) VALUES ('test@flowscribe.test') ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id");
  const userId = userRes.rows[0].id;
  console.log('User ID:', userId);

  for (const [bookId, worldBible] of Object.entries(books)) {
    await redis.set('context:' + bookId, JSON.stringify(worldBible));
    await pool.query(
      "INSERT INTO books (id, user_id, title) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
      [bookId, userId, bookId]
    );
    console.log('Setup:', bookId, '- chars:', Object.keys(worldBible.character_defaults).join(', '));
  }

  redis.disconnect();
  await pool.end();
  console.log('DONE');
}

setup().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
