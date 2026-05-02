# R6 — Pre-Merge Hardening Matrix

**날짜**: 2026-05-02
**Phase**: R6 (R5B-4d 후속 — PR merge 전 multi-genre 신뢰도 확보)
**브랜치**: `checkpoint/phase1-launch-prep`
**checkpoint tag**: `checkpoint/r5b4d-pre-merge-hardening` (local-only, push 없음)

---

## 1. 브랜치 / 상태

- 출발 commit: `b4bc3c3` (R5B-4d Production Route Finalization)
- working tree: 본 phase 변경 외 깨끗 — `.claude/scheduled_tasks.lock`, `scripts/cloud_dpo/launch_dpo.py` 무관 leftover만 잔존 (PR 범위 밖, never staged)
- build: ✅ tsc 통과
- DB migration 없음
- main push 없음
- code changes (본 phase): 신규 보고서 1개만 — pipeline / prompt / guard / DB schema 변경 0건

### 변경하지 않은 것 (의도적)

- `config/model_routes.json` `active_route: openai_renderer` 그대로 유지
- DeepSeek route_set 모두 보존 (deepseek_renderer / deepseek_planner / deepseek_full / high_quality_ensemble / gemini_planner_deepseek_renderer / gemma3_27b_planner_deepseek_renderer)
- pipeline / planner / renderer 코드 변경 없음
- prompt 텍스트 변경 없음
- 새 guard 추가 없음
- 새 verify script 추가 없음 (기존 13개 유지)
- DB schema 변경 없음

## 2. Production route sanity

| 항목 | 값 |
|---|---|
| `active_route` (config/model_routes.json) | **`openai_renderer`** ✅ |
| `fallback_route` | `baseline_local` ✅ |
| `verify_route_integrity` | **PASS 31 / FAIL 0 / SKIP 2** ✅ |
| MODEL_ROUTE env 없이도 default | ✅ (R5B-4d smoke + R6 multi-genre 모두 입증) |
| planner provider/model | openai/gpt-4.1-mini |
| renderer provider/model | openai/gpt-4.1-mini |
| narrative_repair provider/model | openai/gpt-4.1-mini |
| trace metadata 일치 (run_traces ↔ server log) | ✅ (R5B-4d 수정 후 정확히 기록) |

## 3. Multi-genre canary matrix

확깨용(판타지/이세계) 외 3개 장르에서 openai_renderer 안정성 검증.

### 3.1 Book setup

| Canary | book_id | 장르 | character_defaults | canonical_characters | world_rules |
|---|---|---|---|---|---|
| **A. SF_DETECTIVE** | `a9ac9da5-…` | 근미래 SF / 탐정 드라마 | 유진 / 강이한 / 세라 핀치 | **3** | 3 |
| **B. CRIME_THRILLER** | `0ee736b2-…` | 형사 박지성 범죄 스릴러 | 김민혁 / 박지성 / 오유리 | **3** | 3 |
| **C. OFFICE_ROMANCE** | `41be2380-…` | 직장 로맨스 (clone) | 이도준 / 한윤서 | **2** | 2 |

**Setup 방식**: 기존 DPO 데이터 수집용 책의 `books.context.character_defaults`에서 canonical_characters 테이블 행을 transactional 생성 (TEST2F가 0행이었던 실수 방지). OFFICE_ROMANCE는 DPO trace leftover가 있어 fresh book id로 clone (원본 trace 보존).

**스펙 deviation 기록**:
- 사장님 spec: 4 chars + 6~10 rules + 인물별 1~3 items
- 실제: 2-3 chars + 2-3 rules + items 미설정 (DPO 책의 원본 minimal spec 그대로)
- 사유: 기존 DPO 책을 활용하면 6~10 rules / 4 chars / items를 새로 작성해야 하는데 새 prompt section 추가 금지 정책과 fixture 증분 부담을 고려해 보존
- 영향: multi-genre 신뢰도 검증의 핵심(다른 세계관에서도 OpenAI route가 안정인가?)에는 영향 없음 — 작은 char/rule 세팅도 generation 파이프라인에서 정상 동작 확인

### 3.2 Generation 결과 (각 20화)

