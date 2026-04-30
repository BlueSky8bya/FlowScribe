# Phase 4.20 — End-to-End Architecture Forensics

> 작성일: 2026-05-01
> 작성자: Phase 4.20 forensic
> 후속 문서: `refactor-roadmap-v2.md`, `state-taxonomy-proposal.md`, `performance-critical-path-audit.md`,
> `reader-ux-architecture-proposal.md`, `regeneration-architecture-proposal.md`,
> `world-bible-canonical-source-proposal.md`, `model-routing-ops-proposal.md`,
> `claude-md-rewrite-proposal.md`

이 문서는 FlowScribe 코드/문서/UI/DB/LLM agent 흐름 전수조사 결과를 정리한다.
**구현 변경은 포함하지 않는다.** 이 문서가 GPT 더블 체크의 입력이 된다.

---

## 0. 한 줄 요약

지금 프로젝트는 **batch 구조 위에 streaming 가면을 씌운 generation API**, **prompt에 누적된 contract 압박**,
**emotion/personality/role 필드의 의미 충돌**, **9 routes × 6 task slot의 중복**, **113개 script의 적체**가 겹쳐
"본문 출력이 느리고 인물 카드가 이상하다"는 단발 증상으로 표면화됐다. 단발 hotfix로 더 풀 수 없다.

---

## 1. End-to-End Flow Map

### 1.1 World Bible 입력 → context 저장

```
사용자 UI (modal.js saveContext)
  └─> POST /api/context
        ├─ Redis SET context:<bookId>           [동기, ms]
        ├─ books.context UPDATE                  [동기, ms]
        ├─ world_configs UPSERT                  [동기, ms]      (Phase 4.19 추가)
        ├─ world_rules INSERT (general/forbidden) [동기, ms]      (Phase 4.19 추가)
        ├─ canonical_characters upsert (5건)     [동기, ~100ms]
        └─ generateAndSaveItemDescriptions       [setImmediate, fire-and-forget]  (Phase 4.19C 수정)
                인물별 Promise.all 병렬, LLM 5건 비동기
```

**상태:** saveContext 응답 자체는 빠르게 반환 (Phase 4.19C에서 setImmediate로 분리).
응답 후 background에서 인물 5명 description LLM enrich가 병렬 실행. critical path 영향 없음.

### 1.2 Generation Request — Planner Path (use_planner=true)

```
GET /api/generate?episode=N&book_id=X&use_planner=true&model_route=Y
  └─> SSE 응답 시작 (heartbeat ping)
        │
        ├─ DELETE 동일 회차의 character_dynamic_states / foreshadows  [재생성 격리]
        ├─ buildEffectiveContext(book_id, N)                           [DB 6-10회 read]
        ├─ saveEpisodeSnapshot (fire-and-forget)
        ├─ detectGenerationMode + buildRegenDivergenceContract          [재생성만]
        ├─ recent_hook_types fetch                                      [DB 1회]
        │
        ├─ runPlannerPipeline(ctx, ...)         ★ 본문 가시 전 모든 await ★
        │     ├─ creativePlanner LLM            [8-15K tokens, 8-10s]
        │     ├─ planValidator (결정론)
        │     ├─ rendererLLM                    [6-10K tokens, 5-8s] ← 본문 텍스트 완성
        │     ├─ sanitizer
        │     ├─ continuityCheck (ep>=2)
        │     ├─ episodeDeltaCheck
        │     ├─ judgeAndRepair (조건부 LLM, 5-15s) ← 본문 변경 위험
        │     ├─ commitDynamicStates (DB 5-15회 write)
        │     └─ proseValidation/revision (현재 false로 skip)
        │
        ├─ res.write({token: full_text})        ← 첫 본문 가시 시점 (전체 한 번에)
        ├─ saveEpisode (DB write)
        ├─ getLatestDynamicStates (DB read)
        ├─ res.write({done, char_states, episode_meta})
        └─ res.end()
```

**핵심 진단 (forensic):**
- `runPlannerPipeline`은 모든 step을 await한 후 반환한다. SSE 형식이지만 token chunk streaming 아님.
- 본문이 사용자에게 보이는 순간 = `pipeline_done` 시점 = **planner LLM + renderer LLM + (optional) judge/repair LLM 모두 끝난 후**.
- 일반적 latency 추정: 14-25초 (judge 발동 시 +5-15초).

### 1.3 Generation Request — Legacy Path (use_planner=false)

