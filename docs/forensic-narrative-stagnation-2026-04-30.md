# [NARRATIVE PROGRESSION STAGNATION FORENSIC REPORT]
**Phase:** R5A-D0 — Narrative Progression Forensics Before 30EP Canary
**Date:** 2026-04-30 (작성 2026-05-01)
**Test target:** 확률을 깨는 용사(확깨용)_TEST
**Author:** Claude (FlowScribe agent)
**Status:** Analysis-only. 코드 수정 없음. 본문 전문 미저장.

---

## 0. Executive summary

ep1～ep5 서사가 **"빅토리에게 마나가 없다"** 단일 모티프에 5화 동안 갇혀 있다. 사장님 가설 ②번이 정확히 정답: 시스템은 직전 본문 일부 + 빈약한 요약 + **"마나 없음"이 매 화마다 새 foreshadow로 재-plant되는 구조** 때문에, 이미 ep1에서 확정된 사실을 ep5까지 "여전히 미해결 문제"로 다룬다.

자동 audit 결과(`scripts/audit_narrative_progression_stagnation.mjs`):
```
fallback_summary_ratio: 100%
emotion streak (전 인물): 4 (5화 중 4화 동일)
location changes: 2  carry-forwards: 14
foreshadow open/total: 13/20  (open 비율 65%)
"마나" keyword 재-plant: 7회 (5화 중 5화 모두에 plant)
character_arcs: 모든 화 0건
emotion_progression_requirements: ep5에서 처음 발동 (사후약방문)
repetition_risk: ep4에서 처음 발동, 그것도 "혼란/혼수" 키워드 차단만
avg progression score (0~5): 1.20  ⚠ (정체)
```

**Root cause는 단일 결함이 아니다. 8개 후보 중 5개가 확실한 HIGH (A, B, C, D, E)**. 그 중에서도 후보 D (Foreshadow 오남용 — 같은 사실의 반복 plant)가 가장 "보이지 않게" 작동하는 직격탄.

---

## 1. 브랜치/상태

```
branch:  checkpoint/phase1-launch-prep
commit:  b8dbbb2 (fix(reader-ui): 이야기 진행 섹션 — 보고 있는 화에 highlight)
build:   ✅ tsc 통과
working tree: 무관 파일 2개만 modified (.claude/scheduled_tasks.lock, scripts/cloud_dpo/launch_dpo.py)
code change: NONE — analysis-only Phase
```

신규 산출물 (read-only):
- `docs/forensic-narrative-stagnation-2026-04-30.md` (본 보고서)
- `scripts/audit_narrative_progression_stagnation.mjs` (audit script — raw 본문 미저장)
- `scripts/debug_episode_full_dump.mjs` (forensic dump — `.tmp/` 출력, 커밋 제외 예정)

---

## 2. 대상

```
book_id:           2f4bc632-0335-4e27-9340-2239e0c39953
title:             확률을 깨는 용사(확깨용)_TEST
episodes inspected: ep1～ep5 (각 1973~2693자)
traces inspected:   0 (run_traces 비어 있음 — qwen2.5:14b baseline_local로 enable_trace=false 생성)
snapshots inspected: 5 (episode_snapshots ep1~5 모두 존재)
foreshadows:        20건 (open 13, resolved 7)
arc_summaries:      0 (ARC_SIZE=10 미달)
character_dynamic_states: 20건 (4명 × 5화)
```

활성 route: `baseline_local` (planner=qwen2.5:14b, renderer=qwen2.5:14b, summary=gemma3:12b)

---

## 3. ep1～ep5 서사 요약

본문 전문은 미인용. 5～8줄 요약과 metric.

| ep | main_event | new_information | repeated_information | mana_absence_status | what_changed | char_emotion_delta | progression_score | stagnation_risk |
|---|---|---|---|---|---|---|---|---|
| 1 | 빅토리 이세계 도착 → 리아 만남 → 리아가 구슬로 마나 감지 → "마나 아예 없어?" 첫 의심 | 한국에서 옴, 마나 처음 듣는다, 구슬 무반응 | (없음 — 첫 화) | **discovered** (구슬 1차 검증) | 첫 화 — baseline 설정 | 4명 baseline 기록 | 0 (baseline) | LOW (정상) |
| 2 | 리아가 구슬 다시 꺼냄 → 찬트 룬으로 본격 스캔 시작 → "당신은 인간이 아니야?" | 찬트 룬 도구, "마나 그릇 자체가 없다" 표현 | "마나가 정말 없어요?" 또 묻기, 같은 검증 행위 변형 반복 | re-tested (찬트 룬 2차) | 위치 동일, 감정 동일, 검증 도구만 변경 | 4명 모두 동일 (불안/혼란/의심/경계) | 2 (location 변화 — '나무둥지' → '룬 시연 장면'으로 미세 이동) | MEDIUM |
| 3 | 찬트 룬 결과 통보 → "마나의 흔적이 전혀 없어. 그릇 자체가" → 학교 단어 노출 | "다른 세계 출신" 결론 명문화, 학교 단어 첫 등장 | 같은 결론을 또 듣고 또 충격 | **re-confirmed** (이미 ep2에서 결론) | recent_goal 단어 미세 변경, 위치/감정 동일 | 4명 모두 동일 | 1 (goal 단어만 변경) | HIGH |
| 4 | **다시 찬트 룬으로 스캔** → 동일 결과 → 메모 등장 → 마을 가자 | 메모(낡은 종이) 등장 | 같은 스캔 행위 또 반복, "마나 반응 전혀 없다" 또 통보 | **re-confirmed AGAIN** (3rd time) | recent_goal 미세 변경, 위치/감정 동일 | 4명 모두 동일 | 1 | **CRITICAL** |
| 5 | 메모 한국 거 → **에테르나 지팡이+찬트 룬 분석** → 카이렌+브론 본격 등장 | 메모 한국 출처, 카이렌·브론 정면 등장 | 또 스캔 행위, "왜 마나가 없는지" 또 질문 | still re-confirmed (4th time) | 위치 동일, 감정 4명 모두 미세 변경(결단/결의/긴장/신중) | 마침내 emo 변경 — 단 단어만 | 2 | HIGH |

