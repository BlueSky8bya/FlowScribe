# Regeneration Architecture Proposal — Phase 4.20

> 본 문서는 회차 재생성(regeneration) 구조의 현재 상태 평가 + 문제 진단 + 단계적 개선안이다.
> Phase 4.18 RegenerationDivergenceContract / Phase 4.17 RegenIntroContract / Phase 4.18B HQE smoke 결과를 종합한다.

---

## 1. 현재 구조 (Phase 4.18B 기준)

### 1.1 정책

- **latest episode regeneration only** — 이전 회차는 재생성 불가 (N+1 컨텍스트가 이미 N에 의존하므로)
- **확률적 nonce** — `regen_nonce` query param으로 동일 입력에 대한 출력 다양성 유도
- **divergence axes** — opening_location / opening_image / first_conflict / main_event_path / character_choice / threat_entry / ending_hook / emotional_route 등 11종

### 1.2 아키텍처

```
사용자가 "↺ 재생성" 클릭
  └─> /api/generate?episode=N&book_id=X&use_planner=true&regen_nonce=...

[generate.ts:99-110]
  ├─ DELETE 동일 회차 dynamic_states
  ├─ DELETE 동일 회차 foreshadows
  ├─ buildEffectiveContext (N)
  │
[regen 감지]
  ├─ detectGenerationMode(book, N)
  │     └─ run_traces에 동일 N의 prior trace → "latest_episode_regeneration"
  │     └─ 또는 episode_number=1 이면 "episode1_regeneration"
  │     └─ 그 외 "next_episode_generation" / "new_episode_generation"
  │
  ├─ buildRegenDivergenceContract(book, N, mode)
  │     ├─ 최근 6개 prior trace에서 signature 추출
  │     │   - opening_location, opening_image, first_conflict, main_event_path, key_revelation,
  │     │     ending_hook_type, ending_hook_image, emotional_pattern
  │     ├─ recurring_patterns 감지 (≥2 occurrences)
  │     ├─ must_preserve = ["세계관 규칙", "인물 정체성", "직전 회차 연속성", ...]
  │     ├─ must_vary_axes (attempt_count 기반: 1→2 / 2-3→3 / 4+→4 axes)
  │     └─ hint_min_divergent_axes
  │
  ├─ ctx.regen_mode = mode
  ├─ ctx.regen_divergence_contract = contract
  │
  └─ runPlannerPipeline(ctx)
        └─ planner system prompt에 [재생성 분기 계약] section emit
        └─ sampling temperature uplift (0.65 → 0.75-0.95, attempt_count 기반)
```

### 1.3 Phase 4.18B HQE smoke 결과 (요약)

| book | route | n | avg jaccard | location unique | 트로프 회피 |
|---|---|---|---|---|---|
| 확깨용_TEST ep1 | HQE | 5 | 0.087 | 5/5 | ✅ "고유스킬 능력 저하" 트로프 0/5 |
| 클린북 ep1 | HQE | 5 | 0.094 | 5/5 | character axis 2종 (정유리 3 / 한도윤 2) |
| 클린북 ep5 | HQE | 5 | location 1/5 (continuity) | char 4/5 | event/character axis 분기 |
| 클린북 ep10 | HQE | 3 | 0.166 | skeleton 2/3 unique | OK |

판정: PASS (own metrics) / CONDITIONAL (Gemini "shared_plot_skeleton: true" 일부 case).

---

## 2. 진단

### 2.1 문제

