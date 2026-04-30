# Prompt Budget Baseline — Phase 4.20 R1.5

> 정적 측정 결과. `scripts/measure_prompt_budget.mjs` 출력을 baseline으로 고정.
> R2 prompt 가지치기 후 재측정해 비교한다.
>
> 측정 시점: 2026-04-30 (commit `4b261f3` 직후)
> 모드: 정적 코드 grep (LLM 호출 없음, raw prompt 출력 없음)

---

## 1. 요약

| | planner.ts | renderer.ts |
|---|---|---|
| source chars | **42,717** | **12,786** |
| source lines | 1,071 | 358 |
| approx_max_tokens (모든 conditional section emit 시 상한) | **~17,087** | **~5,115** |
| section header count (코드 grep) | 70 | 35 |
| **negative marker count** | **74** | **32** |
| **positive marker count** | 66 | 18 |
| **pos/neg ratio** | **0.89** ⚠️ | **0.56** ⚠️ |

→ 두 파일 모두 **negative dominance** (positive 안내보다 부정 지시가 많음).

## 2. 평균 emit token (Phase 4.20 forensic 기준)

| | system prompt | user prompt | 평균 emit total |
|---|---|---|---|
| planner | ~1.5K | 7-13K (조건부) | **8-15K** |
| renderer | 4-7K | ~1K | **6-10K** |

baseline_local (qwen2.5:14b, ctx 32K)에서 **30-50%가 instruction**. R2 가지치기 우선순위 매우 높음.

## 3. Section enumeration

### 3.1 Planner (top 25 + 기타)

```
[작가 개입]
[이번 화 제약]
[인물 현재 상태]
[직전 화 여파]
[연속성 계약 — 절대 준수]
[직전 화 말미 — 이 장면 직후부터 이번 화가 시작된다]
[연속성 — 절대 준수]
[스토리 흐름]
[인물 아크]
[숨은 정보]
[일반 규칙]
[미회수 복선]
[hook_type 다양성 — 반드시 준수]
[비활성 인물 로테이션 — JSON 출력 필수 조건]
[재생성 분기 계약 — <mode>, attempt <N>]
[이번 화에서 반드시 피해야 할 패턴]
[Episode Delta Contract — 절대 준수]
[출력 형식 최종 확인 — 반드시 아래 JSON 구조만 출력]
[적합한 전개 (상위 우선순위)]
[금지된 전개]
[권장 hook_type]
[금지 hook_type]
... (system prompt 안의 [반복 패턴 금지], [JSON 형식 정의] 등 추가)
```

70 grep matches 중 일부는 placeholder(`[phase]`, `[ci.name.toLowerCase()]` 등). **실제 user prompt에 emit되는 의미 section은 22+개** (Phase 4.20 forensic).

### 3.2 Renderer (top 25)

```
[★ 핵심 주인공: <name>]
[소지품 없는 인물 — 즉흥 아이템 금지]
[첫 단락 필수]
[★ 절대 규칙 — 본문 서술에서 반드시 준수]
[직전 화 말미 — 이 장면 직후부터 이번 화가 이어진다]
[장면 전환 원칙]
[연속성 — 퇴행 금지]
[이미 알려진 사실 — 대사·행동에서 인물들이 이미 아는 것으로 처리]
[반복 금지]
[감정 진전 필수]
[반드시 진전]
[인물 상태 변화 요구]
[반복 위험 패턴 — 이번 화에서 핵심 장면으로 재사용 금지]
[Episode Delta Contract — 서술 준수]
[엔딩 훅 — [CLIFF]
[최종화 — 반드시 준수]
[언어 절대 규칙 — 위반 시 출력 전체 무효]
[시점 — 최우선 규칙]
[★ 인물 이름 절대 규칙 — 위반 시 출력 전체 무효]
[등장인물]
[장면 계획 — 이 순서로 서술한다]
... (다음 섹션: [시작 위치·시각], [직전 화 여파], [부상 제약], [소지품 유지], [세계관 규칙], [문체·분량], [대화 따옴표], [출력 규칙])
```

**실제 emit되는 의미 section은 20+개**.

## 4. Top 10 token hogs (Phase 4.20 forensic 추정 기반)

