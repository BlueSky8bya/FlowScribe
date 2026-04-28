# Story Quality Root-Cause + Refactor Plan

**작성일**: 2026-04-29  
**기반 감사**: Gemini 2.5 Flash — test_fantasy_B 30화 (2ac28d7)  
**브랜치**: checkpoint/phase1-launch-prep  
**상태**: 계획 문서 — 코드 수정 없음

---

## 1. 브랜치/상태

| 항목 | 값 |
|---|---|
| 브랜치 | checkpoint/phase1-launch-prep |
| HEAD | 2ac28d7 |
| Working tree | .gitignore + cloud_dpo/launch_dpo.py 수정 (무관) |
| Gemini 감사 자료 | tracking/story_quality_audit/20260429T065644/ (6 chunks + final) |

---

## 2. Gemini 감사 핵심 요약

**전체 판정**: NOT READY (overall_story_quality: 0.35)  
**30화 기준**: FAIL 13화 / WARN 9화 / PASS 8화

### NOT READY 이유 (5대 치명 문제)

1. **character_dynamic_states 누락** — 7개 화(15, 17, 19, 21, 24, 27, 28화)에서 행 없음. DB 직접 확인.
2. **인물 alias 혼란** — canonical 4명인데 dynamic states에 9개 명칭 존재 ('아이', '어린아이', '그림자 속 아이', '그림자 속 존재', '낯선 기사')
3. **의식 상실 반복** — 아르넬 21~23화 3회 연속 동일 패턴 반복
4. **소지품/위치 불일치** — 초기 소지품 미반영(2~5화), 무기 명칭 혼재(25화), 위치 이동 설명 없음(30화)
5. **최종화 완결감 약함** — finalization_quality 0.30, 발루르 존재 방식 미해소

### 독자 관점 핵심 리스크

- 16~20화 구간 PASS 8개 연속이지만 인물 상태 기록이 없어 30화 시점 상태 추론 불가
- foreshadow resolved 88%이지만 키워드 매칭 기반이라 실제 독자 체감 회수 불명확
- 30화 이후 arc 확장 시 alias/entity 문제 기하급수적 악화 가능

---

## 3. 문제 분류

### A. 즉시 수정이 필요한 구조적 버그

| ID | 문제 | 증거 |
|---|---|---|
| BUG-3 | `character_dynamic_states` 7개 화 완전 공백 | DB: eps 15,17,19,21,24,27,28에 rows=0 |
| BUG-4 | carry-over 블록이 `stateUpdates.length > 0` 조건 안에 중첩 | `src/pipeline/index.ts:332` 조건문 |
| BUG-5 | planner가 `character_state_updates=[]` 반환 시 carry-forward 전부 스킵 | planner.ts:877 logWarn 이후 index.ts:332 early-exit |

### B. Entity / Alias Schema 문제

| ID | 문제 | 증거 |
|---|---|---|
| SCHEMA-1 | canonical 4명 vs dynamic states 9개 명칭 | DB: '아이','어린아이','그림자 속 아이','그림자 속 존재','낯선 기사' |
| SCHEMA-2 | entity_type / existence_mode 필드 없음 | canonical_characters 테이블에 type 필드 없음 |
| SCHEMA-3 | alias_map 없음 — '낯선 기사'='발루르'임을 schema로 표현 불가 | canonical_characters.initial_items에 alias 없음 |
| SCHEMA-4 | new_character_allowed가 무조건 통과 | name_classifier.ts:69 — 한국어면 무조건 허용 |

### C. 반복 서술 / Episode Progression 문제

| ID | 문제 | 증거 |
|---|---|---|
| PROG-1 | 의식 상실 3회 연속 반복 (21~23화) | Gemini chunk5 FAIL 판정 |
| PROG-2 | 11~13화 요약≈본문 반복 | chunk3 WARN 판정 |
| PROG-3 | episode_delta_contract 없음 — "이번 화에서 무엇이 변해야 하는가" 미명시 | planner.ts에 must_progress 필드 없음 |
| PROG-4 | continuity_contract가 "이어라"만 있고 "동일 사건 재발 금지" 약함 | planner.ts:503~512 known_facts/forbidden_regressions 존재하나 동적 사건 반복 미탐지 |

### D. Item / Location Continuity 문제

| ID | 문제 | 증거 |
|---|---|---|
| ITEM-1 | 아르넬 초기 소지품(마법 지팡이, 엘프 망토) 2~5화 미반영 | chunk1 FAIL |
| ITEM-2 | 발루르 무기 "암흑 검" vs "핏빛 칼날" 25화 혼재 | chunk5 WARN |
| ITEM-3 | 크로그 위치 이동(심연→입구) 설명 없음 | chunk6 FAIL |
| ITEM-4 | item ledger 없음 — acquire/lose event 요구하지 않음 | pipeline 전체에 item ledger 없음 |
| ITEM-5 | location transition validation 없음 | pipeline에 location move guard 없음 |

