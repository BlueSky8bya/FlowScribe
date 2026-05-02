# POST-4 — Final Closeout Report

**날짜**: 2026-05-03
**Phase**: POST-4 (Source Routing Cleanup)
**브랜치**: `checkpoint/phase1-launch-prep`
**HEAD before phase**: `b355832` (POST-2 closeout)
**Verdict**: ✅ **CLOSED**

---

## 1. POST-4 Verdict

| 항목 | 상태 |
|---|---|
| P0 production blocker | 미발견 (POST-1/POST-2와 연속 동일) |
| Q1 DeepSeek 처리 — 옵션 B 보존 + 주석 | ✓ 적용 |
| Q2 진행 범위 — 옵션 2 최소 + 정착도 측정 | ✓ 완료 |
| C1 `audit_item_vocab.mjs --detail` | ✓ 추가 |
| C2 `verify_reading_mode_position_preserve.mjs` | ✓ 15/15 PASS |
| 정착도 측정 (active 25권) | ✓ 완료. 정착 0/25 → 키워드 fallback DEFER 유지 |
| 회귀 발생 | 0건 |
| main push 차단 사유 | 없음 |

---

## 2. 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/audit_item_vocab.mjs` | C1 — `--detail` 옵션 추가. 카테고리 분포 + vocab vs canonical mismatch + 정착도 평가. summary 호환 유지. |
| `scripts/verify_reading_mode_position_preserve.mjs` | C2 신규 — S4 KEEP 정책 정적 contract verify (15 checks). setReadMode anchor capture/restore + 강제 상단 이동 패턴 부재 검증. |
| `src/lib/llm.ts` | DeepSeek 설정 block 위 보존 주석 (1 hunk). |
| `src/services/model_router.ts` | DeepSeek case 위 보존 주석 (1 hunk). |
| `docs/post4-source-routing-cleanup-inventory-2026-05-03.md` | 사장 결정 + 정착도 측정 결과 반영. |
| 본 보고서 | closeout. |

`model_routes.json` / active_route / fallback_route / `_capQlabel` / `_inferItemBadge` / DB / public UI / `src/api` / `src/services` (router 외) **미터치**.

---

## 3. C1 — audit_item_vocab.mjs --detail 옵션

기본 실행은 기존 summary 그대로 유지. `--detail` 추가 시 다음 출력:

- **category별 count** — vocab 16종 카테고리 분포 + 백분율
- **vocab vs canonical category mismatch** — `canonical_characters.initial_items` 안 박힌 category와 `item_vocab` category 불일치 행 식별. POST-1 §P1-A reopen-3 source priority 정책 적용 후 client 표시는 정상이지만 canonical stale 추적
- **키워드 fallback 단순화 정착도** — coverage ≥95% + 기타 0 + mismatch 0 동시 충족 시 정착 완료
- **AGGREGATE SUMMARY** (`--all --detail` 시) — 책별 표 + 정착 완료 책 수 카운트

read-only — 어떤 DB write도 수행 안 함.

---

## 4. C2 — verify_reading_mode_position_preserve.mjs 신규

S4 KEEP 정책(청독/묵독/낭독 모드 전환 시 단락 위치 보존) 정적 contract 검증.

15 checks (모두 PASS):
1. `setReadMode` / `_captureReadingAnchor` / `_restoreReadingAnchor` 함수 정의
2. setReadMode 안에서 모드 전환(`prev !== mode`) 시에만 anchor 캡처
3. DOM mutation 후 `requestAnimationFrame` 안에서 `_restoreReadingAnchor(anchor)` 호출
4. anchor truthy 가드 (`if (anchor) { ... }`)
5. 강제 상단 이동 패턴 부재 (`scrollTo({top:0})`, `scrollIntoView({block:"start"})`, `scrollTop = 0`)
6. `_captureReadingAnchor`: viewport top paragraph 검출 (`getBoundingClientRect().top` + `index/offsetWithin`)
7. `_restoreReadingAnchor`: `scrollBy` + `anchor.index/offsetWithin` 보정
8. Phase 4.18 정책 주석 유지

UI 코드 미터치. 현재 구현이 S4 KEEP 정책에 부합 입증.

---

## 5. DeepSeek 보존 주석 위치/내용

핵심 위치 2곳에만 최소 주석:

### `src/lib/llm.ts` (deepseek 설정 block 위)
```ts
// POST-4 §C3 — production path 아님. 현재 model_routes.json에서 비활성
// (active=openai_renderer, fallback=baseline_local). low-cost / fast route 재도입
// 옵션으로 보존. 재활성화 시 별도 route matrix 검증(R5B-4 패턴) 필요.
deepseek: { ... },
```

### `src/services/model_router.ts` (case "deepseek" 위)
```ts
// POST-4 §C3 — production path 아님 (model_routes.json 비활성).
// low-cost / fast route 재도입 옵션으로 보존. 재활성화 시 route matrix 검증 필요.
case "deepseek":
  client = new OpenAICompatibleClient({ ... });
  break;
```

`src/api/settings.ts`, `src/services/llm_tasks.ts`, `src/services/model_clients/openai_compatible.ts`은 type union/주석 잔존 정도로 추가 주석 불필요 (사장 명세: "핵심 위치에만 최소 주석"). 코드 호출 경로 0건이라 실행 영향 0.

---

## 6. vocab 정착도 측정 결과

active books 25권 대상 `audit_item_vocab --all --detail` 실행.

