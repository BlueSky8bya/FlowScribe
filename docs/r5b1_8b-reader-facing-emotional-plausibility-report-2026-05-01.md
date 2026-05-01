# R5B-1.8B — Reader-Facing Emotional Plausibility Review

**날짜**: 2026-05-01
**Phase**: R5B-1.8B (R5B-1.8 본문 기반 검증)
**브랜치**: checkpoint/phase1-launch-prep
**검증 책**: 확률을 깨는 용사(확깨용)_TEST2D (`92b3cdcb-6f40-48e8-a47b-de7d50658ac5`)
**검증 범위**: ep1~15 (ep1 baseline + ep2~15 신규 R5B-1.8 hybrid+HQE 생성)

---

## 1. 브랜치/상태

- 브랜치: `checkpoint/phase1-launch-prep`
- HEAD commit: `08fa909` (R5B-1.8 emotional plausibility hotfix)
- working tree: 금지 파일(.claude/scheduled_tasks.lock, scripts/cloud_dpo/launch_dpo.py) 외 깨끗
- build: ✅ PASS

## 2. R5B-1.8 커밋

- commit: `08fa909` — `fix(story): R5B-1.8 emotional plausibility — same-cluster + cause/action progression`
- 변경 파일 (8 files, 813 +, 43 -):
  - `src/pipeline/planner.ts` — 6-delta 스키마 + countMeaningfulBeatDeltas
  - `src/pipeline/index.ts` — carry_forward + label_change_without_cause gating
  - `src/pipeline/renderer.ts` — [★ R5B-1.8 감정 납득성] 섹션
  - `scripts/audit_emotional_plausibility.mjs` (신규) — R5B-1.8 PASS 5개 기준 자동 검증
  - `scripts/verify_genuine_progression_guard.mjs` (신규)
  - `scripts/verify_state_progression_required.mjs` (신규)
  - `scripts/verify_r5b1_7_emotional_contract.mjs` — R5B-1.8 superset로 정렬
  - `docs/r5b1_8-emotional-plausibility-report-2026-05-01.md` (신규)
- verify 결과: 7/7 ✅ (genuine_progression_guard 29/29, state_progression_required 25/25, world_rule 21/21, route 25/25, state_taxonomy 36/36, emotion_label 21/21, hybrid_streaming 32/32)
- 금지 파일 unstaged 보존 — 커밋에 포함 안 됨

## 3. TEST2D 본문 기반 감정 평가

### 3-1. 평가 대상

- ep1: TEST 원본 baseline 복사 (planner trace 없음)
- ep2~15: R5B-1.8 코드로 HQE+hybrid 생성, 14화 모두 score=80 PASS
- 본문 총 40,794자
- 4명 핵심 인물: 리아(주인공 마법사), 빅토리(이세계인), 브론(분석가·방패), 카이렌(검사·고양이파)

### 3-2. 주요 인물별 감정 흐름 (요약 — 본문 전문 미게재)

#### 리아 (불안→결심→결의×12)
- ep2 불안: 마나 부재 발견 충격
- ep3 결심: 의식 결심
- ep4~15 결의 12화 유지 — 매 화 새 정보·도구·실패·회복으로 행동 갱신
  - ep4 의식 시작·실패, ep6 새 방법(4명 마나 집중), ep7 마나 역류, ep8 피 토함, ep9 찬트 룬 폭발, ep10 붉은 구슬 등장, ep11 마냥석 매개체 발견, ep12 빅토리 디저트 받음, ep13 마나 호랑이, ep14 호랑이 조건 거부, ep15 북서쪽 차단 지점 발견

#### 브론 (경계→집중→긴장×12)
- ep2 경계 → ep3 집중 → ep4~15 긴장 12화 유지
- 행동: 매 화 새로운 분석·도구 사용 (방어막→마나 통로 막힘 발견→마력 증폭 수정→빗소리 수정→북서쪽 차단 지점)

#### 빅토리 (혼란→결의×13) — 가장 긴 streak
- ep2 혼란 → ep3~15 결의 13화 유지
- 행동: ep3 보상 조건(국밥·이불·고양이) → ep5 자기주도 → ep8 리아 걱정 → ep10 붉은 구슬 회수 → ep12 "필요한 사람" 고백 → ep14 "능력 없어도 살 수 있다" 큰 선언 → ep15 핸드폰 분석
- 라벨은 "결의" 동일하지만 character arc는 명확하게 진전 (수동→주체)