### E. Foreshadow 문제

| ID | 문제 | 증거 |
|---|---|---|
| FORE-1 | 키워드 매칭 기반 회수 판정 신뢰도 부족 | foreshadow.ts:149 hitCount 로직 |
| FORE-2 | 1화 복선 근거 불일치 | chunk1 PASS with FAIL note |
| FORE-3 | open 14건 누적 | DB: status='open' 14건 |

### F. Finalization 문제

| ID | 문제 | 증거 |
|---|---|---|
| FINAL-1 | 최종화 완결감 0.30 | Gemini final report |
| FINAL-2 | 발루르 물리적/의식 내 존재 미해소 | chunk6 FAIL |
| FINAL-3 | finalization_contract 없음 | planner에 final_episode_contract 필드 없음 |

### G. 모델 라우팅으로만 해결 가능한 문제 (Phase 7 이후)

| ID | 문제 |
|---|---|
| MODEL-1 | semantic foreshadow audit — 의미 기반 회수 판정 (Gemini/DeepSeek 후보) |
| MODEL-2 | long-arc coherence judge — 30화 넘어 서사 일관성 검증 |
| MODEL-3 | 한국어 장문 추론 능력 향상 (gemma3:12b → 27b 또는 DeepSeek) |

### H. 허용 가능한 품질 이슈 (지금 수정 불필요)

- 일부 화의 대화 문체 차이 (모델 출력 특성)
- arc_summary 추상화 수준 (독자에게 직접 노출되지 않음)
- 16~20화 구간 페이싱 (Gemini 기준 적절함 판정)

---

## 4. 근본 원인 분석

### 4-1. character_dynamic_states 누락 (BUG-3/4/5)

```
문제:
  7개 화(15, 17, 19, 21, 24, 27, 28)에서 character_dynamic_states rows = 0

영향:
  - Gemini/독자 관점에서 인물 상태 공백 → 연속성 붕괴
  - 이후 화의 ctx.character_dynamic_states가 비어 → prev state 기반 carry-over도 안 됨 → 연쇄 누락
  - 50화 이상에서 상태 소실 누적

증거:
  - src/pipeline/index.ts:332 "if (stateUpdates.length > 0 && bookId && ctx.episode_number)"
  - 이 조건 안에 direct commit(355~395) + carry-forward(396~420) + absent-seed(421~443) 전부 포함
  - stateUpdates=[] 이면 carry-forward도 스킵 → DB에 해당 화 rows=0

가능한 원인:
  - DB schema 원인: 없음 (schema는 정상)
  - state extraction 원인: planner가 character_state_updates=[] 반환 시 fallback 없음
  - planner prompt 원인: "character_state_updates 절대 생략 불가" 지시 있으나 LLM이 JSON cut-off 또는
      max_tokens 초과 시 배열을 생략하거나 빈 배열로 반환 가능
  - renderer prompt 원인: 해당 없음
  - validator/audit 원인: stateUpdates=0을 logWarn으로만 처리, FAIL 처리 없음
  - model limitation 원인: gemma3:12b가 긴 JSON 출력 시 character_state_updates 누락 가능

권장 해결 위치:
  src/pipeline/index.ts — if 조건 구조 변경
  "stateUpdates.length > 0" 조건을 direct commit 블록만 감싸고,
  carry-forward(396~443)는 stateUpdates 여부와 무관하게 항상 실행

우선순위: CRITICAL — Phase 1 최우선
```

### 4-2. Alias / Entity 혼란 (SCHEMA-1~4)

```
문제:
  canonical 4명인데 dynamic_states에 9개 명칭 존재
  '아이'/'어린아이'/'그림자 속 아이'/'그림자 속 존재'/'낯선 기사'가 별도 entity로 저장됨

영향:
  - 독자가 같은 인물을 다른 이름으로 만날 때 혼란
  - 발루르='낯선 기사' 정체 폭로가 DB 구조상 지원 안 됨
  - carry-forward 시 orphan 5개가 이전 상태로 계속 전파
  - canonical_names 기반 resolveCanonicalCharName이 이들을 new_character_allowed로 허용 → 무한 증식

가능한 원인:
  - DB schema 원인: canonical_characters에 alias_map / entity_type 없음
  - state extraction 원인: resolveCanonicalCharName이 한국어 신규 명칭을 무조건 허용(name_classifier.ts:69)
  - planner prompt 원인: "새 인물은 canonical에 없는 경우만" 지시가 없음
  - validator 원인: 신규 entity 등장 시 승인/거부 프로세스 없음

권장 해결 위치:
  - canonical_characters 테이블: alias_names[] / entity_type / existence_mode / reveal_status 필드 추가
  - name_classifier: alias_names 배열 기반 매칭 추가
  - pipeline: new_character_allowed 시 플래너 JSON에 "is_new_character: true" 명시 요구

우선순위: HIGH — Phase 2
```

