# Character Policy — 설계 문서

## 목적

이름 혼동(canonical_name_confusion)과 신규 인물 도입(new_character_introduction)을
시스템 내부에서 명확히 분리하여, validator와 generator가 두 개념을 혼동하지 않도록 기반 레이어를 구축한다.

---

## 추가된 파일

| 파일 | 역할 |
|---|---|
| `src/types/character_policy.ts` | 정책 타입 + 이름 사건 분류 타입 |
| `src/lib/character_policy_resolver.ts` | 장르/세계관 기반 기본 정책 리졸버 |
| `src/lib/name_classifier.ts` | 이름 표기 → 사건 분류 유틸 |

---

## 이름 사건 분류 체계 (NameEventKind)

| kind | 의미 | 오류 여부 |
|---|---|---|
| `canonical_name_confusion` | 기존 인물 이름 오기 / 인물 간 교차 혼동 | 오류 |
| `alias_or_reference_usage` | 성씨·호칭·역할 지칭으로 기존 인물 언급 | 정상 |
| `background_extra_introduction` | 이름 없는 배경/단역 등장 | 정책에 따라 |
| `named_new_character_introduction` | 이름 있는 신규 인물 등장 | 정책에 따라 |

---

## 기본 정책값 (현재 단계)

| 항목 | 기본값 | 이유 |
|---|---|---|
| `new_character_policy` | `named_with_gate` | 장르 힌트 없으면 보수적 허용 |
| `background_extras_allowed` | `true` (closed_cast 제외) | 배경 단역은 대부분 허용 |
| `alias_policy` | `conservative` | 성씨·호칭은 허용, 의도 불분명한 약칭은 경고 |

장르별 `new_character_policy` 힌트:
- 추리/미스터리 → `closed_cast`
- 공포/스릴러 → `extras_only`
- 판타지/로맨스/SF/무협 → `named_with_gate`
- 모험 → `open_cast`

---

## UI를 아직 추가하지 않은 이유

1. 이번 단계 목적은 "구조 분리"이지 "즉시 사용자 제어 노출"이 아니다.
2. `CharacterPolicyConfig`는 `GenConfig`에 optional 필드(`character_policy?`)로 추후 삽입 가능하게 설계되어 있다.
3. 내부 리졸버(`resolveCharacterPolicy`)가 기본값을 채우므로 UI 없이도 동작한다.
4. UI를 먼저 붙이면 타입 변경 시 프론트엔드 대응 비용이 추가로 발생한다.

---

## 다음 단계에서 연결할 위치

### 1순위 — generator (test_runner.ts / story.ts)
`buildGenPrompt()` 또는 `buildStoryPrompt()` 내부에서 `resolveCharacterPolicy()`를 호출해
`new_character_policy` 값을 시스템 프롬프트에 주입한다.

```typescript
import { resolveCharacterPolicy } from "../lib/character_policy_resolver.js";
const policy = resolveCharacterPolicy(undefined, ctx.world_config);
// 시스템 프롬프트에 policy.new_character_policy 주입
```

### 2순위 — validator (validator.ts)
`parseValidationResult()` 또는 후처리 단계에서 `analyzeNameEvents()`를 호출해
hard_violation의 "인물 이름 혼동" 판정을 세분화한다.
→ `canonical_name_confusion`만 hard_violation으로, `alias_or_reference_usage`는 제외.

### 3순위 — GenConfig 타입 확장
```typescript
// src/types/canonical.ts
export interface GenConfig {
  // ... 기존 필드 ...
  character_policy?: Partial<CharacterPolicyConfig>; // 향후 UI 노출 시 사용
}
```

---

## 현재 validator / generator와의 연결 상태

- validator.ts: **미연결** (R7-FREEZE 유지, 수정 금지)
- test_runner.ts (buildGenPrompt): **미연결** (다음 단계에서 연결)
- story.ts (buildStoryPrompt): **미연결**

---

## 남은 리스크

1. `isNameConfusion()` 편집 거리 로직이 한글 특성(자모 단위) 미반영 → 오탐 가능성 존재. 향후 jamo-level 비교로 교체 권장.
2. `BACKGROUND_EXTRA_PATTERNS`이 단순 regex — 도메인별(무협/판타지/현대) 추가 패턴 필요.
3. `alias_policy: "flexible"` 모드는 부분 문자열 허용으로 단순 구현 — 실제 적용 시 오탐 검증 필요.
