# 인물 정책 (Character Policy)

**파일:** `src/types/character_policy.ts` (타입), `src/policies/character_policy_resolver.ts` (리졸버), `src/lib/name_classifier.ts` (분류기)  
**이전 경로:** `src/lib/character_policy_resolver.ts` → re-export shim 유지 (호환성)

## 신규 인물 등장 정책 (NewCharacterPolicy)

| 정책 | 설명 | 기본 장르 |
|---|---|---|
| `closed_cast` | 설정 인물 외 등장 전면 금지 | 추리, 미스터리 |
| `extras_only` | 이름 없는 배경 인물만 허용 | 공포, 스릴러 |
| `named_with_gate` | 이름 있는 신규 인물 허용, 생성기가 명시적으로 도입해야 함 | 판타지, 로맨스, SF 등 |
| `open_cast` | 생성기 재량으로 자유 추가 | 모험 |

## 이름/별칭 정책 (AliasPolicy)

| 정책 | 설명 |
|---|---|
| `strict` | canonical name 표기만 허용 |
| `conservative` | 성씨/호칭/역할 허용, 의도 불분명 약칭은 경고 (기본값) |
| `flexible` | 별명/약칭 포함 폭넓게 허용 |

## 현재 단계

- UI 미노출 — 내부 `resolveCharacterPolicy()` 가 장르 힌트 기반으로 자동 결정
- `GenConfig.character_policy` 필드로 명시 가능 (선택적)
- `src/lib/name_classifier.ts` — 이름 혼동 vs 신규 인물 의미 분리 (validator 독립 유틸)

## 이름 관련 사건 분류 (NameEventKind)

```
canonical_name_confusion      : 기존 인물 이름 잘못 표기, 인물 간 교차 → 하드 위반
alias_or_reference_usage      : 성씨/호칭/역할로 지칭 → 오류 아님
background_extra_introduction : 이름 없는 단역 → 정책에 따라 허용/금지
new_named_character           : 이름 있는 신규 인물 → 정책에 따라 허용/금지
```