### 4-3. 반복 서술 (PROG-1~4)

```
문제:
  - 아르넬 의식 상실 21/22/23화 연속 반복
  - 11~13화 기억 탐색 요약≈본문 반복
  - hook_type 반복 방지 있으나 세부 사건 레벨 반복 미탐지

가능한 원인:
  - planner prompt 원인:
    * 최근 3화 요약에서 "의식 상실" 패턴을 감지하는 로직 없음
    * episode_delta_contract("이번 화에서 무엇이 달라져야 하는가") 미존재
    * must_progress / forbidden_repeat_events 필드 없음
  - continuity_contract 원인:
    * known_facts에 "아르넬이 의식을 잃음"이 등록되어 있어도
      "다음 화에서 또 잃지 말 것"으로 연결되는 logic 없음
  - renderer 원인: renderer가 planner beat를 그대로 묘사 → 반복 생성

권장 해결 위치:
  - 플래너 context 구성 시 최근 2~3화 summary에서 반복 패턴 키워드 추출
  - episode_delta_contract 필드 추가: must_progress[], forbidden_repeat_events[]
  - renderer에 "직전 화에서 이미 발생한 사건을 같은 방식으로 다시 묘사 금지" 지시

우선순위: HIGH — Phase 3
```

### 4-4. Item / Location 불일치 (ITEM-1~5)

```
문제:
  - 아르넬 초기 소지품이 2화부터 누락
  - 크로그 위치 이동 설명 없음
  - item 명칭이 화마다 달라짐 (암흑 검/핏빛 칼날)

가능한 원인:
  - DB schema 원인: item ledger 없음. canonical_characters.initial_items → dynamic_states 자동 seed 로직이
    absent-seed commit에만 있고, 이후 화 업데이트 시 planner 출력이 items=[] 반환하면 canonical로 fallback
    되는 로직은 있으나(index.ts:365~369) planner가 items를 아예 안 넣으면 prev items 사용 → 초기 화에서
    prev가 없으면 canonical fallback 작동해야 하는데, 1화 absent-seed가 없었던 화의 경우 prev도 없어 canonical
    items도 없이 빈 배열이 될 수 있음
  - planner 원인: item 명칭 일관성 강제 없음. "canonical items 명칭을 그대로 사용" 지시 없음
  - location 원인: location transition validation 없음. "이동 근거 required" 지시 없음

권장 해결 위치:
  - canonical_characters.initial_items를 1화부터 guaranteed seed로 사용
  - planner prompt: "item 명칭은 canonical_characters.initial_items의 name 필드 그대로 사용"
  - Phase 4에서 item ledger 및 location transition 검증 추가

우선순위: MEDIUM — Phase 4
```

### 4-5. Foreshadow 회수 신뢰도 (FORE-1~3)

```
문제:
  - 키워드 매칭 기반 회수 판정: 키워드 2개 이상 본문에 포함되면 resolved
  - 독자 관점에서 "회수됐다"고 느끼지 못하는 경우도 resolved로 마킹 가능
  - open 14건 누적 (30화 기준)

가능한 원인:
  - algorithm 원인: foreshadow.ts:149의 hitCount 로직은 단순 string.includes()
    → "아르넬"과 "마법" 두 키워드가 포함되기만 해도 resolved → false positive 높음
  - LLM audit 원인: semantic 회수 여부를 LLM으로 검증하는 step 없음

권장 해결 위치:
  - Phase 5: arc 생성 시점(10화 단위)에 LLM semantic foreshadow audit 추가
  - 비용 최적화: arc_summary 생성과 같은 시점 활용
  - resolved_confidence 필드 추가 (0~1)

우선순위: MEDIUM — Phase 5
```

### 4-6. Finalization 약함 (FINAL-1~3)

```
문제:
  - 30화에서 발루르 존재 방식 미해소
  - finalization_contract 없음
  - 감정적 보상 부족

가능한 원인:
  - planner 원인: finalization 전용 지시가 일반 지시에 포함되어 있으나
    "모든 핵심 갈등 해소", "새 대형 떡밥 금지" 강도 약함
  - schema 원인: entity_type/existence_mode 없어서 발루르의 최종 상태를 
    명확히 정의하기 어려움

권장 해결 위치:
  - Phase 6: finalization_contract 필드 추가
  - SCHEMA-2/3 해결과 연동 (Phase 2)

우선순위: MEDIUM — Phase 6
```

---

## 5. 리팩터링 방향

### A. Character State Carry-over Layer (Phase 1 핵심)

**현재 문제**: `if (stateUpdates.length > 0 && bookId && ctx.episode_number)` 조건이 carry-over 전체 포함.

