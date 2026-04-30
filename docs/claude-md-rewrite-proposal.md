# CLAUDE.md Rewrite Proposal — Phase 4.20

> 본 문서는 현재 CLAUDE.md(360줄) + 폴더별 6개 README(1,268줄)의 구조를 재정리하는 제안서다.
> 실제 CLAUDE.md를 수정하지 않는다. 이 제안을 GPT 더블 체크 후 R1에서 별도 적용한다.

---

## 1. 현재 상태 진단

### 1.1 CLAUDE.md (360줄)

**작동 방식:** Bootstrap + Routing 전용. 세부 정책은 폴더별 README로 위임. 양식 자체는 좋다.

**문제:**
- Phase 4.x 변경(Phase 4.10~4.19C)이 CLAUDE.md에 직접 반영되지 않음
- "Project Structure" 섹션의 디렉토리 트리가 일부 outdated (e.g., src/training/, src/queues/ 등 새 영역 누락)
- "Routing Rules"의 5.1-5.9 영역 분류가 추상적 — 신입 agent에게 "world rule integrity 디버깅"이 어느 폴더인지 매핑 어려움
- "Read Minimization Policy"는 명시되지만 실제 Claude 호출 시 폴더 README 6개 모두 로드되는 일이 잦음

### 1.2 폴더별 README (1,268줄 합계)

```
workflows/README_workflows.md     193줄
profiles/README_profiles.md       259줄
story_data/README_story_data.md   201줄
logs/README_logs.md               196줄
tools/README_tools.md             155줄
assets/README_assets.md           174줄
```

**문제:**
- workflows ↔ tools ↔ profiles 경계 모호 (예: "API 연동 디버깅"은 어느 폴더?)
- Phase 4.x 정책(generation pipeline, regen contract, world bible canonical)을 어디에 둘지 불명
- 실제 코드와 문서 sync 부족 (e.g., src/pipeline/index.ts의 상세 흐름은 어느 README에도 없음)
- 새 운영자/agent에게 "이 시스템 어떻게 작동하나요?" 한 문서로 안내 불가

### 1.3 docs/ (별도 디렉토리)

`docs/`는 `agent-routing-inventory.md`, `architecture/`, `benchmarks/`, `character_policy_design.md`, `experiments/`, `long-story-memory-audit.md`, `model-availability-matrix.md`, `model-routing-strategy.md`, `policies/`, `story-quality-audit-summary.md`, `story-quality-root-cause-refactor-plan.md`, `training/` 등 다양. **Phase 4.x 작업 산출물은 docs/에 들어가는데 CLAUDE.md 라우팅에 미언급.**

---

## 2. 제안 구조

### 2.1 CLAUDE.md (목표 ~ 200-250줄)

```markdown
# CLAUDE.md
## FlowScribe Agent Bootstrap

## 1. Role
[기존 유지]
- 사용자(사장) 우선, 알잘딱깔센
- FlowScribe = 적응형 문학 연출 시스템

## 2. Startup Contract
[기존 유지 — 이 문서 + 가장 가까운 영역 하나]

## 3. Core Rules
[기존 핵심 6개 유지]
3.1 Workflow First
3.2 External Personalization Only
3.3 Data-Driven Decisions
3.4 Narrative Consistency
3.5 Director Mode is L0
3.6 Secret Safety

## 4. Project Structure
[현재 outdated 부분 갱신]
- src/api, src/pipeline, src/services, src/lib, src/types
- src/training, src/queues, src/db
- public/js, public/css, public/index.html
- scripts/{verify,audit,setup,cleanup,debug,experiments}/  ← R2.5 정리 후
- docs/, workflows/, profiles/, story_data/, logs/, tools/, assets/, .tmp/
- config/

## 5. Routing — 영역 + 그 폴더의 정본 문서
[수정: 폴더 → 정본 docs 매핑]
| 영역 | 트리거 | 정본 문서 |
|---|---|---|
| 코드 구현 | 함수 작성/수정 | tools/README_tools.md, docs/architecture/* |
| 생성 파이프라인 | planner/renderer/state | docs/story-generation-sop.md ★신규 |
| 사용자 상태 | reader profile, calibration | profiles/README_profiles.md |
| 서사 기억 | rolling summary, foreshadow, arc | story_data/README_story_data.md |
| 행동 로그 | calibration source | logs/README_logs.md |
| 음성 자산 | TTS, voice_archive | assets/README_assets.md |
| 절차/SOP | director mode, exception handling | workflows/README_workflows.md |
| 모델 라우팅 | route 변경, 비용/품질 결정 | docs/model-routing-strategy.md |
| 평가/감사 | verify/audit script | docs/audit-sop.md ★신규 |

## 6. Read Minimization Policy
[기존 유지]

## 7. Execution Minimum
[기존 유지 — Goal/Inputs/Active State/Deliverables]

## 8. Output Discipline
[기존 유지]

## 9. Non-Goals
[기존 유지 — 범용 챗봇 만들지 말 것 등]

## 10. Priority Order
[기존 유지]

## 11. Final Rule
[기존 유지]
```

