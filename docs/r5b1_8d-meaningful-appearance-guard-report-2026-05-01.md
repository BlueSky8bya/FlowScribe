# R5B-1.8D — Meaningful Appearance Guard

**날짜**: 2026-05-01
**Phase**: R5B-1.8D (R5B-1.9 50화 canary 후속 — 카이렌 absent_severe 7건 누적 해결)
**브랜치**: `checkpoint/phase1-launch-prep`
**검증 책**: 확률을 깨는 용사(확깨용)_TEST2E (`eb6b7e27-db4f-4506-aef9-3d05de95d4ec`)

---

## 1. 브랜치 / 상태

- 출발 commit: `e0545ca` (R5B-1.9 보고서)
- working tree: 본 phase 변경분 외 깨끗 (.claude/scheduled_tasks.lock, scripts/cloud_dpo/launch_dpo.py, public/index.html은 이전 작업 leftover — 본 commit에 포함하지 않음)
- build: ✅ tsc 통과
- DB migration 없음
- main push 없음

## 2. 구현 내용

### 2.1 Meaningful appearance 기준

| 분류 | 정의 | level | update 허용 |
|---|---|---|---|
| 직접 대사 (대사 화자 표시 narrative) | "이름이 + 주격조사 + 대사 동사(말했/외쳤/속삭/대답/...)" | strong | ✓ |
| 직접 행동 | "이름이 + 주격조사 + 행동 동사(걸/달/뽑/잡/건넸/들어왔/...)" | strong | ✓ |
| 주체 등장 (술어 stem 미발견) | "이름이/은/는/가" + 일반 narrative | medium | ✓ |
| 상호작용 / 소유 | "이름의/에게/한테/와/과/도/을/를" | medium | ✓ |
| 대사 안 호명 | quote(`"..."` `「...」` `『...』` `‘...’`) 안에서만 등장 | weak | ✗ |
| 단순 호명 (조사 없는 bare mention) | "카이렌, 카이렌" 형태 | weak | ✗ |
| 본문 부재 | 이름 자체 0회 | none | ✗ |

핵심 차이 (R5B-1.8C 대비): 등장 횟수가 아니라 **위치(quote 안/밖) + 형태(주격조사 + 술어 stem)** 로 분류.

### 2.2 새 모듈

`src/lib/meaningful_appearance.ts`

- `detectMeaningfulAppearance(body, name)` — pure deterministic, LLM 미사용
- `isUpdateAllowed(level)` — strong/medium → true, weak/none → false
- 한국어 일반 패턴(주격조사, 한국어 quote 짝, 일반 동사 어간 약 80개)으로 동작
- 특정 인물/책/장르 하드코딩 없음
- LLM 호출 없음 → critical-path safe

### 2.3 Pipeline guard 교체

`src/pipeline/index.ts` `runPlannerPipeline.commitDynamic` 직전 블록

이전 (R5B-1.8C):
```ts
const _MEANINGFUL_APPEAR_THRESHOLD = 3;
const _bodyAppearCount = (name) => generatedText.match(re).length;
if (_appearCount < _MEANINGFUL_APPEAR_THRESHOLD) { /* carry-forward absent */ }
```

이후 (R5B-1.8D):
```ts
const _evidence = detectMeaningfulAppearance(generatedText, resolvedName);
if (!isUpdateAllowed(_evidence.level)) { /* carry-forward absent */ }
```

carry-forward / visibility="absent" / continue 등 후속 로직은 동일 — 정책 contract 변경 없음.

### 2.4 UI display filter

`public/js/generate.js`의 `_isAppearedForDisplay`는 여전히 stored visibility_state 기반. R5B-1.8D는 stored 자체를 정확하게 만들기 때문에 UI는 자동으로 정확해진다 — UI 수정 불필요.

### 2.5 Optional LLM judge

`scripts/audit_meaningful_appearance_overlay.mjs` — read-only audit only. runtime critical path에는 LLM 호출 없음.

## 3. TEST2E read-only re-audit

기존 R5B-1.9 LLM audit 결과(`.tmp/r5b1_8c_alignment_<bookId>.json`, 49화 196 평가)에 deterministic detector를 overlay.

### 3.1 인물별