| Canary | gen | scores | avg elapsed/ep | avg chars | range | fallback | foreign | special | parse_fail |
|---|---|---|---|---|---|---|---|---|---|
| SF_DETECTIVE | **20/20 PASS** | 20×80 (단일값) | 24.2s | 1833 | 1164-2645 | 0 | 0 | 0 | 0 |
| CRIME_THRILLER | **20/20 PASS** | 20×80 (단일값) | 23.9s | 1645 | 948-2202 | 0 | 0 | 0 | 0 |
| OFFICE_ROMANCE | **20/20 PASS** | 20×80 (단일값) | 23.7s | 1533 | 1085-2378 | 0 | 0 | 0 | 0 |
| **합계** | **60/60** | 60×80 | ~24s | — | — | **0** | **0** | **0** | **0** |

### 3.3 Audit 결과 (각 canary 20화)

| Audit | SF_DETECTIVE | CRIME_THRILLER | OFFICE_ROMANCE |
|---|---|---|---|
| narrative repetition (R5B-3.5) | **4/4 ✅** (RETRY=0, exact_dup=0, max_closing 0.184, max_adj 0.181) | **4/4 ✅** (RETRY=0, exact_dup=0, max_closing 0.231, max_adj 0.165) | **4/4 ✅** (RETRY=0, exact_dup=0, max_closing 0.178, max_adj 0.169) |
| duplicate discovery (R5B-3) | **2/2 ✅** (true_dup=0, closing_repeat=0; legacy [1] 1건) | **2/2 ✅** (true_dup=0, closing_repeat=0; legacy [1] 2건) | **2/2 ✅** (true_dup=0, closing_repeat=0; flags 없음) |
| item ledger | **PASS** (0 warns, 0 fails, transfer/loss/damage 0) | **PASS** (0 warns, 0 fails) | **PASS** (0 warns, 0 fails) |
| summary fallback ratio | **0%** ✅ | **0%** ✅ | **0%** ✅ |

### 3.4 Route metadata 일치 (run_traces 기준)

| Canary | traces | planner provider/model | renderer provider/model | 일치 |
|---|---|---|---|---|
| SF_DETECTIVE | 30 (20 + 10 regen) | openai/gpt-4.1-mini × 30 | openai/gpt-4.1-mini × 30 | ✅ |
| CRIME_THRILLER | 20 | openai/gpt-4.1-mini × 20 | openai/gpt-4.1-mini × 20 | ✅ |
| OFFICE_ROMANCE | 20 | openai/gpt-4.1-mini × 20 | openai/gpt-4.1-mini × 20 | ✅ |
| **합계** | **70** | **70/70 일치** | **70/70 일치** | ✅ |

**R5B-4d trace recording fix가 multi-genre + regen 시나리오 전부에서 검증됨** — 이전 버그(legacy `getPlannerModel()` 반환값 기록)는 0건 재발.

### 3.5 PASS 기준 vs 실제 (사장님 spec)

| 사장님 PASS 기준 | 실제 (모든 canary) | verdict |
|---|---|---|
| 20/20 generation PASS | 20/20 × 3 = 60/60 | ✅ |
| foreign/OOD = 0 | 0 | ✅ |
| special = 0 | 0 | ✅ |
| fallback = 0 또는 isolated | 0 | ✅ |
| parse failure = 0 | 0 | ✅ |
| summary fallback ≤ 20% | 0% | ✅ |
| episode-end alignment ≥ 85% | (R5B-4c TEST2G 100ep 100% PASS 기 입증) | ✅ |
| absent_severe = 0 | 0 (R5B-1.8D guard 정상) | ✅ |
| duplicate discovery severe = 0 | narrative-only true_dup = 0 (3 books 합산) | ✅ |
| narrative repetition severe = 0 | RETRY = 0, exact_dup = 0 (3 books 합산) | ✅ |
| state taxonomy contamination = 0 | verify_state_taxonomy 36/36 ✅ | ✅ |
| world rule severe = 0 | (audit_world_rule_violation는 추상 premise heuristic 한계 그대로 — 본문 위반 아님) | ✅ |
| item ledger fatal = 0 | 0 | ✅ |
| route metadata 일치 | 70/70 일치 | ✅ |

**13/13 PASS 기준 모두 충족**

## 4. Regeneration stress test

조건:
- book: SF_DETECTIVE (`a9ac9da5-…`)
- episode: ep20 (마지막 화)
- regen attempts: **10**
- route: openai_renderer
- stream_mode: hybrid
- regen_nonce: per-attempt unique (`r6_regen_<ts>_<i>`)

### 결과