**목표 구조**:
```typescript
// stateUpdates > 0인 경우만 direct commit
if (stateUpdates.length > 0 && bookId && ctx.episode_number) {
  // ... direct commit (lines 355~395)
}

// carry-forward는 항상 실행 (stateUpdates=0이어도)
if (bookId && ctx.episode_number) {
  // carry-forward for absent characters (lines 396~420)
  // absent seed for canonical characters (lines 421~443)
  // carry-over source 표시: state_source = stateUpdates.length > 0 ? "planner" : "carried_forward"
}
```

**추가 요소**:
- carry-forward된 상태에 `state_source: "carried_forward"` 필드 추가 (DB 컬럼 또는 JSONB)
- planner가 stateUpdates=[]를 반환하면 WARN 로그 + 모니터링 카운터 증가
- verify_long_story_memory.mjs에 "ep당 character_dynamic_states rows > 0" 체크 추가

### B. Entity Registry / Alias Normalization (Phase 2)

**스키마 설계**:
```sql
ALTER TABLE canonical_characters ADD COLUMN IF NOT EXISTS
  alias_names TEXT[] DEFAULT '{}',
  entity_type TEXT DEFAULT 'person',        -- person|spirit|projection|memory_fragment
  existence_mode TEXT DEFAULT 'physical',   -- physical|mental|spiritual|illusion
  reveal_status TEXT DEFAULT 'revealed';    -- hidden|suspected|revealed
```

**name_classifier 개선**:
```typescript
// alias_names 배열 기반 매칭 추가
// '낯선 기사' → canonical['발루르'].alias_names에 포함 → exact match로 처리
function resolveCanonicalCharName(raw, canonicals):
  1. exact match (canonical.name)
  2. alias match (canonical.alias_names 배열)
  3. prefix/honorific match
  4. non-Korean filter
  5. new_character_allowed (마지막 수단)
```

**정책**:
- '아이'/'어린아이'/'그림자 속 아이'/'그림자 속 존재' → alias_names 또는 별도 canonical로 등록 결정 필요
- '낯선 기사' → 발루르의 alias_names에 추가
- entity_type=spirit/projection인 경우 physical_state는 N/A

### C. Episode Delta Contract (Phase 3)

**플래너 context 추가 필드**:
```json
{
  "episode_delta_contract": {
    "must_progress": [
      "아르넬은 단순히 쓰러지는 것이 아니라, 새로운 단서를 얻거나 상태가 구체적으로 변화해야 한다."
    ],
    "forbidden_repeat_events": [
      "의식 상실 장면 (직전 2화에서 이미 발생)"
    ],
    "required_state_changes": ["세라 또는 크로그의 구체적 행동"]
  }
}
```

**구현 방식**:
- 플래너가 ctx를 받을 때 최근 2~3화 summary에서 반복 패턴 키워드 추출 (deterministic)
- forbidden_repeat_events에 추출된 패턴 자동 주입
- renderer에도 forbidden_repeats 전달

### D. Repetition Detector (Phase 3 보조)

```typescript
// 최근 3화 summary에서 반복 이벤트 패턴 추출
const REPEAT_PATTERNS = [
  { pattern: /의식을 잃|쓰러|실신|기절/, label: "consciousness_loss" },
  { pattern: /기억 속|과거 회상|회상/, label: "memory_flashback" },
  { pattern: /마법.*실패|마력.*불안정/, label: "magic_failure" },
];
// 최근 N화 중 2회 이상 등장하면 → forbidden_repeat_events에 추가
```

### E. Item / Location Ledger (Phase 4)

**item ledger 원칙**:
- canonical_characters.initial_items → 1화부터 보장된 seed
- item 등장 시 event: "initial" | "acquired" | "used" | "lost"
- planner prompt: "item 명칭은 canonical item name 그대로 사용 (별칭/묘사명 금지)"
- 검증: dynamic_states.items ∩ canonical.initial_items 명칭 일치 여부

**location ledger 원칙**:
- location 변경 시 planner beat에 이동 근거 명시
- deterministic validator: 이전 location → 현재 location 물리적 가능성 체크 (기초)

### F. Foreshadow Semantic Audit (Phase 5)

**설계**:
```typescript
// arc_summary 생성 시점(10화 단위)에 실행
async function auditForeshadows(bookId, arcEnd, arcEpisodes):
  1. open 복선 목록 조회
  2. arc 내 episodes content 조합
  3. Gemini/DeepSeek: "이 복선이 이 아크에서 독자 관점에서 회수됐는가?" 판단
  4. 결과: resolved_confidence 0~1 업데이트
  5. confidence > 0.7 → soft_resolved, > 0.9 → resolved, < 0.3 → open 유지
```

**비용 최적화**: 10화 단위만 실행, gemini-2.5-flash-lite 또는 DeepSeek 사용

### G. Finalization Contract (Phase 6)

