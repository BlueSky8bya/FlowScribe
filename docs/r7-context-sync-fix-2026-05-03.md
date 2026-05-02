# R7 P0 Context Sync Fix — Source-of-truth 정리

**날짜**: 2026-05-03
**Phase**: R7 P0 (S13.5 후속)
**브랜치**: `checkpoint/phase1-launch-prep`
**HEAD before**: `f0f217c` (S13.5 P1 fix — clearWorldSettingsUI / STORY_CONFIG_DEFAULTS)
**상태**: ✅ Helper 도입 + R7 4중 sync apply + ep1~10 cleanup 완료

---

## 1. Root cause 최종 정리

R7 ep1~10이 stale "현대 로맨스" 장르 + hard rule 0건 상태에서 생성된 직접 원인은 **context source-of-truth 4중 stale**:

| view | R7 v1 fix 후 (잘못된 상태) | 원인 |
|---|---|---|
| `books.context.story_config` | "포스트아포칼립스 서바이벌" ✓ | repair v1이 정정 |
| `world_configs.genre` | **"현대 로맨스" stale** | repair v1이 미터치 |
| `world_rules.absolute_forbidden` | **0건 stale** | repair v1이 미터치 |
| Redis `context:${id}` | **stale** | repair v1이 미터치 |
| `effective_context.task.goal` | **"현대 로맨스" 매화 박힘** | world_configs.genre 우선 read |

원인: `repair_r7_story_config.mjs` v1이 `books.context`만 UPDATE하고, 정상 saveContext path가 동기화하던 normalized 테이블 + Redis를 우회. 두 write path가 다른 sync 로직을 가져 drift.

**연쇄 발견**:
- `effective_context.ts:88-89, 144-149` — worldConfig는 `world_configs > Redis > _sc` 우선순위
- `effective_context.ts:161-165` — absolute_forbidden은 `world_rules ∪ Redis.legacyWorldBible.forbidden_settings`
- 둘 다 정상 saveContext가 박는 source를 우선 → repair v1의 books.context만 정정해서는 prompt에 반영 0

---

## 2. Shared sync helper 구현 — `src/services/world_context_sync.ts`

`syncWorldContext(book_id, payload)` — 단일 트랜잭션으로 4중 sync:
1. `UPDATE books SET context = $1::jsonb WHERE id = $2`
2. `INSERT ... world_configs ... ON CONFLICT (book_id) DO UPDATE` (genre/mood/background/theme/common_tone)
3. `UPDATE world_rules SET is_active = false` → `INSERT ... general/absolute_forbidden`
4. `redis.set(context:${book_id}, JSON, EX 7d)` (DB tx 성공 후)

안전:
- BEGIN/COMMIT/ROLLBACK
- Redis 실패는 log + 계속 (DB가 truth)
- book_id 미입력 시 throw

반환값: `{ genre_synced, general_count, forbidden_count }` — 호출자 logInfo 용.

---

## 3. saveContext / repair v2 동일 helper 사용

**`src/api/context.ts`** (api saveContext):
- 70줄의 sync 구간 → `await syncWorldContext(book_id, payload)` 1줄
- 외부 동작 100% 동일 보장 (resolved_final_episode 계산은 helper 호출 전 그대로)

**`scripts/repair_r7_story_config.mjs` v2**:
- v1: `UPDATE books SET context = ...` 직접 호출
- v2: `await syncWorldContext(BOOK_ID, newCtx)` 한 줄로 4중 sync
- R7 한정 가드 / dry-run 기본 / `EXPECTED_TITLE` 정확 일치 / `resolved_final_episode` 미터치 모두 유지
- post-apply verify에서 books.context + world_configs + world_rules 모두 확인

**정적 verify** (`scripts/verify_context_source_consistency.mjs`, 32 checks):
- helper 4구간 모두 포함 + 단일 트랜잭션
- api/context.ts에 직접 INSERT/UPDATE world_configs/world_rules 잔존 안 함
- repair script에 직접 INSERT/UPDATE world_configs/world_rules 잔존 안 함
- helper로 통일됨을 코드 grep으로 강제

---

## 4. audit_context_sync 결과 (R7, --expected-r7 모드, 20/20 PASS)

```
[1] books.context ↔ world_configs    genre/mood 일치
[2] books.context ↔ world_rules       forbidden 2건 / general 3건 일치
[3] books.context ↔ Redis cache       genre/mood/forbidden/TTL 일치
[4] effective_context                  world_config.genre = "포스트아포칼립스 서바이벌"
                                       task.goal = "1화 / 장르: 포스트아포칼립스 서바이벌"
                                       absolute_forbidden 2건 (사망자 / 지식 경계)
[5] R7 expected                        title / books / world_configs / effective 모두 R7 expected
```

→ **R7 prompt source가 모든 4중 view에서 정합 + effective_context까지 stale 흔적 0**.

---

## 5. repair v2 apply 결과

```
syncWorldContext 호출:
  genre_synced:    포스트아포칼립스 서바이벌
  general_count:   3
  forbidden_count: 2

POST-APPLY VERIFY:
  ✓ books.context.story_config.genre/mood/style/emotion/conflict/direction 모두 정정값
  ✓ forbidden_settings 2건
  ✓ world_configs.genre = "포스트아포칼립스 서바이벌"
  ✓ world_configs.mood = "스릴러, 드라마"
  ✓ world_rules.absolute_forbidden 2건
  • resolved_final_episode = 26 (유지)
```

---

## 6. cleanup dry-run 결과