**평균 progression score: 1.20 / 5** (자동 audit 산출). 정상 범위 ≥ 3.

**핵심 관찰**:
- ep1～5 모두 4명 전원이 같은 두 위치("이세계의 깊은 숲" / "이세계 숲 가장자리")에 있다. **5화 동안 이동 0회**.
- 핵심 검증 행위가 4번 반복 (ep1 구슬, ep2 찬트 룬, ep3 결과 통보, ep4 또 찬트 룬, ep5 또 + 지팡이).
- 32화 책 기준이면 ep5는 6.25% 지점 — 인트로 마무리 + 1차 갈등 전환 시점이어야 함. 실제로는 ep1의 발견을 4번 더 확인하는 데 그쳤다.

### 사양 §1 질문에 대한 답

| 질문 | 답 |
|---|---|
| ep1에서 "마나 없음"이 최초 발견됐는가? | YES (ep1 tail에서 구슬 검증으로 첫 발견) |
| ep2~ep5에서 새 정보처럼 반복되는가? | YES — ep2/ep3/ep4/ep5 모두 같은 사실을 다시 검증 또는 통보 |
| 반복될 때마다 새로운 의미/원인/대응/결과가 추가되는가? | NO. 도구만 변경(구슬→찬트 룬→찬트 룬→찬트 룬+지팡이). 결과는 모두 같음. 인물 대응 미진전. |
| 표현만 바뀌고 정보는 반복되는가? | YES. "마나가 없어" / "흔적이 전혀 없어" / "그릇 자체가 없어" — 표현 셋, 정보 하나 |
| 인물들이 그 사실을 기억하고 다음 행동으로 넘어가는가? | NO. ep4/ep5에서도 같은 충격 반응 + 같은 검증 시도 |
| 매 화 다시 놀라는가? | YES — ep3에서 "있을 수 없어", ep4에서 "이상해요", ep5에서 또 분석 시도 |

---

## 4. "마나 없음" 반복 분석

### 4.1 처음 확정된 시점

ep1 tail. 리아의 마나 감지 구슬이 빅토리 주변을 돌지만 무반응 → "마나가 정말 없어?" 의심. 직접 인용은 미보고. 이 시점에 **본문상 1차 결정**.

### 4.2 반복된 방식 (ep × 매개)

| ep | 검증 도구 | 통보 표현 | "처음 알게 된 듯한" 반응 |
|---|---|---|---|
| 1 | 마나 감지 구슬 | "마나가 정말 없어?" | 리아: 처음 — 정상 |
| 2 | 마나 감지 구슬 (재시도) → 찬트 룬 도입 | "마나가 정말 아예 없어요?" | 리아: 또 처음처럼 충격 |
| 3 | 찬트 룬 결과 | "마나의 흔적이 전혀 없어. 그릇 자체가..." "당신은 인간이 아니야?" | 리아: "이건... 있을 수 없어" |
| 4 | 찬트 룬 (또 한 번) | "마나 반응이 전혀 없어요" | 리아: "이상해요" + 빅토리 본인도 또 의아함 |
| 5 | 에테르나 지팡이 + 찬트 룬 — "마력도관 - 분석" | "왜 마나가 없는지..." | 리아·빅토리 둘 다 또 분석 |

**매 화 새 검증 도구를 동원하지만, 결론은 항상 같다 + 인물 반응은 항상 "처음 듣는 듯"**. 이건 "ep4에서 ep1을 처음 알게 하지 말 것" 같은 추상적 금지 instruction(must_not_repeat)이 있어도 **"마나 없음 사실 자체가 도메인-specific 모티프로 차단되지 않기 때문**.

### 4.3 prompt/context에서 어떻게 재주입됐나 (snapshot evidence)

[scripts/audit_narrative_progression_stagnation.mjs](scripts/audit_narrative_progression_stagnation.mjs) 결과 기준:

| ep | rs_len | fs_mem | k_facts | open_threads | open_mana |
|---|---|---|---|---|---|
| 1 | 0 | 4 (default 1) | 0 | 0 | 0 |
| 2 | 32 | 4 (mana 1) | 4 (mana 1) | 4 (mana 1) | 1 |
| 3 | 81 | 4 (mana 1) | 4 (mana 1) | 4 (mana 1) | 1 |
| 4 | 121 | **7 (mana 4)** | 4 (mana 1) | **7 (mana 4)** | **4** |
| 5 | 172 | 7 (mana 3) | 4 (mana 2) | **7 (mana 3)** | **3** |

**ep4 생성 시점**: planner는 prompt의 [열린 플롯] 섹션에서 "마나 관련 미해결 thread 4건"을 봄. 그 중 어떤 것도 ep1～3 동안 resolved 처리 안 됨. continuity_contract 생성 로직(`getOpenForeshadows`)은 status='open'인 모든 복선을 그대로 [열린 플롯]에 넣는다. 결과: planner가 "마나 thread 4건이 아직 미해결이니 이번 화에서 1～2개 이어가라"는 instruction을 받아 → 또 검증 행위 짠다.

**ep5 생성 시점**: emotional_progression_requirements 4건이 처음으로 prompt에 들어감 ("리아 4화 동안 불안 정체 — 결정/행동/관계 변화/새 정보/대가 중 하나 발생시켜라"). ep5 본문에 4명 감정 단어 미세 변경(결단/결의/긴장/신중) — instruction이 일부 작동했지만 **본문상의 행동 변화는 여전히 "또 분석"**. 즉 prompt instruction은 너무 늦게 + 너무 약하게 들어왔다.

---

## 5. 이전 화 참조 구조

### 5.1 직전 화 참조 메커니즘 (실측)

