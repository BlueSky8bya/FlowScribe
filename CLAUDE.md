# CLAUDE.md
## FlowScribe Agent Bootstrap

> 이 문서는 **bootstrap + routing**만 담당한다. 세부 정책은 `docs/`의 SOP에 있다.
> 처음에는 이 문서만 읽고, 필요한 영역 하나만 추가로 연다.

---

## 1. Project Purpose

FlowScribe는 범용 챗봇이나 단순 텍스트 생성기가 **아니다**.
사용자의 독서 로그와 상태 벡터를 바탕으로 서사 경험을 점진적으로 최적화하는 **적응형 문학 연출 시스템**이다.

**사용자(사장)의 지시가 최우선.** 충돌 시 충돌을 명확히 보고하고 사장의 판단을 기다린다. 독단 확장 금지.

**급훈: 알잘딱깔센** — 알아서 잘 딱 깔끔하고 센스있게.

핵심 5축:
1. 독자 몰입 (본문 품질)
2. 재생성 다양성
3. 사용자 직접 만든 세계관 존중
4. 빠른 체감 속도
5. 명확한 상태 구조

---

## 2. Absolute Safety / Git Rules

### 절대 금지
- `git push --force` to main, `git push origin main`, `--no-verify` (사용자가 명시 요청 시 외)
- DB migration 무단 실행
- `.env`, API key, raw prompt/response, generated story full text 커밋
- `git add .` (특정 파일만 staging)
- 무관 파일 커밋: `.claude/scheduled_tasks.lock`, `scripts/cloud_dpo/launch_dpo.py`
- 특정 책/장르/인물/아이템 전용 하드코딩 또는 if문
- 특정 단어를 막기 위한 금지어 추가
- judge 점수 맞추기용 prompt 조작
- 사장 승인 없는 production route 영구 전환
- 사장 승인 없는 100/50/30화 actual

### 항상 준수
- 위험 작업(force push / reset --hard / DB migration / cleanup apply / 100화 actual) 전 반드시 사장 승인
- 새 commit으로 처리 (amend 대신)
- specific files 명시 staging
- pre-commit hook 실패 시 root cause 수정 (skip 금지)

자세한 보안: 어떤 영역도 .env / credentials / raw output을 로그에 남기지 말 것.

---

## 3. Current Architecture Map

```
src/
  api/         REST/SSE 엔드포인트 (generate, context, books, characters, …)
  pipeline/    planner / renderer / state_extractor / plan_validator / sanitizer
  services/    character_state, effective_context, regen_divergence, model_router,
               item_desc, foreshadow, language_guard, story
  lib/         db, redis, llm, logger
  types/       canonical, planner
  training/    trace_logger, reward_aggregator, ending_reward, trajectory_reward
  queues/      BullMQ 큐 정의 (현재 일부)
  db/          migrate scripts

public/
  index.html
  js/          generate, ui, modal, chips, rules, chars, suggest, app, voice, auth
  css/         tokens, layout, components, modal

config/        model_routes.json
docs/          architecture map + SOP들 (§4 참조)
scripts/       verify_*, audit_*, debug_*, setup_*, cleanup_*, experiments/
workflows/, profiles/, story_data/, logs/, tools/, assets/, .tmp/
```

핵심 데이터 흐름은 `docs/architecture.md` 참조.

---

## 4. Where to Read for Each Task

| 작업 영역 | 트리거 | 정본 문서 |
|---|---|---|
| 전체 구조 / e2e 흐름 | "어디가 느린가", "어떤 단계가 있는가" | `docs/architecture.md` |
| 본문 생성 (planner/renderer/state) | 생성 디버깅, prompt 튜닝 | `docs/story-generation-sop.md` |
| 상태 분류 (감정/성격/관계/역할) | "친절한"이 감정에 뜸, taxonomy | `docs/state-taxonomy-sop.md` |
| 재생성 다양성 | divergence contract, 1화 vs N화 | `docs/regeneration-sop.md` |
| 세계관 저장/조회 | books.context vs derived index | `docs/world-bible-canonical-source.md` |
| Reader UX | 사이드바, ep-end cards, hover, capture | `docs/reader-ux-sop.md` |
| 검증/감사 | verify/audit/debug script 사용법 | `docs/audit-sop.md` |
| 모델 라우팅 | route 결정, intent mode, provider 변경 | `docs/model-routing-ops.md` |
| 사용자 상태 (4계층) | reader profile, calibration | `profiles/README_profiles.md` |
| 서사 메모리 | rolling summary, foreshadow, arc | `story_data/README_story_data.md` |
| 행동 로그 | calibration source, reward signal | `logs/README_logs.md` |
| 음성 자산 | TTS, voice archive | `assets/README_assets.md` |
| 절차/예외 처리 | director mode, release | `workflows/README_workflows.md` |
| 코드 구현 디테일 | 함수 책임, DB schema | `tools/README_tools.md` |