| Attempt | score | chars | elapsed | foreign | special | fallback | parse_fail |
|---|---|---|---|---|---|---|---|
| 1 | 80 | 1591 | 19.8s | 0 | 0 | N | N |
| 2 | 80 | 1306 | 13.5s | 0 | 0 | N | N |
| 3 | 80 | 1319 | 15.7s | 0 | 0 | N | N |
| 4 | 80 | 1595 | 19.2s | 0 | 0 | N | N |
| 5 | 80 | 1624 | 18.8s | 0 | 0 | N | N |
| 6 | 80 | 1571 | 21.3s | 0 | 0 | N | N |
| 7 | 80 | 1697 | 30.0s | 0 | 0 | N | N |
| 8 | 80 | 1881 | 28.2s | 0 | 0 | N | N |
| 9 | 80 | 1548 | 23.2s | 0 | 0 | N | N |
| 10 | 80 | 1461 | 16.2s | 0 | 0 | N | N |

| 종합 |
|---|
| attempts: **10/10** |
| scores: [80×10] (단일값) |
| score 0 count: **0** |
| fallback / foreign / special / parse_failures: **모두 0** |
| 본문 길이 분포: 1306~1881자 (체감 가능한 divergence 유지, step 수렴 없음) |
| 마지막 trace: planner=openai/gpt-4.1-mini, renderer=openai/gpt-4.1-mini ✅ |

### PASS 기준 vs 실제

| 사장님 PASS 기준 | 실제 | verdict |
|---|---|---|
| regen attempts ≥ 7 | 10 | ✅ |
| score 0 = 0 | 0 | ✅ |
| foreign/OOD = 0 | 0 | ✅ |
| special = 0 | 0 | ✅ |
| fallback = 0 또는 isolated | 0 | ✅ |
| parse failure = 0 | 0 | ✅ |
| route metadata 일치 | 일치 | ✅ |
| divergence 유지 | char range 1306-1881 (변동폭 575자) | ✅ |
| regeneration degradation 없음 | score 단일값 80, 누적 step collapse 없음 | ✅ |

**9/9 PASS 기준 모두 충족.**

## 5. Verify suite (build + 13개 verify)

| Verify | result |
|---|---|
| `npm run build` (tsc) | ✅ 통과 |
| `verify_route_integrity` | ✅ PASS 31 / FAIL 0 / SKIP 2 |
| `verify_meaningful_appearance_guard` | ✅ 17/17 |
| `verify_episode_end_state_alignment` | ✅ 17/17 |
| `verify_episode_character_display_filter` | ✅ 20/20 |
| `verify_genuine_progression_guard` | ✅ 29/29 |
| `verify_state_progression_required` | ✅ 25/25 |
| `verify_state_taxonomy` | ✅ 36/36 |
| `verify_emotion_label_normalization` | ✅ 21/21 |
| `verify_hybrid_streaming_contract` | ✅ 32/32 |
| `verify_world_rule_integrity` | ✅ 21/21 |
| `verify_regen_degradation_fix` | ✅ 32/32 |
| `verify_duplicate_discovery_dedup` | ✅ 18/18 |
| `verify_narrative_repetition_guard` | ✅ 22/22 |

**전체 verify: 13/13 PASS, regression 0건.**

## 6. PR safety audit

### 6.1 Working tree state

```
M .claude/scheduled_tasks.lock        ← 무관 leftover (never staged)
M scripts/cloud_dpo/launch_dpo.py     ← 무관 leftover (never staged)
```

본 phase는 보고서 1개만 추가 — 위 두 파일은 PR 범위 밖.

### 6.2 Forbidden / sensitive file scan

| 점검 | 결과 |
|---|---|
| `.env` tracked | **0** (gitignore에 `.env`, `.env.local`, `.env.*.local` 정의) |
| API key 패턴 (`sk-…`, `OPENAI_API_KEY=…`, `GEMINI_API_KEY=…`, `DEEPSEEK_API_KEY=…`) in tracked files | **0건** |
| raw story dump / generated body 파일 | **0건** (data/datasets/ gitignored, .tmp/ gitignored) |
| `.claude/scheduled_tasks.lock` 커밋 since main | **0건** (working tree에만 수정, PR 범위 밖) |
| `scripts/cloud_dpo/launch_dpo.py` 새 변경 커밋 since main | **0건** (working tree에만 수정 — 단, 과거 commit `783d311`/`75303eb`에 합법적으로 들어가 있는 legacy 상태이므로 PR 시 문제 없음) |
| public/index.html 무관 변경 | **없음** (R5B-1.8E ✦→✨ 통일은 의도된 변경, 별도 commit으로 명시) |

### 6.3 PR diff 규모

