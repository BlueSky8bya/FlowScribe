# R5B-3.5 — Narrative Cliché Runtime Guard

**날짜**: 2026-05-02
**Phase**: R5B-3.5 (R5B-3 잔존 narrative cliché ep80↔81 sim=1.00 word-for-word identical 대응)
**브랜치**: `checkpoint/phase1-launch-prep`
**검증 책**: 확률을 깨는 용사(확깨용)_TEST2E (`eb6b7e27-db4f-4506-aef9-3d05de95d4ec`)

---

## 1. 브랜치/상태

- 출발 commit: `fd80ef5` (R5B-3 보고서)
- working tree: 본 phase 변경 외 깨끗 (`.claude/scheduled_tasks.lock`, `scripts/cloud_dpo/launch_dpo.py` 무관 leftover만 잔존)
- build: ✅ tsc 통과
- DB migration 없음, main push 없음, raw output / full body 미커밋

## 2. 문제 재분류

| 분류 | 정의 | 대표 케이스 | 책임 영역 |
|---|---|---|---|
| discovery duplicate | 같은 단서/흔적/상태를 다시 처음 발견 | (없음) | R5B-3 |
| closing scene duplicate | 화 마지막 구조 반복 | ep54-56 group | R5B-3 (planner prompt + audit) |
| **narrative cliché duplicate** | **본문 narrative 문장/패턴이 word-for-word 또는 high-sim으로 반복** | **ep80↔81 sim=1.00, ep90↔91 closing_sim=0.942** | **R5B-3.5 (이번 phase)** |

이번 잔존 문제는 **renderer prose-level repetition** — DeepSeek renderer가 long-running에서 동일 ending template을 그대로 반복. ep90 ↔ ep91 마지막 200자 중 5개 문장이 완전히 일치 (단어 1개 차이: "마법진의 빛" vs "룬의 빛").

## 3. 구현 내용

### 3.1 신규 module — `src/lib/narrative_repetition_guard.ts`

deterministic post-gen narrative repetition detector. LLM 호출 없음. 특정 단어/장르 하드코딩 없음.

API:
| | |
|---|---|
| `extractNarrativeSentences(body)` | quote 밖 narrative 문장 (≥20자, TRIVIAL_RE 제외) |
| `extractNarrativeTokens(body)` | quote 밖 narrative 부분만 한글 2~5자 토큰 |
| `checkNarrativeRepetition(newBody, recentEpisodes[])` | 종합 verdict (PASS/WARN/RETRY) + 메트릭 |
| `RETRY_INSTRUCTION` | retry 시 system prompt에 append할 안내 (행동/대사/마무리/선택/대응/공간 6옵션) |

severe(verdict=RETRY) 기준:
- exact_narrative_duplicate ≥ 1 (≥20자 narrative 문장이 최근 N화에 그대로 등장)
- adjacent_full_similarity ≥ 0.85
- closing_scene_similarity ≥ 0.65

### 3.2 Renderer signature 확장 — `src/pipeline/renderer.ts`

`renderFromPlanWithTrace`에 `extraSystem?: string` 7번째 parameter 추가. retry 시 base system prompt + extraSystem (RETRY_INSTRUCTION) concat.

### 3.3 Pipeline retry 통합 — `src/pipeline/index.ts`

sanitize 직후, `generatedText = sanitized.text` 직전:
1. recent N=3화 본문을 DB에서 로드 (현재 ep-3 ~ ep-1)
2. `checkNarrativeRepetition(generatedText, recent)` 호출
3. verdict=RETRY AND `!onRendererChunk` → renderer retry 1회 (extraSystem=RETRY_INSTRUCTION, temperature=0.92)
4. retry 결과 sanitize + 재검사. PASS/WARN이면 사용, 여전히 RETRY면 첫 결과 사용
5. 모든 실행 결과를 `tracer.setNarrativeRepetitionCheck()`로 기록

핵심 정책: **hybrid streaming 모드에서는 retry skip** (chunks가 이미 client에 흘러 UX 영향). 사용자 spec의 "사건 자체 엉뚱하게 바꾸지 않음 / story continuity 유지" 안전장치.

### 3.4 trace_logger — `setNarrativeRepetitionCheck`

`renderer_trace.narrative_repetition_check`에 verdict/max_sim/exact_dup_count/adjacent_full_sim/closing_sim/issues/retry_attempted/retry_succeeded 기록. run_traces 운영 가시성 확보.

### 3.5 신규 audit / verify

- `scripts/audit_narrative_repetition_guard.mjs` — DB의 ep1~N에 대해 인접 화 narrative 비교, R5B-3.5 PASS criteria 4개 출력
- `scripts/verify_narrative_repetition_guard.mjs` — 23 unit/integration fixture (라이브러리 + pipeline + renderer + trace_logger + dist 산출물)

