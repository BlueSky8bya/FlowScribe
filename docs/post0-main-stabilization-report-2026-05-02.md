# POST-0/POST-1 — Main Branch Stabilization + UI/Data Audit (Triage)

**날짜**: 2026-05-02
**Phase**: POST-0/POST-1 (FINAL `b35ca90` merge 후 첫 안정화 phase)
**브랜치**: `checkpoint/phase1-launch-prep` (≡ `origin/main` ≡ `origin/checkpoint/phase1-launch-prep`)

---

## 1. 브랜치 / 상태

| 항목 | 값 |
|---|---|
| `origin/main` | `b35ca90ade2ef704b90e1c9e86cb12b720a64ace` |
| `origin/checkpoint/phase1-launch-prep` | `b35ca90…` (동일) |
| local current branch | `checkpoint/phase1-launch-prep` |
| local HEAD vs origin/main | **0 ahead, 0 behind** ✅ |
| local checkout main | **불가** (working tree leftover 충돌) — 사장님 지시대로 checkpoint 브랜치에서 작업 진행 |

### Working tree leftover (PR 범위 밖, 절대 commit 금지)

```
M .claude/scheduled_tasks.lock        ← Claude Code session runtime artifact
M scripts/cloud_dpo/launch_dpo.py     ← 이전 DPO phase 작업 unstaged 변경
```

상세는 §6 참조.

## 2. Build / Verify

### Build

```
> tsc
(no errors)
```

### Verify suite (19개 실행)

| Verify | result | 분류 |
|---|---|---|
| `verify_route_integrity` | ✅ PASS 6/0/0 | OK |
| `verify_public_js_syntax` | ✅ 25/25 | OK |
| `verify_ui_logic` | ✅ 251/251 | OK |
| `verify_sidebar_ui` | ✅ 47/47 | OK |
| `verify_book_load_flow` | ⚠ 34/40 (6 fail) | **Legacy** (audit-sop §8) |
| `verify_hybrid_streaming_contract` | ✅ 32/32 | OK |
| `verify_episode_end_character_cards` | ✅ 27/27 | OK |
| `verify_episode_character_display_filter` | ✅ 20/20 | OK |
| `verify_item_description_length` | ✅ 21/21 | OK |
| `verify_state_taxonomy` | ✅ 36/36 | OK |
| `verify_emotion_label_normalization` | ✅ 21/21 | OK |
| `verify_meaningful_appearance_guard` | ✅ 17/17 | OK |
| `verify_episode_end_state_alignment` | ✅ 17/17 | OK |
| `verify_item_location_ledger` | ⚠ 63/70 (7 fail) | **Legacy** (audit-sop §8) |
| `verify_world_rule_integrity` | ✅ 21/21 | OK |
| `verify_regeneration_divergence_contract` | ⚠ 18/20 (2 fail) | **Legacy** (audit-sop §8) |
| `verify_regen_degradation_fix` | ✅ 32/32 | OK |
| `verify_narrative_repetition_guard` | ✅ 22/22 | OK |
| `verify_duplicate_discovery_dedup` | ✅ 18/18 | OK |

### Stale vs regression 분류

- **3개 부분 fail**: 모두 **Legacy stale verify** (정규식 진화 미반영, 실제 기능은 정상). FINAL phase에서 audit-sop.md §8에 명시 분류 + 갱신 권고 패턴 기록.
- **regression 0건**: merge 직전 R6 commit `5da629e`와 동일 결과 — main merge 자체가 새 regression을 일으키지 않음.
- **production blocker 0건**.

## 3. Production route

| 항목 | 값 |
|---|---|
| `active_route` | **`openai_renderer`** ✅ |
| planner | openai/gpt-4.1-mini ✅ (실측 1552ms) |
| renderer | openai/gpt-4.1-mini ✅ (실측 543ms) |
| narrative_repair | openai/gpt-4.1-mini ✅ (실측 519ms) |
| `fallback_route` | `baseline_local` ✅ |
| baseline_local planner | ollama/qwen2.5:14b ✅ (882ms) |
| baseline_local renderer | ollama/qwen2.5:14b ✅ (148ms) |
| baseline_local narrative_repair | gemini/gemini-2.5-flash ✅ (1183ms) |
| baseline_local multi_routes (reader_immersion_judge) | gemini + openai ✅ |
| **route metadata trace** | run_traces.planner_trace + renderer_trace에 router-resolved 정확 기록 (R5B-4d fix 입증) |

