# POST-1 — Final Closeout Report

**날짜**: 2026-05-03
**Phase**: POST-1 (UI/Data Audit + Item Category Pipeline Hardening)
**브랜치**: `checkpoint/phase1-launch-prep` (≡ `origin/main` 잠재 fast-forward)
**기간**: POST-3(`642075c`) 직후 ~ `061cc09`까지
**Verdict**: ✅ **CLOSED — production blocker 0건, P1 모두 fixed, browser verified**

---

## 1. 최종 Verdict

POST-1는 **CLOSED**. P0 production blocker 미발견 + 사장 명시 P1 후보 모두 fixed + 브라우저 재검증 통과. 잔여 P2/P3는 별도 phase로 분리.

| 항목 | 상태 |
|---|---|
| P0 production blocker | **NO — 미발견** |
| P1 (사장 명시 우선) | ✅ ALL FIXED + browser verified |
| P2 (사장 회신 후 분류) | 잠정 backlog — POST-2 후보 |
| P3 (cleanup) | backlog — POST-3.5/4 후보 |
| 회귀 발생 | 0건 |
| main push 차단 사유 | 없음 |

---

## 2. P0 Production Blocker

**없음**.

근거:
- `verify_route_integrity` 6/0/0 — `active_route=openai_renderer` 안정 유지
- DeepSeek 정책 변경 0
- prompt 대규모 변경 0 (item_desc.ts에 `_CATEGORY_GUIDE` 정합성 정렬만)
- DB migration 실행 0
- 기존 R5B-4d / R6 누적 generation evidence (172+ generations 0 fail) 회귀 없음

---

## 3. S10 인물카드 parity — Fixed + Browser Verified

| 항목 | 상태 |
|---|---|
| 본문 하단 카드 = 캡처 카드 동일 renderer | ✅ shared `_buildCapStyleCharCardHtml` |
| 소지품 항상 펼침 (chevron/toggle 제거) | ✅ |
| 카테고리 배지 위치/색상/스타일 일치 | ✅ inline cap-style |
| 본문 하단 fontScale 1.3 (캡처 1.0) | ✅ 사장 요구 반영 |
| 행별 카드 높이 통일 (`align-items: stretch` + `height:100%`) | ✅ |
| 카테고리 배지 폰트 `.67em → .85em` | ✅ |
| 브라우저 시각 검증 | ✅ 사장 confirmed |

관련 commits: `45e7b18`, `17abcd2`, `87f9fca`, `cd04acf`, `e3bc1de`

---

## 4. P1-A Item Category Pipeline — Fixed + Browser Verified

### 4.1 변경 영역

| 영역 | 변경 |
|---|---|
| **item_vocab DB** | `합성 영양바: 소모품 → 식량` UPDATE 적용 (트랜잭션 commit) |
| **canonical_characters.initial_items** | `합성 영양바 (제논): 도구 → 식량` jsonb_set UPDATE 적용. description / description_source 보존 |
| **char-states API category priority** | `vocab.category != "기타"` 면 canonical `it.category` 우선 무시. vocab miss/ "기타"는 missingForClassify 큐잉. category/badge_label만 source priority 적용 — name/description/condition/owner/grade는 기존 merge 흐름 유지 |
| **reclassify_item_vocab.mjs 확보** | dry-run default. `--apply` 시 vocab + canonical 두 source 트랜잭션 갱신. id/created_at/description 보존. `--book-id` 필수, `--item-name` 옵션 |
| **classify prompt 정합성** | `_CATEGORY_GUIDE` module-level 상수. classifyItemNamesViaLLM (dynamic items) + generateAndSaveItemDescriptions (initial items) 양쪽이 동일 가이드 사용 → initial/dynamic 분류 기준 일관성 확보 |
| **CATEGORY_BADGE에 의료 enum 추가** | server + UI CAT_COLOR + CATEGORY_DESC_FALLBACK 모두 정합 |
| **UI fallback 강화** | 코드에 색상 미정의 카테고리도 라벨 그대로 표시 + neutral 회색 — 배지 미표시 상황 방지 |

### 4.2 사장 정책 준수 검증

- ❌ → ❌ `_capQlabel`에 영양바/단백질바/식량 키워드 if문 추가 **0건**
- ❌ → ❌ 특정 아이템명 하드코딩 **0건**
- ❌ → ❌ 앱 실행 중 JS/TS self-modifying 패턴 **0건**
- ✅ LLM 분류 결과 → item_vocab 누적 → server-first lookup으로 UI 표시 — 정공법 흐름 확립

### 4.3 사장 안전 조건 충족 → APPLY 실행

```
book title:           "바보바보바보" (정확 매치)
book_id:              95d5fe88-c1c5-472d-9b0b-8f9b476b2e3d
item_name:            "합성 영양바" (정확 매치)
dry-run delta:
  item_vocab:                소모품 → 식량
  canonical (제논):  도구 → 식량
변경 대상:            1건
다른 책/아이템 변경:  0건
transaction commit:   vocab 1 + canonical 1
```

### 4.4 Browser Verification

