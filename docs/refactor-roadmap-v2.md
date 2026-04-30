# Refactor Roadmap v2 — Phase 4.20 Output

> 본 문서는 FlowScribe 대규모 리팩터링 계획서다. R0~R10의 단계적 phase로 구성.
> 각 phase는 **목표 / 수정 파일 / 위험도 / rollback / 검증 / 브라우저 확인 / 완료 기준 / 예상 시간**을 포함.
> Phase 4.20 verdict 후 GPT 더블 체크 + 사용자 결정에 따라 R0부터 순차 착수.

---

## 0. 우선순위 원칙

1. **독자 몰입 > 모든 것**: 본문 품질, 재생성 다양성, 장편 연속성
2. **사용자 직접 만든 세계관 존중**: World Bible canonical, 절대 규칙은 prompt에 정확히 도달
3. **빠른 체감 속도**: critical path를 본문 노출까지 단축
4. **명확한 상태 구조**: emotion / personality / role / relationship 의미 분리
5. **하나씩**: 한 번에 한 phase, 측정 후 다음

---

## R0 — Freeze & Backup
**목표:** Phase 4.20 forensic 시점의 코드/DB 상태를 안전하게 보관. 전체 phase의 baseline.
**수정 파일:** 없음. git tag + DB snapshot.
**작업:**
- `git tag phase-4.20-forensic-baseline` (현재 commit 기준)
- DB pg_dump (옵션, 사용자 환경에서)
- `docs/refactor-roadmap-v2.md` (이 문서) commit
- branch 보호: `checkpoint/phase1-launch-prep` PR 보류 상태 유지

**위험도:** 매우 낮음
**rollback:** 불필요
**검증:** git log + tag 확인
**브라우저 확인:** 불필요
**완료 기준:** tag 생성, baseline commit fixed
**예상 시간:** 30분

---

## R1 — Documentation & Architecture Map
**목표:** Phase 4.20 forensic 산출물 7개 문서를 운영 SOP로 promotion. CLAUDE.md 갱신.
**수정 파일:**
- `docs/story-generation-sop.md` (신규, e2e-architecture-forensics 정제)
- `docs/state-taxonomy-sop.md` (신규)
- `docs/regeneration-sop.md` (신규)
- `docs/world-bible-canonical-source.md` (신규)
- `docs/reader-ux-sop.md` (신규)
- `docs/audit-sop.md` (신규)
- `docs/model-routing-ops.md` (보강)
- `CLAUDE.md` (Project Structure / Routing 갱신, 360→200줄 목표)
- 폴더별 README 6개 sync

**위험도:** 낮음 (문서만)
**rollback:** git revert
**검증:** `docs/`와 `CLAUDE.md`의 routing 표 일치 확인
**브라우저 확인:** 불필요
**완료 기준:**
- CLAUDE.md를 처음 읽은 신규 agent가 "1화 생성 느림 원인 추적" 시 정본 문서 1-2개로 갈 수 있음
- Memory 시스템 (`~/.claude/...memory/`) 초기화 + 핵심 항목 5-10개 등재

**예상 시간:** 4-6시간

---

## R2 — Critical Path Cleanup
**목표:** prompt section 가지치기 + judge 발동 임계 상향 + legacy path 차단. 큰 리팩터 없이 측정 가능한 개선.
**수정 파일:**
- `src/pipeline/planner.ts` — system prompt 단축 (반복 패턴 금지 200토큰 절감, 안내문 압축)
- `src/pipeline/renderer.ts` — system prompt 단축 (delta contract 압축, 절대 규칙 안내문 단축)
- `src/pipeline/index.ts` — judge 발동 임계 변경 (hint 1→2, fatal 카테고리만)
- `src/api/generate.ts` — legacy path 차단 (use_planner=false → 412 또는 auto-true)
- `scripts/verify_prompt_size_budget.mjs` (신규)

**위험도:** 중간 (본문 품질 회귀 위험, 측정 필수)
**rollback:** prompt diff revert
**검증:**
- `verify_prompt_size_budget.mjs`로 token 수 measure (planner < 12K, renderer < 8K target)
- 기존 verify suite 통과
- 사용자 ep1 5회 생성 → first_token_latency 측정 (R2 전후 비교)
**브라우저 확인:** 사용자가 5회 생성 후 본문 품질 주관 평가
**완료 기준:**
- planner prompt 평균 -15%, renderer -10%
- judge 발동률 -50% (logger metric)
- first_token_latency p50 5-15초 → 5-12초
- 본문 품질 사용자 만족도 유지

**예상 시간:** 1.5일

---

## R3 — State Taxonomy Refactor
**목표:** emotion / personality / role / relationship 의미 분리. "친절한/팀워크/신입" 오염 차단.
**서브 phase:**

