# POST-2 — Final Closeout Report (Draft)

**날짜**: 2026-05-03
**Phase**: POST-2 (UX Policy Migration)
**브랜치**: `checkpoint/phase1-launch-prep`
**HEAD before phase**: `0e9ed73` (POST-1 closeout)
**Verdict**: **CLOSE pending** — S13 browser 확인만 남음. 회신 시 KEEP 또는 reopen 결정.

---

## 1. POST-2 Verdict

| 항목 | 상태 |
|---|---|
| P0 production blocker | 미발견 (POST-1과 연속 동일) |
| 사장 결정 5건 (Q1~Q5) | ✓ 모두 회신 완료 |
| KEEP confirmed (Q1/Q2/Q3) | ✓ 코드 변경 0건 |
| V1 (session_guard refresh) | ✓ 14/14 PASS |
| V2 (capture_title_format 신규) | ✓ 8/8 PASS |
| V3 (reading_mode_position) | 보류 (사장 명시) |
| S13 (세계관 뷰어) | **browser 확인 대기** — 본 보고서 §6 checklist |
| 회귀 발생 | 0건 |
| main push 차단 사유 | 없음 (S13 회신 후 reopen 가능성만 남음) |

---

## 2. 변경 파일

POST-2 phase 변경 (코드 0건, verify 2건):

| 파일 | 변경 |
|---|---|
| `scripts/verify_generation_session_guard.mjs` | V1 refresh — token handler / onerror stale check를 anchor-based slice 검증으로 갱신. POST-1 §S17 패턴 동일. **검증 12 → 14**. |
| `scripts/verify_capture_title_format.mjs` | V2 신규 — FINAL §5.2 캡처 헤더 포맷(괄호 제거) 회귀 방지 정적 verify. **8 checks**. |
| `docs/post2-ux-policy-inventory-2026-05-03.md` | 사장 결정 결과 반영. |
| `docs/post2-final-closeout-report-2026-05-03.md` | 본 보고서. |

`public/` UI 코드 미터치. route / prompt / DeepSeek 정책 변경 0건.

---

## 3. V1 verify_generation_session_guard refresh 내용

**Root cause**: POST-1에서 generate.js의 토큰 stale 처리 메시지가 한국어 toast(`"《...》 N화 생성 중입니다. 다른 책으로 이동했습니다…"`)로 갱신됐으나 verify는 옛 문자열(`"token discarded (stale session)"`, `"onerror: session stale"`)을 직접 매칭. **실제 기능은 정상**(토큰 오염 차단 + 1회 toast + 원래 책 저장).

**갱신 패턴**: POST-1 verify_modal_save와 동일한 anchor-based slice helper 도입.
```js
function sliceAround(src, anchor, len = 1500) { ... }
```

**갱신된 검사**:
- token handler stale check — `bookId !== _genSession.bookIdAtStart` + early `return` (anchor: `"rawText += json.token"`)
- token handler 1회 toast — `_staleMsgShown` flag + `showToast` 호출
- token handler toast 메시지 contract — "다른 책으로 이동" + "원래 책에 저장" 의미 키워드
- onerror sessionStale — `const sessionStale = bookId !== _genSession.bookIdAtStart` (anchor: `"es.onerror"`)

이전 12 → 14 checks. 모두 PASS.

---

## 4. V2 verify_capture_title_format 신규 내용

**목표**: FINAL §5.2 정책(`1화 [화 제목]` 형식, 괄호 절대 사용 금지) 회귀 방지.

**검사 영역**:
1. **DOM 구조** — `cap-header`/`cap-book-title`/`cap-ep-line` 컨테이너 + `outputBookTitle`/`outputEpLabel`/`outputEpTitle` source 사용
2. **ep 줄 포맷** — `${epLabel} ${epTitle}` 단일 공백 결합, `(${epTitle})` 괄호 wrapping 미사용
3. **fallback** — epLabel/epTitle 한쪽만 있어도 자연스럽게
4. **charsOnly 모드** — 헤더 영역 자체 미생성 (`wrap.innerHTML = charsOnly ? '' : ...`)
5. **정책 주석** — "FINAL: 괄호 제거" 헤더 주석 유지

**8 checks 모두 PASS**. 향후 캡처 헤더 영역 변경 시 회귀 자동 감지.

---

## 5. Verify Result (POST-2 closeout 기준)

```
npm run build (tsc)                                      PASS
verify_route_integrity                                   6/0/0
verify_public_js_syntax                                  25/25
verify_book_load_flow                                    41/0
verify_episode_end_character_cards                       27/27
verify_episode_end_character_cards_layout                22/22
verify_context_save_async                                13/13
verify_modal_save                                        16/16
verify_generation_session_guard                          14/14  ← V1 refresh
verify_capture_title_format                              8/8    ← V2 신규
verify_item_category_source_priority                     12/12
verify_item_description_length                           21/21
```

POST-1 누적 + POST-2 추가 모두 통과, 회귀 0.

