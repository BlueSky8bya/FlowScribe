# POST-1 — Residual Report (P1 fixes)

**날짜**: 2026-05-03
**Phase**: POST-1 잔여 정리
**브랜치**: `checkpoint/phase1-launch-prep`
**커밋 범위**: `7ab98cb` → `d57bfaf` (이번 phase: `57a160d`, `d57bfaf`)
**원칙**: P0 미발견. P1 정공법(LLM 분류 + vocab 누적). 키워드 if문 추가 금지.

---

## 1. Current Status

```
P0 production blocker:           NO
build / tsc:                     PASS
verify suite (regression):
  verify_route_integrity         6/0/0
  verify_episode_end_character_cards         27/27
  verify_episode_end_character_cards_layout  22/22
  verify_episode_character_display_filter    20/20
  verify_book_load_flow                      41/0
  verify_public_js_syntax                    25/25
  verify_context_save_async                  13/13
  verify_modal_save                          10/14  (사전 fail 4건, 본 phase 무관)

active_route:                    openai_renderer (변경 없음)
DeepSeek 정책:                    변경 없음
prompt:                          변경 없음
DB migration:                    실행 0
leftover staged:                 0 (.claude/scheduled_tasks.lock + scripts/cloud_dpo/launch_dpo.py 보존)
```

---

## 2. Remaining Issues Inventory (재요약)

| ID | 영역 | 상태 |
|---|---|---|
| D1 | client `_buildCapStyleCharCardHtml` server-first | ✅ Fixed (`7ab98cb` 사전 처리) |
| D2 | dynamic items vocab 미누적 | ✅ **Fixed** (`d57bfaf` 본 phase) |
| D3 | server `_inferItemBadge` 식량 키워드 누락 | ✅ 정공법 — D2 fix로 자연 해결 (vocab 누적되면 fallback 미사용) |
| Audit S1/S3/S4/S6/S7/S8/S9/S11/S15/S16 | browser 재검증 미회신 | ⏳ 사장 회신 대기 (P2 분류 후) |
| C1 leftover 2건 | `.claude/scheduled_tasks.lock` / `scripts/cloud_dpo/launch_dpo.py` | 정책상 staged 안 함 |
| C3 DeepSeek 잔존 | 사용 안 함 | POST-4 후보 |
| C4 orphan 14,620 rows | production 영향 0 | 별도 phase |

---

## 3. P1/P2/P3 Classification (확정)

### P1 — fixed

| ID | 이슈 | 수정 |
|---|---|---|
| **P1-A** | dynamic items vocab 누수 | `classifyAndSaveItemCategories` 신설 + char-states 엔드포인트에 fire-and-forget classify trigger 연결 |
| **P1-B** | 진단 가시화 | `audit_item_vocab.mjs` (read-only) |

### P2 — 사장 회신 후 결정

| ID | 이슈 |
|---|---|
| P2-A | S1, S3, S4, S6, S7, S8, S9, S11, S15, S16 미회신 시나리오 |
| P2-B | S12 (세계관 저장) / S13 (설정 뷰어) |
| P2-C | item description 30~40자 일관성 실측 |

### P3 — backlog

| ID | 이슈 |
|---|---|
| P3-A | DeepSeek client cleanup |
| P3-B | dpo_v*.jsonl gitignore |
| P3-C | `_inferItemBadge` 단순화 (LLM/vocab 정착 후) |

---

## 4. P1 Fixes Performed

### Commit `57a160d` — docs + audit script
- `docs/post1-residual-inventory-2026-05-03.md` — P1/P2/P3 분류 작성
- `scripts/audit_item_vocab.mjs` — read-only 진단

`audit_item_vocab.mjs` 사용:
```bash
# 단일 책
node scripts/audit_item_vocab.mjs --book-id <book_id>

# active 책 전체 (current_episode > 0, 최대 30권)
node scripts/audit_item_vocab.mjs --all
```

출력 예시 (구조):
```
book_id: ...
title: ...

[counts]
  canonical items (unique): N
  dynamic items (unique):   M
  dynamic-only items:       K  (스토리 진행 중 신규 등장)
  vocab registered:         V

[coverage]
  canonical → vocab:    .../...
  dynamic   → vocab:    .../...
  dynamic-only vocab miss: .../...
  vocab "기타" 비율:    .../...

[dynamic-only items vocab 미등록 (max 50)]
  - 합성 영양바
  - ...
```

### Commit `d57bfaf` — server fix
- `src/services/item_desc.ts`: `classifyAndSaveItemCategories(book_id, item_names)` 신설
  - description / DB items 미터치 (사용자 입력 보존)
  - LLM 분류 결과만 `item_vocab`에 INSERT (ON CONFLICT DO NOTHING)
  - LLM 호출 실패 시 silent return
  - temperature 0.2 (분류는 결정적)
  - max 30 names per call