#### 카이렌 (결의×2→긴장×12)
- ep2~3 결의, ep4~15 긴장 12화 유지
- 행동: 캣닢 주머니 선물 → 마냥석 조각 매개체 발견 → 마나 고양이 식별(ep13) → 호랑이 거부 동의

### 3-3. 평가 질문 응답 (10개)

1. **같은 감정군 유지 납득 가능?** YES — 의식 실패 cliff·다음 시도·재실패의 plot 사이클이 결의/긴장을 자연스럽게 유지시킴
2. **인물 행동 양상 화마다 달라짐?** YES — 매 화 새 도구·발견·결정으로 차별화
3. **recent_goal이 본문 행동과 연결?** YES — "내일 의식 성공시킨다" goal이 본문에 일관됨
4. **관계/거리감 변화?** YES — 빅토리·리아 신뢰가 ep12·14에서 명확히 깊어짐. 카이렌의 캣닢→마냥석으로 빅토리 보호 서서히 명시됨
5. **감정이 행동/대사로 드러남?** YES — 리아 손가락으로 숫자 세기(반복 nervous tic), 빅토리 핸드폰 만지작, 카이렌 얼굴 붉어짐 등 묘사 풍부
6. **planner beat가 본문에 반영?** PASS — alignment 양호 (자세한 표는 §4)
7. **감정군 변경 장면 납득?** YES — ep3 빅토리 혼란→결의 (의식 결심 사건), ep4 리아 결심→결의 (의식 시작), ep4 카이렌 결의→긴장 (붉은 빛 위협)
8. **감정군 안 바뀌는 장면도 충분?** PASS — 6-delta 카운트 매 화 4~6개 전부 채워짐
9. **단조 반복 장면 있는가?** PARTIAL — 위치(공터·숲)가 거의 고정. 빅토리·리아의 "결의" 라벨이 13/12화 유지. ep5/ep10 회복기는 정체 느낌 약간 있음
10. **50화로 확장 시 버틸 수 있는가?** CONDITIONAL — 현재 plot은 의식 성공 전 단계라 결의·긴장 유지가 자연스러움. 의식 성공 후 새 arc로 넘어가면 cluster shift 자연스러울 가능성. 단, planner 자체 변주 nudge가 보강되면 더 안전.

### 3-4. Reader plausibility per-ep score (1~5)

| ep | 사건 요지 | 점수 |
|---|---|---|
| ep2 | 의식 제안, 30% 성공률 | 4 |
| ep3 | 의식 준비, 빅토리 결심·캐릭터 색깔 | 4 |
| ep4 | 의식 첫 시도→실패→미세 마나 발현 | 5 |
| ep5 | 회복기, 위협 지속 | 3 |
| ep6 | 새 방법, 푸른 빛 명확화 | 4 |
| ep7 | 마나 역류, 빅토리 부축 emotional | 5 |
| ep8 | 마나 차단 발견, 피 토함 dramatic | 4 |
| ep9 | 찬트 룬 폭발 큰 사건 | 5 |
| ep10 | 회복기, 붉은 구슬 등장 | 3 |
| ep11 | 마냥석 반응 새 정보 | 4 |
| ep12 | 빅토리 "필요한 사람" 고백 + 적 무리 | 5 |
| ep13 | 마나 호랑이 등장 + 정체 폭로 | 5 |
| ep14 | 호랑이 조건 거부 + 빅토리 대선언 | 5 |
| ep15 | 북서쪽 정보 + 새 적 cliff | 4 |

**자체 평균: 60/14 ≈ 4.29** (≥4.0 → PASS)

## 4. Planner beat vs Rendered text alignment

샘플링 스팟 체크 (주요 변곡점 4개):

