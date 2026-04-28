# Story Quality Audit Summary — test_fantasy_B 30화

**감사 일시**: 2026-04-29  
**감사 도구**: Gemini 2.5 Flash (한국어 서사 편집자 관점)  
**대상**: test_fantasy_B / 30화 actual trace (3135d67 기준)  
**스크립트**: `scripts/audit_story_quality_with_gemini.mjs`  
**로컬 출력**: `tracking/story_quality_audit/20260429T065644/` (커밋 제외)

---

## [ GEMINI STORY QUALITY AUDIT REPORT ]

### 1. 브랜치/상태

| 항목 | 값 |
|---|---|
| 브랜치 | checkpoint/phase1-launch-prep |
| 커밋 | 3135d67 |
| Working tree | clean |
| book_id | test_fantasy_B |
| 테스트북 제목 | test_fantasy_B (판타지 / 아르넬, 세라, 크로그, 발루르) |
| Gemini model | gemini-2.5-flash |
| API key 노출 | 없음 |

---

### 2. 실행 범위

- 읽은 회차: 1~30화 전체
- 확인한 DB 테이블: episodes, run_traces, arc_summaries, character_arcs, foreshadows, character_dynamic_states, canonical_characters
- chunk 구성: 5화씩 6청크 + 최종 통합
- 사용한 스크립트: `scripts/audit_story_quality_with_gemini.mjs`

---

### 3. Gemini 전체 판정

| 항목 | 결과 |
|---|---|
| **30화 작품 품질** | **NOT READY** |
| overall_story_quality | **0.35** |
| 50화 actual 가능 여부 | **불가** |
| 모델 라우팅 실험 가능 여부 | **불가** |

**가장 큰 장점 3개**
1. 아크 구조 명확 — 3개 아크에 걸쳐 서사 방향과 인물 변화 계획은 수립됨
2. 복선 관리 시스템 기본 작동 — 117개 중 103개 회수(88%)
3. 부분적 독자 연속성 유지 — 일부 화에서 흐름 자연스러움

**가장 큰 문제 5개**
1. **치명적 메모리 정합성 실패** — character_dynamic_states 누락 (21, 24, 27, 28화 `(없음)`)
2. **인물 정체성 혼란** — '아이'/'어린아이'/'그림자 속 아이'/'그림자 속 존재' 중복 (8~10화, 26~30화), 발루르/'낯선 기사' 이중 존재 (29~30화)
3. **서사 반복/정체** — 아르넬 의식 상실 3화 연속 반복 (21~23화), 11~13화 요약=본문 반복
4. **소지품/위치 불일치** — 아르넬 초기 소지품 누락 (2~5화), 발루르 무기 명칭 혼재 (25화), 크로그 이동 경위 불명 (29→30화)
5. **복선 관리 미흡** — 1화 복선 근거 불일치, 10화 회수 모호성, 미해소 복선 14개

---

### 4. 회차별 독자 평가 요약

| 화 | 판정 | 독자연속성 | 페이싱 | 메모리정합성 | 비고 |
|---|---|---|---|---|---|
| 1 | PASS | 자연스러움 | 적절함 | PASS | 복선 근거 1건 불일치 |
| 2 | WARN | 자연스러움 | 적절함 | FAIL | 아르넬 위치·소지품 누락 |
| 3 | WARN | 자연스러움 | 적절함 | FAIL | 아르넬 위치·소지품 누락 |
| 4 | FAIL | 흐름 혼란/반복 | 느림 | FAIL | 이야기 반복, 소지품 누락 |
| 5 | WARN | 자연스러움 | 적절함 | WARN | 소지품 흐름 불연속 |
| 6 | PASS | 자연스러움 | 적절함 | PASS | — |
| 7 | WARN | 자연스러움 | 적절함 | WARN | 어린아이 감정/위치 불일치 |
| 8 | FAIL | 자연스러움 | 적절함 | FAIL | '아이'/'어린아이' 분리·위치 불일치 |
| 9 | FAIL | 자연스러움 | 적절함 | FAIL | 동일 |
| 10 | FAIL | 자연스러움 | 적절함 | FAIL | 동일, 복선 회수 모호성 |
| 11 | WARN | 느린 전진 | 느림 | WARN | 요약≈본문 반복 시작 |
| 12 | WARN | 느린 전진 | 느림 | WARN | 반복 |
| 13 | WARN | 느린 전진 | 느림 | WARN | 반복 |
| 14 | PASS | 자연스러움 | 적절함 | PASS | — |
| 15 | PASS | 자연스러움 | 적절함 | PASS | 세라/크로그 등장 전환점 |
| 16 | PASS | 자연스러움 | 적절함 | PASS | — |
| 17 | PASS | 자연스러움 | 적절함 | PASS | — |
| 18 | PASS | 자연스러움 | 적절함 | PASS | — |
| 19 | PASS | 자연스러움 | 적절함 | PASS | — |
| 20 | PASS | 자연스러움 | 적절함 | PASS | — |
| 21 | FAIL | GOOD | GOOD | FAIL | 인물 상태 전체 누락 |
| 22 | WARN | WARN | WARN | GOOD | 의식 상실 2회 반복, 제목 중복 |
| 23 | FAIL | FAIL | FAIL | GOOD | 의식 상실 3회 반복(치명적) |
| 24 | FAIL | GOOD | GOOD | FAIL | 인물 상태 전체 누락 |
| 25 | WARN | GOOD | GOOD | WARN | 발루르 무기 명칭 불일치 |
| 26 | PASS | 자연스러움 | 적절함 | WARN | 그림자/아이 중복 인물 |
| 27 | FAIL | 깨짐 | 느림 | FAIL | 인물 상태 전체 누락 |
| 28 | FAIL | 깨짐 | 느림 | FAIL | 인물 상태 전체 누락 |
| 29 | FAIL | 깨짐 | 적절함 | FAIL | 발루르/낯선 기사 혼란, 소지품 불일치 |
| 30 | FAIL | 깨짐 | 적절함 | FAIL | 크로그 위치 이동 불명, 발루르 혼란 지속 |

