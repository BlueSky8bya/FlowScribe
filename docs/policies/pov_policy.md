# POV 지원 정책

**파일:** `src/types/pov_policy.ts`, `src/lib/pov_rules.ts`  
**진단 일자:** 2026-04-22 (pov-capability-diagnostic)

## 현재 모델: gemma3:12b

### 지원 POV (4종)

| POV | 상태 | 비고 |
|---|---|---|
| 1인칭 주인공 | ✅ 지원 | 오프닝 앵커 적용 필요 (pov_rules.ts) |
| 3인칭 관찰자 | ✅ 지원 | |
| 전지적 작가 | ✅ 지원 | |
| 교차 시점 | ✅ 지원 | few-shot 금지 (위반 0→5 증가) |

### 미지원 POV (1종)

| POV | 이유 | 처리 방식 |
|---|---|---|
| 1인칭 관찰자 | 4개 variant 전부 위반률 100% (2/2 케이스). 모델 능력 한계. | `disabled_for_current_model`: benchmark 기본 제외, 생성 시도는 허용, 자동 변환 금지 |

## 채택 Variant: C (rules-only)

- **Variant C**: avg=67, POV위반=2, FAIL=0 → 채택
- **Variant B (few-shot)**: 교차 시점 위반 0→5 → **영구 채택 금지**
- **Variant D (scaffold)**: FAIL 1건으로 불안정
- **Variant A**: baseline (avg=66, 위반=3)

## 1인칭 주인공 특수 규칙

진단(2026-04-22, protagonist-pov-diagnostic):
- 오프닝 앵커 추가: POV위반 7→5, avg 57→61
- **주의: revision이 1인칭 주인공 케이스를 악화시킴** (FAIL 3→4). revision 시 1인칭 주인공 케이스 점수 하락 가능성 존재.

## 운영 원칙

1. `ACTIVE_POV_POLICY` 상수 (`src/types/pov_policy.ts`) 하나로 모든 정책 관리
2. 모델 교체 시 이 상수만 변경
3. benchmark에서 `filterToSupportedPov()` 사용 시 필터 사실을 항상 콘솔에 명시
4. 미지원 POV 요청 시 silently 다른 POV로 변환 금지 — 사용자에게 명시하거나 그대로 시도

## 관련 코드

```typescript
// 미지원 POV 확인
import { isUnsupportedPov } from "src/types/pov_policy.js";

// 서비스 경로 POV 체크
import { checkPovForService } from "src/lib/pov_rules.js";

// POV 규칙 문자열 생성 (Variant C)
import { variantCPovRule } from "src/lib/pov_rules.js";
```
