# MODEL ROUTING STRATEGY REPORT
> FlowScribe — 2026-04-28

---

## 1. 현재 모델 사용 현황

| 역할 | 기본값 (ollama) | DeepSeek | Gemini | OpenAI |
|------|----------------|----------|--------|--------|
| 본문 생성 (storyModel) | qwen2.5:14b | deepseek-chat | gemini-2.5-pro-preview | gpt-4.1 |
| 플래너 (plannerModel) | qwen2.5:14b | deepseek-chat | gemini-2.0-flash | gpt-4.1-mini |
| 렌더러 (rendererModel) | qwen2.5:14b | deepseek-chat | gemini-2.5-pro-preview | gpt-4.1 |
| 추천 (suggestModel) | gemma3:12b | deepseek-chat | gemini-2.0-flash | gpt-4.1-mini |
| 요약 (summaryModel) | gemma3:12b | deepseek-chat | gemini-2.0-flash | gpt-4.1-mini |
| 세계관 추천 (world-setup) | ← suggestModel | — | **gemini-2.5-flash-lite** (직접 REST) | — |

- 현재 provider는 `LLM_PROVIDER` 환경변수로 결정 (`ollama` 기본)
- 세계관 추천(`/api/suggest/world-setup`)만 `GEMINI_API_KEY` 유무로 별도 라우팅
- AI 추천 v1~v2: Gemini 2.5 Flash Lite (직접 REST) → 로컬 fallback

---

## 2. 후보 모델별 강점/약점

### Gemini 2.5 Flash Lite (API)
| 항목 | 평가 |
|------|------|
| 비용 | 저비용 (Flash Lite 기준 입력 $0.075/1M, 출력 $0.30/1M — 추정치, 실측 필요) |
| 속도 | 매우 빠름 (~1-2초) |
| 한국어 추론력 | 우수 |
| JSON 구조 안정성 | 우수 (지시 준수율 높음) |
| 장문 세계관 이해 | 우수 |
| 소설 문체 생성력 | 보통 (창의적이나 장르 몰입감은 로컬 대형 모델보다 낮을 수 있음) |
| 개인정보/API 전송 부담 | 있음 (외부 서버) |
| 세션 로딩 비용 | 없음 (API call) |
| 동시성 | 우수 |
| fallback | 로컬으로 폴백 가능 |

### Gemini 2.5 Pro / 2.0 Flash (API)
| 항목 | 평가 |
|------|------|
| 비용 | 중~고 (Flash는 중간, Pro는 고비용 — 실측 필요) |
| 속도 | Flash: 빠름, Pro: 중간 |
| 소설 문체 생성력 | 우수 (Pro) |
| JSON 안정성 | 우수 |
| 주의 | 복잡한 소설 문체 생성에 Pro 권장 |

### DeepSeek-V3 / DeepSeek-Chat (API)
| 항목 | 평가 |
|------|------|
| 비용 | 저비용 (입력 ~$0.07/1M, 출력 ~$1.1/1M — 추정치, 실측 필요) |
| 속도 | 중간 |
| 한국어 추론력 | 우수 |
| JSON 구조 안정성 | 우수 (구조화 검증에 적합) |
| 소설 문체 생성력 | 우수 (한국어 소설 맥락 이해 뛰어남) |
| 개인정보/API 전송 부담 | 있음 (중국 서버) |
| fallback | 가능 |

### Local Gemma3:12b (ollama)
| 항목 | 평가 |
|------|------|
| 비용 | 로컬 전기비만 |
| 속도 | 중간 (VRAM 충분 시 빠름, 실측 필요) |
| 한국어 추론력 | 보통 (12b 기준 경량, 복잡한 추론 한계) |
| JSON 구조 안정성 | 보통 (단순 구조 OK, 복잡한 스키마 불안정) |
| 소설 문체 생성력 | 보통 |
| 세션 로딩 비용 | 있음 (초기 로딩 ~수초) |
| VRAM 요구 | ~8GB (Q4 기준) |
| 동시성 | 낮음 (GPU 단일 점유) |
| 개인정보 | 로컬 처리 — 외부 전송 없음 |

