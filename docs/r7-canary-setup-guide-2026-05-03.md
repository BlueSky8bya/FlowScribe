# R7 — Canary Setup Guide (사장 browser UI 입력용)

**날짜**: 2026-05-03
**Phase**: R7 (Clean Canary)
**HEAD**: `f915c62` POST-4 closeout 후속 (R7 plan)
**원칙**: 코드 수정 0건. 사장이 browser UI에 입력하면 됩니다.

---

## 0. Pre-canary Verify (완료)

```
npm run build (tsc)                                      PASS
verify_route_integrity                                   6/0/0
verify_public_js_syntax                                  25/25
verify_book_load_flow                                    41/0
verify_episode_end_character_cards                       27/27
verify_episode_end_character_cards_layout                22/22
verify_context_save_async                                13/13
verify_modal_save                                        16/16
verify_generation_session_guard                          14/14
verify_capture_title_format                              8/8
verify_item_category_source_priority                     12/12
verify_item_description_length                           21/21
verify_reading_mode_position_preserve                    15/15
```

12/12 PASS, 회귀 0. **30화 actual 진입 가능**.

---

## 1. Browser UI 입력값

http://localhost:3000 → Ctrl+Shift+R → 새 책 생성 → 아래 값 그대로 붙여넣기.

### 1.1 책 제목

```
R7_회색지대_생존기_CANARY
```

### 1.2 장르 / 분위기

장르 칩:
```
이세계  ←  미선택
SF       ←  미선택
판타지   ←  미선택
… (장르 칩 영역에서 "기타" 선택 후 직접 입력 OR settingVals에 다음 입력)
```

권고 입력 (settingVals + moodVals):
- settingVals 칩: `아포칼립스`
- moodVals 칩: `스릴러` + `드라마`

(체크리스트의 "장르/분위기 섹션 칩 표시" 검증과 호환)

### 1.3 세계관 (배경)

```
대규모 생태 붕괴와 통신망 붕괴 이후, 고립된 도시 외곽 생존 구역에서 네 명의 생존자가 제한된 식량과 장비를 들고 안전 구역을 찾아 이동하는 이야기. 초능력이나 마법은 없고, 모든 정보는 직접 관찰·기록·무전·기억을 통해서만 얻을 수 있다.
```

### 1.4 핵심 규칙 (8개 — 일반 7 + hard 0건이지만 hard 표기 필요시 1-2개로 변환 가능)

규칙 입력 영역에 한 줄씩:
```
죽은 인물은 말하거나 행동할 수 없다.
인물은 자신이 보지 못한 정보나 듣지 못한 정보를 알 수 없다.
부상은 다음 화에 자연스럽게 이어진다.
소지품은 갑자기 생기거나 사라지지 않는다.
식량, 의료품, 배터리, 무전기 등은 사용하면 상태가 변해야 한다.
위치 이동은 반드시 경로와 이유가 있어야 한다.
관계 변화는 사건과 대화를 통해 누적되어야 한다.
같은 발견을 매 화 처음 발견한 것처럼 반복하지 않는다.
```

권고: **첫 두 줄(죽은 인물 발화 금지 / 지식 경계)** 은 hard rule(절대 규칙)로 체크. 나머지는 일반 규칙.

### 1.5 인물 4명

#### 1) 한서윤 — 주인공

| 필드 | 값 |
|---|---|
| 이름 | `한서윤` |
| 성별 | `여성` |
| 역할 | `주인공` |
| 성격/배경 | `붕괴 전 응급구조사. 침착하지만 책임감 때문에 스스로를 몰아붙임. 동료의 부상이나 위기 앞에서 머뭇거리지 않지만, 자기 자신의 한계는 끝까지 인정하지 않으려 한다.` |
| 초기 소지품 | 아래 3개 |

소지품:
```
이름: 응급 처치 키트
설명: 붕대, 소독제, 진통제가 조금 남은 의료 가방
```
```
이름: 압축 영양바 묶음
설명: 하루치 열량을 겨우 채울 수 있는 비상 식량
```
```
이름: 휴대용 정수 필터
설명: 오염된 물을 제한적으로 걸러내는 생존 도구
```

#### 2) 강도현 — 조력자

