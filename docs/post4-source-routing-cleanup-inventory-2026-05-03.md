# POST-4 — Source Routing Cleanup Inventory

**날짜**: 2026-05-03
**Phase**: POST-4 (Source Routing Cleanup)
**브랜치**: `checkpoint/phase1-launch-prep` (≡ `origin/main` 동기)
**HEAD**: `b355832` (POST-2 closeout)
**원칙**: 코드 수정 0건 — read-only inventory + 분류 + 위험도 + 사장 결정 항목 정리.

---

## 1. POST-4 Scope

| 포함 | 제외 |
|---|---|
| 6개 cleanup 영역 read-only 분석 | 즉시 코드 수정 |
| 보존 vs 삭제 결정 분류 | route 변경 |
| 위험도 평가 | DB write |
| small commit 후보 식별 | 대규모 리팩터링 |

---

## 2. 항목별 현재 위치 + 분류

### 2.1 DeepSeek 클라이언트 잔존 코드

**위치 분포**:

| 파일 | 라인 | 잔존 형태 |
|---|---|---|
| `config/model_routes.json` | (FINAL phase에서 route_set 삭제됨) | active/fallback에 미포함 — **사용 안 함** |
| `src/lib/llm.ts:4,32-39` | `LLMProvider` type union + `deepseek` 설정 (baseURL/apiKey/storyModel/...) | dead config block |
| `src/api/settings.ts:16` | `valid: LLMProvider[] = ["ollama", "deepseek", ...]` validation | type 일치성만 |
| `src/services/llm_tasks.ts:39,52` | type union + 주석에 "deepseek_renderer 등" 예시 | dead reference |
| `src/services/model_router.ts:53-57` | `case "deepseek": ... DEEPSEEK_BASE_URL/API_KEY` | provider 분기 (활성 route에서 호출 안 됨) |
| `src/services/model_clients/openai_compatible.ts:2` | 주석에 "(Ollama, DeepSeek, OpenAI 공통)" | 주석만 |
| `dist/**/*` | 위 src의 빌드 산출물 | 자동 생성 |

**production 영향**: 0건. 활성 route는 `openai_renderer`(주) + `baseline_local`(fallback). DeepSeek case는 호출 경로 없음. `process.env.DEEPSEEK_API_KEY`도 미설정이면 빈 문자열로 fallback.

**삭제 가능 여부**: 가능하나 **NEEDS_VERIFY** — 다음 결정 필요:
- 옵션 A: 완전 삭제 (provider type union, model_router case, llm.ts 설정, settings validation, openai_compatible 주석)
- 옵션 B: 보존 (low-cost/fast route로 미래에 다시 쓸 가능성 — provider 옵션 다양성 유지)

**위험도**: 낮음. 삭제 시 영향:
- 향후 DeepSeek route 재도입 시 코드 다시 추가 필요
- 외부 fork/branch에서 `process.env.DEEPSEEK_*` 참조하는 코드는 없음 (확인됨)
- `model_routes.json`에 이미 미포함이라 런타임 영향 0

### 2.2 `_inferItemBadge` (server) / `_capQlabel` (client) 키워드 휴리스틱

**위치**:

| 파일 | 라인 | 키워드 if문 수 |
|---|---|---|
| `src/api/generate.ts:646-659` (`_inferItemBadge`) | server fallback when vocab miss | **10개 if문** |
| `public/js/generate.js:_capQlabel` | client fallback when server it.category 없음 | **17개 if문** |

**production 역할**: vocab miss + server `_inferItemBadge` 응답 "기타" + client server-first lookup도 못 잡으면 마지막 fallback. POST-1 §P1-A reopen-3에서 vocab > canonical priority 적용 후 호출 빈도 매우 낮음.

**삭제 가능 여부**: **DEFER** — vocab 시스템 정착도 측정 후 점진 축소 권고.

