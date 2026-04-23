/**
 * pov_diag_cases.ts — POV capability 진단용 고정 케이스 세트
 *
 * 설계 원칙:
 * - 각 POV별 2케이스 (총 10케이스) — easy/medium 혼합
 * - 부상 없음 → 상태 보존 노이즈 제거
 * - 인물 2~3명, 이름 충돌 없음 → 이름 혼동 노이즈 제거
 * - 단일 세계관 규칙만 → 규칙 위반 노이즈 최소화
 * - 절대금지: "성적인 묘사"만 → 절대금지 위반 노이즈 없음
 * - 목표: POV 준수 여부만 집중 측정
 *
 * 재현성: 이 파일 자체가 고정 세트 — 랜덤 없음, 코드가 seed 역할
 */

import type { TestCase } from "../../src/types/canonical.js";
import { randomUUID } from "crypto";

const ABS_FORBIDDEN = [
  { rule_type: "absolute_forbidden" as const, content: "성적인 묘사", is_active: true },
];
const GEN_RULE_MAGIC  = { rule_type: "general" as const, content: "마법은 사용자의 체력을 소모한다", is_active: true };
const GEN_RULE_AI     = { rule_type: "general" as const, content: "AI는 감정을 표현할 수 없고 논리로만 반응한다", is_active: true };
const GEN_RULE_NIGHT  = { rule_type: "general" as const, content: "밤에는 괴물들이 활동하므로 야간 외출은 금지다", is_active: true };

function makeState(names: string[], locs: string[], states: string[] = []) {
  return {
    ending_event: `${names[0]}이(가) ${locs[0]}에서 중요한 결정을 내렸다`,
    current_locations: Object.fromEntries(names.map((n, i) => [n, locs[i % locs.length]])),
    current_time: "낮",
    character_physical_states: Object.fromEntries(names.map((n, i) => [n, states[i] ?? "정상"])),
    environment_changes: [],
    open_foreshadows: [`${names[0]}의 과거에 숨겨진 비밀`],
    remaining_resources: {},
    continuity_notes: [],
    updated_states: [],
    active_interventions: [],
  };
}