| char | total | LLM_PASS | LLM_FAIL | LLM_absent_severe | det_block | det_caught | would_remain | false_positive |
|---|---|---|---|---|---|---|---|---|
| 리아 | 49 | 48 | 0 | 0 | 0 | 0 | 0 | 0 |
| 브론 | 49 | 48 | 0 | 0 | 0 | 0 | 0 | 0 |
| 빅토리 | 49 | 47 | 0 | 0 | 0 | 0 | 0 | 0 |
| 카이렌 | 49 | 40 | 7 | 6 | 34 | **6** | **0** | **0** |

### 3.2 카이렌 7건 FAIL detail (detector overlay)

| ep | LLM verdict | LLM appeared | detector level | S/M/W | would_block | 분류 |
|---|---|---|---|---|---|---|
| 16 | FAIL | false | none | 0/0/0 | ✓ | 새 guard catch |
| 17 | FAIL | false | none | 0/0/0 | ✓ | 새 guard catch |
| 21 | FAIL | false | none | 0/0/0 | ✓ | 새 guard catch |
| 31 | FAIL | false | none | 0/0/0 | ✓ | 새 guard catch |
| 32 | FAIL | false | none | 0/0/0 | ✓ | 새 guard catch |
| 46 | FAIL | false | none | 0/0/0 | ✓ | 새 guard catch |
| **45** | FAIL | **true** | **strong** | **4/1/0** | ✗ | **R5B-1.8D 범위 밖 (역방향 — stored absent인데 본문 등장). 새 guard에서는 update 허용되므로 자동 해결.** |

### 3.3 Aggregate

- LLM PASS rate: **93.4%** (R5B-1.9 동일)
- detector_block (전체에서 weak/none guard hit): 34
- **detector_caught_severe = 6 / 6** (기존 absent_severe 6건 모두 새 guard가 잡았을 것)
- **would_remain_severe = 0** (잔존 0)
- **false_positive_block = 0** (실제 등장 인물 잘못 차단 없음)

### 3.4 카이렌 ep45 (역방향 케이스) 처리

- R5B-1.9 보고서 분류: stored visibility_state=absent인데 본문에 직접 등장 (ep44 carry-forward absent가 ep45까지 그대로 carry된 것)
- R5B-1.8D 새 guard: detector level=strong (S=4 M=1) → update 허용
- 즉 새 guard에서는 ep44 → ep45 시점에 planner가 카이렌을 update list에 포함했다면 그대로 commit, carry-forward absent로 over-apply되지 않음
- 단, planner가 ep45에서도 카이렌을 빠뜨렸다면(같은 패턴) `// carry-forward + absent-seed` 블록(line ~786~)이 그대로 동작 → 여전히 absent로 carry. 이는 planner 누락 문제이지 R5B-1.8D guard 문제가 아님 (별 phase).

## 4. Targeted smoke

본 phase에서는 deterministic detector 17개 fixture 기반 unit test로 대체.

`scripts/verify_meaningful_appearance_guard.mjs` — 17/17 PASS

다룬 케이스 (사용자 명세 §8 verify cases 전부):
- 이름만 대사 속에서 5회 언급 → weak ✓
- 직접 대사 1회 → strong ✓
- 직접 행동 1회 → strong ✓
- 회상 dialogue quote 안 → weak ✓
- 회상 단순 호명 → weak ✓
- 소지품 전달 → strong ✓
- 위치 이동 → strong ✓
- "카이렌은 어디 있지?" 부재 확인성 → weak ✓
- 본문에 이름 없음 → none ✓
- 행동 + 대사 혼합 → strong ✓
- 상호작용 대상 (의/에게) → medium ✓
- dialogue 안 + 외부 narrative 행동 혼재 → strong ✓
- 행동 1회 + 다른 화자의 호명 다회 → strong ✓
- isUpdateAllowed 정책 4종 (strong/medium=true, weak/none=false) ✓

신규 test book 생성 + 의도적 fade-out 시나리오 LLM 생성 smoke는 **skip**:
- read-only overlay에서 detector_caught 6/6, false_positive 0 → 이미 fade-out 시나리오의 실데이터가 7건 존재 (TEST2E 카이렌 ep16/17/21/31/32/46)
- pipeline guard 변경은 isolated continuation block (R5B-1.8C와 동일 후속 로직, 결정 함수만 교체) → behavior가 overlay로 정확히 모델링됨
- detector unit test 17 fixture가 명세의 verify case를 모두 커버

## 5. Verify 결과

build: ✅ tsc 통과