**핵심 수치**:
- 정착 완료(coverage≥95% + 기타 0 + mismatch 0): **0/25권**
- 100% coverage 책: 2권 (바보바보바보, 확률을 깨는 용사_TEST)
- 그 2권에도 mismatch 발견: 바보바보바보 1건(데이터 스틱 vocab=통신 / canonical=도구), 확깨용_TEST 3건
- 나머지 23권: vocab 0건 (옛 테스트 책 / fire-and-forget 도입 전 책)

**해석**:
- POST-1 §P1-A reopen-3의 vocab > canonical priority 적용으로 mismatch 책의 client 표시는 정상 (vocab 우선)
- 단 canonical 행 stale은 별도. 필요 시 `reclassify_item_vocab.mjs --apply`로 책별 일괄 정정 가능 — 본 phase에서는 미진행
- 키워드 fallback 단순화는 **DEFER 유지** — 정착 완료 0/25라 fallback 호출 빈도 여전히 높음

**제안 트리거**: 향후 신규 사용자 책이 누적되어 active books 정착도 ≥ 80% 도달 시 또는 reclassify 일괄 적용 후 재평가.

---

## 7. Verify Result

```
npm run build (tsc)                                      PASS
verify_route_integrity                                   6/0/0
verify_public_js_syntax                                  25/25
verify_book_load_flow                                    41/0
verify_episode_end_character_cards                       27/27
verify_episode_end_character_cards_layout                22/22
verify_context_save_async                                13/13
verify_modal_save                                        16/16
verify_generation_session_guard                          14/14
verify_capture_title_format                              8/8
verify_item_category_source_priority                     12/12
verify_item_description_length                           21/21
verify_reading_mode_position_preserve (new)              15/15  ← C2
```

회귀 0. POST-1 + POST-2 + POST-4 누적 verify 13개 모두 PASS.

---

## 8. POST-4 변경 Commit 목록

POST-4 phase commits (예상 small commits):

| Commit | 영역 | 요지 |
|---|---|---|
| `f166a41` (이전 commit) | docs | POST-4 inventory + 사장 결정 항목 정리 |
| (예정 1) | test | C1 audit_item_vocab --detail 옵션 추가 |
| (예정 2) | test | C2 verify_reading_mode_position_preserve 신규 |
| (예정 3) | refactor+docs | DeepSeek 보존 주석 + 정착도 측정 결과 반영 + closeout draft |

총 ~4 commits in POST-4.

---

## 9. POST-4에서 다음 phase로 이관

| 항목 | 이관 phase |
|---|---|
| `_capQlabel` / `_inferItemBadge` 키워드 단순화 | DEFER 유지. vocab 정착도 ≥80% 또는 reclassify 일괄 적용 후 재평가 |
| orphan rows 14,620 DB cleanup | 별도 cleanup phase (dry-run + 사장 명시 승인 + transaction batch DELETE) |
| canonical category mismatch 일괄 정정 | 별도 — `reclassify_item_vocab.mjs --apply` 책별 적용 (사장 명시 승인 시) |

---

## 10. main push 가능 여부

**가능**.

| 조건 | 상태 |
|---|---|
| P0 blocker 0건 | ✓ |
| 사장 결정(Q1/Q2) 100% 반영 | ✓ |
| 회귀 발생 verify | 0건 |
| build PASS | ✓ |
| route 변경 없음 (model_routes.json 미터치) | ✓ |
| DeepSeek 정책 변경 없음 (보존 결정 그대로) | ✓ |
| DB write / migration 0 | ✓ |
| public UI 미터치 | ✓ |
| leftover 2건 staged 0건 | ✓ |

main push는 fast-forward.

---

## 11. 다음 단계 추천

### 옵션 A — main push 후 R6.x / R7 본 작업 진입 (권고)
- POST-1/POST-2/POST-4가 깔끔히 closeout
- production observability 정리 완료
- story quality / regen / training pipeline 본 phase 가능

### 옵션 B — orphan cleanup phase
- 14,620 orphan rows를 dry-run + 사장 승인 + transaction batch DELETE
- production 영향 0이지만 DB write 위험 → 별도 phase

### 옵션 C — canonical mismatch 일괄 정정
- 25권의 canonical_characters.initial_items 안 stale category 행을 reclassify
- LLM 호출 비용 + DB write 발생 → 사장 명시 승인 필요

### 권고 순서
1. 사장 main push 승인 → fast-forward push
2. R6.x / R7 본 작업 진입 (story quality / regen / training pipeline)
3. orphan cleanup / canonical reclassify는 별도 phase 분리

---

## 12. git status (closeout 시점 예상)

```
M .claude/scheduled_tasks.lock         (untouched, NOT staged)
M scripts/cloud_dpo/launch_dpo.py      (untouched, NOT staged)
```

leftover 2건 untouched. 본 phase의 모든 commit은 verify + docs + 핵심 위치 주석만 stage.

---

```
POST-4 verdict:    CLOSED ✅
P0 blocker:        NO
DeepSeek:          보존 + 주석 (옵션 B)
verify added:      C1 detail 모드 + C2 신규 (15/15)
정착도 측정:        25권 / 정착 0/25 → fallback DEFER 유지
회귀:              0건
변경 commits:      ~4 (f166a41 + 본 작업)
main push:         가능 (사장 승인 시 fast-forward)
recommended next:  main push → R6.x / R7 본 작업
```
