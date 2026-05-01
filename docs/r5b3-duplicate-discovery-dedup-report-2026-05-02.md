# R5B-3 — Duplicate Discovery Dedup Reinforcement

**날짜**: 2026-05-02
**Phase**: R5B-3 (R5B-1.8E에서 보고된 duplicate discovery 5건 강화)
**브랜치**: `checkpoint/phase1-launch-prep`
**검증 책**: 확률을 깨는 용사(확깨용)_TEST2E (`eb6b7e27-db4f-4506-aef9-3d05de95d4ec`)

---

## 1. 브랜치 / 상태

- 출발 commit: `3139177` (R5B-1.8E partial re-canary 보고서)
- working tree: 본 phase 변경 외 깨끗 (.claude/scheduled_tasks.lock, scripts/cloud_dpo/launch_dpo.py 무관 leftover)
- build: ✅ tsc 통과 (R5B-3 변경 후 재빌드 + server restart 후 ep76~90 generation)
- DB migration 없음, main push 없음

## 2. Duplicate 5건 분석 (R5B-1.8E 보고)

| case | episodes | duplicate_type | true / false_positive | source | severity | 권고 fix |
|---|---|---|---|---|---|---|
| 1 | 36↔38 | dialogue cliché ("시간이 얼마나 남았어?") | **false_positive** | renderer dialogue cliché (시간 압박 일반 표현) | noise | audit 정확도 개선 |
| 2 | **54↔55** | **closing scene 거의 word-for-word identical** | **true (severe)** | renderer가 ep54 ending 패턴 그대로 ep55에서 반복 | **major** | runtime / prompt 보강 |
| 3 | 54↔56 | 같은 closing 시퀀스 (ep54-56 group) | true (group) | 같은 source | major | 같은 fix |
| 4 | 55↔56 | sim=1.00 같은 closing | true (group) | 같은 source | major | 같은 fix |
| 5 | 57↔60 | dialogue cliché ("그러면/그럼 다른 방법을 찾아야지") | **false_positive** | renderer dialogue cliché (다짐 일반 표현) | noise | audit 정확도 개선 |

**결론**: 5건 중 진짜 severe duplicate는 **1 group (ep54-56 closing scene repetition)**, 나머지 2건은 dialogue cliché false positive. 진짜 문제는 **discovery 사건 중복이 아니라 renderer-level closing scene/narrative cliché 반복**.

## 3. 구현 내용

### 3.1 신규 module — `src/lib/discovery_signature.ts`

deterministic 발견 사건 시그니처 + closing scene 추출 + jaccard similarity:

| API | 동작 |
|---|---|
| `extractDiscoveryEvents(body, ep)` | narrative 안 (quote 밖) 발견 동사(발견했/찾아냈/감지/확인/알아챘/눈치챘/마주쳤) 매치 → sentence boundary 안 phrase + 한글 토큰 |
| `extractClosingScene(body, ep, tailChars=300)` | 본문 마지막 N자 + 토큰 |
| `jaccardSim(a, b)` | set intersection / union |
| `isDiscoveryDuplicate(new, priors, {threshold=0.6, window=5})` | 인접 ep 안 매칭 |
| `isClosingSceneSimilar(cur, prev, {threshold=0.45})` | 직전 ep tail token sim |

특정 단어/장르 하드코딩 없음. quote 안 dialogue ("찾아야 해", "남았어")는 자동 제외.

### 3.2 audit script 보강 — `scripts/audit_duplicate_discovery_events.mjs`

기존 [1][2][3] legacy 유지 + 신규 [4][5] section:
- **[4] R5B-3 narrative-only discovery events** — 새 lib 기반, false positive 분리
- **[5] R5B-3 closing scene repetition** — 인접 ep tail 유사도

PASS criteria 출력:
- R5B-3 true narrative duplicates ≤ 1
- R5B-3 closing scene 반복 = 0 (인접 ep)

### 3.3 planner system prompt — `src/pipeline/planner.ts`

`[★ R5B-3 발견·결말 반복 방지]` section 추가 (3 lines):
- 이미 발견된 단서 → 해석/추적/대응/결과/결정으로 전진
- closing scene 패턴 (결의 dialogue·합심·"새로운 여정") 반복 회피, 다음 갈등 씨앗으로 구성
- cliché dialogue ("함께 찾자"·"우리 차례야"·"새로운 세계를 향해") 시리즈 1회로 한정