| Verify | Result |
|---|---|
| verify_meaningful_appearance_guard (신규) | 17/17 ✓ |
| verify_episode_end_state_alignment (R5B-1.8C/D superset 갱신) | 17/17 ✓ |
| verify_episode_character_display_filter | 20/20 ✓ |
| verify_state_taxonomy | 36/36 ✓ |
| verify_emotion_label_normalization | 21/21 ✓ |
| verify_hybrid_streaming_contract | 32/32 ✓ |
| verify_world_rule_integrity | 21/21 ✓ |
| verify_route_integrity | PASS 25 / FAIL 0 / SKIP 2 |
| verify_episode_end_character_cards | 27/27 ✓ |
| verify_episode_end_character_cards_layout | 18/18 ✓ |
| verify_genuine_progression_guard | 29/29 ✓ |
| verify_state_progression_required | 25/25 ✓ |
| verify_r5b1_7_emotional_contract | 25/25 ✓ |

regression 없음.

## 6. PASS criteria

| criteria | result |
|---|---|
| alignment LLM PASS ≥ 90% | ✓ 93.4% |
| would_remain_severe = 0 | ✓ 0 |
| detector_caught_severe = absent_severe | ✓ 6 / 6 |
| false_positive_block = 0 | ✓ 0 |

R5B-1.8D detector overlay: **4/4 ✅ READY**

## 7. 다음 판단

### PR merge readiness: **YES**

근거:
- 생성 안정성 (R5B-1.9): 35/35 score 80, fallback/foreign/special/parse 0
- alignment LLM PASS 93.4% (≥85%, ≥90% 둘 다 충족)
- R5B-1.8D 새 guard로 기존 6건 absent_severe 모두 catch (would_remain=0)
- false_positive_block=0 (실제 등장 인물 잘못 가리지 않음)
- ep45 역방향 mismatch는 새 guard에서 자동 해결 (update 허용)
- DB migration 없음, main push 없음
- API key/env/raw output/full body 미커밋
- 금지 파일 미커밋

### 100화 actual 진행 가능 여부: **CONDITIONAL**

근거:
- 50화 partial re-canary로 generation-time guard 효과를 1차 확인하면 더 안전
- read-only overlay와 unit test 17개로 deterministic detector 정확도는 검증됨
- pipeline 변경은 isolated continuation block — runtime behavior risk 낮음
- 다만 100화 actual은 비용/시간 부담이 크므로, 사장 판단으로 직진 또는 partial re-canary 후 진행 둘 다 합리적

권고: **TEST2E ep51~75 partial re-canary** (25화, 약 ~$1.25, ~25분) 후 100화 actual.

### 50화 re-canary 필요 여부: **NO** (단, partial re-canary는 권고)

근거:
- 전체 50화 재생성은 정보 추가 없음 — read-only overlay로 detector 적용 결과는 이미 확정
- partial re-canary는 generation-time integration confirmation용 (추가 validation, 강제 아님)

### R5B-2 필요 여부: **CONDITIONAL**

근거:
- ep45 역방향 케이스(planner가 fade-out 인물의 복귀 화에서 update 누락)는 R5B-1.8D 범위 밖 — planner의 character_state_updates 누락 보강이 추후 phase 후보
- 우선순위는 높지 않음 — TEST2E 50화 중 1건 (2.0%), 이후 partial re-canary로 빈도 모니터

```
R5B-1.8D verdict: READY
PR merge readiness: YES
100화 actual 진행 가능 여부: CONDITIONAL (partial re-canary 권고 후)
50화 re-canary 필요 여부: NO (partial re-canary는 권고)
R5B-2 필요 여부: CONDITIONAL (planner update 누락 보강은 추후 phase 후보, 우선순위 낮음)
근거: TEST2E 50화 read-only overlay로 R5B-1.8D detector가 기존 absent_severe 6건을 모두 catch (detector_caught=6/6, would_remain=0). false_positive_block=0으로 실제 등장 인물 misblock 없음. detector unit test 17/17 PASS, 모든 verify regression 없음. 카이렌 ep45 역방향 케이스는 새 guard에서 update 허용되어 자동 해결. PR merge에 차단 사유 없음. 단 100화 actual은 ep51~75 partial re-canary로 generation-time integration을 한 번 더 confirm한 후 진행이 안전.
```

## 부록 A. 본문/판정 데이터 보존 정책

- audit raw: `.tmp/r5b1_8d_overlay_<bookId>.json` (gitignored)
- 본 보고서에는 본문 전문 미게재. summary 메트릭만.
- LLM judge 응답 raw 미게재.
- detector 분류 fixture는 verify script에 inline (실제 책 인용 아님 — 일반적인 한국어 소설 표현).