**플래너 finalization 지시 강화**:
```json
{
  "finalization_contract": {
    "must_resolve": ["발루르의 물리적/의식적 존재 방식 최종 정의", "아르넬의 해방/포획 결말"],
    "must_close": ["세라와 크로그의 역할 마무리"],
    "forbidden_new_threads": true,
    "emotional_payoff_required": true,
    "open_threads_intentional": ["그림자 속 아이의 정체 (다음 아크 복선)"]
  }
}
```

---

## 6. Phase별 구현 계획

### Phase 0 — 감사/계획 (현재 완료)
- **목표**: Gemini 보고서 + DB 교차 검증 + 근본 원인 분석
- **산출물**: `docs/story-quality-root-cause-refactor-plan.md`
- **DoD**: 이 문서

---

### Phase 1 — Hard Bug Fix (character_dynamic_states 누락)

**목표**: stateUpdates=[] 시에도 carry-forward 실행 보장

**수정 후보 파일**:
- `src/pipeline/index.ts` (L332 조건문 구조 변경)
- `scripts/verify_long_story_memory.mjs` (ep당 cds rows > 0 체크 추가)

**구체 변경**:
```typescript
// BEFORE (L332):
if (stateUpdates.length > 0 && bookId && ctx.episode_number) {
  // direct commit + carry-forward + absent-seed 전부
}

// AFTER:
if (stateUpdates.length > 0 && bookId && ctx.episode_number) {
  // direct commit only (lines 355~395)
}
if (bookId && ctx.episode_number) {
  // carry-forward for absent (lines 396~420) — 항상 실행
  // absent seed for canonical (lines 421~443) — 항상 실행
  // state_source 필드: stateUpdates.length > 0 ? "planner" : "carried_forward"
}
```

**테스트**:
- `node scripts/verify_long_story_memory.mjs --episodes 30 --mode trace` → ep별 cds rows ≥ 4 확인
- unit: stateUpdates=[] 화에서도 canonical 4인물 rows 생성 확인

**DoD**: test_fantasy_B 전체 30화에서 character_dynamic_states 공백 화 = 0

**위험**: carry-forward 화에 state_source="carried_forward" 표시 시 기존 query 영향 없음 (컬럼 추가이므로 null-safe)

**예상 난이도**: ★☆☆☆☆ (조건문 구조 변경 + verify 스크립트 보강)

---

### Phase 2 — Entity / Alias Normalization

**목표**: canonical 4명 외 alias 5종 정규화. 발루르='낯선 기사' alias 등록. 아이 계열 정책 결정.

**수정 후보 파일**:
- `src/db/migrate_v6.ts` 또는 새 `migrate_v7.ts` (컬럼 추가)
- `src/lib/name_classifier.ts` (alias 배열 매칭 추가)
- `src/services/character_state.ts` (alias 기반 조회)
- `src/pipeline/index.ts` (resolveCanonicalCharName에 alias 전달)

**사전 결정 필요** (Claude가 임의로 결정 불가):
- '아이'/'어린아이'/'그림자 속 아이'/'그림자 속 존재'는 → 단일 canonical entity(별칭) vs 별도 entity?
- '낯선 기사' → 발루르의 alias_names에 추가?
- entity_type 값 목록 확정

**DoD**: dynamic_states에 canonical 외 명칭 0건. alias 매칭으로 drift_corrected 처리.

**위험**: 기존 dynamic_states에 저장된 '아이' 등 rows 처리 (마이그레이션 or 무시)

**예상 난이도**: ★★★☆☆

---

### Phase 3 — Episode Delta Contract + Repetition Guard

**목표**: 플래너가 동일 사건 반복 생성 억제

**수정 후보 파일**:
- `src/pipeline/planner.ts` (episode_delta_contract 주입 로직)
- `src/pipeline/state_extractor.ts` (반복 패턴 추출 함수)
- `src/types/planner.ts` (episode_delta_contract 타입)

**구체 변경**:
- `extractStateConstraints(ctx)` 반환값에 `episode_delta_contract` 추가
- 최근 2~3화 summary에서 REPEAT_PATTERNS 매칭 → forbidden_repeat_events 자동 생성
- 플래너 프롬프트에 forbidden_repeat_events 섹션 주입

**DoD**: 21~23화 같은 패턴이 재생성 시 플래너가 다른 beat를 선택하는지 fixture 테스트 통과

**위험**: 너무 강한 금지는 플래너 자유도 감소 → forbidden 항목을 최근 2화로 제한

**예상 난이도**: ★★☆☆☆

---

### Phase 4 — Item / Location Continuity

**목표**: 인물 소지품 일관성 + 위치 이동 근거 요구

**수정 후보 파일**:
- `src/pipeline/planner.ts` (item 명칭 강제 지시)
- `src/pipeline/index.ts` (items seed 로직 검증)
- `src/pipeline/state_extractor.ts` (item ledger 보조)