사장 confirm: 바보바보바보 1화 제논의 합성 영양바 = **녹색 "식량" 배지**(#60a060)로 정상 표시.

관련 commits: `d57bfaf`, `0343d19`, `d5f4d0f`, `7ab98cb`, `061cc09`

---

## 5. P1-B Diagnostic Visibility — Fixed

| 산출물 | 위치 | 사용법 |
|---|---|---|
| `audit_item_vocab.mjs` | `scripts/audit_item_vocab.mjs` | `node scripts/audit_item_vocab.mjs --book-id <id>` (read-only). canonical/dynamic/vocab coverage + dynamic-only vocab miss 리스팅 |

read-only — DB write 0건. `--all` 모드도 지원 (active books 일괄).

관련 commit: `57a160d`

---

## 6. verify_modal_save Stale Refresh — Fixed (16/16 PASS)

POST-3 패턴 동일 — fixed window slice 의존을 brace-match `extractFunctionBody` helper로 교체. 14 → 16 checks (POST-1 §S17 aria-hidden + inert contract 추가).

| Test | Before | After |
|---|---|---|
| T6 closeModal called after /api/context fetch | 6000자 fixed window 부족 | saveContext 함수 본문 정확 추출 |
| T8 closeModal removes "open" class | 500자 slice 부족 | closeModal 함수 본문 정확 추출 |
| T9 closeModal display:none fallback | 500자 slice 부족 | 동일 |
| T14 saveContext restores button on failure | catch 직접 매칭만 | `_restoreBtn()` 위임 인정 + 헬퍼 본문 검증 |
| T15 (new) | — | aria-hidden contract |
| T16 (new) | — | inert contract |

관련 commit: `a5aa369`

---

## 7. verify_item_category_source_priority — 신규 12/12 PASS

[scripts/verify_item_category_source_priority.mjs](scripts/verify_item_category_source_priority.mjs) — 12 checks:

```
[1] char-states vocab > canonical priority         4/4
    - vocab.category 'not 기타' 우선 분기
    - vocab 우선 시 it.category 무시 return
    - missingForClassify 큐잉
    - classifyAndSaveItemCategories에 전달

[2] classify prompt 정합성                         3/3
    - _CATEGORY_GUIDE module-level 정의
    - classifyItemNamesViaLLM 사용
    - generateAndSaveItemDescriptions 사용

[3] _CATEGORY_GUIDE 핵심 분류 기준                  4/4
    - 식량="영양 보충"
    - 음식·식수→식량 명시 (도구·소모품 금지)
    - 의료=치료/약품
    - 도구=작업/수리/조작

[4] CATEGORY_BADGE에 의료 enum                     1/1
```

관련 commit: `061cc09`

---

## 8. 전체 Verify 요약

```
npm run build (tsc)                                      PASS
verify_route_integrity                                   6/0/0
verify_episode_end_character_cards                       27/27
verify_episode_end_character_cards_layout                22/22
verify_public_js_syntax                                  25/25
verify_book_load_flow                                    41/0
verify_context_save_async                                13/13
verify_modal_save                                        16/16  (POST-1 refresh)
verify_item_description_length                           21/21
verify_item_category_source_priority                     12/12  (POST-1 신규)
verify_episode_character_display_filter                  20/20
verify_episode_end_state_alignment                       17/17
verify_meaningful_appearance_guard                       17/17
```

**누적: 통과 PASS only, 회귀 0건.**

---

## 9. POST-1 변경 Commit 목록

| Commit | 영역 | 요지 |
|---|---|---|
| `7e628e5` | docs | POST-1 UI/Data audit checklist 17 scenario |
| `45e7b18` | ui-fix | S2 separator 제거 + 책 제목 두께 / S14 cross-card dedup / S17 Redis fall-through + aria-hidden + inert / §7.1 hidden category / §7.2 role-based TYPES / §7.3 GENDERS 3종 / S10 layout 동일화 |
| `17abcd2` | ui-fix | S10 reopen — 캡처와 동일 renderer 추출 (cap-char-card shared) |
| `87f9fca` | ui-fix | S10 reopen-2 — fontScale + height:100% + grid stretch |
| `cd04acf` | ui-fix | S10 reopen-3 — fontScale 1.15 → 1.3 |
| `0df56f0` | ui-fix | (revert 대상) `_capQlabel` 식량 키워드 추가 |
| `7ab98cb` | ui-fix | server-first lookup + `0df56f0` revert (사장 정책) |
| `57a160d` | docs+audit | POST-1 잔여 inventory + audit_item_vocab |
| `d57bfaf` | server-fix | dynamic items vocab 누수 차단 — fire-and-forget classify |
| `db017e3` | docs | POST-1 residual report (P1-A 1차 보고) |
| `e3bc1de` | ui-fix | 카테고리 배지 폰트 .67em → .85em |
| `a5aa369` | test | verify_modal_save stale 4건 refresh (helper 방식) |
| `0343d19` | server-fix | classify prompt 강화 + UI unknown category fallback |
| `d5f4d0f` | repair | reclassify_item_vocab.mjs (dry-run default) |
| `061cc09` | server-fix | C-lite — vocab > canonical priority + canonical reclassify + verify 12/12 |

총 **15 commits**.

---

## 10. Leftover 2개 stage 금지 유지 — 확인됨

```
M .claude/scheduled_tasks.lock         (untouched, NOT staged 전체 phase 동안)
M scripts/cloud_dpo/launch_dpo.py      (untouched, NOT staged 전체 phase 동안)
```

POST-1 phase 전 commit에서 한 번도 stage된 적 없음. 사장 정책 100% 준수.

---

## 11. 남은 P2/P3 Backlog

### P2 — 사장 회신 후 분류 (POST-2 후보)
- POST-1 audit checklist 미회신 시나리오: S1, S3, S4, S6, S7, S8, S9, S11, S15, S16
- §6.2-§6.4 deferred 항목 (S12 세계관 저장 / S13 설정 뷰어)
- item description 30~40자 정책 실측 검증 (verify_item_description_length는 PASS이나 사용자 체감 회신 미수령)

### P3 — backlog (POST-3.5/4 후보)
- DeepSeek 클라이언트 코드 cleanup (`POST-4` 후보)
- `data/datasets/dpo_v*.jsonl` gitignore 검토
- `_inferItemBadge` (server) / `_capQlabel` (client) 키워드 휴리스틱 단순화 — LLM/vocab 정착 후 점진 축소
- orphan rows 14,620 cleanup (production 영향 0, 별도 phase)
- `audit_item_vocab.mjs`에 카테고리별 detail 출력 옵션 추가 (현재는 coverage만)

---

## 12. main push 가능 여부

**가능**.

| 조건 | 상태 |
|---|---|
| P0 blocker 0건 | ✓ |
| 사장 명시 P1 모두 fixed + browser verified | ✓ |
| 회귀 발생 verify | 0건 |
| build PASS | ✓ |
| route 변경 없음 | ✓ |
| DeepSeek 정책 변경 없음 | ✓ |
| DB migration 실행 0 | ✓ |
| leftover 2건 staged 없음 | ✓ |
| 누적 evidence (R5B-4d/R6 172+ gen 0 fail) 보존 | ✓ |

본 phase의 단일 DB write(`061cc09` 단계 reclassify apply)는 production 영향:
- 변경 행: item_vocab 1건 + canonical_characters 1건 (단일 책, 단일 아이템)
- 다른 책/아이템 영향 0건
- 트랜잭션 commit 검증 완료
- 사장 안전 조건 모두 충족 후 적용

main push는 사장 명시 승인 시 진행. push 시 fast-forward 168+commits.

---

## 13. 다음 단계 추천

### 옵션 A — main push 후 새 phase 시작 (권고)
- POST-1 closeout이 깔끔히 끝났고 누적 fix가 안정적이라 main 동기화 후 새 phase로 진입하는 것이 깔끔
- main에 POST-0 / POST-1 변경분이 누적된 상태에서 POST-2/4 분리 진행

### 옵션 B — POST-2 UX Policy Migration
- audit checklist 미회신 시나리오 12개를 사장 browser에서 일괄 검증 → P2 분류
- 세계관 저장/뷰어 회귀 검증 (S12/S13 deferred)
- item description 30~40자 일관성 실측

### 옵션 C — POST-4 Source Routing Cleanup
- DeepSeek 클라이언트 잔존 코드 제거
- model_routes.json 추가 정리
- 이번 phase에서 _inferItemBadge / _capQlabel 키워드 휴리스틱 잔존하는 부분도 함께 점진 축소

### 권고 순서
1. 사장이 main push 승인 → fast-forward push
2. POST-2 UX policy migration (browser audit 미회신 12건 클로즈)
3. POST-4 source routing cleanup
4. 그 후 R6.x / R7 본 작업 (story quality / regen / training pipeline)

---

## 14. 본 phase 작업 산출물 인덱스

| 영역 | 위치 |
|---|---|
| 본 보고서 | `docs/post1-final-closeout-report-2026-05-03.md` |
| 잔여 inventory | `docs/post1-residual-inventory-2026-05-03.md` |
| residual report (1차) | `docs/post1-residual-report-2026-05-03.md` |
| audit checklist (browser) | `docs/post1-ui-data-audit-checklist-2026-05-02.md` |
| audit script | `scripts/audit_item_vocab.mjs` (read-only) |
| repair script | `scripts/reclassify_item_vocab.mjs` (dry-run default) |
| 신규 verify | `scripts/verify_item_category_source_priority.mjs` |
| refreshed verify | `scripts/verify_modal_save.mjs` (helper 방식) |

---

```
POST-1 verdict: CLOSED ✅
P0 blocker:        NO
P1 fixed + browser verified
P2 backlog:        12 audit scenarios + S12/S13 deferred
P3 backlog:        DeepSeek cleanup, dpo gitignore, 키워드 단순화
main push:         가능 (사장 승인 시)
recommended next:  main push → POST-2 UX policy migration
```
