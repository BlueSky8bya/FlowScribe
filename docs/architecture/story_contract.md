# Story Contract Freeze — 스토리 계약 동결 설계

## 목적

Phase 1 trace 수집 이전, "어떤 구조의 데이터를 수집할 것인지"를 확정한다.
스키마가 수집 도중 변경되면 구버전 trace를 학습에 사용할 수 없게 되므로,
핵심 계약을 코드 + 문서 수준에서 동결한다.

---

## 스키마 개요

### A. Book/Arc Contract — `BookArcContract` (src/types/canonical.ts)

| 필드 | 타입 | 결정 시점 | 변경 정책 |
|------|------|-----------|-----------|
| `nominal_total_episodes` | number | 사용자 설정 | 사용자가 직접 변경 |
| `episode_variance` | number | 사용자 설정 | 사용자가 직접 변경 |
| `resolved_final_episode` | number | **아크 시작 시 1회** | 이후 변경 금지 |
| `char_budget` | EpisodeCharBudget | 아크 시작 시 | 아크 내 고정 |
| `contract_version` | string | 고정 "1.0" | 구조 변경 시 bump |
| `frozen_at` | ISO timestamp | 아크 시작 시 | 불변 |

### B. Episode Char Budget — `EpisodeCharBudget` (src/types/canonical.ts)

```
target = episodeLength + round(episodeLengthVar / 2)  ← 렌더러 프롬프트에 전달
min    = episodeLength - episodeLengthVar
max    = episodeLength + episodeLengthVar
strictness = "soft"  ← 기본값 (hard cap 아님)
```

**soft budget 정책:**
- `target`은 렌더러에 "이 정도 길이로 써줘"로 전달됨
- 실제 출력이 min/max를 벗어나도 hard-clip하지 않음
- validator의 soft_warning 기준으로만 참조
- LLM에 hard cap을 걸면 출력 품질이 저하되므로 soft 유지

### C. Character Episode State — `CharacterDynamicState` (src/types/canonical.ts)

| 필드 | 역할 | state_extractor 사용 여부 |
|------|------|--------------------------|
| `location` | 장소 → opening_location 추출 | ✅ |
| `physical_state` | 부상 → ForbiddenAction 변환 | ✅ |
| `items` | 소지품 → ItemConstraint 변환 | ✅ |
| `recent_goal` | 목표 → char_summary 포함 | ✅ |
| `behavior_hints` | 행동 지침 → char_summary 포함 | ✅ |
| `emotional_state` | 감정 상태 → char_summary 포함 (v1.1 추가) | 향후 추가 예정 |
| `visibility_state` | 등장 가능 여부 → planner 판단 (v1.1 추가) | 향후 추가 예정 |

**추가하지 않은 필드**: `fatigue`, `mobility_limitations`, `knowledge_state`, `resource_state`
→ 현재 `physical_state` 또는 `behavior_hints`로 표현 가능. 다음 단계에서 필요 시 추가.

### D. Trace / Training Record — `RunTrace` (src/training/types.ts)

| 필드 | v1.0 (이전) | v1.1 (현재) |
|------|-------------|-------------|
| `schema_version` | 없음 (NULL) | "1.1" |
| `planner_schema_version` | 없음 (NULL) | "1.0" |
| `reward_schema_version` | 없음 (NULL) | "1.0" |

NULL = v1.1 이전 수집 데이터. dataset_builder에서 필터링 가능.

---

## resolved_final_episode 동작

**문제**: `totalEpisodesVar`가 GenConfig에 있으나 ending 판단에 미사용됨.
에피소드 20화에서 항상 "final"이 되므로 variance 의미 없음.

**해결**: `GenConfig.resolved_final_episode?: number` (optional) 추가.

**샘플링 책임**: `createBookArcContract()` 외부 (서비스 레이어 또는 벤치마크).
```typescript
// 예시: seeded RNG 사용
const variance = Math.round((rng.next() * 2 - 1) * cfg.totalEpisodesVar);
const contract = createBookArcContract(cfg, cfg.totalEpisodes + variance);
```

**state_extractor.ts 동작**:
```typescript
const resolvedFinal = cfg.resolved_final_episode ?? cfg.totalEpisodes;
const ending_constraint = episode_number >= resolvedFinal ? "final" : "cliff";
```
→ `resolved_final_episode` 없으면 기존 `totalEpisodes` 폴백 (하위 호환).

---

## Schema Versioning Bump 정책

| 버전 상수 | 현재값 | 변경 조건 |
|-----------|--------|-----------|
| `SCHEMA_VERSION` | "1.1" | EffectiveContext, CharacterDynamicState, GenConfig 필드 추가/삭제 |
| `PLANNER_SCHEMA_VERSION` | "1.0" | ScenePlan, CreativePlan, PlannerTrace 필드 추가/삭제 |
| `REWARD_SCHEMA_VERSION` | "1.0" | QualityScores 항목 변경, RewardBreakdown 가중치/필드 변경 |

버전 상수는 `src/training/schema_versions.ts`에서 관리.
모든 trace는 생성 시 `currentSchemaVersions()`로 버전을 자동 기록.

---

## 불변 제약 (Invariants)

1. `state_extractor.ts`는 DB를 직접 호출하지 않는다.
2. `ScenePlan.ending_constraint`는 항상 state_extractor가 결정하고, LLM이 생성하지 않는다.
3. `BookArcContract`는 아크 시작 후 변경하지 않는다 (arc extension 시 contract_version 증가).
4. `resolved_final_episode`는 GenConfig 내부에서 샘플링하지 않는다 (외부 주입).
5. `EpisodeCharBudget.strictness`는 기본값 "soft"이며, hard로 변경 시 렌더 품질 저하 가능성 검토 필수.
6. `schema_version` NULL trace는 v1.1 이전 데이터로 간주한다.

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/types/canonical.ts` | EpisodeCharBudget, BookArcContract, GenConfig 확장, CharacterDynamicState 확장 |
| `src/pipeline/state_extractor.ts` | resolved_final_episode 참조 |
| `src/training/schema_versions.ts` | 버전 상수 관리 |
| `src/training/types.ts` | RunTrace 버전 필드 |
| `src/training/trace_logger.ts` | trace 저장 시 버전 자동 포함 |
| `src/db/migrate_v3.ts` | run_traces + character_dynamic_states 컬럼 추가 |
