# assets/ — 음성 자산 및 BGM 라이브러리 정책 가이드

## 이 문서의 목적

에이전트는 이 문서를 다음 경우에만 읽는다.
- 음성 자산 정책이 필요할 때
- BGM 또는 정적 리소스 규칙이 필요할 때
- 접근 권한 또는 사용 범위를 확인해야 할 때
- Voice Archive 관련 처리가 필요할 때

이 문서를 읽고 나면 즉시 실행으로 돌아간다.

---

## 1. assets/ 디렉터리 구조

```
assets/
├── bgm/           — BGM 라이브러리 파일 및 메타데이터
├── voice_archive/ — 등록된 음성 자산 (암호화 저장)
└── voice_meta/    — 음성 학습 메타데이터 및 동의 이력
```

---

## 2. BGM 라이브러리 구조

### 2.1 파일 메타데이터 스키마
각 BGM 파일은 장면 태그와 함께 메타데이터 JSON으로 관리된다.

```json
{
  "bgm_id": "string",
  "file_path": "assets/bgm/filename.mp3",
  "scene_tags": ["melancholy", "solitude"],
  "tag_vector": [0.0, 0.0],
  "duration_sec": 0,
  "loop_point_sec": 0,
  "license": "CC0 | CC-BY | ...",
  "source": "라이브러리 출처",
  "used_in_episodes": []
}
```

### 2.2 장면 태그 분류 체계

| 태그 | 대표 감정/상황 |
|---|---|
| `melancholy` | 슬픔, 상실, 회상 |
| `suspense` | 긴장, 위협, 추적 |
| `soft_romance` | 설렘, 따뜻함 |
| `slice_of_life` | 일상, 평온 |
| `solitude` | 고독, 내면 독백 |
| `confrontation` | 대결, 갈등 |
| `wonder` | 경이, 판타지 |
| `urgency` | 위기, 격렬한 행동 |
| `hope` | 회복, 결심 |

### 2.3 BGM 선택 제약
- `used_in_episodes` 목록을 확인하여 같은 회차에서 동일 BGM 반복 사용을 피한다.
- 상업 콘텐츠에는 라이선스가 `CC0` 또는 상업 허용인 BGM만 사용한다.
- 새 BGM 추가 시 라이선스를 반드시 기록한다.

---

## 3. Voice Archive 스키마

Voice Archive는 FlowScribe 내부 음성 튜닝 시스템을 통해 직접 생성되고, 명시적 동의를 거쳐 등록된 자산만 허용한다.

```json
{
  "voice_id": "string (UUID)",
  "owner_id": "string (user_id)",
  "display_name": "string",
  "consent_status": "confirmed | pending | revoked",
  "scope_level": "private | shared | public",
  "allowed_usage": {
    "ai_narration": true,
    "character_voice": true,
    "commercial_use": false,
    "adult_content": false,
    "redistribution": false,
    "genre_restriction": null
  },
  "active_status": true,
  "delete_requested": false,
  "created_at": "ISO8601",
  "deleted_at": null
}
```

**필드 설명:**
- `consent_status`: 동의 상태. `confirmed`만 사용 가능
- `scope_level`: 사용 범위 레벨 (아래 섹션 6 참고)
- `allowed_usage.ai_narration`: AI 낭독 허용 여부
- `allowed_usage.character_voice`: 캐릭터 음성 매핑 허용 여부
- `allowed_usage.commercial_use`: 상업적 사용 허용 여부
- `allowed_usage.adult_content`: 성인 콘텐츠 사용 허용 여부
- `allowed_usage.redistribution`: 보이스팩 재배포 허용 여부
- `allowed_usage.genre_restriction`: null(제한 없음) 또는 허용 장르 목록
- `active_status`: false면 사용 불가 (비활성화 상태)
- `delete_requested`: true 전환 즉시 사용 중단

---

## 4. Voice Training Metadata 스키마

음성 학습 및 생성 이력을 저장한다. 감사 추적 목적으로 삭제하지 않는다.

```json
{
  "voice_id": "string",
  "training_session_id": "string (UUID)",
  "source_owner_id": "string (user_id)",
  "consent_version": "string",
  "model_version": "string",
  "tuning_config": {
    "sample_count": 0,
    "training_duration_min": 0,
    "quality_score": 0.0
  },
  "audit_log_ref": "string (감사 로그 참조 ID)",
  "created_at": "ISO8601"
}
```

---

## 5. 동의 절차 요건 (Normative)

다음 절차는 반드시 준수해야 하는 **Normative** 규칙이다.

1. **등록 전 명시적 동의 화면 표시**
   - 사용 범위 (private / shared / public) 선택
   - 허용 usage 항목별 명시적 체크박스
   - 동의 버전 및 타임스탬프 기록

2. **등록 후 사용 범위 수정 기능 제공**
   - 언제든지 scope_level과 allowed_usage 변경 가능

3. **비활성화 기능**
   - `active_status: false` 처리 즉시 모든 새 요청에서 제외

4. **삭제 요청 즉시 반영**
   - `delete_requested: true` 전환 즉시 사용 중단
   - 물리적 삭제는 정책에 따른 유예 기간 후 처리

5. **공유된 음성 사용 이력 추적**
   - scope_level이 `shared` 또는 `public`인 음성은 사용 이력을 별도 로그로 관리

---

## 6. 사용 범위 레벨 (Permission Levels)

| 레벨 | 의미 | 제약 |
|---|---|---|
| `private` | 본인만 사용 가능 | 다른 사용자 접근 불가 |
| `shared` | 다른 사용자 열람·선택 가능 | 플랫폼 내부 용도로만 사용 |
| `public` | 공개 음성 라이브러리 제공 | allowed_usage 범위 내에서만 사용 |

---

## 7. 음성 사용 전 체크 순서

음성 사용 전 다음 순서로 반드시 확인한다.

1. `consent_status == "confirmed"` 확인
2. `active_status == true` 확인
3. `delete_requested == false` 확인
4. `scope_level`이 현재 컨텍스트에서 허용되는지 확인
5. `allowed_usage` 항목 중 현재 용도에 해당하는 항목이 `true`인지 확인
6. `genre_restriction`이 null이 아닌 경우 현재 장르가 허용 목록에 포함되는지 확인

위 조건 중 하나라도 실패하면 해당 음성을 사용하지 않고 fallback(`default_narrator`) 처리한다.
