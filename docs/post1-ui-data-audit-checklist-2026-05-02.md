# POST-1 — UI/Data Audit Checklist

**날짜**: 2026-05-02
**Phase**: POST-1 (POST-3 후속, browser 진단 phase)
**브랜치**: `checkpoint/phase1-launch-prep` (≡ `origin/main`)
**원칙**: **코드 수정 0건** — P0 blocker가 발견되기 전까지 진단/관찰만. 본 phase 작업물은 사장님이 browser에서 PASS/WARN/FAIL을 채워 회신할 체크리스트.

---

## 0. 사전 환경

### 서버 상태

```text
branch:        checkpoint/phase1-launch-prep
commit:        642075c (POST-3 — verify script refresh)
server:        http://localhost:3000  (LISTENING ✅)
active_route:  openai_renderer
fallback:      baseline_local
build:         tsc PASS
verify suite:  19/19 PASS
```

### Browser 사전 준비

```text
1. http://localhost:3000 접속
2. 콘솔 열기 (F12 → Console)
3. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
   ↑ FINAL phase + POST-0의 CSS / HTML / JS 변경이 cache busting query
     `?v=N`으로만 감싸져 있어 강제 새로고침 권장.
4. 콘솔에서 다음 명령으로 진단 객체 확인 가능:
   window.__fsDiag()  // book/ep/output state
```

### DB 사전 진단 결과 (사장님 browser 검증과 무관, 참고용)

| 영역 | 결과 |
|---|---|
| canonical_characters.gender corruption | 23건 (5 mojibake + 18 비표준) — **모두 orphan rows (이미 삭제된 책의 잔존 데이터)**. 현재 active books 영향 0건. |
| 14권 ctx 누락 | 모두 옛 테스트 책 (`폐허의 열쇠 — Phase 4.16 hotfix smoke` 등). active 사용자 책 아님. |
| orphan rows 합계 | 14,620 (episodes 4,765 / run_traces 747 / canonical_characters 1,613 / character_dynamic_states 1,942 / foreshadows 4,753 / arc_summaries 395 / episode_snapshots 405). **production 영향 없음** — 이전 책 삭제 시 cascade 미실행으로 잔존. cleanup은 별도 phase 권고. |

---

## 1. 검증 후보 책 (사장님이 browser에서 사용할 책)

| Slot | book_id | title | 용도 | current_episode | eps | chars | traces |
|---|---|---|---|---|---|---|---|
| **A** | `e2345de4-2f95-4412-be37-15d6bed8f9f9` | 확률을 깨는 용사(확깨용)_검증 | 메인 검증 (ep1 복사됨, ep2부터 새로 생성 / 재생성 / 다른 책 이동 테스트) | 2 | 1 | 4 (리아/브론/빅토리/카이렌) | 0 |
| **B** | `41be2380-2c6f-4cb9-82eb-09aa6f8d7c89` | [R6_CANARY_OFFICE_ROMANCE] R6 multi-genre canary | regen UX / divergence 검증 (ep20 완성됨) | 21 | 20 | 2 (이도준/한윤서) | 20 |
| **C** | `2f4bc632-0335-4e27-9340-2239e0c39953` | 확률을 깨는 용사(확깨용)_TEST | 기존 책 본문 표시 / 인물 카드 / 소지품 검증 (5화) | 6 | 5 | 4 | 9 |

### 사용 가이드

- **A (확깨용_검증)**: ep1 본문 있음. **ep2 새로 생성** + **ep1 재생성** 시나리오에 적합.
- **B (R6_OFFICE_ROMANCE)**: 20화 다 있음. **ep20 다회 재생성** 시나리오에 적합 (R6에서 10회 stress 통과 입증).
- **C (확깨용_TEST)**: 5화 있음. **ep1~ep5 보기 / 다음화·이전화 이동 / 청독/낭독 전환** 시나리오에 적합.

---

## 2. Audit Scenario 정의 + 관찰 포인트 + PASS/WARN/FAIL 기준

