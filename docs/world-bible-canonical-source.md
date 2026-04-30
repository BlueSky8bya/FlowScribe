# World Bible Canonical Source SOP

> 사용자 입력 World Bible의 단일 source of truth + derived index 운영 지침.
> 상세 진단·구현안: `world-bible-canonical-source-proposal.md`.

---

## 1. 핵심 원칙

**books.context = canonical. 그 외는 모두 derived (캐시 / 정규화 인덱스).**

- 사용자 modal 입력 → `books.context` (JSONB) + Redis cache
- 정규화 테이블(`world_configs`, `world_rules`, `canonical_characters`) = books.context의 derived index
- effective_context = books.context + dynamic state

→ desync 방지: 단일 source → indexes는 단방향 sync.

## 2. 현재 (Phase 4.19 후) 저장소

| 저장소 | 역할 | 권한 |
|---|---|---|
| `books.context` (JSONB) | canonical (사용자 입력 원본) | sole source |
| Redis `context:<bookId>` | books.context 7일 캐시 | derived (TTL) |
| `world_configs` | genre/background/mood/theme/common_tone | derived (Phase 4.19 sync) |
| `world_rules` | rule_type ∈ general/absolute_forbidden | derived |
| `canonical_characters` | name/type/gender/personality/initial_items | derived |

**현재 위험:** Phase 4.19 sync 코드가 derived 테이블을 채우지만, **사용자가 modal에서 직접 saveContext를 다시 부르지 않으면 동기화 트리거 부재**. R4.1에서 트리거화 또는 자동 derive.

## 3. books.context schema (현재 v1)

```jsonc
{
  "world_rules": ["장르: 이세계, 판타지", "이세계에서는 ..."],   // 첫 줄에 장르 prefix 잠입
  "story_config": { "totalEpisodes": 100, "pov": "...", ... },
  "character_defaults": {
    "<name>": { "type":"...", "gender":"...", "personality":"...",
                "description":"...", "initial_items":[ {"name":"...", "description":"..."} ] }
  },
  "fixed_relationships": [],
  "forbidden_settings": ["..."]
}
```

## 4. R4 (proposal)에서 v2 schema

```jsonc
{
  "version": 2,
  "story_config": { "genre":"이세계, 판타지", "background":"...", "mood":"...", ... },
  "world_rules": { "general":["..."], "absolute":["..."] },
  "characters": {
    "<name>": {
      "type":"...","gender":"...","personality":"...",
      "initial_items":[ {"name":"...", "user_description":"...", "llm_description":"...", "category":"기기" } ]
    }
  },
  "fixed_relationships": []
}
```

핵심 변화: `forbidden_settings` → `world_rules.absolute`, `character_defaults` → `characters`,
`initial_items.description` → `user_description` + `llm_description` 분리.

→ R4 단계: v1 입력 받으면 v2로 변환 후 저장. read는 v2 우선, v1 fallback.

## 5. 절대 규칙 (premise vs prohibition)

사용자 spec: 절대 규칙은 의미상 두 종류 혼재 가능:
- **부정형 (prohibition):** "X는 등장하지 않는다", "Y는 금지"
- **긍정형 (premise):** "이세계 전이가 일어난다", "마나는 누구나 가진다"

planner/renderer prompt의 `[절대 규칙]` section은 **각 항목의 자연어 의미를 그대로 따르도록** 안내문 포함 (Phase 4.19에서 적용).

→ 사용자가 modal에서 🔒 toggle로 입력하면 의미와 무관하게 `forbidden_settings`로 저장. 절대 규칙 안내문이 LLM에게 분기하라고 지시.

## 6. 변경 시 verify

```bash
node scripts/verify_world_rule_integrity.mjs
node scripts/audit_world_rule_integrity.mjs --book-id <X>
node scripts/audit_world_rule_violation.mjs --book-id <X> --episode N
```

## 7. cleanup 정책

`scripts/cleanup_test_book_state_cache.mjs --book-id <X> --dry-run`:
- **보존:** books.context 전체 + world_configs + world_rules (사용자 입력)
- **삭제:** episodes / run_traces / dynamic_states / foreshadows / arc / item_vocab / characters(legacy) (생성 결과만)
- **clear:** canonical_characters.initial_items[*].description (LLM enrich 결과 — 다음 saveContext에서 재enrich)

`--apply`는 사장 승인 후만.

## 8. R4 진행 시 단계

1. **R4.0** — books.context v2 type 정의, /api/context POST의 v1→v2 변환
2. **R4.1** — derived index 단방향 (트리거 또는 자동 sync)
3. **R4.2** — UI restore v2 read 통일
4. **R4.3** — initial_items의 user_description / llm_description 분리
5. **R4.4** — cleanup tool이 user_* 필드 절대 보존 testable

## 9. 디버깅 체크리스트

### "사용자가 입력한 절대 규칙이 본문에 안 반영"
1. `audit_world_rule_integrity.mjs --book-id <X>` — 5개 저장소 sync 상태 확인
2. world_configs / world_rules 비어 있으면 saveContext 재호출 권장 (Phase 4.19 sync trigger)
3. effective_context의 absolute_forbidden 배열에 도달했는지 logger 확인
4. planner [절대 규칙] section emit 확인

### "장르가 일반 규칙으로 잘못 분류됨"
- modal.js:263에서 `장르: ${genres.join(", ")}`를 world_rules 첫 줄에 넣음
- /api/context POST가 첫 줄을 world_configs.genre로 추출 (Phase 4.19)
- v1 호환 동작. R4.0 v2에서는 story_config.genre로 명시 분리

## 10. 금지

- ❌ 사용자 입력을 books.context 외 곳에 단독 저장
- ❌ derived 테이블을 사용자가 직접 edit하는 path 추가 (단방향 sync 깨짐)
- ❌ DB migration 무단 실행 (R4 전 단계 모두 사장 승인)
- ❌ books.context를 transaction 없이 partial update (race condition)
