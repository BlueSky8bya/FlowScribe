# Audit / Verify / Debug Script SOP

> `scripts/` 디렉토리의 113+ .mjs 파일 사용법 안내. 어떤 상황에 어떤 스크립트를 부를지.

---

## 1. 카테고리 (Phase 4.20 시점 113개)

| 카테고리 | 갯수 | 역할 |
|---|---|---|
| `verify_*.mjs` | ~50 | 정적 검증 (코드 grep / regex) |
| `audit_*.mjs` | ~30 | DB 데이터 검증 (book_id 단위) |
| `debug_*.mjs` | ~5 | 1회성 디버깅 |
| `setup_*.mjs` | ~10 | 테스트 책 생성 |
| `cleanup_*.mjs` | 1 | 테스트 책 캐시 정리 |
| `measure_*.mjs` | 3 | latency / token baseline (R1.5 신규) |
| `experiments/` | 12 | longrun (30/100화) actual run |
| `gemini_* / multi_judge_*` | ~5 | 외부 평가 |

**적체 정리는 R2.5에서.** 현재는 그대로 활용.

## 2. 핵심 verify (코드 변경 시 의무)

### 2.1 종합
```bash
npm run build                                       # tsc
node --check scripts/<changed-file>.mjs             # 신규 script syntax
```

### 2.2 영역별
| 영역 | verify |
|---|---|
| World Bible / 절대 규칙 | `verify_world_rule_integrity` |
| Emotion / state taxonomy | `verify_state_language_guard` `verify_emotion_label_normalization` |
| Reader UX | `verify_episode_end_character_cards` `verify_episode_end_placeholder` `verify_reading_mode_scroll_anchor` |
| 재생성 | `verify_regeneration_divergence_contract` `verify_episode1_regeneration_intro_contract` |
| Item ledger | `verify_item_location_ledger` |
| Routing | `verify_route_integrity` |
| context save 비동기 | `verify_context_save_async` |
| generation latency 마커 | `verify_generation_latency_markers` |

## 3. 핵심 audit (DB 검증, 책 단위)

### 3.1 World Bible
```bash
node scripts/audit_world_rule_integrity.mjs --book-id <X>
node scripts/audit_world_rule_violation.mjs --book-id <X> --episode N
```

### 3.2 재생성
```bash
node scripts/audit_episode_regen_divergence.mjs --book-id <X>
node scripts/audit_regen_overconstraint.mjs --book-id <X>
```

### 3.3 인물 상태 / 소지품
```bash
node scripts/audit_episode_end_item_state.mjs --book-id <X> --episode N
```

### 3.4 트레이스 / 학습
```bash
# (학습 trace 분석은 R10에서 별도 SOP)
```

## 4. Phase 4.20 R1.5 측정 스크립트

```bash
# 정적 (즉시 실행)
node scripts/measure_prompt_budget.mjs

# 동적 (사용자 환경에서 server 띄우고 1회 실행)
node scripts/measure_context_save_latency.mjs --book-id <test_book_id>
node scripts/measure_generation_baseline.mjs --route high_quality_ensemble --episodes 1 --book-id <test_book_id>
```

산출물:
- `docs/measurement-baseline-phase4.20.md`
- `docs/prompt-budget-baseline.md`
- `docs/critical-path-baseline.md`

## 5. cleanup (테스트 책 한정)

```bash
# 항상 dry-run 먼저
node scripts/cleanup_test_book_state_cache.mjs --book-id <X> --dry-run

# 사장 승인 후만
node scripts/cleanup_test_book_state_cache.mjs --book-id <X> --apply
```

cleanup 정책: 사용자 입력(books.context, world_configs, world_rules, canonical_characters) 보존, 생성 결과(episodes, run_traces, dynamic_states 등) 삭제.

## 6. 새 verify/audit 작성 가이드

새 script는 **기존 패턴을 따른다**:
- verify: 정적 코드 grep + regex로 정책 명시 확인. summary footer "✅ ALL PASSED — N checks"
- audit: book_id 인자 필수, dry-run 가능하면 default
- 네이밍: `verify_<영역>.mjs` / `audit_<영역>.mjs` / `cleanup_<영역>.mjs`
- raw prompt/response/full text 절대 출력 금지 (count / metadata만)

## 7. 절대 금지

- ❌ verify/audit가 production 데이터에 무단 update/delete
- ❌ raw prompt/response를 stdout 또는 파일로 저장
- ❌ API key를 logger에 기록
- ❌ 100/50/30화 actual run을 "verify"로 위장
- ❌ 같은 영역의 verify/audit를 중복 생성 (기존 검색 후)

## 8. 디버깅 흐름

```
"이상 증상 발견"
  ├─ 어떤 영역? (state / world_rule / regen / UI / latency / item)
  ├─ 영역별 verify (정적) — 정책 위반 여부
  ├─ 영역별 audit --book-id <X> (동적, DB 데이터)
  ├─ logger 마커 확인 (api:context:save:latency / api:generate:latency)
  ├─ 필요 시 measure_* 1회
  └─ 원인 확정 후 R-phase에 등록 (단발 hotfix 자제)
```
