# story_data/ — 서사 메모리 및 생성 설정 가이드

## 이 문서의 목적

에이전트는 이 문서를 다음 경우에만 읽는다.
- 세계관 설정을 확인해야 할 때
- 플롯, 요약, 복선, 기억 구조를 확인해야 할 때
- 서사 충돌을 해결해야 할 때
- 작품 생성 초기 설정이 필요할 때

이 문서를 읽고 나면 즉시 실행으로 돌아간다.

---

## 1. 서사 메모리 4구조 개요

| 구조 | 역할 | 변경 가능성 |
|---|---|---|
| `World Bible` | 핵심 설정 고정 저장 | 거의 변경 불가 |
| `Rolling Summary` | 최근 3~10화 단기 요약 | 매 화 갱신 |
| `Foreshadow Memory` | 장기 복선·플롯 분기 | 회차 누적 갱신 |
| `Director Overrides` | 사용자 직접 지시 이력 | 지시 발생 시 추가 |

서사 생성 전 반드시 이 4구조와 대조하여 **설정 충돌을 방지**한다.

---

## 2. World Bible 스키마

변하지 않는 핵심 설정을 저장한다.
Director Mode도 이 구조의 `world_rules`는 원칙적으로 파괴하지 않는다.

```json
{
  "book_id": "string",
  "world_rules": [
    "세계관 핵심 규칙 텍스트 (예: 마법은 대가를 요구한다)"
  ],
  "character_defaults": {
    "character_id": {
      "name": "string",
      "appearance": "string",
      "personality": "string",
      "role": "protagonist | antagonist | supporting | ...",
      "fixed_traits": ["변경 불가 속성 목록"]
    }
  },
  "fixed_relationships": [
    {
      "from": "character_id",
      "to": "character_id",
      "type": "rival | mentor | lover | enemy | ...",
      "fixed": true
    }
  ],
  "genre_tone": "string",
  "forbidden_settings": [
    "이 작품에서 절대 사용하지 않을 설정 목록"
  ]
}
```

**운영 원칙:**
- `world_rules`는 Director Mode 지시보다 우선한다.
- `forbidden_settings`는 생성 프롬프트에 항상 금지 조건으로 삽입한다.
- `fixed_traits`는 캐릭터 속성 변경 지시에도 유지한다.

---

## 3. Rolling Summary 스키마

최근 3~10화 분량의 단기 요약이다. 매 화 종료 후 갱신한다.
오래된 항목은 `Foreshadow Memory`로 이관 후 제거한다.

```json
{
  "book_id": "string",
  "episode_range": [1, 5],
  "last_events": [
    "직전 사건 요약 텍스트"
  ],
  "emotional_arc": "현재 감정선 흐름 요약",
  "ongoing_conflicts": [
    "진행 중인 갈등 설명"
  ],
  "recent_style": {
    "tone": "현재 서사 톤",
    "sentence_avg_length": 0,
    "dialogue_ratio": 0.0,
    "pacing": "slow | medium | fast"
  },
  "last_updated": "ISO8601"
}
```

---

## 4. Foreshadow Memory 스키마

장기 복선, 숨겨진 정보, 사용자 반응 기반 선호 장면 유형, 장기 플롯 분기를 저장한다.

```json
{
  "book_id": "string",
  "planted_flags": [
    {
      "flag_id": "string",
      "description": "심어진 복선 설명",
      "planted_episode": 0,
      "expected_payoff_episode": 0,
      "resolved": false
    }
  ],
  "hidden_character_info": [
    {
      "character_id": "string",
      "secret": "숨겨진 정보 설명",
      "reveal_condition": "공개 조건"
    }
  ],
  "user_liked_scene_types": [
    "사용자가 높은 몰입을 보인 장면 유형 태그"
  ],
  "long_term_plot_branches": [
    {
      "branch_id": "string",
      "description": "분기 설명",
      "trigger_condition": "발동 조건",
      "active": false
    }
  ],
  "last_updated": "ISO8601"
}
```

**복선 재맥락화 원칙:**
Director Mode로 인해 기존 복선과 충돌이 발생할 경우, `resolved: false`인 flag를 삭제하지 않고 `description`을 재해석하는 방향으로 수정한다.

---

## 5. Director Overrides 로그 스키마

사용자의 모든 Director Mode 지시를 이력으로 저장한다.

```json
{
  "book_id": "string",
  "overrides": [
    {
      "timestamp": "ISO8601",
      "instruction": "원문 지시 텍스트",
      "type": "character | tone | structure | style",
      "applied_from_episode": 0,
      "gradual": true,
      "world_conflict": false,
      "recontextualized_foreshadow": false,
      "notes": "적용 시 특이사항"
    }
  ]
}
```

---

## 6. 작품 생성 초기 설정 (Story Generation Setup)

새 작품 시작 시 다음 항목을 설정한다.

### 6.1 기본 설정

| 항목 | 설명 |
|---|---|
| 장르 | thriller / romance / fantasy / slice_of_life / 기타 |
| 등장인물 | 이름, 외형, 성격, 역할 (1인 이상) |
| 서술 시점 | 1인칭 / 3인칭 제한 / 3인칭 전지 |
| 문체 | 담백 / 감성적 / 문학적 |
| 회차 길이 | 기준 글자 수 N |
| 전체 화 수 범위 | 최소~최대 화 수 |

### 6.2 가변 분량 시스템 (N ± X)

사용자가 설정한 `N ± X` 범위 안에서 에이전트가 서사 밀도와 반응 로그를 고려해 최적 결말 지점을 내부적으로 결정한다.

- 결말은 기계적으로 고정되지 않는다.
- **기승전결 밀도와 사용자 반응을 함께 고려해 유동적으로 조정**한다.
- 범위를 벗어나는 연장이나 조기 종결은 사용자에게 사유를 고지한다.

### 6.3 사용자 제어 슬라이더 스키마

```json
{
  "conflict_intensity": 5,
  "foreshadow_frequency": 5,
  "emotion_description_weight": 5,
  "dialogue_weight": 5,
  "direction_intensity": 5
}
```

모든 슬라이더는 `1~10` 범위. 초기값은 5(중립).
이 값은 생성 프롬프트에 직접 반영된다.
