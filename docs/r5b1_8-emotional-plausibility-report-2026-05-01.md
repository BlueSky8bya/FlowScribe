# R5B-1.8 — Emotional Plausibility + Cause-Action Progression Guard

**날짜**: 2026-05-01  
**Phase**: R5B-1.8 (R5B-1.7 cluster streak 폐기 → 납득성 기반 재정의)  
**브랜치**: checkpoint/phase1-launch-prep  
**출발점 commit**: ef695ca  
**검증 책**: 확률을 깨는 용사(확깨용)_TEST2D (`92b3cdcb-6f40-48e8-a47b-de7d50658ac5`)

---

## 1. 브랜치/상태

- 브랜치: `checkpoint/phase1-launch-prep`
- 출발 commit: `ef695ca` (캡처 헤더 2-line 디자인)
- working tree: 4 modified + 3 new (정의된 R5B-1.8 변경분만)
- build: `npm run build` ✅ PASS

## 2. 정책 변경 핵심 (R5B-1.7 → R5B-1.8)

**폐기**: cluster streak ≤ 3을 강제 PASS 기준으로 사용.
**도입**: "납득성 기반" 판정.

| 항목 | R5B-1.7 (이전) | R5B-1.8 (현재) |
|---|---|---|
| 같은 cluster 유지 | fake progression 의심 | 사건이 만들면 자연스러움 (PASS) |
| label 변경 | progression 신호 | 사건 근거 없으면 implausible shift (FAIL) |
| fake 정의 | cluster 안 단어만 변경 | cause/decision/consequence delta 모두 부재 |
| 측정 | label_streak, cluster_streak | 6-delta 카운트 + sameC+/sameC- + implausible_shift |
| cluster streak | 단독 FAIL 기준 | 보조 진단용 |

## 3. 구현 내용

### Planner (`src/pipeline/planner.ts`)

`character_emotional_beats` 스키마 6-delta 확장:
- `relationship_delta` 추가
- `decision_delta` 추가
- `consequence_delta` 추가
- `plausibility_note` 추가 (같은 감정 유지 시 "왜 자연스러운가" 1줄)

system prompt 재작성 (`[★ R5B-1.8 character_emotional_beats — 감정 납득성·원인-행동 진전]`):
- "같은 감정군이 여러 화에 걸쳐 유지되는 것은 자연스럽다" 명시
- "큰 사건 없이 감정군이 휙휙 바뀌는 것이 부자연스럽다" 명시
- 6-delta 중 최소 2개가 채워져야 의미 있는 진전 (cluster 강제 아님)
- fake 재정의: "라벨을 바꿨는데 6-delta 그 어느 것도 본문에서 진전하지 않은 경우"

추출기:
- `CharacterEmotionalBeat` interface에 6 필드 모두 추가
- `_isMeaningfulDelta(s)` export — "유지/없음/동일" 등 무의미 토큰 필터
- `countMeaningfulBeatDeltas(beat)` export — 의미 있는 delta 개수 계산

### Renderer (`src/pipeline/renderer.ts`)

`[★ R5B-1.8 감정 납득성 — 사건이 만드는 감정 흐름]` 섹션 재작성:
- 같은 감정 유지는 자연스러움. 단, 행동·말투·선택·거리감·질문 방식 중 하나는 달라져야 함
- 감정군 바뀔 때는 본문에 변화 사건이 반드시 드러나야 함
- 6-delta가 본문 행동·대사·결정·관계로 실제 구현되어야 함 — 단어 해설 금지

### Pipeline gating (`src/pipeline/index.ts`)

기존 `carry_forward_without_delta` 검사를 6-delta 기반으로 확장 + 신규 `label_change_without_cause` 검사 추가:

```ts
const _meaningfulDeltaCount = countMeaningfulBeatDeltas(_beat);
const _hasCauseSignal = _isMeaningfulDelta(_beat?.emotion_cause)
                     || _isMeaningfulDelta(_beat?.decision_delta)
                     || _isMeaningfulDelta(_beat?.consequence_delta);

// 1) appeared + emo/goal 둘 다 동일 + 6-delta 모두 없음 → fake (carry-forward)
if (_isAppearedInBeats && _emoSame && _goalSame && _meaningfulDeltaCount === 0)
  logWarn("pipeline:emotional_progression", "carry_forward_without_delta — fake progression risk", {...});

// 2) appeared + 라벨 변함 + cause/decision/consequence 모두 없음 → implausible shift
if (_isAppearedInBeats && !_emoSame && !!rawEmotional && !!prev?.emotional_state && !_hasCauseSignal)
  logWarn("pipeline:emotional_progression", "label_change_without_cause — implausible shift risk", {...});
```

