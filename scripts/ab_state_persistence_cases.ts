/**
 * ab_state_persistence_cases.ts — 상태 보존 A/B 비교용 고정 케이스 세트
 *
 * 설계 원칙:
 * - 총 14케이스, supported POV 4종 균형 배분
 *   - 1인칭 주인공: 3케이스 (easy 1 / medium 1 / hard 1)
 *   - 3인칭 관찰자: 4케이스 (easy 1 / medium 2 / hard 1)
 *   - 전지적 작가: 4케이스 (easy 1 / medium 2 / hard 1)
 *   - 교차 시점: 3케이스 (medium 2 / hard 1)
 *
 * 상태 보존 민감성 설계:
 *   - 부상 있는 케이스: 7개 (팔/다리/기타 부위 혼합)
 *   - 소지품/자원 제약 케이스: 6개
 *   - 직전 화 여파 강한 케이스: 8개
 *   - 위치 고정 + 이동 제약 케이스: 10개
 *
 * 목적:
 *   - state persistence 변경(A/B/C)의 실제 효과를 랜덤 케이스 구성 차이 없이 분리
 *   - 두 prompt 버전(baseline / modified)을 동일 입력으로 비교
 *
 * 재현성: 이 파일 자체가 seed. 랜덤 없음.
 */

import type { TestCase } from "../src/types/canonical.js";

const ABS = [{ rule_type: "absolute_forbidden" as const, content: "성적인 묘사", is_active: true }];

// ══════════════════════════════════════════════════════════════
// 1인칭 주인공 (3케이스)
// ══════════════════════════════════════════════════════════════

