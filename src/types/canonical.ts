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
  /** 재생성 시 직전 시도에서 생성된 텍스트 — planner 반복 방지용 */
  regen_prev_text?: string;
  /** ep >= 2 생성 시 자동 조립되는 연속성 계약 */
  continuity_contract?: ContinuityContract;
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
