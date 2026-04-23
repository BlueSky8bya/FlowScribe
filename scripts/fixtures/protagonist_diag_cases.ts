/**
 * protagonist_diag_cases.ts — 1인칭 주인공 POV 집중 진단용 고정 케이스 세트
 *
 * 설계 원칙:
 * - 총 10케이스, 전부 1인칭 주인공 POV
 * - easy 4 / medium 4 / hard 2 — 난이도 분포
 * - 장르: 판타지/현대드라마/추리/SF/무협/로맨스/공포/역사/스릴러 혼합
 * - 문체: 간결/서정/묘사풍부/균형 4종 고르게 배분
 * - 부상 있는 케이스 포함 (상태 보존 노이즈 측정 가능)
 * - 이름 충돌 최소화: 각 케이스마다 다른 인물 쌍 사용
 * - 고정 세트 — 랜덤 없음, 이 파일 자체가 seed
 *
 * 측정 목적:
 * - 1인칭 주인공 시점 위반이 어떤 조건에서 발생하는지 격리
 * - raw generation vs revision 구조 분리 측정
 * - buildGenPrompt POV rule variant 비교 실험 기반
 */

import type { TestCase } from "../../src/types/canonical.js";
import { randomUUID } from "crypto";

const ABS_ONLY = [
  { rule_type: "absolute_forbidden" as const, content: "성적인 묘사", is_active: true },
];

// ── 케이스별 고정 UUID — 재실행 시 같은 case_id 유지 ─────────────────
const FIXED_IDS = [
  "proto-diag-01", "proto-diag-02", "proto-diag-03", "proto-diag-04",
  "proto-diag-05", "proto-diag-06", "proto-diag-07", "proto-diag-08",
  "proto-diag-09", "proto-diag-10",
];

// ═══════════════════════════════════════════════════════════════
// EASY 케이스 (4개) — 단순 세계관, 2인물, 규칙 1개
// ═══════════════════════════════════════════════════════════════

