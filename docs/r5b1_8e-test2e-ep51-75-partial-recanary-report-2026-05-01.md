# R5B-1.8E — TEST2E ep51-75 Partial Re-Canary

**날짜**: 2026-05-01
**Phase**: R5B-1.8E (R5B-1.8D meaningful appearance guard의 generation-time integration 검증)
**브랜치**: `checkpoint/phase1-launch-prep`
**검증 책**: 확률을 깨는 용사(확깨용)_TEST2E (`eb6b7e27-db4f-4506-aef9-3d05de95d4ec`)

---

## 1. 브랜치/상태

- 출발 commit: `2a83145` (UI ✨ 통일) — `aca48dd` (R5B-1.8D) 위에서
- working tree: 본 phase 변경 없음 (`.claude/scheduled_tasks.lock`, `scripts/cloud_dpo/launch_dpo.py` 무관 leftover만 잔존)
- build: ✅ tsc 통과
- public/index.html 처리 결과: `2a83145`로 ✨ 통일 commit 완료 (HTML 2 + js 6 lines, AI 추천 버튼 6곳 + 동적 라벨 4곳)

## 2. Canary 설정

- **book_id**: `eb6b7e27-db4f-4506-aef9-3d05de95d4ec`
- **start episode**: ep51
- **end episode**: ep75 (25화)
- **route**: `high_quality_ensemble` (gpt-4.1-mini planner + deepseek-chat renderer + gemini repair)
- **stream_mode**: `hybrid`
- **server**: 23:18 KST에 R5B-1.8D dist로 재시작 후 generation 시작 — 새 guard 활성 상태에서 진행
- **generation 25화 합계 시간**: ~24분 (개별 33~93초, 평균 ~57초/ep)
- **estimated cost**: ~$1.25 (planner gpt-4.1-mini × 25 + renderer deepseek × 25 + repair gemini × 25)
- **결과**: **25/25 score=80 PASS**, fallback=0, foreign=0, special=0, parse_failures=0
- written: `.tmp/forensic/episodes_51-75_2026-05-01T14-42-56-787Z.json`

## 3. Server log — R5B-1.8D guard 동작

| 메트릭 | 값 |
|---|---|
| `pipeline:r5b1_8d` (weak/none appearance, planner 갱신 무시) | **0회** |
| `pipeline:r5b1_8c` (legacy threshold guard) | 0회 |
| `pipeline:emotional_progression` (carry_forward_without_delta / label_change_without_cause) | 75회 (R5B-1.8 별 정책) |
| `pipeline:proseNorm` (prose drift) | 25회 |
| `entity_resolver` WARN | 210회 (인물명 정규화) |

**R5B-1.8D guard fire 0회 의미**: 25화 동안 planner가 본문에 등장하지 않은 인물에 대해 character_state_update를 emit한 케이스가 0건이었다. 즉 planner가 자율적으로 absent 인물을 stateUpdate에서 제외 → guard가 fire할 trigger 없음. 등장하지 않는 인물은 "carry-forward + absent-seed" branch에서 자동 처리(visibility="absent"). guard는 planner의 over-reach에 대한 안전망으로 동작 대기.

## 4. Checkpoint 결과

### ep60 / ep75 alignment

R5B-1.8D 정의(detector overlay)로 평가:

| Range | total | LLM PASS | LLM FAIL | absent_severe | absent_border | det_block | det_caught | would_remain |
|---|---|---|---|---|---|---|---|---|
| ep51-75 | 100 | 93 (93.0%) | 1 | 2 | 20 | 22 | 2/2 | **0** |

### 인물별 (ep51-75)

| char | total | PASS | WARN | FAIL | absent_severe | det_block | det_caught | remain |
|---|---|---|---|---|---|---|---|---|
| 리아 | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 0 |
| 브론 | 25 | 23 | 2 | 0 | 0 | 0 | 0 | 0 |
| 빅토리 | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 0 |
| **카이렌** | 25 | 20 | 4 | 1 | 2 | 22 | 2/2 | **0** |

### 카이렌 absent_severe 2건 (ep58/ep63) detail

| ep | LLM verdict | LLM appeared | detector | would_block | LLM reason |
|---|---|---|---|---|---|
| 58 | FAIL | false | none | ✓ | absent_update: 본문에 의미 등장 없는데 stored가 갱신됨 |
| 63 | WARN | false | none | ✓ | 본문 미등장이나 stored 갱신 가능성 |