### DeepSeek route 보존 정책 — 사장님 명시 의도 변경 기록

- **이전 정책 (R5B-4c까지)**: DeepSeek route 보존 (low-cost/fast mode 활용)
- **현재 정책 (FINAL phase 사장님 §1 명시 요청)**: 미사용 route_set 9개 config 정리 → DeepSeek route_set 모두 제거
- **현재 fallback**: `baseline_local` 안에서 ollama (planner/renderer) + gemini (narrative_repair) 사용
- **DeepSeek client source code**: `src/services/model_clients/openai_compatible.ts`에 OpenAI/DeepSeek 공유 client 형태로 잔존 (제거 안 함, 위험 회피)
- **재검토 필요 여부**: 본 phase 메시지에서 사장님이 다시 "DeepSeek route 보존"을 명시 → **이전 FINAL phase 정리 여부에 대한 재검토 필요**. config 복원 / 또는 현 상태 유지 결정은 사장님 판단 대기. 본 phase에서는 변경 안 함.

## 4. Browser 수동 확인 체크리스트 (사장님 확인 권고)

```text
1.  □ 새로고침 후 서재/에피소드 표시 정상
2.  □ 기존 책 선택 시 본문 표시 정상
3.  □ 다음화/이전화 이동 시 본문 상단으로 이동
4.  □ 청독/묵독 → 낭독 모드 전환 시 현재 위치 유지
5.  □ hybrid streaming에서 본문이 자연스럽게 누적 표시
6.  □ 생성 중 다른 책으로 이동해도 토큰 오염 없음
7.  □ 오른쪽 사이드바: 등장 인물 이름/성별만 표시
8.  □ 본문 하단 Episode End Character Cards 표시
9.  □ 등장하지 않은 인물은 하단 카드에 표시 안 됨 (R5B-1.8D guard)
10. □ 소지품 설명이 과도하게 길지 않음 (verify_item_description_length PASS)
11. □ 사용자 입력 소지품 설명 보존
12. □ 재생성/다음화 버튼 정상 동작
13. □ 세계관 설정 저장/닫기 정상
14. □ 콘솔 에러 없음
15. □ /favicon.ico 콘솔 404 없음 (FINAL §5.4 inline SVG)
16. □ 캡처 정상 — 화 제목 포맷 "N화 화 제목" (괄호 없음, FINAL §5.2)
17. □ 본문 하단 cards grid 캡처와 동일
18. □ 인물명 밑줄 / 성별 색상 정상
19. □ 본문 상단 헤더: 좌측 [N화 화 제목] / 우측 [책 제목] 좌우 정렬 (FINAL §5.3)
20. □ 우측 책 제목 글씨 크기 증가됨 (1.1rem → 1.45rem, POST-0)
```

## 5. Deferred issue 분류 (severity / phase)