근거:
- POST-1 reopen-3에서 `classifyItemNamesViaLLM` (강화 prompt)가 모든 미등록 아이템을 LLM 분류 + vocab 누적
- 이론상 vocab coverage가 100%에 가까워지면 키워드 휴리스틱 호출 빈도 0
- 그 시점에 안전하게 단순화 가능 (단계별 키워드 if문 → "기타" 단일 fallback으로 축소)
- 현재 audit_item_vocab으로 책별 coverage 측정 가능 — 일정 임계값 초과 시 단순화 결정

**위험도**: 중간. 너무 빨리 제거하면 vocab miss 책에서 배지 미표시 회귀 가능.

### 2.3 `data/datasets/dpo_v*.jsonl` gitignore

**현재 상태**:

| 항목 | 값 |
|---|---|
| `.gitignore` 30번 줄 | `data/datasets/` 디렉터리 전체 ignored |
| `git ls-files data/datasets/` | `.gitkeep` 1건만 tracked (의도적, 디렉터리 보존용) |
| dpo_v1/v2/v3_final/v3_train/v3_val 5건 | **이미 ignored** (실제 git status에 ??로 뜨지 않음) |

**삭제 가능 여부**: 작업 자체 불필요. **이미 처리됨 (KEEP)**.

**위험도**: 0. 현재 상태 유지가 정답.

### 2.4 Orphan rows 14,620 cleanup

**출처**: POST-1 §3 cache cleanup 위험 감사에서 발견.

**분포**:
```
episodes 4,765 / run_traces 747 / canonical_characters 1,613 /
character_dynamic_states 1,942 / foreshadows 4,753 /
arc_summaries 395 / episode_snapshots 405
```

이전에 삭제된 책의 cascade 미실행으로 잔존. **active books에 매칭 0건 → production 영향 없음**.

**삭제 가능 여부**: **DEFER** — DB write 작업으로 본 phase 범위 초과.

**위험도**: 중간. 잘못 삭제 시 active 책 데이터 영향 가능. 별도 cleanup phase 필요:
- dry-run script 작성 (matched orphan rows 식별)
- 사장 명시 승인 후 transaction batch DELETE
- 미리 backup 절차

본 POST-4에서는 미진행. 별도 phase로 분리.

### 2.5 `audit_item_vocab.mjs` detail 옵션

**현재 상태** ([scripts/audit_item_vocab.mjs](scripts/audit_item_vocab.mjs)):
- `--book-id <id>` 또는 `--all` 모드
- 출력: counts (canonical/dynamic/vocab unique 수), coverage (%), dynamic-only vocab miss 리스팅, "기타" 비율

**미지원**:
- 카테고리별 detail (예: 식량 N건, 도구 M건, ...)
- 각 vocab 행의 (name, category, badge_label) 직접 표시 옵션
- 충돌 검사 (vocab vs canonical category 불일치)

**enhancement 가능 여부**: read-only enhancement, 안전.

**위험도**: 0. small commit 후보 — `--detail` 옵션 추가하면 POST-1 reopen-3 같은 source priority 충돌을 사전 발견 가능.

### 2.6 V3 reading_mode_position preserve verify

**배경**: POST-2에서 사장 결정으로 보류 (S4 KEEP 정책 contract 추가).

**현재 상태**: 관련 verify 0건. S4 정책(모드 전환 시 단락 위치 보존)은 코드로만 보장.

**enhancement 가능 여부**: 신규 verify 1개 추가. 코드 미터치 (정적 contract만 검증).

**위험도**: 0. small commit 후보.

---

## 3. 분류 요약