---

## 6. S13 Browser Checklist

세계관 설정 뷰어 — POST-2에서 코드 수정 없이 사장 browser 확인 대기. PASS/WARN/FAIL 회신 후 KEEP 또는 reopen 결정.

### 재현 순서

1. http://localhost:3000 → Ctrl+Shift+R
2. 임의 책 선택 (예: 슬롯 A "확깨용_검증" 또는 슬롯 C "확깨용_TEST")
3. **세계관 설정** 모달 열기 (settingsBtn 클릭)
4. 모든 섹션 펼쳐서 표시 여부 확인
5. modal 닫기
6. 다른 책 선택 → 다시 세계관 설정 모달 열기 → 이전 책 데이터 잔존 여부 확인

### 확인 항목 (5건)

| # | 항목 | PASS 기준 | WARN 기준 | FAIL 기준 |
|---|---|---|---|---|
| **S13.1** | 배경 섹션 표시 | 배경/세계관 섹션이 보이고 입력값이 표시됨 | 섹션은 보이는데 입력값 일부 누락 | 섹션 자체가 안 보임 |
| **S13.2** | 장르 섹션 표시 | 장르/분위기 섹션이 보이고 settingVals/moodVals 칩이 표시됨 | 섹션은 보이는데 일부 칩 누락 | 섹션 자체가 안 보임 |
| **S13.3** | 연출/톤 섹션 표시 | POV/스타일/연출 고정 섹션이 보이고 storyConfig 값이 표시됨 (POV/style/episodeLength 등) | 섹션은 보이는데 일부 값 누락 | 섹션 자체가 안 보임 |
| **S13.4** | 비어 있는 항목 | 빈 섹션은 자연스럽게 placeholder 또는 비어 있는 상태로 표시 (예: "설정 없음") | 빈 섹션이 깨진 UI로 보임 | 빈 섹션이 에러 throw / 모달 깨짐 |
| **S13.5** | 책 전환 시 데이터 잔존 | 다른 책 열면 그 책의 설정값으로 갱신, 이전 책 데이터 미잔존 | 일부 필드만 stale (1-2건) | 전 책 설정이 그대로 표시됨 (P0 → 즉시 reopen) |

### 회신 형식

```
=== POST-2 S13 BROWSER 결과 ===
S13.1 [PASS / WARN / FAIL]  메모: …
S13.2 [PASS / WARN / FAIL]  메모: …
S13.3 [PASS / WARN / FAIL]  메모: …
S13.4 [PASS / WARN / FAIL]  메모: …
S13.5 [PASS / WARN / FAIL]  메모: …

console error/warning capture (있으면):
…
```

### 결정 흐름
- 5건 모두 PASS → S13 KEEP confirm, POST-2 closeout 확정
- WARN 1-2건 → 영향도 평가 후 P2 reopen 또는 KEEP
- FAIL 1+건 → S13 reopen 후 코드 수정 phase 진입

---

## 7. POST-2 closeout 가능 여부

**부분 가능**.

- Q1/Q2/Q3 KEEP confirm + V1/V2 verify + 회귀 0 = closeout 준비 완료
- S13만 browser 회신 대기. 회신 후 다음 두 path:
  - 5건 모두 PASS → 본 보고서를 그대로 closeout 확정 (추가 commit 0)
  - WARN/FAIL → S13 reopen, 별도 fix commit + closeout report 갱신

main push는 S13 PASS 회신 후 일괄 진행 권고 (S13 reopen이 없을 가능성 높음 — POST-1 modal/UI 흐름 안정).

---

## 8. POST-2 변경 Commit 목록 (예상)

| Commit | 영역 | 요지 |
|---|---|---|
| `98350ba` (이미 commit) | docs | POST-2 inventory + 사장 결정 항목 정리 |
| 본 작업 (예정) | test+docs | V1 refresh + V2 신규 + inventory 결정 반영 + closeout draft |

총 2 commits + (S13 reopen 시 추가).

---

## 9. POST-3/POST-4로 이관 (현재 phase 미진행)

| 항목 | 이관 phase |
|---|---|
| V3 reading_mode_position preserve verify | POST-3 또는 별도 small phase |
| DeepSeek 클라이언트 cleanup | POST-4 |
| `data/datasets/dpo_v*.jsonl` gitignore | POST-4 |
| `_inferItemBadge` / `_capQlabel` 키워드 단순화 | POST-4 |
| orphan rows 14,620 cleanup | 별도 phase |
| `audit_item_vocab.mjs` detail 옵션 | POST-4 |

---

## 10. git status (closeout 시점 예상)

```
M .claude/scheduled_tasks.lock         (untouched, NOT staged)
M scripts/cloud_dpo/launch_dpo.py      (untouched, NOT staged)
```

leftover 2건 untouched. 본 phase의 모든 commit은 verify + docs만 stage. UI 코드 / route / prompt / DeepSeek / DB schema 변경 0건.
