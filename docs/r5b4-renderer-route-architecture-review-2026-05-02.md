# R5B-4 — Renderer Route & Generation Architecture Structural Review

**날짜**: 2026-05-02
**Phase**: R5B-4 (analysis-only — 코드 변경 없음)
**브랜치**: `checkpoint/phase1-launch-prep`

---

## 1. 브랜치/상태

- 출발 commit: `bf5a182` (R5B-3.5 보고서)
- working tree: 본 phase 변경 **없음** (analysis-only)
- build: ✅ tsc 통과 (R5B-3.5 빌드 그대로)
- code changes: **없음** (read-only analysis)

## 2. 현재 문제 구조 분류

### A. Memory / Context (R5B-1 ~ R5B-3 영역)

| 항목 | 상태 |
|---|---|
| Established fact 저장 | character_dynamic_states / arc_summaries / character_arcs / continuity_contract / episode_delta_contract / known_facts 모두 작동 |
| Open thread / foreshadow re-injection | R5B-1.5에서 dedup 강화, R5B-3 baseline에서 재주입 패턴 미발견 |
| 본문 fact carry | rolling summary + delta contract로 처리됨 |
| **R5B-1~R5B-3 해결도** | **충분 ✓** |

evidence:
- R5B-1.9 ep1~50, R5B-1.8E ep51~75, R5B-3 ep76~90 모두 alignment ≥ 93%
- R5B-3 audit이 closing scene 반복은 잡았지만 narrative cliché는 별 문제로 분리됨
- R5B-3.5 baseline에서 narrative cliché는 **memory가 아닌 prose-level loop**로 확정

남은 리스크: 거의 없음. context 구조는 안정.

### B. Renderer prose repetition (R5B-3.5 영역)

| 항목 | 상태 |
|---|---|
| renderer 동일 문장 구조/장면 마무리 반복 | **확인** |
| DeepSeek long-running prose template loop | **강한 evidence** |
| context 정상 + planner 정상에서도 본문 문체 수렴 | **확인** |

evidence:
- ep80↔81 narrative sim=1.00 ("빅토리가 핸드폰을 들어 마나 샘의 방향을 확인했다" word-for-word)
- ep90↔91 closing 마지막 5문장이 단어 1개 차이로 word-for-word identical (closing_sim=0.942)
- 두 케이스 모두 R5B-3 prompt + R5B-3.5 retry instruction이 적용된 generation
- 즉 **prompt 추가로 차단 안 됨** — DeepSeek renderer의 동일 plan/context에서 동일 prose 출력 경향

남은 리스크: 100화 확장 시 누적 증가. ep1~90 baseline에서도 max closing_sim 0.738, R5B-3.5 후 ep1~100에서 0.942로 더 악화.

구조적 해결책: **renderer 모델 변경** 또는 **post-gen rewrite pass** 또는 **batch quality mode (retry 가능)**.

### C. Architecture policy conflict (hybrid streaming vs quality repair)

| 항목 | 상태 |
|---|---|
| hybrid streaming 모드에서 post-gen retry 가능 | **불가** (chunks 이미 client에 stream됨) |
| onRendererChunk truthy → guard verdict 계산 후 retry skip | **확정** (R5B-3.5 server log: retry fire 0회) |
| streaming mode와 quality repair는 구조적으로 충돌 | **확정** |

evidence:
- R5B-3.5 코드(`src/pipeline/index.ts`)에 `if (verdict === "RETRY" && !onRendererChunk)` — hybrid 시 retry 자체 시도 안 함
- ep91~100 server log `pipeline:r5b3_5` retry fire = 0회 (의도된 UX 안전)
- 그 결과 ep91~100 자체에서 RETRY=7/10, ep90↔91 closing_sim 0.942 차단 못 함

구조적 해결책 후보:
1. **별 quality batch mode 도입** — longform actual / canary는 batch (retry 가능), 단발 화 UX는 hybrid 유지
2. **Hidden buffer streaming** — 첫 N자만 buffer, 검증 후 stream resume (구현 복잡)
3. **Stream-then-advisory** — guard는 logWarn + audit only, 실시간 차단 포기 (효과 0)

남은 리스크: streaming 그대로 두고 guard만 추가하면 효과 없음 (R5B-3.5 입증).