| 필드 | 값 |
|---|---|
| 이름 | `강도현` |
| 성별 | `남성` |
| 역할 | `조력자` |
| 성격/배경 | `붕괴 전 전기 설비 기사. 현실적이고 계산적이지만 동료를 버리지 못한다. 위험 대비 이득을 빠르게 계산해서 결정하지만 결정한 후엔 누구보다 책임지려 한다.` |
| 초기 소지품 | 아래 3개 |

소지품:
```
이름: 다목적 공구
설명: 전선 절단과 간단한 수리에 쓰는 접이식 공구
```
```
이름: 소형 배터리 팩
설명: 낡은 전자기기를 잠깐 구동할 수 있는 충전 장치
```
```
이름: 낡은 무전기
설명: 짧은 거리에서만 작동하는 통신 장비
```

#### 3) 윤미라 — 라이벌

| 필드 | 값 |
|---|---|
| 이름 | `윤미라` |
| 성별 | `여성` |
| 역할 | `라이벌` |
| 성격/배경 | `외곽 정찰대 출신. 경계심이 강하고 단독 행동을 선호하지만 판단이 빠르다. 무리에 합류한 이유를 끝까지 밝히지 않는다.` |
| 초기 소지품 | 아래 3개 |

소지품:
```
이름: 접이식 단검
설명: 위협을 막기 위한 근접 무기
```
```
이름: 방독 마스크
설명: 필터 수명이 얼마 남지 않은 보호 장비
```
```
이름: 손상된 구역 지도
설명: 일부 구역 표시가 찢어진 오래된 종이 지도
```

#### 4) 이태오 — 조연

| 필드 | 값 |
|---|---|
| 이름 | `이태오` |
| 성별 | `남성` |
| 역할 | `조연` |
| 성격/배경 | `가족을 잃고 피난민 대열에서 떨어진 생존자. 겁이 많지만 관찰력이 좋고 기록을 잘 남긴다. 일행 중 가장 약하지만 가장 멀리까지 본다.` |
| 초기 소지품 | 아래 3개 |

소지품:
```
이름: 가족 사진
설명: 태오가 끝까지 버리지 못하는 개인 물품
```
```
이름: 소형 태블릿
설명: 배터리가 얼마 남지 않은 기록 장치
```
```
이름: 통조림 두 개
설명: 오래 보관된 비상 식량
```

### 1.6 서사 설정 (storyConfig)

| 필드 | 값 |
|---|---|
| POV | `3인칭 관찰자` |
| 스타일 | `균형` |
| 화 길이 | `2000` |
| 화 길이 변동 | `500` |
| 총 회차 | `30` (1차 — PASS 시 50까지 확장) |
| 총 회차 변동 | `5` |
| 갈등 / 복선 / 감정 / 대화 / 연출 | 모두 `5` |

### 1.7 저장

설정 입력 후 **세계관 설정 → 저장**.
- 저장 toast 정상 표시 + button restore + closeModal 자동 닫힘 → 정상.
- console error 0 + `/api/context` 200 + `/api/characters` 200 확인.

---

## 2. 책 생성 직후 사전 검증 (사장 환경)

book_id 확인 후 다음 명령:

```bash
BOOK_ID=<생성된_book_id>

# 1. canonical 4명 + initial_items 18개(인물당 3개 × 4명 + 일부 누락 예외)
node -e "
import('pg').then(async ({default:pg}) => {
  const {config}=await import('dotenv'); config();
  const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const r=await p.query('SELECT name,type,gender,initial_items FROM canonical_characters WHERE book_id=\$1 ORDER BY name',[process.env.BOOK_ID || '$BOOK_ID']);
  for (const row of r.rows) console.log(row.name, row.type, row.gender, '/items:', (row.initial_items||[]).length);
  await p.end();
});
"

# 2. vocab 분포 확인 (item_desc.ts 강화 prompt 결과)
node scripts/audit_item_vocab.mjs --book-id $BOOK_ID --detail
```

**기대 결과**:
- canonical 4명 (한서윤/강도현/윤미라/이태오)
- 각 인물 initial_items 3개 (총 12개)
- vocab category 분포: 의료 / 식량 / 도구 / 무기 / 통신 / 문서 / 기기 / 기타 등 다양
- mismatch 0건
- "기타" 비율 0%
- coverage 100%

**WARN 시그널** (있어도 30화 진행 가능, mid-report에 기록):
- coverage < 100% — fire-and-forget 분류 누락
- "기타" ≥ 1건 — LLM이 분류 못한 아이템
- mismatch ≥ 1건 — vocab vs canonical 충돌 (POST-1 §P1-A reopen-3로 client는 정상이어도 기록)