### R3.0 — schema 변경 없는 1차 fix
- `src/services/language_guard.ts` — normalizeEmotionalState 강화 (whitelist + non-emotion blacklist)
- `src/pipeline/planner.ts` — emotional_state prompt 안내 강화 (positive whitelist + 일반 negative example)
- `src/pipeline/plan_validator.ts` — emotion 화이트리스트 검증 단계
- `scripts/verify_state_taxonomy.mjs` (신규)

### R3.1 — schema 확장
- `src/db/migrate_v?.ts` — character_dynamic_states에 emotion_cause / progression_delta / relationship_dynamic / role_status / personality_traits 컬럼 추가
- `src/types/canonical.ts` — CharacterStateUpdate interface 확장
- `src/services/character_state.ts` — commitDynamicState 새 컬럼 처리

### R3.2 — UI 반영
- `public/js/generate.js` — `_buildSceneCharDetailedCardHtml`에 새 row 노출
- `public/css/components.css` — 추가 row styling

### R3.3 — Training/audit 반영
- `src/training/trace_logger.ts` — 새 필드 trace에 포함
- `scripts/audit_state_taxonomy_drift.mjs` (신규)

**수정 파일:** 위에 명시
**위험도:** 중간 (DB migration 포함, 단계적)
**rollback:**
- R3.0: prompt/normalizer revert
- R3.1: migration down script (rollback 컬럼 drop)
- R3.2/R3.3: revert
**검증:**
- `verify_state_taxonomy.mjs`로 화이트리스트 강제 확인
- `audit_state_taxonomy_drift.mjs`로 기존 책의 drift 측정
- 사용자 ep1 재생성 후 emotion 칸이 화이트리스트 외 값 갖지 않는지
**브라우저 확인:** 사이드바·ep-end cards에서 "친절한/팀워크/신입" 안 보이는지
**완료 기준:**
- emotion 칸 화이트리스트 24개 매치율 100%
- 기존 drift된 row는 carry-forward 또는 manual fix
- UI에 personality/relationship/role 별도 row 자연스럽게 노출

**예상 시간:** 2-3일

---

## R4 — World Bible Canonical Source
**목표:** books.context를 단일 canonical, 정규화 테이블은 derived index. user_description / llm_description 분리.
**서브 phase:**

### R4.0 — books.context schema v2 정의
- `src/types/canonical.ts` — books.context v2 type
- `src/api/context.ts` — v1 입력 받으면 v2로 변환 후 저장

### R4.1 — derived index 단방향
- /api/context POST의 sync 코드 단순화
- world_configs / world_rules / canonical_characters는 books.context의 read-only mirror

### R4.2 — UI restore 통일
- restoreContextUI는 v2 그대로 deserialize
- modal.js saveContext도 v2 schema

### R4.3 — initial_items.description 분리
- v2 schema에 user_description + llm_description 분리
- LLM enrich는 llm_description만 update

### R4.4 — cleanup tool 일원화
- `cleanup_test_book_state_cache.mjs` 갱신: books.context의 user_* 필드는 절대 보존, derived index는 reset

**수정 파일:** 위에 명시
**위험도:** 중간-높음 (기존 데이터 v1→v2 변환)
**rollback:** 변환 함수 단방향, dual read 유지로 fallback
**검증:**
- `verify_world_bible_canonical_source.mjs` (신규)
- `audit_world_bible_drift.mjs --book-id <X>` (신규)
- 확깨용_TEST 변환 후 절대 규칙이 generation context에 정확히 도달
**브라우저 확인:** modal에서 saveContext 후 generation 시 절대 규칙 반영
**완료 기준:**
- v2 schema 책에서 절대 규칙 violation audit FAIL → PASS
- 기존 v1 책도 dual read로 동작
- cleanup tool이 user_* 필드 보존 testable

**예상 시간:** 2일

---

## R5 — Generation Pipeline Split (Hybrid Streaming)
**목표:** runPlannerPipeline을 critical/background로 분리. renderer LLM token streaming.
**서브 phase:**

### R5.0 — sanitizer를 token 단위로 변환
- `src/pipeline/sanitizer.ts` — chunk buffer 처리, foreign char/special token 즉시 제거
- utf8 boundary 보호

### R5.1 — renderer LLM stream=true
- `src/pipeline/renderer.ts` — chat.completions.create stream:true 옵션
- `onToken(chunk)` 콜백 인자

### R5.2 — pipeline split
- `runPlannerPipeline`을 둘로 분리:
  - `runPlannerCritical(ctx, onToken)` — planner + renderer (token streaming) + sanitizer
  - `runPlannerBackground(plan, generated_text, ctx)` — continuity / delta / judge / state commit