```
보존 (user-authored):
  canonical_characters       4 rows
  characters                 4 rows
  item_vocab                12 rows
  world_configs              1 rows
  world_rules                8 rows  (active 5 + historical inactive 3)

삭제 대상 (generated artifacts):
  arc_summaries              1
  character_arcs             4
  character_dynamic_states  40
  episode_snapshots         10
  episodes                  10
  foreshadows               84
  run_traces                10
  ─────────────────────────
                           159 rows

추가 작업:
  books.current_episode: 11 → 1
```

→ 사장 보고 159 rows와 정확 일치. user-authored 미터치.

---

## 7. cleanup apply 결과

```
✓ COMMIT — total 159 rows deleted, books.current_episode=1

POST-APPLY VERIFY:
  generated 17개 테이블 모두 0 rows
  보존 5개 테이블 모두 그대로 (canonical 4 / characters 4 / item_vocab 12 / world_configs 1 / world_rules 8)
  books.current_episode = 1
```

→ R7 ep1~10 generated artifacts 완전 제거. user-authored 보존. 1화 재시작 가능 상태.

post-cleanup `audit_item_vocab --detail`: vocab coverage 100% / 기타 0 / mismatch 0 / **응급 처치 키트 = 의료 유지** (POST-1 정착 + POST-S13.5 한 번도 손상 안 됨).

---

## 8. ep1~10 invalidation 기록

R7 canary ep1~10 (총 10화)은 **모두 무효** 처리:

| 무효 사유 | 영향 |
|---|---|
| `task.goal` = "N화 / 장르: 현대 로맨스" 매화 stale | LLM이 R7 정체성을 잃고 "현대 로맨스" 장르로 작성 |
| `absolute_forbidden` 0건 | 사망자 발화 금지 / 지식 경계 hard rule prompt 누락 |
| `current_locations` 7화 stuck `도시 외곽 버려진 카페` | 9/10 화 같은 location 시작부 |

**story quality 평가 / training trace 활용 / DPO pair 추출 모두 무효**. 본 데이터는 보존 안 함 (cleanup에서 삭제 완료).

---

## 9. R7 ep1 재시작 가능 여부

**가능 ✅**.

| 조건 | 상태 |
|---|---|
| books.context (4중 sync 적용) | ✅ |
| world_configs (R7 정정) | ✅ |
| world_rules.absolute_forbidden (2건) | ✅ |
| Redis cache (정정) | ✅ |
| effective_context.task.goal (R7 장르) | ✅ |
| effective_context.absolute_forbidden (2건) | ✅ |
| canonical 4명 / items 12 / vocab 정착 | ✅ |
| 응급 처치 키트 = 의료 | ✅ |
| books.current_episode = 1 | ✅ |
| ep1~10 generated artifacts 0 | ✅ |

다음 사장 작업 (브라우저):
1. http://localhost:3000 접속 + Ctrl+Shift+R (hard reload, helper 적용 client 적재)
2. R7_회색지대_생존기_CANARY 책 선택
3. **세계관 설정 모달은 절대 열지 마라** (이미 정정 완료, 재저장 시 storyConfig 흐름 위험은 STORY_CONFIG_DEFAULTS reset으로 차단되었지만, 보수적으로 안 여는 것이 안전)
4. 1화 [생성] 클릭 → 5화 도달 시 멈추고 회신
5. 내가 ep1~5 sentinel audit 진행

---

## 10. P1 location stuck — sentinel 계획

P0 fix 후 정상 장르(서바이벌) + hard rule 적용 상태에서 ep1~5 생성 후 다음 검사:

| 검사 | 통과 기준 |
|---|---|
| ep1~5 시작부 location 다양성 | 5화 중 3화 이상 다른 위치 시작 |
| `current_locations` 진행 여부 | ep2~5에서 최소 2회 이상 location 변화 |
| `task.goal` stale 흔적 | "현대 로맨스" 0건 |
| `absolute_forbidden` prompt 주입 | 매화 ≥ 2건 |
| 사망자 발화 / 지식 누출 | 0건 |
| 인물카드 / 의료 카테고리 배지 | 정상 |

**정상 통과 시**: ep6~10 진행 → ep10 checkpoint → 30화 actual 재개.

**stuck 재발 시**: 별도 P1 phase로 planner location progression fix 진입. P0 fix가 root cause 아닌 별도 planner 정책 문제로 판정.

---

## 11. 변경 요약

```
신규:
  src/services/world_context_sync.ts            (~140 lines)
  scripts/audit_context_sync.mjs                 (~180 lines)
  scripts/verify_context_source_consistency.mjs  (~140 lines)
  scripts/cleanup_r7_generated_artifacts.mjs     (~190 lines)
  docs/r7-context-sync-fix-2026-05-03.md         (본 문서)

수정:
  src/api/context.ts            70줄 → 5줄 (helper 호출로 wrap)
  scripts/repair_r7_story_config.mjs (v1 → v2 helper 사용)

DB write (사장 명시 승인 후 실행):
  R7 4중 sync apply (helper 호출, 트랜잭션)
  R7 cleanup 159 rows + current_episode reset (트랜잭션)

미터치:
  route / prompt / DB schema / DeepSeek / _capQlabel / _inferItemBadge
  canonical_characters / characters / item_vocab / world_configs (보존)
  resolved_final_episode (26 유지)
  .claude/scheduled_tasks.lock / scripts/cloud_dpo/launch_dpo.py (untouched, NOT staged)
```

---

```
P0 fix verdict:           ✅ 적용 (helper 도입 + R7 4중 sync + cleanup)
audit_context_sync:       20/20 PASS (effective_context까지)
verify_context_consistency: 32/32 PASS
ep1~10:                   무효 (159 rows cleanup 완료)
R7 1화 재시작:             가능
P1 location stuck:        ep1~5 sentinel 후 판정
```