| ep | 인물 | planner emotion | planner beat 핵심 | 본문 evidence | alignment | reader_plausibility |
|---|---|---|---|---|---|---|
| ep4 | 리아 | 결의 (감정 변경 시도→실패) | 의식 단호 진행 + 실패 시 마나 손실 인지 | "지팡이 떨어짐, '미안해요... 실패했어요...'" 묘사 | PASS | PASS |
| ep7 | 빅토리 | 결의 (리아 부축 결정) | 의식 적극 참여 + 리아 보호 의지 | "넌 나를 위해서 이렇게까지 했잖아. 이번엔 내가 도울 차례야" 직접 대사 | PASS | PASS |
| ep11 | 카이렌 | 긴장 (마냥석 빅토리 반응 발견) | 새 매개체 발견 + 팀 보호 적극화 | "이거... 빅토리의 마나와 반응하고 있어" 발견 묘사 | PASS | PASS |
| ep14 | 빅토리 | 결의 (호랑이 조건 거부) | 능력 자기수용·리아 결정 존중 | "중요한 건 능력이 아니라, 그 능력을 어떻게 사용하느냐는 거야" 핵심 대사 | PASS | PASS |

**4/4 spot check PASS**. 자동 audit (R5B-1.8) 결과 same_cluster_with_valid_delta 80.8%, fake risk 0%, alignment(beat→본문) 양호.

주의: ep14의 빅토리 emotional_state는 "결의" 그대로지만, 실제 character arc는 "통로 열기 절박함" → "능력 없어도 OK 자기수용"으로 큰 진전. 라벨은 동일해도 plausibility_note·decision_delta가 본문에 잘 구현됨 — R5B-1.8 정책의 의도와 정확히 일치.

## 5. Multi-judge 결과

dual judge: `reader_immersion_judge` route_set (gemini-2.5-flash + openai gpt-4.1-mini), JSON 모드, max_tokens 16k(Gemini thinking 대비)/4k(OpenAI). 본문 발췌(첫 6줄+마지막 2줄, 화당 ≤320자) + planner beats 요약만 전송. 본문 전문 미전송.

### 5-1. Gemini 2.5 Flash

```json
{
  "scores": {
    "sameCluster_naturalness": 4,
    "behavior_variation": 3,
    "show_dont_tell": 4,
    "planner_render_alignment": 4,
    "scalable_50ep": 3,
    "monotony_risk": "some"
  },
  "average": 3.4,
  "verdict": "CONDITIONAL",
  "monotonous_characters": ["브론", "카이렌", "빅토리"]
}
```
**reasoning(요약)**: 빅토리 마나 문제라는 명확한 목표 아래 감정선 일관, 납득 가능. 단 브론/카이렌/빅토리의 결의·긴장 유지가 50화 확장 시 단조로움·몰입 저하 위험. 일부 본문 묘사가 planner beats만큼 구체적이지 않음.

### 5-2. OpenAI gpt-4.1-mini

```json
{
  "scores": {
    "sameCluster_naturalness": 5,
    "behavior_variation": 4,
    "show_dont_tell": 4,
    "planner_render_alignment": 5,
    "scalable_50ep": 5,
    "monotony_risk": "some"
  },
  "average": 4.6,
  "verdict": "READY",
  "monotonous_characters": ["브론", "카이렌"]
}
```
**reasoning(요약)**: 감정 흐름 자연스럽고 사건 전개 부합. 행동·대사 일관 + 적절한 변화. 플래너-본문 일치도 높음. 다만 브론·카이렌 긴장감 반복 단조 — 전체 확장 가능성 충분.

### 5-3. 두 judge 비교

| 항목 | Gemini | OpenAI | 공통 |
|---|---|---|---|
| sameCluster_naturalness | 4 | 5 | high |
| behavior_variation | 3 | 4 | mid-high |
| show_dont_tell | 4 | 4 | high |
| planner_render_alignment | 4 | 5 | high |
| scalable_50ep | 3 | 5 | divergent |
| monotony_risk | some | some | **공통: some** |
| 평균 | 3.4 | 4.6 | 4.0 |
| verdict | CONDITIONAL | READY | **CONDITIONAL** (보수적 채택) |
| monotonous chars | 브론·카이렌·빅토리 | 브론·카이렌 | **공통: 브론·카이렌** |

**공통 지적**: 브론·카이렌 긴장 장기 유지 단조로움. 본문 alignment·자연스러움·show-don't-tell·planner-renderer 일치는 모두 양호.

**단독 지적**:
- Gemini: 빅토리도 단조 후보. 50화 확장 우려(score 3). 본문 묘사 구체성 부족 부분 있음.
- OpenAI: 50화 확장 가능(score 5).