### 3.4 신규 verify — `scripts/verify_duplicate_discovery_dedup.mjs`

18/18 PASS — 라이브러리 단위 + audit 통합 + planner prompt + dist 산출물 검증.

특히 ep54↔55 fixture로 closing scene similar = true (sim=0.813) 확인, 다른 closing은 false (sim=0.077).

### 3.5 foreshadow / open thread

본 phase에서는 추가 변경 없음. 5건 분석 결과 foreshadow re-injection 패턴 미발견 (closing scene + dialogue cliché 영역). 사용자 spec의 "foreshadow open thread dedup"은 현재 issue가 아니므로 별 phase 후보로 보류.

### 3.6 DB migration 여부

**없음**. runtime dedup + prompt + audit guard만으로 처리.

## 4. TEST2E ep1~75 read-only re-audit (baseline, pre-fix)

| 지표 | legacy [2] | R5B-3 [4] | R5B-3 [5] |
|---|---|---|---|
| similar discovery (sim ≥ 0.6, gap ≤ 5) | 5 (false positive 포함) | — | — |
| narrative-only duplicates | — | 4 | — |
| closing scene 반복 (인접 ep) | — | — | 7 |

R5B-3 audit baseline: 0/2 ⚠ CONDITIONAL (pre-fix data — 자연)

closing scene 반복 7건: ep25↔26, ep28↔29, ep40↔41, ep41↔42, **ep54↔55**, ep66↔67, ep71↔72 — R5B-1.8E에서 보고된 ep54↔55를 포함 + 추가 6건 발견 (R5B-3 audit이 더 정확하게 잡음).

## 5. ep76~90 continuation canary (post-fix generation-time 검증)

### 5.1 설정
- book_id: eb6b7e27-db4f-4506-aef9-3d05de95d4ec
- ep76~90 (15화) HQE + hybrid
- server: R5B-3 dist 재시작 (00:13 KST) — 새 prompt 활성
- 결과: **15/15 score=80 PASS**, fallback=0, special=0, parse=0
- foreign: 4 (ep83 streaming 단계 transient — DB 저장본 0건, sanitizer가 제거 → 실제 contamination 없음)
- generation 시간: ~14분 (평균 ~57초/ep)
- estimated cost: ~$0.75

### 5.2 R5B-3 audit (post-fix, ep1~90)

| 지표 | ep1-75 baseline | ep1-90 post-fix | ep76-90 자체 |
|---|---|---|---|
| narrative-only duplicates | 4 | **11** (+7) | post-fix 안에서 추가 발생 |
| closing scene 반복 (인접 ep) | 7 | **8** (+1: ep75↔76) | **0** (ep76-90 안에서 인접 0건) |

### 5.3 fix 효과 평가

**Closing scene fix: 효과 있음 ✓**
- ep76~90 자체 14 인접 페어 모두 sim < 0.45 (R5B-3 threshold 미충족)
- 추가 1건은 ep75 (pre-fix) ↔ ep76 (post-fix) transition — ep75 closing이 ep76 context로 들어가 영향
- post-fix 자체에서는 closing scene 반복 0건

**Narrative cliché fix: 효과 부족 ✗**
- ep80↔81 sim=1.00 — "빅토리가 핸드폰을 들어 마나 샘의 방향을 확인했다" word-for-word identical
- post-fix에서도 narrative 동작 cliché 반복 발생
- prompt-level injection만으로는 renderer-level 동작 묘사 반복을 충분히 막지 못함

## 6. Verify 결과

build: ✅ tsc 통과

| Verify | Result |
|---|---|
| verify_duplicate_discovery_dedup (신규 R5B-3) | 18/18 ✓ |
| verify_meaningful_appearance_guard | 17/17 ✓ |
| verify_episode_end_state_alignment | 17/17 ✓ |
| verify_episode_character_display_filter | 20/20 ✓ |
| verify_genuine_progression_guard | 29/29 ✓ |
| verify_state_progression_required | 25/25 ✓ |
| verify_state_taxonomy | 36/36 ✓ |
| verify_emotion_label_normalization | 21/21 ✓ |
| verify_hybrid_streaming_contract | 32/32 ✓ |
| verify_world_rule_integrity | 21/21 ✓ |
| verify_route_integrity | PASS 25 / FAIL 0 / SKIP 2 |
| verify_regen_degradation_fix | 32/32 ✓ |
| verify_episode_end_character_cards | 27/27 ✓ |
| verify_episode_end_character_cards_layout | 18/18 ✓ |
| verify_r5b1_7_emotional_contract | 25/25 ✓ |