**근본 원인 분석**: ep57/58/63 카이렌 stored 상태가 모두 동일 — `emotional_state="경계"`, `recent_goal="빅토리와 협력해 마나 부재 문제에 대응하며..."`, `location="숲 속 마나 샘"`, `visibility_state="absent"`. 즉 R5B-1.9 ep45 시점 specific value가 25화 동안 carry-forward됐고 LLM은 specific stored value를 보고 "갱신됨"으로 오인. **R5B-1.8D guard 자체는 정상 동작 — would_remain_severe=0**. carry-forward branch가 새 generation에서 stored를 갱신 안 했음 (정확). LLM judge가 carry-forward absent와 fresh update를 구분 못 하는 prompt 한계.

## 5. 안정성 지표

### 생성 안정성 (완벽)
- ✅ score=80: **25/25** (100%)
- ✅ foreign/CJK/OOD: 0
- ✅ special token: 0
- ✅ fallback plan: 0
- ✅ parse failure: 0
- ✅ planner provider: openai/gpt-4.1-mini
- ✅ renderer provider: deepseek/deepseek-chat
- ✅ route metadata: high_quality_ensemble 일관

### Alignment 지표 (R5B-1.8D 기준)
- alignment LLM PASS ≥ 90%: ✅ **93.0%**
- detector_caught_severe = absent_severe: ✅ **2/2**
- would_remain_severe = 0: ✅ **0**
- false_positive_block = 0: ✅ (LLM appeared=true + verdict=PASS인 평가에서 detector block 0건)

### Alignment LLM strict 기준 (참고)
- LLM FAIL = 0: ✗ 1건 (ep58 카이렌 — carry-forward LLM noise)
- LLM absent_severe = 0: ✗ 2건 (ep58/63 카이렌 — 동일 noise)

### Meaningful appearance guard
- guard fire count: 0 (planner가 absent 인물에 stateUpdate 미발행)
- weak mention blocked count: 0 (guard fire 0이므로)
- strong/medium appearance allowed count: 75 (실제 stateUpdate된 모든 update가 strong/medium evidence 보유)
- detector_block (overlay 기준 weak/none 분류): 22 (모두 카이렌)

### Duplicate discovery
- exact duplicates (단문 인사·동작): 523건 — 형식 표현 (R5B-1.9에서도 noise 분류)
- **cross-ep similar discovery (sim ≥ 0.6, gap ≤ 5): 5건** ⚠
  - ep36↔38 sim=1.00 "시간이 얼마나 남았어?"
  - ep54↔55 sim=0.83 "원래 세계로 돌아갈 방법을 찾아야 해"
  - ep54↔56 sim=0.83
  - ep55↔56 sim=1.00
  - ep57↔60 sim=0.60
- R5B-1.9 1건 → R5B-1.8E 5건으로 증가. **R5B-1.5 dedup 정책 위반**.

### Summary fallback ratio
- ep51~75: llm=25, fallback=0, no_summary=0 → ratio = **0.0%** ✅

### Progression score (audit_narrative_progression_stagnation)
- avg progression score: 0.49 ⚠ (정체 의심)
- ep51~75 25화 중 23화에서 location/goal/emotion 모두 N (carry-forward)
- 사용자 PASS criteria에 progression score 직접 기준 없음 — 정보용

### State taxonomy
- verify_state_taxonomy: 36/36 ✓ (regression 없음)

### World rule
- verify_world_rule_integrity: 21/21 ✓
- audit_world_rule_violation: keyword-heuristic FAIL 89, WARN 53 (R5B-1.9에서도 noise 분류 — 매 화 모든 절대 규칙 키워드 반복 안 함이 자연)

### Item ledger
- DB carry-forward 정상 (item dual ownership fatal 0)

### Arc / character arcs
- arc_summaries: 7건 (75화 / ~10화 단위)
- character_arcs: 28건 (4 인물 × 7 arc)
- ✅ 정상 생성

### DB visibility=absent (ep51-75)
- 카이렌 visibility=absent: 25/25 (R5B-1.9 ep45부터 시작된 fade-out이 ep75까지 carry)
- 다른 3 인물(리아/브론/빅토리): 0건

## 6. Verify 결과

build: ✅ tsc 통과 (R5B-1.8D commit `aca48dd` 빌드 + UI ✨ 통일 commit `2a83145` 위)

| Verify | Result |
|---|---|
| verify_meaningful_appearance_guard (신규 R5B-1.8D) | 17/17 ✓ |
| verify_episode_end_state_alignment (R5B-1.8C/D superset) | 17/17 ✓ |
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
| verify_summary_writer_invocation | NOT FOUND (script 미존재 — spec 표기 오류) |
| verify_foreshadow_light_dedup | NOT FOUND (script 미존재 — spec 표기 오류) |

