# FlowScribe Design System

## 이 문서의 목적
프론트엔드 파일 구조, CSS 토큰 체계, JS 모듈 의존 순서를 정의한다.
코드 수정 시 이 문서를 먼저 확인해 어떤 파일을 열어야 하는지 결정한다.

---

## 파일 구조

```
public/
├── index.html              ← HTML 골격만 (150줄 이하)
├── marked.min.js           ← Markdown 렌더러
│
├── css/
│   ├── tokens.css          ← CSS 변수 & 3개 테마 (:root, [data-theme])
│   ├── layout.css          ← body, #output, 헤더, 에피소드 컨트롤
│   ├── components.css      ← 칩, 태그, 토스트, 카운터, 버튼, 모달-오버레이
│   └── modal.css           ← 책 레이아웃, 인물 카드, 로딩 오버레이, 애니메이션
│
└── js/                     ← 전역 스코프 공유 (ES module 아님 — 순서 중요)
    ├── config.js           ← 상수 + 공유 상태 (settingVals, ruleEntries, …)
    ├── ui.js               ← setTheme, showToast, setReadMode, 로딩 오버레이
    ├── chips.js            ← bindChipGroup, confirmCustomChip, addChipDirect
    ├── rules.js            ← makeRuleTag, addRuleTagDirect, makeTagInput
    ├── chars.js            ← appendCharCard, renderCharCards, changeCharCount
    ├── suggest.js          ← suggestCharacter, suggestRules, applySuggestion
    ├── generate.js         ← generate(), viewPrev(), saveEpisode()
    ├── modal.js            ← openModal, closeModal, saveContext, getContext
    └── app.js              ← 초기화 (updateEpisodeUI, setTheme 호출)
```

### JS 로드 순서 (index.html에서 반드시 이 순서로)
```
marked.min.js → config.js → ui.js → chips.js → rules.js
→ chars.js → suggest.js → generate.js → modal.js → app.js
```

### 수정 가이드
| 작업 | 파일 |
|---|---|
| 테마 색상 변경 | `css/tokens.css` |
| 레이아웃 변경 | `css/layout.css` |
| 버튼·칩·태그 스타일 | `css/components.css` |
| 인물 카드·책 레이아웃 | `css/modal.css` |
| 상수 추가 (장르·유형 등) | `js/config.js` |
| AI 추천 로직 | `js/suggest.js` |
| 에피소드 생성 SSE | `js/generate.js` |
| 세계관 저장 로직 | `js/modal.js` |

---

## 테마 토큰 체계

| 토큰 | 용도 |
|---|---|
| `--bg`, `--bg2`, `--bg3` | 배경 깊이 계층 (낮은 번호일수록 더 어두움) |
| `--border`, `--border2` | 테두리 (border2가 더 밝음) |
| `--text` ~ `--text4` | 텍스트 강도 (text4가 가장 약함) |
| `--accent`, `--accent-bg`, `--accent-border` | 브랜드 강조색 시스템 |
| `--page-l`, `--page-r`, `--spine-bg` | 책 레이아웃 전용 |
| `--tag-hard-*` | 절대금지 태그 전용 |

---

## 레이아웃 존

```
[TOP-RIGHT]  .theme-controls     — 테마 토글 버튼 (fixed)
[HEADER]     .header              — 브랜드명 + 세계관 설정 버튼
[READ-BAR]   .read-mode-bar       — 눈으로 읽기 / 소리내어 읽기
[OUTPUT]     #output              — 스트리밍 텍스트 출력 (max-width 700px)
[CONTROLS]   .episode-controls    — 이전화 / 현재화 / 생성 버튼
[MODAL]      .modal-overlay       — 세계관 설정 모달 (두 페이지 책 UI)
```

---

## 색상 기준값 (다크 테마 기준)

| 이름 | 값 | 용도 |
|---|---|---|
| Gold accent | `#a89880` | 브랜드 강조, 선택 상태 |
| Background deep | `#0f0f0f` | 최하단 배경 |
| Background mid | `#1a1a1a` | 카드, 출력 영역 |
| Background high | `#2a2a2a` | 헤더 배경, 버튼 |
| Text primary | `#e8e0d4` | 본문 |
| Text muted | `#908070` | 힌트, 레이블 |
| Danger | `#c97070` | 절대금지 태그 |
| Warning | `#c49030` | 경고 메시지 |