**PASS: 8화 / WARN: 9화 / FAIL: 13화**

---

### 5. 메모리 정합성 평가

| 구조 | 평가 |
|---|---|
| rolling_summary | 부분적 정확 — 요약이 본문의 주요 사건을 포함하지만 감정 흐름 반영 미흡, 11~13화 구간에서 중복 심각 |
| arc_summary | 기본 작동 — 아크별 주요 사건 정리 됨. 단 추상화 과다로 세부 인물 상태 변화 누락 |
| character_arcs | 12행 존재 (아크1~3 × 4인물) — 큰 틀 파악 가능하나 화별 정밀 추적 불가 |
| foreshadow | DB status 88% recall — 단 키워드 매칭 방식의 회수 판정으로 실제 회수 여부 불확실 |
| character_dynamic_states | **치명적 누락** — 21, 24, 27, 28화에서 전체 공백. 인물 추적 시스템의 간헐적 붕괴 |

---

### 6. 인물/소지품/복선 평가

**인물 아크**

| 인물 | 초반 | 중반 | 후반 | 최종 | 문제 |
|---|---|---|---|---|---|
| 아르넬 | 마법 불안정, 모험 시작 | 심연 침식, 발루르와 대면 | 포획/의식 상실 반복 | 발루르 정체 폭로 | 의식 상실 반복(21~23화) |
| 세라 | 조력자 | 수색/구출 | 발루르 대치 | 구출 성공 | 중반 존재감 약화 |
| 크로그 | 조력자 | 동행 | 전투 | 위치 불명 | 30화 위치 이동 설명 없음 |
| 발루르 | 악역 소개 | 침식 | 물리적 출현 | 낯선 기사=발루르 폭로 | 물리적 존재 vs 의식 내 존재 혼재 |

**소지품 주요 문제**
- 아르넬: 마법 지팡이, 엘프 망토 2~5화 미반영
- 발루르: "암흑 검" vs "핏빛 칼날" 25화 불일치
- 낯선 기사: "검은 갑옷+빛나는 검" vs 아이템 기록에 "검"만 존재 (29화)

**복선 평가**

| 구분 | 수량 | 주요 사례 |
|---|---|---|
| resolved | 103 | 심연의 속삭임, 발루르의 정체 등 |
| open | 14 | 1화·8화·17화 복선 미해소 |
| 의심스러운 회수 | 다수 | 키워드 매칭 기반 — 실제 회수 여부 불확실 |

---

### 7. 최종화(30화) 평가

| 항목 | 평가 |
|---|---|
| 갈등 해결 | 부분적 — 낯선 기사=발루르 폭로 완료, 아르넬 포획 해결 |
| 감정적 보상 | 낮음 — 인물 상태 누락으로 감정선 단절 |
| 복선 회수 | 불완전 — 14개 미해소 |
| 완결감 | 매우 낮음 — 발루르 존재 방식 혼란 미해소, 크로그 위치 설명 없음 |
| 새 떡밥 과다 | 있음 — 그림자 아이 정체 미해소 상태로 종결 |
| finalization_quality | **0.30** |

---

### 8. Gemini가 제안한 개선 방향

