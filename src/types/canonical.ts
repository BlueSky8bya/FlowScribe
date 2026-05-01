/**
 * canonical.ts — 사용자 정의 원본 타입 + 에이전트 내부 동적 상태 타입
 *
 * ── 분리 원칙 ─────────────────────────────────────────────────
 * A. Canonical  : 사용자가 사전 설정한 불변 원본 (에이전트 임의 수정 금지)
 * B. Dynamic    : 에이전트가 회차마다 적극 갱신하는 동적 상태
 * C. Inferred   : 에이전트가 추론한 후보 상태 (confidence + source 필수)
 * D. Effective  : 생성 직전 조립되는 최종 merged context
 */

// ══════════════════════════════════════════════════════════════
// A. Canonical — 사용자 사전 설정 영역
// ══════════════════════════════════════════════════════════════

/** 인물 canonical profile — 사용자가 직접 설정한 필드 */
export interface CanonicalCharacter {
  name: string;
  personality: string;       // 성격/특징
  type: string;              // 인간/동물/기타
  gender: string;            // 남성/여성/해당없음/기타
  initial_items?: ItemEntry[]; // 이야기 시작 시 소지품 (동적 상태가 없을 때 폴백)
}

/** 작품 기본 설정층 */
export interface WorldConfig {
  background: string;    // 배경/세계관
  genre: string;         // 장르
  mood: string;          // 분위기
  theme?: string;
  common_tone?: string;
}

/** 세계관 규칙 단위 */
export interface WorldRule {
  id?: string;
  rule_type: "general" | "absolute_forbidden";
  content: string;
  is_active: boolean;
}

/**
 * 회차 글자수 예산 — soft budget (hard cap 아님)
 * target: 렌더러 프롬프트에 전달되는 목표값 (= episodeLength + round(var/2))
 * min/max: 수용 범위 (validator 참조용)
 * strictness: soft = 권장, medium = 경고, hard = 위반
 */
export interface EpisodeCharBudget {
  target: number;
  min: number;
  max: number;
  strictness: "soft" | "medium" | "hard";
}

/** GenConfig → EpisodeCharBudget 변환 헬퍼 */
export function resolveCharBudget(
  cfg: Pick<GenConfig, "episodeLength" | "episodeLengthVar">,
  strictness: EpisodeCharBudget["strictness"] = "soft",
): EpisodeCharBudget {
  return {
    target:     cfg.episodeLength + Math.round(cfg.episodeLengthVar / 2),
    min:        cfg.episodeLength - cfg.episodeLengthVar,
    max:        cfg.episodeLength + cfg.episodeLengthVar,
    strictness,
  };
}

/** 생성 설정 (회차별 조정 가능) */
export interface GenConfig {
  pov: "1인칭 주인공" | "1인칭 관찰자" | "3인칭 관찰자" | "전지적 작가" | "교차 시점";
  style: "간결/담백" | "서정/감성" | "묘사풍부" | "균형";
  genre?: string;
  tone?: string;
  conflict: number;       // 0~10
  foreshadow: number;
  emotion: number;
  dialogue: number;
  direction: number;
  episodeLength: number;
  episodeLengthVar: number;
  totalEpisodes: number;
  totalEpisodesVar: number;
  /**
   * 아크/책 시작 시 한 번 결정해서 고정한 최종 화수.
   * 설정된 경우 state_extractor의 ending_constraint 판단에 totalEpisodes 대신 사용.
   * 미설정 시 totalEpisodes 폴백 (하위 호환).
   * 외부(서비스 레이어 / seeded RNG)에서 주입 — GenConfig 자체에서 샘플링하지 않음.
   */
  resolved_final_episode?: number;
  forbidden_elements?: string[];  // 이번 화 추가 금지요소
  required_elements?: string[];   // 이번 화 필수요소
  /** 인물 등장 정책 — 미입력 시 resolveCharacterPolicy()가 장르 기반 기본값 채움 */
  character_policy?: import("./character_policy.js").CharacterPolicyConfig;
}

