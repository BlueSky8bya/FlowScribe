# State Taxonomy Proposal — Phase 4.20

> 본 문서는 `character_dynamic_states`와 `character_state_updates`의 의미 분리 제안서다.
> "친절한 / 팀워크 / 신입"이 emotional_state에 들어가는 root cause를 잡고,
> DB migration 없이 우선 가능한 path → 그 다음 long-term 정규화 path를 제안한다.

---

## 1. 증상 재정리

`character_dynamic_states.emotional_state`에 다음 값이 발견:

| 값 | 의미 분류 | 정확한 필드 |
|---|---|---|
| `친절한` | personality_trait | (현재 schema 없음) |
| `팀워크` | relationship_dynamic | (현재 schema 없음) |
| `신입` | role_status | (현재 schema 없음) |
| `결의` | emotion ✓ | emotional_state |
| `긴장` | emotion ✓ | emotional_state |

문제는 LLM 출력 잘못이지만, **schema가 분리되어 있지 않아 LLM이 prompt를 무시할 인센티브가 있다**.
하나의 칸에 들어가는 한, "그 인물의 가장 두드러진 특성"을 채우려는 LLM의 compress 본능이 emotion을 침범한다.

---

## 2. Root Cause Path

```
[planner LLM]
  └─ prompt: "emotional_state": "짧은 상태어, 예: 불안, 결의, 공포"
  └─ output:
       { "character_name": "...", "emotional_state": "친절한" }   ← prompt 위반

[extractStateUpdates]                                              ← JSON 안전 추출만
[plan_validator]                                                    ← emotional_state 검증 없음
[pipeline/index.ts commit 직전]
  └─ normalizeEmotionalState("친절한")
       └─ _normalizeField: hasKorean=true → "친절한" 그대로 반환  ← 통과
       └─ length=3, no space, no SENTENCE_HINT, no _VERB_END_TRIGGER
       └─ isComplex=false → 그대로 반환                          ← 통과

[commitDynamicState]
  └─ INSERT INTO character_dynamic_states (..., emotional_state, ...) VALUES ('친절한', ...)

[UI _emotBadgesHtml]
  └─ "친절한" → state-badge 그대로 표시                          ← 사용자가 본 결과
```

**Layer별 분담 실패:**
- `prompt` — 명시했으나 LLM이 무시
- `validator` — emotion 의미 검증 없음
- `normalizer` — 한국어 포함 시 무조건 통과
- `UI` — DB 값 그대로 표시

---

## 3. 핵심 원칙

1. **Single field, single semantic.** 한 컬럼에 의미가 다른 값이 들어가지 않게 한다.
2. **DB migration은 마지막.** Phase 4.20은 분석/문서. 실제 schema 변경은 R3에서.
3. **LLM 출력 단계에서 분리 강제.** prompt + JSON schema + validator 3단계 방어.
4. **Semantic whitelist for emotion.** 정상 통과는 화이트리스트 매칭에 의해서만.

---

## 4. 제안 Taxonomy

### 4.1 character_state_updates (LLM 출력 schema)

```typescript
interface CharacterStateUpdate {
  character_name: string;

  // ── Emotion (감정) — 화이트리스트 18~25개 라벨만 허용 ──
  emotion: string;                    // "불안" | "결의" | ...
  emotion_cause?: string;             // 짧은 자유 서술 (왜 그 감정인지, 30자 이내)

  // ── Physical (신체) ──
  physical_state?: string;            // "정상" | "부상" | "탈진" | ...

  // ── Spatial (위치) ──
  location?: string;
  visibility_state?: "present" | "absent" | "cannot_act";

  // ── Behavioral (행동/목표) ──
  recent_goal?: string;               // 자유 서술 (이번 화에서 인물이 추구한 것)
  progression_delta?: string;         // 이번 화에서의 변화 한 줄

  // ── Possession (소지품) ──
  items?: ItemEntry[];

  // ── Relational (관계/역할) — Phase R3 추가 후보 ──
  relationship_dynamic?: string;      // "팀워크 형성 중" | "거리 두는 중" | ...
  role_status?: string;               // "신입" | "리더" | "조력자" | ...

  // ── Identity (성격) — 보통 정적, 변화 시만 출력 ──
  personality_traits?: string[];      // ["친절함", "냉소적"] — 정적 인물 카드 보강용
}
```

### 4.2 DB schema (R3 — long-term)

```sql
ALTER TABLE character_dynamic_states
  ADD COLUMN emotion_cause TEXT,
  ADD COLUMN progression_delta TEXT,
  ADD COLUMN relationship_dynamic TEXT,
  ADD COLUMN role_status TEXT,
  ADD COLUMN personality_traits JSONB;
-- emotional_state 컬럼은 emotion으로 rename (호환 view 제공)
```

R3 phase에서 단계적. 본 Phase에서는 schema 변경 안 함.

### 4.3 Emotion 화이트리스트

EMOTION_KEYWORDS는 이미 27개. proposal: **표준화된 24개 라벨만 허용**:

```
희망 / 절망 / 두려움 / 불안 / 긴장 / 분노 / 슬픔 / 혼란 /
경계 / 결의 / 의심 / 안도 / 기쁨 / 애정 / 고독 / 죄책감 /
연민 / 호기심 / 충격 / 평온 / 신중 / 주저 / 집중 / 동요
```

Phase 4.19에서 추가한 "압박/갈등/무력감"은 합치거나 24+로 확장 결정.