각 scenario는 **재현 순서**가 먼저, **관찰 포인트**, **PASS/WARN/FAIL 기준** 순.

### S1. 새로고침 + 서재/에피소드 표시 (sanity)

**재현 순서**:
1. http://localhost:3000 → Ctrl+Shift+R
2. 서재 (왼쪽 책 목록) 표시 확인
3. 책 슬롯 A "확깨용_검증" 선택

**관찰 포인트**:
- 콘솔 에러 0
- `/favicon.ico` 404 없음 (FINAL §5.4 inline SVG 적용)
- 서재에 책 목록 정상 표시
- ep1 본문 자동 노출

**판정**:
- **PASS**: 콘솔 무에러 + 책 목록 + ep1 본문 모두 정상
- **WARN**: 본문은 보이나 콘솔에 minor warning
- **FAIL**: 책 목록 안 뜨거나 본문 비어있거나 favicon 404

### S2. 책 선택 → 본문 표시 + 헤더 레이아웃

**재현 순서**:
1. 슬롯 C "확깨용_TEST" 선택
2. 본문 상단 헤더 시각 확인

**관찰 포인트** (FINAL §5.3 + POST-0 변경 적용 확인):
- 좌측: `1화 [화 제목]` (큰 accent 색)
- 우측: `[책 제목]` (text3 색, **1.45rem 폰트** — POST-0에서 1.1 → 1.45 증가)
- 가운데에 separator(`·`)는 보이지 **않아야 함** (style="display:none")
- 좌우 정렬: 책 제목이 화면 우측 끝에 붙어 있음 (margin-left:auto)

**판정**:
- **PASS**: 좌우 정렬 + 책 제목 폰트가 시각적으로 ep-title보다 약간 크게 보임
- **WARN**: 좌우 정렬은 OK인데 책 제목 폰트 변화 안 느껴짐 (cache 가능성, hard refresh 권고)
- **FAIL**: 좌우 정렬 안 됨 / separator 보임 / 폰트가 더 작아짐

### S3. 다음화/이전화 이동 → 스크롤 anchor

**재현 순서**:
1. 슬롯 C 선택 + ep1 노출 상태에서 본문 중간까지 스크롤
2. "다음화" 버튼 클릭 → ep2로 이동
3. ep2 표시 위치 확인

**관찰 포인트**:
- 화 변경 시 본문 영역이 **상단으로 자동 스크롤** (R5A scroll anchor)
- 이전화 버튼으로 ep1 돌아오면 다시 상단 표시
- 헤더의 ep label/title이 ep번호에 맞게 갱신
- 토큰 오염 없음 (ep2 내용에 ep1 텍스트가 섞여 보이지 않음)

**판정**:
- **PASS**: 모든 ep 이동 시 상단 스크롤 + 헤더 갱신 + 본문 깨끗
- **WARN**: 스크롤은 자동 되는데 한 박자 늦거나 깜빡임
- **FAIL**: 이전 ep 본문 잔존 / 헤더 미갱신 / 스크롤 안 됨

### S4. 청독/묵독 → 낭독 모드 전환 → 현재 위치 유지

**재현 순서**:
1. 슬롯 C ep3 표시 + 본문 중간까지 스크롤
2. 모드 토글 (청독↔묵독↔낭독) 다회 전환
3. 전환 후 위치 확인

**관찰 포인트**:
- 모드 변경 시 **현재 보고 있던 단락 위치**가 보존
- 청독/묵독 모드에서 dialogue 강조 정상
- 낭독 모드에서 TTS 인터페이스 표시

**판정**:
- **PASS**: 위치 보존 + 모드 시각 차이 명확
- **WARN**: 위치는 유지되지만 약간 흔들림
- **FAIL**: 모드 전환 시 본문 맨 위로 튕김 / 위치 정보 분실

### S5. hybrid streaming — ep 새로 생성

