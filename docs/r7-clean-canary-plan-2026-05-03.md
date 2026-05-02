# R7 — Clean Canary Plan (30→50화)

**날짜**: 2026-05-03
**Phase**: R7 (Clean Canary)
**브랜치**: `checkpoint/phase1-launch-prep` (≡ `origin/main` `d290f05`)
**전제**: POST-1 / POST-2 / POST-4 모두 CLOSED, route=openai_renderer 유지, prompt/route/DB 변경 금지

---

## 1. 목표

main 기준 clean 30→50화 actual 실행으로:
1. **장편 generation stability** (route 안정성, fallback 0, parse 0)
2. **R5B+ 누적 story quality 정책** 회귀 0 (dedup, 사망자 발화 차단, 위치 점프 차단, 지식 누출 차단, repetition guard, foreshadow resolution)
3. **continuity** (ep N → N+1 자연스러운 흐름, item ledger, dynamic state, location transition)
4. **regeneration** (최신화만, divergence 유지)
5. **POST-1/2/4 regression** (UI/data 표시 정합성)

코드 수정 0건 의도. Canary fail 시 원인 분류만 우선, 즉시 수정 금지.

---

## 2. Canary Book 설계

### 2.1 장르 선택 — 포스트아포칼립스 서바이벌

근거:
- 기존 확깨용/SF_DETECTIVE/CRIME_THRILLER/OFFICE_ROMANCE와 다른 새 장르
- 식량/의료/도구/무기/기기/통신 카테고리 자연스럽게 등장 → POST-1 §P1-A reopen-3 vocab/canonical priority 정착도 검증에 적합
- 위치 점프, 자원 추적(item ledger), 사망자 처리(R5B-1.8D), 지식 경계 등 누적 정책 모두 부담스럽게 검증 가능

### 2.2 책 메타 (사장이 책 생성 시 입력 사항)

```
title:    R7_CANARY_POSTAPOC (또는 사장 선호명)
genres:   포스트아포칼립스 / 서바이벌 / 드라마
mood:     긴장 / 절망 / 연대
pov:      3인칭 관찰자 (또는 1인칭 주인공 — 사장 선택)
style:    균형
episodeLength: 2000자 ± 500
totalEpisodes: 30 (1차) / PASS 시 50까지 확장
conflict/foreshadow/emotion/dialogue/direction: 5/5/5/5/5 (균형)
```

### 2.3 인물 4명 (사장이 직접 입력, 또는 AI 추천 후 보정)

| 역할 | 인물 | 성별 | 비고 |
|---|---|---|---|
| 주인공 | (사장 선택) | (자유) | 강한 의지 + 한 가지 결정적 약점 |
| 조력자 | (사장 선택) | (자유) | 주인공과 다른 강점 보완 |
| 적대자 | (사장 선택) | (자유) | 같은 자원을 두고 갈등 |
| 라이벌/조연 | (사장 선택) | (자유) | 후반 reveal 또는 변화 가능성 |

### 2.4 initial_items — 카테고리 다양성 보장

각 인물에 다음 카테고리 중 **최소 4개 이상 분포**되게 입력:
- 식량 (예: 통조림, 영양바, 비상식)
- 의료 (예: 붕대, 진통제, 주사기)
- 도구 (예: 손전등, 로프, 자물쇠 도구)
- 무기 (예: 단검, 권총, 단봉)
- 기기 (예: 스마트폰, 태블릿)
- 통신 (예: 무전기)
- 의복 (예: 방수 외투)

이 분포로 LLM 분류(`generateAndSaveItemDescriptions`)가 음식·식수·약품·도구를 정확히 분리하는지 검증.

### 2.5 세계관 규칙 (한 줄씩, hard rule 1-2개 포함)

예시 (사장이 자유 선택):
- 일반 규칙: "전기는 배터리/태양광에 한정", "야간 이동은 위험", "수원 오염 가능성 있음"
- 절대 규칙(hard): "사람을 식량으로 삼지 않는다", "방사능 오염 지역은 표시한다"

### 2.6 새 책 생성 후 사전 검증

```bash
# 1. canonical_characters 확인
node -e "/* book_id 받아 canonical 4명 출력 */"

# 2. initial_items 카테고리 분포 확인 (LLM 분류 후)
node scripts/audit_item_vocab.mjs --book-id <BOOK_ID> --detail

# 기대: vocab coverage 100%, "기타" 0건, mismatch 0건
# 만약 LLM 분류가 음식을 도구/소모품으로 보내면 P1-A reopen-4 후보
```

