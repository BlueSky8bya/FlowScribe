# Performance Critical Path Audit — Phase 4.20

> 본 문서는 generation request의 latency 분해와 critical path 재정의 제안서다.
> 사용자가 클릭부터 본문이 보이기까지의 시간을 단계별로 쪼개고,
> 어느 step을 critical에서 background로 옮길 수 있는지 정리한다.

---

## 1. 현재 timing model (forensic 기반 추정)

### 1.1 Planner path (use_planner=true)

```
[click_to_request_start]         ~ 50-100 ms (network + SSE 연결)
  │
[request_start]
  │  ├─ DELETE 동일 회차 dynamic_states/foreshadows  ~ 50-100 ms
  │  ├─ buildEffectiveContext                       ~ 200-500 ms (DB 6-10 read)
  │  ├─ saveEpisodeSnapshot (fire-and-forget)       0
  │  ├─ detectGenerationMode + buildRegenContract   ~ 50-200 ms (DB 1-2)
  │  └─ recent_hook_types fetch                     ~ 30 ms
  │
[effective_context_done]                            누계 ~ 0.5-1 s
  │
[pipeline_start]
  │  ├─ creativePlanner LLM                         ~ 5-10 s   (★ blocking)
  │  ├─ planValidator                               ~ 5-30 ms
  │  ├─ rendererLLM                                 ~ 5-10 s   (★ blocking, 본문 텍스트)
  │  ├─ sanitizer                                   ~ 5-10 ms
  │  ├─ continuityCheck (ep>=2)                     ~ 5-30 ms
  │  ├─ episodeDeltaCheck                           ~ 5-30 ms
  │  ├─ judgeAndRepair (조건부)                     0 또는 5-15 s (★ blocking when fired)
  │  ├─ commitDynamicStates                         ~ 100-300 ms (DB 5-15 write)
  │  └─ proseValidation/revision                    현재 off
  │
[pipeline_done]                                     누계 ~ 11-25 s (judge 미발동)
                                                          16-40 s (judge 발동)
  │
[first_token_sent]                                  ~ 10 ms (res.write)
  │  ├─ saveEpisode (DB write)                      ~ 50-200 ms
  │  ├─ getLatestDynamicStates                      ~ 50-100 ms
  │
[char_states_fetched]
  │  ├─ episode_meta 빌드                           ~ 5 ms
  │
[done_sent]                                         첫 token부터 ~ 100-400 ms 후
                                                   client에 token + done 거의 동시 도착
```

### 1.2 Critical Insight

**`first_token_sent`가 사용자에게 본문이 보이는 시점**이지만, 그 시점은 **`pipeline_done`과 같다**. 즉:
- `click_to_first_token ≈ 11-25 s` (judge 미발동, baseline_local)
- `click_to_first_token ≈ 16-40 s` (judge 발동)
- 같은 모델로 high_quality_ensemble 사용 시 비슷한 시간 (DeepSeek renderer는 5-10s, OpenAI planner는 3-8s)

이게 사용자가 "확연히 느려졌다"고 느낀 원인의 본질.

---

## 2. step별 critical / 분리 가능성

| Step | 본문 가시성에 필수? | 분리 가능 | 노트 |
|---|---|---|---|
| DELETE prev dynamic_states | NO | YES (재생성 격리만) | TX로 묶을 수 있음 |
| buildEffectiveContext | YES | NO | renderer가 plan 필요, plan이 ctx 필요 |
| saveEpisodeSnapshot | NO | already fire-and-forget | OK |
| detectGenerationMode + buildRegenContract | YES (재생성) | 부분 | 신규 화는 skip |
| creativePlanner LLM | YES | NO | renderer가 scene plan 필요 |
| planValidator | YES | NO | plan correctness 필요 |
| **rendererLLM** | YES | **token streaming 가능** | 현재 batch — **R5 핵심** |
| sanitizer | YES (token 단위 가능) | inline 가능 | 누적 buffer 처리 |
| continuityCheck | NO | YES → background | hint만 audit log에 |
| episodeDeltaCheck | NO | YES → background | hint만 audit log에 |
| **judgeAndRepair** | 본문 변경하므로 주의 | **YES → 다음 회차 컨텍스트** | 사용자가 본 본문은 변경 안 함 |
| commitDynamicState | NO | YES → background | char_states fetch 시 polling |
| getLatestDynamicStates | NO | YES → 별도 endpoint | 이미 _loadAndApplyCharStates 있음 |

---

## 3. Top 10 token hogs (planner 22+ section, renderer 20+ section 기반)

### 3.1 Planner user prompt