**재현 순서**:
1. 슬롯 A "확깨용_검증" 선택 (current_episode=2)
2. "ep2 생성" 버튼 클릭 (또는 "다음화 생성")
3. 본문 누적 표시 관찰

**관찰 포인트**:
- 본문이 토큰 단위로 자연스럽게 누적
- 끊김/중복/순서 역전 없음
- 외국어/CJK/특수 토큰 0
- 완료 후 score 표시 (80) + episode-end character cards 자동 노출

**판정**:
- **PASS**: 누적 자연 + 완료 80점 + character cards 자동 표시
- **WARN**: streaming은 정상인데 character cards 자동 표시 안 됨 (수동 새로고침 필요)
- **FAIL**: 본문 잘림 / 외국어 토큰 / score 0 / fallback 발동

### S6. 생성 중 다른 책 이동 — 토큰 오염 차단

**재현 순서**:
1. 슬롯 A에서 ep2 생성 시작 (S5와 동일)
2. 생성 진행 중에 슬롯 C "확깨용_TEST" 선택
3. 슬롯 C 본문 표시 확인
4. 잠시 후 슬롯 A로 돌아와 ep2 완성 여부 확인

**관찰 포인트** (verify_generation_session_guard / Phase 4.20 R5A 입증된 동작):
- 슬롯 C 본문에 슬롯 A의 streaming 토큰이 **섞이지 않음**
- 슬롯 A로 돌아오면 in-progress UI 유지 (R5A active-gen restore)
- "《확깨용_검증》 2화 생성 중입니다" 토스트 표시

**판정**:
- **PASS**: 토큰 오염 0 + 토스트 표시 + 슬롯 A 복귀 시 in-progress UI
- **WARN**: 오염 없으나 토스트 누락
- **FAIL**: 슬롯 C 본문에 슬롯 A 토큰 섞임 (P0 blocker)

### S7. 사이드바 인물 표시 — 이름/성별만

**재현 순서**:
1. 슬롯 A "확깨용_검증" 선택
2. 오른쪽 사이드바 인물 panel 확인

**관찰 포인트**:
- 4명 표시 (리아/브론/빅토리/카이렌)
- 각 인물: **이름 + 성별 뱃지/색상만** (자세한 설명은 hover나 클릭으로)
- 등장 안 한 인물도 사이드바엔 표시 (인물 정의 panel은 정의된 인물 모두)
- 성별 뱃지: 남성/여성에 따라 색상 다름

**판정**:
- **PASS**: 4명 표시 + 이름/성별 정상
- **WARN**: 표시는 되는데 성별 색상 구분 약함
- **FAIL**: 인물 누락 / 성별이 "기타"로 나옴 (active books에선 없어야 함, §6.1 확인)

### S8. 본문 하단 Episode End Character Cards

**재현 순서**:
1. 슬롯 C ep5 표시
2. 본문 끝까지 스크롤
3. 본문 아래 character cards grid 확인

**관찰 포인트** (R5B-1.8C/D + verify_episode_end_character_cards 27/27 PASS):
- ep5에서 **의미있게 등장한 인물만** 카드 표시 (R5B-1.8D guard)
- 카드 layout: 인물별 grade-color border / item badges
- 캡처 모드(`capture+`)에서 보이는 layout과 동일 톤
- **등장 안 한 인물의 카드는 표시되지 않음**

**판정**:
- **PASS**: 등장 인물만 카드 표시 + capture+ 톤 유사
- **WARN**: 카드는 정상이나 캡처 톤과 시각 차이가 명확함 (§5.1 deferred — 사장님 결정 필요)
- **FAIL**: 등장 안 한 인물도 카드 표시 (R5B-1.8D guard 회귀)

### S9. 소지품 설명 길이 + 사용자 입력 보존

**재현 순서**:
1. 슬롯 C 사이드바에서 인물 1명 클릭 → 인물 상세 modal
2. 소지품 목록 확인
3. 사용자가 직접 입력했던 설명 (있다면) 보존 여부 확인

