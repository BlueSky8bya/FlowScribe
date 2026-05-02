# POST-2 — UX Policy Migration Inventory

**날짜**: 2026-05-03
**Phase**: POST-2 (UX Policy Migration)
**브랜치**: `checkpoint/phase1-launch-prep` (≡ `origin/main` 동기)
**HEAD**: `0e9ed73` (POST-1 closeout)
**원칙**: 코드 수정 0건 — read-only inventory + 권고안 + 사장 결정 항목 정리.

---

## 1. POST-2 Scope

| 포함 | 제외 |
|---|---|
| 사용자-facing UX 정책 확정 (audit checklist 미회신 12개) | generation route / prompt / story quality guard |
| S12 (세계관 저장) / S13 (설정 뷰어) deferred 항목 | DB schema 변경 |
| stale verify refresh (작은 단위) | DeepSeek cleanup (POST-4) |
| 알려진 P2 항목 정리 | 대규모 리팩터링 |

P3 cleanup (DeepSeek / dpo gitignore / `_inferItemBadge` 단순화 등) → **POST-4**.

---

## 2. 항목별 현재 상태 + 권고안

각 시나리오는 **코드 영역 / 관련 verify / 현재 상태 / 분류 / 권고**.

### S1. 새로고침 + 서재/에피소드 표시

| 항목 | 값 |
|---|---|
| 코드 영역 | [public/js/auth.js:selectBook](public/js/auth.js), [public/js/app.js:updateEpisodeUI](public/js/app.js), favicon (FINAL §5.4 inline SVG) |
| 관련 verify | `verify_book_load_flow` 41/0 PASS |
| 현재 정책 | hard refresh 후 책 목록 + ep1 자동 노출, favicon 200 |
| **분류** | **KEEP** |
| 권고 | 정책 그대로 유지. POST-1에서 책 제목 폰트 1.45rem 증가 적용된 상태 |

### S3. 다음/이전화 이동 + 스크롤 anchor

| 항목 | 값 |
|---|---|
| 코드 영역 | `public/js/app.js`의 `loadEpisode/viewPrev/viewNext` |
| 관련 verify | `verify_reading_mode_scroll_anchor` 10/10 PASS |
| 현재 정책 | 화 변경 시 본문 영역 자동 상단 스크롤 + 헤더 갱신 |
| **분류** | **KEEP** |
| 권고 | 변경 없음. R5A scroll anchor 정책 유지 |

### S4. 청독/묵독/낭독 모드 전환 + 위치 보존

| 항목 | 값 |
|---|---|
| 코드 영역 | `public/js/voice.js` (TTS), `public/js/app.js` (모드 토글) |
| 관련 verify | 없음 (정적 contract 미정의) |
| 현재 정책 | 모드 전환 시 현재 단락 위치 보존 + 모드별 시각 차이 |
| **분류** | **KEEP** (단, **사장 회신 필요** — 위치 보존이 만족스러운지) |
| 권고 | 사장 browser 검증 후 변경 여부 결정. 보존 정책 그대로면 verify 1개 추가 가능 (POST-2 P3) |

### S6. 생성 중 다른 책 이동 — 토큰 오염 차단