---

## 3. 측정 항목 + Audit/Verify Mapping

### 3.1 Generation Stability

| metric | 측정 방법 |
|---|---|
| fail count | `logs/generation_*.log` grep "ERROR" + `run_traces.metadata.fallback_used` |
| fallback count | `run_traces.planner_trace.fallback_used = true` 카운트 |
| parse fail | `run_traces.metadata.parse_error` |
| foreign/OOD token | `audit_generation_quality_integrity.mjs --book-id <X>` |
| special token | 동일 |
| retry count | `run_traces.metadata.retry_count` 합계 |

판정:
- P0: fallback>0 / parse fail>0 / foreign token≥1 / score=0
- P1: retry≥3회 한 화에서 발생 / 일관된 warning
- P2: cosmetic warning

### 3.2 Story Quality

| 항목 | Audit |
|---|---|
| duplicate discovery | `audit_duplicate_discovery_events.mjs --book-id <X>` |
| repeated plot loop | `audit_narrative_repetition_guard.mjs` + `audit_narrative_progression_stagnation.mjs` |
| 사망자 발화 | `audit_meaningful_appearance_overlay.mjs` (visibility_state="dead" 인물의 dialogue 검출) |
| 소지품 모순 | `audit_item_location_ledger.mjs --book-id <X>` |
| 위치 점프 | `audit_scene_transitions.mjs --book-id <X>` |
| 지식 누출 | `audit_knowledge_boundaries.mjs --book-id <X>` |
| 관계 급변 | `audit_emotional_progression.mjs` + `audit_emotional_plausibility.mjs` |
| 비정규 인물명 | `audit_character_aliases.mjs --book-id <X>` |

판정:
- P0: 사망자 발화 발생 / 지식 누출 명백 (캐릭터 미접근 정보를 발화 등)
- P1: duplicate discovery≥3건 / 위치 점프≥3건 / 관계 급변≥2건
- P2: dialogue repetition cosmetic / 소량 emotional plausibility WARN

### 3.3 Continuity

| 항목 | Audit |
|---|---|
| ep N → N+1 자연 흐름 | `audit_cross_episode_continuity.mjs --book-id <X>` |
| item ledger | `audit_item_location_ledger.mjs --book-id <X>` (owner/condition/grade 불일치) |
| character_dynamic_states canonical-only | DB 직접 조회 — `character_dynamic_states.character_name`이 canonical_characters에 모두 존재하는지 |
| location transition | `audit_scene_transitions.mjs --book-id <X>` |
| foreshadow 중복 plant | `audit_foreshadow_resolution.mjs --book-id <X>` |

판정:
- P0: dynamic_states에 canonical에 없는 character_name 등장 (R3 canonical-only 위반)
- P1: item ledger 모순 ≥3건 / foreshadow 중복 plant ≥2건
- P2: location transition warning ≥3건 (소량)

### 3.4 Regeneration

| 항목 | Audit |
|---|---|
| 최신화 재생성만 가능 | UI 동작 — 30화 작성 중 5/15/25화 재생성 시도 → 차단 메시지 확인 |
| N-1 확정 문맥 보존 | `audit_regen_overconstraint.mjs --book-id <X>` |
| 기존 N화와 다른 대체 전개 | `audit_episode_regen_divergence.mjs --book-id <X> --episode N` |
| location/event/emotional 다양성 | `audit_regen_plot_diversity.mjs --book-id <X>` |
| regen 후 메모리 | `audit_regeneration_memory.mjs --book-id <X>` |

권고 절차 (canary 중):
- 10화, 20화, 30화 각각 도달 후 1회씩 재생성 → divergence 측정
- 통과 후 50화 확장에서 40화, 50화 도달 후도 1회씩

판정:
- P0: 과거 화 재생성이 가능해짐 (정책 위반)
- P1: regen 결과가 99% 동일 plot / divergence score < 60%
- P2: cosmetic — 일부 단어 반복

### 3.5 POST-1/2/4 Regression

| 항목 | Verify (정적) |
|---|---|
| ep-end character cards | `verify_episode_end_character_cards` 27/27 + `_layout` 22/22 |
| item category badge | `verify_item_category_source_priority` 12/12 |
| vocab > canonical priority | `audit_item_vocab.mjs --book-id <X> --detail` mismatch 0 검증 |
| 세계관 설정 뷰어/저장 | `verify_modal_save` 16/16 |
| capture title format | `verify_capture_title_format` 8/8 |
| reading mode preserve | `verify_reading_mode_position_preserve` 15/15 |
| route integrity | `verify_route_integrity` 6/0/0 |

