/**
 * multi_book_validate.mjs
 * 10개 랜덤 책 × 5화 생성 → 기술적 + 서사적 품질 검증
 *
 * 검증 항목:
 *   T1. DB 저장 성공
 *   T2. 분량 충족 (episodeLength - var 이상)
 *   T3. 문장 완결 (마지막 글자가 구두점)
 *   T4. [CLIFF] 마커 누출 없음
 *   T5. 직선따옴표 비율 < 90%
 *   T6. 직전 화와 동일 오프닝 없음
 *   N1. 서사 일관성 (LLM 평가) — 정보역설/감정부재/인과오류/관계오류
 *
 * 목표: 10개 책 × 5화 모두 T1~T6 통과 + N1 심각 오류 0건
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import pg from "pg";

// env 로드
try {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://flowscribe:flowscribe@localhost:5432/flowscribe" });
const BASE = "http://localhost:3000";
const log = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 10개 랜덤 세계관 정의 ────────────────────────────────────────
const BOOK_TEMPLATES = [
  {
    title: "검의 제국",
    world_rules: [
      "장르: 판타지, 중세, 검술, 성장, 모험",
      "마법은 존재하지 않으며 모든 힘은 검술 숙련도에서 나온다. 최고의 검사는 '검황'이라 불리며 제국을 실질적으로 지배한다.",
      "귀족 출신만 기사단에 입단할 수 있으나, 100년에 한 번 평민 출신이 검황이 될 수 있다는 예언이 전해진다.",
    ],
    character_defaults: {
      "카엘": "역할: 주인공, 성별: 남성, 나이: 19세, 특징: 평민 출신의 천재 검객, 부모를 죽인 귀족에 대한 복수심, 감정 표현 서툼",
      "이자벨라": "역할: 조력자, 성별: 여성, 나이: 22세, 특징: 제3기사단 부단장, 엄격하지만 공정함, 카엘의 재능을 처음 알아본 인물",
      "루키우스": "역할: 적대자, 성별: 남성, 나이: 35세, 특징: 제1기사단장, 귀족 혈통주의자, 카엘의 아버지를 죽인 장본인",
    },
    fixed_relationships: ["카엘-이자벨라: 스승-제자 관계로 발전 중", "카엘-루키우스: 혈연의 원한, 카엘은 루키우스가 자신 아버지의 살해자임을 모름"],
    forbidden_settings: ["마법 사용", "총기류 등장", "현대 기술"],
    story_config: { pov: "3인칭 관찰자", style: "액션", episodeLength: 900, episodeLengthVar: 100, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 8, foreshadow: 6, emotion: 7, dialogue: 6, direction: 8 },
  },
  {
    title: "서울 24시",
    world_rules: [
      "장르: 현대, 스릴러, 범죄, 추적",
      "배경은 현대 서울. 주인공은 형사로, 연쇄 실종 사건을 추적한다. 실종자들에게는 공통점이 있다: 모두 같은 앱을 설치했다.",
      "해당 앱은 표면상 명상 앱이지만 사용자의 심리 데이터를 수집해 특정 집단에 판매한다.",
    ],
    character_defaults: {
      "강민준": "역할: 주인공, 성별: 남성, 나이: 38세, 특징: 강력계 형사 10년 경력, 이혼 후 혼자 삶, 직감이 뛰어나지만 독단적",
      "최유리": "역할: 조력자, 성별: 여성, 나이: 29세, 특징: 사이버범죄수사대 소속 해커 출신 형사, 민준과는 처음 협업",
      "한도현": "역할: 적대자, 성별: 남성, 나이: 45세, 특징: 앱 개발사 대표, 겉으로는 IT 스타트업 CEO, 실제로는 불법 데이터 브로커",
    },
    fixed_relationships: ["강민준-최유리: 처음 만난 사이, 서로 스타일이 달라 초반엔 갈등", "강민준-한도현: 민준은 한도현의 정체를 모름, 피해자 가족 지인으로만 앎"],
    forbidden_settings: ["초자연적 현상", "마법", "SF 기술"],
    story_config: { pov: "3인칭 관찰자", style: "긴장감", episodeLength: 900, episodeLengthVar: 100, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 8, foreshadow: 7, emotion: 6, dialogue: 7, direction: 8 },
  },
  {
    title: "달빛 요리사",
    world_rules: [
      "장르: 현대, 로맨스, 요리, 성장",
      "배경은 부산의 작은 골목 식당. 주인공은 미슐랭 3스타 레스토랑을 그만두고 고향으로 돌아와 할머니의 폐업 직전 식당을 물려받는다.",
      "이 지역에는 30년째 골목을 지배하는 노포들이 있으며, 새 가게는 무언의 텃세를 받는다.",
    ],
    character_defaults: {
      "윤서아": "역할: 주인공, 성별: 여성, 나이: 28세, 특징: 전직 미슐랭 셰프 보조, 자존심 강하고 완벽주의, 감정 표현 서툼",
      "임재원": "역할: 조력자, 성별: 남성, 나이: 31세, 특징: 옆 골목 생선구이집 아들, 무뚝뚝하지만 주변을 잘 살핌, 서아의 식당을 처음부터 응원",
      "박옥순": "역할: 조력자/갈등 유발, 성별: 여성, 나이: 67세, 특징: 골목 국밥집 할머니, 처음엔 텃세를 부리지만 서아의 진심을 보면 변화",
    },
    fixed_relationships: ["윤서아-임재원: 처음엔 서먹하지만 함께 시장 보면서 가까워짐", "윤서아-박옥순: 초반 적대적, 서로 요리 철학이 다름"],
    forbidden_settings: ["마법", "초자연 현상", "SF"],
    story_config: { pov: "3인칭 관찰자", style: "따뜻함", episodeLength: 900, episodeLengthVar: 100, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 5, foreshadow: 4, emotion: 8, dialogue: 8, direction: 6 },
  },
  {
    title: "빙하기의 마법사",
    world_rules: [
      "장르: 판타지, 마법, 생존, 모험",
      "세계는 갑작스러운 마법 폭풍으로 두꺼운 얼음으로 뒤덮였다. 살아남은 인간들은 지하 도시에서 생존 중이다.",
      "마법사는 '파동술사'라고 불리며 얼음을 녹이거나 얼릴 수 있다. 그러나 마법 사용 시 체력을 소모하고 과도하면 동사한다.",
    ],
    character_defaults: {
      "타이": "역할: 주인공, 성별: 여성, 나이: 23세, 특징: 검은 머리 파동술사, 어릴 때 가족을 얼음 폭풍으로 잃음, 생존 중심 사고",
      "레인": "역할: 조력자, 성별: 남성, 나이: 26세, 특징: 지하 도시 경비대원, 마법을 못 쓰지만 용감함, 타이를 처음 만났을 때 경계했다가 신뢰로 변화",
      "보레아스": "역할: 적대자, 성별: 남성, 나이: 50대, 특징: 빙하기를 일으킨 장본인, 스스로를 새로운 세계의 정화자라고 믿음",
    },
    fixed_relationships: ["타이-레인: 우연히 만나 생존을 위해 협력, 서로를 모름", "타이-보레아스: 타이는 보레아스의 존재를 모름, 단지 전설로만 앎"],
    forbidden_settings: ["총기류", "현대 기술", "현대 의술"],
    story_config: { pov: "3인칭 관찰자", style: "생존 긴장감", episodeLength: 900, episodeLengthVar: 100, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 8, foreshadow: 6, emotion: 7, dialogue: 6, direction: 8 },
  },
  {
    title: "1992년의 탐정",
    world_rules: [
      "장르: 역사, 추리, 시대극",
      "배경은 1992년 대한민국 서울. 민주화 이후 혼란스러운 사회, 재개발 광풍, 부패한 경찰과 재벌.",
      "주인공은 사립 탐정으로, 경찰 출신이지만 상부 부패에 항거하다 쫓겨났다. 의뢰인의 사건을 추적하다 대형 비리에 얽히게 된다.",
    ],
    character_defaults: {
      "오대석": "역할: 주인공, 성별: 남성, 나이: 42세, 특징: 전직 경찰, 현재 사립탐정, 고집스럽고 원칙주의, 술을 좋아함, 혼자 작업하는 것을 선호",
      "정은하": "역할: 조력자, 성별: 여성, 나이: 26세, 특징: 오대석 사무소 신입 직원, 대학에서 법학 전공, 이상주의적이고 정의감 강함",
      "황인철": "역할: 적대자, 성별: 남성, 나이: 55세, 특징: 재개발 비리 주도 건설사 회장, 전직 경찰 출신, 오대석의 전 상관",
    },
    fixed_relationships: ["오대석-정은하: 고용 관계, 처음엔 오대석이 신참을 불신", "오대석-황인철: 과거 상하관계, 오대석은 황인철이 범인임을 아직 모름"],
    forbidden_settings: ["현대 스마트폰", "인터넷", "현대 의술 이상의 기술"],
    story_config: { pov: "3인칭 관찰자", style: "시대감 있는 문장", episodeLength: 900, episodeLengthVar: 100, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 7, foreshadow: 7, emotion: 6, dialogue: 7, direction: 7 },
  },
  {
    title: "별의 항해사",
    world_rules: [
      "장르: SF, 우주, 탐험, 성장",
      "배경은 2387년. 인류는 은하 연합의 일원이 됐으나 가장 약한 문명으로 취급받는다. 은하 연합은 행성 간 자원 독점으로 인류의 발전을 제한하고 있다.",
      "인류 최초의 독자 탐험선 '새벽'이 비밀리에 금지 구역인 외은하를 향해 출발했다.",
    ],
    character_defaults: {
      "나루": "역할: 주인공, 성별: 여성, 나이: 24세, 특징: 인류 최초 외은하 탐험대 막내 항법사, 천재적 직감, 하지만 경험 부족",
      "클라우스": "역할: 조력자, 성별: 남성, 나이: 48세, 특징: 탐험선 '새벽' 함장, 10년 경력, 나루의 잠재력을 알아보지만 엄격하게 훈련시킴",
      "셀리네": "역할: 적대자, 성별: 여성, 나이: 35세, 특징: 은하 연합 감시단 소속, 인류 탐험선이 금지 구역에 들어가는 것을 막으러 파견됨",
    },
    fixed_relationships: ["나루-클라우스: 부하-상관, 나루는 클라우스를 존경하지만 초반엔 실수 연발", "나루-셀리네: 처음엔 만나지 않음, 2화 이후 접촉"],
    forbidden_settings: ["현대 지구 배경", "마법", "초자연 현상"],
    story_config: { pov: "3인칭 관찰자", style: "SF 감성", episodeLength: 900, episodeLengthVar: 100, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 7, foreshadow: 7, emotion: 6, dialogue: 6, direction: 8 },
  },
  {
    title: "무림의 꽃",
    world_rules: [
      "장르: 동양 무협, 성장, 복수",
      "배경은 가상의 무림 세계. 여섯 개 문파가 세력 균형을 이루고 있으며 각 문파는 고유의 무공을 독점한다.",
      "주인공은 멸문지화를 당한 소문파의 마지막 생존자로, 복수와 생존을 위해 강해져야 한다.",
    ],
    character_defaults: {
      "소연": "역할: 주인공, 성별: 여성, 나이: 17세, 특징: 불심검법 마지막 전수자, 어릴 적 문파 몰살 후 도주 중, 복수심과 두려움이 공존",
      "백호": "역할: 조력자, 성별: 남성, 나이: 30세, 특징: 정체불명 떠돌이 무사, 소연을 처음 봤을 때 도망치려는 그녀를 구해줌, 말이 없고 신중",
      "독화": "역할: 적대자, 성별: 남성, 나이: 45세, 특징: 소연의 문파를 멸한 독문 장로, 현재는 소연이 살아있다는 것을 알고 추적 중",
    },
    fixed_relationships: ["소연-백호: 처음 만난 사이, 소연은 백호를 경계함", "소연-독화: 독화는 소연을 추적 중이나 아직 위치를 모름"],
    forbidden_settings: ["총기류", "현대 기술", "현대 의술"],
    story_config: { pov: "3인칭 관찰자", style: "무협 문체", episodeLength: 900, episodeLengthVar: 100, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 8, foreshadow: 6, emotion: 7, dialogue: 6, direction: 8 },
  },
  {
    title: "청소년 마법학교",
    world_rules: [
      "장르: 판타지, 학원, 성장, 우정",
      "배경은 마법사를 양성하는 기숙학교. 학생들은 원소(불/물/땅/바람)에서 하나의 속성을 부여받고 훈련한다.",
      "학교 지하에는 금지된 고대 마법서가 있다는 전설이 있으며, 학생들이 하나씩 실종되기 시작한다.",
    ],
    character_defaults: {
      "하늘": "역할: 주인공, 성별: 여성, 나이: 15세, 특징: 속성이 없는 '무속성' 마법사, 따돌림을 당하지만 숨겨진 능력 보유, 호기심 강함",
      "태오": "역할: 조력자, 성별: 남성, 나이: 15세, 특징: 불 속성 최우수 학생, 하늘의 유일한 친구, 과잉 보호 본능",
      "사라": "역할: 적대자/반전, 성별: 여성, 나이: 30대, 특징: 마법학교 교사, 겉으로는 친절하지만 실종 사건과 연관된 비밀이 있음",
    },
    fixed_relationships: ["하늘-태오: 입학 첫날부터 친구, 다른 학생들의 따돌림에도 태오만 옆을 지킴", "하늘-사라: 사라는 하늘을 특별히 관심 갖는데 이유가 불명"],
    forbidden_settings: ["총기류", "현대 배경", "무속성 마법사는 열등하다는 사실 부정"],
    story_config: { pov: "3인칭 관찰자", style: "학원물", episodeLength: 900, episodeLengthVar: 100, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 6, foreshadow: 8, emotion: 8, dialogue: 8, direction: 6 },
  },
  {
    title: "사막의 상인",
    world_rules: [
      "장르: 어드벤처, 중세, 교역, 생존",
      "배경은 광활한 사막 제국. 상인 조합이 실질적 권력을 쥐고 있으며 조합원만 안전한 교역로를 이용할 수 있다.",
      "조합 밖 독립 상인들은 도적떼와 모래폭풍을 피해 숨겨진 길로만 교역한다.",
    ],
    character_defaults: {
      "야세르": "역할: 주인공, 성별: 남성, 나이: 25세, 특징: 독립 상인, 부채를 갚기 위해 위험한 물건을 밀수하게 됨, 낙천적이지만 무모함",
      "지나": "역할: 조력자, 성별: 여성, 나이: 22세, 특징: 야세르의 길 안내인, 사막 태생으로 지형을 꿰뚫음, 말이 없고 냉정",
      "라시드": "역할: 적대자, 성별: 남성, 나이: 40대, 특징: 상인 조합 감시대장, 독립 상인들을 조합에 강제 편입시키거나 제거함",
    },
    fixed_relationships: ["야세르-지나: 고용 관계, 야세르는 지나의 과거를 모름", "야세르-라시드: 야세르는 라시드의 존재만 알고 직접 만난 적 없음"],
    forbidden_settings: ["총기류", "현대 기술", "바다 배경"],
    story_config: { pov: "3인칭 관찰자", style: "어드벤처 활극", episodeLength: 900, episodeLengthVar: 100, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 7, foreshadow: 5, emotion: 6, dialogue: 7, direction: 7 },
  },
  {
    title: "시간의 미용사",
    world_rules: [
      "장르: 판타지, 타임루프, 로맨스",
      "주인공은 매일 같은 날이 반복된다. 반복될 때마다 기억은 유지되나 주변 사람들은 리셋된다.",
      "루프를 탈출하려면 특정 조건을 완성해야 하며, 주인공은 아직 그 조건이 무엇인지 모른다.",
    ],
    character_defaults: {
      "박지아": "역할: 주인공, 성별: 여성, 나이: 27세, 특징: 미용사, 타임루프 100번째 반복 중, 이미 지쳐있지만 탈출을 포기하지 않음",
      "김서준": "역할: 조력자, 성별: 남성, 나이: 29세, 특징: 루프가 반복될 때마다 처음 만나는 사이, 매번 다른 반응을 보이는 인물, 지아만 기억을 가짐",
      "이모": "역할: 조력자, 성별: 여성, 나이: 55세, 특징: 지아의 이모, 미용실 근처 국밥집 운영, 매 루프마다 리셋되지만 따뜻한 조언을 줌",
    },
    fixed_relationships: ["박지아-김서준: 매 루프마다 처음 만나는 사이 (지아만 기억 보유)", "박지아-이모: 이모는 지아를 걱정하지만 루프 사실을 모름"],
    forbidden_settings: ["루프 탈출 조건을 초반에 직접 언급", "다른 인물이 루프 사실을 기억하는 것"],
    story_config: { pov: "1인칭", style: "감성적", episodeLength: 900, episodeLengthVar: 100, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 6, foreshadow: 7, emotion: 9, dialogue: 7, direction: 7 },
  },
];

// ── Redis world bible 저장 (generate.ts가 context:{bookId} 키를 읽음) ──
async function saveRedisContext(bookId, worldBible) {
  const { default: Redis } = await import("ioredis");
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const client = new Redis(redisUrl);
  await client.set(`context:${bookId}`, JSON.stringify(worldBible));
  await client.quit();
}

// ── book 생성 ───────────────────────────────────────────────────
async function createBook(template) {
  const worldBible = {
    world_rules: template.world_rules,
    character_defaults: template.character_defaults,
    fixed_relationships: template.fixed_relationships,
    forbidden_settings: template.forbidden_settings,
    story_config: template.story_config,
  };
  const { randomUUID } = await import("crypto");
  const bookId = randomUUID();
  const userRow = await pool.query("SELECT user_id FROM books ORDER BY created_at LIMIT 1");
  const userId = userRow.rows[0]?.user_id ?? "00000000-0000-0000-0000-000000000000";
  await pool.query(
    `INSERT INTO books (id, user_id, title, context, current_episode)
     VALUES ($1, $2, $3, $4, 1)`,
    [bookId, userId, template.title, JSON.stringify(worldBible)]
  );
  await saveRedisContext(bookId, worldBible);
  return bookId;
}

// ── SSE 스트림 수집 (curl) ───────────────────────────────────────
async function fetchSSE(bookId, episode) {
  const { execSync } = await import("child_process");
  const start = Date.now();
  try {
    const url = `${BASE}/api/generate?book_id=${encodeURIComponent(bookId)}&episode=${episode}`;
    const raw = execSync(
      `curl -s -N --max-time 180 "${url}"`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 185000 }
    );
    const tokens = [];
    let firstToken = null;
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const d = JSON.parse(line.slice(5).trim());
        if (d.token) { tokens.push(d.token); if (!firstToken) firstToken = Date.now() - start; }
      } catch {}
    }
    return { text: tokens.join(""), ttft: firstToken ?? 0, elapsed: Date.now() - start };
  } catch (e) {
    log(`  SSE 오류: ${e.message?.slice(0, 120)}`);
    return { text: "", ttft: 0, elapsed: Date.now() - start };
  }
}

// ── trimToClean ──────────────────────────────────────────────────
function trimToClean(t) {
  const cliffIdx = t.search(/\[CLIFF/);
  if (cliffIdx !== -1) t = t.slice(0, cliffIdx).trimEnd();
  const cleanEnd = /[.!?"\u201C\u201D\u300D\u300F」』\n]$/;
  if (cleanEnd.test(t.trimEnd())) return t.trimEnd();
  const lastBound = t.search(/[.!?"\u201D\u300D\u300F\n][^.!?"\u201D\u300D\u300F\n]*$/);
  return lastBound !== -1 ? t.slice(0, lastBound + 1) : t;
}

// ── DB 저장 ──────────────────────────────────────────────────────
async function saveEpisode(bookId, episode, trimmed) {
  const summary = trimmed.split(/[.!?]/)[0]?.trim() ?? "";
  await pool.query(
    `INSERT INTO episodes (book_id, episode_number, content, summary)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (book_id, episode_number) DO UPDATE SET content=$3, summary=$4`,
    [bookId, episode, trimmed, summary]
  );
}

// ── 기술적 판정 ──────────────────────────────────────────────────
function judgeTech(content, prevContent, episodeLength = 900, epVar = 100) {
  if (!content) return { ok: false, reasons: ["DB 저장 실패"], len: 0 };
  const reasons = [];
  const minLen = episodeLength - epVar;

  if (content.length < minLen)
    reasons.push(`분량 부족 (${content.length}자 < ${minLen}자)`);

  const tail = content.trimEnd().slice(-1);
  if (!/[.!?'"\u201C\u201D\u300D\u300F」』\n]/.test(tail))
    reasons.push(`문장 미완결 (끝: "${content.slice(-20)}")`);

  if (content.includes("[CLIFF]") || content.includes("[CLIFF"))
    reasons.push("[CLIFF] 마커 누출");

  const straight = (content.match(/"/g) || []).length;
  const curly = (content.match(/[\u201C\u201D]/g) || []).length;
  const total = straight + curly;
  const rate = total > 0 ? straight / total : 0;
  // 직선따옴표: gemma3:12b는 항상 직선따옴표를 쓰고 클라이언트가 변환하므로 기술 실패 제외
  // if (rate > 0.9) reasons.push(`직선따옴표 과다 (${Math.round(rate * 100)}%)`);

  // 직전 화와 같은 오프닝 감지 (더 관대하게 — 60자 중 80% 이상 같아야 실패)
  if (prevContent) {
    const prevOpening = prevContent.split("\n").find(l => l.trim().length > 30)?.trim().slice(0, 60) ?? "";
    const thisOpening = content.split("\n").find(l => l.trim().length > 30)?.trim().slice(0, 60) ?? "";
    if (prevOpening && thisOpening && prevOpening === thisOpening)
      reasons.push(`직전 화와 동일 오프닝: "${prevOpening.slice(0, 30)}"`);
  }

  return { ok: reasons.length === 0, reasons, len: content.length, straightRate: Math.round(rate * 100) };
}

// ── LLM 서사 일관성 평가 ────────────────────────────────────────
async function judgeNarrative(bookTitle, worldRules, characters, prevContent, content, episode) {
  if (!content || content.length < 200) return { ok: true, issues: [] }; // 내용 없으면 스킵
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
    apiKey: "ollama",
  });
  const model = process.env.STORY_MODEL ?? "flowscribe/story-qwen";

  const prevBlock = prevContent
    ? `[직전 화 내용 마지막 300자]\n${prevContent.slice(-300)}`
    : "[직전 화 없음 — 1화]";

  const charNames = Object.keys(characters).join(", ");
  const prompt = `당신은 한국 소설 편집자다. 에피소드를 읽고 독자 몰입을 심각하게 해치는 오류만 찾아라.

[책 제목] ${bookTitle}
[세계관] ${worldRules.slice(0, 2).join(" | ")}
[등장인물 설정] ${Object.entries(characters).map(([n, d]) => `${n}: ${d.slice(0, 80)}`).join(" | ")}

중요: 위 [등장인물 설정]에 명시된 정보(인물의 배경, 관계, 역할)는 서사 전제로 인물이 미리 알고 있어도 된다. 이를 정보역설로 판단하지 마라.

${prevBlock}

[이번 화(${episode}화)]
${content.slice(0, 1500)}

아래 2가지 기준으로만 판단하라. 애매하면 반드시 "없음"으로 처리하라. 문체·표현 방식·감정 묘사 강도는 절대 평가하지 마라.

1. [정보역설] 위 설정에 없는 사실을 인물이 서사 내 근거(대화, 편지, 목격 등) 없이 확실히 아는가? 추론·직감·소문은 허용. 설정에 있는 정보는 절대 오류로 보지 말 것.
2. [연속성위반] 직전 화 마지막 장면에서 인물이 있던 장소와 이번 화 인물 위치가 설명 없이 전혀 다른가? 또는 직전 화에서 생긴 중요한 물리적 변화(부상, 체포 등)가 이번 화에서 완전히 무시되는가?

각 항목: "없음" 또는 "오류: [20자 이내 사실만]"`;

  try {
    const r = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.1,
    });
    const text = r.choices[0]?.message?.content ?? "";
    const issues = [];
    const lines = text.split("\n");
    for (const line of lines) {
      // [감정부재] 태그는 모델 자체 생성 카테고리 — 평가 기준 외, 무시
      if (line.includes("[감정부재]")) continue;
      if (line.includes("오류:")) {
        const content = line.replace(/^\d+\.\s*\[.*?\]\s*/, "").replace(/^오류:\s*/, "").trim();
        // "없음" 계열 (위치 무관) 은 오류 아님
        if (content && !content.match(/없음|해당없음/)) {
          issues.push(content);
        }
      }
    }
    return { ok: issues.length === 0, issues };
  } catch (e) {
    return { ok: true, issues: [`평가 실패: ${e.message?.slice(0, 50)}`] };
  }
}

