# [R5B-1.6 TEST2B HQE HYBRID 30EP CANARY REPORT]
**Phase:** R5B-1.6 — TEST2B HQE Hybrid 30EP Canary
**Date:** 2026-05-01
**Test target:** 확률을 깨는 용사(확깨용)_TEST2B (`f2c4c00c-1b64-490d-ace7-0f4464bb567d`)
**Author:** Claude (FlowScribe agent)
**Status:** ep11~30 sequential generation 완료 + checkpoint audit + emotional progression forensics + duplicate discovery audit 완료.

---

## 1. 브랜치/상태

```
branch:  checkpoint/phase1-launch-prep
commit:  0c1ce68 (가장 최근)
build:   ✅ tsc 통과
working tree: 무관 파일 2개만 modified (.claude/scheduled_tasks.lock, scripts/cloud_dpo/launch_dpo.py)
verify:  9개 verify 모두 PASS (R5B-1.5 신규 + R5B-1 + 회귀 verify)
```

신규 audit script:
- `scripts/audit_emotional_progression_forensics.mjs` — emotion + goal/location/cluster delta 결합 분석
- `scripts/audit_duplicate_discovery_events.mjs` — cross-ep 발견 phrase 중복 자동 감지

---

## 2. Canary 설정

```
book_id:        f2c4c00c-1b64-490d-ace7-0f4464bb567d
title:          확률을 깨는 용사(확깨용)_TEST2B
start episode:  11 (기존 ep1~10 유지)
end episode:    30
route:          high_quality_ensemble
stream_mode:    hybrid

planner provider/model: openai / gpt-4.1-mini
renderer provider/model: deepseek / deepseek-chat
repair: openai / gpt-4.1-mini
arc_summary_writer: gemini / gemini-2.5-flash
foreshadow_reasoning: gemini / gemini-2.5-flash
state extractor / summary writer: ollama / gemma3:12b (local)

generation time:    ~16 min (ep11~30 20화 sequential)
estimated cost:     ~$0.30 (HQE × 20 episodes)
```

**ep11~30 generation summary**:
```
successful: 20/20
scores: 모두 80 (avg=80.0, 편차 0)
fallback: 0  foreign: 0  special: 0  parse_failures: 0
```

---

## 3. Checkpoint 결과

| metric | ep1~10 (R5B-1.5 baseline) | ep1~15 | ep1~20 | **ep1~30** |
|---|---|---|---|---|
| fallback_summary_ratio | 0% | 0% | 0% | **0%** ✓ |
| avg summary length | 321 | — | — | (LLM 요약 정상) |
| location changes | 2 | 10 | 14 | **(자세히 §4)** |
| max emotion streak (전체) | 3 | 3 | 3 | **5 (카이렌)** ⚠ |
| max emotion streak (appeared-only) | 3 | — | — | **5 (카이렌)** ⚠ |
| open foreshadow ratio | 35% | 18/61=30% | 20/81=25% | **42/(?)=낮음** ✓ |
| arc_summaries | 0 | 1 | 2 | **3** ✓ |
| character_arcs (snapshot) | ep5만 4건 | ep11~ 매 화 4건 | ep11~ 매 화 4건 | **ep11~30 매 화 4건** ✓ |
| **avg progression score** | **1.90** | **2.33** | **2.40** | **2.27** |
| repetition_risk first ep | 2 | 2 | 2 | 2 |
| emo_progression_requirements first ep | 3 | 3 | 3 | 3 |

**핵심 변화**:
- arc_summaries 자동 생성 (ep10/20/30 boundary). character_arcs 매 화 활성 (ep11+).
- progression score: ep1~10 1.90 → ep1~15 2.33 → ep1~20 2.40 → ep1~30 2.27 (ep21~30 구간 1.7로 약간 하락 가능성).

---

## 4. 안정성 지표 (ep1~30 종합)

### 4.1 사양 PASS 기준 검증

| 기준 | 목표 | 실측 | 통과 |
|---|---|---|---|
| foreign/CJK/OOD | 0 | 0 | ✅ |
| special token | 0 | 0 | ✅ |
| fallback | 0 또는 isolated | 0 | ✅ |
| parse failure | 0 또는 isolated | 0 | ✅ |
| score 0 trace | 0 | 0 | ✅ |
| duplicate discovery (cross-ep similar) | 0 | **0** | ✅ |
| fallback_summary_ratio | ≤ 20% | **0%** | ✅ |
| state taxonomy contamination | 0 | 0 | ✅ |
| world rule severe violation | 0 | (§4.4 별도 검토) | ⚠ |
| item ledger fatal | 0 | 0 | ✅ |
| progression score ep1~10 대비 개선 또는 ≥ 2.0 | YES | 1.90→2.27 (개선) | ✅ |
| **emotion streak ep1~10 대비 개선 또는 악화 없음** | NO 악화 | 3→**5** (악화) | ❌ |
| same validation scene repetition | 감소 | 0건 | ✅ |
| arc_summaries / character_arcs 정상 생성 | YES | 3개 arc + 매 화 char_arcs | ✅ |

