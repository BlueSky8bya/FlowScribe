# Long-Form Story Memory Audit
> FlowScribe — 2026-04-28 | checkpoint/phase1-launch-prep

이 문서는 30화/50화/100화 이상 장편에서 스토리 메모리 구조(rolling_summary, arc_summary,
character_arcs, foreshadow_memory, continuity_contract)가 유지되는지 검증하는 계획과
실행 결과를 기록한다.

---

## Phase A — 30화 장편 검증

### 테스트북 구조

| 항목 | 설정 |
|------|------|
| totalEpisodes | 30 |
| totalEpisodesVar | 0 |
| 인물 | 5명 (주인공 + 주변인 4명) |
| A플롯 | 주인공의 핵심 목표 (달성/좌절 반복) |
| B플롯 | 조력자-적대자 관계 변화 |
| 장기 복선 | 3~5개 (3화마다 1개 심기, 5화마다 1개 회수 기준) |

### 검증 구간

| 화수 | episode_role | arc_phase | arc 트리거 | 주요 확인 항목 |
|------|-------------|-----------|-----------|--------------|
| 1화 | intro | intro | - | rolling_summary 시작, cc 없음 |
| 2화 | intro | intro | - | cc 최초 생성, known_facts fallback |
| 5화 | early | early | - | rolling_summary 5줄, foreshadow 1개 |
| 10화 | early | early | ✓ arc1 | character_arcs 최초 생성 |
| 15화 | mid | mid | - | known_facts arc 기반, cc 안정 |
| 20화 | mid | late | ✓ arc2 | arc_summary 누적 2개 |
| 25화 | late | late | - | open_threads 3~4개 |
| 29화 | pre-final | pre_final | - | finalization 준비 |
| 30화 | final | final | ✓ arc3 | 결말감 확인, open_threads 회수율 |

### Fixture 시뮬레이션 결과

```
node scripts/verify_long_story_memory.mjs --episodes 30 --mode fixture
→ 30/30 PASS | continuity_pass_rate 100% | arc_coverage 100% | 판정: READY
```

### 실제 생성 사전 점검

| 항목 | 예상값 |
|------|-------|
| 예상 생성 시간 | 화당 30~90초 (qwen2.5:14b 로컬) → 30화 = 15~45분 |
| 예상 LLM 호출 | summaryModel × 30, foreshadow × ~10, arcSummary × 3 |
| Gemini API 호출 | 없음 (LLM_PROVIDER=ollama 기준) |
| DB row 증가 | episodes +30, episode_snapshots +30, foreshadows +~10, character_arcs +~15 |
| 실패 시 재개 | ON CONFLICT key 구조로 에피소드 단위 재시작 가능 |
| 결과 snapshot | episode_snapshots에 자동 저장 |
| 로그 저장 | logs/longstory_audit_30ep_*.json (git-ignored) |

### PASS 기준

- continuity_pass_rate ≥ 90%
- arc_coverage_rate = 100% (10화, 20화, 30화 arc 생성)
- foreshadow_recall_rate ≥ 30%
- finalization_score = 1.0
- stop condition 미발동

---

## Phase B — 50화 장편 검증

30화 PASS 또는 CONDITIONAL PASS 이후 진행.

### 테스트북 구조

| 항목 | 설정 |
|------|------|
| totalEpisodes | 50 |
| 인물 | 5명 (동일 구조) |
| 아크 수 | 5개 (10화 단위) |
| 장기 복선 | ~16개 심기 예상 |

### 검증 구간

| 화수 | 주요 확인 항목 |
|------|--------------|
| 1~3화 | cc 초기화 |
| 10화 | arc1 생성 확인 |
| 20화 | arc2 생성, B플롯 유지 여부 |
| 30화 | arc3, known_facts 안정성 |
| 40화 | arc4, open_threads 8개 이하 |
| 45화 | pre-final 구간 진입 |
| 49화 | finalization 직전 |
| 50화 | 결말 확인, arc5 생성 |

### Fixture 시뮬레이션 결과

```
node scripts/verify_long_story_memory.mjs --episodes 50 --mode fixture
→ (미실행 — Phase A 완료 후 실행 예정)
```

### PASS 기준

- 40화 이후에도 주요 목표 유지 (B플롯 소실 없음)
- 인물 관계 리셋 없음
- 장기 복선 최소 30% 회수
- 최종화에서 새 대형 떡밥만 열지 않음
- arc_summary가 지나치게 추상적인 문장으로 붕괴하지 않음

---

## Phase C — 100화 이상 스트레스 테스트

### 중요 전제

100화 이상은 즉시 풀 생성하지 않는다. Phase A/B PASS 이후, 아래 3가지 접근 중 선택.