| 항목 | 값 |
|---|---|
| 코드 영역 | [generate.js:663-669](public/js/generate.js#L663) `bookId !== _genSession.bookIdAtStart` 체크 + toast |
| 관련 verify | `verify_active_gen_book_return` 18/18 PASS, `verify_generation_session_guard` **11/12** (1 stale) |
| 현재 정책 | 슬롯 A 생성 중 슬롯 C 이동 → 슬롯 C에 토큰 오염 0, 토스트 표시, 슬롯 A 복귀 시 in-progress UI 복원 |
| **분류** | **KEEP + verify refresh** (P3 작은 작업) |
| 권고 | 기능은 정상. verify의 stale string `"token discarded (stale session)"` 매칭 실패 — 실제 코드는 한국어 toast 메시지로 처리. POST-3 패턴 동일 verify refresh 1건 |

### S7. 사이드바 인물 표시 (이름/성별만)

| 항목 | 값 |
|---|---|
| 코드 영역 | [generate.js:updateSceneCharPanel](public/js/generate.js), [config.js TYPES/GENDERS](public/js/config.js) (POST-1 §7.x 갱신) |
| 관련 verify | `verify_episode_end_character_cards` 27/27 (사이드바 minimal 검증 포함) |
| 현재 정책 | 사이드바 = 이름 + 성별 dot/색상만. 상세는 본문 하단 ep-end 카드. POST-1 §7.2 role-based TYPES, §7.3 GENDERS 3종 (남성/여성/기타) |
| **분류** | **KEEP** |
| 권고 | POST-1에서 정리됨 |

### S8. 본문 하단 Episode End Character Cards

| 항목 | 값 |
|---|---|
| 코드 영역 | `_buildCapStyleCharCardHtml` (POST-1 S10에서 shared renderer로 정리) |
| 관련 verify | `verify_episode_end_character_cards` 27/27, `verify_episode_end_character_cards_layout` 22/22 |
| 현재 정책 | 캡처 카드와 동일 markup, fontScale 1.3, align-items:stretch 행별 통일, 카테고리 배지 .85em |
| **분류** | **KEEP** (POST-1 S10 fixed + browser verified) |
| 권고 | 변경 없음. closed 항목 |

### S9. 소지품 설명 길이 + 사용자 입력 보존

| 항목 | 값 |
|---|---|
| 코드 영역 | [src/services/item_desc.ts](src/services/item_desc.ts) `sanitizeLLMItemDescription` (40자 정책), `description_source: "llm"` 마킹 |
| 관련 verify | `verify_item_description_length` 21/21 PASS |
| 현재 정책 | LLM 출처 description은 40자 sentence-aware cut. 사용자 입력은 보존. POST-1 §P1-A reopen-3에서 `_CATEGORY_GUIDE` 적용으로 category 정확도도 강화 |
| **분류** | **KEEP** (단, **사장 회신 필요** — 실측 사용자 체감) |
| 권고 | verify는 통과하지만 실제 카드에서 일부 description이 너무 짧거나 어색하지 않은지 사장 browser 회신 부탁. 회신 결과에 따라 prompt 미세 조정 가능 |

### S11. 재생성 divergence

| 항목 | 값 |
|---|---|
| 코드 영역 | [src/services/regen_divergence.ts](src/services/regen_divergence.ts), R5B-3 dedup, R6 stress test |
| 관련 verify | `verify_regeneration_divergence_contract` 20/20 PASS |
| 현재 정책 | 재생성 시 본문 길이 + 줄거리 변화 보장, score 80 유지, R6 10회 stress 통과 입증 |
| **분류** | **KEEP** |
| 권고 | 변경 없음. R6 누적 evidence 보존 |

### S12. 세계관 설정 저장 + 닫기 (deferred §6.2)

| 항목 | 값 |
|---|---|
| 코드 영역 | [public/js/modal.js:saveContext](public/js/modal.js) |
| 관련 verify | `verify_modal_save` 16/16 PASS (POST-1 refresh — saveContext extract + aria-hidden + inert + `_restoreBtn` 위임) |
| 현재 정책 | 저장 시 button disabled + 메시지 cycle, 성공 시 closeModal + sb 활성화, 실패 시 catch에서 `_restoreBtn()` 위임 |
| **분류** | **KEEP** (단, **사장 회신 필요** — UX 흐름 만족도) |
| 권고 | 코드 흐름은 안정. 사장 browser 검증 후 추가 polish 결정 |

### S13. 세계관 설정 뷰어 — 배경/장르/연출 고정 표시 (deferred §6.3)

| 항목 | 값 |
|---|---|
| 코드 영역 | `public/js/modal.js` + `public/js/ui.js` 의 settings panel 섹션 |
| 관련 verify | 없음 |
| 현재 정책 | 배경/장르/연출 고정/규칙 섹션 모두 표시 (POST-1에서 audit 미회신) |
| **분류** | **DEFER** |
| 권고 | 사장 browser 회신 필수. "배경/장르/연출 고정" 섹션이 표시는 되는지, 입력값이 저장과 일치하는지 확인 후 결정. 회신 없이는 변경 위험 |

### S15. 캡처 — 화 제목 포맷

| 항목 | 값 |
|---|---|
| 코드 영역 | `public/js/generate.js` capture flow (FINAL §5.2 괄호 제거) |
| 관련 verify | 없음 (정적 contract 미정의) |
| 현재 정책 | `1화 [화 제목]` (괄호 없음), 책 제목 별도 줄 |
| **분류** | **KEEP + verify 추가 후보** (P3) |
| 권고 | 정책 명확. 회귀 방지를 위해 capture title format 정적 verify 1개 추가 가능 (POST-2 작은 작업) |

### S16. 인물명 밑줄 + 성별 색상

| 항목 | 값 |
|---|---|
| 코드 영역 | [generate.js:wrapCharNamesInOutput](public/js/generate.js), `_GENDER_COLOR` |
| 관련 verify | `verify_episode_character_display_filter` 20/20 PASS |
| 현재 정책 | 본문 인물명 두꺼운 밑줄 (border-bottom alpha cc), 남성 #5a8fd4 / 여성 #d47090 / 기타 var(--text4) |
| **분류** | **KEEP** |
| 권고 | Phase 4.19 정책 명확. 변경 없음 |

---

## 3. 수정 필요 여부 (요약)

| 시나리오 | KEEP | CHANGE | REMOVE | DEFER |
|---|---|---|---|---|
| S1 | ✓ | | | |
| S3 | ✓ | | | |
| S4 | ✓* | | | |
| S6 | ✓ | | | |
| S7 | ✓ | | | |
| S8 | ✓ | | | |
| S9 | ✓* | | | |
| S11 | ✓ | | | |
| S12 | ✓* | | | |
| S13 | | | | ✓ |
| S15 | ✓ | | | |
| S16 | ✓ | | | |

`*` = 사장 browser 회신 후 최종 KEEP 확정.

**총평**: 12개 중 11개는 KEEP 권고, 1개(S13)는 DEFER. 코드 정책 변경 필요 항목 0건. 단, **사장 browser 회신 필요 항목 4건 (S4/S9/S12/S13)**.

---

## 4. P2/P3 재분류

### POST-2 진행 후보 (작은 작업, P3 cleanup이지만 POST-2 범위 안에서 처리)

| ID | 작업 | 변경 파일 | 비용 |
|---|---|---|---|
| **P3-V1** | `verify_generation_session_guard` stale string refresh — 한국어 toast 메시지 contract로 갱신 | `scripts/verify_generation_session_guard.mjs` 1개 | 작음 |
| **P3-V2** | (선택) capture title format 정적 verify 추가 — FINAL §5.2 괄호 제거 회귀 방지 | `scripts/verify_capture_title_format.mjs` 신규 1개 | 작음 |
| **P3-V3** | (선택) S4 청독/묵독/낭독 모드 위치 보존 contract verify | `scripts/verify_reading_mode_position_preserve.mjs` 신규 1개 | 중간 (mode 토글 지점 추적 필요) |

### POST-4로 이관 (cleanup)

- DeepSeek 클라이언트 잔존 코드 제거
- `data/datasets/dpo_v*.jsonl` gitignore 검토
- `_inferItemBadge` (server) / `_capQlabel` (client) 키워드 휴리스틱 단순화
- orphan rows 14,620 cleanup
- `audit_item_vocab.mjs` 카테고리별 detail 출력 옵션

---

## 5. 사장 결정 결과 (2026-05-03 회신)

| 질문 | 결정 |
|---|---|
| **Q1 S4 모드 위치 보존** | **KEEP** — 단락 위치 유지 정책 그대로. 본문 처음으로 이동 변경 안 함. |
| **Q2 S9 소지품 설명 길이** | **KEEP** — 40자 sentence-aware cut + verify 21/21 그대로. prompt/cut 정책 변경 금지. |
| **Q3 S12 세계관 저장 흐름** | **KEEP** — POST-1에서 modal save/close/aria-hidden/inert/button restore 정리됨. 추가 polish 안 함. |
| **Q4 S13 세계관 뷰어** | **DEFER (browser 확인 대기)** — 코드 수정 금지, S13 browser checklist 별도 정리. PASS/WARN/FAIL 회신 후 KEEP/reopen 결정. |
| **Q5 verify 추가** | **V1 + V2 진행, V3 보류** — V1 (session_guard refresh), V2 (capture_title_format 신규), V3 (reading_mode_position) 보류. |

---

## 6. 진행 흐름 권고

1. **사장 browser 회신** (Q1~Q4 PASS/WARN/FAIL)
2. 회신 결과 따라 **KEEP confirm** 또는 **변경 commit**
3. **Q5 결정** 따라 verify refresh 작업 (1~3 commits)
4. POST-2 closeout report 작성 후 main push

---

## 7. 본 phase 작업물 (현재까지)

| 산출물 | 위치 |
|---|---|
| 본 inventory | `docs/post2-ux-policy-inventory-2026-05-03.md` |
| 코드 변경 | **0건** (사장 명시 — read-only inventory) |

git status:
```
 M .claude/scheduled_tasks.lock         (untouched, NOT staged)
 M scripts/cloud_dpo/launch_dpo.py      (untouched, NOT staged)
```

leftover stage 0건 — 사장 정책 100% 준수.