### 2.2 신규 문서 (docs/)

#### `docs/story-generation-sop.md` ★신규 — Phase 4.20 산출물
- buildEffectiveContext → planner → renderer → state extraction의 e2e 흐름
- 본 phase의 `e2e-architecture-forensics.md`를 운영 SOP로 다듬은 버전

#### `docs/audit-sop.md` ★신규
- verify_*.mjs 사용법
- audit_*.mjs 사용법
- 어떤 verify가 어떤 영역을 커버하는지 매트릭스

#### `docs/state-taxonomy-sop.md` ★신규 — Phase 4.20 산출물
- emotion / personality / role / relationship 분리 정책
- normalizeEmotionalState 동작
- character_state_updates schema

#### `docs/regeneration-sop.md` ★신규 — Phase 4.20 산출물
- regen contract V2
- 1화 vs N화 다른 정책
- sampling cap

#### `docs/model-routing-ops.md` (기존 model-routing-strategy.md 보강)
- intent 기반 mode
- per-request override 정책

#### `docs/world-bible-canonical-source.md` ★신규 — Phase 4.20 산출물
- books.context = canonical 정책
- derived index 동기화

#### `docs/reader-ux-sop.md` ★신규
- 사이드바 minimal + ep-end cards detailed 정책
- placeholder UX
- capture+ 일관성

### 2.3 폴더별 README의 역할 재정의

| README | 역할 |
|---|---|
| workflows/ | 절차/예외처리/release 같은 운영 SOP |
| profiles/ | reader profile 4계층 + 갱신 수식 + calibration |
| story_data/ | 서사 메모리(World Bible, Rolling Summary, Foreshadow, Arc) 구조 |
| logs/ | 행동 로그 해석 + reward signal source |
| tools/ | 기술 스택 + DB schema + LLM client 추상화 |
| assets/ | TTS voice archive + BGM 정책 |

→ 각 README는 **자기 영역의 SOP만**, 일반 architecture는 docs/로.

---

## 3. 마이그레이션

### R1.0 — 신규 문서 작성
- Phase 4.20 산출물(이 문서들)을 docs/로 이동/보강
- e2e-architecture-forensics.md → docs/story-generation-sop.md (정제)
- state-taxonomy-proposal.md → docs/state-taxonomy-sop.md
- regeneration-architecture-proposal.md → docs/regeneration-sop.md
- world-bible-canonical-source-proposal.md → docs/world-bible-canonical-source.md
- reader-ux-architecture-proposal.md → docs/reader-ux-sop.md

### R1.1 — CLAUDE.md 갱신
- Project Structure 트리 갱신
- Routing 매핑 표로 변경 (영역 → 정본 문서)
- 폴더별 README 트리거를 명확히

### R1.2 — 폴더별 README sync
- 각 README의 영역 경계 명시
- 영역 외 내용은 docs/로 링크

### R1.3 — Memory 시스템 활성화
- `~/.claude/projects/c--projects-FlowScribe/memory/MEMORY.md` 활용
- Phase별 memory 항목 점진 누적
- 신입 agent가 매번 CLAUDE.md 360줄 + README 1268줄을 읽지 않도록

---

## 4. 실용 예시 — agent의 작업 흐름

### 시나리오 A — "1화 생성이 느리다, 원인을 찾아라"

**기존:**
1. CLAUDE.md 360줄 read
2. workflows/README 193줄 read
3. tools/README 155줄 read
4. 코드 grep
- 토큰 ~3000+

**제안:**
1. CLAUDE.md ~200줄 read
2. docs/story-generation-sop.md (e2e 흐름) read
3. docs/performance-critical-path-audit.md (병목 분석) read
4. 코드 grep
- 토큰 ~2000

### 시나리오 B — "재생성 다양성 audit 작성하라"

**제안:**
1. CLAUDE.md → routing 표에서 "평가/감사" → `docs/audit-sop.md`
2. `docs/regeneration-sop.md` (규격)
3. 기존 `audit_episode_regen_divergence.mjs` 패턴 참조
4. 신규 audit 작성

---

## 5. spec 준수

- ❌ "특정 책/장르/인물/아이템 전용 하드코딩 금지" — 본 제안은 일반 구조 ✓
- ❌ "API key 노출 금지" — 문서에 key 없음 ✓
- ❌ "특정 단어 금지문" — taxonomy / SOP는 의미 정의 ✓
- ✓ "CLAUDE.md를 부트스트랩과 라우팅만 담당" — 그대로

---

## 6. 결론

CLAUDE.md를 360→200줄로 압축하고, 영역 정본 문서 7개를 docs/에 정리. Phase 4.20 산출물 5개를 docs/로 promotion. 폴더별 README의 영역 경계를 명확히. Memory 시스템 활성화로 token 절감.

**R1 단계 작업**, 코드 변경 없이 문서 작업만. Phase 4.20에서는 제안만, 실제 적용은 R1에서.