**구체 변경**:
- 플래너 context에 canonical item 명칭 명시: "item 이름은 반드시 canonical_characters.initial_items의 name 필드 그대로 사용"
- location 변경 시 beat에 move_reason 필드 요구 (optional but logged)

**DoD**: 아르넬 초기 소지품이 1화부터 30화까지 동일 명칭으로 유지되는지 verify 체크 추가

**예상 난이도**: ★★☆☆☆

---

### Phase 5 — Foreshadow Semantic Audit

**목표**: 키워드 매칭 → LLM semantic 회수 판정 보완

**수정 후보 파일**:
- `src/services/foreshadow.ts` (semantic audit 함수 추가)
- `src/api/episodes.ts` (arc 완료 시점에 audit 호출)

**구체 변경**:
- `auditForeshadowsForArc(bookId, arcNumber, arcContent)` 함수 추가
- arc_summary 생성 직후(10화 단위) 실행
- Gemini gemini-2.5-flash-lite 또는 DeepSeek 사용
- DB: foreshadows 테이블에 `resolved_confidence REAL` 컬럼 추가

**DoD**: foreshadow audit 실행 시 false positive(키워드 매칭이지만 실제 미회수) 건수 확인

**예상 난이도**: ★★★☆☆

---

### Phase 6 — Finalization Quality

**목표**: 최종화에서 핵심 갈등 해소 + 감정적 보상 강화

**수정 후보 파일**:
- `src/pipeline/planner.ts` (finalization_contract 섹션 강화)
- `src/types/planner.ts` (finalization_contract 타입)

**구체 변경**:
- finalEpisodeNumber 도달 시 finalization_contract 자동 생성
- must_resolve: 미해소 open foreshadows + 핵심 인물 최종 상태
- forbidden_new_threads: true
- entity existence_mode 최종 정의 요구 (Phase 2 연동)

**DoD**: finalization_quality 0.30 → 0.70 이상 (Gemini 재감사 기준)

**예상 난이도**: ★★☆☆☆

---

### Phase 7 — Model Routing Experiment (Phase 1~4 완료 후)

**목표**: 구조 개선 후 모델별 품질 비교

**전제 조건**: Phase 1~4 완료 + 30화 재trace PASS

**후보**:
- planner: gemma3:12b (현재) vs gemma3:27b vs DeepSeek-V3.2
- semantic audit: Gemini gemini-2.5-flash vs DeepSeek
- finalization judge: Gemini Pro급

**DoD**: A/B 비교 점수 (overall_story_quality, character_arc_consistency, foreshadow_recall_accuracy)

**예상 난이도**: ★★★★☆

---

## 7. 우선순위

### 지금 바로 해야 할 것 (50화 actual 전 필수)
1. **Phase 1**: character_dynamic_states carry-over 버그 수정 (`src/pipeline/index.ts:332`)
2. **Phase 2 사전 결정**: alias 정책 결정 (사장 승인 필요)
3. **Phase 3 기초**: forbidden_repeat_events 주입 (planner 반복 억제)

### 50화 actual 전에 해야 할 것
- Phase 1 완료 + 30화 재trace ALL PASS
- Phase 2 (alias registry 기초) 완료
- Phase 3 (episode delta contract) 완료

### 100화 전에 해야 할 것
- Phase 4 (item/location ledger)
- Phase 5 (foreshadow semantic audit)
- Phase 6 (finalization contract)

### 모델 라우팅 전에 해야 할 것
- Phase 1~4 완료 필수
- 30화 재trace overall_story_quality ≥ 0.65 필요
- alias 혼란, state 누락, 반복 서술 제거 후 모델 비교가 공정함

---

## 8. 구현 프롬프트 초안

### Implementation Prompt — Phase 1: Character State Carry-over

```text
목적: character_dynamic_states가 특정 화에서 완전 누락되는 버그 수정

현재 문제:
  src/pipeline/index.ts:332
  "if (stateUpdates.length > 0 && bookId && ctx.episode_number)" 조건이
  direct commit + carry-forward + absent-seed 블록 전체를 감싸고 있어,
  planner가 character_state_updates=[]를 반환하면 carry-forward도 실행되지 않음.
  결과: 7개 화(15,17,19,21,24,27,28)에서 character_dynamic_states rows = 0

수정 방향:
  - "stateUpdates.length > 0" 조건은 direct commit 블록(lines 355~395)만 감쌈
  - carry-forward for absent(lines 396~420) + absent-seed(lines 421~443)는
    별도 조건 "if (bookId && ctx.episode_number)"로 항상 실행
  - carry-forward된 상태에 state_source 표시 (logInfo 수준으로 충분)

수정 금지:
  - resolveCanonicalCharName 로직 변경 금지
  - schema 변경 금지 (이번 Phase에서)
  - 다른 파일 수정 금지

검증:
  npm run build → 0 errors
  node scripts/verify_long_story_memory.mjs --episodes 30 --mode trace --book-id test_fantasy_B
  → 모든 화에서 character_dynamic_states rows >= 4 확인

커밋:
  "fix(pipeline): always carry-forward character states when planner returns empty updates"
```

