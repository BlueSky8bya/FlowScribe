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

/** 인물 canonical profile — 사용자가 직접 설정한 4개 필드만 포함 */
export interface CanonicalCharacter {
  name: string;
  personality: string;   // 성격/특징
  type: string;          // 인간/동물/기타
  gender: string;        // 남성/여성/해당없음/기타
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
  forbidden_elements?: string[];  // 이번 화 추가 금지요소
  required_elements?: string[];   // 이번 화 필수요소
  /** 인물 등장 정책 — 미입력 시 resolveCharacterPolicy()가 장르 기반 기본값 채움 */
  character_policy?: import("./character_policy.js").CharacterPolicyConfig;
}

// ══════════════════════════════════════════════════════════════
// B. Dynamic — 에이전트 내부 관리 영역
// ══════════════════════════════════════════════════════════════

/** 인물 동적 상태 (회차별) */
export interface CharacterDynamicState {
  book_id: string;
  character_name: string;
  episode_number: number;
  location?: string;
  physical_state?: string;
  items?: string[];
  recent_goal?: string;
  relationship_updates?: Record<string, string>; // 상대방 이름 → 관계 상태
  foreshadow_connections?: string[];             // 연관된 미회수 복선 id
  behavior_hints?: string;
  alias_used?: string[];
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