### R5.3 — generate.ts SSE 분리
- `res.write({token: chunk})` 반복 (renderer onToken)
- `res.write({text_done: true})` (renderer 끝)
- background commit 시작
- char_states polling endpoint (`/api/generate/char-states`)
- frontend는 text_done → ep-end placeholder, 별도 polling으로 char_states 수신

### R5.4 — frontend SSE handler 갱신
- `public/js/generate.js` — `text_chunk` / `text_done` / 별도 polling 로직

**수정 파일:** 위에 명시 + scripts/verify_generation_streaming.mjs (신규)
**위험도:** 높음 (대규모 변경, 회귀 위험)
**rollback:** runPlannerPipeline 통째로 revert + SSE 형식 복귀
**검증:**
- 기존 verify suite 통과
- 사용자 ep1 5회 생성 latency 측정 (target: first_token < 5-12초)
- 본문 품질 회귀 없음 (judge audit 결과 비교)
**브라우저 확인:** 본문 token이 chunk마다 보이는지, placeholder 자연스러운지
**완료 기준:**
- click_to_first_token p50 < 12초
- judge/repair는 본문 변경하지 않음 (audit log only, 다음 회차 ctx 반영)
- char_states polling이 1-3초 내 도착
- 회귀 없음 (verify suite 100% PASS)

**예상 시간:** 2-3일 (테스트 포함)

---

## R6 — Async Postprocess / Job Queue
**목표:** foreshadow / arc summary / item enrich / audit 등 background job을 정식 queue로.
**수정 파일:**
- `src/queues/index.ts` — BullMQ 큐 정의 (이미 일부 있음)
- `src/queues/worker.ts` — worker 통합
- `src/api/context.ts` — item_desc enrich를 queue에 enqueue
- `src/api/generate.ts` — judge/repair audit, foreshadow 등 queue로
- 운영 관점 retry / dead letter / monitoring

**위험도:** 중간
**rollback:** setImmediate fire-and-forget 복귀
**검증:** queue worker 모니터링, job 성공률
**브라우저 확인:** background job이 critical path에 영향 없음
**완료 기준:**
- saveContext / generate critical path는 queue 의존 없음
- 모든 background job은 retry + DLQ
- monitoring dashboard

**예상 시간:** 2일

---

## R7 — Reader UI Finalization
**목표:** reader-ux-architecture-proposal의 대안 B 적용 — 사이드바 medium + capture 통일 + placeholder 단계화.
**서브 phase:**

### R7.0 — 모바일 보정
- `public/css/components.css` — ep-end cards 모바일 1열 + collapsed default
- placeholder 시간 안내

### R7.1 — 사이드바에 신체 부상 신호만 추가
- `public/js/generate.js` — minimal 사이드바에 physical_state 작은 표시

### R7.2 — capture+ source 통일
- `public/js/generate.js` — captureEpisode가 ep-end markup을 직접 캡처

### R7.3 — placeholder 단계화 (R5 후)
- text_done 도착 → "정리 중" placeholder
- char_states 지연 시 보강 안내

**수정 파일:** 위에 명시
**위험도:** 낮음 (UI만)
**rollback:** revert
**검증:** verify_episode_end_character_cards.mjs 갱신
**브라우저 확인:** 모바일/태블릿/데스크톱 3 viewport 직접
**완료 기준:** 사용자 만족도

**예상 시간:** 1일

---

## R8 — Regeneration Architecture
**목표:** RegenerationDivergenceContract V2 (must_preserve 제거, 8→6 axis 통합) + sampling cap 모델별 + RegenIntroContract 통합.
**서브 phase:**

### R8.0 — Contract V2 정의
- `src/types/canonical.ts` — V2 type
- `src/services/regen_divergence.ts` — V2 builder

### R8.1 — Sampling cap 모델별
- `config/model_routes.json` — task config에 max_temperature 추가
- `src/services/model_router.ts` — cap 적용

### R8.2 — RegenIntroContract 흡수
- ep1 case는 V2 contract에 is_first_episode flag로 통합
- 기존 RegenIntroContract 코드 제거

### R8.3 — recurring threshold 3
- `audit_episode_regen_divergence.mjs` 갱신

### R8.4 — Phase 4.18B 재smoke
- 확깨용_TEST + 클린북 ep1/ep5/ep10 V2로 재smoke

**수정 파일:** 위에 명시
**위험도:** 중간
**rollback:** V2 type/builder revert
**검증:** audit_episode_regen_divergence.mjs jaccard / axis uniqueness 비교
**브라우저 확인:** 재생성 5회 다양성
**완료 기준:**
- ep1 jaccard < 0.10
- 재생성 prompt 토큰 1200→600
- 모델별 sampling cap 적용