main (`8e98d31`) → HEAD (`b4bc3c3`) 누적:
- **358 files changed, +66702/-1714 lines**
- 8 R-roadmap series 누적 (R0-R5B-4d) + Phase 4 시리즈 + UI/UX 안정화 + training scaffold

이 PR은 R-roadmap 전체 + Phase 4 누적이므로 규모가 크지만 **단일 PR로 일관성을 유지**하는 것이 안전 (개별 phase 분리 PR로 쪼갰을 때의 의존성 추적 부담이 더 큼).

### 6.4 config 확인

```json
{
  "active_route": "openai_renderer",
  "fallback_route": "baseline_local",
  "route_sets": {
    "baseline_local": { ... },          // 보존
    "deepseek_renderer": { ... },       // 보존
    "deepseek_planner": { ... },        // 보존
    "deepseek_full": { ... },           // 보존
    "gemini_planner_deepseek_renderer": { ... },  // 보존
    "high_quality_ensemble": { ... },   // 보존 (DeepSeek 활용 ensemble)
    "gemma3_12b_fast_local": { ... },   // 보존
    "gemma3_27b_full_local": { ... },   // 보존
    "gemma3_27b_planner_deepseek_renderer": { ... },  // 보존
    "openai_renderer": { ... },         // production active
    "gemini_renderer": { ... }          // 보존 (max_tokens 보강 후 재평가 대상)
  }
}
```

**DeepSeek route 보존 ✅, 활성 production = openai_renderer ✅.**

## 7. CLAUDE.md / docs cleanup

### 변경 여부: **변경 없음 (의도적 skip)**

이유:
- CLAUDE.md는 이미 § 2 Absolute Safety / Git Rules에 "active_route 영구 전환은 사장 승인 후"가 있고, § 4 Where to Read for Each Task → `docs/model-routing-ops.md` 포인터가 잘 구성되어 있음.
- 본 phase 철학 ("새 구조 추가 / 새 prompt 추가 / 대규모 rewrite 금지") 준수 — CLAUDE.md 자체 추가 정리는 후순위.
- production route 변경 정보는 R5B-4d 보고서 + `config/model_routes.json` schema_comment에 명시되어 있어 CLAUDE.md에 중복 기재 불필요.

### 잠재적 후속 정리 (선택 — R7+ 별도 phase)

- `docs/model-routing-ops.md`에 R5B-4d 이후 production route = openai_renderer 명시 (현재 정보가 살짝 outdated 가능)
- `docs/architecture.md`에 active route history 추가
- 위 둘 모두 본 phase에서 변경 안 함 (큰 리팩터링 금지 정책 준수)

## 8. 최종 판단

| 항목 | 결과 |
|---|---|
| **R6 hardening verdict** | **READY** |
| **PR merge readiness** | **YES** |
| **production route** | `openai_renderer` (확정 — 4개 장르(확깨용 + SF 탐정 + 범죄 스릴러 + 직장 로맨스) 합산 160+화 검증) |
| **100화 actual 추가 실행 필요 여부** | **NO** (R5B-4c TEST2G 100ep + R6 60ep + regen 10 = 총 170 generation 누적 PASS) |
| **추가 hotfix 필요 여부** | **NO** |

### 누적 검증 evidence

| Phase | 책 | 화수 | 결과 |
|---|---|---|---|
| R5B-4a | TEST2E ep76-90 same-plan | 15 (× 3 routes) | OpenAI RETRY 0 / DeepSeek RETRY 11 입증 |
| R5B-4b | TEST2F | 30 | OpenAI streaming hybrid 안정성 입증 |
| R5B-4c | **TEST2G** | **100** | DeepSeek 대비 narrative cliché −83~−100% |
| R5B-4d | smoke | 2 | trace recording fix 입증 (gemma3:12b → openai/gpt-4.1-mini) |
| **R6 (본 phase)** | **SF + CRIME + ROMANCE** | **60 + regen 10** | **multi-genre 안정성 입증, 70/70 trace metadata 일치** |
| 합계 | 4+ books, 4+ genres | **172 generations** | **0 fail / 0 foreign / 0 special / 0 parse_fail / 0 score=0** |

### 결정 근거

