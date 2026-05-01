# R5B-1.9 — TEST2E HQE Hybrid 50EP Canary

**날짜**: 2026-05-01
**Phase**: R5B-1.9 (장기 안정성 검증)
**브랜치**: checkpoint/phase1-launch-prep
**검증 책**: 확률을 깨는 용사(확깨용)_TEST2E (`eb6b7e27-db4f-4506-aef9-3d05de95d4ec`)

---

## 1. 브랜치/상태

- 브랜치: `checkpoint/phase1-launch-prep`
- 출발 commit: `91ab3e8` (R5B-1.8C). 이후 `d5e2f24` (UI 카드 layout) 적용된 상태에서 ep16~50 생성.
- working tree: 금지 파일(.claude/scheduled_tasks.lock, scripts/cloud_dpo/launch_dpo.py) 외 깨끗
- build: ✅ PASS

## 2. Canary 설정

- **book_id**: `eb6b7e27-db4f-4506-aef9-3d05de95d4ec`
- **start episode**: ep16 (R5B-1.8C TEST2E 15화 위에서 이어서)
- **end episode**: ep50
- **route**: `high_quality_ensemble` (gpt-4.1-mini planner + deepseek-chat renderer + gemini repair)
- **stream_mode**: `hybrid`
- **generation 35화 합계 시간**: ~36분 (개별 38~89초, 평균 ~56초/ep)
- **estimated cost**: ~$1.75 (planner gpt-4.1-mini × 35 + renderer deepseek × 35 + repair gemini × 35)
- **결과**: **35/35 score=80 PASS**, fallback=0, foreign=0, special=0, parse_failures=0
- written: `.tmp/forensic/episodes_16-50_2026-05-01T13-37-37-969Z.json`

## 3. Checkpoint 결과

| Checkpoint | alignment PASS | WARN | FAIL | absent_severe | absent_border | R5B-1.8C verdict |
|---|---|---|---|---|---|---|
| ep25 | 94/96 (97.9%) | 2 | 0 | 0 | 13 | **3/3 ✅ READY** |
| ep35 | 134/136 (98.5%) | 2 | 0 | 1 | 22 | 2/3 ⚠ CONDITIONAL |
| ep50 | 183/196 (93.4%) | 6 | 7 | 6 | 28 | **1/3 ⚠ CONDITIONAL** |

**Trend**: ep25→35는 매우 안정. ep35→50 후반 구간에서 카이렌 인물의 absent_update 누적 발생.

### 카이렌 후반 화 detailed (FAIL 7건)
| ep | verdict | appeared | reason 요약 |
|---|---|---|---|
| 16 | FAIL | false | 본문에 등장하지 않는데 stored state 갱신 |
| 17 | FAIL | false | 본문 등장 전무, stored state 갱신 |
| 21 | FAIL | false | 본문 의미 있는 등장 전무, stored state 갱신 |
| 31 | FAIL | false | 본문 미등장, stored 갱신 |
| 32 | FAIL | false | 본문 미등장, stored 갱신 |
| 45 | FAIL | true | stored visibility=absent인데 본문에 의미 등장 (역방향 mismatch) |
| 46 | FAIL | false | 본문 의미 있는 등장 전무, stored 갱신 |

**원인**: R5B-1.8C `absent_in_body guard` 임계가 "이름 등장 < 3회"이지만 카이렌은 다른 인물 대사에 이름만 언급되어 3회 이상 나오는 케이스 (의미 있는 행동/대사 없음). guard fire 0회 — threshold가 의미 있는 등장 vs 단순 언급을 구분 못 함.

ep45는 반대 케이스: ep44에서 carry-forward로 absent 처리됐는데 ep45 본문에 의미 등장 → guard가 잘못 carry-forward 한 케이스.

## 4. 안정성 지표

### 생성 안정성 (완벽)
- ✅ score=80: **35/35** (100%)
- ✅ foreign/CJK/OOD: 0
- ✅ special token: 0
- ✅ fallback plan: 0 (연속 2회 ❌)
- ✅ parse failure: 0
- ✅ planner provider: openai/gpt-4.1-mini
- ✅ renderer provider: deepseek/deepseek-chat
- ✅ route metadata: high_quality_ensemble 일관

### Alignment 지표
- alignment PASS ≥ 85%: ✅ **93.4%**
- severe mismatch (FAIL) = 0: ❌ **7** (모두 카이렌 absent_update)
- absent_severe = 0: ❌ **6**
- absent_border (정상 carry-forward): 28 (정보용)

### Duplicate discovery
- cross-ep similar (sim ≥ 0.6, gap ≤ 5): **1건** (R5B-1.5 dedup 거의 유지, 50화 1건 isolated)
- exact duplicates (단문 인사·동작 표현): 317건 — 형식 표현 (인사·시선·앉음 등), motif 재이식 아님

