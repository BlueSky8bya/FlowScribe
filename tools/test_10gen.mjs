#!/usr/bin/env node
/**
 * 10회 랜덤 세계관 1화 생성 테스트
 * - 세계관/인물/시점/장르 랜덤 조합
 * - [CLIFF] 감지, 따옴표 종류, 길이, 가비지 분석
 * - 결과 보고서 출력
 */
import IORedis from "ioredis";

const BASE = "http://localhost:3000";

// ── 랜덤 세계관 정의 ─────────────────────────────────────────
const WORLDS = [
  {
    label: "이세계전생",
    world_rules: ["현대인이 이세계로 전생", "마법과 검이 공존", "상태창 시스템 존재"],
    character_defaults: {
      "한소라": "성별: 여, 역할: 주인공, 특징: 평범한 직장인 출신 전생자. 현실주의적",
      "라이온": "성별: 남, 역할: 조력자, 특징: 이세계 기사단 대장. 냉정하고 실용적",
      "마리아": "성별: 여, 역할: 조연, 특징: 왕궁 치유사. 친절하나 숨기는 것이 있음",
    },
    forbidden_settings: ["현대 기술 지식이 즉시 무적의 힘이 되는 전개"],
    story_config: { pov: "3인칭 관찰자", style: "균형", episodeLength: 800, episodeLengthVar: 200, totalEpisodes: 20, totalEpisodesVar: 5, conflict: 6, foreshadow: 6, emotion: 6, dialogue: 6, direction: 5 },
  },
  {
    label: "동양무협",
    world_rules: ["강호에는 문파와 방파가 존재", "내공 수련이 기본", "의협과 복수가 핵심 가치"],
    character_defaults: {
      "철혈": "성별: 남, 역할: 주인공, 특징: 가문이 몰살된 복수자. 냉혹하나 의리 있음",
      "운화": "성별: 여, 역할: 조력자, 특징: 독문 출신 의녀. 능수능란한 처세",
      "흑사도": "성별: 남, 역할: 적대자, 특징: 강호를 지배하려는 마교 수하",
    },
    forbidden_settings: ["총기 등 현대 무기 사용", "서양 마법"],
    story_config: { pov: "1인칭", style: "서사", episodeLength: 900, episodeLengthVar: 150, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 8, foreshadow: 7, emotion: 5, dialogue: 5, direction: 6 },
  },
  {
    label: "현대로맨스",
    world_rules: ["현대 한국 배경", "재벌/직장 관계 갈등", "오해와 화해가 반복"],
    character_defaults: {
      "윤지아": "성별: 여, 역할: 주인공, 특징: 중소기업 기획팀 과장. 워커홀릭",
      "강현우": "성별: 남, 역할: 남주, 특징: 대기업 부회장. 냉정해 보이나 세심함",
      "박민서": "성별: 여, 역할: 친구, 특징: 주인공의 절친. 발랄하고 눈치 빠름",
    },
    forbidden_settings: ["마법이나 초능력", "역사 배경"],
    story_config: { pov: "3인칭 관찰자", style: "감성", episodeLength: 750, episodeLengthVar: 200, totalEpisodes: 20, totalEpisodesVar: 3, conflict: 5, foreshadow: 5, emotion: 8, dialogue: 8, direction: 4 },
  },
  {
    label: "SF우주",
    world_rules: ["2387년 은하연방 시대", "FTL 항법 가능", "AI와 인류가 공존하며 갈등"],
    character_defaults: {
      "케이든 박": "성별: 남, 역할: 주인공, 특징: 은하 연방 정찰대 중위. 규칙에 집착함",
      "세라": "성별: 여, 역할: 조력자, 특징: 반란군 출신 해커. 정부 불신",
      "ORB-7": "성별: 무, 역할: 조연, 특징: 함선 AI. 감정을 학습 중",
    },
    forbidden_settings: ["마법·검술 등 판타지 요소", "현대 기술 수준"],
    story_config: { pov: "3인칭 관찰자", style: "긴장감", episodeLength: 850, episodeLengthVar: 200, totalEpisodes: 25, totalEpisodesVar: 5, conflict: 7, foreshadow: 7, emotion: 5, dialogue: 5, direction: 7 },
  },
  {
    label: "공포스릴러",
    world_rules: ["고립된 산속 리조트 배경", "통신 두절 상황", "탈출 불가능한 밀실"],
    character_defaults: {
      "나": "성별: 여, 역할: 주인공, 특징: 심리학과 대학원생. 냉철하게 분석하는 성격",
      "황 형사": "성별: 남, 역할: 조력자, 특징: 은퇴 직전의 형사. 경험 많으나 지쳐있음",
      "모르는 이": "성별: 미상, 역할: 적대자, 특징: 정체불명. 사람들을 하나씩 제거함",
    },
    forbidden_settings: ["초자연 현상", "귀신"],
    story_config: { pov: "1인칭", style: "긴장감", episodeLength: 700, episodeLengthVar: 200, totalEpisodes: 15, totalEpisodesVar: 3, conflict: 9, foreshadow: 8, emotion: 7, dialogue: 6, direction: 8 },
  },
  {
    label: "역사사극",
    world_rules: ["조선 중기 배경", "신분제 사회", "당쟁과 외침이 시대 배경"],
    character_defaults: {
      "이정현": "성별: 남, 역할: 주인공, 특징: 몰락 양반 출신 선비. 정의롭고 고집스러움",
      "서연": "성별: 여, 역할: 조력자, 특징: 의녀. 신분 때문에 재능을 숨겨야 함",
      "유상현": "성별: 남, 역할: 적대자, 특징: 탐관오리. 권력욕이 강함",
    },
    forbidden_settings: ["현대어 사용", "현대 개념(민주주의 등) 직접 언급"],
    story_config: { pov: "3인칭 관찰자", style: "서사", episodeLength: 900, episodeLengthVar: 200, totalEpisodes: 30, totalEpisodesVar: 5, conflict: 7, foreshadow: 8, emotion: 6, dialogue: 5, direction: 5 },
  },
  {
    label: "학원청춘",
    world_rules: ["현대 고등학교 배경", "입시 경쟁과 우정이 핵심", "아이돌 연습생 학생 존재"],
    character_defaults: {
      "나 (김도연)": "성별: 여, 역할: 주인공, 특징: 전교 1등 우등생. 겉은 완벽해 보임",
      "최준": "성별: 남, 역할: 조연, 특징: 연예 기획사 연습생 겸 학생",
      "박하은": "성별: 여, 역할: 친구, 특징: 주인공의 단짝. 솔직하고 감정 표현이 풍부",
    },
    forbidden_settings: ["폭력적 장면", "성인 내용"],
    story_config: { pov: "1인칭", style: "감성", episodeLength: 750, episodeLengthVar: 150, totalEpisodes: 20, totalEpisodesVar: 3, conflict: 5, foreshadow: 5, emotion: 8, dialogue: 9, direction: 4 },
  },
  {
    label: "좀비아포칼립스",
    world_rules: ["감염 3년째 한국 배경", "생존자 집단 간 갈등", "감염자는 냄새에 반응"],
    character_defaults: {
      "오민재": "성별: 남, 역할: 주인공, 특징: 전직 소방관. 실용주의적 생존자",
      "김수아": "성별: 여, 역할: 조력자, 특징: 의과대학 중퇴생. 의료 지식 보유",
      "박대표": "성별: 남, 역할: 적대자, 특징: 생존자 집단 리더. 목적을 위해 수단을 가리지 않음",
    },
    forbidden_settings: ["감염자와 대화 가능", "즉시 치료제 발견"],
    story_config: { pov: "3인칭 관찰자", style: "긴장감", episodeLength: 850, episodeLengthVar: 200, totalEpisodes: 25, totalEpisodesVar: 5, conflict: 9, foreshadow: 6, emotion: 6, dialogue: 5, direction: 8 },
  },
  {
    label: "추리미스터리",
    world_rules: ["1930년대 경성 배경", "일제강점기 시대상", "탐정 사무소 운영"],
    character_defaults: {
      "홍탐정": "성별: 여, 역할: 주인공, 특징: 경성 최초 여성 탐정. 날카로운 관찰력",
      "이조수": "성별: 남, 역할: 조력자, 특징: 홍탐정의 조수. 열정은 있으나 허당끼 있음",
      "의뢰인": "성별: 여, 역할: 조연, 특징: 남편의 죽음이 의문스럽다고 찾아온 미망인",
    },
    forbidden_settings: ["현대 과학수사", "인터넷·전화·CCTV"],
    story_config: { pov: "3인칭 관찰자", style: "서사", episodeLength: 800, episodeLengthVar: 200, totalEpisodes: 20, totalEpisodesVar: 5, conflict: 6, foreshadow: 9, emotion: 5, dialogue: 7, direction: 6 },
  },
  {
    label: "판타지왕국",
    world_rules: ["엘프·드워프 등 다종족 공존", "마법사 길드와 기사단 대립", "마왕이 봉인된 지 300년"],
    character_defaults: {
      "아리엘": "성별: 여, 역할: 주인공, 특징: 반엘프 마법사. 차별받으며 성장, 증명하려 함",
      "가렌": "성별: 남, 역할: 조력자, 특징: 왕국 기사단 소속. 보수적이나 편견 없음",
      "제라르": "성별: 남, 역할: 적대자, 특징: 마법사 길드 장로. 순혈주의자",
    },
    forbidden_settings: ["현대 기술", "총기류"],
    story_config: { pov: "3인칭 관찰자", style: "균형", episodeLength: 850, episodeLengthVar: 200, totalEpisodes: 25, totalEpisodesVar: 5, conflict: 7, foreshadow: 7, emotion: 6, dialogue: 6, direction: 6 },
  },
];

