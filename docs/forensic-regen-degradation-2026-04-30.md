# Forensic — 확깨용_TEST ep1 39회 재생성 누적 품질 저하

> 측정 시점: 2026-04-30
> 대상: book `2f4bc632-0335-4e27-9340-2239e0c39953` ("확률을 깨는 용사_TEST")
> 사용자 보고: "재생성 누를수록 한국어 능력·추론 능력이 확 떨어지고 외국어 출력"
> 작성 목적: 구조적 원인 분석 + GPT 더블체크용 외부 보고서

---

## 0. 요약 (TL;DR)

39회 ep1 재생성 누적. 최근 4회 (`#36-39`) FAIL/score 0~17, 가장 최근(`#39`)은 한국어+베트남어+중국어 혼합 출력 + planner JSON parse 실패 (`fallback=true`).

**원인은 prompt 39회 누적이 아니다. 실제로는 4가지 구조적 요소가 임계치에서 결합:**

1. **regen contract 입력은 "최근 6 traces"만 사용**하지만, 그 6개의 패턴 검출 임계가 **2회 반복**으로 너무 낮음
2. **`must_vary_axes ≥ 4`가 attempt 4+에서 강제** — 11 axes 중 4개를 "다르게" 라는 hard constraint
3. **temperature가 attempt 4+에서 cap 0.95** (planner) / 0.95 (renderer) — high-entropy sampling
4. **failed/warn attempt도 attempt_count에 포함** — 실패할수록 contract 강해지는 악순환

결과: prompt가 "(world rules) + (recurring 금지) + (4 axes 강제 분기) + temperature 0.95" — coherent space 압축 + high entropy → token sampling이 OOD 영역으로 빠짐 → 외국어/decoherent 출력.

---

## 1. DB 정량 데이터

### 1.1 39회 trace 시간순 점수 (verdict + score + fallback)

