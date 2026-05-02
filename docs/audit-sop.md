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

## 8. Legacy verify (regex 진화 미반영 — 실제 기능은 정상)

verify는 코드 grep / regex 기반이라 코드가 진화하면 정규식이 stale해지는 경우가 있다.
아래 verify는 **실제 기능은 정상**이지만 정규식이 옛 패턴을 검사하므로 **부분 실패가 발생한다**.
PR merge 전 게이트에서 무시해도 되는 항목으로 분류한다 (FINAL phase 2026-05-02 시점 확인).

### 8.1 분류된 legacy verify

| Verify | 실패 항목 | 원인 (정규식 stale) | 실제 코드 상태 |
|---|---|---|---|
| `verify_book_load_flow` | 6 fail (`selectBook: _setActiveBook 호출` 외 5개) | 정규식 `/async function selectBook[\s\S]{0,500}_setActiveBook/` 등이 0~500자 윈도우 사용. `selectBook()` 본문이 시간이 지나며 늘어나(active-gen 복귀 처리 등) 첫 호출까지 600+자가 됨. | `public/js/auth.js:759-810` — `_setActiveBook(777)` → `_clearStorySurface(778)` → `_loadEpisodes(781)` → `_renderLatestEpisode(794)` → `_restoreContextSafely(798)` → `updateEpisodeUI(803, final 무조건 호출)` 모두 정상 실행. |
| `verify_item_location_ledger` | 7 fail (`이름 변경 금지 지시`, `condition으로 기록 지시`, `스킬 제외 지시`, `이름 변경 금지 섹션`, `축약 금지 지시`, `condition으로 처리 지시`, `스킬 묘사 금지`) | verify가 옛 한국어 문구를 `.includes()`로 정확 매치. 현재 prompt는 동일 의도를 다른 문구로 표현. | `src/pipeline/planner.ts:364-365` — "이름(name): 사용자 원본 그대로 (축약·변경 안 함)" / "상태 변화는 condition에 기록" / "스킬·능력·특성·마법·패시브는 items에 들어가지 않는다 — 완전 제외". `src/pipeline/renderer.ts:225` — "위 [등장인물]의 소지품 이름을 그대로 사용한다 — 축약·개명·확장 안 함" / "스킬·능력·마법·특성은 제외". 모든 정책 보존. |
| `verify_regeneration_divergence_contract` | 2 fail (`7. hint_min_divergent_axes 자동 산정 (attempt_count 기반)`, `17. renderer.ts: regen 시 temperature 상향`) | check 7: 옛 정규식 `/attemptCount\s*>=\s*4/` 검사. 현재는 `attemptCount >= 2`로 더 엄격하게 조정됨. check 17: 옛 변수명 `_temperatureRenderer = _regenContract` 검사. 현재는 `_temperatureRendererBase = _regenContract`로 분리됨 (Phase 4.20 R5A-C에서 `temperatureOverride` 지원 추가 시 분리). | `src/services/regen_divergence.ts:185` — `attemptCount >= 2 ? 3 : 2` (강화된 threshold). `src/pipeline/renderer.ts:317-323` — `_temperatureRendererBase = _regenContract ? Math.min(0.90, 0.85 + Math.min(_regenContract.attempt_count, 3) * 0.017) : 0.85;` → `_temperatureRenderer = typeof temperatureOverride === "number" ? temperatureOverride : _temperatureRendererBase;`. **attempt_count 기반 temperature 상향 logic은 동일 유지**, 변수명만 base/override 분리. R5B-4c 100ep / R6 60ep canary + regen 10회에서 모두 정상 divergence 입증. |

### 8.2 PR merge 게이트 정책

- 위 3개 verify는 PR merge **block 사항이 아니다** (legacy로 분류).
- 실제 기능 동작은 R5B-4c TEST2G 100ep + R6 multi-genre 60ep + regen 10회 + R5B-4d trace recording fix smoke 누적 evidence (172 generations, 0 fail)로 입증.
- post-merge 별 phase에서 verify 정규식만 갱신 권고 (코드 변경 없이 verify script 수정).

### 8.3 갱신 권고 작업 (post-merge)

```text
verify_book_load_flow:        [\s\S]{0,500} → [\s\S]{0,1500} 또는 ".*?_setActiveBook" 같은 lazy match
verify_item_location_ledger:   includes() string match → 의도 키워드 multiple OR regex (예: /이름.*원본.*그대로|이름.*축약.*변경/)
verify_regeneration_divergence_contract:
  check 7:  attemptCount >= 4 → attemptCount >= [0-9]+ (any threshold OK)
  check 17: _temperatureRenderer = _regenContract → _temperatureRenderer(?:Base)?\s*=\s*_regenContract (base/override 분리 허용)
```

이 갱신은 **코드 수정 없이 verify script만** 수정하는 1~2시간 작업.

## 9. 디버깅 흐름

```
"이상 증상 발견"
  ├─ 어떤 영역? (state / world_rule / regen / UI / latency / item)
  ├─ 영역별 verify (정적) — 정책 위반 여부
  ├─ 영역별 audit --book-id <X> (동적, DB 데이터)
  ├─ logger 마커 확인 (api:context:save:latency / api:generate:latency)
  ├─ 필요 시 measure_* 1회
  └─ 원인 확정 후 R-phase에 등록 (단발 hotfix 자제)
```