### Local Gemma3:27b (ollama)
| 항목 | 평가 |
|------|------|
| 비용 | 로컬 전기비만 |
| 속도 | 느림 (실측 필요 — VRAM 부족 시 CPU 폴백으로 매우 느릴 수 있음) |
| 한국어 추론력 | 우수 (27b) |
| JSON 구조 안정성 | 우수 |
| 소설 문체 생성력 | 우수 |
| VRAM 요구 | ~16-20GB (Q4 기준) |
| 동시성 | 매우 낮음 |
| 개인정보 | 로컬 처리 |
| 주의 | VRAM 실측 필수 — 부족 시 CPU offload로 10x 느려짐 |

---

## 3. 역할별 요구사항

| 역할 | 핵심 요구 | 실시간 여부 |
|------|-----------|------------|
| 세계관/장르/규칙 추천 | 창의성, 한국어, JSON 안정성 | 버튼 클릭 → 1-3초 허용 |
| 인물/소지품 추천 | 창의성, 세계관 이해, JSON | 버튼 클릭 → 2-4초 허용 |
| 플래너 | JSON 구조 엄수, 논리 일관성 | 생성 시작 전 → 3-8초 허용 |
| 본문 생성기 | 소설 문체, 장문 생성, 창의성 | SSE 스트리밍 → 즉시 시작 필요 |
| 후처리/대사 분리 | 빠른 정규화, 구조 단순 | 생성 완료 후 → 1초 이내 |
| 검증기/audit | 구조 판단, JSON judge | 백그라운드 → 지연 허용 |
| repairPlan | 빠른 오류 수정, 단순 JSON | 플래너 실패 시 → 2초 이내 |
| item description/category | 간단한 분류, 한국어 설명 | 백그라운드 → 지연 허용 |

---

## 4. 주요 조합 비교표

| 조합 | 추천/검증 | 플래너 | 본문 생성 | 후처리/repair | 비용 | 품질 | 속도 | 개인정보 |
|------|----------|--------|----------|--------------|------|------|------|---------|
| **현재 기본** | Gemini FL (추천) / gemma3:12b (기타) | qwen2.5:14b | qwen2.5:14b | gemma3:12b | 낮음 | 보통 | 중간 | 혼합 |
| A. Gemini 추천+검증 / 로컬 생성 | Gemini Flash | Gemma3:27b | Gemma3:27b | Gemma3:12b | 낮음 | 높음 | 중간 | 혼합 |
| B. DeepSeek 검증 / 로컬 생성 | DeepSeek (검증) | qwen2.5:14b | qwen2.5:14b | Gemma3:12b | 낮음 | 중간 | 중간 | 부분 |
| C. DeepSeek 전체 API | DeepSeek | DeepSeek | DeepSeek | DeepSeek | 중간 | 높음 | 중간 | 외부 |
| D. Gemma3:27b 플래너+생성 | Gemma3:12b | Gemma3:27b | Gemma3:27b | Gemma3:12b | 로컬 | 높음 | 느림* | 완전 로컬 |
| E. Gemma3:12b 전체 로컬 | Gemma3:12b | Gemma3:12b | Gemma3:12b | Gemma3:12b | 로컬 | 보통 | 빠름 | 완전 로컬 |
| F. Gemini Pro 생성 | Gemini Flash (추천) | Gemini Flash | Gemini Pro | Gemini Flash | 고비용 | 최상 | 빠름 | 외부 |
| G. Gemini Flash 추천 / DeepSeek 생성 | Gemini Flash | DeepSeek | DeepSeek | DeepSeek | 중간 | 높음 | 중간 | 외부 |
| H. API 고추론 전용 / 로컬 생성 | Gemini Flash | Gemini Flash | Gemma3:27b | Gemma3:12b | 낮음 | 높음 | 혼합 | 혼합 |

*Gemma3:27b 속도는 VRAM 용량에 따라 크게 달라짐 (실측 필수)

---

## 5. 추천 라우팅안 v1