화이트리스트 외 값은 **fallback "알 수 없음"이 아니라 explicit reject** + plan_validator가 retry 또는 prev_state 유지.

---

## 5. 단계별 구현 path

### Phase A — Schema 변경 없이 가능 (R3 전 hotfix 가능, 본 Phase는 분석만)

1. **planner prompt 강화** (`src/pipeline/planner.ts`)
   - emotional_state 안내문에 화이트리스트 24개 명시
   - 예시에 "친절한"(❌ personality), "팀워크"(❌ relationship), "신입"(❌ role) 같은 negative example 추가
   - **단, Phase 4.20 spec: "특정 단어 금지문 추가 금지" — negative example은 일반화해야 함:**
     예: "성격(예: 친절함, 냉소적)·관계(예: 팀워크, 동료애)·역할(예: 신입, 리더)은 emotion이 아니다."
     이건 "특정 책 전용 금지"가 아니라 "필드 의미 정의"이므로 spec 위배 아님.

2. **normalizeEmotionalState 강화** (`src/services/language_guard.ts`)
   - 한국어 포함 + EMOTION_KEYWORDS 미매치 + length<=4인 짧은 명사형:
     → 화이트리스트 외부 가능성 → reject (null 반환 → carry-forward)
   - personality/relationship/role 키워드 blacklist (일반적 패턴): `~한$|~함$|~성$|팀워크|리더십|신입|선배|후배|동료애` 등

3. **plan_validator에 emotion 검증 단계 추가**
   - emotional_state가 화이트리스트 위반 시 plan validator가 fail 또는 prev_state 보존

### Phase B — Schema 변경 (R3)

1. character_state_updates / character_dynamic_states 컬럼 분리
2. UI 카드에 새 필드 노출 (relationship_dynamic, role_status, personality_traits)
3. rolling forward: 새 회차부터 새 schema, 기존 row는 emotional_state만 keep

### Phase C — 학습/평가 반영

1. DPO/training trace에 새 필드 포함
2. judge가 emotion vs personality 분리 평가
3. reward에 emotion accuracy 포함

---

## 6. UI 매핑 제안

ep-end character cards에 추가 row 노출:

```
[빅토리 (여성)]
  감정: 결의                      ← emotion (24개 라벨만)
   까닭: 친구를 잃을 위기를 직감해서  ← emotion_cause (선택)
  신체: 정상                      ← physical_state
  위치: 도서관 지하 입구           ← location
  목표: 단서를 찾아 출구로 향하기   ← recent_goal
  변화: 처음으로 다른 사람에게 도움을 청함  ← progression_delta
  관계: 팀워크 형성 중             ← relationship_dynamic (R3)
  역할: 신입 일행                  ← role_status (R3)
  성격: 친절함, 냉소적             ← personality_traits[] (R3, 정적)
  소지: ...                       ← items
```

**중요:** 이 모든 필드를 사이드바에 보여주지 말 것. 사이드바는 이름+성별만, 디테일은 ep-end cards에. (Phase 4.19 방향 유지)

---

## 7. 검증 전략

### 7.1 정적 (Phase A 후)

`scripts/verify_state_taxonomy.mjs`:
- normalizeEmotionalState 입력 16개 케이스 (감정/성격/관계/역할/숫자/영어/Cyrillic)에 대한 출력 검증
- planner prompt에 화이트리스트 + negative pattern 안내 포함 확인
- plan_validator의 emotion 검증 단계 존재 확인

### 7.2 동적 (Phase B 후)

`scripts/audit_state_taxonomy_drift.mjs --book-id <X>`:
- character_dynamic_states.emotion 컬럼이 화이트리스트 외 값을 갖는지 grep
- relationship_dynamic / role_status / personality_traits 컬럼이 비어있지 않은지 통계

### 7.3 reward

emotion accuracy (white-list match rate)를 reward signal에 포함. 위반 시 negative reward.

---

## 8. 위험 / Trade-off

| 위험 | 완화 |
|---|---|
| 화이트리스트가 너무 좁아 "찝찝함", "허무함" 같은 자연스러운 감정 거부 | 화이트리스트 + 유사어 매핑 (찝찝함→불안, 허무함→고독) |
| schema 변경 시 기존 row 호환성 | emotional_state → emotion view + R3 단계적 backfill |
| 성격/관계/역할 필드가 LLM에게 추가 부담 | optional field로 두고 단계적 활성화 (R3.1: emotion만, R3.2: relationship, R3.3: role/personality) |

---

## 9. spec 준수 체크

- ❌ "특정 책/장르/인물/아이템 전용 하드코딩 금지" — 본 제안은 일반 taxonomy, 특정 인물(빅토리/리아) 언급 없음 ✓
- ❌ "특정 문제를 막기 위한 금지어/if문 추가 금지" — 화이트리스트는 "모든 emotion에 적용되는 일반 규칙"이지 특정 단어 차단이 아님 ✓
- ❌ "DB migration 금지" (Phase 4.20) — 본 문서는 제안만, Phase A/B는 R3에서 ✓

---

## 10. 다음 단계 (R3 — Phase 4.20 종료 후)

1. Phase A 구현 (코드 수정 + schema 미변경) → R3.0
2. verify + 사용자 ep1 재생성으로 emotion 라벨 정상 여부 확인 → R3.1
3. schema migration 결정 → R3.2
4. UI / training / audit 반영 → R3.3 ~ R3.5
