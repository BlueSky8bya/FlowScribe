# POST-1 — Residual Inventory + P1/P2/P3 Classification

**날짜**: 2026-05-03
**Phase**: POST-1 잔여 정리 (post1-ui-data-audit-checklist 후속)
**브랜치**: `checkpoint/phase1-launch-prep` (≡ `origin/main`)
**전제**: S2/S5/S10/S14/S17 + §7.1/§7.2/§7.3 fix 적용됨 (`45e7b18` ~ `7ab98cb`).

---

## 0. P0 Production Blocker 확인

| 항목 | 상태 | 근거 |
|---|---|---|
| route 안정성 | ✅ 변경 없음 | `active_route=openai_renderer` 유지, `verify_route_integrity` 6/0/0 |
| build/typecheck | ✅ PASS | `tsc` no error |
| critical verify suite | ✅ PASS | `verify_episode_end_character_cards` 27/27, `verify_episode_end_character_cards_layout` 22/22, `verify_book_load_flow` 41/0, `verify_episode_end_state_alignment` 17/17, `verify_meaningful_appearance_guard` 17/17 |
| char_states emit 정합 | ✅ 보존 | char-states API 응답 구조 변경 없음 |

**P0 blocker 미발견.** 코드 수정 phase로 진행.

---

## 1. Remaining Issues Inventory

### 1.1 사장 명시 P1 후보 (이번 phase 작업 대상)

| ID | 이슈 | 출처 | 진단 결과 |
|---|---|---|---|
| **D1** | 인물카드에 카테고리 배지 누락 케이스 (`합성 영양바` 등 음식류) | 사장 직접 보고 (바보바보바보 1화 제논) | client `_buildCapStyleCharCardHtml`이 server `it.category` 무시하던 문제 → `7ab98cb`에서 server-first lookup 적용 완료. 단, server-side 흐름에 누수가 있어 dynamic items가 vocab에 안 들어갈 수 있음 (§D2 참고) |
| **D2** | LLM 분류가 dynamic items에 도달 안 함 | 코드 흐름 분석 | `generateAndSaveItemDescriptions` 호출 시점이 (a) `/api/context` 저장 — context.ts:288, (b) `/api/characters` 추가 — characters.ts:94, (c) `/api/generate/char-states` description 누락 시 — generate.ts:796 한정. **스토리 진행 중 새로 등장한 dynamic items는 LLM 분류 트리거 없이 `_inferItemBadge` (server) → `_capQlabel` (client) 키워드 fallback에만 의존**. 키워드 양쪽에서 "식량" 등 누락 → 미매칭 시 "기타" 또는 배지 미표시 |
| **D3** | server `_inferItemBadge`에도 식량 키워드 없음 | [src/api/generate.ts:646-659](src/api/generate.ts#L646) | client만 server-first 가도 server가 "기타"로 분류해서 보내면 client도 "기타". 사장 정책상 server에 식량 키워드 추가도 동일선상의 하드코딩이라 금지. LLM 트리거가 정공법 |

### 1.2 POST-1 audit checklist 미회신 시나리오 (browser 재검증 필요)

S1, S3, S4, S6, S7, S8, S9, S11, S12, S13, S15, S16에 대한 PASS/WARN/FAIL 회신 미수령. 잠재 P1/P2/P3은 회신 후 분류 가능. 현재까지 확인된 fix들은:

| 시나리오 | 코드 fix 적용 | 사장 회신 |
|---|---|---|
| S2 (separator + 책 제목 두께) | ✅ 적용 (`45e7b18`) | 미회신 |
| S5 (hybrid streaming) | n/a (시스템 정상) | 미회신 |
| S10 (인물카드 parity) | ✅ reopen-3까지 적용 (`cd04acf`) | reopen → reopen-3 거쳐 fixed로 보고됨 |
| S14 (AI 추천 중복) | ✅ cross-card dedup (`45e7b18`) | 미회신 |
| S17 (404 + aria-hidden) | ✅ Redis fall-through + inert (`45e7b18`) | 미회신 |

### 1.3 알려진 P2/P3 backlog (이번 phase 미진행)

| ID | 영역 | 비고 |
|---|---|---|
| C1 | data leftovers (`.claude/scheduled_tasks.lock`, `scripts/cloud_dpo/launch_dpo.py`) | 사장 정책 stage 금지 |
| C2 | `data/datasets/dpo_v*.jsonl` 다수 | DPO 학습 산출물, gitignore 검토 후순위 |
| C3 | DeepSeek 클라이언트 코드 잔존 (사용 안 함) | POST-4 후보 |
| C4 | orphan rows 14,620 cleanup | production 영향 0, 별도 phase |
| C5 | docs/audit-sop.md legacy verify 분류 후 미수정 잔재 | POST-3에서 일부 처리됨 |

---

## 2. P1/P2/P3 Classification

### P1 (high priority — 이번 phase 진행)

| ID | 이슈 | 결정 |
|---|---|---|
| **P1-A** | D2 — dynamic items vocab 누수 | char-states 엔드포인트에서 vocab 미등록 아이템을 비동기 LLM 분류 큐잉. description 미터치 보장 (사용자 입력 보존 정책과 호환). |
| **P1-B** | 진단 가시화 — `audit_item_vocab.mjs` | book_id별 vocab 통계 + dynamic items 중 vocab 미등록 아이템 식별. read-only. |

### P2 (medium — 사장 회신 후 결정)

| ID | 이슈 | 비고 |
|---|---|---|
| P2-A | S1, S3, S4, S6, S7, S8, S9, S11, S15, S16 미회신 | browser 재검증 결과 받은 후 분류 |
| P2-B | S12 (세계관 설정 저장) / S13 (설정 뷰어) 회귀 가능성 | §6.2-§6.4 deferred 항목 — 사장 회신 후 |
| P2-C | item description sanitize 정책 30~40자 일관성 | verify_item_description_length는 PASS이나 실측 회신 필요 |

### P3 (low / cleanup)

| ID | 이슈 | 비고 |
|---|---|---|
| P3-A | DeepSeek client cleanup | POST-4 후보 |
| P3-B | dpo_v*.jsonl gitignore | 산출물 정리 |
| P3-C | `_inferItemBadge` 키워드 정리 — LLM 분류로 점진 대체 후 단순화 | 시스템 안정화 후 |

---

## 3. P1 Fix 작업 계획 (이번 phase)

1. **audit_item_vocab.mjs** read-only 진단 스크립트 작성 (`scripts/`)
2. **classifyMissingItems** 새 함수 — `item_desc.ts`에 추가. description 미터치, vocab만 누적.
3. **char-states 엔드포인트** 수정 — vocab 미등록 dynamic items에 fire-and-forget classify trigger.
4. verify suite 갱신 (필요 시), build, commit (각 변경 별 작은 단위).

---

## 4. 금지 영역 (이번 phase)

- ❌ 새 기능 대규모 추가
- ❌ route 변경 / prompt 대규모 변경 / DeepSeek 정책 변경
- ❌ 키워드 if문 추가로 카테고리 매칭 늘리기 (사장 명시 정책)
- ❌ 100/50/30화 actual / DB cleanup apply
- ❌ P2/P3 광범위 동시 수정
- ❌ leftover 파일 staging