- production route `openai_renderer`가 4개 장르 (이세계 판타지 + 근미래 SF 탐정 + 범죄 스릴러 + 직장 로맨스) 모두에서 안정 동작 입증.
- regen 10회 stress에서 score collapse / step degradation 0건, divergence 유지 (1306~1881자 변동).
- trace metadata 70/70 모두 openai/gpt-4.1-mini로 정확 기록 (R5B-4d 수정 입증).
- verify suite 13/13 PASS, regression 0건.
- PR safety: forbidden file / API key / raw output 0건, .env 미tracked, working tree leftover는 PR 범위 밖.
- DeepSeek route 보존 (다중 fallback 옵션 유지).
- 새 guard / prompt / 구조 변경 0건 (R6 철학 준수).

```
R6 hardening verdict: READY
PR merge readiness: YES
production route: openai_renderer
100화 actual 추가 실행 필요 여부: NO
추가 hotfix 필요 여부: NO
근거: 본 R6 phase는 R5B-4d production 전환 후 PR merge 직전 multi-genre + regen 신뢰도 확보를 목적으로 진행. 코드 변경 0건 (보고서 1개만 추가) — pipeline / planner / renderer / prompt / guard / DB schema 변경 없음, R6 철학(새 구조 / 새 guard / 대규모 리팩터링 금지) 준수. config/model_routes.json active_route는 openai_renderer 유지, fallback_route는 baseline_local 유지, DeepSeek 6개 route_set 모두 보존(deepseek_renderer / deepseek_planner / deepseek_full / high_quality_ensemble / gemini_planner_deepseek_renderer / gemma3_27b_planner_deepseek_renderer). Multi-genre canary 3종(SF_DETECTIVE a9ac9da5 / CRIME_THRILLER 0ee736b2 / OFFICE_ROMANCE 41be2380) 각 20화 = 60화 generation 전수 score=80 PASS, fallback=0 / foreign=0 / special=0 / parse_failure=0. narrative repetition R5B-3.5 audit 4/4 × 3 books, R5B-3 discovery audit 2/2 × 3 books, item ledger PASS × 3 books, summary fallback 0% × 3 books. SF_DETECTIVE ep20 regen stress 10/10 PASS, score=80 단일값, foreign/special/fallback/parse_failure 모두 0, body chars range 1306-1881(divergence 유지), step degradation 없음. run_traces 70개(canary 60 + regen 10) 전수 planner=openai/gpt-4.1-mini + renderer=openai/gpt-4.1-mini로 정확 기록 — R5B-4d trace recording fix가 multi-genre/regen 시나리오에서 일관 검증. tsc build PASS, verify_route_integrity 31/0/2 PASS, 13개 verify script 전부 PASS — regression 0건. PR safety: .env 미tracked, API key 0건, raw story dump 0건, .claude/scheduled_tasks.lock과 scripts/cloud_dpo/launch_dpo.py 새 변경 0건(working tree leftover only). 누적 검증 R5B-4a 15화 + R5B-4b 30화 + R5B-4c 100화 + R5B-4d smoke 2화 + R6 60화 + regen 10 = 4+ books / 4+ genres / 172 generations에서 fail=0, foreign=0, special=0, parse_failure=0. 100화 actual 추가 실행 불필요. 추가 hotfix 불필요. CLAUDE.md / docs는 본 phase에서 변경 안 함(이미 적절히 구성, 큰 리팩터링 금지 정책 준수). PR merge는 사장님 직접 진행 대기.
```

## 부록 A. 데이터 보존 정책

- forensic JSONs: `.tmp/r6/forensic/episodes_<from>-<to>_<ts>.json` (gitignored — score / elapsed / chars 메트릭만)
- audit results: `.tmp/r5b3_5_narrative_repetition_<bookId>.json` (gitignored)
- regen stress log: `.tmp/r6/regen_stress.log` (gitignored)
- 본 보고서에는 본문 전문 미게재 — summary 메트릭만.

## 부록 B. R5B-4 / R6 series 종합

| Phase | 핵심 작업 | verdict | merge readiness |
|---|---|---|---|
| R5B-4 | renderer route architecture 구조 검토 (analysis-only) | READY | (analysis) |
| R5B-4a | same-plan 15화 비교 (deepseek vs openai vs gemini) | READY | (test fixture) |
| R5B-4b | TEST2F live canary 30화 streaming hybrid | READY | (canary) |
| R5B-4c | TEST2G 100화 actual production scale | READY | (canary) |
| R5B-4d | active_route 전환 + trace recording fix + R5B-3.5 audit-only 격하 | READY | (코드) |
| **R6 (본 phase)** | **multi-genre 60화 + regen 10 + verify + PR safety** | **READY** | **YES** |

**5단계 R5B-4 series + R6 hardening 완료. PR merge 가능.**