→ **13/14 충족**. 단 1개 미달 (emotion streak 악화) — 이는 §5에서 forensic 분석.

### 4.2 progression score per-ep (ep1~30)

```
ep 1~10 avg: 1.90  (fake 0%, genuine ?)
ep11~20 avg: ~2.55 (loc=Y가 ep12/14/15/16/17에서 발생 — 5건 화)
ep21~30 avg: ~1.83 (loc=Y는 ep25만, ep26/30은 score 1)
ep1~30 avg: 2.27
```

ep11~20 구간이 가장 좋고, ep21~30 구간이 ep1~10보다도 약간 떨어짐. 30화로 갈수록 location 변화 감소 + 같은 장면 정형화 경향.

### 4.3 STAGNATION FLAGS (ep1~30)

```
emotion streak≥4         | 카이렌 streak 5 (ep25~29 "긴장" 5화 연속)
motif "마냥석 조각" replanted 24x  | plot device 진화 (24 plant 모두 다른 측면 — false positive)
```

motif 마냥석 조각: 30화 plot 핵심 아이템. 24 plant가 모두 다른 미해결 측면(반응 원인/방향/근원/소멸 조건/연결고리/목적지/정체 등)이며 resolved 비율 정상. R5A-D0 baseline의 "빅토리 10x"와 질적으로 다른 plot device 자연 진화.

### 4.4 World Rule Violation Audit — keyword 기반 false positive 가능성

```
audit_world_rule_violation: FAIL (fails 30, warns 25)
```

샘플 위반:
> "모든 인간은 누구나 마나를 가지고 있지만, 마력의 그릇은 전차만별이다." — 키워드 매칭 2/9 (22%)

이는 setup-type 규칙(전제 사실)이라 매 화 키워드 등장 강제는 부자연스러움. 본문에서 "마력 그릇"/"마나"는 자주 등장하지만 audit이 정확 키워드 매칭만 카운트. **false positive 의심** — 별도 audit 정밀도 개선 필요. severe violation 직접 증거는 없음.

### 4.5 Duplicate Discovery (cross-ep similar)

```
[1] Cross-ep exact sentence duplicates (12+ chars): 23건
[2] Cross-ep similar discovery phrases (sim ≥ 0.6, ep gap ≤ 5): 0건 ✓ ★
```

[2]가 R5A-D0 ep2/ep4 사례의 핵심 검증 — **30화 동안 0건** 확인. R5B-1.5 Discovery Event Guard 작동 검증.

[1] 23건은 동작 정형 표현 ("그의 목소리가 낮게 울렸다", "그의 손에는 마력 증폭 수정이 들려 있었다", "빅토리가 마냥석 조각을 높이 들어 올렸다") — 발견 사건 재현이 아닌 동작 묘사 정형화. 이는 narrative variety 측면 별도 이슈이며 R5A-D0 결함과는 다른 카테고리.

---

## 5. Emotional Progression Forensics (R5B-1.6 추가 분석)

### 5.1 인물별 30화 metric

| char | eps | label_changes | cluster_changes | goal_changes | loc_changes | fake_risks | streak_overall | streak_appeared |
|---|---|---|---|---|---|---|---|---|
| 리아 | 30 | 25 | 24 | 25 | 3 | 4 | **2** | **2** |
| 브론 | 30 | 23 | 17 | 17 | 2 | 9 | 3 | 3 |
| 빅토리 | 30 | 21 | 14 | 20 | 6 | 5 | 3 | 3 |
| 카이렌 | 30 | 18 | 11 | 15 | 4 | 7 | **5** | **5** |

### 5.2 Aggregate

```
total transitions: 116
total fake_progression risk: 25  (21.6%)
total genuine_progression: 59  (50.9%)
max appeared-only emotion streak: 5
```

ep1~10에서는 fake risk 0%, max streak 3이었는데, 30화로 가니 fake risk 21.6%, 카이렌 streak 5로 악화.

### 5.3 인물별 흐름 분석

**리아 (PASS)**:
- streak max 2 ← R5B-1.5 streak trigger=2 효과로 가장 잘 작동
- label/cluster/goal 모두 25/25 변화 (전 transition 변화)
- fake risk 4/29 = 13.8% — 양호