### Implementation Prompt — Phase 2: Entity Alias Registry

```text
목적: canonical 4명 외 5개 비정규 명칭 정규화 + alias 기반 name resolution

현재 문제:
  - canonical_characters: 발루르/세라/아르넬/크로그 4명
  - character_dynamic_states: 위 4명 + '아이'/'어린아이'/'그림자 속 아이'/'그림자 속 존재'/'낯선 기사'
  - name_classifier.ts:69에서 한국어 신규 명칭을 무조건 new_character_allowed로 허용

수정 방향:
  Step 1: canonical_characters 테이블에 alias_names TEXT[] 컬럼 추가 (migrate)
  Step 2: 사장이 확정한 alias 정책 DB에 반영:
    - 발루르.alias_names = ['낯선 기사', '진정한 발루르', ...]
    - 아이/어린아이/그림자 속 아이 → (사장 결정에 따라)
  Step 3: name_classifier.ts resolveCanonicalCharName에 alias_names 배열 매칭 추가
  Step 4: pipeline/index.ts resolveCanonicalCharName 호출 시 canonicals 객체 전달

사전 필요:
  - 사장이 alias 정책 결정해야 구현 가능 (이 프롬프트는 결정 후 실행)

검증:
  node -e "DB에서 character_dynamic_states distinct names 조회" → canonical 외 0건
```

### Implementation Prompt — Phase 3: Episode Delta Contract

```text
목적: 플래너가 동일 사건 3화 연속 반복 생성 억제

현재 문제:
  - 아르넬 의식 상실이 21/22/23화 연속 반복 (Gemini FAIL 판정)
  - planner context에 "이번 화에서 무엇이 달라져야 하는가" 명시 없음
  - continuity_contract.known_facts에 "의식 상실"이 등록되어도
    "다음 화에서 반복 금지"로 연결되는 로직 없음

수정 방향:
  1. src/pipeline/state_extractor.ts에 detectRepeatPatterns(recentSummaries) 추가
     - 최근 2화 summary에서 REPEAT_PATTERNS 매칭
     - 결과: forbidden_repeat_events: string[]
  2. src/types/planner.ts에 EpisodeDeltaContract 타입 추가
  3. src/pipeline/planner.ts buildConstraintSection()에 episode_delta_contract 주입
     - forbidden_repeat_events를 "[반복 금지 사건 — 직전 2화 기준]" 섹션으로 추가
  4. forbidden_repeat_events가 비어있으면 섹션 생략 (no-op)

수정 금지:
  - arc_phase별 directives 변경 금지 (이번 Phase에서)
  - renderer 수정 금지 (Phase 3에서 renderer는 간단한 note 추가만)

검증:
  fixture 테스트: 의식 상실이 2화 연속 발생한 컨텍스트에서 플래너가
  forbidden_repeat_events에 "consciousness_loss" 포함하는지 확인
```

### Implementation Prompt — Phase 4: Item / Location Continuity

```text
목적: 인물 소지품 명칭 일관성 + 위치 이동 근거 요구

현재 문제:
  - 아르넬 '마법 지팡이'/'엘프 망토' 2~5화 미반영
  - 발루르 '암흑 검' vs '핏빛 칼날' 명칭 혼재 (25화)
  - canonical_characters.initial_items → dynamic_states seed 로직이 absent-seed에만 있음

수정 방향:
  1. 플래너 context에 "item 명칭 강제" 지시 추가:
     "character_state_updates의 items 배열에서 item.name은 반드시
      canonical_characters.initial_items의 name 필드와 동일한 문자열을 사용하라.
      묘사명(핏빛 칼날 등) 사용 금지."
  2. 1화 initial seed: absent-seed commit 전에 canonical.initial_items를 보장
  3. verify: dynamic_states.items의 name 필드가 canonical name과 일치하는지 체크 추가

수정 금지:
  - DB schema 변경 없음 (이번 Phase에서)
  - item ledger 테이블 추가 없음 (Phase 4에서는 prompt 레벨만)
```

### Implementation Prompt — Phase 5: Foreshadow Semantic Audit