| # | 영역 | 분류 | 위험도 | small commit 후보 |
|---|---|---|---|---|
| 1 | DeepSeek 잔존 코드 | **NEEDS_VERIFY** (사장 결정) | 낮음 | 결정 후 분리 commit |
| 2 | _capQlabel / _inferItemBadge | **DEFER** (vocab 정착도 측정 후) | 중간 | 미진행 |
| 3 | dpo gitignore | **KEEP** (이미 처리됨, no-op) | 0 | 미진행 |
| 4 | orphan rows 14,620 | **DEFER** (별도 phase) | 중간 | 미진행 |
| 5 | audit_item_vocab detail 옵션 | **KEEP+ENHANCE** | 0 | ✅ 후보 |
| 6 | V3 reading_mode_position verify | **KEEP+ENHANCE** | 0 | ✅ 후보 |

---

## 4. 권고 순서

### 4.1 즉시 진행 가능 (사장 승인 시 small commits)
- **C1**: `audit_item_vocab.mjs` `--detail` 옵션 추가 (read-only enhancement)
- **C2**: `verify_reading_mode_position_preserve.mjs` 신규 추가 (정적 contract verify)

각각 단일 파일 변경. 회귀 위험 0.

### 4.2 사장 결정 후 진행
- **C3 (DeepSeek)**: 삭제 vs 보존 결정 후 분리 commit
  - 삭제 시: src/lib/llm.ts deepseek block 제거 + LLMProvider type union 축소 + model_router case 제거 + settings validation 정리 + openai_compatible 주석 정리. 단일 commit 가능.
  - 보존 시: docs에 "DeepSeek 코드 보존 — 향후 low-cost/fast route 재도입 가능성" 주석 추가만.

### 4.3 별도 phase로 분리
- **D1**: `_capQlabel` / `_inferItemBadge` 키워드 점진 축소 — vocab coverage 임계값 측정 phase 후
- **D2**: orphan rows 14,620 DB cleanup — 별도 phase (dry-run script + 사장 승인 + transaction batch DELETE)

---

## 5. 사장 결정 필요 항목

POST-4 진행 전 다음 결정 부탁드립니다.

### Q1. DeepSeek 잔존 코드 처리 방향

**옵션 A — 완전 삭제 (권고 시 small commit)**
- src/lib/llm.ts deepseek 설정 block 제거
- LLMProvider type union에서 "deepseek" 제거 (3 파일)
- model_router.ts case "deepseek" 분기 제거
- settings.ts valid validation 축소
- openai_compatible.ts 주석에서 "DeepSeek" 제거
- 영향: production 0 (이미 model_routes.json에서 미사용). 향후 재도입 시 코드 다시 추가 필요.

**옵션 B — 보존 (현재 상태 유지)**
- 코드 그대로 + 주석에 "보존 사유" 명시 (low-cost/fast route 재도입 옵션)
- DEEPSEEK_API_KEY 환경변수도 active route 미사용 → 영향 0

→ A vs B 결정 부탁드립니다.

### Q2. POST-4 진행 범위

**옵션 1 — 최소 (small commits만)**
- C1 audit detail 옵션
- C2 V3 verify 신규
- Q1 결정 결과 반영

**옵션 2 — 최소 + 정착도 측정 도입**
- 옵션 1 + audit_item_vocab으로 vocab coverage 책별 측정 → docs 정착도 로그 추가 (D1 단순화 시점 결정용)

**옵션 3 — 보류**
- POST-4 inventory만 닫고 다음 phase로 (R6.x / R7 본 작업)
- C1/C2/Q1/D1/D2는 모두 backlog로 이관

→ 1/2/3 중 결정 부탁드립니다.

---

## 6. 본 phase 작업물 (현재까지)

| 산출물 | 위치 |
|---|---|
| 본 inventory | `docs/post4-source-routing-cleanup-inventory-2026-05-03.md` |
| 코드 변경 | **0건** (사장 명시 — read-only) |

git status:
```
 M .claude/scheduled_tasks.lock         (untouched, NOT staged)
 M scripts/cloud_dpo/launch_dpo.py      (untouched, NOT staged)
```

leftover stage 0건 — 사장 정책 100% 준수.