```
세계관 추천/규칙/인물 추천    → Gemini 2.5 Flash Lite (REST 직접 호출)
                               fallback → gemma3:12b (로컬)

플래너 (plan JSON 생성)        → 실측 후 결정
                               후보: qwen2.5:14b (현재) 또는 Gemma3:27b
                               기준: JSON 준수율, 계획 논리 일관성

본문 생성기 (스트리밍)         → qwen2.5:14b (현재, 로컬)
                               업그레이드 후보: Gemma3:27b (VRAM 확인 후)
                               DeepSeek 후보: 한국어 소설 품질 A/B 실험 권장

후처리/대사 분리               → gemma3:12b (로컬, 빠름)
                               또는 regex/rule-based (LLM 미사용)

repairPlan                     → gemma3:12b (로컬, 빠름)

검증기/audit (백그라운드)      → DeepSeek 또는 Gemini Flash
                               현재: gemma3:12b (로컬)

item description/category      → Gemini 2.5 Flash Lite (현재 구현 유지)
                               fallback → gemma3:12b
```

---

## 6. 비용 최적화 관점

- **Gemini 2.5 Flash Lite**: 세계관 추천 등 단발성 요청에 최적. 프롬프트가 짧고 응답이 200-500 tokens 수준이므로 호출당 비용 매우 낮음.
- **DeepSeek**: 본문 생성에 사용 시 장문(2000자 이상) 생성이 잦아 토큰 비용 주의. 단, 로컬 대비 품질이 높아 트레이드오프.
- **로컬 모델**: 전기비 외 비용 없음. 단, GPU 없이 CPU만 사용 시 생성 속도가 크게 저하되어 UX 문제 발생 가능.
- **권장**: 추천/검증 = API (저비용 + 빠름), 본문 생성 = 로컬 (비용 0 + 개인정보 안전)

---

## 7. 세션 로딩/컴퓨팅 최적화 관점

- `gemma3:12b`는 이미 로드된 상태를 ollama가 캐시하므로 두 번째 호출부터 빠름
- `gemma3:27b`는 처음 로딩 시 수십 초 소요 가능 — 서버 시작 시 warm-up 호출 권장
- `qwen2.5:14b`가 이미 storyModel로 점유 중이면 플래너가 동시에 같은 모델을 써서 GPU 경합 발생 가능 → plannerModel을 별도 모델로 분리하거나 큐잉 처리 필요
- BullMQ 큐 덕분에 백그라운드 작업(audit, item_desc)은 실시간 생성과 분리됨 — 이 구조 유지 필수

---

## 8. 한국어 품질 관점

- **Gemini (Flash/Pro)**: 한국어 추론·생성 모두 뛰어남. 세계관 설정, 인물 이름, 소지품 설명 등에서 자연스러운 한국어 출력.
- **DeepSeek-V3**: 한국어 이해 및 생성 우수. 소설 문체의 경우 Gemini Pro/DeepSeek 간 A/B 테스트 권장.
- **qwen2.5:14b**: 로컬 모델 중 한국어 소설 생성에 검증된 모델. 현재 본문 생성 기본으로 사용 중.
- **gemma3:12b/27b**: 한국어 지원은 가능하나 소설 문체 완성도는 qwen2.5:14b보다 낮을 수 있음 (실측 필요). 특히 12b는 추천/후처리 정도에 적합.
- **권장**: 소설 본문 품질이 최우선이면 DeepSeek 또는 Gemini Pro A/B 실험 권장.

---

## 9. Fallback 정책

```
Gemini API 실패 (네트워크/quota) → getLLMClient() + getSuggestModel() (로컬)
DeepSeek API 실패               → 로컬 모델로 자동 전환 (현재 미구현 — 권장 추가)
로컬 모델 응답 없음              → JSON 파싱 실패 → 로컬 hardcoded fallback (현재 구현)
Gemini key 없음                  → 자동으로 로컬 fallback (현재 구현)
```

- 세계관 추천: `GEMINI_API_KEY` 없으면 자동으로 로컬 → UX 영향 없음
- 본문 생성: 로컬 모델만 사용 중 → API fallback 없음 (의도된 설계)
- 권장: DeepSeek을 본문 생성 fallback으로 추가 옵션 제공 (`LLM_PROVIDER=deepseek`)

---

