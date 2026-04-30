# State Taxonomy SOP

> 인물 상태 5필드(emotion / personality / role / relationship / goal) 분리 운영 지침.
> 상세 진단·구현안: `state-taxonomy-proposal.md`.

---

## 1. 핵심 원칙

**한 칸에 한 의미.** emotion 칸에 personality / role / relationship 단어 들어가면 안 됨.

| 분류 | 예 | 현재 컬럼 | R3 후 컬럼 |
|---|---|---|---|
| emotion (감정) | 결의, 불안, 두려움 | `emotional_state` | `emotion` |
| emotion_cause (감정 까닭) | "친구를 잃을 위기를 직감해서" | (없음) | `emotion_cause` |
| physical_state (신체) | 정상, 부상, 탈진 | `physical_state` | 동일 |
| location (위치) | "도서관 지하 입구" | `location` | 동일 |
| recent_goal (목표) | "단서를 찾아 출구로 향함" | `recent_goal` | 동일 |
| progression_delta (변화) | "처음으로 도움 청함" | (없음) | `progression_delta` |
| relationship_dynamic (관계) | "팀워크 형성 중" | (없음) | `relationship_dynamic` |
| role_status (역할) | "신입", "리더" | (없음) | `role_status` |
| personality_traits (성격) | ["친절함", "냉소적"] | (없음, character.personality에 묻혀 있음) | `personality_traits[]` |

## 2. 현재 오염 (Phase 4.20 forensic)

`character_dynamic_states.emotional_state`에 다음 발견:
- **친절한** ← personality_trait
- **팀워크** ← relationship_dynamic
- **신입** ← role_status

원인 path:
1. planner LLM이 prompt 무시하고 비-emotion 단어 출력
2. `extractStateUpdates` JSON 안전 추출만, 변환 없음
3. `normalizeEmotionalState`가 한국어 포함 시 무조건 통과 (`language_guard.ts:90`)
4. `commitDynamicState` DB 저장
5. UI `_emotBadgesHtml` 그대로 표시

## 3. Emotion 화이트리스트

24개 표준 라벨 (확장 가능):
```
희망 / 절망 / 두려움 / 불안 / 긴장 / 분노 / 슬픔 / 혼란 /
경계 / 결의 / 의심 / 안도 / 기쁨 / 애정 / 고독 / 죄책감 /
연민 / 호기심 / 충격 / 평온 / 신중 / 주저 / 집중 / 동요
```

`src/services/language_guard.ts EMOTION_KEYWORDS` 패턴이 정본.

화이트리스트 외 값은 **정규화 fail → carry-forward 또는 명시 reject** (현재는 통과 허용 — R3에서 차단).

## 4. 단계적 구현 (R3)

### R3.0 — schema 미변경 hotfix
- planner system prompt에 화이트리스트 + non-emotion negative example 추가 ("성격(친절함)·관계(팀워크)·역할(신입)은 emotion이 아니다")
- `normalizeEmotionalState`에 non-emotion 패턴 blacklist (`~한$|~함$|~성$|팀워크|리더십|신입|선배|후배|동료애` 등)
- plan_validator에 emotion 검증 단계 (whitelist 위반 시 prev_state carry-forward)

### R3.1 — schema 확장
- `character_dynamic_states`에 `emotion_cause / progression_delta / relationship_dynamic / role_status / personality_traits` 컬럼 추가 (DB migration 필요, 사장 승인 후)
- `CharacterStateUpdate` interface 확장
- `emotional_state` → `emotion` rename (호환 view 제공)

### R3.2 — UI 반영
- ep-end character cards에 row 추가 (관계/역할/성격)
- 사이드바는 minimal 유지 (이름+성별만)

### R3.3 — Training/audit
- trace_logger에 새 필드 포함
- reward signal에 emotion accuracy

## 5. 변경 시 verify

```bash
node scripts/verify_state_language_guard.mjs
node scripts/verify_emotion_label_normalization.mjs
node scripts/verify_state_taxonomy.mjs            # R3.0 후 신규
node scripts/audit_state_taxonomy_drift.mjs --book-id <X>   # R3.1 후 신규
```

## 6. 디버깅 체크리스트

### "감정 칸에 이상한 값"
1. DB 직접 query: `SELECT character_name, emotional_state FROM character_dynamic_states WHERE book_id=$1 ORDER BY episode_number DESC LIMIT 20`
2. 값이 화이트리스트 외 → planner prompt 또는 normalizer 통과 검증
3. `language_guard.ts normalizeEmotionalState` 시뮬레이션:
   ```ts
   import { normalizeEmotionalState } from "./dist/services/language_guard.js";
   normalizeEmotionalState("친절한")  // 현재 → "친절한" (통과 허용)
   ```
4. R3.0 적용 후 → reject 또는 화이트리스트 매핑

### "감정이 모두 미파악"
1. planner LLM이 emotional_state 미생성
2. 또는 normalize가 영어/혼합 입력 받아 "알 수 없음" 반환
3. carry-forward 로직 작동 여부 확인 (`pipeline/index.ts` commit 직전)

## 7. 금지

- ❌ "특정 단어 차단" 식의 hardcoded 금지 리스트 (예: "빅토리는 ~ 금지") — taxonomy는 일반 규칙
- ❌ emotion 칸을 자유 텍스트로 두는 prompt instruction (whitelist 강제)
- ❌ schema 변경 없이 emotion_cause/role_status 등을 emotional_state에 통합 저장 (의미 충돌 재발)
- ❌ DB migration 무단 실행 (R3.1은 사장 승인 후)