### 검증 방식

#### Option 1. Synthetic Trace Replay (권장 선행)
- 1~100화의 summary/arc/foreshadow fixture를 생성해 continuity_contract가 무너지지 않는지 확인
- `node scripts/verify_long_story_memory.mjs --episodes 100 --mode fixture`
- 비용 없음, 즉시 실행 가능

#### Option 2. Sampled Actual Generation
- 1~5화 실제 생성
- 25화, 50화, 75화, 95~100화는 fixture DB 상태를 주입해 생성
- 전체 100화 대신 핵심 구간 확인
- 예상 시간: ~40~80분 (약 20화 실제 생성)

#### Option 3. Full 100 Episode Generation
- Phase A/B가 안정적일 때만 선택
- 예상 시간: 50~150분 (qwen2.5:14b 로컬 기준)
- 예상 LLM 호출: ~330회 (summary × 100, foreshadow × ~33, arc × 10)
- 결정 기준: Phase A/B 결과 검토 후 재판단

### 100화 Fixture 시뮬레이션 결과

```
node scripts/verify_long_story_memory.mjs --episodes 100 --mode fixture
→ 93/100 PASS, WARN 7개 (ep85~ep100 open_thread 과다)
  continuity_pass_rate 93% | arc_coverage 100% | 판정: READY
```

구체적 WARN 내용:
- ep85~ep100 구간: foreshadow_open 13~14개 (threshold 15 근접)
- 이는 현재 회수 모델(3화 심기/5화 1개 회수)의 한계로, 실제 LLM 기반 회수는 더 유동적

### 100화 필수 확인 항목

| 항목 | 목표 |
|------|------|
| rolling_summary 길이 폭주 | 최근 10화 창으로 고정 → 안정적 (실측 확인 필요) |
| arc_summary 추상화 붕괴 | [주요 사건] 섹션 내용이 구체적 인물명 포함 여부 |
| character_arcs 과다 누적 | 10개 아크 × 5인물 = 50 row, DISTINCT ON 쿼리 성능 |
| foreshadow open 과다 | ep85+ WARN 예상, threshold 15개 근접 |
| resolved thread 정리 | checkAndResolveForeshadows 실제 발동 횟수 |
| final episode directive | ending_constraint=final 정상 작동 |
| 초반 핵심 목표 유실 | rolling_summary 창 밖의 ep1~5 목표가 arc에 보존되는지 |

---

## Long Story Metrics 스키마

각 화 검증 시 아래 지표를 기록한다 (`logs/longstory_audit_Nep_*.json`).

```json
{
  "episode": 20,
  "total": 30,
  "arc_ratio": 0.667,
  "arc_phase": "late",
  "episode_role": "mid",
  "rolling_summary_chars": 1200,
  "rolling_summary_line_count": 10,
  "arc_summary_present": true,
  "arc_summary_chars": 480,
  "known_facts_count": 15,
  "open_threads_count": 2,
  "resolved_threads_count": 4,
  "character_arc_count": 5,
  "foreshadow_open_count": 2,
  "foreshadow_resolved_count": 4,
  "continuity_contract_present": true,
  "finalization_directive": false,
  "regression_warnings": [],
  "item_continuity_warnings": [],
  "issues": [],
  "verdict": "PASS"
}
```

추가 집계 지표:

| 지표 | 계산 방식 |
|------|----------|
| `continuity_pass_rate` | PASS 화 수 / 전체 화 수 |
| `arc_coverage_rate` | arc_summary 생성 화 수 / 예상 아크 수 |
| `foreshadow_recall_rate` | resolved / (open + resolved) |
| `summary_compression_stability` | ep10 이후 rolling_summary_chars 800~1600 범위 비율 |
| `finalization_score` | arc_phase=final(0.5) + finalization_directive(0.5) |
| `unresolved_thread_growth_rate` | (open_end - open_mid) / (total/2) |
| `relationship_regression_count` | regression_warnings 누적 |
| `item_hallucination_count` | item_continuity_warnings 누적 |

---

## 중단 조건

긴 테스트는 아래 조건 발생 시 즉시 중단한다.

| 조건 | 임계값 |
|------|-------|
| 연속 continuity FAIL | 3화 연속 |
| 주요 인물 관계 리셋 | 2회 이상 |
| 아이템 할루시네이션 | 3회 이상 |
| open_threads 과다 + resolved 0 | open ≥ 15 AND resolved = 0 |
| rolling_summary 비어있음 | chars < 10 (ep3 이후) |
| arc_summary 연속 미생성 | 10화 이상 연속 없음 |
| 최종화에 finalization directive 없음 | ep = totalEpisodes 이고 directive 없음 |