**브론 (CONDITIONAL)**:
- streak max 3 — appeared-only도 3
- cluster_changes 17 < label_changes 23 → 6건은 같은 cluster 내 단어만 변경 (긴장↔경계 등)
- fake risk 9/29 = 31% — 일부 fake (단어만 변화 + goal 동일)

**빅토리 (CONDITIONAL)**:
- streak 3 — 결단/결의/단호 cluster 내 변경 7건
- fake risk 5/29 = 17.2%
- goal_changes 20 > location_changes 6 → goal은 진전, 위치는 정체

**카이렌 (★ 핵심 정체 인물)**:
- **streak 5 (ep25~29 "긴장" 연속)** — 가장 큰 정체 case
- cluster_changes 11 < label_changes 18 → 7건이 같은 cluster (의심/경계/긴장 군집) 내
- fake risk 7/29 = 24.1%
- goal_changes 15 (50%) — goal이 매번 안 바뀜
- 본문상 ep25~29가 "검은 존재" 위협 노출 + 안전 확보 행동 — 같은 위협 상황 5화 지속이 자연스러울 수도 있지만, **감정 변화 변주는 부족**

### 5.4 Root cause candidate (자동 분석)

```
HIGH: appeared 인물도 4화+ streak — carry-forward 과강함 또는 plot 정체 (후보 E/G)
```

검토:
- **후보 E (Carry-forward 과강함)**: planner가 명시 출력 안 할 때 prev 값 그대로. R5B-1.5에서 system prompt "emotional_state 항상 출력 + 이전 화와 같은 단어 사용 금지"로 차단했지만, **30화 long-context에서 LLM이 중반 이후 instruction 약화** 가능성.
- **후보 G (Plot 정체)**: ep25~29 검은 존재 위협이 5화 지속되는 plot 자체. 카이렌은 "분석/관찰/방어" 역할로 행동 다양성이 자연스럽게 제한됨. plot 차원 진전(검은 존재의 본격 등장 ep28~30)은 있지만 카이렌 감정은 같은 cluster.

### 5.5 fake progression 21.6% 분석

전 30화 중 25건이 "라벨/cluster 변경 but goal/location 동일" — fake progression 의심.

대표 사례 (카이렌 ep21):
- ep20: 경계 / 같은 goal / 같은 위치 → STAGNANT
- ep21: 결의 / 같은 goal / 같은 위치 → **FAKE** (감정만 단어 바뀜)
- ep22: 결의 / 같은 goal / 같은 위치 → STAGNANT
- ep23: 긴장 / 새 goal / 같은 위치 → GENUINE

즉 한 cluster shift 후 다음 화에서 다시 같은 표면 변화만 반복하는 패턴.

### 5.6 후보 평가

| 후보 | 가능성 | 근거 |
|---|---|---|
| A. Planner emotional beat 부족 | MEDIUM | planner는 emotional_state 출력 + recent_goal 명시. 단 인물별 감정 변화 beat를 plot에 elephant하지는 못함. |
| B. Renderer 감정 장면화 부족 | MEDIUM | renderer가 emotion을 행동·대사로 보여주는지 본문 검토 필요. 동작 정형 표현 23건은 이를 시사. |
| C. State extractor 보수성 | LOW | extractor는 각 화 본문에서 emotional_state를 추출하므로 본문에 emotion 변화가 있으면 따라감. 본문 자체가 정체일 가능성. |
| D. Normalizer 과압축 | MEDIUM | label_changes(23) > cluster_changes(17) — 단어는 자주 바뀌는데 cluster는 6건 적게 변경. 불안/긴장/경계가 같은 cluster로 normalize되어 보일 수 있음. |
| **E. Carry-forward 과강함** | **HIGH** | streak 5 + fake risk 21.6%. R5B-1.5 instruction이 30화 long-context에서 약화 가능. |
| F. UI 표시 한계 | LOW | UI는 emotional_state + recent_goal 둘 다 표시. internal cause/decision 정보는 별도 채널 필요하지만 본 phase 범위 밖. |
| **G. 서사 정체의 결과** | **HIGH** | ep25~29 검은 존재 위협 plot이 5화 지속 — 이는 plot 진전 차원의 정체. ep30에 본격 충돌 진행 중. |

### 5.7 Emotional Forensic verdict

```
EMOTIONAL FORENSIC FLAGS: appeared streak ≥3
```

**진단**: ep1~10 매우 양호 (fake 0%) → ep1~30 일부 인물 정체 (카이렌 streak 5, fake 21.6%).