### Audit (`scripts/audit_emotional_plausibility.mjs` — 신규)

**Data sources**:
- `character_dynamic_states` — emotional_state, recent_goal, location
- `run_traces.planner_trace.parsed_plan.character_emotional_beats` — 6-delta 진단

**Verdicts** (appeared 인물 transition만):
- `SAME_CLUSTER_PASS`: 같은 cluster + ≥1 의미 있는 delta
- `SAME_CLUSTER_NO_DELTA`: 같은 cluster + 0 delta → WARN (fake risk 카운트)
- `SHIFT_WITH_CAUSE`: cluster 변경 + cause/decision/consequence delta 있음
- `IMPLAUSIBLE_SHIFT`: cluster 변경 + cause 신호 모두 없음 → FAIL

**PASS 기준 5개**:
1. `same_cluster_without_delta ≤ 10%`
2. `fake_progression_risk ≤ 10%`
3. `genuine_progression(≥2 deltas) ≥ 65%`
4. `implausible_emotion_shift = 0`
5. 주요 인물 3화 내 behavior_delta or goal_delta ≥ 1회

### State extractor

DB migration **없음**. 6-delta는 모두 `run_traces.planner_trace.parsed_plan.character_emotional_beats` JSONB 컬럼에 저장 (기존 schema 활용).

## 4. TEST2D 15화 smoke

- **book_id**: `92b3cdcb-6f40-48e8-a47b-de7d50658ac5`
- **route**: `high_quality_ensemble` (gpt-4.1-mini planner + deepseek-chat renderer + gemini repair)
- **stream_mode**: `hybrid`
- **episodes**: ep1 (TEST 원본 baseline 복사) + ep2~15 신규 생성 (14화)
- **세계관**: 확률을 깨는 용사(확깨용)_TEST → user-authored only 클린 클론
- **generation time**: ep2~15 합계 ~14분 (평균 57s/ep, 범위 42~65s)
- **estimated cost**: ~$0.70 (planner gpt-4.1-mini × 14 + renderer deepseek-chat × 14 + repair gemini)
- **결과**: 14/14 PASS, 모든 화 score=80, fallback=0, foreign=0, special=0, parse_failures=0

## 5. 감정 흐름 결과 (audit_emotional_plausibility)

```
appeared transitions: 52
same_cluster_with_valid_delta: 42 (80.8%)
same_cluster_without_delta:    0  (0.0%)  ✓
different_cluster_with_cause:  10
implausible_emotion_shift:     0          ✓
fake_progression_risk:         0  (0.0%)  ✓
genuine_progression(≥2 deltas):52 (100.0%) ✓
```

| 인물 | eps | str_lbl | str_clu | dCause | dGoal | dBehav | dRel | dDec | dCons | sameC+ | sameC- | implaus | fakeRisk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 리아 | 14 | 6 | 6 | 14 | 14 | 14 | 14 | 14 | 14 | 9 | 0 | 0 | 0 |
| 브론 | 14 | 6 | 6 | 14 | 13 | 14 | 13 | 14 | 14 | 9 | 0 | 0 | 0 |
| 빅토리 | 14 | 13 | 13 | 14 | 13 | 14 | 14 | 14 | 14 | 12 | 0 | 0 | 0 |
| 카이렌 | 14 | 12 | 12 | 14 | 13 | 14 | 13 | 14 | 14 | 12 | 0 | 0 | 0 |

**3-ep behavior/goal-delta cadence**: 4명 모두 100% ✓

**보조** (단독 FAIL 기준 아님):
- max label streak: 13 (빅토리 "결의"·카이렌 "긴장")
- max cluster streak: 13

→ R5B-1.8 정책상 PASS. 빅토리·카이렌이 13화 동안 같은 cluster를 유지했지만, 매 화 dCause/dGoal/dBehav/dRel/dDec/dCons 모두 채워져 있어 "사건이 만든 흐름"으로 판정.

## 6. 서사 전진 결과

