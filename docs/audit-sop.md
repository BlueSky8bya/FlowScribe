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

## 8. Verify suite 분류 (POST-3 갱신 — 2026-05-02)

verify suite를 사용 시점/목적에 따라 분류. legacy로 남아있던 3개는 POST-3에서 갱신 완료, 모두 **required**로 복귀.

### 8.1 Required before merge (PR / main merge 차단 기준)

코드 변경 PR을 main으로 merge하기 전 반드시 PASS해야 하는 verify.

| Verify | 영역 |
|---|---|
| `verify_route_integrity` | Routing config + 실제 LLM 응답 |
| `verify_public_js_syntax` | 클라이언트 JS 문법 |
| `verify_ui_logic` | UI 동작 정합성 |
| `verify_sidebar_ui` | 사이드바 |
| `verify_book_load_flow` | book ↔ story 분리 + selectBook 흐름 |
| `verify_hybrid_streaming_contract` | hybrid streaming SSE contract |
| `verify_episode_end_character_cards` | 본문 하단 인물 카드 |
| `verify_episode_character_display_filter` | 등장 인물 노출 필터 |
| `verify_item_description_length` | 소지품 설명 길이 |
| `verify_state_taxonomy` | 감정/역할/관계 taxonomy 분리 |
| `verify_emotion_label_normalization` | 감정 라벨 정규화 |
| `verify_meaningful_appearance_guard` | R5B-1.8D meaningful appearance |
| `verify_episode_end_state_alignment` | episode-end 상태 정합 |
| `verify_item_location_ledger` | 소지품/위치 원장 정책 |
| `verify_world_rule_integrity` | 세계관 절대 규칙 |
| `verify_regeneration_divergence_contract` | 재생성 divergence contract |
| `verify_regen_degradation_fix` | 재생성 누적 over-constraining 차단 |
| `verify_narrative_repetition_guard` | R5B-3.5 narrative cliché audit |
| `verify_duplicate_discovery_dedup` | R5B-3 duplicate discovery |

### 8.2 Required before generation run (서버 띄우기 전)

```bash
node scripts/verify_route_integrity.mjs              # ⭐ 라우트가 실제 LLM 호출 가능한지
```

### 8.3 Required before 30/50/100 actual run

위 §8.1 전체 + 다음 audit (DB 검증):

```bash
node scripts/audit_world_rule_integrity.mjs --book-id <X>
node scripts/audit_narrative_repetition_guard.mjs --book-id <X>
node scripts/audit_duplicate_discovery_events.mjs --book-id <X>
node scripts/audit_episode_end_item_state.mjs --book-id <X>
```

### 8.4 Diagnostic only (선택적, regression 확인 / 진단)

| Verify | 사용 시점 |
|---|---|
| `verify_long_story_memory` | 장편 메모리 회귀 의심 시 |
| `verify_story_continuity` | 화 사이 연속성 검증 |
| `verify_story_memory_e2e` | E2E 메모리 |
| `verify_alias_runtime_audit` | alias 충돌 의심 시 |
| `verify_arc_summary_factuality` | arc summary 사실성 |
| `verify_reader_immersion_audit` | 독자 몰입 점수 |
| `verify_planner_parse_stability` | planner JSON parse 안정성 |
| (기타 ~30개) | 영역별 1회성 진단 |

### 8.5 Legacy / deprecated

**현재 비어있음.** POST-3 (2026-05-02)에서 다음 3개를 갱신해 §8.1 required로 복귀시킴:

| Verify | POST-3 갱신 내용 |
|---|---|
| `verify_book_load_flow` | `[\s\S]{0,N}` 윈도우 정규식 → `selectBook` 함수 본문 추출 후 `includes` 검사. 함수 본문이 길어져도 강건. **41/41 PASS**. |
| `verify_item_location_ledger` | 옛 한국어 문구 `.includes()` 정확 매치 → 의도-기반 정규식 (`이름\(name\)[\s\S]{0,80}원본`, `상태\s*변화[\s\S]{0,40}condition`, `스킬[·\s]*능력[·\s]*특성[\s\S]{0,80}items[\s\S]{0,40}(?:들어가지\s*않\|절대\s*넣지\s*않\|완전\s*제외)`, `축약[·\s]*개명[·\s]*확장`, `\[소지품\][\s\S]{0,200}이름.{0,5}그대로\s*사용`, `상태\s*변화[\s\S]{0,40}묘사[\s\S]{0,40}(?:표현\|처리)`, `스킬[·\s]*능력[\s\S]{0,40}(?:제외\|소지품처럼.*묘사.*않)`). **70/70 PASS**. |
| `verify_regeneration_divergence_contract` | check 7: `attemptCount >= 4` → `attemptCount >= \d+` (threshold 변동 허용, 현재 `>= 2`로 강화). check 16/17: `_temperaturePlanner/_temperatureRenderer = _regenContract` → `_temperaturePlanner(?:Base)?` / `_temperatureRenderer(?:Base)?` (Phase 4.20 R5A-C base/override 분리 허용). **20/20 PASS**. |

### 8.6 갱신 원칙 (regression 방지)

- **테스트를 통과시키기 위해 의미 없는 PASS로 만들지 말 것.** 의도-기반 정규식은 핵심 키워드를 반드시 포함해야 한다 (예: 위 §8.5 `이름.{0,5}그대로\s*사용`은 "이름"+"그대로 사용" 두 의도 단어 모두 강제).
- **삭제만 하고 대체 검증 없는 것 금지.** 옛 키워드를 빼면 동일 의도를 매칭하는 새 정규식으로 대체.
- 함수 본문 검증은 윈도우 길이 의존(`[\s\S]{0,N}`) 대신 함수 추출 후 includes 권고 (POST-3 selectBook 패턴 참조).

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