**관찰 포인트** (verify_item_description_length 21/21 PASS):
- 각 소지품 설명이 **40자 내외** (R5A item desc length 정책)
- 사용자 입력 description이 LLM 자동 생성으로 덮어쓰여지지 **않음** (보존)
- 소지품 이름이 축약/개명 되지 않음 (예: "고성능 손전등"이 "손전등"으로 줄어들지 않음)

**판정**:
- **PASS**: 설명 적정 길이 + 사용자 입력 보존
- **WARN**: 길이는 적정하나 일부 description이 LLM-generated로 덮인 듯
- **FAIL**: 200자+ 도배 또는 사용자 입력 분실

### S10. 인물 카드 — 소지품 표시

**재현 순서**:
1. 슬롯 C ep5 표시
2. 본문 하단 character card에서 각 인물의 소지품 badge 확인

**관찰 포인트** (§6.4 deferred — 재현 케이스):
- 인물별 소지품 뱃지 정상 표시
- DB의 canonical_characters.initial_items 와 일치
- character_dynamic_states에 기록된 추가/분실 사항 반영

**판정**:
- **PASS**: 소지품 badge 정상 + DB sync
- **WARN**: 일부 인물에서 badge 누락 (특정 케이스)
- **FAIL**: 모든 인물 badge 누락 (§6.4 reproduction)

### S11. 재생성 + divergence

**재현 순서**:
1. 슬롯 B "[R6_CANARY_OFFICE_ROMANCE]" 선택
2. ep20 표시
3. "재생성" 버튼 클릭 → 새로 생성 → 본문 다른지 확인
4. 2-3회 더 재생성

**관찰 포인트** (verify_regeneration_divergence_contract 20/20 PASS):
- 재생성 시 본문 길이 + 줄거리가 **이전과 다름** (divergence 유지)
- score 80 유지 (degradation 없음)
- 외국어/특수토큰 0
- regen 다회 후 stale로 수렴하지 않음 (R6 stress 10회 이미 입증)

**판정**:
- **PASS**: divergence 명확 + score 80 유지
- **WARN**: 비슷한 plot/문구 반복 (cliché 회귀)
- **FAIL**: score 0 / 외국어 / step-function degradation

### S12. 세계관 설정 저장 + 닫기

**재현 순서**:
1. 슬롯 A 선택 + 세계관 설정 modal 열기
2. 임의의 작은 변경 (예: 분위기 조정) → 저장
3. modal 닫기 + 재오픈해 변경 반영 확인

**관찰 포인트**:
- 저장 시 toast/loading 표시
- modal 닫힘 후 재오픈 시 변경 반영
- 콘솔 에러 0

**판정**:
- **PASS**: 저장/닫기/재오픈 모두 정상
- **WARN**: 저장은 되나 toast 누락
- **FAIL**: 저장 후 변경 미반영 / modal 닫히지 않음

### S13. 세계관 설정 뷰어 — 배경/장르/연출 고정 표시

**재현 순서**:
1. 슬롯 A 세계관 설정 modal 열기
2. 모든 섹션 펼치기
3. 다음 항목 표시 여부 확인

**관찰 포인트** (§6.3 deferred — 재현 케이스):
- 배경/세계관 (world_setting) 섹션
- 장르/분위기 (mood, genre) 섹션
- 연출 고정 (style_direction, fixed pov) 섹션
- 인물 / 소지품 / 절대 규칙 섹션

**판정**:
- **PASS**: 모든 섹션 표시 + 입력값 정확
- **WARN**: 일부 섹션 표시는 되는데 입력값 누락
- **FAIL**: 배경/장르/연출 고정 섹션 자체가 미표시 (§6.3 reproduction)

### S14. AI 추천 — 중복 검사

**재현 순서**:
1. 슬롯 A 세계관 설정 modal에서 AI 추천 (✨) 버튼 사용
2. 인물/소지품/규칙 영역에서 추천 받기
3. 결과 중복 여부 확인

