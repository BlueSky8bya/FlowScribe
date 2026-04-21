# profiles/ — 독자 프로필 및 개인화 상태 관리 가이드

## 이 문서의 목적

에이전트는 이 문서를 다음 경우에만 읽는다.
- 사용자 상태 구조를 확인해야 할 때
- 상태 벡터를 갱신해야 할 때
- 개인화 규칙을 적용해야 할 때
- calibration, feedback loop 처리가 필요할 때

이 문서를 읽고 나면 즉시 실행으로 돌아간다. 추가 문서를 넓게 탐색하지 않는다.

---

## 1. 개인화 계층 구조 개요

FlowScribe의 개인화는 모델 파인튜닝이 아니라 **외부 상태 객체** 갱신으로 구현한다.
4개의 상태 레이어가 독립적으로 관리되며, 서로 다른 갱신 주기와 역할을 갖는다.

| 레이어 | 갱신 주기 | 역할 |
|---|---|---|
| `ReaderProfile_static` | 수십 화 누적 후 | 장기 독서 성향 |
| `ReaderProfile_dynamic` | 3~5화 단위 | 단기 반응 추적 |
| `GenreProfile` | 장르별 독립 | 장르 특이 편향 |
| `SessionPacing` | 현재 세션/화 | 즉시성 파라미터 |

---

## 2. ReaderProfile_static 스키마

비교적 천천히 변하는 **장기 독서 성향 벡터**이다.
반복적으로 확인된 패턴만 이 레이어에 반영한다.

```json
{
  "user_id": "string",
  "dialogue_preference": 0.0,
  "sentence_complexity_tolerance": 0.0,
  "emotion_description_preference": 0.0,
  "urgency_preference": 0.0,
  "description_tolerance": 0.0,
  "audio_tolerance": 0.0,
  "last_updated": "ISO8601"
}
```

**필드 설명:**
- `dialogue_preference`: 대화체 선호도. 0(서술 중심) ~ 1(대사 중심)
- `sentence_complexity_tolerance`: 복잡한 문장 수용도. 0(단문 선호) ~ 1(복문 허용)
- `emotion_description_preference`: 감정 묘사 선호도. 0(절제) ~ 1(풍부한 감정선)
- `urgency_preference`: 긴박감 선호도. 0(잔잔함) ~ 1(고긴장 서사)
- `description_tolerance`: 설명문(세계관·배경) 허용도. 0(최소) ~ 1(풍부한 설명 허용)
- `audio_tolerance`: 오디오 연출 허용도. 0(텍스트 전용) ~ 1(TTS/BGM 선호)

**갱신 조건:** `ReaderProfile_dynamic`에서 동일한 방향의 신호가 3회 이상 누적될 때 static에 반영한다.

---

## 3. ReaderProfile_dynamic 스키마

최근 3~5화의 반응을 반영하는 **단기 상태 벡터**이다.
행동 로그를 기반으로 회차 종료 후 즉시 갱신한다.

```json
{
  "user_id": "string",
  "recent_engagement_trend": 0.0,
  "preferred_speed": 1.0,
  "dropout_pattern_summary": "",
  "fatigue_estimate": 0.0,
  "recent_dialogue_response": 0.0,
  "recent_narration_response": 0.0,
  "last_updated": "ISO8601"
}
```

**필드 설명:**
- `recent_engagement_trend`: 최근 화 몰입도 추이. -1(하락) ~ +1(상승)
- `preferred_speed`: 현재 선호 독서 속도. 상대값 (기준=1.0)
- `dropout_pattern_summary`: 최근 이탈 구간 특성 요약 텍스트
- `fatigue_estimate`: 피로도 추정. 0(정상) ~ 1(피로 높음)
- `recent_dialogue_response`: 최근 대사 구간 반응. 체류 시간 기반 정규화 값
- `recent_narration_response`: 최근 서술 구간 반응. 체류 시간 기반 정규화 값

---

## 4. GenreProfile 스키마

장르별 편향 벡터를 **독립적으로** 저장한다.
한 사용자가 스릴러와 로맨스를 동시에 읽는 경우 각각 별도 벡터가 유지된다.

```json
{
  "user_id": "string",
  "genre": "thriller | romance | fantasy | slice_of_life | ...",
  "bias_vector": {
    "sentence_length": 0.0,
    "pacing": 0.0,
    "tension": 0.0,
    "dialogue_ratio": 0.0,
    "emotional_depth": 0.0
  },
  "episode_count_in_genre": 0,
  "last_updated": "ISO8601"
}
```

**장르별 기본 기대값 참고:**

| 장르 | sentence_length | pacing | tension | dialogue_ratio |
|---|---|---|---|---|
| thriller | 낮음(짧음) | 높음(빠름) | 높음 | 중간 |
| romance | 중간 | 중간 | 낮음 | 높음 |
| fantasy | 높음(긺) | 낮음(느림) | 중간 | 중간 |
| slice_of_life | 중간 | 낮음(느림) | 낮음 | 높음 |

---

## 5. SessionPacing 스키마

현재 화 또는 현재 세션에만 적용되는 **즉시성 파라미터**이다.
세션 시작 시 dynamic 벡터와 현재 장르 bias를 결합해 초기화한다.

```json
{
  "session_id": "string",
  "user_id": "string",
  "output_speed": 1.0,
  "pause_between_sentences_ms": 300,
  "dialogue_tempo": 1.0,
  "visual_effect_intensity": 0.5,
  "tts_speed": 1.0,
  "scene_transition_delay_ms": 500,
  "last_updated": "ISO8601"
}
```