| 문제 | 근거 |
|---|---|
| Phase 4.18 변경으로 ep1 다양성은 좋아졌으나, contract section이 prompt 무게 1200토큰 추가 → 다른 영역 압박 가능 | planner [재생성 분기 계약] = "매우 긺" |
| must_preserve 안에 "세계관 규칙"이 들어 있어 [절대 규칙] section과 중복 | 같은 정보 2번 |
| recurring_patterns가 2 occurrence부터 발동 → 작은 corpus(예: 3-4 trace)에서 false positive | 통계 임계 낮음 |
| ep5+ continuity 강제로 location axis 거의 고정 → divergence가 character/event 축에만 의존 | 자연스러운 구조이나 안내 부족 |
| sampling uplift (0.95 cap)가 일부 모델에서 너무 높음 → 본문 일관성 흔들림 | qwen2.5는 0.85 이상 불안정 |
| RegenerationDivergenceContract와 RegenIntroContract (Phase 4.17)이 공존 — 의미 중복 가능 | 두 contract 명확히 분리되었는지 검토 필요 |

### 2.2 spec과 정합성

사용자 spec (Phase 4.20):
- "N_old를 너무 많이 넣어 재생성이 기존 플롯에 끌려가는가?" → ✅ 압축됐지만 must_vary_axes 자체가 N_old를 indirect로 anchor
- "N_old를 너무 적게 넣어 continuity가 깨지는가?" → ep5+ continuity 강제는 OK
- "divergence axis가 충분히 다양성을 주는가?" → 11종, 충분
- "sampling이 너무 결정론적인가?" → uplift 있음, 다만 cap 모델별 조정 필요
- "prompt가 과도한 금지 규칙으로 창작을 막는가?" → must_vary는 negative보다 positive ("X를 다르게 하라") 형식이라 양호

---

## 3. 권장 구조

### 3.1 RegenerationDivergenceContract slim 버전

기존 항목:
```typescript
interface RegenerationDivergenceContract {
  mode: "episode1_regeneration" | "latest_episode_regeneration";
  episode_number: number;
  attempt_count: number;
  old_episode_signature: { 8 fields ... };       // 50자 cap label
  recurring_patterns: string[];
  must_preserve: string[];                        // ★ 절대 규칙과 중복 가능
  must_vary_axes: Array<...>;
  hint_min_divergent_axes: number;
}
```

제안:
```typescript
interface RegenerationDivergenceContractV2 {
  mode: "episode1_regeneration" | "latest_episode_regeneration";
  episode_number: number;
  attempt_count: number;

  // Signature: 50자 label 6개로 감축 (기존 8개 → 6개)
  old_signature: {
    opening_location?: string;
    first_conflict?: string;
    main_event?: string;          // main_event_path 통합
    key_revelation?: string;
    ending_hook?: string;          // type+image 통합
    emotional_route?: string;
  };

  // recurring 감지 임계 상향: 2 → 3 (작은 corpus false positive 감소)
  recurring_patterns: string[];

  // must_preserve 제거 (절대 규칙 section과 중복)
  // continuity는 connection 별도 section ([연속성 계약])이 담당

  // must_vary는 attempt_count 기반 hint만 유지
  must_vary_axes: Array<"opening" | "conflict" | "event" | "character" | "ending" | "emotion">;
  // 11종 → 6종 통합 (사용자가 식별 가능한 단위로)

  hint_min_divergent_axes: number; // 1-3
}
```

토큰 절감: 1200 → 600 정도. 다른 section 여유 확보.

### 3.2 sampling uplift 모델별 cap

```typescript
const MAX_TEMP_BY_MODEL = {
  "deepseek-chat": 0.95,
  "gpt-4.1-mini": 0.90,
  "qwen2.5:14b": 0.85,        // 14B 로컬 → 너무 높으면 일관성 흔들림
  "gemma3:12b": 0.85,
  "default": 0.85,
};
```

attempt_count 기반 uplift는 유지하되 cap만 모델별로.

### 3.3 RegenerationDivergenceContract와 RegenIntroContract 통합

Phase 4.17 RegenIntroContract는 ep1 alternate opening 정책. Phase 4.18 RegenerationDivergenceContract와 의미 중복 — ep1 case는 mode="episode1_regeneration"로 합쳤으나 prompt section은 두 군데 emit 가능.

제안: **단일 RegenerationDivergenceContract만 유지**, ep1 special handling은 contract 내부 flag로:
```typescript
old_signature.is_first_episode = true → "도입부 다양성 강조" + 진입점 axis 추가
```