**관찰 포인트** (§6.5 deferred):
- 추천된 인물 이름/소지품 이름이 **기존과 중복되지 않음**
- 키워드(예: "마력", "지팡이") 단순 반복 없음
- diversity 유지

**판정**:
- **PASS**: 중복 0 + diversity 유지
- **WARN**: 1-2건 중복
- **FAIL**: 50%+ 중복 (§6.5 reproduction)

### S15. 캡처 — 화 제목 포맷

**재현 순서**:
1. 슬롯 C ep1 표시
2. 캡처 버튼 클릭 → body 모드 캡처
3. 캡처 결과 미리보기 헤더 확인

**관찰 포인트** (FINAL §5.2):
- 캡처 헤더에 `1화 [화 제목]` 형식 (괄호 **없음**)
- 이전: `1화 ([화 제목])` 였던 것이 **괄호 제거됨**
- 책 제목은 별도 줄

**판정**:
- **PASS**: 괄호 없는 포맷 + 좌우 분리
- **WARN**: 포맷은 OK인데 책 제목/화 제목 line-height 어색
- **FAIL**: 괄호 잔존 (cache, hard refresh 권고)

### S16. 인물명 밑줄 + 성별 색상

**재현 순서**:
1. 슬롯 C ep1-5 본문에서 인물명 표시 확인
2. 본문 하단 character card / 사이드바 인물 panel에서 성별 색상 확인

**관찰 포인트** (verify_episode_character_display_filter 20/20 PASS + Phase 4.19):
- 본문 인물명에 **두꺼운 밑줄** (3px alpha cc, Phase 4.19 변경)
- 성별별 색상 구분 명확 (남성/여성)
- 등장 인물에만 밑줄, 미등장 이름엔 밑줄 없음

**판정**:
- **PASS**: 밑줄 두께 + 색상 명확
- **WARN**: 밑줄 보이나 너무 얇음
- **FAIL**: 밑줄 없음 / 성별 색상 같음

### S17. 콘솔 에러 + favicon

**재현 순서**:
1. 모든 시나리오 진행 중 F12 콘솔 모니터링
2. Network 탭에서 /favicon.ico 응답 확인

**관찰 포인트**:
- 콘솔 error level 0 (warning은 minor 허용)
- /favicon.ico → 200 (inline SVG로부터, FINAL §5.4)
- 다른 404/500 없음

**판정**:
- **PASS**: error 0 + favicon 200
- **WARN**: 1-2 minor warning만
- **FAIL**: error 1+ 또는 favicon 404 (cache, hard refresh 권고)

---

## 3. Cache cleanup 위험 감사 (DB 분석)

| 위험 | 평가 |
|---|---|
| `cleanup_test_book_state_cache.mjs` 단일 cleanup script — book_id 인자 필수, dry-run default | ✅ 안전 (book_id 미입력 시 동작 안 함) |
| frontend `episodeCache` reset 누락 가능성 | ✅ verify_book_load_flow에서 검증 (POST-3 41/41 PASS) |
| orphan 14,620 rows | minor — 이미 삭제된 책의 cascade 미실행 잔존. **production 영향 0건** (현재 books에 매칭 안 됨). cleanup은 별도 phase 권고. |
| canonical_characters orphan 1,613 rows | gender corruption 23건이 모두 이 영역에 있음. UI 노출 가능성 0 (active book에 매칭 안 됨). |
| frontend `_fsActiveGen` stale 가능성 | verify_active_gen_book_return / verify_generation_session_guard PASS |

**P0 blocker 없음** — production 운영을 막는 cleanup 위험은 미발견.

---

## 4. 사장님 응답용 결과 보고 양식

각 시나리오에 대해 다음 양식으로 회신해주시면 됩니다 (P0 발견 시 즉시 코드 수정 phase 전환).