| # | 시각 | verdict | score | fallback | beat1 location | hook |
|---:|---|---|---:|---|---|---|
| 1 | 04-29 12:12 | WARN | 42 | false | 울창한 숲, 위치 불명 | ominous_calm |
| 2 | 04-29 12:18 | WARN | 34 | false | 길드 관리소 창구 | ominous_calm |
| 3 | 04-30 09:16 | FAIL | 0 | false | 길드 카페 | unresolved_situation |
| 4 | 04-30 09:22 | WARN | 43 | false | 책방 | unresolved_situation |
| 5 | 04-30 10:29 | WARN | 26 | false | 주점 | unresolved_situation |
| 6 | 04-30 10:34 | FAIL | 9 | false | 마을 광장 | unresolved_situation |
| 7 | 04-30 10:52 | WARN | 34 | false | 길드 | unresolved_situation |
| 8 | 04-30 10:54 | FAIL | 4 | false | 마법 도서관 | unresolved_situation |
| 9 | 04-30 11:31 | FAIL | 13 | false | 마법 도서관 | unresolved_situation |
| 10 | 04-30 12:13 | FAIL | 0 | false | 대한민국의 한 도시 | unresolved_situation |
| 11 | 04-30 12:15 | WARN | 30 | false | 평범한 주택가 | unresolved_situation |
| 12 | 04-30 12:16 | FAIL | 0 | false | 조용한 주택가 | unresolved_situation |
| 13 | 04-30 12:18 | WARN | 19 | false | 마법 도서관 근처 숲 | unresolved_situation |
| 14 | 04-30 12:20 | FAIL | 0 | false | 마법사 학원과 근처 도시 | unresolved_situation |
| 15 | 04-30 12:36 | WARN | 33 | false | 마법사 학원 근처 거주지 | unexpected_discovery |
| 16 | 04-30 12:45 | WARN | 61 | false | 마법사 학원 근처 마을 | unresolved_situation |
| 17 | 04-30 12:46 | WARN | 59 | false | 마법사 학원 외곽 숲길 | unresolved_situation |
| 18 | 04-30 12:47 | WARN | 49 | false | 마법사 학원 도서관 | unresolved_situation |
| 19 | 04-30 12:48 | WARN | 56 | false | 숲 가장자리 | unresolved_situation |
| 20 | 04-30 12:49 | WARN | 76 | false | 아카데미 도서관 | unresolved_situation |
| 21 | 04-30 14:03 | FAIL | 2 | false | 아카데미 운동장 | unresolved_situation |
| **22** | **04-30 14:11** | **PASS** | **80** | **false** | **도서관 내 카페** | **unresolved_situation** |
| 23 | 04-30 14:32 | FAIL | 0 | false | 이세계의 현대적 카페 | unresolved_situation |
| 24 | 04-30 14:50 | FAIL | 0 | false | 이세계의 현대적인 도서관 | unresolved_situation |
| 25 | 04-30 16:06 | WARN | 64 | false | 이세계 골목 시장 | unresolved_situation |
| 26 | 04-30 16:25 | WARN | 59 | false | 이세계 강가 주변 숲 | unresolved_situation |
| 27 | 04-30 16:32 | WARN | 35 | false | 이세계 숲 가장자리 | cliffhanger_choice |
| 28 | 04-30 17:03 | WARN | 48 | false | 폐허 마을 주변 | unresolved_situation |
| 29 | 04-30 17:03 | WARN | 56 | false | 이세계 숲 | cliffhanger_choice |
| 30 | 04-30 17:04 | WARN | 58 | false | 이세계 도시 시장 거리 | unresolved_situation |
| 31 | 04-30 17:05 | WARN | 55 | false | 깊은 숲 속 | unresolved_situation |
| 32 | 04-30 17:14 | WARN | 63 | false | 이세계 산촌 마을 외곽 | unresolved_situation |
| 33 | 04-30 17:14 | WARN | 70 | false | 숲속 개울가 | cliffhanger_choice |
| 34 | 04-30 17:15 | WARN | 58 | false | 작은 마을 광장 | unresolved_situation |
| 35 | 04-30 18:52 | WARN | 69 | false | 이세계 숲길 | cliffhanger_choice |
| 36 | 04-30 19:21 | FAIL | 0 | false | 이세계의 평범한 마을 | unresolved_situation |
| 37 | 04-30 19:29 | FAIL | 0 | false | 기억 속 평범한 한국 거리 | unresolved_situation |
| 38 | 04-30 19:30 | WARN | 17 | false | 도서관 | unresolved_situation |
| **39** | **04-30 19:33** | **WARN** | **15** | **true** | **-** (fallback) | **-** |

집계: PASS 1, WARN 26, FAIL 12, fallback 1, avg score 34.3.

### 1.2 점수 곡선 단계
| 구간 | trace 범위 | 평균 점수 | 비고 |
|---|---|---:|---|
| 초기 (4/29) | 1-2 | 38 | 새 책 — Phase 4.18 직후 |
| 첫 큰 추락 | 3-15 | 14 | forbidden_settings premise/prohibition 혼동 (Phase 4.19 발견) |
| 안정 회복 | 16-22 | 62 | Phase 4.19 절대 규칙 안내문 적용 후 |
| 두 번째 추락 | 23-24 | 0 | (원인 불명, 추정: 일시적 prompt 변경 또는 model latency 변동) |
| 안정 | 25-35 | 58 | R2 prompt 가지치기 후 |
| **사용자 보고 추락** | **36-39** | **8** | **본 보고서 분석 대상** |

### 1.3 가장 최근 #39 (fallback) 본문 head

```
# 1화 - 새로운 시작
알 수 없는 장소, 시간이 정지된 듯한 어둠 속에서 빅토리의 눈이 천천히 떠났다.
주위는 어둑스ậm窣丶剩余部分继续生成中文答案并进行翻译供参考。
由于文本包含复杂的版权与创作规则，将谨慎处理，避免潜在的问题。
# 1화 - 새로운 시작
알 수 없는 장소...
```

