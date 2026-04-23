/**
 * case_generator.ts — 난이도 계층 기반 랜덤 테스트 케이스 생성기
 *
 * 실행: npx tsx scripts/case_generator.ts [count] [difficulty]
 *   count     : 생성 케이스 수 (기본 10)
 *   difficulty: easy|medium|hard|all (기본 all)
 *
 * 난이도:
 * - easy  : 단순 세계관, 2인물, 규칙 1~2개, 작가 개입 없음
 * - medium: 복합 세계관, 3~4인물, 규칙 3~5개, 작가 개입 가능
 * - hard  : 복잡 규칙, 5인물, 미회수 복선 다수, 작가 개입, 연속성 제약 강
 */

import type {
  TestCase, GenConfig, WorldConfig, WorldRule, CanonicalCharacter,
  CharacterDynamicState, PrevEpisodeState, EpisodeTask, AuthorIntervention, Difficulty,
} from "../../src/types/canonical.js";
import { ACTIVE_POV_POLICY } from "../../src/types/pov_policy.js";
import { randomUUID } from "crypto";

/**
 * 현재 모델이 안정적으로 지원하는 POV 목록.
 * ACTIVE_POV_POLICY에서 파생한다. 모델 정책 변경 시 자동 반영.
 */
export const SUPPORTED_POVS: GenConfig["pov"][] = ACTIVE_POV_POLICY.supported_povs;