- `src/api/generate.ts` `char-states` 엔드포인트:
  - vocab lookup 단계에서 미등록 아이템 이름 set 수집
  - 응답에는 `_inferItemBadge` fallback 그대로 사용 (latency 영향 0)
  - 응답 후 fire-and-forget으로 `classifyAndSaveItemCategories` 호출
  - 다음 char-states 호출 시 vocab hit → 정상 카테고리 emit

흐름:
```
char-states 1차 호출
  → vocab miss + dynamic 신규 아이템 (예: 합성 영양바) 등장
  → 응답 "기타" + 백그라운드 LLM 분류 큐잉 (fire-and-forget)
  → DB item_vocab에 "식량" 누적

char-states 2차 호출 (다음 화 진행 / 책 재진입)
  → vocab hit
  → 응답 "식량" 카테고리 + 클라이언트 카드 식량 배지 표시
```

---

## 5. Changed Files

```
docs/post1-residual-inventory-2026-05-03.md   (new)
docs/post1-residual-report-2026-05-03.md      (new — 본 보고서)
scripts/audit_item_vocab.mjs                  (new, read-only)
src/services/item_desc.ts                     (+97 lines: classifyAndSaveItemCategories)
src/api/generate.ts                           (+9 lines / -1 line: import + vocab miss collector + fire-and-forget trigger)
```

leftover 보존 (staged 0):
- `.claude/scheduled_tasks.lock`
- `scripts/cloud_dpo/launch_dpo.py`

---

## 6. Verify Result

```
npm run build (tsc)                          PASS
verify_route_integrity                       6/0/0   PASS
verify_episode_end_character_cards           27/27   PASS
verify_episode_end_character_cards_layout    22/22   PASS
verify_episode_character_display_filter      20/20   PASS
verify_book_load_flow                        41/0    PASS
verify_public_js_syntax                      25/25   PASS
verify_context_save_async                    13/13   PASS  (fire-and-forget pattern)
verify_modal_save                            10/14   사전 fail 4건 (modal close 흐름, 본 phase 무관)
```

---

## 7. Remaining P2/P3 Backlog

### P2 (사장 회신 후 분류)
- S1: 새로고침 + 서재 sanity
- S3: 다음/이전화 이동 + 스크롤 anchor
- S4: 청독/묵독/낭독 모드 전환 위치 보존
- S6: 생성 중 다른 책 이동 토큰 오염
- S7: 사이드바 인물 표시 (이름/성별)
- S8: 본문 하단 character cards 등장 인물 필터
- S9: 소지품 설명 길이 + 사용자 입력 보존
- S11: 재생성 divergence
- S15: 캡처 화 제목 포맷 (괄호 제거 확인)
- S16: 인물명 밑줄 + 성별 색상
- S12 / S13 deferred 항목

### P3 (저우선)
- DeepSeek 클라이언트 코드 cleanup (`POST-4`)
- `data/datasets/dpo_v*.jsonl` gitignore 검토
- `_inferItemBadge` 키워드 단순화 (LLM/vocab 정착 후)
- orphan rows 14,620 cleanup (별도 phase)

---

## 8. Browser 재검증 요청 항목

P1 fix 효과 확인을 위해 다음 순서로 부탁드립니다.

1. **서버 재시작** (TS 변경 반영: `src/api/generate.ts`, `src/services/item_desc.ts`).
2. **브라우저 hard refresh** (Ctrl+Shift+R).
3. **"바보바보바보" 책 1화 진입** — 제논의 합성 영양바가 처음에 어떤 배지로 보이는지 기록.
   - 첫 진입: "기타" (또는 미표시) — 정상. 이때 백그라운드 LLM 분류 큐잉됨.
   - 한 번 더 새로고침 또는 다른 화로 이동 후 1화 재진입: "식량" 배지로 변경되어야 정상.
4. (선택) 진단 스크립트 실행:
   ```bash
   node scripts/audit_item_vocab.mjs --book-id <바보바보바보_book_id>
   ```
   - 출력의 `dynamic-only items vocab 미등록`에 합성 영양바가 떠야 합니다 (1차 진입 직후).
   - 1차 진입 + 백그라운드 분류 완료 후 다시 실행하면 vocab miss 항목에서 사라져야 합니다.
5. POST-1 audit checklist의 미회신 시나리오 (S1, S3, S4, S6, S7, S8, S9, S11, S15, S16) PASS/WARN/FAIL 회신 부탁드립니다 — P2 분류 진행용.

---

## 9. 부가 안내

- **새 책 / 새 인물 추가 흐름**은 기존대로 `generateAndSaveItemDescriptions`가 처리 (description + category 동시). 이번 fix는 그 외 경로 — 스토리 진행 중 등장한 dynamic items의 vocab 미누적만 보강.
- **사용자 입력 description은 절대 덮이지 않음** — `classifyAndSaveItemCategories`는 vocab만 INSERT.
- **LLM 호출 실패 시** silent return — 사용자 응답에 영향 0. 다음 호출 시 재시도 (vocab miss이면 또 큐잉됨).
- **Production blocker 미발견** 상태 유지. main push / DPO / Runpod 미실행.