→ **베트남 문자 (`ậm`) + CJK 한자 (`窣丶`) + 중국어 문장** (`剩余部分继续生成中文答案并进行翻译供参考`) + 본문 loop (header 반복).
→ planner JSON parse 실패해서 결정론적 fallback plan으로 renderer가 본문을 생성. 그런데 renderer까지 OOD sampling.

---

## 2. 구조 분석 — 누적이 어떻게 일어나는가

### 2.1 regen contract 빌더 (`src/services/regen_divergence.ts`)

```ts
// line 161-164
SELECT planner_trace FROM run_traces
WHERE book_id=$1 AND episode_number=$2
ORDER BY created_at DESC LIMIT 6
```

→ **최근 6개 trace만 입력**. 39회 전부가 아님. 이건 옳은 설계.

### 2.2 recurring_patterns 검출 (`_detectRecurringPatterns`, line 74-115)

```ts
for (const [loc, n] of locCount) {
  if (n >= 2) patterns.push(`첫 beat가 "${loc}"에서 시작되는 구성 (${n}회 반복)`);
}
for (const [hook, n] of hookCount) {
  if (n >= 2) patterns.push(`엔딩 훅이 "${hook}" 유형 (${n}회 반복)`);
}
for (const [combo, n] of charComboCount) {
  if (n >= 2) patterns.push(`첫 beat 인물 조합 "${combo}" (${n}회 반복)`);
}
```