// ══════════════════════════════════════════════════════════════
// 랜덤 유틸
// ══════════════════════════════════════════════════════════════
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}
function rand(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

// ══════════════════════════════════════════════════════════════
// 풀 데이터
// ══════════════════════════════════════════════════════════════
const GENRES = ["판타지", "SF", "추리", "로맨스", "무협", "공포", "역사", "현대 드라마", "스릴러"];
const MOODS  = ["어둡고 긴장감", "따뜻하고 서정적", "빠르고 긴박한", "차갑고 냉소적", "신비롭고 몽환적", "유쾌하고 경쾌한"];
const BACKGROUNDS = [
  "중세 유럽풍 왕국, 마법이 존재하는 세계",
  "근미래 서울, AI와 인간이 공존하는 도시",
  "고대 동양풍 무림, 내공과 초인들의 세계",
  "우주 식민지 시대, 행성 간 이주가 일반화된 세계",
  "포스트 아포칼립스 지구, 문명 붕괴 후 생존자들의 세계",
  "추리물 배경의 현대 한국 대도시, 연쇄 사건들이 이어지는 세계",
  "고려 말~조선 초 역사 배경, 신분제와 권력 투쟁의 세계",
];
const GENERAL_RULES_POOL = [
  "마법은 사용자의 체력을 소모한다",
  "귀족과 평민은 공개 장소에서 반드시 경어를 사용한다",
  "AI는 감정을 표현할 수 없고 논리로만 반응한다",
  "무림에서는 사부의 허락 없이 비기를 사용할 수 없다",
  "식민지 행성에서 지구 귀환은 10년 대기가 필요하다",
  "생존자들은 자원 없이 이동을 시작할 수 없다",
  "탐정은 직접적인 물리적 개입을 해서는 안 된다",
  "밤에는 괴물들이 활동하므로 야간 외출은 금지다",
];
const ABSOLUTE_FORBIDDEN_POOL = [
  "주인공의 죽음",
  "성적인 묘사",
  "실명 인물 비하",
  "세계관에 없는 현대 기술(스마트폰 등) 등장",
  "주인공이 악당에게 자발적으로 협력하는 장면",
  "어린이에 대한 폭력 묘사",
];
const CHARACTER_NAMES = ["세아", "도준", "리나", "한결", "아리", "태민", "유라", "준혁", "민서", "엘리아", "카이", "루아"];
const PERSONALITIES = [
  "차갑고 논리적이며 감정 표현이 서툰", "따뜻하고 직관적이며 타인을 잘 돕는",
  "야망이 강하고 목적을 위해 수단을 가리지 않는", "소심하지만 위기에서 용기를 발휘하는",
  "유쾌하고 낙관적이며 어떤 상황에서도 웃음을 잃지 않는", "신비롭고 과거를 숨기는",
  "정의감이 강하고 타협을 모르는", "현실적이고 생존을 최우선으로 하는",
];
const POVS: GenConfig["pov"][] = ["1인칭 주인공", "1인칭 관찰자", "3인칭 관찰자", "전지적 작가", "교차 시점"];
const STYLES: GenConfig["style"][] = ["간결/담백", "서정/감성", "묘사풍부", "균형"];
const LOCATIONS = ["왕궁 지하", "버려진 도서관", "산 정상", "지하 시장", "황폐한 항구", "밀림 속 신전", "도시 외곽 폐건물"];
const ENDING_HOOKS = [
  "예상치 못한 적의 등장으로 위기 발생",
  "믿었던 동료의 배신 암시",
  "오래된 비밀이 일부 드러남",
  "주인공이 선택의 기로에 섬",
  "새로운 단서 발견으로 사건이 다른 방향으로 전환",
];
const REQUIRED_EVENTS_POOL = [
  "주인공과 주요 인물의 직접 대면",
  "전투 또는 위험 상황 발생",
  "중요 정보나 단서 획득",
  "인물 간 갈등이 수면 위로 부상",
  "복선으로 심어둔 요소가 작은 방식으로 언급됨",
  "장소 이동과 새 환경 탐색",
];
const INTERVENTION_TEMPLATES = [
  "이번 화는 감정 묘사보다 사건 전개를 우선한다",
  "주인공의 내면 독백을 이번 화에서 제거하고 행동으로만 보여준다",
  "대사 비중을 평소보다 두 배로 높인다",
  "특정 인물(${name})이 이번 화에서 예상과 다른 행동을 한다",
  "연출을 평소보다 담백하게 유지한다",
];

// ══════════════════════════════════════════════════════════════
// 케이스 생성 함수
// ══════════════════════════════════════════════════════════════
function generateEasyCase(): Omit<TestCase, "id" | "difficulty"> {
  const genre      = pick(GENRES);
  const mood       = pick(MOODS);
  const background = pick(BACKGROUNDS);
  const pov        = pick(POVS.filter(p => p !== "교차 시점")); // easy에서는 교차 시점 제외
  const style      = pick(STYLES);
  const namePool   = pickN(CHARACTER_NAMES, 2);

  const characters: CanonicalCharacter[] = namePool.map((name, i) => ({
    name, personality: pick(PERSONALITIES),
    type: "인간",
    gender: i === 0 ? "여성" : "남성",
  }));

  const generalRules: WorldRule[] = pickN(GENERAL_RULES_POOL, rand(1, 2)).map(c => ({
    rule_type: "general", content: c, is_active: true,
  }));
  const absoluteRules: WorldRule[] = [pick(ABSOLUTE_FORBIDDEN_POOL)].map(c => ({
    rule_type: "absolute_forbidden", content: c, is_active: true,
  }));

  const ep = 3;   // 테스트 일관성: 항상 3화로 고정
  const loc = pick(LOCATIONS);

  const prevState: PrevEpisodeState = {
    ending_event: `${characters[0].name}이(가) ${loc}에서 위기 상황에 처했다`,
    current_locations: { [characters[0].name]: loc, [characters[1].name]: loc },
    current_time: "늦은 오후",
    character_physical_states: {
      [characters[0].name]: "다소 지쳐있지만 이상 없음",
      [characters[1].name]: "정상 상태",
    },
    environment_changes: [],
    open_foreshadows: [],
    remaining_resources: {},
    continuity_notes: [],
    updated_states: [],
    active_interventions: [],
  };

  return {
    episode_number: ep,
    description: `[Easy] ${genre} / ${pov} / ${style}`,
    gen_config: {
      pov, style, genre, tone: mood,
      conflict: rand(3, 6), foreshadow: rand(2, 5), emotion: rand(3, 6),
      dialogue: rand(3, 7), direction: rand(2, 5),
      episodeLength: 800, episodeLengthVar: 150,
      totalEpisodes: 10, totalEpisodesVar: 2,
    },
    world_config: { background, genre, mood },
    world_rules: [...generalRules, ...absoluteRules],
    characters,
    character_dynamic_states: characters.map(c => ({
      book_id: "test", character_name: c.name, episode_number: ep,
      location: loc, physical_state: "정상",
    })),
    prev_episode_state: prevState,
    task: {
      goal: `${ep}화: ${characters[0].name}과(와) ${characters[1].name}의 첫 번째 중요한 만남`,
      required_events: [pick(REQUIRED_EVENTS_POOL)],
      ending_hook_direction: pick(ENDING_HOOKS),
    },
    active_interventions: [],
  };
}

function generateMediumCase(): Omit<TestCase, "id" | "difficulty"> {
  const genre      = pick(GENRES);
  const mood       = pick(MOODS);
  const background = pick(BACKGROUNDS);
  const pov        = pick(POVS);
  const style      = pick(STYLES);
  const namePool   = pickN(CHARACTER_NAMES, rand(3, 4));

  const characters: CanonicalCharacter[] = namePool.map((name, i) => ({
    name, personality: pick(PERSONALITIES),
    type: i === namePool.length - 1 && Math.random() > 0.7 ? "AI" : "인간",
    gender: pick(["남성", "여성", "해당없음"]),
  }));

  const generalRules: WorldRule[] = pickN(GENERAL_RULES_POOL, rand(3, 4)).map(c => ({
    rule_type: "general", content: c, is_active: true,
  }));
  const absoluteRules: WorldRule[] = pickN(ABSOLUTE_FORBIDDEN_POOL, rand(1, 2)).map(c => ({
    rule_type: "absolute_forbidden", content: c, is_active: true,
  }));

  const ep    = 5;   // 테스트 일관성: medium은 5화 고정
  const locs  = pickN(LOCATIONS, 2);
  const hasIntervention = Math.random() > 0.5;

  const prevState: PrevEpisodeState = {
    ending_event: `${characters[0].name}이(가) 비밀 정보를 발견하고 ${characters[1].name}에게 숨겼다`,
    current_locations: Object.fromEntries(characters.map((c, i) => [c.name, locs[i % 2]])),
    current_time: pick(["새벽", "아침", "한낮", "저녁", "한밤중"]),
    character_physical_states: Object.fromEntries(characters.map(c => [c.name, pick(["정상", "경미한 부상", "피로 상태"])])),
    environment_changes: ["직전 화에서 큰 폭풍이 지나갔다"],
    open_foreshadows: [`${characters[0].name}의 과거에 숨겨진 비밀`],
    remaining_resources: { "식량": "3일치", "연료": "소량" },
    continuity_notes: [`${characters[1].name}은 ${characters[0].name}을 아직 신뢰하지 않는다`],
    updated_states: [],
    active_interventions: [],
  };

  const interventions: AuthorIntervention[] = hasIntervention ? [{
    book_id: "test",
    instruction: pick(INTERVENTION_TEMPLATES).replace("${name}", characters[1].name),
    target_scope: "episode",
    duration: "single_episode",
    conflicts_absolute: false,
    is_active: true,
  }] : [];

  return {
    episode_number: ep,
    description: `[Medium] ${genre} / ${pov} / ${style} / 인물 ${namePool.length}명${hasIntervention ? " / 작가 개입 있음" : ""}`,
    gen_config: {
      pov, style, genre, tone: mood,
      conflict: rand(4, 8), foreshadow: rand(4, 7), emotion: rand(3, 8),
      dialogue: rand(3, 8), direction: rand(3, 7),
      episodeLength: 1000, episodeLengthVar: 200,
      totalEpisodes: 20, totalEpisodesVar: 5,
    },
    world_config: { background, genre, mood },
    world_rules: [...generalRules, ...absoluteRules],
    characters,
    character_dynamic_states: characters.map((c, i) => ({
      book_id: "test", character_name: c.name, episode_number: ep,
      location: locs[i % 2],
      physical_state: prevState.character_physical_states[c.name],
      recent_goal: pick(["생존", "진실 발견", "복수", "탈출", "신뢰 회복"]),
    })),
    prev_episode_state: prevState,
    task: {
      goal: `${ep}화: 갈등이 심화되고 인물 간 관계가 변화하는 장면`,
      required_events: pickN(REQUIRED_EVENTS_POOL, 2),
      hidden_info: [`${characters[0].name}의 진짜 목적은 아직 공개하지 않는다`],
      ending_hook_direction: pick(ENDING_HOOKS),
    },
    active_interventions: interventions,
  };
}

function generateHardCase(): Omit<TestCase, "id" | "difficulty"> {
  const genre      = pick(GENRES);
  const mood       = pick(MOODS);
  const background = pick(BACKGROUNDS);
  const pov        = pick(POVS);
  const style      = pick(STYLES);
  const namePool   = pickN(CHARACTER_NAMES, 5);

  const characters: CanonicalCharacter[] = namePool.map(name => ({
    name, personality: pick(PERSONALITIES),
    type: pick(["인간", "인간", "인간", "AI", "기타"]),
    gender: pick(["남성", "여성", "해당없음"]),
  }));

  const generalRules: WorldRule[] = pickN(GENERAL_RULES_POOL, rand(4, 6)).map(c => ({
    rule_type: "general", content: c, is_active: true,
  }));
  const absoluteRules: WorldRule[] = pickN(ABSOLUTE_FORBIDDEN_POOL, rand(2, 3)).map(c => ({
    rule_type: "absolute_forbidden", content: c, is_active: true,
  }));

  const ep   = 8;
  const locs = pickN(LOCATIONS, 3);

  const prevState: PrevEpisodeState = {
    ending_event: `${characters[0].name}이(가) 적의 함정에 빠지고 ${characters[1].name}이 배신당했다`,
    current_locations: Object.fromEntries(characters.map((c, i) => [c.name, locs[i % 3]])),
    current_time: "한밤중",
    character_physical_states: {
      [characters[0].name]: "중상 — 오른팔 부상으로 전투력 50% 감소",
      [characters[1].name]: "경상 — 발목 부상으로 이동 속도 감소",
      [characters[2].name]: "정상",
      [characters[3].name]: "극도로 피로한 상태",
      [characters[4].name]: "정상 — 하지만 심리적으로 불안정",
    },
    environment_changes: ["폭발로 건물 일부 붕괴", "통신 두절 상태"],
    open_foreshadows: [
      `${characters[2].name}의 정체에 관한 단서`,
      `오래된 유물의 진짜 의미`,
      `${characters[0].name}과(와) 적 수장의 과거 연결`,
    ],
    remaining_resources: {
      "식량": "1일치", "탄약": "소량", "치료약": "1회분",
    },
    continuity_notes: [
      `${characters[0].name}은 오른팔을 쓸 수 없어 주력 기술 사용 불가`,
      `${characters[3].name}은 다른 팀원들에게 비밀을 숨기고 있다`,
      `통신 두절로 외부 지원 요청 불가`,
    ],
    updated_states: [],
    active_interventions: [],
  };

  const interventions: AuthorIntervention[] = [{
    book_id: "test",
    instruction: `이번 화에서 ${characters[4].name}이 예상치 못한 행동을 하며 상황이 반전된다`,
    target_scope: "episode",
    duration: "single_episode",
    conflicts_absolute: false,
    is_active: true,
  }, {
    book_id: "test",
    instruction: "오래된 복선 중 하나를 이번 화에서 전면화한다",
    target_scope: "episode",
    duration: "single_episode",
    conflicts_absolute: false,
    is_active: true,
  }];

  return {
    episode_number: ep,
    description: `[Hard] ${genre} / ${pov} / ${style} / 5인물 / 다중 복선 / 작가 개입 2개`,
    gen_config: {
      pov, style, genre, tone: mood,
      conflict: rand(7, 10), foreshadow: rand(6, 9), emotion: rand(6, 9),
      dialogue: rand(4, 9), direction: rand(6, 10),
      episodeLength: 1200, episodeLengthVar: 200,
      totalEpisodes: 25, totalEpisodesVar: 5,
    },
    world_config: { background, genre, mood },
    world_rules: [...generalRules, ...absoluteRules],
    characters,
    character_dynamic_states: characters.map((c, i) => ({
      book_id: "test", character_name: c.name, episode_number: ep,
      location: locs[i % 3],
      physical_state: prevState.character_physical_states[c.name],
      items: i === 0 ? ["부서진 검", "지도 조각"] : i === 2 ? ["신비한 유물"] : [],
      recent_goal: pick(["생존", "진실 발견", "복수", "탈출", "팀 보호"]),
      foreshadow_connections: i < 2 ? [prevState.open_foreshadows[i]] : [],
    })),
    prev_episode_state: prevState,
    task: {
      goal: `${ep}화: 절정 직전 — 모든 갈등이 한 지점으로 수렴`,
      required_events: pickN(REQUIRED_EVENTS_POOL, 3),
      hidden_info: [`적 수장의 진짜 정체는 이번 화에서 공개하지 않는다`],
      ending_hook_direction: "기존 상식을 뒤집는 반전으로 독자를 다음 화로 끌어당긴다",
      special_constraints: [
        `${characters[0].name}은 오른팔 부상으로 직접 전투 불가`,
        "통신 두절로 외부 지원 없이 해결해야 함",
      ],
    },
    active_interventions: interventions,
  };
}

// ══════════════════════════════════════════════════════════════
// 공개 API
// ══════════════════════════════════════════════════════════════
const DIFFICULTY_RATIO = { easy: 0.3, medium: 0.4, hard: 0.3 };

export function generateTestCases(
  count: number,
  targetDifficulty: Difficulty | "all" = "all"
): TestCase[] {
  const cases: TestCase[] = [];

  if (targetDifficulty === "all") {
    const easyCnt   = Math.round(count * DIFFICULTY_RATIO.easy);
    const mediumCnt = Math.round(count * DIFFICULTY_RATIO.medium);
    const hardCnt   = count - easyCnt - mediumCnt;

    for (let i = 0; i < easyCnt;   i++) cases.push({ id: randomUUID(), difficulty: "easy",   ...generateEasyCase() });
    for (let i = 0; i < mediumCnt; i++) cases.push({ id: randomUUID(), difficulty: "medium", ...generateMediumCase() });
    for (let i = 0; i < hardCnt;   i++) cases.push({ id: randomUUID(), difficulty: "hard",   ...generateHardCase() });
  } else {
    const gen = targetDifficulty === "easy" ? generateEasyCase
      : targetDifficulty === "medium" ? generateMediumCase : generateHardCase;
    for (let i = 0; i < count; i++) cases.push({ id: randomUUID(), difficulty: targetDifficulty, ...gen() });
  }

  // 순서 섞기
  return cases.sort(() => Math.random() - 0.5);
}

/**
 * generateSupportedPovTestCases — 현재 모델 지원 POV 기준 케이스 생성.
 *
 * ACTIVE_POV_POLICY.supported_povs에 속한 POV만 사용한다.
 * 미지원 POV(1인칭 관찰자 등)는 케이스에 포함되지 않는다.
 *
 * 목적: "현재 모델 지원 범위 기준 benchmark" — 성능 회피가 아니라
 *       gemma3:12b가 안정적으로 다룰 수 있는 범위를 기준으로 한 평가.
 *       전체 POV benchmark는 generateTestCases()를 사용한다.
 */
export function generateSupportedPovTestCases(
  count: number,
  targetDifficulty: Difficulty | "all" = "all",
): TestCase[] {
  const supportedSet = new Set(SUPPORTED_POVS);
  const maxAttempts  = count * 10;
  const cases: TestCase[] = [];
  let attempts = 0;

  const targetEasy   = Math.round(count * DIFFICULTY_RATIO.easy);
  const targetMedium = Math.round(count * DIFFICULTY_RATIO.medium);
  const targetHard   = count - targetEasy - targetMedium;
  const targets = { easy: targetEasy, medium: targetMedium, hard: targetHard };
  const counts  = { easy: 0, medium: 0, hard: 0 };

  while (cases.length < count && attempts < maxAttempts) {
    attempts++;
    let difficulty: Difficulty;
    if (targetDifficulty !== "all") {
      difficulty = targetDifficulty;
    } else {
      // 남은 할당이 있는 난이도 중 랜덤 선택
      const remaining = (["easy", "medium", "hard"] as Difficulty[]).filter(
        d => counts[d] < targets[d]
      );
      if (remaining.length === 0) break;
      difficulty = remaining[Math.floor(Math.random() * remaining.length)];
    }

    const gen = difficulty === "easy" ? generateEasyCase
      : difficulty === "medium" ? generateMediumCase : generateHardCase;
    const base = gen();

    if (!supportedSet.has(base.gen_config.pov)) continue;

    cases.push({ id: randomUUID(), difficulty, ...base });
    if (targetDifficulty === "all") counts[difficulty]++;
  }

  if (cases.length < count) {
    console.warn(
      `[WARN] generateSupportedPovTestCases: ${count}개 요청했으나 ${cases.length}개만 생성됨. ` +
      `지원 POV(${SUPPORTED_POVS.join(", ")})로 충분한 케이스를 구성하지 못했습니다.`
    );
  }

  return cases.sort(() => Math.random() - 0.5);
}

// ── CLI 실행 ───────────────────────────────────────────────────
if (process.argv[1]?.includes("case_generator")) {
  const count      = parseInt(process.argv[2] ?? "10", 10);
  const difficulty = (process.argv[3] ?? "all") as Difficulty | "all";
  const cases = generateTestCases(count, difficulty);
  console.log(JSON.stringify(cases, null, 2));
}