| 메커니즘 | source | 분량 | 실제 ep5 값 | 결함 |
|---|---|---|---|---|
| `prev_episode_tail` | episodes.content (직전 화) tail 900자 | ~900자 | ep4 마지막 900자 | 정상 — 단 직전 화 끝만 보여주므로 ep1~3의 결정 사실 미포함 |
| `rolling_summary` | episodes.summary 역순 LIMIT 5 | ep1~4 합쳐 172자 | "1화: # 1화 - 낯선 숲에서\n\n알 수 없는 숲 가장자리\n2화: ..." | **CRITICAL** — fallback first-sentence이라 핵심 사실 0건 |
| `arc_summaries` | arc_summaries 테이블 | 0건 | 빈 배열 | ARC_SIZE=10 미만이라 단편 케이스 무대응 |
| `character_arcs` | character_arcs 테이블 | 0건 | 빈 객체 | 위와 동일 — arc_summary와 같이 생성됨 |
| `continuity_contract.known_facts` | character_arcs.key_events + recent_goal | 4건 | 4명 recent_goal만 | character_arcs 비어있어서 fallback인 recent_goal만 |
| `continuity_contract.open_threads` | foreshadows 테이블 status='open' | 7건 | 그 중 3건이 "마나 없음" 다른 표현 | **CRITICAL** — 같은 사실의 다중 plant |
| `episode_delta_contract.previous_episode_facts` | character_arcs.key_events fallback rolling_summary | 거의 빈약 | rolling_summary line 정도 | character_arcs 의존이라 단편에서 무력 |
| `episode_delta_contract.repetition_risk` | rolling_summary + prev_tail에서 정규식 | 1건 ("혼란/혼수") | 일반 키워드만 차단 | 도메인-specific 모티프(마나 검증) detect 못함 |
| `emotional_progression_requirements` | 최근 8화 dynamic_states streak ≥4 | 4건 | ep5 첫 발동 | streak trigger 너무 늦음 (ep1~4 동안 정체 방치) |

### 5.2 사양 §2 질문에 대한 답

| 질문 | 답 |
|---|---|
| 1. ep3 생성 시 ep1의 상세 사실이 들어가는가? | **부분만**. rolling_summary에 ep1 첫 문장(40자), prev_tail에 ep2 마지막 900자. ep1의 마나 검증 결과는 어디에도 없음. |
| 2. ep4 생성 시 ep1~ep3의 핵심 확정 사실이 들어가는가? | **NO**. rolling_summary는 첫 문장 누적(80자). character_arcs 비어있음. atomic confirmed fact 0건. |
| 3. "마나 없음"이 established_fact로 들어가는가, unresolved_problem으로 들어가는가? | **unresolved_problem**으로 들어간다 (foreshadow open_thread 4건). established fact 개념 자체가 시스템에 없음. |
| 4. rolling_summary가 "마나 없음"을 계속 현재 문제로 요약하는가? | rolling_summary는 사실상 빈 (첫 문장만). "마나 없음"을 명시 요약하지조차 못한다. |
| 5. episode_delta_contract가 "이제 이 사실을 넘어서라"를 요구하는가? | 약함. "이미 발생한 만남·고백 반복 금지" 같은 일반 instruction은 있지만, "ep1에서 확정된 마나 부재 사실은 검증 행위로 또 다루지 말 것" 같은 도메인-specific instruction은 자동 생성 안 됨. |
| 6. open foreshadow가 "마나 없음"을 계속 미해결로 남기는가? | **YES — 직격탄**. ep1, ep2, ep3, ep4, ep5에서 모두 마나 관련 새 foreshadow를 plant. 5화 누적 후 open 5건. |
| 7. previous_episode_tail이 너무 강해서 직전 정서만 반복하는가? | 부분적으로 YES — 900자가 prompt에 들어가 직전 분위기 anchor가 됨. 단, planner는 이 외에도 contract들을 보므로 단독 원인은 아님. |
| 8. 요약이 너무 압축되어 인물의 학습/대응/결정이 사라지는가? | **YES — 압축이 아니라 fallback이라서 압축조차 안 됨**. summary가 첫 문장만이라 학습/대응/결정이 처음부터 캡처되지 않음. |

### 5.3 사용자 가설 검증

| 사용자 가설 | 실측 | 평가 |
|---|---|---|
| 직전 텍스트 전체만 참조 → 멀리 떨어진 화끼리 중복 | 직전 tail 900자 + rolling_summary는 첫 문장 누적. 멀리 떨어진 화의 결정 사실은 어느 쪽에도 없음. | **부분 정답**. tail이 너무 강한 게 아니라, 이전 화들의 결정이 어디에도 보존되지 않음이 본질. |
| 요약만 참조 → 이미 진행된 세부 내용 사라짐 → 같은 문제 반복 | summary fallback 100%. 핵심 결론 기록 0건. | **★ 핵심 정답** |

---

## 6. 인물 감정 상태 정체 분석

### 6.1 4명 × 5화 emotion / recent_goal 변화

| character | ep1 emotion | ep2 | ep3 | ep4 | ep5 | streak | recent_goal 핵심 |
|---|---|---|---|---|---|---|---|
| 리아 | 불안 | 불안 | 불안 | 불안 | **결단** | 4 | "빅토리 정체 확인 + 마나 없는 원인 찾기" 4화 동일 |
| 브론 | 경계 | 경계 | 경계 | 경계 | **신중** | 4 | "리아 보호 + 잠재 위험 대비" 5화 동일 |
| 빅토리 | 혼란 | 혼란 | 혼란 | 혼란 | **결의** | 4 | "어떻게 왔는지 알아내기" 4화 변형 동일 |
| 카이렌 | 의심 | 의심 | 의심 | 의심 | **긴장** | 4 | "은밀히 추적" 5화 동일 |

### 6.2 사양 §4 질문에 대한 답