**필드 설명:**
- `output_speed`: 텍스트 출력 속도. 기준값 1.0
- `pause_between_sentences_ms`: 문장 사이 대기 시간 (밀리초)
- `dialogue_tempo`: 대사 출력 템포 (기준=1.0)
- `visual_effect_intensity`: 시각 효과 강도 (0.0 ~ 1.0)
- `tts_speed`: TTS 재생 속도 (기준=1.0)
- `scene_transition_delay_ms`: 장면 전환 지연값 (밀리초)

---

## 6. 가중치 업데이트 수식

회차 종료 후 행동 로그를 기반으로 아래 수식으로 가중치를 갱신한다.

```
w_next = (1 - alpha_t) * w_t + alpha_t * w_hat_t
```

| 변수 | 의미 |
|---|---|
| `w_t` | 현재 사용자 가중치 |
| `w_hat_t` | 이번 화에서 관측된 선호 추정치 |
| `alpha_t` | 학습률 (회차에 따라 동적 조정) |

**학습률 운영 원칙:**
- 초반 (1~5화): `alpha_t` 높음 → 빠른 적응
- 중반 (6~20화): `alpha_t` 중간 → 점진적 수렴
- 장기 (21화+): `alpha_t` 낮음 → 안정성 우선

**레이어별 갱신 경로:**
1. 행동 로그 수집
2. `ReaderProfile_dynamic` 우선 반영 (매 화)
3. dynamic에서 반복 확인된 패턴만 `ReaderProfile_static`에 천천히 반영
4. 장르 특이 반응은 `GenreProfile`에 별도 저장

---

## 7. 행동 신호 입력 목록 (Behavior Signal Inputs)

FlowScribe는 설문보다 **행동 로그를 더 강한 신호**로 처리한다.

| 신호 | 해석 방향 |
|---|---|
| 문단별 체류 시간 | 길수록 몰입 또는 난해함 (맥락 판단 필요) |
| 자동 출력 중 이탈 지점 | 해당 문단 스타일/내용 기피 가능성 |
| 되감기 구간 | 선호 또는 이해 어려움 (빈도로 구분) |
| 수동 속도 조절 횟수 | 출력 속도와 선호 속도의 불일치 |
| 특정 문단 반복 청취 | 해당 장면 강한 선호 신호 |
| TTS On/Off 빈도 | 오디오 연출 선호도 |
| BGM 음소거 빈도 | 음향 연출 허용도 |
| 화 완독률 | 전체 몰입도 기준 지표 |
| 다음 화 진입 대기 시간 | 짧을수록 높은 몰입 상태 |
| 특정 인물 장면 체류 변화 | 캐릭터 선호도 |
| 특정 감정 장면 반응 | 감정선 선호도 |
| Scene skip / pause 빈도 | 해당 장면 스타일 기피 신호 |

---

## 8. Reading Hexagon — 독서 성향 6요소

사용자 독서 성향은 아래 6요소 벡터로 관리하며, 각 점수는 `0~100` 범위에서 회차 로그를 기반으로 갱신된다.

| 요소 | 설명 |
|---|---|
| `Focus` | 몰입도. 체류 시간·완독률 기반 |
| `Sentiment` | 감성 반응. 감정 장면 체류·반응 선택 기반 |
| `Urgency` | 긴박감 선호. 스릴러 구간 반응, 이탈 여부 기반 |
| `Complexity` | 복잡성 수용도. 긴 문장·세계관 설명 구간 체류 기반 |
| `Dialogue` | 대화 선호. 대사 구간 대 서술 구간 체류 시간 비율 기반 |
| `Audio-Sync` | 음향 동기화 선호. TTS·BGM 사용 지속성 기반 |

이 값들은 고정 성격 지표가 아니라 **회차가 쌓일수록 보정되는 가변 상태 벡터**이다.

**Hexagon 스키마:**
```json
{
  "user_id": "string",
  "focus": 50,
  "sentiment": 50,
  "urgency": 50,
  "complexity": 50,
  "dialogue": 50,
  "audio_sync": 50,
  "last_updated": "ISO8601"
}
```

초기값은 모두 50(중립)으로 설정하며, 실제 회차 로그가 쌓이면서 보정된다.

---

## 9. 초기 보정 절차 (Initial Calibration)

회원가입 직후 또는 첫 작품 시작 전 다음 절차를 수행한다.

### 9.1 사용자 입력 수집
다음 항목을 UI에서 수집한다.
- 선호 장르 (복수 선택 가능)
- 선호 분위기 (잔잔 / 중간 / 강렬)
- 갈등 강도 슬라이더 (1~10)
- 복선 빈도 슬라이더 (1~10)
- 기본 문체 선택 (담백 / 감성적 / 문학적)
- TTS 사용 여부
- BGM 사용 여부

이 입력은 `ReaderProfile_static` 및 `GenreProfile`의 초기값으로 설정된다.

### 9.2 속도 보정 테스트
사용자에게 3~5줄 분량의 짧은 샘플 텍스트를 제공하고 다음을 추정한다.

| 추정 항목 | 측정 방법 |
|---|---|
| 기본 읽기 속도 V0 | 샘플 체류 시간 / 글자 수 |
| 줄바꿈 반응 | 줄바꿈 전후 체류 시간 차이 |
| 대사 vs 서술 선호 | 대사 구간과 서술 구간 체류 시간 비교 |
| 문장 길이 처리 속도 | 단문/복문 체류 시간 비교 |

추정값은 `SessionPacing` 초기값으로 반영한다.

### 9.3 중요 원칙
초기 보정은 **출발점**일 뿐이다. 실제 개인화는 이후 회차 누적 로그를 기반으로 점차 정교화된다.
에이전트는 초기 보정값을 과신하지 않는다.