### D. Overconstraint (prompt burden 누적)

evidence:
- `src/pipeline/planner.ts` 1129 LOC, system prompt에 negative constraint **64회** ("금지/반드시/안 함/않음/않는다/않도록")
- `src/pipeline/renderer.ts` 387 LOC, negative constraint **24회**
- planner system prompt에 R-시리즈만 봐도: `반복 패턴 변주`, `★ R5B-3 발견·결말 반복 방지`, `★ R5B-1.8 감정 납득성·원인-행동 진전`, `소지품 원칙/등급/상태`, `★ 세계관 장소 — 최우선` 등 7+ 명시 section
- renderer system prompt에는: `★ 핵심 주인공`, `★ 절대 규칙`, `직전 화 말미`, `연속성 — 퇴행 금지`, `Episode Delta Contract` (`반복 변주`, `반드시 진전`, `인물 상태 변화 요구`, `반복 위험 패턴`), `시점 최우선`, `★ 인물 이름`, `등장인물`, `장면 계획`, `시작 위치·시각`, `직전 화 여파`, `소지품`, `문체·분량`, `★ R5B-1.8 감정 납득성`, `대화 따옴표`, `엔딩 훅 / 최종화`, `이전 화 제목` — 15+ section

위험:
- 모델이 안전한 cliché로 회귀 (실제 ep90↔91 word-for-word identical은 negative constraint가 너무 많을 때 모델이 "안전한" template으로 수렴한 결과로 해석 가능)
- 새 phase마다 prompt 추가 → 한계 도달
- 본 R5B-3 / R5B-3.5 prompt section은 효과 부족

남은 리스크: 다음 phase에서 또 prompt 추가하면 모델 다양성 ↓ 가능성 명확.

## 3. R5B-3.5 결과 해석

### 구현 측면 — 성공
| 측면 | 평가 |
|---|---|
| deterministic detector | ✓ verify 23/23 PASS |
| retry policy 설계 | ✓ exact dup + adjacent + closing 3종 검사 |
| trace 기록 | ✓ `narrative_repetition_check` 운영 가시성 |
| renderer signature 확장 | ✓ extraSystem parameter |
| 회귀 | 없음 (15 verify suite PASS) |

### 효과 측면 — 미입증 (구조 문제)
| 측면 | 결과 |
|---|---|
| ep91~100 retry fire | 0회 (hybrid streaming skip) |
| ep91~100 RETRY verdict | 7/10 (변화 없음) |
| max closing_sim baseline → post | 0.738 → 0.942 (악화) |
| total exact_dup baseline → post | 95 → 127 (+32 누적) |

### 4가지 질문에 대한 답

1. **retry가 skip되는 구조라면 runtime guard가 실제 제품에서 의미 있는가?**
   → **부분적**. trace 기록과 audit 가시성은 가치. 그러나 streaming UX 모드에서는 차단 효과 0. **batch 모드에서만 의미**.

2. **streaming 중에는 본문을 이미 보여주므로 repair가 어려운가?**
   → **그렇다**. UX 정책상 client에 흐른 chunks를 retract할 수 없음.

3. **그러면 high-quality longform mode는 streaming을 끄거나, 사전 검증 가능한 batch mode가 필요한가?**
   → **YES** — 100화 actual / 50화 canary는 batch mode가 적절. UX 단발 생성은 hybrid 유지.

4. **아니면 renderer 자체를 더 강한 모델로 바꾸는 것이 더 단순한가?**
   → **검증 필요** — DeepSeek 외 OpenAI/Claude/Gemini renderer로 같은 plan에 대해 비교 안 됐음. config 추가만으로 가능 (코드 변경 최소).

## 4. Guard Accretion 분석

지금까지 추가된 주요 guard 모듈 (lib/services 기준 12개):