평균 4.0 — 사용자 기준의 PASS(≥4.0) 보더라인. 보수적으로 **CONDITIONAL** 채택.

## 6. 50화 canary 판단

### 자동 지표 (R5B-1.8 audit)
- ✅ same_cluster_without_delta ≤ 10% (실제 0%)
- ✅ fake_progression_risk ≤ 10% (실제 0%)
- ✅ genuine_progression ≥ 65% (실제 100%)
- ✅ implausible_emotion_shift = 0
- ✅ 인물 3화 내 behavior/goal delta ≥1 (4/4 인물 100%)

### 본문 기반 정성 평가
- alignment PASS 4/4 spot check
- 자체 reader plausibility 평균 4.29 (PASS)
- multi-judge 평균 4.0 (CONDITIONAL — Gemini 3.4 + OpenAI 4.6)
- 공통 단조로움 우려: 브론·카이렌

### 결정: **CONDITIONAL**

**근거**:
- 자동 지표는 깨끗하지만 reader-facing 단조로움이 두 judge 공통으로 지적됨 (브론·카이렌 긴장 12화 유지)
- 현재 plot이 의식 성공 전 단계라 긴장·결의가 자연스럽지만, 50화로 확장 시 같은 패턴이 30화 이상 지속될 가능성
- Gemini는 50화 확장에서 우려(score 3), OpenAI는 가능(score 5) — divergent

### 권장 next step (사장님 판단 영역)

**옵션 A — 50화 canary 직행 (OpenAI 의견)**
- 자동 지표 + alignment·납득성·show-don't-tell 모두 양호
- 단조로움은 plot 진행으로 자연 해소 가능 (의식 성공 후 새 arc)
- 리스크: 30화 지점에서 reader 이탈 가능성

**옵션 B — R5B-1.8C 소규모 hotfix 후 50화 canary (Gemini 의견)**
- planner에 "주요 인물 5화 이상 같은 cluster 유지 시 사건 변주(외부 자극·관계 deltas) 강화" nudge 추가
- 또는 renderer에 "특정 인물 행동 패턴 5화 이상 동일 시 변형" guide 추가
- 1~2일 작업 + TEST2E 15화 재검증 → 50화 canary

**옵션 C — R5B-2 정공법**
- DB migration, must_advance_from per-character, Confirmed Facts Ledger
- 3~5일 작업
- 자동 지표가 이미 깨끗하므로 현 시점 과투자

## 7. PR merge readiness 변화

- **이전(R5B-1.8 단독)**: CONDITIONAL — reader 정성 평가 후 결정
- **현재(R5B-1.8B)**: CONDITIONAL 유지 — multi-judge 결과 단조로움 일부 우려, 50화 canary 결과 보고 결정 권장

```
R5B-1.8B verdict: CONDITIONAL
50화 canary 진행 가능 여부: CONDITIONAL (옵션 A 직행 또는 옵션 B 소규모 hotfix 후 진행 — 사장님 판단)
PR merge readiness: CONDITIONAL (50화 canary 결과 후 결정)
R5B-2 필요 여부: NO (현 시점 — 자동 지표 깨끗, R5B-1.8C로 충분 가능)
근거: 자동 지표(R5B-1.8 PASS 5/5, alignment 4/4, fake 0%)는 깨끗. 본문 자체 plausibility 평균 4.29(PASS). dual judge 평균 4.0(CONDITIONAL 보더라인) — Gemini 3.4(CONDITIONAL) + OpenAI 4.6(READY)으로 divergent. 공통 우려는 브론·카이렌의 긴장 12화 유지가 50화 확장 시 단조로움 위험. plot이 의식 성공 전 단계인 점이 cluster 유지의 실제 원인. 50화 canary 직행도 가능하나 옵션 B(R5B-1.8C 5화-이상-cluster nudge) 후 진행이 더 안전.
```

## 부록 A. 본문 데이터 보존 정책

- TEST2D ep1~15 본문 dump는 `.tmp/r5b1_8b_review.json` (gitignored, 절대 commit 안 함)
- judge raw text는 `.tmp/r5b1_8b_judge_<provider>.json` (gitignored)
- 본 보고서에는 본문 전문 미게재, 짧은 핵심 대사 paraphrase + 사건 요약만 사용
- judge 결과는 점수 + reasoning 요약만 게재, raw 응답 본문 게재 안 함
