# FlowScribe Architecture Map

> 운영자/agent가 e2e 흐름을 빠르게 파악하기 위한 SOP. 진단 자료는 `e2e-architecture-forensics.md`(긴 버전)에.

---

## 1. 한 줄 요약

**Modal에 입력된 World Bible** → `/api/context`로 저장 → **`/api/generate?use_planner=true`** → effective context 조립 → planner LLM → renderer LLM → state commit → **본문 한 번에 발행** → 사용자 화면 + 후처리(foreshadow/arc/audit) background.

**현재 구조의 한계:** SSE 형식이지만 token streaming이 아니다. 본문 가시 시점 = pipeline 전체 완료.

---

## 2. 데이터 영역

| 영역 | 저장소 | 용도 |
|---|---|---|
| World Bible | `books.context` (JSONB) + Redis cache | 사용자 입력 canonical |
| Genre/Background/Mood/Theme | `world_configs` 테이블 | derived index (Phase 4.19부터) |
| 일반/절대 규칙 | `world_rules` 테이블 (rule_type ∈ general/absolute_forbidden) | derived index |
| 인물 정본 | `canonical_characters` (name/type/gender/personality/initial_items) | derived |
| 회차 본문 | `episodes` | content + summary |
| 스냅샷 | `episode_snapshots` | effective_context dump per episode |
| 동적 상태 | `character_dynamic_states` | emotional_state/physical_state/location/items/recent_goal |
| 추론 상태 | `character_inferred_states` | partial signals |
| 아크 | `arc_summaries`, `character_arcs` | 다단 회상 |
| 복선 | `foreshadows` | open/closed |
| 학습 trace | `run_traces` | DPO/reward 소스 |
| 음성 자산 | `voice_archive`, `voice_*_metadata` | TTS |

read 흐름은 `docs/world-bible-canonical-source.md` 참조.

---

## 3. 핵심 e2e 시퀀스

### 3.1 World Bible 입력 (saveContext)

```
modal saveContext()
  └─> POST /api/context
       ├─ Redis SET context:<bookId>
       ├─ books.context UPDATE
       ├─ world_configs UPSERT
       ├─ world_rules INSERT (active=true)
       ├─ canonical_characters upsert
       └─ setImmediate: item description LLM enrich  ← background, 응답에 영향 없음
```

p95 < 2s 목표 (Phase 4.19C에서 setImmediate로 분리, 측정 R1.5).

### 3.2 본문 생성 (planner path)

```
GET /api/generate?episode=N&book_id=X&use_planner=true
  ├─ DELETE 동일 회차 dynamic_states/foreshadows  (재생성 격리)
  ├─ buildEffectiveContext (DB 6-10 read)
  ├─ saveEpisodeSnapshot (fire-and-forget)
  ├─ detectGenerationMode + buildRegenDivergenceContract  (재생성)
  ├─ recent_hook_types fetch
  │
  ├─ runPlannerPipeline ★batch★
  │     ├─ creativePlanner LLM (8-15K tokens, 5-10s)
  │     ├─ planValidator (결정론)
  │     ├─ rendererLLM (6-10K tokens, 5-10s) ← 본문 텍스트 완성
  │     ├─ sanitizer
  │     ├─ continuityCheck (ep>=2)
  │     ├─ episodeDeltaCheck
  │     ├─ judgeAndRepair (조건부 LLM, 5-15s, 본문 변경 위험)
  │     ├─ commitDynamicState (DB 5-15 write)
  │     └─ proseValidation/revision (현재 doValidate=false / doRevise=false)
  │
  ├─ res.write({token: full_text})  ← ★첫 가시 시점, batch라 사실상 pipeline 끝
  ├─ saveEpisode
  ├─ getLatestDynamicStates
  ├─ res.write({done, char_states, episode_meta})
  └─ res.end()
```

후처리 (background): foreshadow / arc summary / reader_fast audit.

### 3.3 Reader UX (token + done 처리)

```
public/js/generate.js:
  ├─ json.token → output DOM + pacingAppend + ep-end placeholder 표시 (Phase 4.19C)
  ├─ json.done → updateSceneCharPanel(char_states)
  │     ├─ 사이드바 minimal (이름+성별)
  │     └─ renderEpisodeEndCharCards (본문 하단 detailed)
  └─ wrapCharNamesInOutput → 성별별 정적 밑줄
```

---

## 4. Critical Path

**현재 blocking (본문 가시까지):**
1. buildEffectiveContext (1-2s)
2. creativePlanner LLM (5-10s)
3. rendererLLM (5-10s)
4. judgeAndRepair (조건부, 5-15s)
5. commitDynamicState (0.1-0.3s)

**총 예상:** 11-25s (judge 미발동), 16-40s (judge 발동).

**R5 (hybrid streaming)에서 background로 뺄 후보:**
- continuityCheck → audit log only
- episodeDeltaCheck → audit log only
- judgeAndRepair → 본문 변경 안 함, 다음 회차 ctx에만 반영
- commitDynamicState → token 발행 후

상세: `docs/critical-path-baseline.md` (R1.5 측정 후) + `e2e-architecture-forensics.md`.

---

## 5. 핵심 모듈 — file:line 매핑

| 영역 | 핵심 함수 / 파일 |
|---|---|
| context save | `src/api/context.ts`, contextRouter.post |
| effective context build | `src/services/effective_context.ts:62 buildEffectiveContext` |
| generation entry (planner path) | `src/api/generate.ts:95-310` |
| planner (LLM 호출) | `src/pipeline/planner.ts:281+ buildPlannerSystemPrompt + buildPlannerUserPrompt` |
| renderer (LLM 호출) | `src/pipeline/renderer.ts:22+ buildRendererSystemPrompt` |
| pipeline 통합 | `src/pipeline/index.ts:113 runPlannerPipeline` |
| state extraction | `src/pipeline/state_extractor.ts` |
| state normalize | `src/services/language_guard.ts` |
| state commit | `src/services/character_state.ts commitDynamicState` |
| regen divergence | `src/services/regen_divergence.ts` |
| model routing | `src/services/model_router.ts`, `config/model_routes.json` |
| reader UI | `public/js/generate.js`, `_buildSceneCharDetailedCardHtml`, `renderEpisodeEndCharCards` |

---

## 6. 측정 도구 (Phase 4.19C/4.20)

logger 채널:
- `api:context:save:latency`: context_save_start / context_db_save_done / context_response_sent / item_desc_bg_start / item_desc_bg_done / item_desc_bg_error
- `api:generate:latency`: request_start / effective_context_done / pipeline_start / pipeline_done(planner_ms,renderer_ms,total_pipeline_ms) / first_token_sent / char_states_fetched / done_sent

baseline 측정 스크립트: `scripts/measure_*.mjs` (R1.5).

---

## 7. Refactor Roadmap 진입점

`docs/refactor-roadmap-v2.md`의 R0~R10 단계. 진행 결정은 사장.

현재 위치: **R0-R1.5 완료 → R2 결정 대기.**