```text
=== POST-1 BROWSER AUDIT 결과 ===

S1.  [PASS / WARN / FAIL]  메모: …
S2.  [PASS / WARN / FAIL]  메모: …
S3.  [PASS / WARN / FAIL]  메모: …
S4.  [PASS / WARN / FAIL]  메모: …
S5.  [PASS / WARN / FAIL]  메모: …
S6.  [PASS / WARN / FAIL]  메모: …
S7.  [PASS / WARN / FAIL]  메모: …
S8.  [PASS / WARN / FAIL]  메모: …
S9.  [PASS / WARN / FAIL]  메모: …
S10. [PASS / WARN / FAIL]  메모: …
S11. [PASS / WARN / FAIL]  메모: …
S12. [PASS / WARN / FAIL]  메모: …
S13. [PASS / WARN / FAIL]  메모: …
S14. [PASS / WARN / FAIL]  메모: …
S15. [PASS / WARN / FAIL]  메모: …
S16. [PASS / WARN / FAIL]  메모: …
S17. [PASS / WARN / FAIL]  메모: …

console error/warning capture (있는 경우):
…

새로 발견한 P0 blocker (있는 경우):
…
```

### Severity 분류 (사장님 회신 후 자동 적용)

| Severity | 정의 | 처리 |
|---|---|---|
| **P0 (blocker)** | production gen 자체 실패 / 데이터 corruption 진행 / secret 노출 / score 0 / 외국어 토큰 / 토큰 오염 | **즉시 코드 수정 phase로 전환** |
| **P1 (high)** | 사용자 흐름 1개 이상 막힘 / WARN이 모든 책에서 재현 | 다음 phase에서 fix |
| **P2 (medium)** | 시각/UX 디테일 / 일부 책에서만 WARN | 일정 협의 |
| **P3 (low/cosmetic)** | 색상·간격 등 cosmetic / cache hard refresh로 해결 | 후순위 |

---

## 5. 본 phase 작업물

| 산출물 | 위치 |
|---|---|
| DB 사전 진단 스크립트 | `.tmp/post1/audit_db_state.mjs`, `.tmp/post1/find_corrupt_books.mjs` (gitignored) |
| **본 체크리스트 보고서** | `docs/post1-ui-data-audit-checklist-2026-05-02.md` |
| 코드 변경 | **0건** (사장님 명시 요청 — P0 blocker가 발견되기 전까지 코드 수정 금지) |

```
POST-1 (진단 phase) verdict: CHECKLIST READY
P0 blocker 발견 여부: NO (사전 DB 진단 기준 — browser 결과는 사장님 회신 대기)
production blocker: NO
recommended next step: 사장님이 §2의 17개 scenario를 browser에서 실행 후 §4 양식으로 회신 → P0 발견 시 즉시 코드 수정 phase, 없으면 P1/P2/P3 항목만 일정 협의
근거: POST-3에서 19/19 verify PASS / production blocker 0건 / 누적 evidence 172 generations 0 fail 상태에서 시작. DB 사전 진단 결과 23건 gender corruption은 모두 orphan rows(이미 삭제된 책 잔존, active books 영향 0건), 14권 ctx 누락도 모두 옛 테스트 책으로 active 사용자 책 아님, orphan rows 14,620은 production 영향 없음(별도 cleanup phase 권고). cache cleanup 위험 평가에서 P0 미발견. 17개 audit scenario를 시각/데이터/생성/재생성/세션격리/캐시/콘솔 7개 영역으로 정의, 각 scenario별 재현 순서 + 관찰 포인트 + PASS/WARN/FAIL 기준 명시. 검증 후보 책 3권 매핑(확깨용_검증 e2345de4 메인 / R6_OFFICE_ROMANCE 41be2380 regen / 확깨용_TEST 2f4bc632 기존 표시). 사장님이 §4 양식으로 회신하면 severity 분류 후 P0 → 즉시 fix, P1~P3 → phase 분리. 본 phase에서 코드 수정 0건, 새 기능 / guard / prompt / refactor 0건 — POST-1 정의에 부합. main push 안 함. DPO/Runpod 미실행. R5B-4d production route(openai_renderer)는 변경 없음.
```