### 보조 audit (`audit_emotional_progression_forensics`, R5B-1.7)
- total fake_progression risk: 0 (0.0%) — R5B-1.7 보고 19.6% → 0.0%
- max appeared streak: 13 ⚠ (R5B-1.8 정책상 OK — 6-delta가 채워지면 자연스러움)
- max cluster streak: 13 ⚠ (R5B-1.8 정책상 보조 지표)
- genuine_progression: 19.2% (이 audit은 label+goal 둘 다 변경 시만 카운트하는 strict 정의이므로 R5B-1.8 100%와 다름)

### Duplicate discovery (`audit_duplicate_discovery_events`)
- cross-ep similar discovery phrases (sim ≥0.6, gap ≤5): 0 ✓ (R5B-1.5에서 도입한 dedup이 유지됨)
- exact 단문 반복(예: "리아가 지팡이를 들어 올렸다"): 30건 — 인물 행동 묘사용 짧은 형식 표현, motif 재이식이 아님

### 서사 stagnation (`audit_narrative_progression_stagnation`)
- avg progression score: 0.80 ⚠
- 주된 flag: location frozen ("숲 속 작은 공터" 고정), motif "빅토리" replanted (인물명 false positive)
- 위치 고정은 본 smoke가 같은 장면에 머무는 plot이라 발생 — 진단 정보로 받음

### World rule / state / route
- `verify_world_rule_integrity`: 21/21 ✓
- `verify_route_integrity`: 25/25 (PASS 25 | FAIL 0 | SKIP 2)
- `verify_state_taxonomy`: 36/36 ✓
- `verify_emotion_label_normalization`: 21/21 ✓
- `verify_hybrid_streaming_contract`: 32/32 ✓

## 7. verify 결과

### 신규 (R5B-1.8)
- `verify_genuine_progression_guard.mjs`: **29/29 ✓**
- `verify_state_progression_required.mjs`: **25/25 ✓**

### R5B-1.7 verify (R5B-1.8로 정렬)
- `verify_r5b1_7_emotional_contract.mjs`: 25/25 ✓ (strict cluster 차별화 체크는 폐기되어 R5B-1.8 superset로 갱신)

### 기존 핵심 verify (회귀 없음)
- `verify_world_rule_integrity`: 21/21
- `verify_route_integrity`: 25/25 (FAIL 0)
- `verify_state_taxonomy`: 36/36
- `verify_emotion_label_normalization`: 21/21
- `verify_hybrid_streaming_contract`: 32/32

### Build
- `npm run build`: ✅ tsc 통과

## 8. 다음 판단

빅토리·카이렌이 13화 동안 같은 cluster(결의·긴장)를 유지했으나, 6-delta가 매 화 채워져 fake risk 0/implausible 0/genuine 100%가 나왔다. 이는 R5B-1.8이 의도한 "납득 가능한 감정 흐름"의 정량 신호가 정상적으로 잡힌다는 뜻이지만, 실제 본문이 그만큼 입체적이었는지는 reader 차원의 정성 평가가 필요하다(독자 검토는 사장님 몫).

자동 판정만 보면:
- **50화 canary 가능 여부**: YES (조건 충족, 다만 cluster streak 13이 reader에게 단조로워 보일 가능성은 reader 검토로 판단)
- **PR merge readiness**: CONDITIONAL (reader 정성 평가 통과 시 머지)
- **R5B-2 (DB migration·Confirmed Facts Ledger·must_advance_from) 필요**: NO/CONDITIONAL — 현재 자동 지표는 R5B-2 없이도 깨끗. reader가 "13화 동일 cluster"를 단조롭게 느끼면 그때 R5B-2 검토.

```
R5B-1.8 verdict: READY
50화 canary 진행 가능 여부: CONDITIONAL (자동 PASS, reader 정성 평가 후 결정)
PR merge readiness: CONDITIONAL (reader 정성 평가 후 결정)
R5B-2 필요 여부: CONDITIONAL (자동 지표는 NO, reader에서 단조로움 감지 시 YES)
근거: TEST2D 15화 smoke에서 R5B-1.8 PASS 5/5, fake_progression_risk=0%, genuine_progression=100%, implausible_emotion_shift=0. cluster streak 13은 R5B-1.8 정책상 보조 지표라 단독 FAIL 아님. 다만 reader-facing 단조로움 여부는 본문 정성 평가로만 판단 가능 — 사장님 검토 권장.
```
