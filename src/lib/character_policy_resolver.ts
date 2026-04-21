/**
 * character_policy_resolver.ts — 인물 등장 정책 기본값 리졸버
 *
 * 현 단계: UI 미노출. 정책값이 명시되지 않으면 장르/분위기 힌트를 참고해 기본값 결정.
 * 향후: GenConfig.character_policy 필드가 생기면 해당 값을 우선 사용.
 */

import type { WorldConfig } from "../types/canonical.js";
import type {
  AliasPolicy,
  CharacterPolicyConfig,
  NewCharacterPolicy,
} from "../types/character_policy.js";

// ── 장르별 기본 정책 힌트 ────────────────────────────────────────────────
// 폐쇄적 세계관(추리/공포)은 closed_cast에 가깝게, 열린 세계관(판타지/모험)은 느슨하게.
const GENRE_POLICY_HINTS: Record<string, NewCharacterPolicy> = {
  추리: "closed_cast",
  미스터리: "closed_cast",
  공포: "extras_only",
  스릴러: "extras_only",
  판타지: "named_with_gate",
  현대판타지: "named_with_gate",
  로맨스: "named_with_gate",
  현대: "named_with_gate",
  무협: "named_with_gate",
  SF: "named_with_gate",
  모험: "open_cast",
};

/**
 * resolveCharacterPolicy
 *
 * 우선순위:
 * 1. explicit — 호출자가 직접 전달한 값 (나중에 GenConfig.character_policy가 생기면 여기서 수신)
 * 2. world_config.genre 기반 힌트
 * 3. 전역 기본값 (named_with_gate / true / conservative)
 */
export function resolveCharacterPolicy(
  explicit?: Partial<CharacterPolicyConfig>,
  world?: Pick<WorldConfig, "genre" | "mood">
): CharacterPolicyConfig {
  const genreKey = world?.genre?.split("/")[0]?.trim() ?? "";
  const genreHint: NewCharacterPolicy =
    GENRE_POLICY_HINTS[genreKey] ?? "named_with_gate";

  const new_character_policy: NewCharacterPolicy =
    explicit?.new_character_policy ?? genreHint;

  // background extras: closed_cast이면 false, 나머지는 true
  const background_extras_allowed: boolean =
    explicit?.background_extras_allowed ??
    new_character_policy !== "closed_cast";

  const alias_policy: AliasPolicy =
    explicit?.alias_policy ?? "conservative";

  return { new_character_policy, background_extras_allowed, alias_policy };
}

/** 정책이 신규 이름 있는 인물 등장을 허용하는지 */
export function allowsNamedNewCharacter(policy: CharacterPolicyConfig): boolean {
  return (
    policy.new_character_policy === "named_with_gate" ||
    policy.new_character_policy === "open_cast"
  );
}

/** 정책이 배경 단역(이름 없음) 등장을 허용하는지 */
export function allowsBackgroundExtra(policy: CharacterPolicyConfig): boolean {
  return policy.background_extras_allowed;
}