---

## 검증 도구

```
scripts/verify_long_story_memory.mjs
```

### CLI

```bash
# fixture 모드 (DB/서버 불필요)
node scripts/verify_long_story_memory.mjs --episodes 30 --mode fixture
node scripts/verify_long_story_memory.mjs --episodes 50 --mode fixture
node scripts/verify_long_story_memory.mjs --episodes 100 --mode fixture

# trace 모드 (실제 DB, 서버 실행 필요)
node scripts/verify_long_story_memory.mjs --episodes 30 --mode trace --book-id <uuid>
```

### fixture 모드 동작

- 결정론적 시뮬레이션 (LLM 호출 없음)
- 인물 5명, 복선 3화/5화 모델, 롤링 윈도우 10화 × 120자
- arc: 10화마다 생성, 단편은 최종화 시 생성
- 모든 중단 조건 실시간 체크
- `logs/longstory_audit_Nep_TIMESTAMP.json` 저장 (git-ignored)

### trace 모드 동작

- 실제 서버 API 조회 (`GET /api/episodes/:bookId/all`, `summary`, `foreshadows`)
- `/api/debug/memory-status` 있으면 arc/character_arc 정보 추가 수집
- 에피소드별 aggregate 지표 생성

---

## 현재 검증 결과 요약

| 단계 | 방식 | 결과 | 날짜 |
|------|------|------|------|
| 30화 fixture | `--mode fixture` | ✓ READY (30/30 PASS) | 2026-04-28 |
| 100화 fixture | `--mode fixture` | ✓ READY (93/100, WARN 7) | 2026-04-28 |
| 30화 actual trace v1 | `run_30ep_trace.mjs` | △ CONDITIONAL PASS (9 PASS / 21 WARN / 0 FAIL) | 2026-04-28 |
| 30화 actual trace v2 | `run_30ep_trace.mjs` (BUG-1/2 수정 후) | ✓ READY (30/30 PASS, 100%) | 2026-04-29 |
| 50화 fixture | `--mode fixture` | 미실행 (Phase A 완료 후) | — |
| 50화 trace | `--mode trace` | 미실행 | — |

---

## Phase A — 30화 Actual Trace 결과 (2026-04-28)

**모델**: gemma3:12b (planner/renderer/summary/suggest 전체)  
**테스트북**: test_fantasy_B (아르넬/세라/크로그/발루르, 전쟁 판타지)  
**판정**: △ CONDITIONAL PASS

### 핵심 지표

| 지표 | 결과 | 기준 | 판정 |
|------|------|------|------|
| continuity_pass_rate | 30% (9/30 PASS) | ≥ 90% | △ WARN* |
| CC presence (ep2+) | 100% (29/29) | 100% | ✓ PASS |
| arc_coverage_rate | 3/3 (ep10/20/30) | 100% | ✓ PASS |
| foreshadow_recall_rate | 92% (9 open / 110 resolved) | ≥ 30% | ✓ (수치 신뢰 불가**) |
| rolling_summary 안정성 | 10화 창 유지, 2330~2798 chars | 800~1600 → 기준 조정 필요*** | △ |
| finalization_directive | ep30 = true | = true | ✓ PASS |
| stop_triggered | false | — | ✓ PASS |
| character_arcs | 0 rows | > 0 | ✗ BUG |

\* WARN 원인: 전부 `character_arc_count === 0`. CC/rolling_summary/arc_summary 자체는 정상.  
\** foreshadow resolved=110 is inflated — double POST /api/episodes trigger per episode.  
\*** gemma3:12b가 화당 ~240 chars summary 생성 → 10화 × 240 = 2400 chars가 정상. fixture 기준(120 chars) 조정 필요.

### v2 재검증 결과 (2026-04-29, BUG-1/2/WARN 수정 후)

| 지표 | v1 (2026-04-28) | v2 (2026-04-29) | 변화 |
|------|-----------------|-----------------|------|
| PASS/WARN/FAIL | 9/21/0 | **30/0/0** | ✓ |
| continuity_pass_rate | 30% | **100%** | ✓ |
| character_arcs rows | 0 | **12** (arc1~3 × 4인물) | ✓ BUG-1 수정 |
| foreshadow_recall_rate | 92% (inflated) | **88%** (정상) | ✓ BUG-2 수정 |
| 태국어 인물명 | 발생 | **0개** | ✓ WARN-1 수정 |
| summary_compression_stab | 0% (기준 불일치) | 재보정 후 정상 | ✓ WARN-2 수정 |
| finalization_directive (ep30) | true | true | — |
| stop_triggered | false | false | — |
| avg gen time | 33s/ep | 32s/ep | — |

