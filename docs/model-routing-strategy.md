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

*보고서 기준: 2026-04-28, FlowScribe checkpoint/phase1-launch-prep*