```text
목적: 키워드 매칭 기반 회수 판정을 LLM semantic 판정으로 보완

현재 문제:
  - foreshadow.ts:149 hitCount — string.includes() 기반 → false positive 가능
  - 독자 관점 회수 여부를 LLM이 판단하지 않음

수정 방향:
  1. src/services/foreshadow.ts에 auditForeshadowsForArc(bookId, arcNumber) 추가
     - arc 내 episodes content 조합 (arc_summary + episode summaries)
     - LLM 호출: "이 복선이 이 아크에서 실질적으로 회수됐는가? resolved_confidence 0~1 반환"
     - 모델: gemini-2.5-flash-lite 또는 getSummaryModel()
  2. foreshadows 테이블에 resolved_confidence REAL DEFAULT NULL 컬럼 추가
  3. src/api/episodes.ts arc 완료 시점에 auditForeshadowsForArc 호출 (setImmediate 내)

비용 고려: arc 단위(10화)만 실행, 30화 기준 3회 호출

검증:
  - arc 완료 후 resolved_confidence 값이 채워지는지 확인
  - 기존 checkAndResolveForeshadows는 유지 (호환성)
```

### Implementation Prompt — Phase 6: Finalization Contract

```text
목적: 최종화에서 핵심 갈등 해소 + 감정적 보상 강화

현재 문제:
  - finalization_quality 0.30 (발루르 존재 방식 미해소, 크로그 위치 불명)
  - 플래너 finalization 지시가 일반 지시에 포함되어 강도 약함

수정 방향:
  1. src/types/planner.ts에 FinalizationContract 타입 추가
  2. src/pipeline/planner.ts에 buildFinalizationSection(ctx) 추가
     - 마지막 화(ep >= totalEpisodes - 1)에서만 활성화
     - must_resolve: open foreshadows 상위 3개 + 주요 인물 최종 상태
     - forbidden: "새 대형 갈등 도입", "핵심 인물 상태 미정의"
     - emotional_payoff_required: true
  3. existence_mode 최종 정의 요구 (Phase 2 alias registry 연동)

검증:
  - 30화 재생성 시 Gemini 재감사 finalization_quality >= 0.65 목표
```

---

## 9. GPT에게 넘길 핵심 질문

1. **전체 프롬프트 구조 개선**: 플래너와 렌더러가 각각 어떤 "책임 경계"를 가져야 하는가? 현재 플래너가 prose를 직접 출력하는 구조인지, beat만 내고 렌더러가 prose를 생성하는지 — 이 경계가 명확한가?

2. **Planner와 Renderer 책임 분리**: character_state_updates가 planner에서 나오는데, renderer가 prose를 생성한 후 상태를 추출하는 것이 더 정확한가? 또는 planner의 beat-level 상태 예측을 그대로 믿는 현재 방식이 나은가?

3. **Memory Schema 개선**: rolling_summary → 플래너 피드백 루프를 어떻게 강화할 것인가? 현재 rolling_summary가 플래너 context에 어떻게 주입되는지, 그 정보량이 충분한가?

4. **Deterministic validator vs LLM audit**: 반복 서술 탐지, 소지품 일관성, 위치 이동 검증은 deterministic으로 가고, foreshadow 회수 판정과 finalization 품질은 LLM audit으로 가는 것이 맞는가? 경계를 어떻게 그을 것인가?

5. **모델 라우팅 시작 시점**: Phase 1~4 완료 후 어떤 기준(overall_story_quality, character_arc_consistency, foreshadow_recall_accuracy)으로 모델 라우팅 실험을 시작해야 하는가? 50화 vs 30화 기준?

---

## 10. 최종 판단

| 항목 | 판단 |
|---|---|
| **지금 코드 수정 가능 여부** | **Phase 1만 즉시 가능** — 단순 조건문 구조 변경, 설계 결정 불필요 |
| **바로 수정할 Phase** | **Phase 1** (character_dynamic_states carry-over) |
| **사장 결정 후 수정할 Phase** | **Phase 2** (alias 정책 — '아이' 계열 처리 방식 결정 필요) |
| **Phase 1 완료 후 수정할 Phase** | **Phase 3** (episode delta contract) |
| **50화 actual 가능 시점** | Phase 1+2+3 완료 + 30화 재trace PASS 확인 후 |
| **모델 라우팅 가능 여부** | **현재 불가** — 구조 버그가 남아있는 동안 모델 비교는 무의미 |

### 모델 라우팅에 대한 현재 판단

현재 문제의 상당수는 **모델 능력 문제가 아니라 schema/prompt/state pipeline 설계 문제**다.

- gemma3:12b를 gemma3:27b로 교체해도:
  - alias 혼란 (SCHEMA-1~4) → 재발
  - carry-over 누락 (BUG-3~5) → 재발
  - 반복 서술 (episode_delta_contract 없으면) → 재발
- 모델 라우팅 실험은 Phase 1~4 완료 후 **공정한 비교 기반** 위에서 진행해야 한다
- 단, **semantic foreshadow audit** (Phase 5)과 **finalization judge** (Phase 6)에서는 Gemini/DeepSeek를 독립 모듈로 활용 가능 — 모델 라우팅과 무관하게 Phase 5~6 구현 가능

---

*이 문서는 구현 지침이다. 구현은 각 Phase별 "Implementation Prompt"를 Claude에게 개별 전달할 때 시작한다.*