| 질문 | 답 |
|---|---|
| 1. 같은 emotional_state가 반복되는가? | YES — 4명 전원 streak 4 |
| 2. 본문에서는 변화가 있는데 extractor가 못 잡는가? | **부분**. 본문에서도 ep1～4에 인물 행동이 거의 정적 (대화 + 검증 + 다시 놀람). ep5에서야 카이렌 등장 본격화 등 약한 변화. extractor는 본문에 충실. |
| 3. extractor가 잡았는데 normalizer가 압축하는가? | NO — emotional_state는 본문에 짧은 단어만 사용 (불안/혼란/의심/경계). normalizer가 압축할 여지 자체가 없음. |
| 4. recent_goal이 같아서 planner가 같은 행동 반복하는가? | **YES — 직격탄**. ep5 cc.known_facts 4건이 모두 정체된 recent_goal. planner는 [이미 알려진 사실]에서 정체된 goal을 보고 → 그 goal을 진전시키는 같은 행동(검증)을 또 짠다. |
| 5. appeared_in_episode 필터 때문에 visible char만 보이지만 internal state는 고착되어 있는가? | 부분. ep1~3에서 카이렌·브론은 거의 등장 안 함. 그래도 dyn_state는 매 화 carry-forward로 update — visible 여부와 무관하게 state stagnation 발생. |

### 6.3 평가

- **extractor/normalizer/UI 어느 한 곳의 문제가 아니다.** 본문 자체가 정체 → state도 정체 → planner도 정체 — **순환 고리**.
- emotional_progression_requirements가 ep5에 발동하면서 단어 변경은 일어났지만(결단/결의/긴장/신중), **본문 행동 차원의 변화는 부족** (ep5에서도 또 스캔, 또 분석).

---

## 7. Root Cause 분류 (후보 A～H)

### 후보 A — Established Fact / Open Problem 분리 실패

```
가능성: HIGH
evidence:
  - 시스템에 established_fact 개념 자체가 없음. continuity_contract.known_facts는 사실상 인물 recent_goal 모음.
  - "ep1 tail에서 마나 부재 1차 확인" → ep2/3/4/5에서 모두 unresolved_problem으로 처리.
  - 본문에서도 ep3에서 결론이 났지만, ep4·ep5가 "다시 검증" 시작.
관련 파일/함수:
  - src/services/effective_context.ts: buildContinuityContract
  - src/services/foreshadow.ts: getOpenForeshadows / extractAndStoreForeshadow
  - src/types/canonical.ts: ContinuityContract.known_facts (별도 confirmed_facts 필드 부재)
관련 DB field:
  - foreshadows.status (open/resolved 이분만 있음 — discovered/tested/explained/adapted_to/resolved 같은 lifecycle 부재)
  - episodes.summary (LLM 요약 부재)
수정 방향: 제안 1, 제안 2.
```

### 후보 B — Rolling Summary 과압축 (실은 fallback)

```
가능성: HIGH
evidence:
  - audit fallback_summary_ratio = 100%. summary 평균 39자. LLM 요약 정상치는 200~400자.
  - rolling_summary 4화 누적 172자 = ep1~4 첫 문장만.
  - generate.ts:234 / generate_v2.ts:183: const fallbackSummary = clean.split(/[.。!?]/)[0]?.trim() ?? "";
  - generate.ts:239 ON CONFLICT 절: summary = CASE WHEN episodes.summary IS NULL OR '' THEN EXCLUDED ELSE episodes.summary END
    → 첫 저장 후 영원히 fallback으로 fix됨.
  - episodes.ts에 summary_writer LLM 호출 경로 있지만, FE 정상 생성 흐름은 거기를 거치지 않음.
관련 파일/함수:
  - src/api/generate.ts:228-241  (자동 저장 경로)
  - src/api/generate_v2.ts:181-194 (자동 저장 경로)
  - src/api/episodes.ts:35-65    (제대로 된 summary_writer 호출 — 사용 안 됨)
관련 DB field:
  - episodes.summary
수정 방향: 제안 1.
```

### 후보 C — Episode Delta Contract 약함

```
가능성: HIGH
evidence:
  - ep5 dc.must_progress 6건: 인물 goal 진전 등 일반 instruction. "이번 화에서 마나 검증 행위 금지" 없음 (도메인-specific 차단 불가).
  - dc.repetition_risk REPEAT_PATTERNS는 일반 키워드(기절/혼란/균열)만. "검증 행위 반복" 같은 추상 패턴 detect 못함.
  - ep5에서야 처음 emotional_progression_requirements 4건 — 이미 4화 정체된 후.
  - dc.previous_episode_facts: character_arcs.key_events fallback rolling_summary. character_arcs 비어 있고 rolling_summary fallback이라 빈약.
관련 파일/함수:
  - src/services/effective_context.ts: buildEpisodeDeltaContract (612-)
  - src/services/effective_context.ts: REPEAT_PATTERNS (653-661)
  - src/services/effective_context.ts: STREAK_TRIGGER=4 (519)
관련 DB field:
  - 없음 — 모두 in-memory 계산
수정 방향: 제안 3, 제안 4.
```

### 후보 D — Foreshadow / Open Thread 오남용 (★ 가장 강한 직격탄)

```
가능성: HIGH (★ 단독으로도 정체 충분 유발)
evidence:
  - foreshadow_memory mana count: ep1=1, ep2=1, ep3=1, ep4=4, ep5=3.
  - ep4 open_thread 7건 중 4건이 "마나 없음" 다른 표현. ep5도 7건 중 3건이 마나.
  - 매 화 마나 관련 새 foreshadow를 plant (ep1: d4224e33, ep2: 7916aeb0, ep3: 1169fad9, ep4: c0217d0a, ep5: edb09508). 같은 사실의 5중 plant.
  - 각 plant는 표현이 살짝 다르지만(`마나를 사용하지 못한다`, `마나가 전혀 없는 상태로 이 세계에 나타난`, `마나가 전혀 없는 존재`) 모두 같은 한 가지 사실을 가리킴.
  - planner [열린 플롯] 섹션은 open_thread를 그대로 넣음 → "이번 화에서 1~2개 이어간다" instruction → 또 마나 검증.
  - foreshadow extractor LLM이 "이미 plant된 사실을 또 plant 안 한다"는 dedup 로직 없음.
관련 파일/함수:
  - src/services/foreshadow.ts: extractAndStoreForeshadow / getOpenForeshadows
  - src/pipeline/planner.ts:531 [미회수 복선] 섹션
  - src/services/effective_context.ts: continuity_contract.open_threads
관련 DB field:
  - foreshadows: 같은 사실 다중 row (status='open')
  - 부재 필드: parent_foreshadow_id 또는 lifecycle_stage
수정 방향: 제안 2, 제안 5.
```