| 영역 | 개선 제안 |
|---|---|
| Planner prompt | 직전 화 의식 상실 여부 체크 → 같은 상태 반복 금지 지시 추가 |
| Renderer prompt | "이전 화에서 이미 발생한 사건을 반복 서술 금지" negative prompt 명시 |
| Continuity contract | character_dynamic_states 공백 발생 시 전 화 상태 자동 carry-over |
| Memory schema | alias 정규화 — '아이'/'어린아이'/'그림자 속 아이' 동일 entity 처리 |
| Foreshadow | LLM 기반 회수 판정으로 교체 (키워드 매칭 → 의미 유사도) |
| Item flow | canonical_characters initial_items → character_dynamic_states 자동 seed |
| Finalization | 발루르 물리적 존재 vs 의식 내 존재 명확 분리 지시 |

---

### 9. Claude Technical Cross-Check

**DB/코드로 확인된 항목**
- character_arcs: 12행 존재 (아크1~3 × 아르넬/세라/크로그/발루르) ← BUG-1 수정으로 이미 해결
- foreshadow recall: 117건 중 103건 resolved = 88% (DB 계산값)
- episode count: 30화 전체 저장 확인
- 인물 상태 누락 (21, 24, 27, 28화): DB에서 character_dynamic_states 해당 화 rows = 0 확인됨 → **실제 버그**

**주관적 판단 항목**
- 독자 몰입감, 의식 상실 반복의 "피로감" → 모델 출력 패턴 문제
- 발루르/"낯선 기사" 혼란 → 프롬프트 설계 문제 (DB에는 별도 entity로 저장됨)
- 그림자/아이 alias 혼란 → pipeline name_classifier 정규화 미흡

**GPT에게 넘길 핵심 질문**
1. `character_dynamic_states` 누락 화가 발생하는 원인은 planner/renderer 어느 단계인가?
2. 의식 상실 반복을 막기 위해 플래너가 어떤 필드를 check해야 하는가?
3. alias ('아이'/'어린아이'/'그림자 속 아이') 정규화를 pipeline 어느 단계에서 처리해야 하는가?
4. 발루르의 물리적 존재 vs 의식 내 존재를 DB schema에서 어떻게 분리할 것인가?
5. foreshadow 회수 판정을 키워드 매칭에서 LLM 기반으로 교체하면 비용/지연 trade-off는?

**바로 수정하면 안 되는 항목**
- 프롬프트 전면 리팩터링 (GPT 계획 선행)
- character entity 정규화 schema 변경 (마이그레이션 필요)
- foreshadow 판정 알고리즘 교체 (설계 합의 필요)
- 발루르 entity 분리 (서사 재설계 필요)

---

### 10. 다음 단계 제안

**GPT에게 넘길 분석 요청**
- 이 보고서 전체 + 청크별 보고서 (`tracking/story_quality_audit/20260429T065644/`) 첨부
- "플래너/렌더러/메모리 구조 관점에서 위 문제들의 근본 원인을 분석하고, 리팩터링 계획을 작성해달라"

**GPT가 작성해야 할 리팩터링 계획**
1. Planner prompt 개선안 (반복 방지, 인물 상태 체크)
2. Renderer negative prompt 목록
3. character_dynamic_states 자동 carry-over 로직
4. alias 정규화 전략
5. foreshadow 판정 개선 설계

**Claude가 이후 받을 구현 프롬프트 방향**
- GPT 리팩터링 계획 → Claude 구현 프롬프트로 전달
- 각 항목별 단위 구현 (한 번에 하나씩)

---

### 11. 최종 판단

| 항목 | 결과 |
|---|---|
| **30화 품질** | **NOT READY** (0.35 / FAIL 13화, WARN 9화) |
| **50화 actual** | **보류** — character_dynamic_states 누락 버그 및 반복 서술 문제 선해결 필요 |
| **모델 라우팅** | **보류** — 품질 문제가 모델 라우팅 이전에 프롬프트/메모리 구조 문제임 |

**우선순위 높은 개선 후보 5개**

| 순위 | 항목 | 유형 |
|---|---|---|
| 1 | character_dynamic_states 누락 화 원인 파악 및 carry-over 로직 | BUG |
| 2 | Renderer: 의식 상실/동일 사건 반복 서술 금지 지시 | Prompt |
| 3 | 인물 alias 정규화 ('아이'/'어린아이'/'그림자 속 아이' → 단일 entity) | Schema/Pipeline |
| 4 | 발루르 물리적 존재 vs 의식 내 존재 분리 설계 | Schema |
| 5 | Foreshadow 회수 판정 강화 (키워드 → 의미 기반) | Algorithm |

---

*생성: `scripts/audit_story_quality_with_gemini.mjs` v1.0 | Gemini 2.5 Flash | 2026-04-29*