regression 없음.

## 7. PR merge readiness 판단

### YES인 이유
- closing scene fix 효과 확인 (post-fix 인접 ep 반복 0건)
- ep76~90 generation 안정성 15/15 score 80, contamination 0 (sanitizer 동작 정상)
- 모든 verify regression 없음
- DB migration 없음, main push 없음

### CONDITIONAL인 이유
- narrative-only duplicates 4 → 11건 증가 (post-fix에서도 ep80↔81 sim=1.00 발생)
- prompt-level fix만으로는 narrative cliché 충분히 차단 못함
- 100화 actual 진행 시 narrative cliché 누적 위험

### **결정: PR merge readiness CONDITIONAL**

merge 전 권고 작업:
- (옵션 A) renderer system prompt에 직접 "이전 화 narrative 동작 cliché 반복 금지" 추가 + ep91~105 재 partial canary
- (옵션 B) post-generation runtime guard — 매 화 생성 후 narrative jaccard sim 검사, threshold 초과 시 logWarn (retry 안 함, 데이터 가시성)
- (옵션 C) 그대로 merge하고 narrative cliché는 별 phase에서 처리

권장: B (audit/log 가시성 확보) + 별 phase로 narrative cliché 정밀 fix.

## 8. 100화 actual 판단

### **CONDITIONAL → NO 가까움**

근거:
- closing scene fix는 효과 있음 → 100화에서도 인접 ep 반복 위험 낮음
- narrative cliché fix는 효과 부족 → 100화에서 narrative duplicate 누적 위험
- 추가 hotfix (renderer prompt 또는 runtime guard) 후 100화 진행이 안전

### 추가 hotfix 필요 여부: **YES**

권고:
- renderer prompt section 보강 — "이전 화에서 사용한 narrative 동작 ('핸드폰 데이터/시간 확인', 같은 동사+목적어) 그대로 재사용 금지" 짧게
- post-gen runtime guard (logWarn only) — 운영 가시성

```
R5B-3 verdict: CONDITIONAL
PR merge readiness: CONDITIONAL (closing scene PASS, narrative cliché 추가 hotfix 권고)
100화 actual 진행 가능 여부: NO (narrative cliché 추가 hotfix 후 진행)
추가 hotfix 필요 여부: YES (renderer prompt 보강 또는 post-gen runtime guard)
근거: 5건 분석 결과 진짜 severe는 1 group(ep54-56 closing scene), 나머지 2건은 dialogue cliché false positive. 신규 discovery_signature lib + audit [4][5] + planner prompt 보강으로 closing scene 반복은 post-fix(ep76~90) 자체 인접 ep 0건으로 효과 입증. 그러나 narrative-only duplicates는 ep1-75 baseline 4건 → ep1-90 post-fix 11건으로 증가했고 ep80↔81 sim=1.00 word-for-word identical 발생 — prompt-level fix만으로는 renderer 동작 묘사 cliché 반복을 충분히 막지 못함. ep76~90 generation 안정성(15/15 score 80, fallback/special/parse 0, foreign sanitized)과 closing scene fix 효과는 PR merge readiness 충분 조건이지만 narrative cliché 추가 hotfix 없이 100화 actual 진행은 누적 위험. closing scene 7건은 R5B-3 audit이 기존 5건보다 정확하게 잡은 결과 — false positive(dialogue cliché 2건) 분리 + 진짜 closing scene 반복(7건) 발견. 모든 verify regression 없음, DB migration 없음.
```

## 부록 A. 본문/판정 데이터 보존 정책

- canary raw output: `.tmp/forensic/episodes_76-90_*.json` (gitignored)
- audit raw: 본 보고서에 summary만, 본문 전문 미게재
- LLM 사용 안 함 (deterministic only)