### 후보 E — Character State 감정/목표 고착

```
가능성: HIGH
evidence:
  - 4명 전원 emotion streak = 4.
  - recent_goal 4화 사실상 동일 (단어만 미세 변경).
  - planner.ts schema (line 322): "items는 항상 출력... 변화 없는 다른 필드(location, physical_state 등)는 생략 가능" — emotional_state도 사실상 생략 허용.
  - pipeline/index.ts:667-679: silent carry-forward — planner가 생략하면 prev 값 그대로.
  - state extractor 결정: opening_location = primaryDyn.location → 정체된 prev location → 다음 화도 같은 곳에서 시작.
관련 파일/함수:
  - src/pipeline/planner.ts:281-339 (planner system prompt)
  - src/pipeline/index.ts:656-684  (commitDynamicState carry-forward)
  - src/pipeline/state_extractor.ts:120-124 (opening_location)
관련 DB field:
  - character_dynamic_states: emotional_state, recent_goal, location
수정 방향: 제안 4.
```

### 후보 F — Planner Beat 다양성 부족

```
가능성: MEDIUM
evidence:
  - 5화 모두 같은 beat 구조 (도착/만남 → 검증 시도 → 결과 통보 → 새 의문).
  - planner.ts:314-318에 "낯선 환경 등장/각성 → 첫 만남 → 외부 위협 3단 공식 사용 안 함" 같은 구조적 변주 instruction은 있음.
  - 하지만 "검증/통보 패턴" 같은 도메인 패턴 차단은 없음.
  - hook_type rotation 있지만 (planner.ts:534-540), beat 자체의 행동 유형 (조사/대화/이동/결정/충돌) 분포 강제는 없음.
관련 파일/함수:
  - src/pipeline/planner.ts:281-339 (system prompt)
  - src/pipeline/planner.ts:534-540 (hook 다양성)
관련 DB field:
  - 없음
수정 방향: 제안 3 (보강).
```

### 후보 G — World Rule / Absolute Rule 과지배

```
가능성: MEDIUM
evidence:
  - absolute_forbidden 3건 중 1건: "대한민국에서 평범한 생활을 하던 빅토리가 어느날 갑자기 이세계로 전이하면서 이야기가 전개된다"
    → 이건 setup이지만 절대 규칙으로 박혀있음. 매 화 prompt에 노출.
  - general_rules 4건 중 3건이 마나/이세계 관련. 매 화 [세계관 규칙] 섹션에 노출.
  - 이 자체로 정체 강제하지는 않지만, "마나 없음 사건"의 무게를 매 화 강화하는 보조 효과.
관련 파일/함수:
  - src/services/effective_context.ts: legacyWorldBible.forbidden_settings → absolute_forbidden 흡수 (153-154)
  - src/pipeline/planner.ts:452-458 [절대 규칙] 섹션
관련 DB field:
  - world_rules.rule_type='absolute_forbidden'
  - books.context.forbidden_settings (legacy)
수정 방향: 제안 2 보강 (rule lifecycle — setup vs ongoing constraint 분리).
```

### 후보 H — Prompt Overconstraint

```
가능성: LOW～MEDIUM
evidence:
  - ep5 prompt 추정 size: 절대 규칙 3 + 이번 화 제약 + 인물 현재 상태 + 직전 화 여파 + continuity contract 6 sub-section + episode delta contract + 직전 화 말미 900자 + 스토리 흐름 + ...
  - must_not_repeat 9건 + forbidden_regressions 5건 + emotional_progression_requirements 4건 = 부정형 18건 누적.
  - LLM이 "안전한 반복" 으로 회귀하는 가능성은 있지만, baseline_local qwen2.5:14b의 일반 안전 회귀가 정체의 주 원인이라는 직접 증거는 없음.
  - high_quality_ensemble 모델로 같은 prompt를 주면 다른 결과가 나올 가능성은 미검증.
관련 파일/함수:
  - src/pipeline/planner.ts: buildPlannerUserPrompt 전체
관련 DB field:
  - 없음
수정 방향: 우선순위 낮음. 다른 후보 fix 후 재평가.
```

### 종합 가능성 정리

| 후보 | 설명 | 가능성 | 단독 영향 |
|---|---|---|---|
| A | Established Fact 분리 실패 | **HIGH** | ★ 직격 |
| B | Rolling Summary 과압축 (fallback) | **HIGH** | ★★ 가장 큰 직격 |
| C | Episode Delta Contract 약함 | HIGH | 중 |
| D | Foreshadow 오남용 | **HIGH** | ★★ 가장 큰 직격 (단독으로도 정체 충분) |
| E | Character State 고착 | HIGH | 중 |
| F | Planner Beat 다양성 부족 | MEDIUM | 약 |
| G | World Rule 과지배 | MEDIUM | 약 (보조) |
| H | Prompt Overconstraint | LOW~MEDIUM | 미상 |

**가장 큰 단일 원인 두 개**: B (summary fallback) + D (foreshadow 다중 plant). 이 둘은 독립적으로 작동하며 각각 단독으로도 정체를 유발한다. 둘 다 fix 안 하면 다른 4개를 fix해도 효과 제한.

---

## 8. 해결 제안 5가지

각 제안: 책/장르/도메인 무관 범용 구조. 하드코딩 ("마나" 키워드 차단 등) 절대 금지.