```
GET /api/generate?... (use_planner=false 또는 book_id 없음)
  └─> streamEpisode(ctx, res)  [src/services/story.ts]
        │
        ├─ LLM 직접 prompt (planner 없음)
        ├─ token streaming은 model client 호출 결과에 따름
        └─ State commit: fire-and-forget, plan validation 없음
```

**위험:** `logWarn("legacy_path — DPO 수집 불가")` 만 띄우고 막지 않는다. 외부 호출자가 우연히 use_planner를 떨구면 무성의 fallback. **제거 또는 제한 권장.**

### 1.4 후처리 (background)

```
setImmediate(async () => {
  ├─ extractAndStoreForeshadow                 [LLM 호출]
  ├─ checkAndResolveForeshadows                [LLM 호출]
  ├─ generateAndSaveArcSummary (arc 경계만)    [LLM 호출]
  └─ scheduleBackgroundAudit (reader_fast)     [LLM 호출, reward v2 보완]
});
```

각 후처리는 본문 응답 후 실행. 사용자 critical path에 미치는 영향 없음.

### 1.5 Reader UX

```
generate.js
  ├─ token 도착 → pacingAppend → output DOM
  ├─ token 첫 도착 → episodeEndCards에 placeholder ("정리 중") 표시  [Phase 4.19C]
  ├─ done event → updateSceneCharPanel(char_states)
  │     ├─ 사이드바: 이름+성별만 (minimal)        [Phase 4.19]
  │     └─ renderEpisodeEndCharCards: 본문 하단 detailed 카드
  └─ wrapCharNamesInOutput → 성별별 정적 밑줄
```

캡처 모드, regen, audit 폴링, debug 패널은 별도 흐름.

---

## 2. 주요 병목 / 위험

### 2.1 성능 병목 (Top)

| 위치 | 영향 | 비고 |
|---|---|---|
| `runPlannerPipeline` await — batch | 첫 본문 가시 = pipeline 전체 완료 | streaming 가짜, 핵심 문제 |
| `judgeAndRepair` LLM (선택) | +5-15s, 본문 변경 위험 | hint 자주 발생 |
| renderer prompt size 6-10K | LLM 처리 시간 증가 | **section 20+개 누적** |
| planner prompt size 8-15K | 동일 | **section 22+개 누적** |
| state extraction 시점 | `runPlannerPipeline` 내부에서 처리 → 본문 await에 포함 | background로 분리 가능 |
| post_validation/revision (현재 off) | on 시 +20-40s | 운영 default off 유지 권장 |

### 2.2 Prompt 과제약

planner user prompt에 **22개 section**이 conditional하게 누적된다:

| Section | 조건 | 평균 길이 |
|---|---|---|
| [N화]/[목표]/[필수사건]/[엔딩훅방향] | 항상 | 짧음 |
| [연재계약] | 항상 | 짧음 |
| [서사국면] | 항상 | 중간 |
| [★세계관장소제약] | worldLabel 있을 때 | **긴 단락 (5조)** |
| [작가개입] | active_interventions 있을 때 | 중간 |
| [절대규칙] | absolute_forbidden 있을 때 | 가변 + 안내문 |
| [이번화제약] | episode_forbidden/required 있을 때 | 짧음 |
| [인물현재상태] | 항상 | 긴 단락 |
| [직전화여파] | prev_event_summary 있을 때 | 짧음 |
| [연속성계약] | ep>=2, contract 있을 때 | **매우 긺 (known_facts + forbidden_regressions + character_position_state + emotional_progression)** |
| [직전화말미] | ep>=2 | 긴 단락 |
| [스토리흐름] | rolling_summary/arc_summaries | 긴 단락 |
| [인물아크] | character_arcs | 중간 |
| [숨은정보] | hidden_info | 짧음 |
| [일반규칙] | 항상 | 가변 |
| [미회수복선] | 항상 | 가변 |
| [hook_type다양성] | recent_hook_types | 짧음 |
| [비활성인물로테이션] | ep>=3 | 중간 |
| [재생성분기계약] | regen contract | **매우 긺** |
| [반복방지] | 가변 | 중간 |
| [첫화도입부원칙] | ep=1 | 긴 단락 |

renderer system prompt도 **20+개 section**. 누적 시 모델 context window 50% 이상을 instruction이 차지할 수 있다.

### 2.3 State Taxonomy 오염

`character_dynamic_states.emotional_state`에 "친절한", "팀워크", "신입" 같은 **감정이 아닌 값**이 들어간다.