### 3.6 DB migration 여부

**없음**. runtime validator + run_trace 기록만으로 처리.

## 4. TEST2E ep1~90 read-only baseline (pre-fix)

| 지표 | 값 |
|---|---|
| total episodes | 89 (ep2 부터 인접 비교) |
| PASS | 46 |
| RETRY | 43 |
| total exact_duplicate_count | 95 |
| max adjacent full similarity | 0.336 |
| max closing scene similarity | 0.738 |
| **R5B-3.5 PASS criteria** | **1/4 ⚠ CONDITIONAL** |

**ep80↔81 재분류**: R5B-3 baseline에서 jaccard sim 1.00이었던 narrative duplicate가 R5B-3.5 audit에서도 detection됨 (exact_narrative_duplicate으로 분류). false positive 아님 — 본문 narrative 문장 word-for-word identical.

## 5. ep91~100 targeted smoke (post-fix generation-time 검증)

### 5.1 설정
- book_id: eb6b7e27-db4f-4506-aef9-3d05de95d4ec
- ep91~100 (10화) HQE + hybrid
- server: R5B-3.5 dist 재시작 (00:33 KST) — 새 guard 활성, planner R5B-3 prompt 활성
- 결과: **10/10 score=80 PASS**, fallback=0, foreign=0, special=0, parse=0
- 평균 ~57초/ep, 가장 긴 ep98=78초

### 5.2 server log: R5B-3.5 retry fire

| 메트릭 | 값 |
|---|---|
| `pipeline:r5b3_5` 로그 | **0회** |
| narrative cliché 검출 RETRY trigger | 0 |
| retry 성공 | 0 |
| retry 실패 | 0 |
| guard 검사 실패 | 0 |

**원인**: hybrid streaming 모드에서 `onRendererChunk`가 set되어 retry 자체를 시도하지 않음. guard는 verdict 계산은 항상 수행하지만 RETRY trigger 로그는 retry attempt 시에만 emit. UX 안전 정책상 의도된 동작.

### 5.3 post-smoke audit (ep1~100, R5B-3.5 deterministic)

| 지표 | baseline ep1~90 | post-smoke ep1~100 | 변화 |
|---|---|---|---|
| PASS | 46 | 49 | +3 |
| RETRY | 43 | 50 | **+7** |
| total exact_duplicate_count | 95 | 127 | **+32** |
| max adjacent full similarity | 0.336 | 0.369 | +0.033 |
| max closing scene similarity | 0.738 | **0.942** | **+0.204 ⚠** |
| **R5B-3.5 PASS criteria** | 1/4 | 1/4 | 동일 |

### 5.4 ep91~100 자체 (10화)

| ep | verdict | exact_dup | adj_full_sim | closing_sim |
|---|---|---|---|---|
| 91 | RETRY | 4 | 0.342 | **0.942** |
| 92 | PASS | 0 | 0.272 | 0.163 |
| 93 | RETRY | 4 | 0.312 | 0.304 |
| 94 | RETRY | 8 | 0.369 | 0.333 |
| 95 | RETRY | 7 | 0.310 | 0.338 |
| 96 | RETRY | 7 | 0.228 | 0.148 |
| 97 | RETRY | 1 | 0.307 | 0.254 |
| 98 | PASS | 0 | 0.234 | 0.179 |
| 99 | PASS | 0 | 0.249 | 0.140 |
| 100 | RETRY | 1 | 0.239 | 0.324 |

10화 중 PASS=3, RETRY=7, exact_dup 28건 추가.

### 5.5 ep90↔91 closing 분석 (sim=0.942 fixture)

R5B-3 R5B-3.5 prompt + planner R5B-3 prompt가 적용된 generation에서도 ep90 closing 마지막 5개 문장이 ep91 closing에 거의 그대로(단어 1개 차이) 재출현.

paraphrase: 양 화 모두 "복도/마나/세 인물 시선 교환/리아 미소/'…끝.' 대사/마법진(룬) 빛 소실/연구실 침묵" 구조. 단어 1개만 변경된 word-for-word identical narrative sequence.

이는 **DeepSeek renderer가 long-running에서 동일 ending template을 반복하는 prose-level cliché loop**. prompt-level fix(planner R5B-3 + renderer R5B-3.5 retry instruction)으로는 generation-time에 차단 못 함 (hybrid streaming retry skip + DeepSeek prose pattern 자체 한계).

## 6. Verify 결과

build: ✅ tsc 통과