**FAIL 시그널** (P0):
- canonical 4명 미생성
- initial_items 0개 인물
- vocab 0건 (LLM 분류 미실행 — pipeline 회귀)

---

## 3. 30화 Actual 실행 체크리스트

### 3.1 화별 생성 흐름

각 화 생성 시 사장 browser에서 확인:

| # | 항목 | PASS 기준 |
|---|---|---|
| 1 | 본문 누적 표시 | 토큰 단위 자연스러움, 외국어/특수토큰 0 |
| 2 | 완료 score | ≥ 80 |
| 3 | character_states emit | 4명 모두 표시 (visibility 따라 일부 absent OK) |
| 4 | ep-end character cards | 등장 인물만 표시, 카테고리 배지 정상 |
| 5 | console error | 0 |
| 6 | network | `/api/generate` SSE done event 정상, `/api/generate/char-states` 200 |
| 7 | route metadata | `run_traces.planner_trace.model_used = "openai/gpt-4.1-mini"`, `provider = "openai"` |

### 3.2 화별 단발 audit (선택, 권고 — 5화마다)

```bash
BOOK_ID=<canary_book_id>
EP=<현재 화>

# 1. 사망자 발화 / 미등장 차단
node scripts/audit_meaningful_appearance_overlay.mjs --book-id $BOOK_ID --episode $EP

# 2. 소지품 상태 (사용 시 condition 변화)
node scripts/audit_episode_end_item_state.mjs --book-id $BOOK_ID --episode $EP

# 3. 위치 일관성
node scripts/audit_scene_transitions.mjs --book-id $BOOK_ID

# 4. 인물별 dynamic_state 정상
node scripts/audit_episode_end_state_alignment.mjs --book-id $BOOK_ID --episode $EP
```

### 3.3 체크포인트 — Regen (10/20/30화)

각 체크포인트 도달 후 **최신화 1회 재생성**:

| 단계 | 동작 |
|---|---|
| ep10 도달 | 본문 보기 → 재생성 버튼 → 새 본문 비교 |
| ep20 도달 | 동일 |
| ep30 도달 | 동일 |

각 재생성에서 확인:
- **과거 회차 재생성 가능 여부**: ep1~ep9 중 한 화 선택 후 재생성 버튼 → **차단 메시지 노출 또는 버튼 비활성화** (정책 위반 시 P0)
- **divergence**: 새 본문이 이전 본문과 충분히 다름 (대략 plot/key event/대화 다름)
- **score**: 재생성 후도 ≥ 80
- **이전 화 문맥 보존**: 재생성된 화에서 ep1~N-1의 인물/사건/소지품 상태 정확히 반영

재생성 후 audit:
```bash
BOOK_ID=<canary_book_id>
EP=10  # or 20, 30

node scripts/audit_episode_regen_divergence.mjs --book-id $BOOK_ID
node scripts/audit_regen_overconstraint.mjs --book-id $BOOK_ID
node scripts/audit_regen_plot_diversity.mjs --book-id $BOOK_ID
node scripts/audit_regeneration_memory.mjs --book-id $BOOK_ID
```

---

## 4. 30화 종료 후 실행할 Audit 명령 목록