원칙: **하나만 읽고 실행으로 돌아간다.** 한 영역으로 부족할 때만 두 번째.

---

## 5. Do-Not-Do List (recurring 함정)

- ❌ 단발 hotfix를 반복해 구조를 꼬이게 하기 (Phase 4.20 forensic 직전 상태) → 구조적 문제는 docs/SOP로 가서 R-phase로 단계화
- ❌ runPlannerPipeline 안에 새 step 추가 → critical path 압박. background job 우선 검토
- ❌ planner/renderer prompt에 새 [금지] section 추가 → negative dominance 심화. positive guidance 또는 contract type으로
- ❌ emotional_state에 personality/role/relationship 단어 통과 허용 → R3 taxonomy 분리 위반
- ❌ books.context 외 곳에 사용자 입력 직접 저장 → R4 canonical source 위반
- ❌ "특정 책에서만 작동하는" 코드 추가 → 일반화 가능한 형태로
- ❌ verify/audit script를 100개 더 만들기 → 중복 점검 후 추가
- ❌ R-roadmap을 무시하고 단계 건너뛰기 → 측정 baseline 없이 R5 streaming 등 위험 phase 착수

---

## 6. Commit Policy

### 메시지
- 한국어 OK, prefix는 conventional (feat/fix/docs/perf/refactor/test/chore)
- 1줄 제목 + 빈 줄 + body
- body에 변경 이유, 측정 결과, 위험/제외 항목

### 흐름
1. `git status -s` / `git diff --stat HEAD` 로 변경 확인
2. specific files만 add (절대 `.`)
3. heredoc로 메시지 (한국어 multi-line)
4. `git status -s`로 결과 확인
5. push는 사용자 요청이 있을 때만, main은 절대 금지

### Co-author
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

상세는 system prompt 또는 사용자 안내 시 따른다.

---

## 7. Verification Policy

### 코드 변경 시 필수
- `npm run build` (tsc) 통과
- 변경 파일에 해당하는 verify script 실행:
  - planner/renderer → `verify_world_rule_integrity` `verify_episode1_regeneration_intro_contract` `verify_route_integrity`
  - state/normalizer → `verify_state_language_guard` `verify_emotion_label_normalization`
  - UI → `verify_episode_end_character_cards` `verify_reading_mode_scroll_anchor`
  - context save → `verify_context_save_async`
  - generation latency → `verify_generation_latency_markers`
  - regen → `verify_regeneration_divergence_contract`
  - item ledger → `verify_item_location_ledger`
  - placeholder → `verify_episode_end_placeholder`

### 측정 (Phase 4.20 R1.5)
- `scripts/measure_prompt_budget.mjs` (정적, 즉시 실행 가능)
- `scripts/measure_context_save_latency.mjs` (사용자 환경에서 실행)
- `scripts/measure_generation_baseline.mjs` (사용자 환경에서 실행)

baseline 결과는 `docs/measurement-baseline-phase4.20.md` / `docs/prompt-budget-baseline.md` / `docs/critical-path-baseline.md`에.

### Audit (DB 데이터 검증, 책 단위)
- `audit_world_rule_integrity.mjs --book-id <X>`
- `audit_world_rule_violation.mjs --book-id <X> --episode N`
- `audit_episode_regen_divergence.mjs --book-id <X>`
- `audit_episode_end_item_state.mjs --book-id <X> --episode N`
- `audit_regen_overconstraint.mjs --book-id <X>`

### 브라우저 수동 확인
UI/UX 변경은 코드 verify로는 시각 회귀를 잡을 수 없다. 사용자에게 직접 확인 요청.

---

## 부록 A. 디렉토리별 README와의 관계

`workflows/`, `profiles/`, `story_data/`, `logs/`, `tools/`, `assets/`, `.tmp/`의 README는 각 영역의 정본. CLAUDE.md는 "어디로 갈지"만 안내, 정책 본체는 README에. 영역 간 경계가 모호한 새 주제는 `docs/`의 SOP로.

## 부록 B. 응답/출력 디스시플린

- 짧고 정확하게. tool 호출 전 한 줄 안내.
- 사장이 안 묻는 정보를 자발적으로 길게 보고하지 말 것.
- 기능 추가/refactor를 task 범위 밖으로 확장하지 말 것.
- 코드 변경은 최소 diff. 주석은 hidden constraint나 "왜"가 비자명할 때만.

## 부록 C. Phase 추적

작업 단위는 사용자가 부여한 Phase 이름(`Phase 4.x`, `Phase R0-R1.5` 등)을 그대로 사용. 커밋 메시지에 Phase 라벨 명시.