/**
 * 책/아크 시작 시 한 번 확정되는 계약 — 이후 변경 금지.
 * resolved_final_episode: 호출자(서비스 레이어 또는 seeded RNG)가 결정해서 주입.
 * 런타임 참조용 타입으로, DB 저장이 필요한 경우 books.context JSONB 내 중첩 저장.
 */
export interface BookArcContract {
  nominal_total_episodes: number;     // GenConfig.totalEpisodes
  episode_variance: number;           // GenConfig.totalEpisodesVar
  resolved_final_episode: number;     // 외부 주입값 (서비스 or seeded RNG)
  char_budget: EpisodeCharBudget;     // resolveCharBudget() 결과
  contract_version: string;           // "1.0"
  frozen_at: string;                  // ISO timestamp
}

/**
 * BookArcContract 생성 헬퍼 — 순수 조합 함수.
 * resolvedFinalEpisode 결정은 호출자 책임 (예: Math.round(totalEpisodes + rng() * 2 * var - var)).
 */
export function createBookArcContract(
  cfg: GenConfig,
  resolvedFinalEpisode: number,
): BookArcContract {
  return {
    nominal_total_episodes: cfg.totalEpisodes,
    episode_variance:       cfg.totalEpisodesVar,
    resolved_final_episode: resolvedFinalEpisode,
    char_budget:            resolveCharBudget(cfg),
    contract_version:       "1.0",
    frozen_at:              new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════
// B. Dynamic — 에이전트 내부 관리 영역
// ══════════════════════════════════════════════════════════════

/** 소지품 등급 */
export type ItemGrade = 'S' | 'A' | 'B' | 'C' | 'D';

/** 소지품 (이름 + 등급 + 선택적 상태) */
export interface ItemEntry {
  name: string;
  grade?: ItemGrade;    // S~D 등급 (없으면 미분류)
  condition?: string;   // 자연어 상태: "화살 15개 남음", "녹이 슬었음"
  description?: string; // 짧은 설명/용도
}

/** 인물 동적 상태 (회차별) */
export interface CharacterDynamicState {
  book_id: string;
  character_name: string;
  episode_number: number;
  location?: string;
  physical_state?: string;          // 부상/신체 상태 (ForbiddenAction 변환에 사용)
  items?: ItemEntry[];
  recent_goal?: string;
  relationship_updates?: Record<string, string>; // 상대방 이름 → 관계 상태
  foreshadow_connections?: string[];             // 연관된 미회수 복선 id
  behavior_hints?: string;
  alias_used?: string[];
  /** 감정 상태 — physical_state(부상)와 분리된 심리/정서 상태 */
  emotional_state?: string;
  /** 이번 화 등장 가능 여부 — planner 입력용. 미설정 시 "present"로 간주 */
  visibility_state?: "present" | "absent" | "cannot_act";
}

/** 작가 개입 단위 */
export interface AuthorIntervention {
  id?: string;
  book_id: string;
  episode_number?: number;
  instruction: string;
  target_scope: "episode" | "arc" | "persistent";
  duration: "single_episode" | "arc" | "persistent";
  overrides_rules?: string[];    // override 대상 일반 규칙
  conflicts_absolute: boolean;   // 절대금지와 충돌하면 자동 차단
  is_active: boolean;
}

// ══════════════════════════════════════════════════════════════
// C. Inferred — 에이전트 추론 후보 (candidate layer)
// ══════════════════════════════════════════════════════════════

export interface CharacterInferredState {
  id?: string;
  book_id: string;
  character_name: string;
  field: "ability" | "weakness" | "appearance" | "alias" | "other";
  value: string;
  confidence: number;       // 0.0~1.0
  source_episode?: number;
  source_text?: string;
  status: "candidate" | "confirmed" | "rejected";
}

// ══════════════════════════════════════════════════════════════
// D. Episode Scratchpad — 회차 작업 메모리
// ══════════════════════════════════════════════════════════════

export interface PrevEpisodeState {
  ending_event: string;
  current_locations: Record<string, string>;         // 인물 → 현재 위치
  current_time: string;
  character_physical_states: Record<string, string>; // 인물 → 물리 상태
  environment_changes: string[];
  open_foreshadows: string[];
  remaining_resources: Record<string, string>;
  continuity_notes: string[];
  updated_states: string[];
  active_interventions: string[];
}

export interface EpisodeTask {
  goal: string;
  required_events?: string[];
  hidden_info?: string[];
  ending_hook_direction?: string;
  special_constraints?: string[];
}

// ══════════════════════════════════════════════════════════════
// E-0. Episode Delta Contract — 이번 화 진전 강제 계약
// ══════════════════════════════════════════════════════════════

export interface EpisodeDeltaContract {
  episode_number: number;

  /** 직전 화에서 확정된 사실 (반복 감지 기준) */
  previous_episode_facts: string[];
  /** 직전 화 마지막 상태 (이번 화 시작점) */
  previous_episode_end_state: string[];

  /** 이번 화에서 반드시 전진해야 할 항목 */
  must_progress: string[];
  /** 이번 화에서 반복 금지 항목 */
  must_not_repeat: string[];
  /** 이번 화에서 새로 변해야 하는 것 */
  newly_required_changes: string[];

  /** 인물별 상태 변화 요구사항 */
  character_delta_requirements: Array<{
    character_name: string;
    previous_state: string;
    required_change: string;
    forbidden_regression: string[];
  }>;

  /** 플롯 스레드별 진전 요구사항 */
  plot_delta_requirements: Array<{
    thread: string;
    previous_status: string;
    required_progress: string;
    forbidden_repeat: string[];
  }>;

  /** 반복 위험 패턴 (감지된 것) */
  repetition_risk: Array<{
    pattern: string;
    reason: string;
  }>;
}

// ══════════════════════════════════════════════════════════════
// E-1. Continuity Contract — 다음 화 연속성 계약
// ══════════════════════════════════════════════════════════════

export interface ContinuityContract {
  mode: "next_episode";
  must_continue_from: {
    episode: number;
    last_state: string;
  };
  known_facts: string[];
  relationship_state: string[];
  open_threads: string[];
  forbidden_regressions: string[];
  /**
   * Phase 4.11 — cross-episode 인물 위치/visibility 누적.
   * planner는 이 항목을 starting state로 받아 첫 beat에서 반영하거나
   * scene_transition_reason과 함께 변경해야 한다.
   */
  character_position_state?: Array<{
    character_name: string;
    last_location: string;
    visibility: string;     // present | absent | cannot_act
    items_summary: string;  // 짧은 string (3개 이하)
  }>;
  /**
   * Phase 4.16 — 감정/목표 progression contract.
   * 같은 인물이 같은 emotional_state 또는 recent_goal로 N화 이상 정체된 경우
   * planner에게 "이번 화는 단순 감정 반복이 아니라 결정/행동/관계/정보/대가 중
   * 하나로 진전을 보이라"는 hard requirement를 emit.
   * 루프가 감지되지 않은 인물에는 비어 있음.
   */
  emotional_progression_requirements?: Array<{
    character_name: string;
    streak_type: "emotion" | "goal" | "emotion_goal_pair";
    streak_length: number;
    current_emotion: string;
    current_goal: string;
    /** allowed progression types — planner는 이 중 하나를 선택 */
    allowed_progression_types: string[];
    /** human-readable 짧은 지시 (planner prompt에 그대로 삽입) */
    instruction: string;
  }>;
}

// ══════════════════════════════════════════════════════════════
// E-2. Regeneration Divergence Contract (Phase 4.18)
// ══════════════════════════════════════════════════════════════

/**
 * GenerationMode — context builder가 호출 의도를 명시.
 *  - next_episode_generation: ep N 신규 생성 (직전 화에서 자연스럽게 이어짐)
 *  - latest_episode_regeneration: 같은 화의 재생성. N-1까지 continuity 유지 + 기존 N화와 divergence
 *  - episode1_regeneration: ep1 재생성 — multiverse alternate opening
 *  - new_episode_generation: ep1 최초 생성
 */
export type GenerationMode =
  | "new_episode_generation"
  | "next_episode_generation"
  | "latest_episode_regeneration"
  | "episode1_regeneration";

/**
 * RegenerationDivergenceContract — Phase 4.18.
 *
 * 재생성 시 planner가 이전 시도(N_old)의 plot signature를 알고
 * 의도적으로 다른 axis로 분기하도록 안내한다.
 *
 * 설계 원칙:
 *   - N_old의 본문 전문이나 긴 beat 텍스트를 다시 주입하지 않는다 (anchoring 방지).
 *   - 짧은 signature와 must_vary axes만 노출.
 *   - 하드코딩된 금지문이 아니라 "다른 axis 선택" 형태의 구조적 가이드.
 *   - N+1 이후 문맥은 절대 포함하지 않는다 (재생성은 최신화에 한해서만 가능하므로 존재할 수 없음).
 */
export interface RegenerationDivergenceContract {
  mode: "episode1_regeneration" | "latest_episode_regeneration";
  episode_number: number;
  /**
   * 이전 시도 횟수 (>=1). 1이면 1번 재생성 시도, 2면 2번째 재생성…
   * 횟수가 많아질수록 더 강한 divergence 권고.
   */
  attempt_count: number;
  /**
   * 직전 시도(N_old)의 plot 골격. 짧게 압축. planner가 회피 대상으로만 사용.
   * 모든 필드는 optional — 추출 실패 시 누락.
   */
  old_episode_signature: {
    opening_location?: string;
    opening_image?: string;       // beat1 첫 장면 묘사 50자 이내
    first_conflict?: string;      // beat1~2의 갈등/사건 50자 이내
    main_event_path?: string[];   // beat 요약 (각 50자 이내)
    key_revelation?: string;      // 핵심 노출/발견 (있으면)
    ending_hook_type?: string;    // hook_type 식별자
    ending_hook_image?: string;   // hook_concrete_event 50자 이내
    emotional_pattern?: string;   // 주요 인물 감정 흐름 한 줄
  };
  /**
   * 이전 시도들에서 반복 등장한 plot pattern (>=2회).
   * planner는 이 patterns 가운데 하나라도 그대로 재사용하면 안 된다.
   */
  recurring_patterns: string[];
  /** 반드시 유지해야 하는 것 (N-1까지 continuity / world / characters) — 짧은 라벨 */
  must_preserve: string[];
  /** 반드시 달라져야 할 axes — planner는 이 가운데 최소 (hint_min_axes)개 이상에서 분기 */
  must_vary_axes: Array<
    | "opening_location"
    | "opening_image"
    | "first_conflict"
    | "main_event_path"
    | "information_reveal_order"
    | "character_choice"
    | "relationship_interaction"
    | "item_usage"
    | "threat_entry"
    | "ending_hook"
    | "emotional_route"
  >;
  /** must_vary_axes 가운데 최소 몇 개에서 분기해야 하는가 (기본 2~3) */
  hint_min_divergent_axes: number;
}

// ══════════════════════════════════════════════════════════════
// E. Effective Context — 생성 직전 조립 결과
// ══════════════════════════════════════════════════════════════

export interface EffectiveContext {
  episode_number: number;
  gen_config: GenConfig;
  world_config: WorldConfig;
  general_rules: string[];
  absolute_forbidden: string[];
  active_interventions: AuthorIntervention[];
  characters: CanonicalCharacter[];
  character_dynamic_states: CharacterDynamicState[];
  character_inferred_states: CharacterInferredState[];
  prev_episode_state: PrevEpisodeState;
  task: EpisodeTask;
  // 기존 서비스 데이터 (foreshadow.ts / arc_memory.ts / profile.ts)
  foreshadow_memory: Array<{ id: string; planted_episode: number; content: string; keywords: string[] }>;
  arc_summaries: Array<{ episode_start: number; episode_end: number; summary: string; arc_number: number }>;
  character_arcs: Record<string, { state: string; key_events: string[] }>;
  rolling_summary: string;
  prev_episode_tail?: string;
  /** 재생성 시 직전 시도에서 생성된 텍스트 — planner 반복 방지용 (legacy, Phase 4.18에서 contract로 대체 진행 중) */
  regen_prev_text?: string;
  /** Phase 4.18 — 생성 모드 명시. 미지정 시 episode_number 기준으로 기본값 적용. */
  regen_mode?: GenerationMode;
  /**
   * Phase 4.18 — 재생성 분기 계약. regen_mode가 *_regeneration일 때만 존재.
   * planner는 이 contract를 보고 must_vary_axes에서 분기, must_preserve에서 유지.
   */
  regen_divergence_contract?: RegenerationDivergenceContract;
  /** ep >= 2 생성 시 자동 조립되는 연속성 계약 */
  continuity_contract?: ContinuityContract;
  /** ep >= 2 생성 시 조립되는 진전 강제 계약 */
  episode_delta_contract?: EpisodeDeltaContract;
  /**
   * 이전 화 제목 목록 (renderer에 전달해 동일·유사 제목 재사용 방지).
   * "N화 - 제목" 형식 그대로. 최근 ~10화. ep1에서는 빈 배열.
   */
  prev_episode_titles?: string[];
  reader_profile: {
    focus: number; sentiment: number; urgency: number;
    complexity: number; dialogue: number; audio_sync: number;
  };
}

// ══════════════════════════════════════════════════════════════
// F. Validation — 검증 결과 구조
// ══════════════════════════════════════════════════════════════

export type Verdict = "FAIL" | "WARN" | "PASS" | "PASS_STRONG";

export interface HardViolation {
  rule: string;
  description: string;
  severity: "critical" | "major";
  location?: string;
}

export interface SoftWarning {
  rule: string;
  description: string;
  severity: "medium" | "low";
  suggestion?: string;
}

export interface QualityScores {
  pov_consistency: number;        // 0~100
  scene_clarity: number;
  character_consistency: number;
  plot_momentum: number;
  world_rule_usage: number;
  exposition_control: number;
  prose_density: number;
  ending_hook: number;
  style_adherence: number;
  intervention_adherence: number;
}

export interface ValidationResult {
  verdict: Verdict;
  hard_violations: HardViolation[];
  soft_warnings: SoftWarning[];
  quality_scores: QualityScores;
  total_score: number;           // 0~100 weighted
  summary: string;
  revision_hints?: string[];     // 리비전 시 사용할 힌트
  /** 이름 관련 hard_violation 후처리 결과 (postprocessNameViolations 생성) */
  name_analysis?: import("./character_policy.js").NamePostprocessResult;
}

// ══════════════════════════════════════════════════════════════
// G. Test Framework Types
// ══════════════════════════════════════════════════════════════

export type Difficulty = "easy" | "medium" | "hard";

export interface TestCase {
  id: string;
  difficulty: Difficulty;
  description: string;
  episode_number: number;   // 케이스 내 일관된 회차 번호
  gen_config: GenConfig;
  world_config: WorldConfig;
  world_rules: WorldRule[];
  characters: CanonicalCharacter[];
  character_dynamic_states: CharacterDynamicState[];
  prev_episode_state: PrevEpisodeState;
  task: EpisodeTask;
  active_interventions: AuthorIntervention[];
}

export interface TestResult {
  case_id: string;
  difficulty: Difficulty;
  iteration: number;
  generated_chars: number;
  validation: ValidationResult;
  revision_count: number;
  final_verdict: Verdict;
  elapsed_ms: number;
}

export interface RunReport {
  run_id: string;
  timestamp: string;
  set_type: "dev" | "holdout" | "smoke";
  total_cases: number;
  results: TestResult[];
  pass_rate: number;
  fail_rate: number;
  avg_score: number;
  by_difficulty: Record<Difficulty, { pass: number; total: number }>;
  by_pov: Record<string, { pass: number; total: number }>;
  by_style: Record<string, { pass: number; total: number }>;
  hard_violation_freq: Record<string, number>;
  soft_warning_freq: Record<string, number>;
  termination_condition_met: boolean;
}