### Planner user prompt
1. `[연속성 계약]` — known_facts + forbidden_regressions + character_position_state + emotional_progression : **800-1500 tok**
2. `[재생성 분기 계약]` — signature + recurring_patterns + must_vary_axes + must_preserve : **600-1200 tok**
3. `[인물 현재 상태]` — char_summary 인물별 multi-line : 400-800 tok
4. `[★ 세계관 장소 제약]` — 5조 안내문 : 300-500 tok
5. `[스토리 흐름]` — rolling_summary + arc_summaries : 200-600 tok
6. `[직전 화 말미]` — prev_episode_tail 500자 : ~250 tok
7. `[절대 규칙]` (Phase 4.19 안내문 추가) : 150-300 tok
8. `[반복 방지]` — must_not_repeat 다수 : 100-300 tok
9. `[복선]` — foreshadow_memory : 100-200 tok
10. `[첫 화 도입부 원칙]` (ep=1) : ~200 tok

### Renderer system prompt
1. `[등장인물]` — charList + items 인물별 : 400-800 tok
2. `[Episode Delta Contract — 서술 준수]` (ep>=2) : 400-800 tok
3. `[장면 계획]` — beats : 300-500 tok
4. `[연속성 — 퇴행 금지]` : 200-400 tok
5. `[★ 절대 규칙]` (Phase 4.19) : 150-300 tok
6. `[언어 절대 규칙]` : 100-150 tok
7. `[★ 인물 이름 절대 규칙]` : ~100 tok
8. `[POV — 시점]` : 100-200 tok
9. `[부상 제약]` : 50-200 tok
10. `[소지품 유지]` : 50-150 tok

## 5. R2 가지치기 후보 (우선순위)

| 순위 | section | 현재 | 권장 |
|---|---|---|---|
| 1 | `[연속성 계약]` 하위 항목들 | 800-1500 tok | character_position_state는 별도 ctx로 분리, known_facts top 5만 |
| 2 | `[재생성 분기 계약]`의 must_preserve | 200-300 tok | 절대 규칙 section과 중복 → 제거 (R8.0과 일치) |
| 3 | `[★ 세계관 장소 제약]` 5조 안내문 | 300-500 tok | 한두 줄로 압축 |
| 4 | `[절대 규칙]` 안내문 (부정형/긍정형/전제) | 150 tok | 3줄 → 1줄 |
| 5 | system prompt의 `[반복 패턴 금지]` 3단 공식 등 | 200-400 tok | 전체 정책 1줄 + 예시 제거 |
| 6 | renderer의 `[Episode Delta Contract — 서술 준수]` | 400-800 tok | 핵심 3줄로 압축, lines slicing cap 강화 |
| 7 | `[등장인물]` charList 안의 personality 길이 | 가변 | personality cap 250자 (이미 일부) → 150자 |
| 8 | `[★ 인물 이름 절대 규칙]` "위반 시 출력 전체 무효" | ~100 tok | 1줄로 통합 |

목표: planner -15%, renderer -10%.

## 6. Negative dominance 개선

### 측정값
- planner pos/neg = 0.89 (negative ≥ positive)
- renderer pos/neg = 0.56 (negative > positive 약 2배)

### R2 권장
- "~ 금지", "~ 하지 말 것", "~ 반복 금지" → "이번 화는 ~으로 시작한다", "~을 통해 진전시켜라" 같은 positive로 재서술
- 이미 다른 section과 중복되는 negative는 dedupe
- "위반 시 출력 전체 무효" 같은 강한 위협 표현 단축

## 7. R2 후 재측정 절차

```bash
# R2 변경 후
npm run build
node scripts/measure_prompt_budget.mjs --json > /tmp/r2-budget.json
diff <(cat /tmp/r0-budget.json) <(cat /tmp/r2-budget.json)
```

baseline (이 문서) 대비 -15% / -10% 달성 + pos/neg ratio ≥ 1.0 회복 목표.

## 8. 한계

- 정적 grep이라 conditional emit 비율은 추정 (forensic 기반)
- 실제 LLM tokenizer가 한국어를 char/2.5와 다르게 셀 수 있음 (실측 시 +/- 20%)
- system prompt vs user prompt 분리 측정은 R2에서 별도 도구로 정밀화

R1.5는 baseline 고정이 목적이므로 이 정도 정밀도로 충분.
