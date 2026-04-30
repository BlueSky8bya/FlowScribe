# World Bible Canonical Source Proposal — Phase 4.20

> 본 문서는 World Bible(세계관 + 절대 규칙 + 인물 + storyConfig) 데이터의 단일 source of truth 제안서다.
> 현재 5개 저장소에 흩어진 동일 정보를 일원화한다.

---

## 1. 현재 저장 구조

```
사용자 UI (saveContext)
  └─> POST /api/context
        ├─ Redis: context:<bookId> (JSON)              [캐시, TTL 7일]
        │     └─ worldBible 통째로
        │
        ├─ books.context (JSONB)                         [영속, 캐시 미스 fallback]
        │     └─ worldBible + storyConfig 통째로
        │
        ├─ world_configs (table)                         [정규화]
        │     └─ background, genre, mood, theme, common_tone
        │     └─ Phase 4.19 추가 (이전엔 비어 있었음)
        │
        ├─ world_rules (table)                           [정규화]
        │     └─ rule_type ∈ {general, absolute_forbidden}
        │     └─ Phase 4.19 추가 (이전엔 비어 있었음)
        │
        └─ canonical_characters (table)                  [정규화]
              └─ name, type, gender, personality, initial_items
```

read 측:
```
buildEffectiveContext
  ├─ Redis context:<bookId>     [worldBibleRaw, line 87]
  ├─ world_configs table        [line 88]
  ├─ world_rules table          [line 89]
  ├─ canonical_characters       [line 91]
  └─ legacyWorldBible.world_rules / forbidden_settings → fallback push (line 150-151)
```

UI restore:
```
GET /api/context/:bookId
  └─ Redis 우선 → books.context fallback
  └─ canonical_characters.initial_items merge로 character_defaults 보강
```

---

## 2. 문제

### 2.1 다중 source desync

같은 절대 규칙이:
- `books.context.forbidden_settings` (사용자가 modal에서 입력한 원본)
- `world_rules` 테이블 `rule_type='absolute_forbidden'` (Phase 4.19 sync 추가)
- Redis 캐시

세 곳에 존재. 만약 어느 한 곳이 stale이면 generation context와 UI restore가 다른 값을 본다.

### 2.2 장르 prefix 잠입

modal.js:263에서 사용자가 "장르: 이세계, 판타지" 입력 → world_rules 배열 첫 줄로 `장르: ${genres.join(", ")}` 삽입. /api/context POST의 Phase 4.19 sync가 그 첫 줄을 `world_configs.genre`로 추출 ([context.ts](../src/api/context.ts)):

```ts
const m = trimmed.match(/^장르\s*[:：]\s*(.+)$/);
if (m && !extractedGenre) extractedGenre = m[1].trim();
else generalRules.push(trimmed);
```

**문제:** UI는 books.context.world_rules의 첫 줄을 "장르"로 알지만, world_rules 테이블에는 그 줄이 없다 (world_configs로 옮김). 두 view가 다른 데이터.

### 2.3 storyConfig 위치 모호

storyConfig (totalEpisodes, episodeLength, pov, style 등)는 books.context.story_config 안에만 있고 정규화 테이블 없음. effective_context.ts:131이 `legacyWorldBible.story_config?.genre` fallback 사용 — 즉 정규화 테이블이 비면 books.context에 의존.

### 2.4 description의 위치

initial_items.description은 사용자 입력 + LLM enrich 둘 다 가능. canonical_characters.initial_items에 저장. 그런데 사용자가 입력한 것인지 LLM 결과인지 표시 없음.

### 2.5 cleanup 어려움

확깨용_TEST cleanup 시 (Phase 4.19C)
- canonical_characters.initial_items.description = LLM 결과 → 비워야 함
- books.context.character_defaults.<name>.initial_items.description = 사용자 입력 → 보존해야 함
- 둘이 같은 path에 저장되어 있어 분리 어려움

---

## 3. 제안: Single Canonical Source = books.context (JSONB)

### 3.1 원칙

**books.context를 canonical, 그 외는 모두 derived (캐시·인덱스).**

- 사용자 입력 = books.context (JSONB) + Redis cache
- 정규화 테이블(world_configs, world_rules, canonical_characters) = books.context의 derived index
- effective_context = books.context + dynamic state(character_dynamic_states 등)

이렇게 하면 desync 가능성이 한 source(books.context) → indexes 단방향이 된다.

### 3.2 books.context schema (제안)