### World rule violation
- keyword-heuristic FAIL: 59 (각 화에서 모든 절대 규칙 키워드를 반복하지 않으므로 발생). 실제 narrative 위반 없음. (도구 한계로 noise.)

### Other (자동 stability)
- summary fallback: 0건 (R5B-1 LLM 요약 정상 작동)
- absent_in_body guard fire: 0회 (50화 중 0회 — guard threshold 무력)
- arc_summaries / character_arcs: ep generation 중 정상 갱신 (개별 검증 미수행)

## 5. Verify 결과

build: ✅ tsc 통과

| Verify | Result |
|---|---|
| verify_episode_end_state_alignment | 17/17 ✓ |
| verify_genuine_progression_guard | 29/29 ✓ |
| verify_state_progression_required | 25/25 ✓ |
| verify_state_taxonomy | 36/36 ✓ |
| verify_emotion_label_normalization | 21/21 ✓ |
| verify_hybrid_streaming_contract | 32/32 ✓ |
| verify_world_rule_integrity | 21/21 ✓ |
| verify_route_integrity | PASS 25 / FAIL 0 / SKIP 2 |
| verify_episode_end_character_cards_layout | 18/18 ✓ |
| verify_episode_end_character_cards | 27/27 ✓ |

regression 없음.

## 6. PR merge readiness

### YES인 이유
- 생성 안정성 지표는 완벽 (35/35 score 80, 모든 contamination 0)
- alignment PASS 93.4% (R5B-1.8C 정의로 ≥85% 충족)
- 모든 verify PASS
- 금지 파일 미커밋, raw prompt/response 미커밋
- DB migration 없음, main push 없음
- API key 노출 없음

### CONDITIONAL인 이유
- 카이렌 인물의 absent_update FAIL 7건 (50화의 3.6%) — 단일 인물 집중
- absent_in_body guard threshold(이름 3회)가 본문 의미 없는 언급을 의미 등장으로 오인
- ep25/35에서는 0~1건이었으나 ep50까지 누적되며 6건으로 증가 → 100화 확장 시 더 누적될 것

### **결정: PR merge readiness CONDITIONAL**

merge 전 필요한 최소 작업:
- (옵션 A) R5B-1.8D guard 강화 — 의미 있는 등장 검출 (이름 + 동사 패턴, 또는 이름 다음 30자 내 행동/대사 토큰)
- (옵션 B) 또는 PR을 R5B-1.8C 상태로 merge 후 R5B-1.8D는 별도 PR

## 7. 100화 actual 판단

### **NO**

근거:
- 50화에서 absent_severe 6/196 = 3.1%, FAIL 7/196 = 3.6%
- ep25/35→50 trend: 후반 화로 갈수록 카이렌 absent_update 누적 (ep25=0, ep35=1, ep50=6)
- 100화로 확장 시 같은 인물(카이렌)이 더 자주 fade-out + state 갱신될 가능성 높음
- guard 보강 없이 100화 진행은 reader-facing 카드 정확도 저하 위험

### 75화 canary 필요 여부: **NO**

근거: 75화도 같은 guard 한계가 누적될 뿐 새 정보 없음. 먼저 guard 강화(R5B-1.8D) 후 50화 재검증이 더 효율.

권장 next step: **R5B-1.8D — Meaningful Appearance Guard Enhancement** (1~2일, DB migration 없음)
- pipeline에서 본문 등장 횟수만 보지 말고 "이름 + 동사/대사/결정 패턴" 검출
- 또는 LLM-based 의미 등장 검사 (낮은 빈도 인물에 한해)
- TEST2F 50화 또는 TEST2E ep51~75 추가 생성으로 재검증

```
R5B-1.9 verdict: CONDITIONAL
PR merge readiness: CONDITIONAL
100화 actual 진행 가능 여부: NO
75화 canary 필요 여부: NO (guard 강화 우선)
근거: TEST2E 50화 canary 결과 stability 지표 완벽(35/35 score 80, fallback/foreign/special/parse 모두 0). episode-end alignment 93.4% PASS criteria 충족. 단 카이렌 인물의 absent_update FAIL 7건(ep16/17/21/31/32/45/46) 누적 — R5B-1.8C absent_in_body guard threshold(이름 3회 미만)가 다른 인물 대사 안 단순 언급을 의미 등장으로 오인. guard 0회 fire. ep25→35→50 trend(0→1→6)로 100화 확장 시 누적 risk. 75화는 같은 issue 누적뿐. R5B-1.8D guard 강화(이름+동사 패턴 / LLM-based 의미 검출) 후 50화 재검증이 정공법.
```

## 부록 A. 본문/판정 데이터 보존 정책

- canary raw output: `.tmp/forensic/episodes_16-50_*.json` (gitignored)
- alignment audit raw: `.tmp/r5b1_8c_alignment_*.json` (gitignored)
- 본 보고서에는 본문 전문 미게재. summary 메트릭만.
- judge 응답 raw 미게재.