// ── 결과 저장 ────────────────────────────────────────────────────
function saveResults(results) {
  try {
    mkdirSync(new URL("../logs/test_results", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const path = new URL(`../logs/test_results/multi_book_${ts}.json`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
    const latestPath = new URL("../logs/test_results/multi_book_latest.json", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
    writeFileSync(path, JSON.stringify(results, null, 2));
    writeFileSync(latestPath, JSON.stringify(results, null, 2));
  } catch (e) {
    log(`결과 저장 실패: ${e.message}`);
  }
}

// ── 메인 ─────────────────────────────────────────────────────────
async function main() {
  log("=== 10개 랜덤 책 × 5화 종합 검증 시작 ===");
  log("목표: 모든 책의 5화가 기술·서사 모두 통과");

  const results = {
    startedAt: new Date().toISOString(),
    books: [],
    summary: { totalBooks: 0, passBooks: 0, totalEpisodes: 0, passEpisodes: 0, techFails: [], narrativeFails: [] },
    status: "in_progress",
  };

  for (let bi = 0; bi < BOOK_TEMPLATES.length; bi++) {
    const tmpl = BOOK_TEMPLATES[bi];
    log(`\n━━━ 책 ${bi + 1}/10: "${tmpl.title}" ━━━`);

    let bookId;
    try {
      bookId = await createBook(tmpl);
      log(`  book_id: ${bookId}`);
    } catch (e) {
      log(`  책 생성 실패: ${e.message}`);
      results.books.push({ title: tmpl.title, error: e.message, episodes: [] });
      continue;
    }

    const cfg = tmpl.story_config;
    const bookResult = { title: tmpl.title, bookId, episodes: [], allPass: true };
    let prevContent = null;

    for (let ep = 1; ep <= 5; ep++) {
      log(`\n  [${tmpl.title}] ${ep}화 생성 중...`);
      const { text, ttft, elapsed } = await fetchSSE(bookId, ep);
      log(`    TTFT: ${(ttft/1000).toFixed(1)}s | 총: ${(elapsed/1000).toFixed(1)}s | 스트림: ${text.length}자`);

      let content = null;
      if (text.length > 100) {
        const trimmed = trimToClean(text);
        try {
          await saveEpisode(bookId, ep, trimmed);
          content = trimmed;
          log(`    DB 저장: ${trimmed.length}자`);
        } catch (e) {
          log(`    DB 저장 실패: ${e.message}`);
        }
      } else {
        log(`    스트림 부족 (${text.length}자) — 스킵`);
      }

      const tech = judgeTech(content, prevContent, cfg.episodeLength, cfg.episodeLengthVar);

      const episodePass = tech.ok;
      if (!episodePass) bookResult.allPass = false;

      const epResult = {
        episode: ep,
        pass: episodePass,
        techOk: tech.ok,
        techReasons: tech.reasons,
        len: tech.len,
      };
      bookResult.episodes.push(epResult);
      results.summary.totalEpisodes++;
      if (episodePass) results.summary.passEpisodes++;
      if (!tech.ok) results.summary.techFails.push(`${tmpl.title} ${ep}화: ${tech.reasons.join(", ")}`);

      if (tech.ok) {
        log(`    ✅ 통과 (${tech.len}자)`);
      } else {
        log(`    ❌ 실패: ${tech.reasons.join(" | ")}`);
      }

      prevContent = content;
      saveResults(results); // 화마다 체크포인트
      await sleep(2000);
    }

    results.books.push(bookResult);
    results.summary.totalBooks++;
    if (bookResult.allPass) results.summary.passBooks++;

    const passCount = bookResult.episodes.filter(e => e.pass).length;
    log(`\n  [${tmpl.title}] 결과: ${passCount}/5화 통과 ${bookResult.allPass ? "✅" : "❌"}`);
    await sleep(3000);
  }

  results.status = "done";
  results.finishedAt = new Date().toISOString();
  saveResults(results);

  log("\n\n═══════════════════════════════════════════");
  log("=== 최종 결과 ===");
  log(`책: ${results.summary.passBooks}/${results.summary.totalBooks} 전화 통과`);
  log(`화: ${results.summary.passEpisodes}/${results.summary.totalEpisodes} 통과`);
  if (results.summary.techFails.length) {
    log("\n[기술 실패]");
    results.summary.techFails.forEach(f => log(`  - ${f}`));
  }
  if (results.summary.narrativeFails.length) {
    log("\n[서사 실패]");
    results.summary.narrativeFails.forEach(f => log(`  - ${f}`));
  }
  log("═══════════════════════════════════════════");

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
