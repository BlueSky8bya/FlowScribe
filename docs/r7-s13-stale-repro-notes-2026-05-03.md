# R7 S13.5 storyConfig Stale 회귀 의심 — Controlled Repro Notes

**날짜**: 2026-05-03
**Phase**: R7 Pre-canary (B+ 보류)
**브랜치**: `checkpoint/phase1-launch-prep`
**상태**: R7 actual 시작 보류. R7 canary 책 storyConfig 증거 보존 중. Read-only 분석 + 브라우저 재현 절차 설계.

---

## 1. R7 Canary 책 DB Snapshot (apply 직후)

`book_id = 1f1e72c8-6892-4821-a94a-1cb75229caae`
`title = R7_회색지대_생존기_CANARY`
`updated_at = 2026-05-02T17:40:22.904Z`

### 1-1. context.story_config (의심 영역)

```json
{
  "pov": "3인칭 관찰자",
  "mood": "설레고 긴장감 있는",
  "genre": "현대 로맨스",
  "style": "묘사풍부",
  "emotion": 7,
  "conflict": 7,
  "dialogue": 5,
  "direction": 7,
  "foreshadow": 5,
  "episodeLength": 2000,
  "totalEpisodes": 30,
  "episodeLengthVar": 500,
  "totalEpisodesVar": 5,
  "resolved_final_episode": 26
}
```

### 1-2. context.world_rules (R7 정상)

```
[0] 장르: 포스트아포칼립스, 스릴러, 드라마, 서바이벌
[1] 대규모 생태 붕괴와 통신망 붕괴 이후, 고립된 도시 외곽 생존 구역에서 네 명의 생존
[2] 자가 제한된 식량과 장비를 들고 안전 구역을 찾아 이동하는 이야기.
[3] 초능력이나 마법은 없고, 모든 정보는 직접 관찰·기록·무전·기억을 통해서만 얻을 수 있다.
```

### 1-3. context.forbidden_settings

```
[]   ← 0건. hard rule 미설정.
```

### 1-4. context.fixed_relationships

```
[]
```

### 1-5. canonical_characters (4명, 응급 처치 키트 apply 후)

