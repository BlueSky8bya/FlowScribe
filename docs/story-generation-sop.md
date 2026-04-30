# Story Generation SOP

> 본문 생성 critical path 운영 지침. 디버깅/튜닝 시 첫 진입점.
> 상세 진단: `e2e-architecture-forensics.md`, `performance-critical-path-audit.md`.

---

## 1. 핵심 사실

- **planner path만 사용 권장:** `?use_planner=true` (DPO 수집 + audit + state commit 정상)
- **legacy path:** `use_planner=false` 시 `streamEpisode` 직행. plan validation 없음, DPO 수집 안 됨. **R9.2에서 차단 예정.**
- **batch 구조:** `runPlannerPipeline`이 모든 step await 후 본문 한 번에 발행. SSE 형식이지만 token chunk streaming 아님. → R5 hybrid에서 분리.

## 2. Pipeline 단계

| # | step | LLM | blocking | 분리 가능 (R5) |
|---|---|---|---|---|
| 1 | buildEffectiveContext | - | YES | NO |
| 2 | creativePlanner | ✓ | YES | NO |
| 3 | planValidator | - | YES | NO |
| 4 | rendererLLM | ✓ | YES | token streaming 가능 |
| 5 | sanitizer | - | YES | token 단위 가능 |
| 6 | continuityCheck (ep>=2) | - | NO | YES → audit log |
| 7 | episodeDeltaCheck | - | NO | YES → audit log |
| 8 | judgeAndRepair (조건부) | ✓ | NO | **YES → 다음 회차 ctx로 반영, 본문 변경 안 함** |
| 9 | commitDynamicState | - | NO | YES → background |
| 10 | proseValidation (off) | - | optional | YES |
| 11 | revision (off) | - | optional | YES |

## 3. Prompt 구조

### Planner system prompt
- 언어 규칙 / 역할 / JSON 형식 / hook_type / 반복 패턴 금지 / state_updates 규칙 / 소지품 배정·등급

### Planner user prompt — 22+ section conditional
[N화]/[목표]/[필수사건]/[엔딩훅] / [연재계약] / [서사국면] / [세계관 장소 제약] / [작가 개입] / [절대 규칙] / [이번 화 제약] / [인물 현재 상태] / [직전 화 여파] / [연속성 계약 ★] / [직전 화 말미] / [스토리 흐름] / [인물 아크] / [숨은 정보] / [일반 규칙] / [복선] / [hook_type 다양성] / [비활성 인물 로테이션] / [재생성 분기 계약 ★] / [반복 방지] / [첫 화 도입부 원칙]

★ = 매우 긺. R2에서 가지치기 우선.

### Renderer system prompt — 20+ section
[언어 절대] / [주인공 선언] / [절대 규칙 (Phase 4.19)] / [직전 화 말미] / [장면 전환] / [연속성 — 퇴행 금지] / [Episode Delta Contract] / [엔딩 훅 or 최종화] / [POV] / [인물 이름 절대] / [등장인물] / [장면 계획] / [시작 위치] / [직전 화 여파] / [부상 제약] / [소지품 유지] / [세계관 규칙] / [문체·분량] / [대화 따옴표] / [출력 규칙]

## 4. 평균 토큰 추정

| | system | user | total |
|---|---|---|---|
| planner | ~1.5K | 7-13K | 8-15K |
| renderer | 4-7K | ~1K | 6-10K |

baseline_local (qwen2.5:14b, ctx 32K)에서 30-50%가 instruction. 창작 여유 압박.

R1.5에서 정확한 baseline 측정 → R2 가지치기 우선순위 결정.

## 5. 디버깅 체크리스트

### "본문이 너무 느리다"
1. logger `api:generate:latency` 마커 확인 (request_start / pipeline_done / first_token_sent 차이)
2. judge 발동 여부 (`scheduleBackgroundAudit` 또는 inline). hint 자주 발생하면 judgeAndRepair가 +5-15s
3. route 확인 (baseline_local qwen2.5:14b는 context 32K 한계)
4. prompt token 측정 (`scripts/measure_prompt_budget.mjs`)

### "본문 품질이 낮다"
1. negative dominance 확인 (Top 10 overconstraint sources, `performance-critical-path-audit.md`)
2. 인물 personality에 emotion/role 단어 섞임 → state taxonomy SOP
3. 세계관 background 빈 채로 forbidden_settings에 premise 들어감 → world bible canonical SOP
4. judge fallback이 본문 변경 → R5 후 audit-only로

### "재생성 다양성 부족"
→ `regeneration-sop.md`

### "인물 카드의 감정에 이상한 값"
→ `state-taxonomy-sop.md`

## 6. 변경 시 필수 verify

코드 변경 시:
```bash
npm run build
node scripts/verify_world_rule_integrity.mjs
node scripts/verify_route_integrity.mjs
node scripts/verify_episode1_regeneration_intro_contract.mjs
```

prompt 변경 시 추가:
```bash
node scripts/measure_prompt_budget.mjs   # token 수 baseline 비교
node scripts/audit_regen_overconstraint.mjs --book-id <X>
```

## 7. 금지

- `runPlannerPipeline`에 새 LLM step 무단 추가 금지 (critical path 압박)
- planner/renderer prompt에 새 [금지 ~] section 무단 추가 금지 (negative dominance)
- judge가 본문을 변경하는 path 무단 활성화 금지 (현재 사용자가 본 본문과 trace 본문 일치 보장)
- legacy path에 새 기능 추가 금지 (R9.2에서 차단 예정)