| Verify | Result |
|---|---|
| verify_narrative_repetition_guard (신규 R5B-3.5) | **23/23 ✓** |
| verify_duplicate_discovery_dedup | 18/18 ✓ |
| verify_meaningful_appearance_guard | 17/17 ✓ |
| verify_episode_end_state_alignment | 17/17 ✓ |
| verify_state_taxonomy | 36/36 ✓ |
| verify_hybrid_streaming_contract | 32/32 ✓ |
| verify_world_rule_integrity | 21/21 ✓ |
| verify_route_integrity | PASS 25 / FAIL 0 / SKIP 2 |
| verify_emotion_label_normalization | 21/21 ✓ |
| verify_genuine_progression_guard | 29/29 ✓ |
| verify_state_progression_required | 25/25 ✓ |
| verify_regen_degradation_fix | 32/32 ✓ |
| verify_episode_end_character_cards | 27/27 ✓ |
| verify_episode_end_character_cards_layout | 18/18 ✓ |
| verify_r5b1_7_emotional_contract | 25/25 ✓ |

regression 없음.

## 7. 다음 판단

### PR merge readiness: **CONDITIONAL**

YES인 이유:
- guard implementation 정확 (verify 23/23, audit signal 정상)
- run_trace 가시성 확보 (`narrative_repetition_check`)
- ep91~100 generation 안정성 10/10 score 80, contamination 0
- 모든 verify regression 없음, DB migration 없음

CONDITIONAL인 이유:
- hybrid streaming 모드에서 retry skip → generation-time 차단 효과 없음
- ep91~100에서 exact_duplicate 28건 추가, max closing_sim 0.942 발생
- post-fix audit이 baseline과 동일 (1/4) — 효과 0

### 100화 actual 진행 가능 여부: **NO**

근거:
- ep91~100 10화에서도 7/10 RETRY verdict, ep90↔91 closing word-for-word identical
- 100화에서 cliché 누적이 baseline 대비 줄어들지 않음
- 추가 hotfix(renderer route 또는 batch retry 정책) 없이 100화 actual은 reader 몰입 위험

### renderer route 재검토 필요 여부: **YES**

근거 (사용자 spec §8 trigger):
- prompt 추가만으로는 narrative cliché 차단 불가 (R5B-3 + R5B-3.5 둘 다 효과 부족)
- DeepSeek renderer (high_quality_ensemble route)의 long-running prose pattern 한계 가능성 — ep90↔91 0.942 sim, ep80↔81 sim=1.00이 같은 책 반복 발생
- 사용자 spec 권고대로 OpenAI renderer 또는 high_quality_ensemble_v2 route 비교 필요

권장 next step:
- (옵션 A) **R5B-4 — Renderer Route Comparison** — same plan 50화에 대해 deepseek-chat vs openai gpt-4.1 vs claude-sonnet-4-6 비교, narrative repetition / quality 측정
- (옵션 B) **R5B-3.5b — Batch retry 정책** — hybrid streaming 종료 후 narrative_repetition severe면 batch fallback 1회 (UX 추가 지연 감수)
- (옵션 C) 둘 다 (A 우선, A 결과로 route 결정 후 B 결정)

```
R5B-3.5 verdict: CONDITIONAL
PR merge readiness: CONDITIONAL (guard 안전망은 안전, 차단 효과 미입증)
100화 actual 진행 가능 여부: NO (cliché 누적 위험 그대로)
renderer route 재검토 필요 여부: YES
근거: R5B-3.5 narrative repetition guard는 deterministic detector + retry policy + run_trace 기록까지 정확하게 implement(verify 23/23). 그러나 hybrid streaming 모드에서 onRendererChunk 존재로 retry 자체를 skip하는 UX 안전 정책 때문에 ep91~100 targeted smoke에서 retry fire = 0회. post-smoke audit 결과 baseline ep1~90(95 exact_dup, 43 RETRY, max closing_sim 0.738) 대비 ep1~100에서 127 exact_dup, 50 RETRY, max closing_sim 0.942로 오히려 누적이 증가. ep90↔91에서 마지막 5개 문장이 단어 1개 차이로 word-for-word identical 재발현 — DeepSeek renderer의 long-running prose template 반복 한계가 명확. 사용자 spec §8에 명시된 "renderer route 재검토" 트리거 조건 충족. R5B-4 phase로 OpenAI renderer 또는 high_quality_ensemble_v2 비교 권고. 모든 verify regression 없음, DB migration 없음, raw output / full body 미커밋, 금지 파일 미커밋.
```

## 부록 A. 본문/판정 데이터 보존 정책

- canary raw output: `.tmp/forensic/episodes_91-100_*.json` (gitignored)
- audit raw: `.tmp/r5b3_5_narrative_repetition_*.json` (gitignored)
- 본 보고서에는 본문 전문 미게재. summary 메트릭과 paraphrase만.
- LLM judge 사용 안 함 (deterministic only).
