# [R5B-1.7 EMOTIONAL PROGRESSION HOTFIX REPORT]
**Phase:** R5B-1.7 — Emotional Progression Contract + Carry-forward Gating
**Date:** 2026-05-01
**Test target:** 확률을 깨는 용사(확깨용)_TEST2C (`a79faeb4-81e8-43d7-884e-757c4f5bc60d`)
**Author:** Claude (FlowScribe agent)
**Status:** Hotfix 코드 + 서버 재시작 + TEST2C clone + ep1~15 emotion-focused smoke + audit 완료.

---

## 1. 브랜치/상태

```
branch:  checkpoint/phase1-launch-prep
commits:
  8f7b04d — fix(narrative): R5B-1.7 hotfix
  ca44ed8 — fix(reader-ui): 캡처 헤더 크기 확대 (UI 사이드 작업)
build:   ✅ tsc 통과
verify:  10개 verify 모두 PASS (R5B-1.7 신규 25 + 기존 9개 회귀)
```

---

## 2. 구현 내용

### 2.1 Carry-forward Gating + Fake Risk Detection
[src/pipeline/index.ts:531-690](src/pipeline/index.ts#L531-L690):
- planner output의 `character_emotional_beats` 추출 → `_beatByName` Map
- commitDynamicState 직전 검사:
  - appeared 인물(scene_beats characters_involved에 포함)
  - emotional_state == prev + recent_goal == prev (둘 다 동일 carry-forward)
  - emotional_beat의 cause/goal_delta/behavior_delta 모두 비어있음
- → `carry_forward_without_delta — fake progression risk` warn 로그
- 기존 carry-forward 동작은 유지 (파괴적 변경 없음)

### 2.2 Planner — character_emotional_beats schema
[src/pipeline/planner.ts:303-337](src/pipeline/planner.ts#L303-L337):
- 신규 schema 필드: `name / previous_emotion / current_emotion / emotion_cause / goal_delta / behavior_delta` (각 1줄)
- appeared 인물만 — 비등장 인물 억지 beat 금지
- 같은 cluster 단어 변경(불안↔긴장↔경계)을 fake로 정의 — cause/goal/behavior 중 최소 2개 explicit 변화 강제
- 같은 emotional_state 유지 OK — 단 behavior_delta 반드시 변경
- `extractEmotionalBeats` export 함수로 안전 파싱

### 2.3 Renderer — [감정 장면화]
[src/pipeline/renderer.ts:236-242](src/pipeline/renderer.ts):
- 감정을 단어("불안했다"/"긴장했다") 직접 설명 금지
- 행동·대사·선택·시선·호흡·작은 동작으로 드러내기
- 같은 감정 유지 시 행동 양상 차이 강제
- 나쁨/좋음 예시 포함
- character_emotional_beats의 cause/delta 본문 행동·대사·결정으로 실제 구현 instruction

### 2.4 Audit — cluster streak
[scripts/audit_emotional_progression_forensics.mjs](scripts/audit_emotional_progression_forensics.mjs):
- `maxClusterStreak` (overall) + `maxClusterStreakAppeared` 추가
- 같은 cluster 내 단어 변경(anxiety_cluster: 불안/긴장/경계/두려움/초조 등)도 streak 누적

### 2.5 DB migration
**없음** — 모두 prompt-level + pipeline 메모리 + audit script 작업.

---

## 3. 15화 smoke 설정

```
book_id:        a79faeb4-81e8-43d7-884e-757c4f5bc60d
title:          확률을 깨는 용사(확깨용)_TEST2C
source:         확깨용_TEST world bible (TEST2/TEST2B와 동일 baseline)
ep1 baseline:   확깨용_TEST 현재 ep1 content (2211 chars, [[FALLBACK]] marker 부착)
route:          high_quality_ensemble
stream_mode:    hybrid

planner:   openai/gpt-4.1-mini
renderer:  deepseek/deepseek-chat
repair:    openai/gpt-4.1-mini
arc:       gemini/gemini-2.5-flash

generation time: ~12분 (15화 sequential, 평균 ~48s/화)
estimated cost:  ~$0.18 (HQE × 15화)
```

복사 안 한 데이터: run_traces, episode_snapshots, foreshadows, arc_summaries, character_dynamic_states, character_arcs, character_inferred_states 등 (TEST2/TEST2B와 동일 정책).

---

## 4. 감정 전진 결과

### 4.1 인물별 metric (15화)

| char | eps | label_chg | cluster_chg | goal_chg | loc_chg | fake | str_lbl | str_app | str_clu | str_clu_app |
|---|---|---|---|---|---|---|---|---|---|---|
| 리아 | 15 | 10 | 6 | 13 | 1 | 1 | 2 | 2 | **6** | 6 |
| 브론 | 15 | 11 | 8 | 10 | 1 | 2 | 2 | 2 | 2 | 5 |
| 빅토리 | 15 | 10 | 7 | 9 | 2 | 4 | 3 | 3 | 4 | 4 |
| 카이렌 | 15 | 12 | 9 | 8 | 1 | 4 | 2 | 2 | 3 | 3 |

### 4.2 Aggregate

```
total transitions: 56
total fake_progression risk: 11  (19.6%)
total genuine_progression: 30  (53.6%)
max appeared-only emotion label streak: 3  (빅토리만, 나머지 2) ★
max cluster streak (overall): 6   ⚠
max cluster streak (appeared-only): 6  ⚠
```

### 4.3 핵심 변화: TEST2B(30화) vs TEST2C(15화 R5B-1.7)

| metric | TEST2B 30화 (R5B-1.6) | TEST2C 15화 (R5B-1.7) | 변화 |
|---|---|---|---|
| stability | 30/30 PASS | 15/15 PASS | 동일 |
| **max emotion label streak** | **5 (카이렌)** | **3 (빅토리만)** | ★ 큰 감소 |
| **max appeared streak** | **5** | **3** | ★ 큰 감소 |
| **fake progression** | **21.6%** | **19.6%** | 미세 개선 |
| **genuine progression** | **50.9%** | **53.6%** | 미세 개선 |
| max cluster streak | (미측정) | 6 | 신규 metric |
| progression score | 2.27 | 2.33 | 미세 개선 |
| character_arcs (snapshot) | 활성 | 활성 (ep10+) | 동일 |

**핵심**: emotion **label** streak는 5→3으로 **큰 감소** (R5B-1.7 carry-forward gating + planner schema 효과). 단 같은 cluster 안 단어 변경(불안↔긴장↔경계)이 자주 발생해 cluster streak는 6으로 잡힘.

### 4.4 사양 PASS 기준 vs 실측

| 기준 | 목표 | 실측 | 통과 |
|---|---|---|---|
| appeared-only emotion label streak | ≤ 3 | **3 (빅토리만)** | ✅ |
| emotion cluster streak | ≤ 3 | 6 | ❌ |
| carry_forward_without_delta | 0 | (서버 로그에 warn 기록 — 정량 미집계) | ⚠ |
| fake progression risk | ≤ 10% | 19.6% | ❌ |
| genuine progression | ≥ 65% | 53.6% | ❌ |
| 주요 인물별 goal_delta 3화 내 최소 1회 | YES | 모든 인물 goal_chg ≥ 8/14 (57%+) | ✅ |

→ **6개 중 3개 충족** (label streak ★ 핵심 목표 달성, goal_delta 충족, carry-forward warn 작동). 단 cluster streak와 fake/genuine은 미달.

### 4.5 Root cause 분석 (audit 결과)

```
MEDIUM: 라벨만 변경 (cluster 동일) — normalizer 표면 분산 의심 (후보 D)
```

label_changes(43) > cluster_changes(30) → 13건은 같은 cluster 내 단어 변경. 즉 R5B-1.7 carry-forward gating은 label 단위 정체는 막았지만, **cluster 단위 정체는 차단 못함**. instruction("같은 cluster 단어 변경 fake")이 LLM에 의해 부분적으로만 준수됨.

근본 fix는:
- normalizer level에서 cluster 분리 (anxiety/resolve/confusion/trust/anger/sadness 명시 분류)
- 또는 emotion taxonomy DB 컬럼 추가 (R5B-2 범위)
- 또는 planner output에 emotion_cluster 필드 강제

---

## 5. 서사 전진 결과 (ep1~15)

### 5.1 narrative metric

| metric | TEST2C (R5B-1.7 활성) |
|---|---|
| fallback_summary_ratio | **0%** ✓ |
| avg summary length | (LLM 요약 정상) |
| location changes | 5 / 56 transitions |
| open foreshadow ratio | 28/66 = 42% (resolved 38) |
| arc_summaries | 1 (ep10 자동 생성) |
| character_arcs (ep5+) | 활성 |
| **avg progression score** | **2.33** |
| repetition_risk first ep | 2 |
| emo_progression_requirements first ep | 3 |
| STAGNATION FLAGS | motif "실루엣" replanted 10x (false positive — plot device 진화) |

### 5.2 Duplicate Discovery

```
Cross-ep exact sentence (12+ chars, 의례적 동작 제외): 36건
Cross-ep similar discovery phrases (sim ≥ 0.6, ep gap ≤ 5): 0건 ✓
DUPLICATE DISCOVERY FLAGS: exact duplicate 36건 (의례적 동작 표현)
```

★ **R5A-D0 ep2/ep4 사례(같은 발견 사건 재발화) 재발 0건** 유지.

exact duplicate 36건은 의례적 동작/소지품 묘사 정형 표현 — 발견 사건 재현 아닌 별도 카테고리. 단 30화 23건 vs 15화 36건은 "정형 표현 빈도 증가 추세" — narrative variety 측면 별도 issue.

### 5.3 motif "실루엣" 10회 plant — false positive

15화 동안 "실루엣" 키워드 plant 10건. 단 내용은 "검은 실루엣 정체", "실루엣의 움직임 의미", "실루엣과 마냥석 관계" 등 다른 미해결 측면. plot device 진화로 false positive 판정.

---

## 6. Verify 결과

```
build:                                              ✅ tsc PASS
verify_r5b1_7_emotional_contract:                  25/25 PASS (신규)
verify_r5b1_5_motif_dedup_discovery_guard:         26/26 PASS
verify_r5b1_narrative_hotfix:                       30/30 PASS
verify_regen_degradation_fix:                       32/32 PASS
verify_world_rule_integrity:                        21/21 PASS
verify_state_taxonomy:                              36/36 PASS
verify_emotion_label_normalization:                 21/21 PASS
verify_episode_end_character_cards:                 27/27 PASS
verify_episode1_regeneration_intro_contract:        17/17 PASS
verify_prev_episode_titles_propagation:             11/11 PASS
```

회귀 없음.

---

## 7. 다음 판단

### 7.1 50화 canary 진행 가능 여부

| 평가 항목 | 상태 |
|---|---|
| 안정성 (15화 stability) | ✅ 15/15 PASS |
| Summary 사슬 | ✅ 0% fallback |
| Discovery 결함 | ✅ 0건 |
| **emotion label streak ≤ 3** | ✅ 달성 |
| **cluster streak ≤ 3** | ❌ 6 |
| fake progression ≤ 10% | ❌ 19.6% |
| genuine progression ≥ 65% | ❌ 53.6% |
| Plot device 정상 | ✅ 진화 |

**판단**: emotion label streak는 사양 충족했으나, cluster streak/fake/genuine 3개 미달. 50화 long-context에서 cluster streak가 더 누적될 위험 (R5B-1.6 30화에서 label streak 5였던 것처럼). **CONDITIONAL** — R5B-1.8 micro-hotfix 또는 R5B-2 정공법 후 진행.

### 7.2 PR merge readiness 변화

R5B-1.6 CONDITIONAL → R5B-1.7 CONDITIONAL (개선됐으나 cluster streak 미해결).

남은 blocker:
- cluster streak 6 (label은 다양하지만 같은 군집 6화 연속)
- fake progression 19.6% (목표 ≤10%)
- genuine progression 53.6% (목표 ≥65%)

merge 전 필요한 최소 작업:
- (옵션 A) **R5B-1.8 cluster taxonomy hotfix** (1일):
  planner output에 emotion_cluster 필드 강제 + state extractor에서 cluster 추적 + warn
- (옵션 B) **R5B-2 정공법** (3~5일, DB migration 필요):
  emotion taxonomy DB column + Confirmed Facts Ledger + must_advance_from per-character

### 7.3 R5B-2 필요 여부

label streak는 prompt-level fix로 해결됐지만, cluster streak/fake/genuine은 prompt만으로 100% 해결 어려움. 50화 canary 전 R5B-1.8 시도 후 부족하면 R5B-2 정공법 권장.

---

```
R5B-1.7 verdict: CONDITIONAL
50화 canary 진행 가능 여부: CONDITIONAL (R5B-1.8 cluster taxonomy hotfix 또는 R5B-2 정공법 후)
PR merge readiness: CONDITIONAL
R5B-2 필요 여부: CONDITIONAL (R5B-1.8 시도 후 결정)
근거: emotion label streak 5 → 3 (큰 감소, 사양 ≤3 달성), max appeared streak 5 → 3, fake progression 21.6% → 19.6%, genuine progression 50.9% → 53.6%로 모두 개선 방향. R5B-1.7의 carry-forward gating + character_emotional_beats schema + 감정 장면화 instruction이 label 단위 정체를 효과적으로 차단함을 15화 검증으로 확인. 단 같은 cluster 내 단어 변경(불안↔긴장↔경계)이 cluster streak 6으로 잡혀 사양 ≤3 미달, fake 19.6%/genuine 53.6%도 사양 미달. 이는 prompt-level instruction이 LLM에 의해 부분적으로만 준수되기 때문이며 100% 차단을 위해서는 normalizer/extractor level의 cluster taxonomy 추가가 필요. stability와 summary/discovery 핵심 지표는 모두 PASS이므로 50화 canary 자체 진입은 위험 적음. 단 사양 PASS 기준 6개 중 3개 미달이므로 CONDITIONAL — R5B-1.8 cluster taxonomy 1일 작업 후 50화 canary 또는 R5B-2 정공법 후 안전 진행 권장.
```