**예상 시간:** 1일

---

## R9 — Model Routing Finalization
**목표:** intent 기반 mode + 운영 default + legacy path 차단.
**서브 phase:**

### R9.0 — Mode metadata
- `config/model_routes.json` — active_mode / modes / intent
- `src/services/model_router.ts` — active_mode 우선 read

### R9.1 — Trace metadata 강화
- `src/training/trace_logger.ts` — route_metadata.intent

### R9.2 — Legacy path 차단
- `src/api/generate.ts` — use_planner=false → 412 또는 auto-true

### R9.3 — Mode 영구 전환 (사용자 결정)
- active_mode = "production" (또는 "production_offline")
- 사용자 한 회차 smoke로 비용/품질 확인 후 commit

**수정 파일:** 위에 명시
**위험도:** 낮음 (config + 약간의 router 변경)
**rollback:** revert
**검증:** verify_route_integrity.mjs 갱신
**브라우저 확인:** 영구 전환 후 1화 생성 정상
**완료 기준:** 100화 actual 직전 단계

**예상 시간:** 0.5일

---

## R10 — 10/50/100화 Validation
**목표:** R1-R9 완료 후 단계적 actual run으로 회귀 / 품질 / 다양성 / 연속성 / 속도 모두 검증.
**서브 phase:**

### R10.0 — Smoke 5화
- production mode + clean book
- first_token_latency / state_taxonomy / regen 다양성 측정

### R10.1 — Validation 10화
- 같은 책 ep1-10 actual
- character_arc / foreshadow / continuity 추적

### R10.2 — Validation 50화
- 30화 actual에서 잘 됐던 baseline과 비교
- arc summary 품질, 인물 동기 일관성

### R10.3 — 100화 actual
- 비용 + 시간 견적 후 결정
- 사용자 승인 후

**수정 파일:** scripts/run_validation_*.mjs
**위험도:** 매우 높음 (시간/비용)
**rollback:** N/A — 결과 보관
**검증:** 종합 audit
**브라우저 확인:** 직접 읽기
**완료 기준:**
- 10화: 모든 verify PASS, 사용자 만족
- 50화: 30화 baseline과 동등 이상
- 100화: 결말 도달, arc 완성

**예상 시간:** 10화 1일, 50화 2-3일, 100화 4-5일 (모델 응답 시간 포함)

---

## 전체 일정 요약

| Phase | 시간 | 누적 | 비고 |
|---|---|---|---|
| R0 | 0.5h | 0.5h | tag + commit |
| R1 | 4-6h | ~7h | 문서 + CLAUDE.md |
| R2 | 1.5d | ~2d | prompt 가지치기 |
| R3 | 2-3d | ~5d | state taxonomy |
| R4 | 2d | ~7d | world bible canonical |
| R5 | 2-3d | ~10d | hybrid streaming |
| R6 | 2d | ~12d | async queue |
| R7 | 1d | ~13d | reader UI |
| R8 | 1d | ~14d | regen V2 |
| R9 | 0.5d | ~14.5d | routing |
| R10 | 7-10d | ~22d | validation |

**핵심 의사결정 포인트:**
- R1 후: GPT 더블 체크 + 사용자 승인
- R2 후: 측정 결과 보고 → R3 진행 여부
- R5 후: streaming 회귀 없는지 → R6 이전에 안정화 시간
- R10.3 (100화): 비용/시간 사용자 승인 필수

---

## 위험 매트릭스

| Phase | 본문 품질 | 속도 | 데이터 손실 | 회귀 가능성 |
|---|---|---|---|---|
| R0 | - | - | 없음 | - |
| R1 | - | - | - | - |
| R2 | 中 | 高 (개선) | - | 中 |
| R3 | 中 | - | 中 (migration) | 中 |
| R4 | - | - | 中 (v1→v2) | 中 |
| R5 | 中 | 매우 高 (개선) | - | 高 |
| R6 | - | 中 (개선) | - | 中 |
| R7 | - | - | - | 低 |
| R8 | 低 | 中 (개선) | - | 低 |
| R9 | - | - | - | 低 |
| R10 | - | - | - | (검증) |

---

## 추천 첫 구현 Phase

**R1 — Documentation & Architecture Map**

근거:
1. Phase 4.20 산출물(이 9개 docs)을 운영 SOP로 promotion하는 게 다음 phase의 기반
2. 코드 변경 없이 위험 거의 없음
3. CLAUDE.md 갱신으로 다음 agent의 작업 효율 향상
4. R2-R10 모든 phase가 R1의 정본 문서를 참조

R1 후 R2 (prompt 가지치기)로 측정 가능한 개선 시작 → R3-R10 단계적.