| Guard | 목적 | critical path? | prompt 부담 | 범용성 | 권고 |
|---|---|---|---|---|---|
| entity_resolver | 인물명 정규화 (alias/drift) | ✓ | 없음 | 높음 | **유지** |
| episode_appearance | 인물 등장 분류 | ✓ | 없음 | 높음 | **유지** |
| episode_delta_validator | 화 진전 검증 | ✓ | renderer prompt 압박 | 중간 | **유지 (delta contract는 핵심)** |
| item_ledger | 소지품 ledger | ✓ | renderer 소지품 section | 높음 | **유지** |
| language_guard | 영어/외래어 정규화 | ✓ | 없음 | 높음 | **유지** |
| narrative_coherence (judgeAndRepair) | 본문 사실 모순 LLM repair | ✓ | 없음 (본문 단계) | 높음 | **유지** |
| text_sanitizer | special token / 외래어 제거 | ✓ | 없음 | 높음 | **유지** |
| validator (prose) | 본문 품질 검증 | ✓ | 없음 | 높음 | **유지** |
| meaningful_appearance (R5B-1.8D) | 본문 의미 등장 guard | ✓ | 없음 (백엔드 only) | 높음 | **유지** |
| discovery_signature (R5B-3) | 발견 사건 / closing scene dedup | audit only + prompt | planner section 1개 | 중간 | **유지 (audit-only로 무게중심 이동 권장)** |
| narrative_repetition_guard (R5B-3.5) | post-gen narrative cliché | hybrid에서 fire 0 | retry instruction | 높음 | **유지하되 batch mode에서만 retry, hybrid는 audit-only** |
| generation_guard (legacy) | 기타 | 다양 | — | — | (확인 필요) |

prompt 부담:
- planner system prompt section 7+개 (R-phase 관련)
- renderer system prompt section 15+개
- 누적 negative constraint: **planner 64 + renderer 24 = 88회**
- 본 R5B 시리즈에서 추가된 새 section: R5B-1.8 emotional plausibility, R5B-3 발견·결말 반복 방지 — 명시 section만 2개 추가

### 4가지 질문에 대한 답

1. **prompt-level 금지 규칙이 너무 많아졌는가?** → **YES**. 88회 negative + 22+ section은 모델 자유도를 좁힘.
2. **renderer가 자유롭게 장면을 구성할 여지가 줄었는가?** → **부분적**. 핵심 contract(delta/state/world rule)은 필요하지만 R5B-3 / R5B-3.5 추가 prompt는 효과 부족하면서 부담만 ↑.
3. **guard가 많아져 모델이 안전한 cliché로 회귀하는가?** → **가능성 있음**. ep90↔91 word-for-word identical은 모델이 "안전한 template"으로 수렴한 정황 (overconstraint 회귀 가설).
4. **코드가 너무 많은 후처리 예외로 복잡해졌는가?** → **부분적**. pipeline/index.ts 1023 LOC + 다수 logWarn 분기. 단 각 분기가 documented + audit-friendly이라 deletion 후보는 명확.

## 5. Route 전략 — 비교 설계 (구현 X)

### 비교 후보

| Route | planner | renderer | 비용/화 | streaming 가능 | 코드 변경 |
|---|---|---|---|---|---|
| A. high_quality_ensemble (현재) | gpt-4.1-mini | deepseek-chat | ~$0.05 | ✓ | 0 |
| B. openai_renderer | gpt-4.1-mini | gpt-4.1-mini | ~$0.20 | ✓ | route config 추가 |
| C. openai_strong | gpt-4.1-mini | gpt-4.1 (full) | ~$0.50 | ✓ | route config + env |
| D. claude_renderer | gpt-4.1-mini | claude-sonnet-4-6 | ~$0.30 | ✓ | provider 추가? |
| E. gemini_renderer | gpt-4.1-mini | gemini-2.5-pro | ~$0.15 | ✓ | route config (gemini 이미 사용 중) |
| F. two-stage (draft + rewrite) | gpt-4.1-mini | deepseek (draft) + gemini (rewrite) | ~$0.10 | ✗ batch only | 코드 변경 큼 |

### 비교 기준 (10개)
1. 장기 narrative repetition 감소 (1순위)
2. closing scene 반복 감소
3. exact narrative duplicate 감소
4. episode-end alignment 유지 (≥ 90%)
5. 비용 (per 100화 추정)
6. latency (per 화 평균)
7. streaming 가능 여부
8. retry/repair 호환성
9. 코드 복잡도 (config-only / provider 추가 필요 여부)
10. 범용성 (다른 책에서도 동작 보장)

### 최소 실험 설계 (다음 phase에서 구현 권고)