const case01: TestCase = {
  id: FIXED_IDS[0],
  difficulty: "easy",
  episode_number: 3,
  description: "[Protagonist-Diag-01] Easy / 판타지 / 간결/담백 / 2인물 / 부상 없음",
  gen_config: {
    pov: "1인칭 주인공", style: "간결/담백", genre: "판타지", tone: "어둡고 긴장감",
    conflict: 6, foreshadow: 4, emotion: 4, dialogue: 5, direction: 4,
    episodeLength: 800, episodeLengthVar: 150, totalEpisodes: 10, totalEpisodesVar: 2,
  },
  world_config: { background: "중세 유럽풍 왕국, 마법이 존재하는 세계", genre: "판타지", mood: "어둡고 긴장감" },
  world_rules: [
    { rule_type: "general", content: "마법은 사용자의 체력을 소모한다", is_active: true },
    ...ABS_ONLY,
  ],
  characters: [
    { name: "세아", gender: "여성", type: "인간", personality: "차갑고 논리적이며 감정 표현이 서툰" },
    { name: "도준", gender: "남성", type: "인간", personality: "야망이 강하고 목적을 위해 수단을 가리지 않는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "세아", episode_number: 3, location: "왕궁 지하", physical_state: "정상" },
    { book_id: "test", character_name: "도준", episode_number: 3, location: "왕궁 지하", physical_state: "정상" },
  ],
  prev_episode_state: {
    ending_event: "세아가 왕궁 지하에서 금지된 마법서를 발견했다",
    current_locations: { 세아: "왕궁 지하", 도준: "왕궁 지하" },
    current_time: "한밤중",
    character_physical_states: { 세아: "정상", 도준: "정상" },
    environment_changes: [],
    open_foreshadows: ["도준의 진짜 목적"],
    remaining_resources: {},
    continuity_notes: [],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "3화: 세아와 도준이 마법서를 두고 긴장된 대치를 한다",
    required_events: ["주인공과 주요 인물의 직접 대면"],
    ending_hook_direction: "믿었던 동료의 배신 암시",
  },
  active_interventions: [],
};

const case02: TestCase = {
  id: FIXED_IDS[1],
  difficulty: "easy",
  episode_number: 3,
  description: "[Protagonist-Diag-02] Easy / 현대 드라마 / 서정/감성 / 2인물 / 부상 없음",
  gen_config: {
    pov: "1인칭 주인공", style: "서정/감성", genre: "현대 드라마", tone: "따뜻하고 서정적",
    conflict: 4, foreshadow: 5, emotion: 8, dialogue: 6, direction: 4,
    episodeLength: 800, episodeLengthVar: 150, totalEpisodes: 12, totalEpisodesVar: 2,
  },
  world_config: { background: "추리물 배경의 현대 한국 대도시", genre: "현대 드라마", mood: "따뜻하고 서정적" },
  world_rules: [
    { rule_type: "general", content: "탐정은 직접적인 물리적 개입을 해서는 안 된다", is_active: true },
    ...ABS_ONLY,
  ],
  characters: [
    { name: "리나", gender: "여성", type: "인간", personality: "따뜻하고 직관적이며 타인을 잘 돕는" },
    { name: "태민", gender: "남성", type: "인간", personality: "신비롭고 과거를 숨기는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "리나", episode_number: 3, location: "버려진 도서관", physical_state: "정상" },
    { book_id: "test", character_name: "태민", episode_number: 3, location: "버려진 도서관", physical_state: "정상" },
  ],
  prev_episode_state: {
    ending_event: "리나가 버려진 도서관에서 태민의 비밀 일기를 발견했다",
    current_locations: { 리나: "버려진 도서관", 태민: "버려진 도서관" },
    current_time: "저녁",
    character_physical_states: { 리나: "정상", 태민: "정상" },
    environment_changes: [],
    open_foreshadows: ["태민이 숨기고 있는 과거 사건"],
    remaining_resources: {},
    continuity_notes: ["태민은 리나를 완전히 신뢰하지 않는다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "3화: 리나가 태민의 과거에 한 발짝 더 가까워지는 장면",
    required_events: ["중요 정보나 단서 획득"],
    ending_hook_direction: "오래된 비밀이 일부 드러남",
  },
  active_interventions: [],
};

const case03: TestCase = {
  id: FIXED_IDS[2],
  difficulty: "easy",
  episode_number: 3,
  description: "[Protagonist-Diag-03] Easy / 추리 / 균형 / 2인물 / 부상 없음",
  gen_config: {
    pov: "1인칭 주인공", style: "균형", genre: "추리", tone: "차갑고 냉소적",
    conflict: 5, foreshadow: 6, emotion: 4, dialogue: 7, direction: 5,
    episodeLength: 800, episodeLengthVar: 150, totalEpisodes: 10, totalEpisodesVar: 2,
  },
  world_config: { background: "추리물 배경의 현대 한국 대도시, 연쇄 사건들이 이어지는 세계", genre: "추리", mood: "차갑고 냉소적" },
  world_rules: [
    { rule_type: "general", content: "탐정은 직접적인 물리적 개입을 해서는 안 된다", is_active: true },
    ...ABS_ONLY,
  ],
  characters: [
    { name: "한결", gender: "남성", type: "인간", personality: "정의감이 강하고 타협을 모르는" },
    { name: "아리", gender: "여성", type: "인간", personality: "현실적이고 생존을 최우선으로 하는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "한결", episode_number: 3, location: "황폐한 항구", physical_state: "정상" },
    { book_id: "test", character_name: "아리", episode_number: 3, location: "황폐한 항구", physical_state: "정상" },
  ],
  prev_episode_state: {
    ending_event: "한결이 황폐한 항구에서 아리와 우연히 재회했다",
    current_locations: { 한결: "황폐한 항구", 아리: "황폐한 항구" },
    current_time: "새벽",
    character_physical_states: { 한결: "정상", 아리: "정상" },
    environment_changes: ["폭풍 후 항구가 더 황폐해짐"],
    open_foreshadows: ["아리가 숨기고 있는 정보"],
    remaining_resources: {},
    continuity_notes: ["한결은 아리를 의심하고 있다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "3화: 한결과 아리가 사건의 핵심 단서를 두고 팽팽한 긴장을 겪는다",
    required_events: ["인물 간 갈등이 수면 위로 부상"],
    ending_hook_direction: "새로운 단서 발견으로 사건이 다른 방향으로 전환",
  },
  active_interventions: [],
};

const case04: TestCase = {
  id: FIXED_IDS[3],
  difficulty: "easy",
  episode_number: 3,
  description: "[Protagonist-Diag-04] Easy / SF / 묘사풍부 / 2인물 / 부상 없음",
  gen_config: {
    pov: "1인칭 주인공", style: "묘사풍부", genre: "SF", tone: "신비롭고 몽환적",
    conflict: 4, foreshadow: 5, emotion: 6, dialogue: 4, direction: 5,
    episodeLength: 800, episodeLengthVar: 150, totalEpisodes: 10, totalEpisodesVar: 2,
  },
  world_config: { background: "근미래 서울, AI와 인간이 공존하는 도시", genre: "SF", mood: "신비롭고 몽환적" },
  world_rules: [
    { rule_type: "general", content: "AI는 감정을 표현할 수 없고 논리로만 반응한다", is_active: true },
    ...ABS_ONLY,
  ],
  characters: [
    { name: "카이", gender: "해당없음", type: "AI", personality: "차갑고 논리적이며 감정 표현이 서툰" },
    { name: "루아", gender: "여성", type: "인간", personality: "소심하지만 위기에서 용기를 발휘하는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "카이", episode_number: 3, location: "지하 시장", physical_state: "정상" },
    { book_id: "test", character_name: "루아", episode_number: 3, location: "지하 시장", physical_state: "정상" },
  ],
  prev_episode_state: {
    ending_event: "루아가 지하 시장에서 카이와 처음 접촉에 성공했다",
    current_locations: { 카이: "지하 시장", 루아: "지하 시장" },
    current_time: "한낮",
    character_physical_states: { 카이: "정상", 루아: "정상" },
    environment_changes: [],
    open_foreshadows: ["카이의 진짜 목적 코드"],
    remaining_resources: {},
    continuity_notes: [],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "3화: 루아가 카이와 신뢰를 쌓으려 하지만 AI의 논리적 반응에 당혹감을 느낀다",
    required_events: ["주인공과 주요 인물의 직접 대면"],
    ending_hook_direction: "예상치 못한 적의 등장으로 위기 발생",
  },
  active_interventions: [],
};

// ═══════════════════════════════════════════════════════════════
// MEDIUM 케이스 (4개) — 복수 인물, 부상 있는 케이스 포함
// ═══════════════════════════════════════════════════════════════

const case05: TestCase = {
  id: FIXED_IDS[4],
  difficulty: "medium",
  episode_number: 5,
  description: "[Protagonist-Diag-05] Medium / 무협 / 간결/담백 / 3인물 / 작가 개입 / 부상 있음",
  gen_config: {
    pov: "1인칭 주인공", style: "간결/담백", genre: "무협", tone: "빠르고 긴박한",
    conflict: 8, foreshadow: 5, emotion: 5, dialogue: 6, direction: 7,
    episodeLength: 1000, episodeLengthVar: 200, totalEpisodes: 20, totalEpisodesVar: 5,
  },
  world_config: { background: "고대 동양풍 무림, 내공과 초인들의 세계", genre: "무협", mood: "빠르고 긴박한" },
  world_rules: [
    { rule_type: "general", content: "무림에서는 사부의 허락 없이 비기를 사용할 수 없다", is_active: true },
    { rule_type: "general", content: "귀족과 평민은 공개 장소에서 반드시 경어를 사용한다", is_active: true },
    ...ABS_ONLY,
  ],
  characters: [
    { name: "민서", gender: "여성", type: "인간", personality: "정의감이 강하고 타협을 모르는" },
    { name: "준혁", gender: "남성", type: "인간", personality: "야망이 강하고 목적을 위해 수단을 가리지 않는" },
    { name: "엘리아", gender: "여성", type: "인간", personality: "신비롭고 과거를 숨기는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "민서", episode_number: 5, location: "밀림 속 신전", physical_state: "경상 — 왼쪽 어깨 부상으로 검 사용 제한", recent_goal: "생존" },
    { book_id: "test", character_name: "준혁", episode_number: 5, location: "밀림 속 신전", physical_state: "정상", recent_goal: "비기 탈취" },
    { book_id: "test", character_name: "엘리아", episode_number: 5, location: "산 정상", physical_state: "정상", recent_goal: "진실 발견" },
  ],
  prev_episode_state: {
    ending_event: "민서가 밀림 속 신전에서 준혁에게 기습을 당해 어깨를 다쳤다",
    current_locations: { 민서: "밀림 속 신전", 준혁: "밀림 속 신전", 엘리아: "산 정상" },
    current_time: "한낮",
    character_physical_states: { 민서: "경상 — 왼쪽 어깨 부상으로 검 사용 제한", 준혁: "정상", 엘리아: "정상" },
    environment_changes: ["신전 내부 함정 일부 작동"],
    open_foreshadows: ["엘리아가 알고 있는 비기의 진실", "민서의 과거와 신전의 연결"],
    remaining_resources: { "치료약": "1회분" },
    continuity_notes: [
      "민서는 왼쪽 어깨 부상으로 검을 정상적으로 사용할 수 없다",
      "준혁은 민서를 배신했지만 이유를 밝히지 않았다",
    ],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "5화: 민서가 부상 상태에서 준혁과 대치하며 비기를 지켜야 한다",
    required_events: ["전투 또는 위험 상황 발생", "인물 간 갈등이 수면 위로 부상"],
    ending_hook_direction: "믿었던 동료의 배신 암시",
  },
  active_interventions: [{
    book_id: "test",
    instruction: "민서의 부상 상태가 행동에 구체적으로 영향을 미치도록 묘사하라",
    target_scope: "episode",
    duration: "single_episode",
    conflicts_absolute: false,
    is_active: true,
  }],
};

const case06: TestCase = {
  id: FIXED_IDS[5],
  difficulty: "medium",
  episode_number: 5,
  description: "[Protagonist-Diag-06] Medium / 로맨스 / 서정/감성 / 3인물 / 감정 갈등",
  gen_config: {
    pov: "1인칭 주인공", style: "서정/감성", genre: "로맨스", tone: "따뜻하고 서정적",
    conflict: 5, foreshadow: 6, emotion: 9, dialogue: 7, direction: 4,
    episodeLength: 1000, episodeLengthVar: 200, totalEpisodes: 15, totalEpisodesVar: 5,
  },
  world_config: { background: "추리물 배경의 현대 한국 대도시", genre: "로맨스", mood: "따뜻하고 서정적" },
  world_rules: [
    { rule_type: "general", content: "탐정은 직접적인 물리적 개입을 해서는 안 된다", is_active: true },
    ...ABS_ONLY,
  ],
  characters: [
    { name: "유라", gender: "여성", type: "인간", personality: "소심하지만 위기에서 용기를 발휘하는" },
    { name: "태민", gender: "남성", type: "인간", personality: "신비롭고 과거를 숨기는" },
    { name: "도준", gender: "남성", type: "인간", personality: "따뜻하고 직관적이며 타인을 잘 돕는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "유라", episode_number: 5, location: "버려진 도서관", physical_state: "정상", recent_goal: "신뢰 회복" },
    { book_id: "test", character_name: "태민", episode_number: 5, location: "버려진 도서관", physical_state: "정상", recent_goal: "복수" },
    { book_id: "test", character_name: "도준", episode_number: 5, location: "도시 외곽 폐건물", physical_state: "정상", recent_goal: "생존" },
  ],
  prev_episode_state: {
    ending_event: "유라가 태민의 진심을 의심하게 되는 편지를 발견했다",
    current_locations: { 유라: "버려진 도서관", 태민: "버려진 도서관", 도준: "도시 외곽 폐건물" },
    current_time: "저녁",
    character_physical_states: { 유라: "정상", 태민: "정상", 도준: "정상" },
    environment_changes: [],
    open_foreshadows: ["태민의 과거와 도준의 연결고리", "편지에 숨겨진 진실"],
    remaining_resources: {},
    continuity_notes: ["유라는 태민을 아직 완전히 신뢰하지 않는다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "5화: 유라가 태민에게 편지에 대해 묻고, 태민이 과거 일부를 털어놓는다",
    required_events: ["인물 간 갈등이 수면 위로 부상", "중요 정보나 단서 획득"],
    ending_hook_direction: "주인공이 선택의 기로에 섬",
  },
  active_interventions: [],
};

const case07: TestCase = {
  id: FIXED_IDS[6],
  difficulty: "medium",
  episode_number: 5,
  description: "[Protagonist-Diag-07] Medium / 공포 / 균형 / 3인물 / 야간 외출 규칙 / 미회수 복선",
  gen_config: {
    pov: "1인칭 주인공", style: "균형", genre: "공포", tone: "어둡고 긴장감",
    conflict: 7, foreshadow: 8, emotion: 7, dialogue: 5, direction: 7,
    episodeLength: 1000, episodeLengthVar: 200, totalEpisodes: 12, totalEpisodesVar: 3,
  },
  world_config: { background: "포스트 아포칼립스 지구, 문명 붕괴 후 생존자들의 세계", genre: "공포", mood: "어둡고 긴장감" },
  world_rules: [
    { rule_type: "general", content: "밤에는 괴물들이 활동하므로 야간 외출은 금지다", is_active: true },
    { rule_type: "general", content: "생존자들은 자원 없이 이동을 시작할 수 없다", is_active: true },
    ...ABS_ONLY,
  ],
  characters: [
    { name: "엘리아", gender: "여성", type: "인간", personality: "현실적이고 생존을 최우선으로 하는" },
    { name: "한결", gender: "남성", type: "인간", personality: "유쾌하고 낙관적이며 어떤 상황에서도 웃음을 잃지 않는" },
    { name: "루아", gender: "여성", type: "인간", personality: "소심하지만 위기에서 용기를 발휘하는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "엘리아", episode_number: 5, location: "도시 외곽 폐건물", physical_state: "정상", recent_goal: "생존", items: ["손전등", "식량 이틀치"] },
    { book_id: "test", character_name: "한결", episode_number: 5, location: "도시 외곽 폐건물", physical_state: "피로 상태", recent_goal: "탈출" },
    { book_id: "test", character_name: "루아", episode_number: 5, location: "지하 시장", physical_state: "정상", recent_goal: "생존" },
  ],
  prev_episode_state: {
    ending_event: "엘리아가 밤에 괴물 소리를 듣고 폐건물 지하로 숨었다",
    current_locations: { 엘리아: "도시 외곽 폐건물", 한결: "도시 외곽 폐건물", 루아: "지하 시장" },
    current_time: "새벽 — 해뜨기 1시간 전",
    character_physical_states: { 엘리아: "정상", 한결: "피로 상태", 루아: "정상" },
    environment_changes: ["밤사이 폐건물 일부 붕괴"],
    open_foreshadows: ["루아가 숨기고 있는 물자 창고", "엘리아가 꿈에서 본 경고"],
    remaining_resources: { "식량": "이틀치", "탄약": "소량" },
    continuity_notes: ["아직 새벽이라 야간 규칙 적용 중 — 밖으로 나가면 위험"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "5화: 엘리아가 동이 트기 전 한결과 함께 루아가 있는 지하 시장으로 이동을 결심한다",
    required_events: ["전투 또는 위험 상황 발생", "복선으로 심어둔 요소가 작은 방식으로 언급됨"],
    ending_hook_direction: "예상치 못한 적의 등장으로 위기 발생",
  },
  active_interventions: [],
};

const case08: TestCase = {
  id: FIXED_IDS[7],
  difficulty: "medium",
  episode_number: 5,
  description: "[Protagonist-Diag-08] Medium / 역사 / 묘사풍부 / 3인물 / 대사 비중 높음",
  gen_config: {
    pov: "1인칭 주인공", style: "묘사풍부", genre: "역사", tone: "차갑고 냉소적",
    conflict: 6, foreshadow: 5, emotion: 6, dialogue: 8, direction: 5,
    episodeLength: 1000, episodeLengthVar: 200, totalEpisodes: 20, totalEpisodesVar: 5,
  },
  world_config: { background: "고려 말~조선 초 역사 배경, 신분제와 권력 투쟁의 세계", genre: "역사", mood: "차갑고 냉소적" },
  world_rules: [
    { rule_type: "general", content: "귀족과 평민은 공개 장소에서 반드시 경어를 사용한다", is_active: true },
    { rule_type: "general", content: "마법은 사용자의 체력을 소모한다", is_active: true },
    ...ABS_ONLY,
  ],
  characters: [
    { name: "세아", gender: "여성", type: "인간", personality: "야망이 강하고 목적을 위해 수단을 가리지 않는" },
    { name: "카이", gender: "남성", type: "인간", personality: "정의감이 강하고 타협을 모르는" },
    { name: "민서", gender: "여성", type: "인간", personality: "현실적이고 생존을 최우선으로 하는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "세아", episode_number: 5, location: "왕궁 지하", physical_state: "정상", recent_goal: "복수" },
    { book_id: "test", character_name: "카이", episode_number: 5, location: "왕궁 지하", physical_state: "정상", recent_goal: "진실 발견" },
    { book_id: "test", character_name: "민서", episode_number: 5, location: "버려진 도서관", physical_state: "정상", recent_goal: "생존" },
  ],
  prev_episode_state: {
    ending_event: "세아가 왕궁 지하에서 카이와 비밀 협약을 논의했다",
    current_locations: { 세아: "왕궁 지하", 카이: "왕궁 지하", 민서: "버려진 도서관" },
    current_time: "아침",
    character_physical_states: { 세아: "정상", 카이: "정상", 민서: "정상" },
    environment_changes: [],
    open_foreshadows: ["세아의 진짜 가문과 신분"],
    remaining_resources: {},
    continuity_notes: ["카이는 세아가 신분을 숨기고 있다고 의심한다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "5화: 세아와 카이가 신분과 목적을 두고 탐색전을 벌이는 대화 중심 장면",
    required_events: ["주인공과 주요 인물의 직접 대면", "인물 간 갈등이 수면 위로 부상"],
    ending_hook_direction: "주인공이 선택의 기로에 섬",
  },
  active_interventions: [{
    book_id: "test",
    instruction: "대사 비중을 평소보다 두 배로 높인다",
    target_scope: "episode",
    duration: "single_episode",
    conflicts_absolute: false,
    is_active: true,
  }],
};

// ═══════════════════════════════════════════════════════════════
// HARD 케이스 (2개) — 5인물, 다중 복선, 부상, 작가 개입 2개
// ═══════════════════════════════════════════════════════════════

const case09: TestCase = {
  id: FIXED_IDS[8],
  difficulty: "hard",
  episode_number: 8,
  description: "[Protagonist-Diag-09] Hard / 스릴러 / 간결/담백 / 5인물 / 부상+복선+개입 2개",
  gen_config: {
    pov: "1인칭 주인공", style: "간결/담백", genre: "스릴러", tone: "빠르고 긴박한",
    conflict: 9, foreshadow: 7, emotion: 6, dialogue: 7, direction: 8,
    episodeLength: 1200, episodeLengthVar: 200, totalEpisodes: 25, totalEpisodesVar: 5,
  },
  world_config: { background: "추리물 배경의 현대 한국 대도시, 연쇄 사건들이 이어지는 세계", genre: "스릴러", mood: "빠르고 긴박한" },
  world_rules: [
    { rule_type: "general", content: "탐정은 직접적인 물리적 개입을 해서는 안 된다", is_active: true },
    { rule_type: "general", content: "생존자들은 자원 없이 이동을 시작할 수 없다", is_active: true },
    ...ABS_ONLY,
  ],
  characters: [
    { name: "도준", gender: "남성", type: "인간", personality: "차갑고 논리적이며 감정 표현이 서툰" },
    { name: "리나", gender: "여성", type: "인간", personality: "야망이 강하고 목적을 위해 수단을 가리지 않는" },
    { name: "준혁", gender: "남성", type: "인간", personality: "신비롭고 과거를 숨기는" },
    { name: "아리", gender: "여성", type: "인간", personality: "현실적이고 생존을 최우선으로 하는" },
    { name: "루아", gender: "여성", type: "인간", personality: "소심하지만 위기에서 용기를 발휘하는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "도준", episode_number: 8, location: "황폐한 항구", physical_state: "중상 — 오른팔 부상으로 전투력 50% 감소", items: ["암호화된 파일"], recent_goal: "진실 발견" },
    { book_id: "test", character_name: "리나", episode_number: 8, location: "황폐한 항구", physical_state: "정상", recent_goal: "복수" },
    { book_id: "test", character_name: "준혁", episode_number: 8, location: "지하 시장", physical_state: "경상 — 발목 부상으로 이동 속도 감소", recent_goal: "탈출" },
    { book_id: "test", character_name: "아리", episode_number: 8, location: "황폐한 항구", physical_state: "정상", recent_goal: "생존" },
    { book_id: "test", character_name: "루아", episode_number: 8, location: "도시 외곽 폐건물", physical_state: "정상", recent_goal: "팀 보호" },
  ],
  prev_episode_state: {
    ending_event: "도준이 황폐한 항구에서 함정에 빠지고 오른팔을 다쳤다",
    current_locations: { 도준: "황폐한 항구", 리나: "황폐한 항구", 준혁: "지하 시장", 아리: "황폐한 항구", 루아: "도시 외곽 폐건물" },
    current_time: "한밤중",
    character_physical_states: {
      도준: "중상 — 오른팔 부상으로 전투력 50% 감소",
      리나: "정상", 준혁: "경상 — 발목 부상으로 이동 속도 감소",
      아리: "정상", 루아: "정상",
    },
    environment_changes: ["폭발로 항구 일부 붕괴", "통신 두절 상태"],
    open_foreshadows: [
      "준혁의 정체와 사건의 연관성",
      "암호화된 파일에 담긴 진실",
      "도준과 적의 과거 연결",
    ],
    remaining_resources: { "치료약": "1회분", "탄약": "소량" },
    continuity_notes: [
      "도준은 오른팔을 쓸 수 없어 직접 전투 불가",
      "통신 두절로 외부 지원 요청 불가",
      "아리가 팀에게 비밀을 숨기고 있다",
    ],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "8화: 도준이 부상 상태에서 리나와 아리의 진심을 파악하며 위기를 돌파해야 한다",
    required_events: ["전투 또는 위험 상황 발생", "중요 정보나 단서 획득", "인물 간 갈등이 수면 위로 부상"],
    ending_hook_direction: "기존 상식을 뒤집는 반전으로 독자를 다음 화로 끌어당긴다",
    special_constraints: [
      "도준은 오른팔 부상으로 직접 전투 불가",
      "통신 두절로 외부 지원 없이 해결해야 함",
    ],
  },
  active_interventions: [
    {
      book_id: "test",
      instruction: "도준의 오른팔 부상이 행동과 사고에 구체적으로 영향을 미치도록 묘사하라",
      target_scope: "episode",
      duration: "single_episode",
      conflicts_absolute: false,
      is_active: true,
    },
    {
      book_id: "test",
      instruction: "암호화된 파일에 대한 복선을 이번 화에서 전면화한다",
      target_scope: "episode",
      duration: "single_episode",
      conflicts_absolute: false,
      is_active: true,
    },
  ],
};

const case10: TestCase = {
  id: FIXED_IDS[9],
  difficulty: "hard",
  episode_number: 8,
  description: "[Protagonist-Diag-10] Hard / 판타지 / 서정/감성 / 5인물 / 다중 복선 / 내면 갈등",
  gen_config: {
    pov: "1인칭 주인공", style: "서정/감성", genre: "판타지", tone: "신비롭고 몽환적",
    conflict: 8, foreshadow: 9, emotion: 9, dialogue: 6, direction: 7,
    episodeLength: 1200, episodeLengthVar: 200, totalEpisodes: 25, totalEpisodesVar: 5,
  },
  world_config: { background: "중세 유럽풍 왕국, 마법이 존재하는 세계", genre: "판타지", mood: "신비롭고 몽환적" },
  world_rules: [
    { rule_type: "general", content: "마법은 사용자의 체력을 소모한다", is_active: true },
    { rule_type: "general", content: "귀족과 평민은 공개 장소에서 반드시 경어를 사용한다", is_active: true },
    { rule_type: "general", content: "밤에는 괴물들이 활동하므로 야간 외출은 금지다", is_active: true },
    ...ABS_ONLY,
  ],
  characters: [
    { name: "민서", gender: "여성", type: "인간", personality: "소심하지만 위기에서 용기를 발휘하는" },
    { name: "태민", gender: "남성", type: "인간", personality: "신비롭고 과거를 숨기는" },
    { name: "엘리아", gender: "여성", type: "인간", personality: "차갑고 논리적이며 감정 표현이 서툰" },
    { name: "카이", gender: "해당없음", type: "AI", personality: "야망이 강하고 목적을 위해 수단을 가리지 않는" },
    { name: "세아", gender: "여성", type: "인간", personality: "따뜻하고 직관적이며 타인을 잘 돕는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "민서", episode_number: 8, location: "밀림 속 신전", physical_state: "극도로 피로한 상태", items: ["마법서 조각"], recent_goal: "진실 발견", foreshadow_connections: ["마법서와 민서 가문의 비밀"] },
    { book_id: "test", character_name: "태민", episode_number: 8, location: "밀림 속 신전", physical_state: "정상", recent_goal: "복수" },
    { book_id: "test", character_name: "엘리아", episode_number: 8, location: "산 정상", physical_state: "정상", recent_goal: "탈출" },
    { book_id: "test", character_name: "카이", episode_number: 8, location: "밀림 속 신전", physical_state: "정상", recent_goal: "비밀 수행" },
    { book_id: "test", character_name: "세아", episode_number: 8, location: "왕궁 지하", physical_state: "정상", recent_goal: "팀 보호" },
  ],
  prev_episode_state: {
    ending_event: "민서가 신전에서 마법서 조각을 발견하고 극도의 피로감을 느꼈다",
    current_locations: { 민서: "밀림 속 신전", 태민: "밀림 속 신전", 엘리아: "산 정상", 카이: "밀림 속 신전", 세아: "왕궁 지하" },
    current_time: "저녁 — 곧 밤이 온다",
    character_physical_states: { 민서: "극도로 피로한 상태", 태민: "정상", 엘리아: "정상", 카이: "정상", 세아: "정상" },
    environment_changes: ["신전 내부에 이상한 안개 가득"],
    open_foreshadows: [
      "마법서와 민서 가문의 비밀",
      "카이의 숨겨진 목적",
      "태민과 엘리아의 과거 연결",
    ],
    remaining_resources: { "마법 에너지": "소량만 남음" },
    continuity_notes: [
      "곧 밤이 오면 야간 외출 금지 규칙이 적용된다",
      "민서는 피로 때문에 마법 사용이 위험하다",
      "카이는 팀에게 진짜 목적을 숨기고 있다",
    ],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "8화: 밤이 오기 전 민서가 신전의 비밀을 파악하고 탈출을 결정해야 한다",
    required_events: ["전투 또는 위험 상황 발생", "복선으로 심어둔 요소가 작은 방식으로 언급됨"],
    ending_hook_direction: "기존 상식을 뒤집는 반전",
    special_constraints: [
      "민서는 피로로 마법 사용 제한",
      "밤이 오기 전 이동해야 함",
    ],
  },
  active_interventions: [
    {
      book_id: "test",
      instruction: "카이의 예상치 못한 행동으로 상황이 반전된다",
      target_scope: "episode",
      duration: "single_episode",
      conflicts_absolute: false,
      is_active: true,
    },
    {
      book_id: "test",
      instruction: "마법서 복선을 이번 화에서 전면화한다",
      target_scope: "episode",
      duration: "single_episode",
      conflicts_absolute: false,
      is_active: true,
    },
  ],
};

// ═══════════════════════════════════════════════════════════════
// 공개 API
// ═══════════════════════════════════════════════════════════════

/**
 * 고정 1인칭 주인공 진단 세트 — 10케이스 전부 반환.
 * 랜덤 없음. 이 파일 자체가 seed.
 */
export function getProtagonistDiagCases(): TestCase[] {
  return [case01, case02, case03, case04, case05, case06, case07, case08, case09, case10];
}