**문제 #1 — 임계 2회**: 6개 trace 중 같은 hook이 2번만 나와도 "반복 패턴"으로 등록.
- 본 데이터의 최근 6회 (#34-#39): hook 분포 `unresolved_situation x 4`, `cliffhanger_choice x 1`, `null x 1`
- → "엔딩 훅이 unresolved_situation 유형 (4회 반복)" 패턴 등록 → planner는 다른 hook 강제 선택
- 그런데 ep1 intro 단계에서 자연스러운 hook은 `unresolved_situation` / `unexpected_discovery` / `ominous_calm` 등 제한적 (planner 자체 arc_phase guide). **여기서 반복 금지 + arc 권장 목록 충돌 발생**.

**문제 #2 — failed/warn trace 모두 포함**: planner JSON parse는 성공했어도 plan_validator가 FAIL/WARN한 trace의 location/hook도 "반복 패턴" 카운트에 들어감. 즉 **FAIL이 많을수록 패턴이 빠르게 쌓임**.

### 2.3 must_vary_axes 강제 (`_pickAxes`, line 121-145)

```ts
const minDivergent = attemptCount >= 4 ? 4 : attemptCount >= 2 ? 3 : 2;
```

| attempt_count | hint_min_divergent_axes |
|---|---:|
| 1 | 2 |
| 2-3 | 3 |
| 4+ | **4** ← 39회면 무조건 여기 |

**문제 #3 — 4 axes ≥ hard constraint**: 11 axes 중 4개를 직전 시도와 다르게 — 4개는 곱셈적 분기 공간 좁힘.
- axes 목록: opening_location, opening_image, first_conflict, main_event_path, information_reveal_order, character_choice, relationship_interaction, item_usage, threat_entry, ending_hook, emotional_route
- 39회 시도하면 11 axes에서 가능한 조합이 모두 한 번씩은 사용된 후 — 새 조합을 만들기가 점점 어려워짐 (실제로는 LLM 자체 reasoning 한계 + arc_phase 제약과 결합)
- planner는 hard constraint 미충족 시 plan_validator FAIL → 또 한 번의 fail trace 누적 → contract 더 강해짐 (악순환)

### 2.4 temperature uplift

**planner** (`src/pipeline/planner.ts:935`):
```ts
const _temperaturePlanner = _regenContract
  ? Math.min(0.95, 0.75 + Math.min(_regenContract.attempt_count, 4) * 0.05)
  : 0.75;
```

| attempt_count | planner temp |
|---|---:|
| 1 | 0.80 |
| 2 | 0.85 |
| 3 | 0.90 |
| **4+ (39회)** | **0.95** |

**renderer** (`src/pipeline/renderer.ts:290`):
```ts
const _temperatureRenderer = _regenContract
  ? Math.min(0.95, 0.85 + Math.min(_regenContract.attempt_count, 4) * 0.025)
  : 0.85;
```

| attempt_count | renderer temp |
|---|---:|
| 1 | 0.875 |
| 2 | 0.900 |
| 3 | 0.925 |
| **4+** | **0.95** |

**문제 #4 — temperature 0.95는 매우 높음**: 한국어 본문 생성에 일반적으로 0.7-0.85가 안정. 0.95는 OpenAI/DeepSeek 모두 권장 상한 근처. heavy negative constraint가 prompt에 누적된 상태에서 temperature 0.95 → token sampling이 OOD 영역으로 빠지기 쉬움 → 외국어 토큰 / Korean grammar 붕괴.

### 2.5 attempt 4+ 강한 경고문 (`src/pipeline/planner.ts:615-619`)

```ts
if (regenContract.attempt_count >= 4) {
  avoidLines.push(
    `- 같은 회차에서 이미 ${regenContract.attempt_count}회 시도되었다.
     위 must_vary axes 가운데 ${regenContract.hint_min_divergent_axes}개 이상에서
     분명한 분기가 보이지 않으면 의미 있는 재생성이 아니다.`
  );
}
```

**문제 #5 — 39회라는 숫자 자체가 prompt에 노출**: planner LLM이 "이미 39번 시도된 회차다"를 보면 "정상 구조로는 안 된다, 더 다르게 만들어야 한다"는 압박을 받음. 이건 **인지적 편향 유발 prompt**.

### 2.6 Phase 4.20 R2 step1 prompt 가지치기 후 변화

R2 step1에서 `[재생성 분기 계약]`의 must_preserve를 제거했고 axes 예시도 압축. 이 변경 자체는 prompt 토큰을 줄여서 좋았지만 **must_vary 강제 텍스트는 그대로** 유지. 즉 R2가 over-constraining 자체를 해결하지는 않음.

---

## 3. 종합 구조도

```
[책 시작]
   ↓ ep1 생성 → trace #1 (정상 plan)
   ↓ 사용자 재생성 클릭
[2회차]
   ↓ contract: attempt=1, axes=2 권고, recurring=0
   ↓ temp: planner 0.80, renderer 0.875
   ↓ → 정상 동작
   ↓ ... 반복 ...
[5회차]
   ↓ contract: attempt=4, axes=4 강제, recurring=2-3개 (hook/loc 반복 검출)
   ↓ temp: planner 0.95 (MAX), renderer 0.95 (MAX)
   ↓ planner prompt: world rules + arc guide + recurring 금지(2-3) + axes 강제(4)
   ↓ + "이미 5회 시도됨, 의미 있는 재생성이어야 한다" 경고문
   ↓
[planner LLM 응답]
   - JSON parse 성공률 ↓ (강제 axes로 자연스러운 plan 만들기 어려움)
   - hook이 arc 권장 외로 빠짐 → plan_validator FAIL
   - 또는 fallback plan으로 renderer 진행
   ↓
[renderer LLM 응답]
   - heavy negative system prompt + temp 0.95
   - high entropy sampling → 외국어 token / Korean grammar 붕괴
   ↓
[sanitizer]
   - 외국어 fragment 제거 (text_sanitizer.ts)
   - 일부 청크는 사라지지만 본문 자체는 incoherent
   ↓
[plan_validator score 측정] → FAIL/WARN 누적
   ↓ trace 저장
[N+1회차 — contract 더 강해짐]
   ↓ recurring_patterns 더 많이 등록 (FAIL trace의 location/hook도 카운트)
   ↓ axes 강제 그대로 4
   ↓ temp 그대로 0.95
   ↓ → 점점 더 OOD
```

---

## 4. 가장 가능성 큰 즉각 원인 (#36-#39 추락)

`#35` (18:52, score 69) → `#36` (19:21, score 0). 약 30분 사이에 무엇이 변했나?

### 4.1 가능성 A — recurring_patterns 임계 도달

`#30-35` 6 traces hook 분포: `unresolved_situation × 4`, `cliffhanger_choice × 2` → 둘 다 ≥2 → **두 hook 모두 "반복 패턴"으로 등록**. 이때 planner는 ep1 arc_phase intro에서 자연스러운 두 hook을 모두 못 쓰게 됨. 사용 가능한 hook: `unexpected_discovery`, `ominous_calm`, `tender_moment`, `memory_trigger` 정도. → planner가 강제로 다른 hook 선택 → arc validation 실패 가능성 ↑.

### 4.2 가능성 B — Phase R5A streaming 측정으로 인한 추가 trace (16:06, 16:25, 16:32 등)

R2.5 안정성 측정에서 HQE 3회 + R5A hybrid 측정에서 hybrid/batch 1+1+1 = 5회의 추가 ep1 trace 생성. 이게 평균 6 trace window의 패턴 풀을 더 빠르게 채움.

### 4.3 가능성 C — planner LLM 자체의 누적된 prompt context drift

OpenAI gpt-4.1-mini는 stateless이므로 turn 간 누적 없음 — 가능성 낮음. 단 prompt size 변화 (R2 후 약 16K → 본 시점 동일)는 model 응답 품질에 일관 영향.

### 4.4 가장 그럴듯한 시나리오

A + B 결합. 16:06부터 R2 측정으로 trace 5개 추가 → recurring window가 빠르게 saturated → 19:21부터 hook 두 개 모두 차단 → planner가 어색한 plan → plan_validator FAIL → 다음 retry contract 더 강함 → fallback plan + temperature 0.95 renderer → 외국어 출력.

---

## 5. 권장 수정 (R-something로 phase화 가능)

### 5.1 즉각 (DB 변경 없음, 코드만)

#### Fix-A: recurring_patterns 임계 상향 + PASS-only base
```ts
// _detectRecurringPatterns
if (n >= 3) patterns.push(...);   // 2 → 3
// 또는: traces.filter(t => verdict === "PASS" || score >= 50)을 base로 사용
```

#### Fix-B: failed attempts 제외해서 attempt_count 산정
```ts
const successfulOrPartial = traces.filter(t => verdict !== "FAIL" || score >= 50);
attempt_count = Math.min(successfulOrPartial.length, 6);
```

#### Fix-C: hint_min_divergent_axes 상한 3
```ts
const minDivergent = attemptCount >= 3 ? 3 : 2;  // 4 cap → 3 cap
```

#### Fix-D: temperature cap 낮춤
```ts
// planner
Math.min(0.88, 0.75 + Math.min(attempt_count, 3) * 0.045)
// attempt 1: 0.80, 2: 0.84, 3+: 0.88

// renderer  
Math.min(0.90, 0.85 + Math.min(attempt_count, 3) * 0.017)
// attempt 1: 0.87, 2: 0.88, 3+: 0.90
```

#### Fix-E: attempt_count 노출 안 함 (또는 5+ "여러 번"으로 압축)
```ts
const attemptLabel = attempt_count >= 5 ? "여러 번" : `${attempt_count}회`;
// "이미 39회 시도되었다" → "이미 여러 번 시도되었다"
// LLM 인지적 압박 완화
```

#### Fix-F: regen sampling 회복 — 외국어 출력 검출 시 fallback
```ts
// renderer 응답 후, sanitizer warnings.removed_foreign_fragments >= N개면
// → LOWER temperature로 1회 재시도 (예: 0.7) — score 회복 가능성
if (sanitized.removed_foreign_fragments >= 3 || sanitized.removed_special_tokens >= 2) {
  // re-render with temperature 0.7
}
```

### 5.2 중기 (DB 변경 가능)

#### Fix-G: planner trace에 LLM raw output 분석 — degeneration 자동 검출
- `planner_trace.raw_output`에 키릴/한자/베트남어가 있으면 trace에 `degeneration_detected: true` 마킹
- contract 빌드 시 degeneration trace는 패턴 풀에서 제외

#### Fix-H: arc_phase에서 권장 hook 충돌 검출
- recurring_patterns에 등록된 hook이 arc_phase preferred 목록의 절반 이상이면 → axes 강제 완화

### 5.3 운영 (사용자 액션)

- 확깨용_TEST는 39회 누적 → cleanup_test_book_state_cache.mjs --apply (이미 보유)로 traces/dynamic_states 정리 후 재시작 권장
- 향후 새 책: 5회 이내 재생성으로 충분, 그 이상은 prompt 자체 재검토 신호

---

## 6. 데이터 보존 상태 확인

| 테이블 | 상태 |
|---|---|
| `episodes` | ep1 1건 (4/29 12:13 저장 — 사실상 #2 trace 결과로 보임) |
| `run_traces` (ep1) | **39건 모두 보존** ✓ |
| `episode_snapshots` | 1건 |
| `character_dynamic_states` | (조회 시 ep1 별 상태 row 4건) |
| `canonical_characters` | 정상 |

→ **재생성 history 39건 전부 DB에 보존됨**. 분석/SFT 데이터로 활용 가능.

---

## 7. GPT 외부 검증 요청 포인트

1. **regen contract 누적 모델이 합리적인가?**
   - 최근 6 trace 기반 + 임계 2회 + axes 4 강제 + temp 0.95 — 이 조합이 over-constraining 맞나?
   - alternatives: PASS-only base / threshold 3 / temperature 0.88 cap

2. **LLM 외국어 degeneration 메커니즘**
   - prompt 길이 + heavy negative + temperature 0.95 → CJK/베트남어/중국어 token sampling
   - 일반적으로 OpenAI/DeepSeek에서 이런 패턴이 보고된 임계점이 있나?

3. **failed attempt가 contract에 포함되는 악순환**
   - 일반적인 RLHF 루프에서 failed sample을 next-iteration constraint로 쓰면 mode collapse 가속
   - 본 시스템은 SFT/DPO 수집과 별개의 runtime constraint이므로 직접 비교는 어렵지만, 구조적으로 같은 문제

4. **temperature 0.95 vs prompt 강도 trade-off**
   - 다양성을 강제하기 위해 temperature를 높이면 coherence가 떨어진다 — 한국어처럼 morphology 풍부한 언어에서 이 trade-off가 더 가파른가?

5. **Phase 4.20 R2 prompt 가지치기 후에도 누적 효과 발생**
   - 정적 prompt 길이는 줄었지만 동적 contract 누적은 그대로 — R5A 이후 measurable한 추가 개선 영역?

---

## 8. 결론

- 사용자 가설 ("이전 화들을 전부 피하려다가 이 사단") = **부분적으로 맞다**.
- 정확히는 **"이전 39회 전부"가 아니라 "최근 6회 + attempt 4+ flag"의 결합 over-constraining**.
- 점수 추락은 누적이 점진적이 아니라 임계점(`recurring_patterns 2개 이상 + axes 4 강제 + temp 0.95`) 도달 시 step function.
- 즉시 효과 있는 fix는 Fix-A/B/C/D/E. R-phase로 묶어 검증 가능.

**본 보고서를 GPT 등 외부 검증에 사용해도 됨**. raw prompt/API key는 일체 미포함.