prompt section은 한 군데에서만 emit. [재생성 분기 계약] 통합.

---

## 4. ep1 vs ep5+ 다른 정책

### ep1
- continuity = 0 (이전 회차 없음)
- 모든 11(또는 6) axis 자유
- 도입 전제(world bible "이세계 전이" 등)는 절대 규칙으로 강제
- ★ N_old prior trace는 시그니처만, full beat dump 절대 금지 (Phase 4.18 정책 유지)

### ep5+
- continuity 강제로 일부 axis 자연스럽게 고정 (location: 직전 회차 끝 위치)
- divergence는 character/event axis로
- ending_hook은 자유 — 다음 회차 진입점에 영향
- foreshadow connection은 must_preserve 대신 "선택적 진전" hint

---

## 5. 평가 전략

### 5.1 자동
- `audit_episode_regen_divergence.mjs` (Phase 4.18 기존) 그대로 사용
- pairwise jaccard, axis uniqueness, skeleton uniqueness, Gemini semantic verdict
- recurring threshold ≥3로 변경 시 재실행

### 5.2 수동
- 사용자가 동일 회차 5회 재생성, 본문 첫 200자 비교
- "공식적이지 않게 다양한가" 주관 평가
- 절대 규칙(이세계 전이 같은 전제)이 모든 시도에 등장하는지

---

## 6. 위험

| 위험 | 완화 |
|---|---|
| must_preserve 제거 시 "직전 회차 연속성" 손실 | [연속성 계약] section이 이미 ep>=2면 emit. 중복 제거 |
| signature 8 → 6 통합 시 정보 손실 | label이 30자 cap → 6 fields × 30 = 180자. axis 통합으로 본문 다양성에 영향 거의 없음 |
| sampling cap 하향 (qwen 0.95→0.85) | 14B는 안정성 우선이 사용자 경험에 유리 |
| RegenIntroContract → RegenerationDivergenceContract 통합 시 호환성 | 기존 trace는 그대로 유지, 새 trace부터 V2 |

---

## 7. 단계적 적용 (R8)

### R8.0 — Contract V2 정의 + 단일 source
- Type 정의 V2 (must_preserve 제거, 8→6 axis 통합)
- old code path 유지, 새 path는 V2로

### R8.1 — Sampling cap 모델별
- model_router의 task config에 max_temperature 추가
- regen 시 attempt 기반 uplift는 그 cap을 넘지 않음

### R8.2 — RegenIntroContract 제거 + 통합
- ep1 case는 V2 contract에 is_first_episode flag로
- 기존 RegenIntroContract 코드 dead

### R8.3 — recurring threshold 3
- audit_episode_regen_divergence.mjs로 false positive 감소 확인
- 작은 corpus에서도 안정

### R8.4 — Phase 4.18B 재smoke
- 확깨용_TEST + 클린북 ep1/ep5/ep10에서 V2 contract로 재smoke
- jaccard, axis uniqueness, Gemini verdict 비교

---

## 8. spec 준수

- ❌ "특정 책 전용 하드코딩 금지" — V2 contract는 일반 axis 기반, 책 무관 ✓
- ❌ "특정 단어 금지문 추가 금지" — must_vary는 positive guidance, must_preserve 제거 ✓
- ❌ "judge 점수 맞추기용 prompt 조작 금지" — divergence는 사용자 가치, judge 없이도 측정 ✓

---

## 9. 결론

현재 구조는 Phase 4.18 기준 **유효**하지만:
1. must_preserve 제거 + signature 8→6으로 prompt 토큰 절감
2. sampling cap 모델별 조정으로 안정성↑
3. RegenIntroContract 흡수로 dead code 정리
4. recurring threshold 상향으로 작은 corpus false positive 감소

R8에서 단계적 적용. 큰 위험 없음, 검증은 기존 audit 스크립트로 충분.