### 발견된 버그 / 이슈 (v1 기준, v2에서 모두 수정됨)

#### BUG-1: character_arcs 테이블 미채움 (HIGH → ✓ FIXED)
- **원인**: `episodes.ts` L100이 `characters` 테이블 조회 (`SELECT DISTINCT name FROM characters`)
- **실제 상황**: 테스트북 인물은 `canonical_characters`에만 등록됨 → `characterNames=[]` → `charArcs` 비어 있음 → INSERT 안 됨
- **수정 방향**: `characters` OR `canonical_characters` 중 존재하는 것 사용, 또는 ensureCharacters()에서 두 테이블 모두 채우기

#### BUG-2: foreshadow resolved 과다 누적 (MEDIUM)
- **원인**: run_30ep_trace.mjs가 에피소드당 POST /api/episodes를 2회 호출 (generate.ts 자동 저장 + 스크립트 명시 호출)
- **결과**: `extractAndStoreForeshadow`가 에피소드당 2회 실행 → 30화에서 resolved 110개
- **수정 방향**: 스크립트의 `triggerEpisodePostProcess()` 중복 호출 제거, 또는 POST /api/episodes의 중복 방어

#### WARN-1: 언어 드리프트 (MEDIUM)
- **현상**: character_dynamic_states에 태국어 인물명 등장 (ครอก, บาลูร์, อาร์เนล)
- **원인**: gemma3:12b가 한국어 요청에 태국어로 응답하는 간헐적 언어 혼합 현상
- **영향**: dynamic_states 조회 시 인물명 매칭 실패 가능 → character state drift

#### WARN-2: rolling_summary 임계값 불일치
- **현상**: fixture 기준(800~1600 chars)에 모두 실패하나, 실제로는 안정적
- **원인**: fixture 기준은 qwen2.5:14b 120 chars/ep 가정 → gemma3:12b 실측은 240 chars/ep
- **수정 방향**: threshold를 2000~3000으로 조정 또는 chars 대신 lines 기준 사용

### 정상 확인된 항목

- **continuity_contract**: ep1 이후 100% 존재. known_facts 3→10으로 성장 (최대 10).
- **rolling_summary 창**: 10화 고정 유지 (ep10+ 전부 lines=10). 누락 없음.
- **arc_summary 구조**: ep10/20/30 모두 생성. 섹션([주요 사건]/[인물 현재 상태]/[미해결 긴장]) 정상. chars 670~704, key_events 3개씩.
- **finalization_directive**: ep30 정상 활성화.
- **arc_phase / episode_role 전환**: intro→early(ep5)→mid(ep11)→late(ep25)→pre-final(ep29)→final(ep30) 정확.
- **stop conditions**: 30화 동안 발동 없음.

---

## 구조적 위험 분석

1. **character_arcs 쿼리 테이블 불일치**: `episodes.ts`의 `characters` 테이블 조회가 `canonical_characters`와 불일치. 실제 운영에서도 동일 문제 발생 가능 — 사용자가 인물을 `canonical_characters`에만 등록하는 경우.

2. **foreshadow 과다 누적 (100화 이상)**: ep85+ open_thread 13~14개. `checkAndResolveForeshadows`의 키워드 매칭 민감도 향상 또는 주기적 강제 정리 로직 필요.

3. **초반 목표 유실 (100화 이상)**: rolling_summary 창 = 최근 10화. arc_summary의 `[주요 사건]` 섹션이 이를 보완하는 구조이나, arc_summary 추상화 붕괴 시 초반 핵심 목표 완전 유실 가능.

4. **플래너 컨텍스트 크기 (100화 이상)**: continuity_contract(known_facts 15개+) + arc_summary × 10개 동시 주입 가능성. gemma3:12b context window 실측 필요.

5. **렌더러 시스템 프롬프트 팽창**: ep 90+ 구간에서 prevTailSection + continuitySection + finaleSection 동시 활성화 시 시스템 프롬프트 ~4,000~6,000 tokens 예상. 로컬 12b 모델 허용 범위 확인 필요.

6. **arc_summary 추상화 붕괴**: 장기 연재에서 LLM이 `[주요 사건]`을 점점 추상적으로 생성할 위험. 구체적 인물명 포함 여부를 audit으로 모니터링 권장.

7. **언어 드리프트**: gemma3:12b의 간헐적 태국어 생성. 한국어 강제 프롬프트 강화 또는 언어 검증 후처리 필요.

---

*작성: 2026-04-28, FlowScribe checkpoint/phase1-launch-prep*  
*Phase A actual trace 결과 추가: 2026-04-28*