// ── Redis에 World Bible 저장 ──────────────────────────────────
async function setupContext(redis, bookId, world) {
  const payload = {
    world_rules: world.world_rules,
    character_defaults: world.character_defaults,
    fixed_relationships: [],
    forbidden_settings: world.forbidden_settings,
    story_config: world.story_config,
  };
  await redis.set(`context:${bookId}`, JSON.stringify(payload), "EX", 3600);
}

// ── SSE 스트리밍 수집 ────────────────────────────────────────
async function streamEpisode(bookId) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}/api/generate?episode=1&book_id=${bookId}`;
    let raw = "";
    let done = false;

    import("http").then(({ default: http }) => {
      const req = http.get(url, (res) => {
        res.on("data", (chunk) => {
          const text = chunk.toString();
          const lines = text.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") { done = true; req.destroy(); resolve(raw); return; }
            try {
              const { token } = JSON.parse(payload);
              if (token) raw += token;
            } catch {}
          }
        });
        res.on("end", () => { if (!done) resolve(raw); });
      });
      req.setTimeout(180000, () => { req.destroy(); resolve(raw); });
      req.on("error", reject);
    });
  });
}

// ── 분석 ─────────────────────────────────────────────────────
function analyze(label, pov, content) {
  const issues = [];

  // 길이
  const len = content.length;
  if (len < 200) issues.push(`너무 짧음 (${len}자)`);

  // [CLIFF] 서버가 마커를 제거하므로 단락 수로 간접 감지
  // 클리프행어 있으면 \n\n 구분 단락이 더 많을 가능성이 높음
  // 정확한 판단은 server log에서 확인
  const hasCliff = true; // 별도 로그로 확인 — 여기선 패스
  void hasCliff;

  // 직선 따옴표 검사
  const straightCount = (content.match(/\x22[^가-힣]*[가-힣]/g) || []).length;
  if (straightCount > 0) issues.push(`직선 따옴표 " 사용 (${straightCount}건) — dialogue 미분리 위험`);

  // 대괄호 블록이 줄바꿈으로 쪼개졌는지
  if (/\[[^\]]*\n[^\]]*\]/.test(content)) issues.push("[대괄호] 블록 내부 줄바꿈 존재 — 렌더링 오작동");

  // 외국어 (한자, 일어) 누출
  if (/[\u4E00-\u9FFF\u3040-\u30FF]/.test(content)) issues.push("외국어(한자/가나) 누출");

  // 1인칭 설정인데 '나는'이 없는지 (간단 체크)
  if (pov === "1인칭" && !/나는|나의|내가/.test(content)) issues.push("1인칭 POV인데 1인칭 표현 없음");

  // 3인칭인데 '나는' 등장
  if (pov.includes("3인칭") && /(?<=[^가-힣])나는|^나는/.test(content)) issues.push("3인칭 설정인데 1인칭 '나는' 누출");

  // 가비지 패턴
  if (/\.{6,}/.test(content)) issues.push("점 연속 6개 이상 (......) 누출");
  if (/[。]{2,}/.test(content)) issues.push("중국식 마침표 연속 누출");

  // 곡선 따옴표 닫힘 여부
  const openCount = (content.match(/\u201C/g) || []).length;
  const closeCount = (content.match(/\u201D/g) || []).length;
  if (Math.abs(openCount - closeCount) > 1) issues.push(`곡선 따옴표 미닫힘 (열림${openCount} vs 닫힘${closeCount})`);

  // 단락 앞 [CLIFF] 마커가 본문에 남아있는지 (클라이언트가 제거해야 함)
  // 서버 스트리밍 단계에선 [CLIFF]가 제거됨 — 여기선 raw에서 체크

  return { len, straightCount, issues };
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const redis = new IORedis("redis://localhost:6379");

  console.log("=".repeat(60));
  console.log("FlowScribe 랜덤 세계관 10화 생성 테스트");
  console.log("=".repeat(60));
  console.log();

  const results = [];

  for (let i = 0; i < WORLDS.length; i++) {
    const world = WORLDS[i];
    const bookId = `test_${world.label}_${Date.now()}`;
    const pov = world.story_config.pov;

    console.log(`[${i+1}/10] ${world.label} (${pov}) 생성 중...`);
    await setupContext(redis, bookId, world);

    const start = Date.now();
    const content = await streamEpisode(bookId);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    const { len, straightCount, issues } = analyze(world.label, pov, content);

    const status = issues.length === 0 ? "✅" : issues.length === 1 ? "⚠️" : "❌";
    console.log(`  ${status} ${len}자, ${elapsed}s, 직선따옴표:${straightCount}`);
    if (issues.length) issues.forEach(iss => console.log(`     → ${iss}`));

    results.push({ label: world.label, pov, len, straightCount, issues, elapsed });

    // 요청 사이 간격
    if (i < WORLDS.length - 1) {
      process.stdout.write("  다음 생성까지 잠시 대기...\n");
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  redis.quit();

  // ── 최종 요약 ───────────────────────────────────────────────
  console.log();
  console.log("=".repeat(60));
  console.log("최종 요약");
  console.log("=".repeat(60));

  const ok = results.filter(r => r.issues.length === 0).length;
  const warn = results.filter(r => r.issues.length === 1).length;
  const fail = results.filter(r => r.issues.length >= 2).length;
  const noStraight = results.filter(r => r.straightCount === 0).length;
  const avgLen = Math.round(results.reduce((s, r) => s + r.len, 0) / results.length);

  console.log(`✅ 정상: ${ok}/10  ⚠️ 경고: ${warn}/10  ❌ 오류: ${fail}/10`);
  console.log(`[CLIFF] 생성률: server log 참조 (클라이언트 스트림에서는 마커 제거됨)`);
  console.log(`곡선 따옴표 준수: ${noStraight}/10`);
  console.log(`평균 길이: ${avgLen}자`);
  console.log();

  // 이슈 빈도 집계
  const issueFreq = {};
  for (const r of results) for (const iss of r.issues) {
    const key = iss.split("(")[0].split(" —")[0].trim();
    issueFreq[key] = (issueFreq[key] || 0) + 1;
  }
  if (Object.keys(issueFreq).length) {
    console.log("이슈 빈도:");
    Object.entries(issueFreq).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  ${v}회 — ${k}`));
  }
}

main().catch(console.error);