추적:
1. planner prompt에 `"emotional_state": "짧은 상태어, 예: 불안, 결의, 공포"` 명시 ([planner.ts:305](../src/pipeline/planner.ts#L305))
2. LLM이 prompt 무시 → "친절한"(성격) / "팀워크"(관계) / "신입"(역할) 출력
3. `extractStateUpdates` JSON 추출 — 변환 없음
4. `normalizeEmotionalState` — **한국어 포함 시 무조건 통과** ([language_guard.ts:90](../src/services/language_guard.ts#L90))
5. `commitDynamicState` DB 저장
6. UI `_emotBadgesHtml` — 그대로 표시

**근본 원인:** schema/타입 자체가 emotion / personality_trait / role_status / relationship_dynamic을 분리하지 않아서 LLM이 한 칸에 다 욱여넣을 수 있는 구조.

상세는 `state-taxonomy-proposal.md`.

### 2.4 World Bible 다중 source

**같은 정보가 4곳에 저장:**
1. `books.context` (JSONB) — `worldBible.world_rules`, `forbidden_settings`, `character_defaults`, `story_config`
2. `world_configs` 테이블 — `genre/background/mood/theme/common_tone`
3. `world_rules` 테이블 — `rule_type ∈ {general, absolute_forbidden}`
4. `canonical_characters` 테이블 — name/personality/type/gender/initial_items
5. Redis `context:<bookId>` — books.context의 캐시

**동기화 책임:** /api/context POST가 5곳 모두 채운다 (Phase 4.19에서 추가). 그러나 read 측은:
- `effective_context` → world_configs + world_rules + canonical_characters + Redis 모두 fallback chain
- restoreContextUI → Redis(`/api/context/:bookId`) → books.context fallback

**위험:** UI는 books.context, generation은 world_rules 테이블. 둘이 desync되면 사용자가 본 설정과 LLM이 받는 컨텍스트가 다르다. Phase 4.19에서 봤던 "확깨용 절대 규칙이 본문에 안 반영" 문제 그 결.

상세는 `world-bible-canonical-source-proposal.md`.

### 2.5 Model Routing 혼선

`config/model_routes.json`:
- `active_route: "baseline_local"` (qwen2.5:14b)
- `available routes: 9개` — baseline_local / deepseek_renderer / deepseek_planner / deepseek_full / gemini_planner_deepseek_renderer / **high_quality_ensemble** / gemma3_12b_fast_local / gemma3_27b_full_local / gemma3_27b_planner_deepseek_renderer

각 route가 **6개 task slot**(planner/renderer/narrative_repair/post_validator/post_revision/world_setting_suggest 등)을 정의. 즉 9 × 6 = 54개 model 매핑.

**혼선 근거:**
- per-request `?model_route=high_quality_ensemble` 가능하나 active_route는 baseline_local 그대로
- 사용자가 "100화 actual 전에 active_route 영구 전환" 결정 보류 중
- 어떤 route가 "운영" / "smoke" / "offline" / "training"용인지 의미 라벨 없음
- legacy path는 model router를 거치지 않고 직접 `getRendererModel()` 사용

상세는 `model-routing-ops-proposal.md`.

### 2.6 UI-State Mismatch

- 사이드바(`#sceneCharPanel`)와 본문 하단(`#episodeEndCards`)이 같은 `_currentCharStates`에서 렌더 — 데이터 1소스, 표현만 분리. 일관성은 OK.
- 그러나 **장르 prefix가 world_rules에 잠입**: 사용자가 modal에서 "장르: 이세계, 판타지"를 입력하면 modal.js:263이 `장르: ${genres.join(", ")}` 문자열을 `world_rules` 배열 첫 줄에 넣는다. 이후 /api/context POST가 첫 줄을 `world_configs.genre`로 추출 ([context.ts](../src/api/context.ts) Phase 4.19). **두 의미가 한 필드에 섞임.**
- regen 시 이전 ep의 `_currentCharStates`가 잠시 보일 위험 → Phase 4.19C에서 `_clearDebugPanels`로 hide 처리.

### 2.7 Scripts 적체

113개 `.mjs` (verify 49 / audit 30 / experiments 12 / setup 9 / debug 4 / 기타 9). 중복:
- `verify_ui_logic` vs `verify_runtime_ui` vs `verify_e2e_ui` — 범위 모호
- `setup_smoke_47` / `setup_smoke_book_phase49` / `setup_smoke_book_46` — 번호 누적
- 사용 빈도 낮은 audit 다수 (gemini_*, multi_judge_* 등)

**제안:** `scripts/verify/`, `scripts/audit/`, `scripts/setup/`, `scripts/cleanup/`, `scripts/debug/`, `scripts/experiments/` 6개 하위 폴더 + naming convention. 별도 inventory script로 deprecated 식별.

---

## 3. 본문 추론 능력 저하 가설

사용자가 "본문 추론 능력이 갑자기 저하된 느낌"이라고 했다. 가능한 원인:

| 가설 | 근거 | 우선순위 |
|---|---|---|
| **prompt 과부하**: 22+ section 누적 → 창작 token 여유 압박 | planner 8-15K, renderer 6-10K | 高 |
| **negative constraint 우세**: "금지/하지 말 것/회피" 항목이 "허용/권장"보다 많음 | Phase 4.18에서 `audit_regen_overconstraint`가 이미 측정 | 高 |
| **continuity_contract 과강제**: forbidden_regressions + character_position_state + emotional_progression이 동시 출력 | ep>=2면 항상 emit | 中 |
| **judge & repair 발동률**: hint 자주 발생 → repair LLM이 본문 일부 변경 | hint = continuity_check + delta_check 결과 | 中 |
| **active_route = qwen2.5:14b**: 14B local model이 22+ section 처리하기에 한계 | baseline_local 운영 default | 高 |
| **regen contract over-anchoring**: N_old signature + recurring_patterns + must_vary 동시 | 재생성 시만 | 中 |

**가장 가능성 높은 조합:** prompt 과부하 + 14B local 모델 + negative 우세 → 모델이 안전한 "공식적" 본문으로 회귀. high_quality_ensemble 사용 시 일부 완화되지만 prompt 무게는 그대로.

---

## 4. Critical Path 재정의 필요성

현재 `runPlannerPipeline` 안에 들어 있지만 **본문 가시성에 필요 없는 step**:

| Step | 필수성 | 분리 가능 |
|---|---|---|
| creativePlanner | 필수 | NO (renderer가 plan 필요) |
| planValidator | 필수 | NO |
| renderer | 필수 (본문 자체) | NO |
| sanitizer | 필수 (token 단위 가능) | 부분 |
| continuityCheck | 후처리 | YES — background |
| episodeDeltaCheck | 후처리 | YES — background |
| judgeAndRepair | 본문 수정 주의 | **분리 시 다음 회차 컨텍스트로 반영** |
| commitDynamicState | 후처리 | YES — background |
| proseValidation/revision | optional, 현재 off | YES |

**즉시 가능한 개선** (R5에서):
- continuityCheck / deltaCheck → background로 이동, hint 모음만 유지
- commitDynamicState → token 발행 후 background
- judge/repair → 본문 노출 후 다음 회차 컨텍스트에만 반영 (사용자가 본 본문은 변경 안 함)

상세는 `performance-critical-path-audit.md`.

---

## 5. 무엇이 여전히 잘 작동하는가 (보존)

부정적 진단만 나열했으나, 이미 좋은 구조도 있다 — **부수지 않도록 명시**:

- saveContext의 `setImmediate` 분리 (Phase 4.19C) — 정상
- `RegenerationDivergenceContract`의 N_old signature 압축 (full beat dump 제거) — 정상
- `_buildSceneCharDetailedCardHtml` helper 추출 — 사이드바와 ep-end가 같은 코드 사용
- `verify_*` 정적 검증 패턴 — 비교적 견고
- `cleanup_test_book_state_cache.mjs` dry-run 패턴 — 모범 사례
- `align-items: start` grid fix — 정확한 진단
- 성별 밑줄 정적 색 — hover 제거 후의 자연스러운 단서

---

## 6. 결론

| 영역 | 진단 |
|---|---|
| 속도 | batch가 streaming 가면 쓴 구조. critical path 외 step을 background로 분리해야 함 |
| 상태 | emotion / personality_trait / role / relationship 분리 안 된 단일 칸 schema → taxonomy 리팩터 |
| 규칙 | world_rules의 다중 source + UI/generation desync → canonical source 일원화 |
| 라우팅 | 9 × 6 매핑, label 없는 active_route → 의미 라벨 + 운영 default 결정 |
| UI | Phase 4.19 minimal 사이드바 + ep-end cards는 방향 OK, 다만 placeholder UX 한 박자 부족 |
| 재생성 | RegenerationDivergenceContract 자체는 효과 있으나 prompt 과부하의 일부 |
| 문서 | CLAUDE.md 360줄, 폴더별 README 6개 = 1268줄. 위임 구조는 OK이나 Phase 4.x 변경 반영 부족 |
| Scripts | 113개 적체. 카테고리 폴더 + naming + deprecated 표시 필요 |

**Refactor blueprint**는 `refactor-roadmap-v2.md`로 분리. R0~R10 단계, 각 Phase의 목표/위험/rollback/검증 명시.