### 제안 1 — Episode Summary Pipeline Repair (★ 즉시 실행 권장)

**무엇을:**
`/api/generate`와 `/api/generate-v2`의 episodes 저장 경로를 수정해 `summary_writer` LLM 호출이 실제로 작동하게 한다. ON CONFLICT 정책을 "fallback marker가 있는 summary는 LLM 결과로 덮어쓰기 허용"으로 변경.

**효과:**
- rolling_summary 정보 밀도 5～10배 증가 (39자 평균 → 200~400자 LLM 요약).
- continuity_contract.known_facts 의 fallback source인 rolling_summary가 진짜 사실을 담게 됨.
- 후보 B 직격, 후보 A·C·D·E의 second-order 효과 보강.

**수정 파일:**
- `src/api/generate.ts:228-246`, `src/api/generate_v2.ts:181-194` — 저장 후 비동기 summary_writer 호출 + UPDATE.
- `src/services/episode_summary.ts` (신규) — `api/episodes.ts:35-65`의 인라인 코드 추출.
- ON CONFLICT 정책: summary fallback marker 도입 (예: `[FALLBACK]` prefix 또는 별도 컬럼 `summary_kind ∈ {fallback, llm}`).

**위험도:**
- LOW. 비동기 fire-and-forget이라 사용자 latency 영향 0. summary_writer가 실패해도 fallback이 유지됨.
- ON CONFLICT 정책 변경: 기존 LLM-summary가 있는 책에 영향 없도록 "fallback일 때만 덮어쓰기" 명시.

**DB migration 필요:**
- `summary_kind` 컬럼 추가 권장 (기본값 'fallback'). 또는 prefix marker (migration 없음). 후자 권장.

**구현 난이도:**
- 작음 (helper 분리 + 호출 추가 + ON CONFLICT 절 한 줄 수정). 0.5～1일.

**검증 방법:**
- `verify_summary_writer_invocation.mjs` 신규 — 새 episode 저장 후 summary len > 100자 인지 확인.
- audit script 재실행 후 `fallback_summary_ratio` 100% → ≤ 20% 확인.

---

### 제안 2 — Open Problem Lifecycle (Foreshadow Dedup + Stage)

**무엇을:**
foreshadow에 lifecycle stage 도입: `discovered → investigating → confirmed → adapted_to → resolved`. 또한 새 foreshadow plant 시 기존 open foreshadow의 keyword set과 비교해 **동일 모티프면 새 plant 거부 + 기존 stage 진전**.

**효과:**
- "마나 없음 5중 plant" 같은 패턴이 구조적으로 차단됨.
- planner [열린 플롯] 섹션이 같은 사실 중복 노출 안 함.
- 후보 A·D 직격.

**수정 파일:**
- `src/db/migrate_v7.ts` (신규) — foreshadows에 `lifecycle_stage`, `parent_foreshadow_id` 컬럼.
- `src/services/foreshadow.ts:extractAndStoreForeshadow` — plant 전 dedup check (keyword Jaccard ≥ 0.6 또는 LLM judge).
- `src/services/effective_context.ts:getOpenForeshadows` — `confirmed`/`adapted_to`는 [확정 사실] 섹션으로 이동, `discovered`/`investigating`만 [열린 플롯]에 표시.
- `src/pipeline/planner.ts` — system prompt에 "[확정 사실]은 발견 행위 반복 금지, 그 사실 위에 쌓이는 새 행동만" 라인 추가.

**위험도:**
- MEDIUM. dedup LLM judge가 잘못 작동하면 진짜 새 복선이 거부될 수 있음 → keyword Jaccard threshold 보수적 (≥ 0.6) 시작.
- migration 필요.

**DB migration 필요:**
- YES — foreshadows 테이블 컬럼 2개 추가. 기존 row는 status='open'→stage='discovered', status='resolved'→stage='resolved'.

**구현 난이도:**
- 중간. 1~2일.

**검증 방법:**
- `verify_foreshadow_dedup.mjs` 신규 — 같은 keyword set 2회 plant 시 1회만 저장됨 확인.
- audit 재실행 후 foreshadow recurring keyword count 7회 → ≤ 2회 확인.

---

### 제안 3 — Episode Progression Contract V2

**무엇을:**
`buildEpisodeDeltaContract`에 두 개 강화:
1. **must_advance_from**: 최근 N화의 confirmed_facts 리스트를 prompt에 명시 + "이 사실들은 발견 행위로 다시 다루지 말 것. 그 사실의 결과로 인한 새 선택/대가/관계만 서술."
2. **scene_role_distribution**: 직전 3화의 beat 행동 유형(조사/대화/이동/결정/충돌)을 누적 추적 → 같은 행동 유형이 3화 연속이면 다른 유형 강제.

**효과:**
- "ep1에서 결정된 사실을 ep5에서 또 검증" 패턴이 prompt-level에서 차단.
- 후보 C 직격, 후보 F 보강.

**수정 파일:**
- `src/services/effective_context.ts:buildEpisodeDeltaContract` — must_advance_from 추가.
- `src/types/canonical.ts:EpisodeDeltaContract` — 타입 확장.
- `src/pipeline/planner.ts:654-720` (delta section) — must_advance_from 섹션 prompt 추가.
- `src/services/scene_role_tracker.ts` (신규) — beat 행동 유형 분석 + 누적.

**위험도:**
- LOW. 추가 instruction이라 기존 동작 영향 적음.
- 단, scene_role_distribution이 너무 강하면 자연스러운 흐름 방해 가능 — 권고 수준으로 시작.

**DB migration 필요:**
- 선택. scene_role_distribution 누적은 episode_snapshots에 사후 분석으로 가능.

**구현 난이도:**
- 작음~중간. 1일.

**검증 방법:**
- `verify_must_advance_from_injection.mjs` — confirmed_facts ≥ 3개일 때 prompt에 [확정 사실] 섹션이 들어감 확인.
- audit 재실행 후 progression score 1.20 → ≥ 2.5 확인.