이 7개 verify는 30화 generation 시작 전 + 30화 도달 후 + 50화 도달 후 각각 실행. 셋 다 PASS 유지 필수.

또한 brower 회귀 체크 (사장 직접):
- 슬롯 = canary book
- 1화/15화/30화 본문 표시
- ep-end 카드 표시 + 카테고리 배지
- 캡처 모드
- 모드 전환 (청독/묵독/낭독)
- 세계관 설정 모달 열기/저장
- 다른 책 전환 시 데이터 잔존 0

---

## 4. 실행 명령 시퀀스

### 4.1 Pre-canary (30화 시작 전)

```bash
# 0. main 동기 + build
git pull origin main
npm run build

# 1. 정적 verify suite (POST-1/2/4 baseline)
node scripts/verify_route_integrity.mjs
node scripts/verify_episode_end_character_cards.mjs
node scripts/verify_episode_end_character_cards_layout.mjs
node scripts/verify_item_category_source_priority.mjs
node scripts/verify_modal_save.mjs
node scripts/verify_capture_title_format.mjs
node scripts/verify_reading_mode_position_preserve.mjs
node scripts/verify_book_load_flow.mjs
node scripts/verify_public_js_syntax.mjs
node scripts/verify_context_save_async.mjs
node scripts/verify_generation_session_guard.mjs
node scripts/verify_item_description_length.mjs

# 2. (book 생성 후) initial vocab 분포
BOOK_ID=<canary_book_id>
node scripts/audit_item_vocab.mjs --book-id $BOOK_ID --detail

# 모두 PASS + vocab 분포 다양 → 30화 actual 진입
```

### 4.2 30화 Actual (사장 browser/UI 실행)

- 1~30화 순차 생성
- 각 5화 도달 시 console error 0 + ep-end card 정상 + score≥80 모니터
- 10/20/30화 도달 후 그 화 재생성 1회씩 (regen divergence 측정용)

### 4.3 30화 도달 후 Mid-canary Audit

```bash
BOOK_ID=<canary_book_id>

# Stability
node scripts/audit_generation_quality_integrity.mjs --book-id $BOOK_ID

# Story quality
node scripts/audit_duplicate_discovery_events.mjs --book-id $BOOK_ID
node scripts/audit_narrative_repetition_guard.mjs --book-id $BOOK_ID
node scripts/audit_narrative_progression_stagnation.mjs --book-id $BOOK_ID
node scripts/audit_item_location_ledger.mjs --book-id $BOOK_ID
node scripts/audit_scene_transitions.mjs --book-id $BOOK_ID
node scripts/audit_knowledge_boundaries.mjs --book-id $BOOK_ID
node scripts/audit_emotional_progression.mjs --book-id $BOOK_ID
node scripts/audit_emotional_plausibility.mjs --book-id $BOOK_ID
node scripts/audit_character_aliases.mjs --book-id $BOOK_ID
node scripts/audit_meaningful_appearance_overlay.mjs --book-id $BOOK_ID
node scripts/audit_episode_end_state_alignment.mjs --book-id $BOOK_ID
node scripts/audit_episode_end_item_state.mjs --book-id $BOOK_ID

# Continuity
node scripts/audit_cross_episode_continuity.mjs --book-id $BOOK_ID
node scripts/audit_foreshadow_resolution.mjs --book-id $BOOK_ID
node scripts/audit_story_integrity_30.mjs --book-id $BOOK_ID

# Regeneration (10/20/30화 재생성 후)
node scripts/audit_episode_regen_divergence.mjs --book-id $BOOK_ID
node scripts/audit_regen_plot_diversity.mjs --book-id $BOOK_ID
node scripts/audit_regen_overconstraint.mjs --book-id $BOOK_ID
node scripts/audit_regeneration_memory.mjs --book-id $BOOK_ID

# Vocab/Category 정착도
node scripts/audit_item_vocab.mjs --book-id $BOOK_ID --detail

# 정적 verify 재실행 (회귀 체크)
node scripts/verify_route_integrity.mjs
node scripts/verify_episode_end_character_cards.mjs
node scripts/verify_item_category_source_priority.mjs
```

### 4.4 30화 PASS 판정 → 50화 확장

조건 (모두 충족):
- P0 0건
- P1 ≤ 1건 (이미 알려진 known issue 제외)
- regen divergence ≥ 60% (10/20/30화 평균)
- vocab mismatch 0
- 정적 verify 13개 모두 PASS