## 10. 최종 추천

### 즉시 적용 가능 (현재 환경)
| 역할 | 추천 모델 | 근거 |
|------|----------|------|
| 세계관/장르/인물/규칙 추천 | **Gemini 2.5 Flash Lite** | 검증됨, 빠름, 저비용 |
| item description 생성 | **Gemini 2.5 Flash Lite** | 현재 구현, 배경 처리 |
| 추천 fallback | **gemma3:12b** | 현재 구현 |
| 본문 생성 | **qwen2.5:14b** | 현재 구현, 검증됨 |
| 플래너 | **qwen2.5:14b** | 현재 구현 |
| 후처리/repair | **gemma3:12b** | 빠름, 단순 구조 |
| audit/검증 (백그라운드) | **gemma3:12b** → DeepSeek 실험 권장 | 현재 구현 |

### 단기 실험 권장
1. **Gemma3:27b 플래너 실험**: JSON 계획 품질 비교 (qwen2.5:14b vs gemma3:27b)
2. **DeepSeek 본문 생성 A/B**: 한국어 소설 문체 품질 비교
3. **Gemma3:27b VRAM 실측**: 현재 서버 VRAM 용량 확인 후 생성기 교체 여부 결정

### 실측이 필요한 항목
- `gemma3:12b` 첫 번째/두 번째 호출 응답 시간 (ollama cache warm)
- `gemma3:27b` VRAM 사용량 및 토큰 속도
- `qwen2.5:14b` 플래너 JSON 준수율 (현재 trace log 분석 필요)
- Gemini 2.5 Flash Lite 실제 호출 비용 (대화 기록 기반 계산)
- DeepSeek 한국어 소설 생성 품질 점수 (DPO 데이터 기준)

---

---

## 11. 장편 관점 모델 라우팅 전략 (30화/100화 검증 기반)

> 근거: `scripts/verify_long_story_memory.mjs` fixture 시뮬레이션 결과 (2026-04-28)
> - 30화 fixture: **READY** (30/30 PASS)
> - 100화 fixture: **READY** (93/100 PASS, WARN 7개 — open_thread 과다)

### 11.1 장편에서 나타나는 병목 역할

| 역할 | 30화 | 100화 | 위험 요인 |
|------|------|-------|----------|
| **Planner** | 보통 | **병목 가능** | 30화 이후 continuity_contract 크기 증가(known_facts 15개+) → JSON 크기 비례 증가. 12b 모델에서 지시 준수율 저하 우려. |
| **Renderer** | 보통 | **병목 가능** | 100화 이상 arc_summary × 10개 + continuity_contract를 시스템 프롬프트에 모두 주입 시 컨텍스트 길이 초과 위험. |
| **summaryModel** | 안정 | 안정 | rolling_summary는 최근 10화 창으로 고정 → 토큰 부하 안정적. |
| **arc_memory 생성** | 안정 (10화마다) | **부하 증가** | 100화 = 10회 arc 생성 × 5인물 = 최대 50개 character_arcs row. 조회 쿼리 비용 선형 증가. |
| **foreshadow checker** | 안정 | **누적 위험** | 100화 시뮬레이션 기준 open_thread 최대 14개 (threshold 15 근접). 능동적 회수 로직 없으면 ep85+ WARN 발생. |
| **continuity checker** | 안정 | 안정 | 현재 deterministic 패턴 매칭 — 모든 구간 overhead 없음. |

### 11.2 플래너 모델 충분성 평가

- **현재 qwen2.5:14b 플래너**: 30화까지는 JSON 계획 품질 유지 예상. 단, 30화 이후 continuity_contract.known_facts가 15개 이상으로 고정되므로 프롬프트 복잡도 정체 → 12b 이상이면 이 부분은 안정.
- **100화 이상에서의 우려**: planner 프롬프트에 arc_summary 10개 누적 주입 시 컨텍스트 길이 증가. `qwen2.5:14b`의 context window가 충분한지 실측 필요 (모델에 따라 4K~32K).
- **Gemma3:27b 플래너 실험 권장 시점**: 30화 실제 생성 결과에서 plan 구조 붕괴(missing_fields, wrong arc_phase) 횟수가 3회 이상이면 27b 교체 검토.

