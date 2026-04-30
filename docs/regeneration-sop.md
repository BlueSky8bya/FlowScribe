# Regeneration SOP

> 회차 재생성 운영 지침. 1화 vs N화 정책, divergence contract, sampling.
> 상세 진단·구현안: `regeneration-architecture-proposal.md`.

---

## 1. 정책

- **latest episode regeneration only:** ep N의 재생성은 N+1이 아직 없을 때만. 이전 회차는 재생성 불가 (downstream 회차가 N에 의존).
- **regen_nonce 강제 다양성:** frontend가 `?regen_nonce=<rand>` 전송 → 동일 입력에 대한 LLM 출력 분포 다양화.
- **세계관 규칙·도입 전제는 모든 시도에 보존:** "이세계 전이가 일어난다" 같은 premise는 재생성 시도 전부 등장.

## 2. RegenerationDivergenceContract (현재 V1)

`src/services/regen_divergence.ts:buildRegenDivergenceContract` → 최근 6개 prior trace에서 다음 추출:

```ts
{
  mode: "episode1_regeneration" | "latest_episode_regeneration",
  episode_number: number,
  attempt_count: number,
  old_episode_signature: {                // 8 fields, 50자 cap label (full beat dump 금지)
    opening_location?, opening_image?, first_conflict?, main_event_path?,
    key_revelation?, ending_hook_type?, ending_hook_image?, emotional_pattern?
  },
  recurring_patterns: string[],            // ≥2 occurrences로 감지
  must_preserve: string[],                  // 세계관 / 인물 / 직전 화 연속성 (★ 절대 규칙과 중복 가능 — R8.0에서 제거 예정)
  must_vary_axes: Array<...>,               // 11종, attempt_count로 hint_min 결정 (1→2 / 2-3→3 / 4+→4)
  hint_min_divergent_axes: number
}
```

prompt에는 [재생성 분기 계약] section으로 emit. 평균 600-1200 토큰.

## 3. Sampling Uplift

- planner default 0.4 → regen 시 0.65~0.95 (attempt_count 기반)
- renderer default 0.7 → regen 시 0.85~0.95

cap은 모델 무관 일괄 0.95. R8.1에서 모델별 cap (qwen2.5:14b는 0.85).

## 4. ep1 vs ep5+ 차이

| 항목 | ep1 | ep5+ |
|---|---|---|
| continuity 강제 | 0 (이전 회차 없음) | 강 (직전 회차 끝 위치 자동 고정) |
| divergence axis 자유도 | 11종 모두 | location 등 일부 자연 고정, character/event 축으로 |
| 도입 전제 (이세계 전이 등) | **본문 안에서 명시적으로 그림** | 이미 1화에서 일어난 사건으로 전제 |
| 평균 jaccard 목표 | < 0.10 | location 포함 시 0.15~0.25 자연 |

## 5. RegenIntroContract (Phase 4.17 → R8.2 통합 예정)

ep1 전용 alternate opening 정책. 현재 `RegenerationDivergenceContract`와 의미 중복.
**R8.2에서 V2 contract에 `is_first_episode` flag로 흡수 → 단일 prompt section.**

## 6. 변경 시 verify

```bash
npm run build
node scripts/verify_regeneration_divergence_contract.mjs
node scripts/verify_episode1_regeneration_intro_contract.mjs
node scripts/audit_episode_regen_divergence.mjs --book-id <X>
node scripts/audit_regen_overconstraint.mjs --book-id <X>
```

## 7. R8 진행 시 적용 순서

1. R8.0 — Contract V2 type + builder (must_preserve 제거, signature 8→6 통합)
2. R8.1 — Sampling cap 모델별
3. R8.2 — RegenIntroContract 흡수
4. R8.3 — recurring threshold 2→3
5. R8.4 — 확깨용_TEST + 클린북 ep1/ep5/ep10 V2 재smoke

## 8. 디버깅 체크리스트

### "재생성 다양성 부족"
1. `audit_episode_regen_divergence.mjs --book-id <X>`로 jaccard / axis uniqueness 측정
2. semantic_diversity HIGH/MEDIUM/LOW 확인 (Gemini judge)
3. shared_plot_skeleton: true인지 (특히 ep1)
4. recurring_patterns가 작은 corpus에서 false positive로 발동 → R8.3 후 완화

### "재생성이 절대 규칙 무시"
→ `world-bible-canonical-source.md` 우선 확인. World Bible derived index 정상화 후에도 violation이면 prompt section 가시성 검토.

### "재생성 본문이 너무 다르게 나와 continuity 깨짐"
1. ep>=2면 [연속성 계약] section 정상 emit 확인
2. must_vary_axes에 location 포함되면 ep5+에서 부자연. R8.0 axis 6종 통합으로 완화

## 9. 금지

- ❌ N_old의 full beat dump를 prompt에 다시 포함 (Phase 4.18 anchoring 방지 정책 위반)
- ❌ 특정 책/장르용 axis hardcoded 추가 ("빅토리는 ~ 다르게" 같은 형태)
- ❌ judge 점수 맞추기용 contract 조작 (사용자 가치 = 다양성, judge는 보조)
- ❌ ep1이 아닌 회차에서 도입 전제를 "본문에 명시적으로" 다시 그림 (이미 그려진 것의 반복)