---

### 제안 4 — Character Emotion/Goal Delta Strict Mode + Streak Trigger 조정

**무엇을:**
1. `STREAK_TRIGGER` 4 → 2로 (`effective_context.ts:519`). recentHistory 조회 ep>=4 → ep>=2 (`:104`).
2. planner system prompt에서 "변화 없으면 생략 가능"을 emotional_state/recent_goal 한정으로 폐기. **반드시 매 화 emit, prev와 동일 시 explicit reason 필수**.
3. commitDynamicState에 audit 카운터: planner output이 prev와 동일하면 `state_stagnation_warning` 로그 + run_traces에 기록.

**효과:**
- ep2부터 즉시 정체 감지 가능.
- silent carry-forward 무력화.
- 후보 E 직격.

**수정 파일:**
- `src/services/effective_context.ts:104, 519` (상수 2개)
- `src/pipeline/planner.ts:281-339` (schema instruction)
- `src/pipeline/index.ts:667-684` (audit 추가)

**위험도:**
- MEDIUM. trigger=2가 너무 자주 발동하면 부자연스런 변화 강요. 완화: instruction은 "감정 단어가 아니라 행동/결정/관계 변화 OK"이므로 본문에는 자연스러운 진전만 강제.

**DB migration 필요:**
- NO.

**구현 난이도:**
- 작음. 0.5일.

**검증 방법:**
- `verify_state_progression_required.mjs` — prev와 동일한 emotional_state/recent_goal이 commit되면 warn 카운터 증가 확인.
- audit 재실행 후 emotion streak ≥ 4 → ≤ 2 확인.

---

### 제안 5 — Confirmed Facts Ledger (Atomic 단위)

**무엇을:**
새 테이블 `episode_confirmed_facts(book_id, episode_number, fact_kind, fact_content, source_episode, created_at)`. fact_kind ∈ `discovery`, `commitment`, `relationship_shift`, `decision`, `reveal`, `commitment_break`. 매 화 종료 후 LLM call(별도 task `fact_extractor`)로 **이번 화 atomic 결정/발견** 추출. 다음 화 effective_context에 `confirmed_facts: string[]`로 주입.

**효과:**
- rolling_summary와 별개로 "이미 확정된 사실"만 정밀 트래킹. 핵심 결론이 무조건 보존.
- planner [확정 사실 — 재발견 금지] 섹션을 명시 source로 받게 됨.
- 후보 A 정공법, B/C/D 보강.

**수정 파일:**
- `src/db/migrate_v7.ts` (신규) — confirmed_facts 테이블.
- `src/services/confirmed_facts.ts` (신규) — extractor + getter.
- `src/services/effective_context.ts:275-297` — ctx에 `confirmed_facts: string[]` 추가.
- `src/pipeline/planner.ts` — [확정 사실] 섹션 추가.
- `src/api/generate.ts`, `generate_v2.ts` — 저장 후 비동기 fact_extractor 호출.
- `src/services/llm_tasks.ts` — `fact_extractor` task 등록.

**위험도:**
- MEDIUM. extractor LLM 정확도가 핵심 — 잘못 추출 시 거짓 사실이 confirmed로 박힘. 완화: planner의 character_state_updates에서 명시한 사실만 confirmed로 승격하는 옵션도 고려.
- prompt budget 압박: 100화에서 누적 50~100건 → 슬라이딩 윈도우 필요 (최근 5~10화).

**DB migration 필요:**
- YES — 새 테이블.

**구현 난이도:**
- 큼. 2~3일.

**검증 방법:**
- `verify_confirmed_facts_extraction.mjs` — 5화 책 기준 fact ≥ 5건 추출 확인.
- audit 재실행 후 ep4·ep5 prompt에 confirmed_facts 섹션이 들어가고, 같은 사실 재발견이 본문에서 발생 안 함 확인.

---

### 추가 후보 제안 (보너스)

| 보너스 제안 | 핵심 | 우선순위 |
|---|---|---|
| **repetition budget**: 같은 motif가 N화 연속 등장하면 다음 화 prompt에 "이 motif 휴지" 강제 | 정체 모티프 자동 감지 | 중 |
| **issue cooldown**: foreshadow가 confirmed→cooldown 기간 동안 [열린 플롯] 미노출 | 같은 issue 연쇄 plant 방지 | 높음 (제안 2와 통합 가능) |
| **diagnostic scene cap**: "같은 도구·같은 인물·같은 결과"의 검증 장면이 N회 연속이면 차단 | 후보 D/F 보강 | 중 |
| **plot milestone ledger**: 각 화에 도달해야 할 plot phase milestone 명시 | progression 강제 | 중 |
| **scene role diversity**: beat 행동 유형 분포 강제 | 후보 F 직격 (제안 3에 부분 포함) | 낮 |

---

### 우선순위 정리

| 순위 | 제안 | 효과 | 비용 | 위험 |
|---|---|---|---|---|
| 1 | 제안 1 (summary pipeline repair) | ★★★★★ | 작음 (0.5~1일) | LOW |
| 2 | 제안 2 (foreshadow lifecycle) | ★★★★★ | 중 (1~2일) | MEDIUM |
| 3 | 제안 4 (state delta strict + streak 2) | ★★★ | 작음 (0.5일) | MEDIUM |
| 4 | 제안 3 (episode progression V2) | ★★★ | 중 (1일) | LOW |
| 5 | 제안 5 (confirmed facts ledger) | ★★★★ | 큼 (2~3일) | MEDIUM |

---

## 9. 다음 단계 추천

### 즉시 구현할 것 (Phase R5B-1 — Triage Hotfix, 1.5일)

1. **제안 1** (summary pipeline repair) — root cause 직격, 위험 낮음.
2. **제안 4** (state delta strict + streak 2) — 작은 변경, 즉시 효과.

이 두 개로 ep1~10 정체 50% 이상 완화 기대. R5A-D 30화 canary 진입 전 필수.

### 중기 구현 (Phase R5B-2 — Architecture, 3~4일)