### 11.3 렌더러 모델 충분성 평가

- **현재 qwen2.5:14b 렌더러**: renderer 시스템 프롬프트에 prev_episode_tail(500자) + continuity_contract(금지사항 + known_facts) + arc_summary(500자) + finaleSection이 순차 주입됨.
- **100화 시 시스템 프롬프트 추정 크기**: ~3,000~5,000 tokens. `qwen2.5:14b`의 context window 내이지만, 소설 본문(목표 2,000자) 포함 시 총 ~8,000 tokens 수준. 실측 권장.
- **위험 구간**: ep 90+ — finaleSection + pre_final + arc × 10개 동시 주입 시. 이 구간에서 모델 지시 준수율이 저하되면 Gemini 2.5 Pro 또는 DeepSeek으로 렌더러 교체 고려.

### 11.4 Validator/Audit 필요성

- **현재**: continuity checker는 deterministic (패턴 매칭). 비용 없음, 지연 없음.
- **30화 이상 실제 생성 시 추가 필요**:
  - `arc_phase` 정합성 검증 (planner가 올바른 phase를 선택했는지)
  - `known_facts` 반영 여부 (생성된 본문에 continuity_contract facts가 실제로 반영됐는지)
  - B플롯 소실 감지 (open_threads 중 연속 미언급 횟수 추적)
- **Gemini 2.5 Flash 또는 DeepSeek를 background audit으로**: 고비용이지만 30화 단위 아크 완료 시점에 한 번씩 적용하면 호출 수는 3회(30화 기준).

### 11.5 Gemma3:27b 실험 필요성

- **플래너**: `qwen2.5:14b` 대비 JSON 구조 안정성 실측 필요. 특히 `continuity_contract` 소비 품질.
- **렌더러**: 30화 이상 장문 생성에서 서사 일관성 유지력 비교.
- **우선순위**: 30화 실제 생성 PASS 후, ep 20~30 구간 plan 품질을 수동 평가한 뒤 필요 시 도입.

### 11.6 100화 이상 구체적 위험과 대응

| 위험 | 100화 fixture 결과 | 권장 대응 |
|------|-------------------|----------|
| open_thread 과다 누적 | ep85+ WARN (최대 14개) | `checkAndResolveForeshadows` 매칭 민감도 향상 또는 ep 20마다 강제 정리 로직 |
| rolling_summary 초반 목표 유실 | ep 10 이후 최근 10화만 유지 | arc_summary가 이를 보완하는 구조 — arc가 정상 생성되는 한 허용 범위 |
| character_arcs DB 누적 | 10개 아크 × 5인물 = 50 row | `getLatestCharacterArcs` 이미 `DISTINCT ON` 사용 → 쿼리 부하 낮음 |
| finalization directive 미작동 | fixture 기준 정상 (score 1.0) | 실제 생성에서는 ending_constraint=final 조건 확인 필수 |

### 11.7 30화 실제 생성 진행 여부

**판정: CONDITIONAL READY**

조건:
1. `npm run build` clean ✓ (확인됨)
2. 모든 verify 스크립트 PASS ✓ (확인됨)
3. fixture 30화 READY ✓ (확인됨)

사전 확인 필요:
- 예상 생성 시간: 화당 ~30~90초(로컬 qwen2.5:14b) → 30화 = 15~45분
- 예상 API 호출: summaryModel × 30 + suggestModel × 0 → Gemini 호출 없음(로컬만)
- DB row 증가: episodes × 30 + episode_snapshots × 30 + foreshadows × ~10 + character_arcs × 5(ep30 단편 아크 또는 ep10,20,30 각 아크)
- 실패 시 재개: `episode_number`가 unique key → 중간 중단 후 재시작 가능 (ON CONFLICT DO NOTHING 구현 확인 필요)
- 결과 snapshot: `episode_snapshots` 테이블에 자동 저장됨

---

*보고서 기준: 2026-04-28, FlowScribe checkpoint/phase1-launch-prep*
*장편 검증 섹션 추가: 30화/100화 fixture 결과 반영*