| 순위 | section | 평균 토큰 | 조건 | 개선 여지 |
|---|---|---|---|---|
| 1 | [연속성계약] (known_facts + forbidden_regressions + character_position_state + emotional_progression) | 800-1500 | ep>=2 | character_position_state는 별도 ctx로 빼도 OK |
| 2 | [재생성분기계약] (signature + recurring_patterns + must_vary_axes + must_preserve) | 600-1200 | regen | must_preserve는 absolute_rules와 중복 |
| 3 | [인물현재상태] (char_summary 인물별 multi-line) | 400-800 | 항상 | 인물 5명 × 5줄 |
| 4 | [★세계관장소제약] | 300-500 | worldLabel | 5개 조항 안내문 — 한 번 학습 후 짧게 가능 |
| 5 | [스토리흐름] (rolling_summary + arc_summaries) | 200-600 | 가변 | 길이 cap 필요 |
| 6 | [직전화말미] (prev_episode_tail 500자) | 250 | ep>=2 | OK |
| 7 | [절대규칙] (Phase 4.19 안내문 추가) | 150-300 | absolute 있을 때 | 안내문 단축 가능 |
| 8 | [반복방지] (must_not_repeat) | 100-300 | 가변 | dedupe |
| 9 | [복선] (foreshadow_memory) | 100-200 | 가변 | top-K cap |
| 10 | [첫화도입부원칙] | 200 | ep=1 | OK |

### 3.2 Renderer system prompt

| 순위 | section | 평균 토큰 | 비고 |
|---|---|---|---|
| 1 | [등장인물] (charList items 포함) | 400-800 | 인물 × 소지품 |
| 2 | [Episode Delta Contract — 서술 준수] | 400-800 | ep>=2 |
| 3 | [장면계획] (beats) | 300-500 | 항상 |
| 4 | [연속성-퇴행금지] | 200-400 | ep>=2 |
| 5 | [절대규칙] (Phase 4.19) | 150-300 | absolute 있을 때 |
| 6 | [언어절대규칙] | 100-150 | 항상 |
| 7 | [★인물이름절대규칙] | 100 | 항상 |
| 8 | [POV-시점] | 100-200 | 항상 |
| 9 | [부상제약] | 50-200 | 가변 |
| 10 | [소지품유지] | 50-150 | 가변 |

**누적:** renderer ~ 6-10K, planner ~ 8-15K. **모델 컨텍스트 윈도우 (qwen2.5:14b = 32K) 의 30-50%가 instruction.** 창작 여유 압박.

---

## 4. Top 10 latency hogs

| 순위 | step | 평균 ms | 비고 |
|---|---|---|---|
| 1 | rendererLLM | 5000-10000 | **본문 생성 본체** |
| 2 | creativePlanner LLM | 5000-10000 | scene plan |
| 3 | judgeAndRepair LLM (발동 시) | 5000-15000 | 본문 변경 위험 |
| 4 | DB DELETE prev dynamic_states | 50-100 | 트랜잭션 가능 |
| 5 | buildEffectiveContext (DB 6-10 read) | 200-500 | 캐시 |
| 6 | commitDynamicState (DB 5-15 write) | 100-300 | bulk insert |
| 7 | saveEpisode + foreshadow processing (background) | 영향 없음 | OK |
| 8 | getLatestDynamicStates | 50-100 | 캐시 |
| 9 | detectGenerationMode + regen contract build | 50-200 | 재생성만 |
| 10 | network + SSE handshake | 50-100 | OK |

---

## 5. Top 10 overconstraint sources

| 순위 | 위치 | 패턴 | 영향 |
|---|---|---|---|
| 1 | [반복 패턴 금지] (planner system prompt) — 3단 공식, 각성 금지, 물리적 위협 금지 | "~ 금지" | 강 |
| 2 | [절대 규칙] 안내문 (Phase 4.19) — 부정형/긍정형/전제 분기 | "~ 하지 말고", "~ 반드시" | 중강 |
| 3 | [연속성 — 퇴행 금지] (renderer) — 직전 화 인물 만남·약속·고백 | "~ 다시 ~ 말 것" | 강 |
| 4 | [Episode Delta Contract — 반복 금지] | "~ 반복 금지" 다수 | 강 |
| 5 | [재생성 분기 계약] must_vary axes | "~ 다르게 하라" | 중강 |
| 6 | [언어 절대 규칙] — 위반 시 출력 전체 무효 | "절대 ~ 금지" | 중 |
| 7 | [★인물 이름 절대 규칙] — 위반 시 출력 전체 무효 | "절대 변형 금지" | 중 |
| 8 | [세계관 장소 제약] | "~ 절대 사용 불가" | 중 |
| 9 | [감정 진전 필수] | "~ 그대로 유지만 하지 말 것" | 중 |
| 10 | [반복 위험 패턴] | "~ 핵심 사건으로 반복 금지" | 중 |

**정량:** Phase 4.18에서 audit_regen_overconstraint이 측정한 결과 — negative >> positive ratio 발생 가능성 높음. 모델이 "안전한 본문"을 만드는 회귀.

---

## 6. 권장 critical path (R5 hybrid mode)

### 6.1 단계 분리

