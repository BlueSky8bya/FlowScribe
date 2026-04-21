# tools/ — 기술 통합 및 구현 가이드

## 이 문서의 목적

에이전트는 이 문서를 다음 경우에만 읽는다.
- 코드 수정이 필요할 때
- API 연동 방식이 필요할 때
- 함수 책임과 호출 방식이 필요할 때
- 기술 스택 선택 근거가 필요할 때

> **프론트엔드 파일 구조:** `tools/design-system.md` 참조

---

## 0. 현재 기술 스택 (2026-04 기준)

| 영역 | 선택 | 현재 상태 |
|---|---|---|
| 텍스트 생성 LLM | qwen2.5:14b (Ollama) | ✅ 운영 중 |
| 브라우저 스트리밍 | SSE (Server-Sent Events) | ✅ 운영 중 |
| 비동기 큐 | BullMQ + Redis | ✅ 운영 중 (4개 큐) |
| 데이터베이스 | PostgreSQL | ✅ 운영 중 |
| 독자 프로필 | Redis (profile:{book_id}) | ✅ 운영 중 |
| TTS | - | 🔲 Phase 2 (아카이브 구축 후) |
| BGM | assets/bgm/ | 🔲 Phase 3 |
| 파일 스토리지 | 로컬 → S3 (prod) | 🔲 Phase 3 |

---

## 1. 서버 아키텍처

```
Browser (SSE 수신)
    ↕ HTTP / SSE
Node.js + Express (src/index.ts, PORT 3000)
    ├── /api/generate    → SSE 스트리밍 에피소드 생성
    ├── /api/suggest     → AI 캐릭터/규칙 추천 (Ollama /api/chat 직접 호출)
    ├── /api/logs        → 세션 로그 수집 (BullMQ 큐 진입)
    ├── /api/episodes    → 에피소드 저장/요약
    ├── /api/characters  → 인물 CRUD
    ├── /api/context     → World Bible Redis 캐시
    └── /api/debug       → 파이프라인 상태 확인

Ollama (http://localhost:11434)
    ├── gemma3:27b  — 스토리 생성 전용 (VRAM ~15.6GB, 2x3080 분산)
    └── llama3.1:8b — 추천/구체화 전용 (VRAM ~4.7GB)
        모델 교체: .env STORY_MODEL= / SUGGEST_MODEL= 변경 후 재시작

BullMQ 워커 (src/queues/worker.ts, npm run worker)
    ├── log_save (concurrency 3)     → session_logs INSERT
    ├── profile_update (concurrency 2) → Redis profile 갱신
    ├── audio_sync [stub Phase 2]
    └── text_gen  [stub Phase 2]

PostgreSQL 테이블 (자동 마이그레이션, 서버 시작 시)
    ├── users / reader_profiles / story_states
    ├── episodes / characters / session_logs
```

---

## 2. LLM 연동 (src/lib/ollama.ts)

```bash
# .env 핵심 설정 (RTX 3080 x2 기준)
OLLAMA_BASE_URL=http://localhost:11434/v1
STORY_MODEL=gemma3:27b     # 스토리 생성 전용 — 품질 우선
SUGGEST_MODEL=llama3.1:8b  # 추천/구체화 전용 — 속도 우선
```

**스토리 생성 파라미터** (src/services/story.ts):
- `temperature: 0.85`, `max_tokens: 2048`
- `frequency_penalty: 0.6`, `presence_penalty: 0.3`

**AI 추천 파라미터** (src/api/suggest.ts, Ollama `/api/chat`):
- `temperature: 1.05`, `repeat_penalty: 1.15`
- `num_predict`: 캐릭터 200 / 규칙 500

---

## 3. 프롬프트 구성 순서 (src/services/story.ts)

```
1. 언어 지시: 반드시 한국어로만 (영어/터키어 등 절대 금지 명시)
2. 인물 설명: character_defaults
3. 세계관 규칙: world_rules
4. 금지 설정: forbidden_settings
5. 이전 줄거리: rolling_summary (최근 3화 DB 조회)
6. Director Overrides: directorOverrides[]
7. 문체 가이드: ReaderProfile 기반 style 문자열
8. 성별 대명사 규칙
9. 출력 규칙: "# N화 - 제목" 형식, 문장 반복 금지
```

---

## 4. SSE 스트리밍 패턴

```ts
// 서버: res.flushHeaders() → 15s heartbeat → 토큰마다 flush()
res.write(`data: ${JSON.stringify({ token })}\n\n`);
(res as any).flush?.();
res.write("data: [DONE]\n\n"); res.end();

// 클라이언트: EventSource → onmessage → [DONE] 시 es.close()
// 생성 중 _generating = true 플래그 → 소리내어 읽기 버튼 독립 동작 보장
```

---

## 5. 비동기 큐 흐름

```
POST /api/logs
  → enqueueLog() [src/services/logger.ts]
      ├── logSaveQueue.add("save-log")   → writeLog() → PostgreSQL
      └── profileUpdateQueue.add("update-profile") → updateProfileFromLog() → Redis
```

---

## 6. 독자 프로필 (src/services/profile.ts)

```ts
Redis 키: profile:{book_id}  TTL: 30일
DEFAULT = { focus:55, sentiment:55, urgency:50, complexity:55, dialogue:55, audio_sync:40 }

// 로그 → 델타 → 누적 (0~100 클램프)
computeDelta(log) → applyDelta(profile, delta) → Redis SET
GET /api/debug/profile?book_id=xxx  // 현재 프로필 확인
DELETE /api/debug/profile?book_id=xxx  // 초기화
```

---

## 7. 로거 사용법 (src/lib/logger.ts)

```ts
logInfo("api:generate", "생성 완료", { book_id, episode, elapsed_ms });
logError("api:suggest", err, { section });
// logs/app.log (INFO+) / logs/error.log (ERROR) / 5MB 로테이션
```

---

## 8. 모델 교체 방법

```bash
ollama pull qwen2.5:14b   # 현재 권장 — 한국어 최강, 9GB
ollama pull gemma3:9b      # 차선 — 6GB, 더 빠름
ollama pull gemma3:4b      # 경량 — 2.5GB, 최고속

# .env: STORY_MODEL=모델명 / SUGGEST_MODEL=모델명
# 이후 npm run start:all
```