PASS 시 31~50화 진행.

### 4.5 50화 도달 후 Final Audit

§4.3과 동일 + 추가:
- 40, 50화 재생성 후 divergence
- 30화 vs 50화 누적 dynamic_states 비교 (메모리 정확성)

---

## 5. 판정 기준

| Severity | 정의 | 처리 |
|---|---|---|
| **P0** | route fallback / parse fail / foreign token / score=0 / generation 자체 실패 / 사망자 발화 / 지식 누출 명백 / dynamic_states canonical 위반 / 과거화 재생성 가능 | 즉시 코드 수정 phase 진입 (R7-fix) |
| **P1** | retry≥3 / item ledger 모순≥3 / 위치 점프≥3 / 관계 급변≥2 / regen divergence<60% / vocab mismatch | R7-fix 또는 별도 phase |
| **P2** | cosmetic warning / repetition cosmetic / location transition≥3 (소량) | backlog |

P0 발견 시 코드 수정 전 **원인 분류 보고** 필수 (사장 명세).

---

## 6. 산출물

| 단계 | 산출물 | 위치 |
|---|---|---|
| pre-canary | 본 plan | `docs/r7-clean-canary-plan-2026-05-03.md` |
| 30화 도달 후 | mid-canary partial report | `docs/r7-clean-canary-mid-report-2026-05-XX.md` |
| 50화 도달 후 (PASS 시) | final report | `docs/r7-clean-canary-report-2026-05-XX.md` |
| FAIL 시 | 원인 분류 보고 | `docs/r7-fail-classification-2026-05-XX.md` |

코드 변경 0 의도. report만 commit.

---

## 7. 본 phase 금지 (사장 명세 준수)

- ❌ 새 기능 추가
- ❌ route 변경 / model_routes.json 수정
- ❌ prompt 대규모 변경
- ❌ DB write cleanup (orphan / canonical reclassify 일괄 등)
- ❌ DeepSeek cleanup 또는 재활성
- ❌ FAIL 시 즉시 코드 수정 (먼저 원인 분류 보고)
- ❌ `_capQlabel` / `_inferItemBadge` 단순화
- ❌ leftover 2건(`.claude/scheduled_tasks.lock`, `scripts/cloud_dpo/launch_dpo.py`) staging

---

## 8. 사장 결정 필요 항목 (실행 전)

### Q1. Canary 책 생성 주체
- 옵션 A: 사장이 browser UI에서 직접 새 책 생성 + 인물/세계관/소지품 입력
- 옵션 B: 자동화 스크립트(scripts/setup_test_books.mjs 패턴) 작성해서 일괄 생성

권고 A — 실제 사용자 흐름과 가장 가까움.

### Q2. 장르 확정
- 옵션 1: 포스트아포칼립스 서바이벌 (본 plan 권고)
- 옵션 2: 사장 선호 다른 장르 (해양 어드벤처 / 학원 미스터리 / 사극 정치 등 — 단 인물/소지품 카테고리 다양성 보장)

### Q3. 30화 actual 실행 시점
- 즉시 진행 / 일정 협의 후 진행 / 미정

### Q4. 50화 확장 자동 vs 수동
- 30화 PASS 시 자동 31~50 진행 / PASS 보고 후 사장이 별도 승인 후 진행

### Q5. regen 정책
- 권고 — 10/20/30화 도달 후 1회씩 재생성 (총 3회). divergence 측정용
- 더 많은 횟수 / 다른 화 / regen 0회 등 사장 결정 가능

---

## 9. 진행 흐름 권고

1. **사장이 Q1~Q5 결정**
2. Canary book 생성 (Q1 옵션에 따라)
3. Pre-canary verify suite + initial audit_item_vocab
4. 30화 actual + 10/20/30화 재생성 (Q5)
5. Mid-canary audit
6. PASS 판정 → 50화 확장 (Q4 옵션 따라)
7. Final audit + report
8. FAIL → 원인 분류 보고 → 사장 결정 후 R7-fix phase

---

## 10. 본 plan 작업물 (현재까지)

| 산출물 | 위치 |
|---|---|
| 본 plan | `docs/r7-clean-canary-plan-2026-05-03.md` |
| 코드 변경 | **0건** |

git status:
```
 M .claude/scheduled_tasks.lock         (untouched, NOT staged)
 M scripts/cloud_dpo/launch_dpo.py      (untouched, NOT staged)
```

leftover stage 0건 — 사장 정책 100% 준수.