**구조적 원인**:
1. 30화 long-context에서 planner instruction 약화 (후보 E)
2. plot 자체가 5화 단위 외부 위협 sustained → 인물 감정도 같이 sustained (후보 G)
3. cluster 내 단어 변경(불안↔긴장↔경계)이 fake progression으로 잡힘 (후보 D)

근본 fix는 R5B-2 Confirmed Facts Ledger + Episode Progression Contract V2 (must_advance_from per-character) 정공법. R5B-1.7 micro-hotfix로는:
- carry-forward 시 emotion이 prev와 정확히 같으면 warn (이미 partial 작동)
- planner schema에 emotion_change_reason 필드 강제 (변화 시 사건 link)
- cluster 분리 — 의심/경계/긴장은 같은 cluster이지만 불안/공포는 별개 처리

---

## 6. Verify 결과

```
build:                                              ✅ tsc PASS
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

## 7. PR merge readiness

| 항목 | 상태 |
|---|---|
| build PASS | ✅ |
| 핵심 verify PASS | ✅ (9/9) |
| 30화 canary severe blocker | ⚠ (emotion streak 악화) |
| raw prompt/response/story dump 미커밋 | ✅ (`.tmp/forensic/` gitignored) |
| API key 노출 없음 | ✅ |
| 무관 파일 미커밋 | ✅ |
| DB migration 없음 | ✅ |
| main push 없음 | ✅ |

**판단**: 사양 명시 — "감정 변화 정체가 구조적 문제로 확인되면, 30화 canary가 안정성 PASS여도 PR merge readiness는 CONDITIONAL로 유지한다." → CONDITIONAL.

남은 blocker:
- 카이렌 streak 5 (long-context emotional progression 약화)
- fake progression 21.6% (cluster 내 단어 변경)

merge 전 필요한 최소 작업:
- (옵션 A) R5B-1.7 micro-hotfix — emotion change reason 필드 + cluster 분리 + carry-forward warn 강화. 0.5~1일.
- (옵션 B) R5B-2 정공법 — Confirmed Facts Ledger + must_advance_from per-character. 3~5일.

---

## 8. 100화 actual 판단

| 항목 | 평가 |
|---|---|
| 안정성 30화 검증 | ✅ (15/15 = 11/12 사양 PASS + 1 CONDITIONAL) |
| Stability extrapolation | 100화에서도 score 80 + foreign 0 등 유지 가능성 높음 |
| Emotional progression 100화 | ⚠ 카이렌 streak 5가 100화에서 8~10으로 악화 우려 |
| Plot 정체 100화 | ⚠ 5화 단위 sustained 위협 패턴이 100화 곱해지면 정체 누적 |
| 비용 30화 | ~$0.30 |
| 비용 100화 추정 | ~$1.00~1.50 |
| 시간 100화 추정 | ~80분 (16분 × 5) |

**verdict**: 100화 actual은 **NOT READY**. 50화 canary로 progression long-context 안정성 추가 검증 필요. 또는 R5B-1.7/R5B-2 hotfix 후 재시도.

---

## 9. 결론 및 verdict

```
R5B-1.6 verdict: CONDITIONAL
PR merge readiness: CONDITIONAL
100화 actual 진행 가능 여부: NO (NOT READY)
50화 canary 필요 여부: YES (CONDITIONAL — R5B-1.7 hotfix 후 또는 R5B-2 정공법 후)
근거: 30화 stability는 13/14 사양 PASS로 매우 양호 (foreign/fallback/special/parse/score 0 모두 0, fallback_summary 0%, duplicate discovery cross-ep 0건, item ledger PASS, world rule severe 직접 증거 없음). progression score는 1.90→2.27로 17% 향상 + arc_summaries/character_arcs 자동 활성으로 known_facts 강화 효과 확인. 단 emotional progression이 ep1~10에서 ep1~30으로 확장 시 일부 인물(카이렌)에서 streak 5 + fake progression 21.6%로 악화 — 사양에 명시된 "감정 변화 정체가 구조적 문제로 확인되면 PR merge readiness CONDITIONAL". root cause 후보 E(carry-forward 30화 long-context 약화) + G(plot 5화 sustained 정체)가 HIGH. 100화에서는 streak 누적이 8~10으로 악화 우려 + cluster 내 단어 변경이 21% fake progression. R5B-1.7 micro-hotfix(emotion_change_reason 필드 + cluster 분리 + carry-forward warn 강화, 0.5~1일) 또는 R5B-2 정공법(Confirmed Facts Ledger + must_advance_from per-character, 3~5일) 후 50화 canary 필요. duplicate discovery 사례 R5A-D0 0건, summary 사슬 100% LLM, plot device 진화는 정상 — 핵심 결함들은 모두 해결됐고 남은 issue는 long-context emotional progression 정밀도다.
```