regression 없음.

## 7. PR merge readiness

### YES인 이유
- R5B-1.8D generation-time integration: detector overlay 3/3 ✅ READY (would_remain_severe=0)
- 생성 안정성 25/25 score 80, fallback/foreign/special/parse 모두 0
- alignment LLM PASS 93.0% (≥85% / ≥90% 둘 다 충족)
- false_positive_block = 0 (실제 등장 인물 misblock 없음)
- 모든 verify regression 없음
- 금지 파일 미커밋, raw output 미커밋
- DB migration 없음, main push 없음
- API key/env/raw prompt/response/full body 미커밋

### CONDITIONAL인 이유
- LLM strict 기준 absent_severe = 2건 (ep58/63 카이렌 carry-forward LLM noise)
- duplicate discovery 5건 (R5B-1.5 dedup 정책 위반, R5B-1.9 1건 → 5건 증가)

### 평가
- absent_severe 2건은 R5B-1.8D guard가 작동을 막지 않은 carry-forward LLM 인식 noise. detector overlay 기준 would_remain_severe=0 — guard 자체는 정상.
- duplicate discovery 5건은 별 영역(R5B-1.5) 회귀이며 R5B-1.8D의 책임 영역 아님.

### **결정: PR merge readiness YES (with notes)**

merge 전 추가 작업: 없음. duplicate discovery 5건은 별 phase(예: R5B-3 dedup 강화)에서 처리 권고.

## 8. 100화 actual 판단

### **CONDITIONAL**

근거:
- 75화에서 score 25/25, alignment 93%, R5B-1.8D detector READY — 안정성 충분
- 단 duplicate discovery 1→5건 증가 추세, ep76~100에서 추가 누적 위험
- LLM absent_severe carry-forward noise도 100화에서 누적 가능 (이는 LLM judge 관점 noise이며 reader-facing 카드 정확도와 직접 연관성 약함)

권장 next step:
- (옵션 A) 100화 actual 직진 — duplicate dedup은 별 phase에서 처리
- (옵션 B) ep76~100 continuation canary 후 100화 도달 — generation cost는 동일 ($1.25 추가)
- (옵션 C) 우선 R5B-3 dedup 강화 → 그 후 100화 actual

권고: **A 또는 C 사이 사장님 판단**. duplicate discovery 5건은 R5B-1.5 정책 위반이지만 score 80 안정성에 영향 없으므로 100화 actual 직진도 합리적.

### ep76~100 continuation canary 필요 여부: **NO**

근거:
- ep75까지 R5B-1.8D guard generation-time integration 검증 완료 (3/3 PASS)
- 추가 25화 partial로 새 정보 거의 없음
- 100화 actual 비용은 동일 ($1.25 × 4 = ~$5)이고 actual에서 그대로 75 → 100 진행 가능

```
R5B-1.8E verdict: READY
PR merge readiness: YES
100화 actual 진행 가능 여부: CONDITIONAL (duplicate dedup 강화 후 또는 직진 둘 다 합리적)
ep76~100 continuation 필요 여부: NO
근거: TEST2E ep51~75 partial re-canary에서 R5B-1.8D meaningful appearance guard generation-time integration 검증 완료. 25/25 score 80, fallback/foreign/special/parse 모두 0. R5B-1.8D detector overlay 3/3 ✅ READY (alignment LLM PASS 93%, would_remain_severe=0, detector_caught_severe=2/2, false_positive_block=0). guard fire 0회는 planner가 absent 인물에 stateUpdate 미발행했기 때문이며 carry-forward branch가 자동 처리. visibility=absent 25건은 모두 카이렌 fade-out 정상. LLM strict 기준 absent_severe 2건(ep58/63 카이렌)은 R5B-1.9 ep45 시점 specific stored value가 carry된 상태에서 LLM이 "갱신됨"으로 오인한 prompt 한계 noise이며 detector overlay 기준에서는 PASS. duplicate discovery 5건(R5B-1.9 1건→5건 증가)은 R5B-1.5 dedup 정책 위반이지만 R5B-1.8D 책임 영역 밖이며 별 phase 처리 권고. 모든 verify regression 없음. PR merge에 차단 사유 없음.
```

## 부록 A. 본문/판정 데이터 보존 정책

- canary raw output: `.tmp/forensic/episodes_51-75_*.json` (gitignored)
- alignment audit raw: `.tmp/r5b1_8c_alignment_*_meaningful.json` (gitignored)
- 본 보고서에는 본문 전문 미게재. summary 메트릭만.
- LLM judge 응답 raw 미게재.