| Issue | Severity | Evidence | Recommended action | Phase | Do now? |
|---|---|---|---|---|---|
| §5.1 본문 하단 인물 카드 시각 디테일 | **minor** | verify_episode_end_character_cards 27/27 PASS, layout 27/27 PASS | browser 직접 확인 후 차이 명확하면 CSS tweak | POST-1 (선택) | NO — sangnim browser 검증 후 결정 |
| §6.1 성별 분류 오류 / DB corruption | **minor (UI)** + **medium (data)** | `canonical_characters.gender`에 description 통째로 들어간 11개 + mojibake `'����'` 1개 | (a) 코드 sanitizer 추가 (write-time normalize) + (b) DB cleanup script (one-shot) | POST-1 + POST-2 | NO — DB cleanup은 사장님 승인 필요 |
| §6.2 소지품 검증 통과 (false positive) | **medium** | 사용자 보고만, 재현 케이스 미확보 | browser에서 재현 → audit script 분석 → guard 보강 | POST-1 | NO — 재현 필요 |
| §6.3 세계관 설정 뷰어 누락 | **medium (UX)** | 사용자 보고 — 배경/장르/연출 고정 표시 누락 | UI 렌더링 vs DB 저장 경로 양쪽 진단 | POST-1 | NO — 재현 필요 |
| §6.4 인물 카드 소지품 미표시 | **medium (UX)** | 사용자 보고 — 사이드바 인물 카드 소지품 누락 | DB / fetch / render 단계별 분리 진단 | POST-1 | NO — 재현 필요 |
| §6.5 AI 추천 중복 | **minor (UX)** | 이름/키워드/소지품 중복 발생 | suggest 응답 후 dedup constraint 후처리 | POST-1 | NO — 동작 보존 + 신중 적용 |
| §7.1 소지품 카테고리 UI 제거 | **minor (UX policy)** | 사장님 새 정책 | 카테고리 input 제거 + AI 자동 채움 | POST-2 | NO — UX 검증 필요 |
| §7.2 인물 유형 (인간/엘프 → 주인공/조연) | **medium (schema)** | 사장님 새 정책 | character_defaults.type 의미론 변경 + 기존 데이터 backward-compat | POST-2 | NO — schema discussion 필요 |
| §7.3 성별 3종 고정 | **minor (UX) + medium (data cleanup)** | §6.1과 묶임 | UI dropdown 3종 + DB normalize | POST-1 + POST-2 | NO — §6.1과 통합 |
| 3개 stale verify script refresh | **minor (audit hygiene)** | audit-sop.md §8 기록 | 정규식만 갱신 (코드 변경 없음) | **POST-3** | NO — 1-2시간 작업, post-merge 여유 |
| Source routing cleanup (DeepSeek client) | **minor (dead code)** | openai_compatible.ts에 dead branch | 위험 분리 후 dead code 제거 | POST-4 (선택) | NO — production 영향 없음 |
| **DeepSeek route 보존 vs 정리 재검토** | **policy-level** | 본 phase에서 사장님 다시 보존 명시 vs FINAL §1 정리 명시 contradiction | config 복원 여부 사장님 판단 | TBD | **YES — 사장님 판단 필요** |

### Production blocker

- **0건** — 위 항목 모두 production 운영을 막지 않음
- 누적 evidence (R5B-4c 100ep + R6 60ep + regen 10회 = 172 generations)로 안정성 입증

## 6. Leftover files

### 6.1 `.claude/scheduled_tasks.lock`

```diff
-{"sessionId":"54ecad44-…","pid":7872,"acquiredAt":1776665423664}
+{"sessionId":"25ddf4a5-…","pid":7888,"acquiredAt":1777513543104}
```

- **종류**: Claude Code session 추적용 runtime artifact (auto-managed)
- **변경 이유**: 새 session 시작 시 sessionId / PID / timestamp 갱신
- **action recommendation**: **never commit** (CLAUDE.md "절대 금지"). 다음 session에서 다시 변경됨 — 자연 발생.

### 6.2 `scripts/cloud_dpo/launch_dpo.py`

- **diff stat**: 143 lines (+98 / -47)
- **변경 요약**:
  - GPU mapping 변경: full Runpod displayName → 부분 매칭 string (`"NVIDIA GeForce RTX 4090"` → `"RTX 4090"`)
  - `SSH_TIMEOUT` 600s → 1800s (30분, 이미지 풀 시간 포함)
  - 기타 DPO launch script 개선
- **종류**: 이전 DPO/Runpod phase 작업 중 만들어진 unstaged 변경
- **CLAUDE.md 정책**: "scripts/cloud_dpo/launch_dpo.py 커밋 금지"
- **action recommendation**:
  - **즉시 commit 금지** (정책 위반)
  - 본 phase에서는 자동 restore 안 함 — 사용자 판단 대기
  - 사장님이 향후 DPO/Runpod phase 재개 시 별도 검토:
    - (a) 이 변경이 유효한 개선이면 별도 phase에서 commit
    - (b) 불필요하면 `git checkout HEAD -- scripts/cloud_dpo/launch_dpo.py`로 discard

## 7. Next phase recommendation

### 권고 우선순위