| name | type | gender | initial_items (name / category) |
|---|---|---|---|
| 한서윤 | 주인공 | 여성 | 응급 처치 키트/**의료**, 압축 영양바 묶음/(없음), 휴대용 정수 필터/(없음) |
| 강도현 | 조력자 | 남성 | 다목적 공구/(없음), 소형 배터리 팩/(없음), 낡은 무전기/(없음) |
| 윤미라 | 라이벌 | 여성 | 접이식 단검/(없음), 방독 마스크/(없음), 손상된 구역 지도/(없음) |
| 이태오 | 조연 | 남성 | 가족 사진/(없음), 소형 태블릿/(없음), 통조림 두 개/(없음) |

> canonical.initial_items[].category가 "(없음)"인 것은 LLM 분류가 vocab 쪽에만 박힌 것 — char-states API의 vocab > canonical priority로 client 표시는 정상.

### 1-6. item_vocab (12건, apply 후)

| name | category | badge_label |
|---|---|---|
| 응급 처치 키트 | **의료** | 의료 |
| 압축 영양바 묶음 | 식량 | 식량 |
| 통조림 두 개 | 식량 | 식량 |
| 가족 사진 | 귀중품 | 귀중품 |
| 낡은 무전기 | 통신 | 통신 |
| 다목적 공구 | 도구 | 도구 |
| 방독 마스크 | 방어구 | 방어구 |
| 소형 배터리 팩 | 전자 | 전자 |
| 소형 태블릿 | 전자 | 전자 |
| 손상된 구역 지도 | 문서 | 문서 |
| 접이식 단검 | 무기 | 무기 |
| 휴대용 정수 필터 | 도구 | 도구 |

`audit_item_vocab --detail`: coverage 100%, "기타" 0/12, mismatch 0건. **첫 정착 완료 책 유지 + 응급 처치 키트 의료 정정 반영**.

---

## 2. 직전 책 비교

`바보바보바보` book_id = `95d5fe88-c1c5-472d-9b0b-8f9b476b2e3d`
`updated_at = 2026-05-02T16:59:29.741Z` (R7 canary 생성 약 34분 전)

### 2-1. storyConfig 일치 항목 (9/13)

| key | R7 canary | 바보바보바보 | 일치 |
|---|---|---|---|
| pov | 3인칭 관찰자 | 3인칭 관찰자 | ✅ |
| mood | 설레고 긴장감 있는 | 설레고 긴장감 있는 | ✅ |
| genre | 현대 로맨스 | 현대 로맨스 | ✅ |
| style | 묘사풍부 | 묘사풍부 | ✅ |
| emotion | 7 | 7 | ✅ |
| conflict | 7 | 7 | ✅ |
| dialogue | 5 | 5 | ✅ |
| direction | 7 | 7 | ✅ |
| foreshadow | 5 | 5 | ✅ |
| totalEpisodes | 30 | 30 | ✅ (default와도 동일) |
| totalEpisodesVar | 5 | 5 | ✅ (default와도 동일) |

### 2-2. storyConfig 불일치 항목 (3/13)

| key | R7 canary | 바보바보바보 | default(clearWorldSettingsUI) | 해석 |
|---|---|---|---|---|
| episodeLength | **2000** | 1100 | 2000 | R7에서 사장이 직접 변경 또는 default로 reset |
| episodeLengthVar | **500** | 300 | 500 | R7에서 사장이 직접 변경 또는 default로 reset |
| resolved_final_episode | 26 | 35 | (서버 자동 계산) | 정상 — totalEpisodes 30 ± totalEpisodesVar 5 범위 내 random |

### 2-3. 코드 default 값과의 비교

[public/js/auth.js:28-32](public/js/auth.js#L28-L32) — `clearWorldSettingsUI()` reset default:
```js
Object.assign(storyConfig, {
  conflict:3, foreshadow:3, emotion:3, dialogue:3, direction:3,
  episodeLength:2000, episodeLengthVar:500, totalEpisodes:30, totalEpisodesVar:5,
  pov: "3인칭 관찰자", style: "균형",
});
```

[public/js/config.js:29-41](public/js/config.js#L29-L41) — 모듈 초기값:
```js
const storyConfig = {
  pov: "3인칭 관찰자", style: "균형",
  episodeLength: 2000, episodeLengthVar: 500,
  totalEpisodes: 30, totalEpisodesVar: 5,
  conflict: 5, foreshadow: 5, emotion: 5, dialogue: 5, direction: 5,
};
```

### 2-4. 핵심 관찰

| 영역 | R7 실제 값 | 만약 reset 동작 시 (default) | 만약 초기 모듈 값 | 만약 직전 책 (바보바보바보) | 매칭 |
|---|---|---|---|---|---|
| emotion | **7** | 3 | 5 | **7** | **직전 책 일치** |
| conflict | **7** | 3 | 5 | **7** | **직전 책 일치** |
| direction | **7** | 3 | 5 | **7** | **직전 책 일치** |
| genre | **현대 로맨스** | (reset 시 미설정 가능) | (없음) | **현대 로맨스** | **직전 책 일치** |
| mood | **설레고 긴장감 있는** | (reset 시 미설정 가능) | (없음) | **설레고 긴장감 있는** | **직전 책 일치** |
| style | **묘사풍부** | 균형 | 균형 | **묘사풍부** | **직전 책 일치** |

→ R7 canary의 storyConfig 6개 핵심값이 `default(3)`도 `초기값(5)`도 아닌 **정확히 직전 책 값**과 일치.

→ R7 canary 생성 시점에 storyConfig 객체가 **clearWorldSettingsUI()로 reset되지 않은 채** 직전 책 값이 잔존 + 그대로 저장된 강력한 증거.

→ 다만 read-only로는 "사장이 모달을 열어 stale 값을 보고도 안 건드린 것"인지 "모달을 한 번도 안 열고 character만 입력 path로 저장한 것"인지 구분 불가. **브라우저 재현 테스트 필요**.

---

## 3. 브라우저 재현 절차 (사장 실행)

### 공통 사전 작업

1. http://localhost:3000 접속
2. Ctrl+Shift+R로 hard reload
3. **DB cleanup / 기존 책 삭제 절대 금지**
4. **R7_회색지대_생존기_CANARY 책은 절대 수정·열기 금지** — 증거 보존
5. 임시 테스트 책 생성 시 제목에 반드시 **`R7_S13_REPRO_TEMP`** 포함 (예: `R7_S13_REPRO_TEMP_시나리오1`)
6. **임시 책에 actual generation 절대 실행 금지** — 1화 본문 생성 안 함

### 시나리오 1 — 모달 미오픈 path (가장 의심 가는 시나리오)

**목적**: 새 책 생성 시 세계관 설정 모달을 한 번도 열지 않고 저장하면 직전 책 storyConfig가 그대로 박히는지.

1. 책 슬롯에서 `바보바보바보` 책 선택
2. 세계관 설정 모달을 한 번 열어서 다음 값 화면 확인 (수정 X):
   - genre: "현대 로맨스" / mood: "설레고 긴장감 있는" / style: "묘사풍부"
   - emotion/conflict/direction: 7 / 7 / 7
3. 모달 닫기
4. **새 책 생성 → 제목 `R7_S13_REPRO_TEMP_시나리오1`**
5. 책 전환 후 **세계관 설정 모달을 절대 열지 마라**
6. 캐릭터 입력 또는 배경 텍스트만 입력 후 저장
7. 저장 직후 사장이 책의 새 `book_id`를 회신
8. 내가 read-only로 DB 확인:
   ```
   SELECT context->'story_config' FROM books WHERE id = '<새 book_id>';
   ```

**판정**:
- 새 책 storyConfig.genre == "현대 로맨스", emotion == 7 등 → **S13.5 P1 회귀 확정** (모달 미오픈 path에서도 stale 박힘)
- 새 책 storyConfig가 default(emotion=3) 또는 초기값(emotion=5) → 시나리오 1에서는 회귀 아님 → 시나리오 2 진행

### 시나리오 2 — 모달 오픈 후 수정 없이 저장

**목적**: 모달을 열기만 하고 슬라이더 등은 안 만지고 저장 시 직전 책 값이 박히는지.

1. 책 슬롯에서 `바보바보바보` 책 선택
2. 세계관 설정 모달 열기 → 닫기 (값 변경 X)
3. **새 책 생성 → 제목 `R7_S13_REPRO_TEMP_시나리오2`**
4. 책 전환 후 세계관 설정 모달 **열기**
5. 모달의 슬라이더/장르/분위기 값이 화면에 어떻게 보이는지 회신:
   - genre/mood가 "현대 로맨스"/"설레고 긴장감 있는"으로 보이면 stale (사용자 입력이 아닌데도 화면에 박힘)
   - genre/mood가 비어 있고 슬라이더가 default(3) 또는 초기값(5)이면 정상
6. 화면 확인 후 **아무것도 수정하지 않고** 저장 버튼 클릭
7. 저장 직후 새 `book_id` 회신
8. 내가 read-only DB 확인.

**판정**:
- 화면에서 직전 책 값이 보였고 저장 시 그 값이 DB에 박힘 → **S13.5 P1 회귀 확정** (UI 표시도, 저장도 stale)
- 화면은 default였는데 저장 후 DB에 직전 책 값이 박힘 → **S13.5 P1 회귀 확정** (저장 path 회귀)
- 화면이 default + DB도 default → 시나리오 2에서는 회귀 아님

### 시나리오 3 — R7 canary 책 재선택 시 UI 표시 vs DB 일치

**목적**: 책 전환 시 R7 canary 책의 stale storyConfig가 UI에 그대로 표시되는지.

1. 다른 active 책 선택 (예: 바보바보바보)
2. 세계관 설정 모달 열기 → 닫기
3. **R7_회색지대_생존기_CANARY 책 선택** (절대 수정·저장 금지)
4. 세계관 설정 모달 열기
5. 화면에 표시되는 값 회신 (수정 안 함):
   - genre: ?
   - mood: ?
   - style: ?
   - emotion/conflict/direction: ? / ? / ?
6. **저장하지 말고** 모달 닫기 (수정 안 했으니 저장 버튼도 누르지 마라)
7. 다른 책으로 전환하면서 R7 canary는 그대로 보존

**판정**:
- 화면 표시값이 R7 DB의 stale 값(현대 로맨스/설레고 긴장감/7-7-7)과 일치 → 정상 (DB 값을 정확히 복원)
- 화면 표시값이 다른 값 → restoreContextUI 자체에 결함

→ 시나리오 3은 **저장 path 회귀와 무관**. UI 표시 정확도만 검증. WARN 수준이면 시나리오 1/2가 우선.

---

## 4. 임시 테스트 책 명세

| 항목 | 규칙 |
|---|---|
| 제목 prefix | `R7_S13_REPRO_TEMP` 필수 |
| 캐릭터 입력 | 임의 1명 가능 (예: "테스트") |
| 배경/세계관 입력 | 시나리오 1/2 진행에 필요한 최소 입력 |
| actual generation | **절대 시작 금지** (1화 생성 안 함) |
| storyConfig 슬라이더 조작 | 시나리오에서 명시한 경우만 |
| 책 삭제 | **금지** — 사장이 별도 cleanup phase에서 처리 |
| 책 cleanup script 실행 | 금지 |

→ 시나리오 1/2/3 끝나면 임시 책들은 그대로 DB에 남기고 R7 S13.5 phase 종료 후 별도 cleanup 또는 사장 직접 삭제.

---

## 5. 판정 기준 (사장 결정안)

| 재현 결과 | 판정 |
|---|---|
| 시나리오 1에서 모달 미오픈인데 직전 책 값 저장됨 | **S13.5 P1 회귀 확정** — R7 actual 보류, fix plan 진입 |
| 시나리오 2에서 모달 오픈만 하고 수정 없이 저장 시 직전 책 값 저장됨 | **S13.5 P1 회귀 확정** — R7 actual 보류, fix plan 진입 |
| 시나리오 1+2 모두 default/초기값 저장 (재현 안 됨) | **R7 canary 한정 입력/저장 부주의 가능성** — B+ 진행 (사장 storyConfig 수동 수정) |
| 시나리오 3에서 화면 표시값이 DB 값과 다름 | restoreContextUI 결함 — WARN, 별도 reopen |

---

## 6. 절대 금지 (R7 S13.5 phase 동안)

- ❌ R7 actual generation 시작
- ❌ R7 canary 책 storyConfig 덮어쓰기 (증거 보존)
- ❌ R7 canary 책 재저장
- ❌ storyConfig 코드 수정 (auth.js / config.js / modal.js / story-config.js)
- ❌ route / prompt / DB schema 변경
- ❌ DeepSeek 작업
- ❌ `_capQlabel` / `_inferItemBadge` 수정
- ❌ DB cleanup / book delete
- ❌ `.claude/scheduled_tasks.lock`, `scripts/cloud_dpo/launch_dpo.py` stage
- ❌ 임시 테스트 책에 actual generation 실행

---

## 7. 응급 처치 키트 reclassify apply 결과 (참고)

```
node scripts/reclassify_item_vocab.mjs --book-id 1f1e72c8-6892-4821-a94a-1cb75229caae --item-name "응급 처치 키트" --apply

✓ COMMIT — vocab 1건 + canonical 1건 갱신 완료.
  • 응급 처치 키트
      item_vocab:           도구 → 의료
      canonical (한서윤):   (없음) → 의료
```

apply 후 audit:
```
coverage 100%, "기타" 0/12, mismatch 0건
의료 1, 식량 2, 도구 2 (← 3에서 1 감소), 전자 2, 귀중품 1, 통신 1, 무기 1, 방어구 1, 문서 1
```

vocab 정착 완료 유지 + 의료 카테고리 1건 등장. R7 item category pipeline canary로서 의미상 정확해짐.

---

## 8. 다음 단계

1. 사장이 위 시나리오 1·2·3을 브라우저에서 실행
2. 각 시나리오마다 임시 책 `book_id` + 화면 표시값을 사장이 회신
3. 내가 read-only DB 확인 + 결과 종합 + 판정
4. 판정에 따라:
   - **P1 회귀 확정**: storyConfig stale 원인 fix plan 작성 (auth.js의 책 전환 시 clearWorldSettingsUI 호출 path 추적)
   - **재현 불가**: R7 canary 책 storyConfig 11개 + hard rule 2건을 사장이 브라우저에서 직접 수정 + 내가 재검증

```
응급 처치 키트 apply:    ✅ 완료 (vocab + canonical 모두 의료)
audit detail:           ✅ coverage 100% / 기타 0 / mismatch 0
R7 storyConfig stale:    🔍 read-only로 강력한 증거 (직전 책 값 100% 일치)
판정:                    ⏸ 시나리오 1/2/3 브라우저 재현 결과 대기
R7 actual:              ⏸ 보류 유지
```

---

## 9. P1 Fix 진입 (사장 결정 2026-05-03)

자동화 의존성 추가 비용 + 사장 수동 클릭 모두 생략. read-only 코드 추적 + R7 storyConfig 직전 책 값 100% 일치만으로 **S13.5 부분 회귀 인정 충분**으로 판정. P1 fix로 전환.

### 9-1. Root cause

| 단계 | 상태 |
|---|---|
| `restoreContextUI` (auth.js:68-69) | `Object.assign(storyConfig, ctx.story_config)`로 직전 책의 `genre`/`mood`를 storyConfig 객체에 동적 추가 |
| `clearWorldSettingsUI` (auth.js:28-32, 옛 버전) | reset 객체에 `genre`/`mood` 키 누락 → 동적 추가된 키가 잔존 |
| 새 책 생성 시 saveContext payload | `modal.js:287` `storyConfig: _storyConfig` (모듈 전역 그대로 전송) → stale `genre`/`mood` 박힘 |
| 슬라이더 default 불일치 | config.js 초기값 5 vs auth.js reset 값 3 → 책 전환 후 모달 표시 5/3/실제값이 일관 못함 |

### 9-2. 적용한 수정 (최소 diff)

#### A. `public/js/config.js`
```diff
+ const STORY_CONFIG_DEFAULTS = Object.freeze({
+   pov: "3인칭 관찰자", style: "균형",
+   genre: "", mood: "",
+   episodeLength: 2000, episodeLengthVar: 500,
+   totalEpisodes: 30, totalEpisodesVar: 5,
+   conflict: 5, foreshadow: 5, emotion: 5, dialogue: 5, direction: 5,
+ });
+ const storyConfig = { ...STORY_CONFIG_DEFAULTS };
- const storyConfig = { pov, style, ..., conflict:5, foreshadow:5, ... };  // genre/mood 키 부재
```

→ default를 한 곳(STORY_CONFIG_DEFAULTS)에서 관리. genre/mood 키 명시.

#### B. `public/js/auth.js` `clearWorldSettingsUI()`
```diff
- Object.assign(storyConfig, {
-   conflict:3, foreshadow:3, emotion:3, dialogue:3, direction:3,
-   episodeLength:2000, episodeLengthVar:500, totalEpisodes:30, totalEpisodesVar:5,
-   pov: "3인칭 관찰자", style: "균형",
- });
+ for (const k of Object.keys(storyConfig)) delete storyConfig[k];
+ Object.assign(storyConfig, STORY_CONFIG_DEFAULTS);

  ["conflict",...].forEach(key => {
-   if (slider) { slider.value = storyConfig[key]; slider.style.setProperty("--pct", "22.2%"); }
+   if (slider) {
+     slider.value = storyConfig[key];
+     const pct = ((storyConfig[key] - 1) / 9 * 100).toFixed(1) + "%";
+     slider.style.setProperty("--pct", pct);
+   }
  });
```

→ 모든 키를 삭제 후 STORY_CONFIG_DEFAULTS로 갈아끼움 (직전 책에서 동적 추가된 키도 차단). 슬라이더 % 계산이 default(5)에 맞춰 동기화.

### 9-3. 신규 verify

`scripts/verify_story_config_reset.mjs` — **32 checks 모두 PASS**:
- STORY_CONFIG_DEFAULTS 상수 정의 + Object.freeze + genre/mood 명시
- 슬라이더/길이 default 5 / 2000 / 30
- storyConfig가 spread로 초기화
- clearWorldSettingsUI: 모든 키 delete + STORY_CONFIG_DEFAULTS reset
- hardcoded reset 객체(emotion:3) 잔존 안 함
- 옛 % "22.2%" 흔적 부재
- selectBook → _restoreContextSafely → clearWorldSettingsUI 호출 path
- context 404 시 restoreContextUI 미호출
- saveContext payload contract
- resolved_final_episode 임의 null 처리 부재 (auth.js / modal.js / config.js)

### 9-4. R7 canary 책 정정 — `repair_r7_story_config.mjs`

dry-run + apply 두 단계로 분리. R7 canary 한정 안전 가드(title 정확 일치 검증).

#### Dry-run 결과 (read-only)
```
storyConfig DELTA (6건):
  • genre     : "현대 로맨스" → "포스트아포칼립스 서바이벌"
  • mood      : "설레고 긴장감 있는" → "스릴러, 드라마"
  • style     : "묘사풍부" → "균형"
  • emotion   : 7 → 5
  • conflict  : 7 → 5
  • direction : 7 → 5

forbidden_settings DELTA (2건 추가):
  + 사망자 발화 금지
  + 지식 경계 / 알 수 없는 정보 사용 금지

UNTOUCHED:
  world_rules 4건, character_defaults 4명, fixed_relationships 0건
  pov / dialogue / foreshadow / episodeLength* / totalEpisodes* / resolved_final_episode 26 모두 유지
  canonical_characters / item_vocab 별도 테이블 미터치
```

#### Apply 결과
```
✓ COMMIT — books.context jsonb UPDATE (rowCount=1).

POST-APPLY VERIFY (read-only):
  ✓ storyConfig.genre = "포스트아포칼립스 서바이벌"
  ✓ storyConfig.mood = "스릴러, 드라마"
  ✓ storyConfig.style = "균형"
  ✓ storyConfig.emotion = 5
  ✓ storyConfig.conflict = 5
  ✓ storyConfig.direction = 5
  ✓ forbidden contains "사망자 발화 금지"
  ✓ forbidden contains "지식 경계 / 알 수 없는 정보 사용 금지"
  • resolved_final_episode = 26 (유지)
  • episodeLength = 2000 (유지)
  • totalEpisodes = 30 (유지)
```

### 9-5. 전체 verify suite (P1 fix 반영 후)

```
npm run build (tsc)                                      PASS
verify_route_integrity                                   6/0/0
verify_public_js_syntax                                  25/25
verify_book_load_flow                                    41/0
verify_context_save_async                                13/13
verify_modal_save                                        16/16
verify_generation_session_guard                          14/14
verify_capture_title_format                              8/8
verify_reading_mode_position_preserve                    15/15
verify_story_config_reset (NEW)                          32/32
verify_item_category_source_priority                     12/12
verify_item_description_length                           21/21
verify_episode_end_character_cards                       27/27
verify_episode_end_character_cards_layout                22/22
audit_item_vocab --detail                                12/12 vocab / 100% / mismatch 0
```

회귀 0. 응급 처치 키트 의료 + R7 vocab 정착 완료 유지.

### 9-6. R7 30화 actual 재개 가능 여부

| 조건 | 상태 |
|---|---|
| storyConfig stale 차단 (코드 수정) | ✅ |
| R7 canary storyConfig 정상 | ✅ (genre 포스트아포칼립스 서바이벌, emotion/conflict/direction 5) |
| forbidden_settings hard rule 2건 이상 | ✅ (사망자 발화 + 지식 경계) |
| canonical 4명 / initial_items 12개 / vocab 12 | ✅ |
| 응급 처치 키트 = 의료 | ✅ |
| vocab coverage 100% / 기타 0 / mismatch 0 | ✅ |
| 정적 verify 전부 PASS | ✅ (13개 + 신규 1개) |
| 코드 변경 = config.js + auth.js + verify + repair script | ✅ (route/prompt/DB schema 변경 0) |
| resolved_final_episode 26 유지 (정상 정책) | ✅ |
| leftover 2건 staged 0 | ✅ (`.claude/scheduled_tasks.lock` / `scripts/cloud_dpo/launch_dpo.py` untouched) |

→ **R7 30화 actual 재개 가능 — 사장 승인 시 시작**

### 9-7. 변경 commit 후보

| 영역 | 파일 |
|---|---|
| client | `public/js/config.js`, `public/js/auth.js` |
| test | `scripts/verify_story_config_reset.mjs` |
| script | `scripts/repair_r7_story_config.mjs` |
| docs | `docs/r7-s13-stale-repro-notes-2026-05-03.md` |

leftover 2건은 commit 시 절대 staging 금지.