3. **제안 2** (foreshadow lifecycle) — D 직격, foreshadow 다중 plant 차단.
4. **제안 3** (episode progression V2) — must_advance_from 명시.

이 둘은 R5B-1 효과 측정 후 진입. R5A-D 30화 canary 결과를 baseline으로 활용 가능.

### 장기 구현 (Phase R5C — Memory Architecture, 1주)

5. **제안 5** (confirmed facts ledger) — 정공법. 100화 actual 전 도입 권장.

### 보류할 것

- 후보 G (world rule 과지배): R5B-1 효과 측정 후 재평가. 단독 fix 우선순위 낮음.
- 후보 H (prompt overconstraint): 다른 fix 후 재평가.

### 30화 canary 진행 가능 여부

**현재 상태로 진행 시 위험**:
- 5화에서 이미 정체 발현 → 30화에서는 "마나 없음" 모티프가 더 강하게 굳을 가능성 매우 높음.
- summary fallback이 100% → known_facts 부재 → planner가 이미 결정된 사실을 모름 → 같은 검증 행위 반복 → progression score 정체 누적.
- HQE 모델로 바꿔도 데이터 파이프라인 결함은 그대로. 모델 차이로 흐릿하게 가려질 수는 있지만 root cause 미해결.

**권장 순서**:
1. R5B-1 (제안 1+4) 구현·verify 통과 (1.5일).
2. 확깨용_TEST 동일 책으로 ep6~10 추가 생성 후 audit 재실행 — 정체 완화 확인.
3. 또는 새 clean book 5~10화로 audit baseline 확립.
4. progression score 평균 ≥ 2.5 + emotion streak ≤ 2 + summary fallback ≤ 20% 만족 시 R5A-D 30화 canary 진입.

---

## Appendix A — 사용된 도구/데이터 location

- Forensic raw dump: `.tmp/forensic/hwakkae_ep1-5.json` (gitignored)
- Audit script: `scripts/audit_narrative_progression_stagnation.mjs` (read-only, raw 본문 미저장)
- Diagnostic helpers: `scripts/debug_episode_full_dump.mjs`, `scripts/debug_episode_titles.mjs`, `scripts/debug_ep_summary.mjs`

## Appendix B — 핵심 코드 참조 정리

| 결함 | 위치 |
|---|---|
| Summary fallback (B) | [generate.ts:228-241](src/api/generate.ts#L228-L241), [generate_v2.ts:181-194](src/api/generate_v2.ts#L181-L194) |
| Summary 보호 (B') | [generate.ts:239](src/api/generate.ts#L239) ON CONFLICT 절 |
| LLM-summary 미사용 경로 (B'') | [episodes.ts:35-65](src/api/episodes.ts#L35-L65) |
| Rolling summary 조회 (B''') | [effective_context.ts:97-99](src/services/effective_context.ts#L97-L99) |
| Foreshadow open_thread 누적 (D) | [effective_context.ts:463](src/services/effective_context.ts#L463) `getOpenForeshadows` 결과 그대로 사용 |
| Foreshadow extractor dedup 부재 (D) | [src/services/foreshadow.ts](src/services/foreshadow.ts) `extractAndStoreForeshadow` |
| ARC_SIZE=10 (B/C/D 보강 fallback) | [episodes.ts:96](src/api/episodes.ts#L96) |
| character_arcs 기반 known_facts (A/C) | [effective_context.ts:439-445](src/services/effective_context.ts#L439-L445) |
| Planner schema "생략 허용" (E) | [planner.ts:322](src/pipeline/planner.ts#L322) |
| Silent carry-forward (E) | [index.ts:667-679](src/pipeline/index.ts#L667-L679) |
| opening_location = primaryDyn.location (E) | [state_extractor.ts:120-124](src/pipeline/state_extractor.ts#L120-L124) |
| STREAK_TRIGGER=4 (E) | [effective_context.ts:519](src/services/effective_context.ts#L519) |
| REPEAT_PATTERNS 일반 키워드만 (C/F) | [effective_context.ts:653-661](src/services/effective_context.ts#L653-L661) |

## Appendix C — 사양 Section 매핑

| 사양 섹션 | 보고서 위치 |
|---|---|
| 사양 §1 (DB 1~5화 확인) | §3 |
| 사양 §2 (이전 화 참조 분석) | §5 |
| 사양 §3 (후보 A~H 분류) | §7 |
| 사양 §4 (감정 정체) | §6 |
| 사양 §5 (서사 전진성) | §3 (progression score) |
| 사양 §6 (해결 5가지) | §8 |
| 사양 §7 (구현 금지) | 준수 (코드 변경 없음) |
| 사양 §8 (산출물) | docs/forensic-narrative-stagnation-2026-04-30.md + scripts/audit_narrative_progression_stagnation.mjs |
| 사양 §9 (보고 형식) | 9-section 준수 + 마지막 verdict 줄 |

---

```
Narrative stagnation verdict: NOT READY
30화 canary 진행 가능 여부: NO (CONDITIONAL — R5B-1 hotfix 후 진입)
추천 다음 구현 Phase: R5B-1 — Narrative Stagnation Triage Hotfix
근거: ep1~5 audit 결과 STAGNATION FLAGS 5개 동시 발현 (summary fallback 100%, emotion streak 4, foreshadow 모티프 5중 plant, progression score 1.20, character_arcs 0건). 가장 큰 단일 원인 두 개(B-summary fallback과 D-foreshadow 다중 plant)는 모델 변경(HQE)으로 가려지지 않는 데이터 파이프라인 결함이다. 현재 상태로 30화 canary 진행 시 정체 모티프가 30화 내내 강화될 위험이 매우 크다. 제안 1+4(0.5~1.5일 작업)만으로도 root cause 두 개 중 한 개 + 보조 한 개를 직격할 수 있고, 그 후 ep6~10 추가 생성으로 효과 검증 후 30화 canary 진입이 안전한 순서다.
```