```
[필수 blocking — 본문 token이 보일 때까지]
  buildEffectiveContext
  creativePlanner LLM
  planValidator
  rendererLLM (stream=true → token chunk마다 SSE push)
  sanitizer (token 단위 buffer, foreign char 즉시 정리)

[본문 token 발행 후 background]
  continuityCheck → audit log only
  episodeDeltaCheck → audit log only
  judgeAndRepair → fatal issue만, 본문 변경 안 함, 다음 회차 컨텍스트로 반영
  commitDynamicState → DB write
  saveEpisode → DB write
  foreshadow / arc summary 후처리 (이미 background)

[char_states polling]
  frontend: token stream 끝 → ep-end placeholder
  background commit 완료 후 frontend가 별도 endpoint poll
  도착 → renderEpisodeEndCharCards가 placeholder 교체
```

### 6.2 예상 latency

| 단계 | 현재 | R5 후 | 개선 |
|---|---|---|---|
| click_to_first_token (judge 미발동) | 11-25 s | **5-12 s** (renderer 시작 직후) | 50%↓ |
| click_to_first_token (judge 발동) | 16-40 s | **5-12 s** (judge 비동기) | 60-70%↓ |
| click_to_done | 동일 | char_states 폴링이 1-3s 추가 | 미미 |
| click_to_full_state_card | 16-25 s | 8-15 s | 30-40%↓ |

---

## 7. R5 hybrid 구현 위험

### 7.1 본문 품질
- judge/repair가 본문을 변경하던 case → 사용자가 본 본문은 그대로 두고 audit log만 남김. 다음 회차 ctx에 issue 반영.
- **trade-off:** 한 번 발생한 incoherence는 그 회차에 노출됨. 평균적으로 회차 변경보다 streaming의 사용자 가치가 큼.

### 7.2 sanitizer
- token chunk 도착 시 foreign char/special token 즉시 제거 가능. 누적 buffer로 처리.
- 한 chunk 내에 잘린 unicode 처리 필요. utf8 boundary 보호.

### 7.3 state extraction 분리
- planner의 character_state_updates는 plan 안에 이미 있음 → renderer 시작 직전에 분리 가능.
- commit은 background로 빼도 audit/사이드바는 ep-end cards 시점에 fetch하면 OK.
- **위험:** 사용자가 next-episode를 빠르게 누르면 prev state commit이 미완 → ep N+1 generation의 ctx 일부 미반영.
  완화: ep N+1 generation start 시점에 prev commit 완료를 await (짧은 wait).

### 7.4 frontend SSE
- 새 event type: `text_chunk`, `text_done`, `state_ready`
- `data: {token: chunk}` 반복 → 마지막에 `{text_done: true}` → 별도 endpoint로 char_states polling

---

## 8. 즉시 가능한 작은 개선 (Phase 4.20 종료 후 R2)

R5 hybrid 전이라도 다음 4가지는 **단발 hotfix로 가능**:

1. **prompt section 가지치기**
   - planner [반복 패턴 금지] 시스템 프롬프트 섹션 단축 (200~400 토큰 절감)
   - [Episode Delta Contract] 본문 길이 cap 추가
   - [세계관 장소 제약] 5조 안내문을 한두 줄로 압축

2. **judge 발동 임계 상향**
   - 현재 hint 1개만 있어도 발동 → "fatal hint 2개 이상" 또는 "특정 카테고리만"으로 제한
   - 이미 `COHERENCE_JUDGE` 환경변수로 force/disable 가능

3. **negative → positive rebalance**
   - "~ 반복 금지"를 "이번 화는 N+1 사건으로 시작한다"로 재서술
   - "~ 하지 말 것" → "~ 하라" + 1줄 reasoning

4. **legacy path 제거 또는 차단**
   - use_planner=false인 요청에 410 응답
   - 또는 use_planner default=true

---

## 9. 측정 도구 (이미 박힘 — Phase 4.19C)

- `/api/context:save:latency` 채널: context_save_start / context_db_save_done / context_response_sent / item_desc_bg_start / item_desc_bg_done
- `/api/generate:latency` 채널: request_start / effective_context_done / pipeline_start / pipeline_done (planner_ms, renderer_ms, total_pipeline_ms) / first_token_sent / char_states_fetched / done_sent

**다음 단계:** 사용자가 ep1을 한 번 생성한 후 logger 출력에서 실제 timing 확인. 그 결과로 R5 우선순위 결정.

---

## 10. 결론

- 현재 first_token_latency는 사실상 pipeline 전체 시간이며, 이를 streaming으로 분리하지 않으면 본문 도달 시간이 줄지 않는다.
- prompt 과부하는 모델 품질 저하의 주요 의심 — Top 10 token hogs 가지치기 + negative rebalance가 측정 가능한 개선 path.
- judge & repair는 critical path에서 빼야 안전. 본문 변경 위험 트레이드오프는 "사용자가 본 본문은 그대로" 정책으로 해결.
- R5 (hybrid streaming)은 1.5~2일 작업으로 절반 이상 latency 감소 기대.

다음 단계는 `refactor-roadmap-v2.md`의 R2 (작은 가지치기) → R5 (streaming) 순서.