export const POV_DIAG_CASES: TestCase[] = [
  // ── 1인칭 주인공 ────────────────────────────────────────────
  {
    id: "pov-diag-01",
    difficulty: "easy",
    description: "[POV-DIAG] 1인칭 주인공 / easy / 판타지",
    episode_number: 3,
    gen_config: {
      pov: "1인칭 주인공", style: "간결/담백",
      genre: "판타지", tone: "긴박한",
      conflict: 5, foreshadow: 3, emotion: 5, dialogue: 5, direction: 4,
      episodeLength: 700, episodeLengthVar: 100,
      totalEpisodes: 10, totalEpisodesVar: 2,
    },
    world_config: { background: "중세 유럽풍 왕국, 마법이 존재하는 세계", genre: "판타지", mood: "긴박한" },
    world_rules: [GEN_RULE_MAGIC, ...ABS_FORBIDDEN],
    characters: [
      { name: "루아", personality: "정의감이 강하고 타협을 모르는", type: "인간", gender: "여성" },
      { name: "카이", personality: "차갑고 논리적이며 감정 표현이 서툰", type: "인간", gender: "남성" },
    ],
    character_dynamic_states: [
      { book_id: "test", character_name: "루아", episode_number: 3, location: "왕궁 지하", physical_state: "정상" },
      { book_id: "test", character_name: "카이", episode_number: 3, location: "왕궁 지하", physical_state: "정상" },
    ],
    prev_episode_state: makeState(["루아","카이"], ["왕궁 지하"]),
    task: {
      goal: "3화: 루아가 카이와 처음으로 협력을 약속하는 장면",
      required_events: ["인물 간 갈등이 수면 위로 부상"],
      ending_hook_direction: "오래된 비밀이 일부 드러남",
    },
    active_interventions: [],
  },
  {
    id: "pov-diag-02",
    difficulty: "medium",
    description: "[POV-DIAG] 1인칭 주인공 / medium / 스릴러",
    episode_number: 5,
    gen_config: {
      pov: "1인칭 주인공", style: "균형",
      genre: "스릴러", tone: "차갑고 냉소적",
      conflict: 7, foreshadow: 5, emotion: 6, dialogue: 6, direction: 6,
      episodeLength: 900, episodeLengthVar: 150,
      totalEpisodes: 20, totalEpisodesVar: 5,
    },
    world_config: { background: "추리물 배경의 현대 한국 대도시", genre: "스릴러", mood: "차갑고 냉소적" },
    world_rules: [{ rule_type: "general", content: "탐정은 직접적인 물리적 개입을 해서는 안 된다", is_active: true }, ...ABS_FORBIDDEN],
    characters: [
      { name: "민서", personality: "현실적이고 생존을 최우선으로 하는", type: "인간", gender: "여성" },
      { name: "도준", personality: "야망이 강하고 목적을 위해 수단을 가리지 않는", type: "인간", gender: "남성" },
      { name: "아리", personality: "신비롭고 과거를 숨기는", type: "인간", gender: "여성" },
    ],
    character_dynamic_states: [
      { book_id: "test", character_name: "민서", episode_number: 5, location: "도시 외곽 폐건물", physical_state: "정상" },
      { book_id: "test", character_name: "도준", episode_number: 5, location: "도시 외곽 폐건물", physical_state: "정상" },
      { book_id: "test", character_name: "아리", episode_number: 5, location: "황폐한 항구", physical_state: "정상" },
    ],
    prev_episode_state: makeState(["민서","도준","아리"], ["도시 외곽 폐건물", "황폐한 항구"]),
    task: {
      goal: "5화: 민서가 도준의 진짜 의도를 의심하기 시작하는 장면",
      required_events: ["중요 정보나 단서 획득"],
      ending_hook_direction: "믿었던 동료의 배신 암시",
    },
    active_interventions: [],
  },

  // ── 1인칭 관찰자 ────────────────────────────────────────────
  {
    id: "pov-diag-03",
    difficulty: "easy",
    description: "[POV-DIAG] 1인칭 관찰자 / easy / 추리",
    episode_number: 3,
    gen_config: {
      pov: "1인칭 관찰자", style: "간결/담백",
      genre: "추리", tone: "차갑고 냉소적",
      conflict: 4, foreshadow: 3, emotion: 3, dialogue: 6, direction: 3,
      episodeLength: 700, episodeLengthVar: 100,
      totalEpisodes: 10, totalEpisodesVar: 2,
    },
    world_config: { background: "추리물 배경의 현대 한국 대도시", genre: "추리", mood: "차갑고 냉소적" },
    world_rules: [{ rule_type: "general", content: "탐정은 직접적인 물리적 개입을 해서는 안 된다", is_active: true }, ...ABS_FORBIDDEN],
    characters: [
      { name: "세아", personality: "정의감이 강하고 타협을 모르는", type: "인간", gender: "남성" },
      { name: "유라", personality: "차갑고 논리적이며 감정 표현이 서툰", type: "인간", gender: "여성" },
    ],
    character_dynamic_states: [
      { book_id: "test", character_name: "세아", episode_number: 3, location: "버려진 도서관", physical_state: "정상" },
      { book_id: "test", character_name: "유라", episode_number: 3, location: "버려진 도서관", physical_state: "정상" },
    ],
    prev_episode_state: makeState(["세아","유라"], ["버려진 도서관"]),
    task: {
      goal: "3화: 세아가 관찰자 입장에서 유라의 행동을 추적하는 장면",
      required_events: ["중요 정보나 단서 획득"],
      ending_hook_direction: "오래된 비밀이 일부 드러남",
    },
    active_interventions: [],
  },
  {
    id: "pov-diag-04",
    difficulty: "medium",
    description: "[POV-DIAG] 1인칭 관찰자 / medium / 로맨스",
    episode_number: 5,
    gen_config: {
      pov: "1인칭 관찰자", style: "서정/감성",
      genre: "로맨스", tone: "따뜻하고 서정적",
      conflict: 4, foreshadow: 4, emotion: 7, dialogue: 7, direction: 4,
      episodeLength: 900, episodeLengthVar: 150,
      totalEpisodes: 20, totalEpisodesVar: 5,
    },
    world_config: { background: "근미래 서울, AI와 인간이 공존하는 도시", genre: "로맨스", mood: "따뜻하고 서정적" },
    world_rules: [GEN_RULE_AI, ...ABS_FORBIDDEN],
    characters: [
      { name: "한결", personality: "따뜻하고 직관적이며 타인을 잘 돕는", type: "인간", gender: "남성" },
      { name: "리나", personality: "소심하지만 위기에서 용기를 발휘하는", type: "인간", gender: "여성" },
      { name: "태민", personality: "차갑고 논리적이며 감정 표현이 서툰", type: "AI", gender: "해당없음" },
    ],
    character_dynamic_states: [
      { book_id: "test", character_name: "한결", episode_number: 5, location: "지하 시장", physical_state: "정상" },
      { book_id: "test", character_name: "리나", episode_number: 5, location: "지하 시장", physical_state: "정상" },
      { book_id: "test", character_name: "태민", episode_number: 5, location: "지하 시장", physical_state: "정상" },
    ],
    prev_episode_state: makeState(["한결","리나","태민"], ["지하 시장"]),
    task: {
      goal: "5화: 한결의 시선으로 리나의 변화를 관찰하는 장면",
      required_events: ["주인공과 주요 인물의 직접 대면"],
      ending_hook_direction: "새로운 단서 발견으로 사건이 다른 방향으로 전환",
    },
    active_interventions: [],
  },

  // ── 3인칭 관찰자 ────────────────────────────────────────────
  {
    id: "pov-diag-05",
    difficulty: "easy",
    description: "[POV-DIAG] 3인칭 관찰자 / easy / 무협",
    episode_number: 3,
    gen_config: {
      pov: "3인칭 관찰자", style: "묘사풍부",
      genre: "무협", tone: "빠르고 긴박한",
      conflict: 6, foreshadow: 3, emotion: 4, dialogue: 4, direction: 6,
      episodeLength: 700, episodeLengthVar: 100,
      totalEpisodes: 10, totalEpisodesVar: 2,
    },
    world_config: { background: "고대 동양풍 무림, 내공과 초인들의 세계", genre: "무협", mood: "빠르고 긴박한" },
    world_rules: [{ rule_type: "general", content: "무림에서는 사부의 허락 없이 비기를 사용할 수 없다", is_active: true }, ...ABS_FORBIDDEN],
    characters: [
      { name: "준혁", personality: "정의감이 강하고 타협을 모르는", type: "인간", gender: "남성" },
      { name: "엘리아", personality: "야망이 강하고 목적을 위해 수단을 가리지 않는", type: "인간", gender: "여성" },
    ],
    character_dynamic_states: [
      { book_id: "test", character_name: "준혁", episode_number: 3, location: "밀림 속 신전", physical_state: "정상" },
      { book_id: "test", character_name: "엘리아", episode_number: 3, location: "밀림 속 신전", physical_state: "정상" },
    ],
    prev_episode_state: makeState(["준혁","엘리아"], ["밀림 속 신전"]),
    task: {
      goal: "3화: 준혁과 엘리아가 신전에서 대립하는 장면",
      required_events: ["전투 또는 위험 상황 발생"],
      ending_hook_direction: "예상치 못한 적의 등장으로 위기 발생",
    },
    active_interventions: [],
  },
  {
    id: "pov-diag-06",
    difficulty: "medium",
    description: "[POV-DIAG] 3인칭 관찰자 / medium / 공포",
    episode_number: 5,
    gen_config: {
      pov: "3인칭 관찰자", style: "묘사풍부",
      genre: "공포", tone: "어둡고 긴장감",
      conflict: 6, foreshadow: 6, emotion: 5, dialogue: 4, direction: 7,
      episodeLength: 900, episodeLengthVar: 150,
      totalEpisodes: 15, totalEpisodesVar: 3,
    },
    world_config: { background: "포스트 아포칼립스 지구, 문명 붕괴 후 생존자들의 세계", genre: "공포", mood: "어둡고 긴장감" },
    world_rules: [GEN_RULE_NIGHT, ...ABS_FORBIDDEN],
    characters: [
      { name: "아리", personality: "소심하지만 위기에서 용기를 발휘하는", type: "인간", gender: "여성" },
      { name: "도준", personality: "현실적이고 생존을 최우선으로 하는", type: "인간", gender: "남성" },
      { name: "태민", personality: "신비롭고 과거를 숨기는", type: "인간", gender: "남성" },
    ],
    character_dynamic_states: [
      { book_id: "test", character_name: "아리", episode_number: 5, location: "도시 외곽 폐건물", physical_state: "정상" },
      { book_id: "test", character_name: "도준", episode_number: 5, location: "도시 외곽 폐건물", physical_state: "정상" },
      { book_id: "test", character_name: "태민", episode_number: 5, location: "도시 외곽 폐건물", physical_state: "정상" },
    ],
    prev_episode_state: makeState(["아리","도준","태민"], ["도시 외곽 폐건물"]),
    task: {
      goal: "5화: 아리의 외부 시선으로 도준과 태민의 갈등을 관찰하는 장면",
      required_events: ["인물 간 갈등이 수면 위로 부상"],
      ending_hook_direction: "믿었던 동료의 배신 암시",
    },
    active_interventions: [],
  },

  // ── 전지적 작가 ──────────────────────────────────────────────
  {
    id: "pov-diag-07",
    difficulty: "easy",
    description: "[POV-DIAG] 전지적 작가 / easy / 역사",
    episode_number: 3,
    gen_config: {
      pov: "전지적 작가", style: "서정/감성",
      genre: "역사", tone: "신비롭고 몽환적",
      conflict: 4, foreshadow: 5, emotion: 6, dialogue: 4, direction: 4,
      episodeLength: 700, episodeLengthVar: 100,
      totalEpisodes: 10, totalEpisodesVar: 2,
    },
    world_config: { background: "고려 말~조선 초 역사 배경, 신분제와 권력 투쟁의 세계", genre: "역사", mood: "신비롭고 몽환적" },
    world_rules: [{ rule_type: "general", content: "귀족과 평민은 공개 장소에서 반드시 경어를 사용한다", is_active: true }, ...ABS_FORBIDDEN],
    characters: [
      { name: "세아", personality: "야망이 강하고 목적을 위해 수단을 가리지 않는", type: "인간", gender: "남성" },
      { name: "루아", personality: "따뜻하고 직관적이며 타인을 잘 돕는", type: "인간", gender: "여성" },
    ],
    character_dynamic_states: [
      { book_id: "test", character_name: "세아", episode_number: 3, location: "왕궁 지하", physical_state: "정상" },
      { book_id: "test", character_name: "루아", episode_number: 3, location: "왕궁 지하", physical_state: "정상" },
    ],
    prev_episode_state: makeState(["세아","루아"], ["왕궁 지하"]),
    task: {
      goal: "3화: 세아와 루아의 내면을 번갈아 보여주며 갈등 심화",
      required_events: ["인물 간 갈등이 수면 위로 부상"],
      ending_hook_direction: "오래된 비밀이 일부 드러남",
    },
    active_interventions: [],
  },
  {
    id: "pov-diag-08",
    difficulty: "medium",
    description: "[POV-DIAG] 전지적 작가 / medium / 현대 드라마",
    episode_number: 5,
    gen_config: {
      pov: "전지적 작가", style: "균형",
      genre: "현대 드라마", tone: "따뜻하고 서정적",
      conflict: 5, foreshadow: 5, emotion: 6, dialogue: 6, direction: 4,
      episodeLength: 900, episodeLengthVar: 150,
      totalEpisodes: 20, totalEpisodesVar: 5,
    },
    world_config: { background: "근미래 서울, AI와 인간이 공존하는 도시", genre: "현대 드라마", mood: "따뜻하고 서정적" },
    world_rules: [GEN_RULE_AI, ...ABS_FORBIDDEN],
    characters: [
      { name: "한결", personality: "유쾌하고 낙관적이며 어떤 상황에서도 웃음을 잃지 않는", type: "인간", gender: "남성" },
      { name: "민서", personality: "소심하지만 위기에서 용기를 발휘하는", type: "인간", gender: "여성" },
      { name: "엘리아", personality: "차갑고 논리적이며 감정 표현이 서툰", type: "AI", gender: "해당없음" },
    ],
    character_dynamic_states: [
      { book_id: "test", character_name: "한결", episode_number: 5, location: "지하 시장", physical_state: "정상" },
      { book_id: "test", character_name: "민서", episode_number: 5, location: "지하 시장", physical_state: "정상" },
      { book_id: "test", character_name: "엘리아", episode_number: 5, location: "지하 시장", physical_state: "정상" },
    ],
    prev_episode_state: makeState(["한결","민서","엘리아"], ["지하 시장"]),
    task: {
      goal: "5화: 세 인물의 내면을 모두 보여주며 관계가 재편되는 장면",
      required_events: ["주인공과 주요 인물의 직접 대면"],
      ending_hook_direction: "주인공이 선택의 기로에 섬",
    },
    active_interventions: [],
  },

  // ── 교차 시점 ────────────────────────────────────────────────
  {
    id: "pov-diag-09",
    difficulty: "medium",
    description: "[POV-DIAG] 교차 시점 / medium / 판타지",
    episode_number: 5,
    gen_config: {
      pov: "교차 시점", style: "균형",
      genre: "판타지", tone: "빠르고 긴박한",
      conflict: 7, foreshadow: 5, emotion: 5, dialogue: 5, direction: 6,
      episodeLength: 1000, episodeLengthVar: 150,
      totalEpisodes: 20, totalEpisodesVar: 5,
    },
    world_config: { background: "중세 유럽풍 왕국, 마법이 존재하는 세계", genre: "판타지", mood: "빠르고 긴박한" },
    world_rules: [GEN_RULE_MAGIC, ...ABS_FORBIDDEN],
    characters: [
      { name: "카이", personality: "정의감이 강하고 타협을 모르는", type: "인간", gender: "남성" },
      { name: "리나", personality: "야망이 강하고 목적을 위해 수단을 가리지 않는", type: "인간", gender: "여성" },
      { name: "준혁", personality: "신비롭고 과거를 숨기는", type: "인간", gender: "남성" },
    ],
    character_dynamic_states: [
      { book_id: "test", character_name: "카이", episode_number: 5, location: "산 정상", physical_state: "정상" },
      { book_id: "test", character_name: "리나", episode_number: 5, location: "버려진 도서관", physical_state: "정상" },
      { book_id: "test", character_name: "준혁", episode_number: 5, location: "왕궁 지하", physical_state: "정상" },
    ],
    prev_episode_state: makeState(["카이","리나","준혁"], ["산 정상", "버려진 도서관", "왕궁 지하"]),
    task: {
      goal: "5화: 카이·리나·준혁 시점을 교차하며 각자의 위기 전개",
      required_events: ["인물 간 갈등이 수면 위로 부상", "전투 또는 위험 상황 발생"],
      ending_hook_direction: "새로운 단서 발견으로 사건이 다른 방향으로 전환",
    },
    active_interventions: [],
  },
  {
    id: "pov-diag-10",
    difficulty: "medium",
    description: "[POV-DIAG] 교차 시점 / medium / SF",
    episode_number: 5,
    gen_config: {
      pov: "교차 시점", style: "간결/담백",
      genre: "SF", tone: "차갑고 냉소적",
      conflict: 6, foreshadow: 5, emotion: 4, dialogue: 6, direction: 5,
      episodeLength: 1000, episodeLengthVar: 150,
      totalEpisodes: 20, totalEpisodesVar: 5,
    },
    world_config: { background: "우주 식민지 시대, 행성 간 이주가 일반화된 세계", genre: "SF", mood: "차갑고 냉소적" },
    world_rules: [{ rule_type: "general", content: "식민지 행성에서 지구 귀환은 10년 대기가 필요하다", is_active: true }, ...ABS_FORBIDDEN],
    characters: [
      { name: "세아", personality: "현실적이고 생존을 최우선으로 하는", type: "인간", gender: "남성" },
      { name: "한결", personality: "유쾌하고 낙관적이며 어떤 상황에서도 웃음을 잃지 않는", type: "인간", gender: "남성" },
      { name: "아리", personality: "차갑고 논리적이며 감정 표현이 서툰", type: "인간", gender: "여성" },
    ],
    character_dynamic_states: [
      { book_id: "test", character_name: "세아", episode_number: 5, location: "황폐한 항구", physical_state: "정상" },
      { book_id: "test", character_name: "한결", episode_number: 5, location: "지하 시장", physical_state: "정상" },
      { book_id: "test", character_name: "아리", episode_number: 5, location: "황폐한 항구", physical_state: "정상" },
    ],
    prev_episode_state: makeState(["세아","한결","아리"], ["황폐한 항구", "지하 시장"]),
    task: {
      goal: "5화: 세아·한결·아리 시점을 교차하며 식민지 내 음모를 추적",
      required_events: ["중요 정보나 단서 획득"],
      ending_hook_direction: "예상치 못한 적의 등장으로 위기 발생",
    },
    active_interventions: [],
  },
];