```jsonc
{
  "version": 2,
  "title": "...",                            // 또는 books.title 사용
  "story_config": {
    "genre": "이세계, 판타지, 현대",         // 단일 string (UI에서 칩 join)
    "background": "...",
    "mood": "...",
    "theme": "...",
    "common_tone": "...",
    "totalEpisodes": 100,
    "totalEpisodesVar": 5,
    "resolved_final_episode": 102,
    "episodeLength": 2000,
    "episodeLengthVar": 500,
    "pov": "3인칭 관찰자",
    "style": "균형",
    "conflict": 5, "foreshadow": 5, "emotion": 5, "dialogue": 5, "direction": 5
  },
  "world_rules": {
    "general":   ["..."],
    "absolute":  ["..."]                     // forbidden_settings → absolute로 rename
  },
  "characters": {
    "<name>": {
      "type": "인간",
      "gender": "여성",
      "personality": "...",                  // 사용자 입력
      "initial_items": [
        {
          "name": "갤럭시 노트20",
          "user_description": "현대에서 사용하던 스마트폰이다.",   // 사용자 입력
          "llm_description": "한국에서 챙겨온 마지막 현대문명...", // LLM 결과
          "category": "기기",                                       // 키워드 분류
          "grade": "C"
        }
      ]
    }
  },
  "fixed_relationships": []
}
```

핵심 변화:
- `forbidden_settings` → `world_rules.absolute` (의미 명확화)
- `world_rules` flat array → `general/absolute` 분리 객체
- `character_defaults` → `characters` (간결)
- `initial_items.description` → `user_description` + `llm_description` (분리)

### 3.3 Derived indexes

generation/state-extraction의 fast read를 위해 정규화 테이블은 **derived index**로 유지:

| 테이블 | 채우는 시점 | 권한 |
|---|---|---|
| `world_configs` | books.context.story_config가 변경될 때 자동 sync | derived (직접 수정 금지) |
| `world_rules` | books.context.world_rules가 변경될 때 자동 sync | derived |
| `canonical_characters` | books.context.characters가 변경될 때 자동 sync | derived (단, `initial_items.llm_description`은 LLM enrich가 직접 update) |
| `character_dynamic_states` | generation runtime이 직접 write | runtime 데이터 (canonical 아님) |
| `Redis context:<bookId>` | books.context의 캐시 | derived |

derived 테이블은 cleanup 시 부수 효과 작음. 사용자 입력은 books.context에만.

---

## 4. 마이그레이션 path

### Phase 1 — books.context schema v2 (R4.0)
- 기존 v1 (현재 구조) 그대로 두고 v2 schema 정의
- /api/context POST가 v1 입력을 받으면 v2로 변환 후 저장
- read는 v2 우선, v1 fallback

### Phase 2 — derived index 일원화 (R4.1)
- world_configs / world_rules / canonical_characters는 books.context v2 기반으로 자동 derive
- /api/context POST의 sync 코드가 단순화 (v2 → indexes 단방향)
- 사용자가 modal에서 직접 수정 시 books.context만 update, indexes는 trigger로

### Phase 3 — UI restore 통일 (R4.2)
- restoreContextUI는 books.context v2를 그대로 deserialize
- canonical_characters merge 로직 제거 (books.context.characters에 이미 있음)
- modal.js의 saveContext는 v2 schema로 직접 save

### Phase 4 — initial_items description 분리 (R4.3)
- user_description + llm_description으로 분리
- modal에서 사용자 입력은 user_description 칸에
- LLM enrich는 llm_description만 update
- UI 카드는 llm_description 우선, 없으면 user_description

### Phase 5 — cleanup tool 일원화 (R4.4)
- cleanup은 books.context는 보존, derived index만 reset
- LLM enrich 결과(llm_description, dynamic_states 등)는 derived → cleanup 가능
- 사용자 입력은 books.context의 user_* 필드 → 절대 보존

---

## 5. 호환성

기존 books.context (v1) 그대로 살아있는 책:
- /api/context POST 수신 시 v1 → v2 변환:
  ```
  worldBible.world_rules → context.world_rules.general (장르 prefix 분리 후)
  worldBible.forbidden_settings → context.world_rules.absolute
  worldBible.character_defaults → context.characters
  initial_items[].description → user_description (이미 입력 시) 또는 llm_description (이전 enrich 결과)
  ```
- 변환 시 user_description / llm_description 구분은 휴리스틱 — 길이 + 키워드. 위험 시 user_description으로 보수적 처리.

---

## 6. 위험

| 위험 | 완화 |
|---|---|
| 기존 v1 데이터 변환 오류 | v2 변환 함수 유닛 테스트, 변환 실패 시 v1 그대로 유지 |
| derived trigger의 race condition | books.context update를 transaction으로, indexes는 트리거에서 |
| user_description vs llm_description 분리 휴리스틱 위험 | 첫 마이그레이션 시 모든 description을 user_description으로 보수적 |
| 마이그레이션 중 generation 호출 | v1/v2 dual read |

---

## 7. 검증

`scripts/verify_world_bible_canonical_source.mjs`:
- /api/context POST 입력 v1/v2 둘 다 v2 저장 확인
- derived indexes (world_configs, world_rules, canonical_characters) v2와 동기 확인
- cleanup tool이 books.context v2의 user_* 필드를 절대 건드리지 않는지 확인

`scripts/audit_world_bible_drift.mjs --book-id <X>`:
- books.context vs world_configs / world_rules / canonical_characters / Redis가 동기화되어 있는지 grep

---

## 8. 결론

books.context를 단일 canonical, 정규화 테이블은 derived. v2 schema에서 user_description / llm_description 분리. 마이그레이션은 R4 단계 5단계로 점진적.