| Phase | 작업 | 예상 시간 | risk | recommended trigger |
|---|---|---|---|---|
| **POST-1 UI/Data Audit** | §6.1~§6.5 browser 재현 + 진단 + 최소 fix | 4~6시간 | low (browser 검증 필수) | 사장님이 browser checklist 결과 보고 후 |
| **POST-2 UX Policy Migration** | §7.1~§7.3 UI/schema 변경 + backward compat | 6~8시간 | medium (schema 영향) | sangnim 정책 확정 후 |
| **POST-3 Verify Script Refresh** | 3개 legacy verify 정규식 갱신 | 1~2시간 | very low (verify script만) | 여유 있을 때 — production 영향 0 |
| **POST-4 Source Routing Cleanup** | DeepSeek client dead branch 제거 | 2~3시간 | low (dead code 제거) | 선택 — production 영향 0 |
| **DeepSeek route 보존 vs 정리 재검토** | config 복원 여부 결정 | 30분 (config 복원만) | low | **즉시 사장님 판단 필요** |

### DPO / Runpod 재개 여부

- 본 phase는 **재개 권고 안 함**
- 이유:
  - production은 OpenAI route로 충분히 안정 입증 (172 generations 0 fail)
  - DPO 학습은 별도 cloud 작업 + cost 발생
  - 사장님이 DPO/Runpod 재개 결정을 별도 phase로 진행 권고 (`scripts/cloud_dpo/launch_dpo.py` leftover 검토 + Runpod 비용 검토 + 학습 데이터 v3 활용 계획 정리)

### POST-0/POST-1 본 phase에서 한 작업

- 진단 + 분류 (§1 ~ §6 모두 완료)
- 코드 변경: **사장님 추가 요청 1건만** — `public/css/layout.css`의 책 제목 폰트 1.1rem → 1.45rem (우측 정렬에서 가독성 향상)
- 새 기능 / 새 guard / 새 prompt section 추가 0건
- 대규모 refactor 0건
- DB migration 0건
- main push 0건

### 변경 파일 (commit 대상)

- `public/css/layout.css` — 책 제목 폰트 크기 (사장님 추가 요청)
- `docs/post0-main-stabilization-report-2026-05-02.md` — 본 보고서

```
POST-0/1 verdict: READY
production blocker: NO
recommended next phase: POST-1 (UI/Data Audit) — sangnim browser checklist 결과 보고 후 시작
근거: origin/main = b35ca90 fast-forward 완료 상태 안정 확인 (0 ahead/0 behind, conflict 0, force push 없음). build PASS, 19개 verify 중 16개 PASS — 3개 부분 fail은 audit-sop.md §8에 legacy stale 분류된 동일 항목(verify_book_load_flow 6 fail / verify_item_location_ledger 7 fail / verify_regeneration_divergence_contract 2 fail). regression 0건, production blocker 0건. production route active_route=openai_renderer / planner+renderer+narrative_repair 모두 openai/gpt-4.1-mini, fallback baseline_local의 ollama+gemini 정상 동작(verify_route_integrity 6/0/0 PASS, run_traces metadata 정확). DeepSeek route는 FINAL §1 사장님 명시 요청으로 config 정리됨 — 본 phase에서 사장님이 다시 "보존" 명시한 점은 기록만 하고 변경 안 함, 사장님 판단 대기. UI 변경 1건: 책 제목 폰트 1.1rem → 1.45rem (사장님 추가 요청, 우측 정렬에서 가독성 향상). leftover 파일 .claude/scheduled_tasks.lock(session runtime)과 scripts/cloud_dpo/launch_dpo.py(이전 DPO phase 변경 143 lines)는 자동 restore 안 함, 사용자 판단 대기. deferred issue 12개를 severity/phase별로 분류: §5.1 / §6.1~§6.5 / §7.1~§7.3 / verify refresh / source routing cleanup / DeepSeek 정책 재검토. 누구도 production blocker 아님 — browser 재현 + DB cleanup + schema discussion이 필요해 POST-1/POST-2/POST-3/POST-4 별 phase로 분리. DPO/Runpod 재개는 본 phase에서 권고 안 함. 새 기능 / 새 guard / 새 prompt / 대규모 refactor 0건. browser 수동 확인 체크리스트 20개 항목 정리.
```