- **same plan 방식**: 동일 planner output을 fixture로 저장 → 각 renderer route에 같은 plan 입력 → narrative 결과만 비교
- **데이터셋**: TEST2E ep51~80 (30화) plan을 재사용 (이미 R5B-1.8E/R5B-3에서 잘 안정된 데이터)
- **measurement**: `audit_narrative_repetition_guard` + `audit_episode_end_state_alignment` 결과 비교
- **비용 목표**: 50화 미만 비교(예: ep51~70, 20화 × 3~4 route × $0.05~0.50 ≈ $5~$50)
- **선결 조건**: route config 추가 (코드 변경 최소, env var만)

특정 모델 무조건 배제 금지: A(현재 baseline) + B + E 3개 route + F 2-stage 1개 = 4개 비교가 적정. C/D는 비용 과다 시 후보 제외.

## 6. Streaming vs Quality Mode 정책

| Option | 장점 | 단점 | 적합 |
|---|---|---|---|
| 1. Hybrid streaming 유지 | 빠른 체감 | retry/repair 어려움 | 단발 UX 생성 |
| 2. Quality batch mode | 저장 전 retry | 첫 토큰 느림 | longform actual, 50/100화 canary |
| 3. Stream then advisory | UX 빠름 | 차단 효과 0 | (현재 R5B-3.5 위치) |
| 4. Hidden buffer streaming | 일부 검증 후 공개 | 구현 복잡 | (장기 후보) |

### 4가지 질문에 대한 답

1. **장편 actual에서는 hybrid를 계속 써야 하는가?** → **NO**. 100화 actual은 quality 우선이며 batch가 적절.
2. **100화 actual은 품질 batch mode가 더 적절한가?** → **YES**. retry/repair 가능 + 사용자가 진행 중 화면에 노출되지 않음.
3. **사용자-facing 생성과 batch canary generation의 모드를 분리해야 하는가?** → **YES**. 이미 partial 분리 (canary는 background script). 정식 mode flag로 정리 권고.
4. **mode를 늘리면 코드 복잡도가 얼마나 증가하는가?** → **중간**. `stream_mode=hybrid|quality_batch` flag로 onChunk 유무를 명시 분기. 현재 코드는 `!onRendererChunk`로 이미 분기 — flag만 정식화하면 됨.

권장 운영 정책:
- **단발 생성 / UX**: hybrid (현 정책 유지)
- **50화 이상 canary / actual**: quality_batch (retry 활성화)
- **사용자가 quality 우선 선택 시**: optional `stream_mode=quality_batch` 노출

## 7. 결론 — 추천 결론

### 평가 매트릭스

| 후보 | 결과 평가 |
|---|---|
| A. Code guard 계속 진행 | **NO** — overconstraint 위험 + R5B-3 / R5B-3.5 추가가 효과 부족 입증됨 |
| B. Renderer route 변경만 | **부분 YES** — 비교 데이터 없이 결정 못 함, 단 검증 가치 있음 |
| C. Generation mode 분리만 | **부분 YES** — quality_batch는 retry 가능하게 만들지만, renderer 한계는 유지 |
| D. Prompt/guard pruning만 | **부분 YES** — overconstraint 완화 효과는 검증 필요, 일부 회귀 위험 |
| **E. Mixed strategy** | **YES — 추천** |

### **추천: E. Mixed strategy**

phase 순서 권고:
1. **R5B-4 (이번)**: structural review (analysis only) — 본 보고서로 마침
2. **R5B-4a**: route config 추가 + same-plan 비교 harness (config + script-level 작업)
3. **R5B-4b**: 실제 4-way route 비교 실험 (20~30화) → 측정 기반 결정
4. **R5B-5**: streaming/quality mode 분리 정책 (canary는 quality_batch)
5. **R5B-6 (선택)**: prompt pruning — R5B-3 / R5B-3.5 prompt section을 audit-only로 무게중심 이동, narrative_repetition_guard는 batch에서만 retry

원칙:
- 새 guard 추가 금지 (한 phase 동안)
- prompt 추가 금지 (overconstraint 완화 우선)
- DB migration 없음 유지
- guard는 audit-only로 격하 가능 (verdict 계산 + trace 기록만, retry 안 함)