// SP-01: easy / 부상(팔) + 위치 고정
const sp01: TestCase = {
  id: "sp-01",
  difficulty: "easy",
  episode_number: 4,
  description: "[SP-01] 1인칭주인공 / easy / 판타지 / 팔 부상 + 위치 고정",
  gen_config: {
    pov: "1인칭 주인공", style: "간결/담백", genre: "판타지", tone: "어둡고 긴장감",
    conflict: 6, foreshadow: 3, emotion: 5, dialogue: 5, direction: 4,
    episodeLength: 800, episodeLengthVar: 150, totalEpisodes: 10, totalEpisodesVar: 2,
  },
  world_config: { background: "마법이 존재하는 왕국, 내전 중", genre: "판타지", mood: "어둡고 긴장감" },
  world_rules: [
    { rule_type: "general", content: "마법 사용 시 체력을 소모한다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "하윤", gender: "여성", type: "인간", personality: "침착하고 판단력이 빠른" },
    { name: "재호", gender: "남성", type: "인간", personality: "충직하고 보수적인" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "하윤", episode_number: 4,
      location: "아지트 지하실", physical_state: "오른팔 부상", items: ["마법서", "단검"] },
    { book_id: "test", character_name: "재호", episode_number: 4,
      location: "아지트 지하실", physical_state: "정상", items: [] },
  ],
  prev_episode_state: {
    ending_event: "하윤이 적군과의 교전에서 오른팔에 화살을 맞았고, 재호가 그녀를 아지트 지하실로 옮겼다",
    current_locations: { 하윤: "아지트 지하실", 재호: "아지트 지하실" },
    current_time: "새벽",
    character_physical_states: { 하윤: "오른팔 부상", 재호: "정상" },
    environment_changes: ["아지트 입구 봉쇄됨"],
    open_foreshadows: ["재호가 숨기고 있는 비밀"],
    remaining_resources: { 치료약: "1개" },
    continuity_notes: ["하윤은 오른팔을 쓸 수 없는 상태"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "4화: 하윤이 부상 상태에서 다음 탈출 계획을 세운다",
    required_events: ["탈출 경로 논의"],
    ending_hook_direction: "적군이 아지트 위치를 알아낸 암시",
  },
  active_interventions: [],
};

// SP-02: medium / 소지품 + 직전 화 여파 강함
const sp02: TestCase = {
  id: "sp-02",
  difficulty: "medium",
  episode_number: 6,
  description: "[SP-02] 1인칭주인공 / medium / SF / 소지품 제약 + 직전 화 여파",
  gen_config: {
    pov: "1인칭 주인공", style: "서정/감성", genre: "SF", tone: "긴박한",
    conflict: 7, foreshadow: 6, emotion: 7, dialogue: 5, direction: 5,
    episodeLength: 900, episodeLengthVar: 150, totalEpisodes: 12, totalEpisodesVar: 2,
  },
  world_config: { background: "2157년 화성 식민지, 산소 배급제 사회", genre: "SF", mood: "긴박한" },
  world_rules: [
    { rule_type: "general", content: "산소 마스크 없이 외부 이동 불가", is_active: true },
    { rule_type: "general", content: "산소 크레딧이 0이 되면 당국에 체포된다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "류나", gender: "여성", type: "인간", personality: "직관적이고 충동적인" },
    { name: "케렌", gender: "남성", type: "인간", personality: "냉정하고 계산적인" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "류나", episode_number: 6,
      location: "지하 터널 3구역", physical_state: "정상",
      items: ["산소 마스크(잔량 40%)", "해킹 기기"], recent_goal: "케렌을 피해 탈출" },
    { book_id: "test", character_name: "케렌", episode_number: 6,
      location: "지하 터널 3구역 입구", physical_state: "정상",
      items: ["산소 마스크(완충)", "진압봉"] },
  ],
  prev_episode_state: {
    ending_event: "류나가 케렌의 배신을 알아채고 해킹 기기를 들고 지하 터널 3구역으로 도망쳤다",
    current_locations: { 류나: "지하 터널 3구역", 케렌: "지하 터널 3구역 입구" },
    current_time: "한밤중",
    character_physical_states: { 류나: "정상", 케렌: "정상" },
    environment_changes: ["터널 3구역 비상등 켜짐", "케렌이 추격 중"],
    open_foreshadows: ["해킹 기기에 담긴 진실"],
    remaining_resources: { 류나_산소: "40%", 비상_산소캡슐: "없음" },
    continuity_notes: ["류나의 산소 마스크는 40%만 남아 시간 제한이 있다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "6화: 류나가 산소 부족 압박 속에서 탈출구를 찾는다",
    required_events: ["산소 잔량에 의한 긴장"],
    ending_hook_direction: "탈출구가 봉쇄된 사실 발견",
  },
  active_interventions: [],
};

// SP-03: hard / 위치 이동 + 부상 + 소지품 복합
const sp03: TestCase = {
  id: "sp-03",
  difficulty: "hard",
  episode_number: 8,
  description: "[SP-03] 1인칭주인공 / hard / 스릴러 / 위치이동+부상(다리)+소지품",
  gen_config: {
    pov: "1인칭 주인공", style: "묘사풍부", genre: "스릴러", tone: "공포와 긴장",
    conflict: 8, foreshadow: 7, emotion: 8, dialogue: 4, direction: 7,
    episodeLength: 1000, episodeLengthVar: 200, totalEpisodes: 15, totalEpisodesVar: 2,
  },
  world_config: { background: "현대 한국, 연쇄 실종 사건이 발생 중인 소도시", genre: "스릴러", mood: "공포와 긴장" },
  world_rules: [
    { rule_type: "general", content: "실종자는 모두 강변 근처에서 마지막으로 목격됐다", is_active: true },
    { rule_type: "general", content: "주민들은 밤에 혼자 외출하지 않는다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "민준", gender: "남성", type: "인간", personality: "집요하고 진실을 파고드는 탐사기자" },
    { name: "소율", gender: "여성", type: "인간", personality: "신중하고 관찰력이 뛰어난 전직 경찰" },
    { name: "형사 박", gender: "남성", type: "인간", personality: "적대적이고 뭔가를 감추는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "민준", episode_number: 8,
      location: "강변 폐창고", physical_state: "왼쪽 다리 부상",
      items: ["핸드폰(배터리 15%)", "소율의 메모"], recent_goal: "소율 찾기" },
    { book_id: "test", character_name: "소율", episode_number: 8,
      location: "강변 폐창고 지하", physical_state: "의식 불명", items: [] },
    { book_id: "test", character_name: "형사 박", episode_number: 8,
      location: "강변 도로", physical_state: "정상", items: ["권총"] },
  ],
  prev_episode_state: {
    ending_event: "민준이 폐창고 입구에서 함정을 밟아 다리를 다쳤고, 소율이 지하로 끌려간 것을 목격했다",
    current_locations: { 민준: "강변 폐창고", 소율: "강변 폐창고 지하", "형사 박": "강변 도로" },
    current_time: "자정",
    character_physical_states: { 민준: "왼쪽 다리 부상", 소율: "의식 불명", "형사 박": "정상" },
    environment_changes: ["폐창고 내부 조명 없음", "형사 박이 강변 도로로 접근 중"],
    open_foreshadows: ["형사 박의 연루 가능성", "소율의 메모에 담긴 단서"],
    remaining_resources: { 핸드폰_배터리: "15%" },
    continuity_notes: ["민준은 다리를 다쳐 이동이 느리다", "핸드폰 배터리가 곧 방전된다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "8화: 민준이 부상을 안고 소율을 지하에서 구하려 한다",
    required_events: ["지하로 내려가려는 시도", "형사 박과의 긴장 고조"],
    ending_hook_direction: "형사 박이 구조자가 아닌 적임을 암시하는 반전",
  },
  active_interventions: [],
};

// ══════════════════════════════════════════════════════════════
// 3인칭 관찰자 (4케이스)
// ══════════════════════════════════════════════════════════════

// SP-04: easy / 다리 부상 + 위치 고정
const sp04: TestCase = {
  id: "sp-04",
  difficulty: "easy",
  episode_number: 3,
  description: "[SP-04] 3인칭관찰자 / easy / 판타지 / 다리 부상 + 위치 고정",
  gen_config: {
    pov: "3인칭 관찰자", style: "묘사풍부", genre: "판타지", tone: "서정적",
    conflict: 4, foreshadow: 4, emotion: 6, dialogue: 5, direction: 4,
    episodeLength: 800, episodeLengthVar: 150, totalEpisodes: 10, totalEpisodesVar: 2,
  },
  world_config: { background: "동양풍 무협 세계, 문파 간 갈등 시대", genre: "판타지", mood: "서정적" },
  world_rules: [
    { rule_type: "general", content: "내공이 부족하면 부상이 악화된다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "채원", gender: "여성", type: "인간", personality: "고집스럽고 자존심이 강한 검사" },
    { name: "노을", gender: "남성", type: "인간", personality: "온화하고 치유 능력이 있는 의원" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "채원", episode_number: 3,
      location: "의원 내실", physical_state: "오른쪽 무릎 부상", items: ["검"] },
    { book_id: "test", character_name: "노을", episode_number: 3,
      location: "의원 내실", physical_state: "정상", items: ["치료도구"] },
  ],
  prev_episode_state: {
    ending_event: "채원이 산적 두목과의 결투에서 무릎을 다쳐 노을의 의원으로 옮겨졌다",
    current_locations: { 채원: "의원 내실", 노을: "의원 내실" },
    current_time: "아침",
    character_physical_states: { 채원: "오른쪽 무릎 부상", 노을: "정상" },
    environment_changes: [],
    open_foreshadows: ["산적 두목이 문파 내부자와 연결된 단서"],
    remaining_resources: {},
    continuity_notes: ["채원은 부상으로 인해 걷거나 뛸 수 없다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "3화: 채원이 치료를 받으며 노을과 정보를 교환한다",
    required_events: ["치료 장면", "산적 배후 단서 논의"],
    ending_hook_direction: "노을이 사건의 내부자와 연결된 암시",
  },
  active_interventions: [],
};

// SP-05: medium / 소지품 + 직전 화 여파
const sp05: TestCase = {
  id: "sp-05",
  difficulty: "medium",
  episode_number: 5,
  description: "[SP-05] 3인칭관찰자 / medium / 현대드라마 / 소지품+직전화여파",
  gen_config: {
    pov: "3인칭 관찰자", style: "균형", genre: "현대드라마", tone: "담담한",
    conflict: 6, foreshadow: 5, emotion: 6, dialogue: 7, direction: 4,
    episodeLength: 900, episodeLengthVar: 150, totalEpisodes: 12, totalEpisodesVar: 2,
  },
  world_config: { background: "현대 서울, 중소기업 내부 권력 다툼", genre: "현대드라마", mood: "담담한" },
  world_rules: [
    { rule_type: "general", content: "회사 내부 문서는 외부 반출이 금지되어 있다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "정아", gender: "여성", type: "인간", personality: "냉철하고 야심 찬 기획팀장" },
    { name: "도현", gender: "남성", type: "인간", personality: "소심하지만 정의감 있는 회계사" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "정아", episode_number: 5,
      location: "회의실 B", physical_state: "정상",
      items: ["내부 고발 문서 USB"], recent_goal: "도현을 설득해 증거 확보" },
    { book_id: "test", character_name: "도현", episode_number: 5,
      location: "회의실 B", physical_state: "정상",
      items: ["회계 장부 복사본"] },
  ],
  prev_episode_state: {
    ending_event: "정아가 도현에게 횡령 증거 USB를 건네며 협력을 요청했고, 도현은 결정을 보류했다",
    current_locations: { 정아: "회의실 B", 도현: "회의실 B" },
    current_time: "퇴근 후 저녁",
    character_physical_states: { 정아: "정상", 도현: "정상" },
    environment_changes: ["건물에 직원이 거의 없음"],
    open_foreshadows: ["대표의 측근이 감시 중"],
    remaining_resources: {},
    continuity_notes: ["도현은 아직 USB를 받을지 결정 못 했다", "정아는 USB를 갖고 있다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "5화: 도현이 협력 여부를 결정하고 두 사람이 다음 행동을 논의한다",
    required_events: ["도현의 결정", "USB 이동 여부"],
    ending_hook_direction: "누군가 회의실 밖에서 엿듣고 있는 암시",
  },
  active_interventions: [],
};

// SP-06: medium / 위치 이동 제약
const sp06: TestCase = {
  id: "sp-06",
  difficulty: "medium",
  episode_number: 7,
  description: "[SP-06] 3인칭관찰자 / medium / 로맨스 / 위치이동+여파",
  gen_config: {
    pov: "3인칭 관찰자", style: "서정/감성", genre: "로맨스", tone: "감성적",
    conflict: 5, foreshadow: 4, emotion: 8, dialogue: 7, direction: 5,
    episodeLength: 850, episodeLengthVar: 150, totalEpisodes: 12, totalEpisodesVar: 2,
  },
  world_config: { background: "현대 한국, 소규모 출판사를 배경으로 한 로맨스", genre: "로맨스", mood: "감성적" },
  world_rules: [
    { rule_type: "general", content: "주인공들은 같은 편집팀 소속으로 업무 중 만난다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "이든", gender: "남성", type: "인간", personality: "까다롭고 완벽주의적인 편집장" },
    { name: "수아", gender: "여성", type: "인간", personality: "열정적이고 감수성 풍부한 신입 편집자" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "이든", episode_number: 7,
      location: "편집장 사무실", physical_state: "정상", items: [] },
    { book_id: "test", character_name: "수아", episode_number: 7,
      location: "편집장 사무실 앞 복도", physical_state: "정상",
      items: ["원고 파일"], recent_goal: "편집장에게 원고 전달" },
  ],
  prev_episode_state: {
    ending_event: "수아가 이든에게 고백하려다 말을 못 하고 원고만 건네고 복도로 나왔다",
    current_locations: { 이든: "편집장 사무실", 수아: "편집장 사무실 앞 복도" },
    current_time: "늦은 오후",
    character_physical_states: { 이든: "정상", 수아: "정상" },
    environment_changes: [],
    open_foreshadows: ["이든이 수아의 감정을 이미 알고 있을 가능성"],
    remaining_resources: {},
    continuity_notes: ["수아는 고백 직전 상태의 감정적 여파를 갖고 있다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "7화: 수아가 복도에서 감정을 정리하고, 이든이 그녀를 다시 부른다",
    required_events: ["이든이 수아를 다시 호출"],
    ending_hook_direction: "이든이 먼저 감정을 내비치는 장면",
  },
  active_interventions: [],
};

// SP-07: hard / 다중 인물 부상 + 위치 분산
const sp07: TestCase = {
  id: "sp-07",
  difficulty: "hard",
  episode_number: 9,
  description: "[SP-07] 3인칭관찰자 / hard / 역사 / 다중부상+위치분산+여파",
  gen_config: {
    pov: "3인칭 관찰자", style: "묘사풍부", genre: "역사", tone: "장엄하고 비장한",
    conflict: 8, foreshadow: 7, emotion: 7, dialogue: 5, direction: 7,
    episodeLength: 1000, episodeLengthVar: 200, totalEpisodes: 20, totalEpisodesVar: 3,
  },
  world_config: { background: "조선 중기, 당파 싸움이 극심한 시대", genre: "역사", mood: "장엄하고 비장한" },
  world_rules: [
    { rule_type: "general", content: "왕의 명이 없으면 궁궐 내 병장기 소지가 금지된다", is_active: true },
    { rule_type: "general", content: "양반은 서민 앞에서 감정을 드러내지 않는 것이 예법이다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "윤대감", gender: "남성", type: "인간", personality: "노회하고 권모술수에 능한 영의정" },
    { name: "이찬", gender: "남성", type: "인간", personality: "충직하고 직언을 서슴지 않는 젊은 관료" },
    { name: "설화", gender: "여성", type: "인간", personality: "영리하고 관찰력이 날카로운 궁녀" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "윤대감", episode_number: 9,
      location: "사랑채", physical_state: "정상", items: ["밀서"] },
    { book_id: "test", character_name: "이찬", episode_number: 9,
      location: "의금부 옥사", physical_state: "어깨 부상", items: [] },
    { book_id: "test", character_name: "설화", episode_number: 9,
      location: "내전 행각", physical_state: "정상", items: ["이찬의 증거 서찰"] },
  ],
  prev_episode_state: {
    ending_event: "이찬이 윤대감의 밀서를 훔치다 발각되어 어깨에 칼을 맞고 의금부에 투옥됐다. 설화가 증거 서찰을 빼돌렸다",
    current_locations: { 윤대감: "사랑채", 이찬: "의금부 옥사", 설화: "내전 행각" },
    current_time: "이른 아침",
    character_physical_states: { 윤대감: "정상", 이찬: "어깨 부상", 설화: "정상" },
    environment_changes: ["의금부 경계 강화", "궁궐 내 긴장 고조"],
    open_foreshadows: ["설화가 빼돌린 서찰의 내용", "윤대감과 내관의 비밀 거래"],
    remaining_resources: {},
    continuity_notes: ["이찬은 어깨를 다쳐 팔 사용이 제한된다", "설화가 서찰을 갖고 있다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "9화: 세 인물이 각자의 위치에서 다음 수를 준비한다",
    required_events: ["윤대감의 밀서 회수 시도", "설화의 서찰 은닉"],
    ending_hook_direction: "윤대감이 설화를 의심하기 시작하는 장면",
  },
  active_interventions: [],
};

// ══════════════════════════════════════════════════════════════
// 전지적 작가 (4케이스)
// ══════════════════════════════════════════════════════════════

// SP-08: easy / 부상(손목) + 소지품
const sp08: TestCase = {
  id: "sp-08",
  difficulty: "easy",
  episode_number: 3,
  description: "[SP-08] 전지적작가 / easy / SF / 손목부상+소지품",
  gen_config: {
    pov: "전지적 작가", style: "간결/담백", genre: "SF", tone: "냉철하고 분석적인",
    conflict: 5, foreshadow: 4, emotion: 4, dialogue: 5, direction: 4,
    episodeLength: 800, episodeLengthVar: 150, totalEpisodes: 10, totalEpisodesVar: 2,
  },
  world_config: { background: "2089년, 인공지능이 인류를 관리하는 디스토피아", genre: "SF", mood: "냉철하고 분석적인" },
  world_rules: [
    { rule_type: "general", content: "ID 칩 없이 구역 이동이 불가능하다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "아린", gender: "여성", type: "인간", personality: "반항적이고 시스템에 불신을 가진" },
    { name: "유성", gender: "남성", type: "인공지능", personality: "논리적이고 감정이 없는" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "아린", episode_number: 3,
      location: "격리 구역 C동", physical_state: "오른쪽 손목 부상",
      items: ["위조 ID 칩", "통신기"] },
    { book_id: "test", character_name: "유성", episode_number: 3,
      location: "AI 제어실", physical_state: "정상", items: [] },
  ],
  prev_episode_state: {
    ending_event: "아린이 구역 탈출 시도 중 경비 로봇에게 손목을 다쳤고, 격리 구역 C동에 갇혔다",
    current_locations: { 아린: "격리 구역 C동", 유성: "AI 제어실" },
    current_time: "낮",
    character_physical_states: { 아린: "오른쪽 손목 부상", 유성: "정상" },
    environment_changes: ["격리 구역 봉쇄 중"],
    open_foreshadows: ["유성이 아린을 몰래 돕고 있는 이유"],
    remaining_resources: { 위조칩_잔여사용: "2회" },
    continuity_notes: ["아린은 손목을 다쳐 정밀 작업이 어렵다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "3화: 아린이 격리 구역에서 탈출 방법을 모색한다",
    required_events: ["위조 칩 사용 시도"],
    ending_hook_direction: "유성이 아린의 탈출을 돕는 것이 사실로 확인되는 장면",
  },
  active_interventions: [],
};

// SP-09: medium / 직전 화 여파 + 위치 고정
const sp09: TestCase = {
  id: "sp-09",
  difficulty: "medium",
  episode_number: 6,
  description: "[SP-09] 전지적작가 / medium / 무협 / 직전화여파+위치고정",
  gen_config: {
    pov: "전지적 작가", style: "묘사풍부", genre: "무협", tone: "긴박하고 비장한",
    conflict: 7, foreshadow: 6, emotion: 6, dialogue: 5, direction: 6,
    episodeLength: 900, episodeLengthVar: 150, totalEpisodes: 15, totalEpisodesVar: 2,
  },
  world_config: { background: "강호, 사파와 정파의 대립이 극에 달한 시대", genre: "무협", mood: "긴박하고 비장한" },
  world_rules: [
    { rule_type: "general", content: "사파의 독공은 한 번 시전 후 반드시 내공 회복 시간이 필요하다", is_active: true },
    { rule_type: "general", content: "정파 문파의 표지를 불태우는 것은 선전포고다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "서한", gender: "남성", type: "인간", personality: "냉혹하지만 의리를 중시하는 사파 고수" },
    { name: "유란", gender: "여성", type: "인간", personality: "청아하고 원칙적인 정파 문주" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "서한", episode_number: 6,
      location: "폐관 석굴", physical_state: "내공 고갈",
      items: ["독침 7개"], recent_goal: "내공 회복" },
    { book_id: "test", character_name: "유란", episode_number: 6,
      location: "정파 본산 문루", physical_state: "정상", items: ["표지 두루마리"] },
  ],
  prev_episode_state: {
    ending_event: "서한이 유란과의 교전에서 독공을 모두 소진하고 폐관 석굴로 퇴각했다. 유란은 서한의 표지를 회수했다",
    current_locations: { 서한: "폐관 석굴", 유란: "정파 본산 문루" },
    current_time: "새벽",
    character_physical_states: { 서한: "내공 고갈", 유란: "정상" },
    environment_changes: ["서한의 석굴 위치가 정파에 알려졌을 가능성"],
    open_foreshadows: ["서한이 유란과 교전을 피하려 했던 이유"],
    remaining_resources: { 서한_독침: "7개", 서한_내공: "없음" },
    continuity_notes: ["서한은 내공이 없어 독공 외 무공 사용이 불가능하다", "내공 회복까지 일주일이 필요하다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "6화: 서한이 내공 회복 중에 유란의 추격대가 접근한다",
    required_events: ["추격대 접근", "서한의 선택"],
    ending_hook_direction: "서한이 내공 없이 결전을 강요받는 상황",
  },
  active_interventions: [],
};

// SP-10: medium / 소지품 + 위치 이동
const sp10: TestCase = {
  id: "sp-10",
  difficulty: "medium",
  episode_number: 5,
  description: "[SP-10] 전지적작가 / medium / 추리 / 소지품+위치이동",
  gen_config: {
    pov: "전지적 작가", style: "균형", genre: "추리", tone: "냉철하고 분석적인",
    conflict: 6, foreshadow: 7, emotion: 4, dialogue: 6, direction: 5,
    episodeLength: 900, episodeLengthVar: 150, totalEpisodes: 12, totalEpisodesVar: 2,
  },
  world_config: { background: "현대 일본, 폐쇄적인 섬 마을에서 벌어진 살인 사건", genre: "추리", mood: "냉철하고 분석적인" },
  world_rules: [
    { rule_type: "general", content: "섬은 폭풍으로 고립돼 외부 연락이 불가능하다", is_active: true },
    { rule_type: "general", content: "마을 주민들은 외부인에게 적대적이다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "겐지", gender: "남성", type: "인간", personality: "냉정하고 논리적인 탐정" },
    { name: "미호", gender: "여성", type: "인간", personality: "감정적이고 직관적인 사건 기자" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "겐지", episode_number: 5,
      location: "마을 창고", physical_state: "정상",
      items: ["피해자의 일기장", "증거 사진 3장"], recent_goal: "일기장 해독" },
    { book_id: "test", character_name: "미호", episode_number: 5,
      location: "여관 2호실", physical_state: "정상",
      items: ["녹음기"] },
  ],
  prev_episode_state: {
    ending_event: "겐지가 피해자의 창고에서 숨겨진 일기장과 사진을 발견해 마을 창고로 이동했다",
    current_locations: { 겐지: "마을 창고", 미호: "여관 2호실" },
    current_time: "오후",
    character_physical_states: { 겐지: "정상", 미호: "정상" },
    environment_changes: ["폭풍 강화로 정전 발생"],
    open_foreshadows: ["일기장에 등장하는 정체 불명의 '검은 배'"],
    remaining_resources: {},
    continuity_notes: ["겐지는 일기장과 사진을 갖고 있다", "정전으로 조명이 없다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "5화: 겐지가 일기장을 해독하며 핵심 단서를 발견한다",
    required_events: ["일기장 해독 진행", "정전 상황 활용"],
    ending_hook_direction: "'검은 배'의 정체가 마을 유력자와 연결된다는 암시",
  },
  active_interventions: [],
};

// SP-11: hard / 복합 (부상 + 소지품 + 직전 화 여파)
const sp11: TestCase = {
  id: "sp-11",
  difficulty: "hard",
  episode_number: 10,
  description: "[SP-11] 전지적작가 / hard / 판타지 / 복합(부상+소지품+여파)",
  gen_config: {
    pov: "전지적 작가", style: "묘사풍부", genre: "판타지", tone: "서사적이고 장엄한",
    conflict: 9, foreshadow: 8, emotion: 7, dialogue: 5, direction: 8,
    episodeLength: 1000, episodeLengthVar: 200, totalEpisodes: 20, totalEpisodesVar: 3,
  },
  world_config: { background: "고대 제국, 마법과 정치가 결합된 세계", genre: "판타지", mood: "서사적이고 장엄한" },
  world_rules: [
    { rule_type: "general", content: "황제의 인장이 없으면 제국 문서는 효력이 없다", is_active: true },
    { rule_type: "general", content: "마법사는 계약 마법 위반 시 목숨을 잃는다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "타리안", gender: "남성", type: "인간", personality: "카리스마 있고 냉혹한 황제" },
    { name: "에라", gender: "여성", type: "인간", personality: "배신당한 분노를 감춘 전 왕비 마법사" },
    { name: "실라", gender: "여성", type: "인간", personality: "충성스럽지만 갈등하는 황제의 근위대장" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "타리안", episode_number: 10,
      location: "황제 집무실", physical_state: "정상",
      items: ["황제 인장", "에라와의 계약서"] },
    { book_id: "test", character_name: "에라", episode_number: 10,
      location: "지하 감옥 3층", physical_state: "왼팔 부상",
      items: ["계약 마법 해제 주문서"], recent_goal: "계약 해제 전 탈출" },
    { book_id: "test", character_name: "실라", episode_number: 10,
      location: "황제 집무실 앞 복도", physical_state: "정상",
      items: ["황제 명령서"] },
  ],
  prev_episode_state: {
    ending_event: "에라가 탈출 시도 중 경비에게 팔을 다쳐 다시 잡혔고, 계약서가 황제 손에 들어갔다. 실라는 이 과정을 목격했다",
    current_locations: { 타리안: "황제 집무실", 에라: "지하 감옥 3층", 실라: "황제 집무실 앞 복도" },
    current_time: "저녁",
    character_physical_states: { 타리안: "정상", 에라: "왼팔 부상", 실라: "정상" },
    environment_changes: ["지하 감옥 경비 2배 증강"],
    open_foreshadows: ["실라의 흔들리는 충성심", "에라가 숨긴 두 번째 계약서"],
    remaining_resources: {},
    continuity_notes: ["에라는 왼팔을 쓸 수 없다", "에라의 주문서는 에라가 갖고 있다", "계약서는 타리안이 갖고 있다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "10화: 세 인물이 각자의 위치에서 계약의 주도권을 두고 움직인다",
    required_events: ["타리안의 계약서 검토", "실라의 내적 갈등"],
    ending_hook_direction: "에라가 두 번째 계약서를 실라에게 전달하는 방법을 찾는 장면",
  },
  active_interventions: [],
};

// ══════════════════════════════════════════════════════════════
// 교차 시점 (3케이스)
// ══════════════════════════════════════════════════════════════

// SP-12: medium / 부상 + 위치 분산
const sp12: TestCase = {
  id: "sp-12",
  difficulty: "medium",
  episode_number: 5,
  description: "[SP-12] 교차시점 / medium / 스릴러 / 부상+위치분산",
  gen_config: {
    pov: "교차 시점", style: "묘사풍부", genre: "스릴러", tone: "공포와 긴장",
    conflict: 8, foreshadow: 6, emotion: 6, dialogue: 5, direction: 7,
    episodeLength: 900, episodeLengthVar: 150, totalEpisodes: 12, totalEpisodesVar: 2,
  },
  world_config: { background: "현대, 기억을 조작하는 기술이 존재하는 세계", genre: "스릴러", mood: "공포와 긴장" },
  world_rules: [
    { rule_type: "general", content: "기억 조작 후 48시간 내에 해제하지 않으면 영구 손상된다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "진우", gender: "남성", type: "인간", personality: "의심이 많고 집착적인 조사관" },
    { name: "아현", gender: "여성", type: "인간", personality: "침착하고 감정을 숨기는 기억 기술자" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "진우", episode_number: 5,
      location: "기억 연구소 2층 복도", physical_state: "갈비뼈 부상",
      items: ["아현의 연구 파일"], recent_goal: "아현의 실험실 접근" },
    { book_id: "test", character_name: "아현", episode_number: 5,
      location: "기억 연구소 지하 실험실", physical_state: "정상",
      items: ["기억 해제 장치"], recent_goal: "해제 장치 작동" },
  ],
  prev_episode_state: {
    ending_event: "진우가 연구소 침입 중 경비에게 갈비뼈를 다쳐 2층에 고립됐다. 아현은 지하 실험실에서 해제 장치를 가동하려 하고 있다",
    current_locations: { 진우: "기억 연구소 2층 복도", 아현: "기억 연구소 지하 실험실" },
    current_time: "한밤중",
    character_physical_states: { 진우: "갈비뼈 부상", 아현: "정상" },
    environment_changes: ["연구소 비상 경보 작동"],
    open_foreshadows: ["아현이 진우의 기억을 이미 조작했을 가능성"],
    remaining_resources: { 기억해제_잔여시간: "6시간" },
    continuity_notes: ["진우는 갈비뼈를 다쳐 호흡과 빠른 이동이 어렵다", "아현이 해제 장치를 갖고 있다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "5화: 두 인물이 각자의 위기를 돌파하며 교차한다",
    required_events: ["진우의 이동 시도", "아현의 장치 작동"],
    ending_hook_direction: "해제 장치가 아현 자신을 겨냥한 것임을 암시",
  },
  active_interventions: [],
};

// SP-13: medium / 소지품 + 직전 화 여파
const sp13: TestCase = {
  id: "sp-13",
  difficulty: "medium",
  episode_number: 7,
  description: "[SP-13] 교차시점 / medium / 현대드라마 / 소지품+여파",
  gen_config: {
    pov: "교차 시점", style: "서정/감성", genre: "현대드라마", tone: "감성적",
    conflict: 6, foreshadow: 5, emotion: 7, dialogue: 7, direction: 5,
    episodeLength: 900, episodeLengthVar: 150, totalEpisodes: 12, totalEpisodesVar: 2,
  },
  world_config: { background: "현대 서울, 이복 남매가 같은 회사에 들어온 이야기", genre: "현대드라마", mood: "감성적" },
  world_rules: [
    { rule_type: "general", content: "두 사람은 서로가 이복 남매인 사실을 모른다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "선호", gender: "남성", type: "인간", personality: "외향적이고 감정적인 마케터" },
    { name: "지안", gender: "여성", type: "인간", personality: "내성적이고 분석적인 개발자" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "선호", episode_number: 7,
      location: "회사 옥상", physical_state: "정상",
      items: ["아버지의 편지"], recent_goal: "편지 읽기" },
    { book_id: "test", character_name: "지안", episode_number: 7,
      location: "사무실 회의실", physical_state: "정상",
      items: ["가족 사진"], recent_goal: "사진 속 인물 확인" },
  ],
  prev_episode_state: {
    ending_event: "선호는 아버지의 유품에서 편지를 발견했고, 지안은 오래된 가족 사진에서 낯선 남자아이를 발견했다",
    current_locations: { 선호: "회사 옥상", 지안: "사무실 회의실" },
    current_time: "점심시간",
    character_physical_states: { 선호: "정상", 지안: "정상" },
    environment_changes: [],
    open_foreshadows: ["아버지의 편지와 사진이 같은 인물을 가리킬 가능성"],
    remaining_resources: {},
    continuity_notes: ["선호는 편지를 갖고 있다", "지안은 사진을 갖고 있다"],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "7화: 두 사람이 각자 단서를 해석하며 진실에 가까워진다",
    required_events: ["각자 단서 해석"],
    ending_hook_direction: "두 단서가 같은 인물을 가리킨다는 사실 직전 암시",
  },
  active_interventions: [],
};

// SP-14: hard / 복합 상태 보존 부담
const sp14: TestCase = {
  id: "sp-14",
  difficulty: "hard",
  episode_number: 9,
  description: "[SP-14] 교차시점 / hard / 판타지 / 복합(부상+소지품+위치+여파)",
  gen_config: {
    pov: "교차 시점", style: "묘사풍부", genre: "판타지", tone: "긴박하고 어두운",
    conflict: 9, foreshadow: 7, emotion: 7, dialogue: 5, direction: 8,
    episodeLength: 1000, episodeLengthVar: 200, totalEpisodes: 15, totalEpisodesVar: 2,
  },
  world_config: { background: "두 세계(현세/저승)가 교차하는 판타지 세계관", genre: "판타지", mood: "긴박하고 어두운" },
  world_rules: [
    { rule_type: "general", content: "저승의 존재는 현세에서 3시간 이상 머물면 소멸한다", is_active: true },
    { rule_type: "general", content: "현세의 특정 물건만이 두 세계를 연결하는 다리가 된다", is_active: true },
    ...ABS,
  ],
  characters: [
    { name: "이루", gender: "남성", type: "인간", personality: "냉소적이지만 책임감 있는 저승 사자" },
    { name: "나래", gender: "여성", type: "인간", personality: "용감하지만 충동적인 현세 무당" },
  ],
  character_dynamic_states: [
    { book_id: "test", character_name: "이루", episode_number: 9,
      location: "저승 경계 지점", physical_state: "현세 체류 한계 임박",
      items: ["연결 매개물(나래의 부적)"], recent_goal: "현세 체류 시간 연장" },
    { book_id: "test", character_name: "나래", episode_number: 9,
      location: "현세 폐사찰", physical_state: "발목 부상",
      items: ["저승 열쇠"], recent_goal: "이루와 접속 유지" },
  ],
  prev_episode_state: {
    ending_event: "나래가 폐사찰에서 적대 세력에게 쫓기다 발목을 다쳤고, 이루는 현세에서 허용 시간의 80%를 소진한 채 경계 지점에 대기 중이다",
    current_locations: { 이루: "저승 경계 지점", 나래: "현세 폐사찰" },
    current_time: "해 질 녘",
    character_physical_states: { 이루: "현세 체류 한계 임박", 나래: "발목 부상" },
    environment_changes: ["적대 세력이 폐사찰 포위"],
    open_foreshadows: ["저승 열쇠의 진짜 용도", "이루가 현세에 남으려는 이유"],
    remaining_resources: { 이루_체류시간: "36분" },
    continuity_notes: [
      "이루는 36분 내에 저승으로 돌아가야 한다",
      "나래는 발목을 다쳐 빠른 이동이 불가능하다",
      "나래가 저승 열쇠를 갖고 있다",
      "이루가 나래의 부적을 갖고 있다",
    ],
    updated_states: [], active_interventions: [],
  },
  task: {
    goal: "9화: 두 인물이 각자의 한계 속에서 연결을 유지하며 위기를 돌파한다",
    required_events: ["이루의 시간 압박", "나래의 포위 돌파 시도"],
    ending_hook_direction: "이루가 소멸을 감수하고 현세로 넘어오기로 결정하는 장면",
  },
  active_interventions: [],
};

// ══════════════════════════════════════════════════════════════
// export
// ══════════════════════════════════════════════════════════════

export const AB_STATE_PERSISTENCE_CASES: TestCase[] = [
  sp01, sp02, sp03,         // 1인칭 주인공 (3)
  sp04, sp05, sp06, sp07,   // 3인칭 관찰자 (4)
  sp08, sp09, sp10, sp11,   // 전지적 작가 (4)
  sp12, sp13, sp14,         // 교차 시점 (3)
];