```bash
BOOK_ID=<canary_book_id>

echo "── [Stability] ──"
node scripts/audit_generation_quality_integrity.mjs --book-id $BOOK_ID

echo "── [Story Quality] ──"
node scripts/audit_duplicate_discovery_events.mjs --book-id $BOOK_ID
node scripts/audit_narrative_repetition_guard.mjs --book-id $BOOK_ID
node scripts/audit_narrative_progression_stagnation.mjs --book-id $BOOK_ID
node scripts/audit_item_location_ledger.mjs --book-id $BOOK_ID
node scripts/audit_scene_transitions.mjs --book-id $BOOK_ID
node scripts/audit_knowledge_boundaries.mjs --book-id $BOOK_ID
node scripts/audit_emotional_progression.mjs --book-id $BOOK_ID
node scripts/audit_emotional_plausibility.mjs --book-id $BOOK_ID
node scripts/audit_character_aliases.mjs --book-id $BOOK_ID
node scripts/audit_meaningful_appearance_overlay.mjs --book-id $BOOK_ID

echo "── [Continuity] ──"
node scripts/audit_cross_episode_continuity.mjs --book-id $BOOK_ID
node scripts/audit_foreshadow_resolution.mjs --book-id $BOOK_ID
node scripts/audit_story_integrity_30.mjs --book-id $BOOK_ID
node scripts/audit_episode_end_state_alignment.mjs --book-id $BOOK_ID --episode 30

echo "── [Regen] ──"
node scripts/audit_episode_regen_divergence.mjs --book-id $BOOK_ID
node scripts/audit_regen_plot_diversity.mjs --book-id $BOOK_ID
node scripts/audit_regen_overconstraint.mjs --book-id $BOOK_ID
node scripts/audit_regeneration_memory.mjs --book-id $BOOK_ID

echo "── [Vocab/Category 정착도] ──"
node scripts/audit_item_vocab.mjs --book-id $BOOK_ID --detail

echo "── [POST-1/2/4 정적 verify 회귀 체크] ──"
node scripts/verify_route_integrity.mjs
node scripts/verify_episode_end_character_cards.mjs
node scripts/verify_item_category_source_priority.mjs
node scripts/verify_modal_save.mjs
node scripts/verify_capture_title_format.mjs
node scripts/verify_reading_mode_position_preserve.mjs
node scripts/verify_book_load_flow.mjs
node scripts/verify_public_js_syntax.mjs
node scripts/verify_context_save_async.mjs
node scripts/verify_generation_session_guard.mjs
node scripts/verify_item_description_length.mjs
```

### 4.1 DB-direct continuity 확인 (canonical-only 위반 검증)

```bash
node -e "
import('pg').then(async ({default:pg}) => {
  const {config}=await import('dotenv'); config();
  const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const c=await p.query(\"SELECT name FROM canonical_characters WHERE book_id=\$1\", [process.env.BOOK_ID]);
  const names=new Set(c.rows.map(r=>r.name));
  const d=await p.query(\"SELECT DISTINCT character_name FROM character_dynamic_states WHERE book_id=\$1\", [process.env.BOOK_ID]);
  const violators=d.rows.map(r=>r.character_name).filter(n=>!names.has(n));
  console.log('canonical:', [...names]);
  console.log('dynamic violators (canonical 미존재):', violators);
  if (violators.length) console.error('⚠ R3 canonical-only 정책 위반 — P0 후보');
  else console.log('✅ canonical-only 유지');
  await p.end();
});
"
```

기대: violators 0건 (canonical 4명만).

---

## 5. 30화 종료 후 mid-report 작성

`docs/r7-clean-canary-mid-report-2026-05-03.md`에 다음 구조:

```
1. Pre-canary verify result
2. Book setup confirmation (canonical 4명 + initial_items 12개)
3. Generation stability (fail/fallback/parse/foreign/retry 카운트)
4. Story quality audit 결과 (각 audit 요약)
5. Continuity audit 결과
6. Regen 결과 (10/20/30화 divergence)
7. POST-1/2/4 regression 결과
8. Vocab 정착도
9. P0/P1/P2 분류
10. 50화 확장 가능 여부 (사장 승인 대기)
```

P0 발견 시: 본 phase 명세 — **즉시 코드 수정 금지**. 원인 분류만 보고.

---

## 6. 30화 진행 가능 여부

**가능**.

- Pre-canary verify 12/12 PASS
- 회귀 0건
- production route(openai_renderer) + DeepSeek 보존 정책 + POST-1/2/4 모두 main 동기

사장 진행 신호:
1. Browser UI에서 §1의 입력값으로 책 생성
2. book_id 회신 (또는 UI에서 확인)
3. §2의 사전 검증 명령 실행 후 결과 회신
4. 30화 actual 시작

---

## 7. 본 plan 작업물 (현재까지)

| 산출물 | 위치 |
|---|---|
| R7 canary plan | `docs/r7-clean-canary-plan-2026-05-03.md` |
| 본 setup guide | `docs/r7-canary-setup-guide-2026-05-03.md` |
| 코드 변경 | **0건** |

git status:
```
 M .claude/scheduled_tasks.lock         (untouched, NOT staged)
 M scripts/cloud_dpo/launch_dpo.py      (untouched, NOT staged)
```

leftover stage 0건 — 사장 정책 100% 준수.