## 8. 모델 성능을 코드가 억누르는지 평가

### Current prompt burden
- planner 1129 LOC + 64 negative constraint + 7+ R-phase section
- renderer 387 LOC + 24 negative + 15+ section
- **누적 88 negative constraint, 22+ explicit section**

### Overconstraint risk
- ep90↔91 word-for-word identical은 overconstraint → safe template 회귀 가설과 일치
- 모델이 자유롭게 장면 구성할 여지는 좁음 — beat 4개 + character_state_updates + 6-delta 모두 명시
- R5B-3 / R5B-3.5 추가 section은 효과 부족 (post-fix audit 변화 없음)

### Creativity suppression risk
- **HIGH** — 명시 negative + section의 누적이 모델을 risk-averse로 push
- 한계 신호: same plan에서 다른 화가 같은 ending → renderer가 "안전한 결말"로 수렴

### Recommended pruning (R5B-6 후보)
- ★ R5B-3 발견·결말 반복 방지 → audit-only로 격하 가능 (closing scene은 batch retry로 처리)
- 일부 negative ("…안 함", "…금지") 표현을 positive ("…로 전진", "…를 우선")로 paraphrase
- repeat 패턴 변주 + 반복 회피 + R5B-3 발견·결말 — 3개 section을 1개로 통합
- renderer Episode Delta Contract section은 데이터 기반(반복 위험 패턴 list)이 비어있을 때 hide

### audit-only로 내릴 수 있는 항목 (R5B-6 후보)
- discovery_signature (R5B-3) — narrative_repetition_guard로 대체 가능, 중복 metric
- narrative_repetition_guard (R5B-3.5) — hybrid에서는 retry 안 하므로 audit-only가 더 정직

## 9. 최종 권고

```
R5B-4 structural verdict: CONDITIONAL
추천 next phase: R5B-4a — Route Comparison Harness (config + same-plan script-level 비교 설계, 코드 변경은 config + 신규 비교 script만, prompt/guard 추가 금지)
PR merge readiness: CONDITIONAL (현재 R5B-3.5까지의 commit은 안전하고 verify regression 없으므로 PR merge 자체는 가능. 단 100화 actual 진행은 별 문제로, structural 정리 후 안전)
100화 actual 진행 가능 여부: NO (renderer cliché 누적 위험 + hybrid streaming retry skip 구조 충돌이 미해결)
renderer route 재검토 필요 여부: YES (R5B-3.5 입증된 DeepSeek long-running prose template loop, ep80↔81 sim=1.00, ep90↔91 closing word-for-word identical은 prompt-level fix로 차단 불가)
근거: R5B-1~R5B-3.5 phase 누적 분석 결과, 반복 문제는 (A) memory/context는 충분히 해결됨 (B) renderer prose-level loop는 R5B-3.5에서 입증됐고 prompt 추가로 차단 불가 (C) hybrid streaming과 post-gen retry는 구조적 충돌 (UX 안전 정책상 chunks 흐른 후 retract 불가)이며 R5B-3.5 retry fire 0회로 입증됨 (D) prompt burden 88 negative + 22+ section은 overconstraint 영역에 진입했고 ep90↔91 word-for-word identical은 모델 cliché 수렴 가능성과 부합. 새 guard 추가는 R5B-3 / R5B-3.5에서 효과 부족 + prompt burden ↑ 패턴이 두 phase 연속 발생. 따라서 단일 hotfix가 아닌 mixed strategy 필요: (1) route 비교로 renderer 한계 입증/반증 (2) streaming/quality mode 분리로 batch-only retry 정책 정착 (3) audit-only로 일부 guard 격하 + prompt pruning. R5B-4a부터 config-level + script-level만 진행하고 새 prompt/guard 추가는 R5B-6 측정 후로 보류. PR merge는 현재 commit까지로 가능, 100화 actual은 R5B-4b/R5B-5 결과 후 재판단.
```

## 부록 A. 본 phase 산출물

- **본 보고서**: `docs/r5b4-renderer-route-architecture-review-2026-05-02.md`
- **코드 변경**: 없음
- **DB migration**: 없음
- **신규 lib/script**: 없음
- **commit 권고**: 보고서 1개만 commit (analysis 산출물)
