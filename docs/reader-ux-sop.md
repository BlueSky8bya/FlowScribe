# Reader UX SOP

> reader 화면(본문, 사이드바, ep-end cards, hover, capture+) 운영 지침.
> 상세 진단·구현안: `reader-ux-architecture-proposal.md`.

---

## 1. 현재 정책 (Phase 4.19 후)

| 영역 | 표시 | 비고 |
|---|---|---|
| 우측 사이드바 인물 정보 | 이름 + 성별 색만 (minimal) | 회차 미래 정보 노출 차단 |
| 본문 인물명 | 성별별 정적 밑줄 (3px alpha cc) | hover 비활성 |
| 본문 hover | 비활성 (Phase 4.19) | 감정/신체 tooltip 제거 |
| 본문 하단 ep-end cards | detailed (확장/축소, 소지품 카드) | 회차 종료 시점 |
| 생성 중 ep-end | hidden (Phase 4.19C) | 이전 회차 정보 노출 방지 |
| token 첫 도착 후 | "이번 화의 인물 상태를 정리하고 있습니다…" placeholder + spinner | char-states 도착 시 카드 교체 |
| 캡처+ | 본문 + 인물 정보 | source는 별도 (R7.2에서 ep-end markup으로 통일 예정) |

## 2. UI 구조

```
┌─[좌] 책 목록  ─┬─ [중] 본문 영역 ─────────────────┬─ [우] 우측 패널 ─┐
│                │  output (token 도착 시 점진 렌더)   │ 인물 정보         │
│                │                                   │  - 이름 + 성별 색 │
│                │  ─── 본문 끝 ───                  │ 낭독 가이드 (모드별) │
│                │  episode-end-cards                │ TTS 컨트롤        │
│                │  ┌─────────────────┐              │ 독자 프로필       │
│                │  │ 카드 (확장/축소) │              │                  │
│                │  └─────────────────┘              │                  │
│                │  ─── 작가 개입 / regen / 캡처 ──   │                  │
└────────────────┴───────────────────────────────────┴─────────────────┘
```

## 3. 핵심 코드 (file:function)

| 위치 | 함수 |
|---|---|
| `public/js/generate.js` | `updateSceneCharPanel(charStates)` — minimal 사이드바 |
| `public/js/generate.js` | `renderEpisodeEndCharCards(charStates)` — 본문 하단 detailed |
| `public/js/generate.js` | `_buildSceneCharDetailedCardHtml(s)` — 카드 단일 빌더 |
| `public/js/generate.js` | `wrapCharNamesInOutput(charStates)` — 본문 인물명 밑줄 |
| `public/js/generate.js` | `_clearDebugPanels()` — 생성 시작 시 ep-end hide |
| `public/js/generate.js` | `_ensureHoverListener()` — hover 비활성 (영구 hidden) |
| `public/css/components.css` | `.episode-end-cards`, `.ep-end-grid`, `.ep-end-pending` |

## 4. 디자인 결정 근거

- **사이드바 minimal:** 본문 중간을 읽는 동안 미래 회차 감정/소지품 노출 → 스포일러
- **ep-end detailed:** 회차 다 읽고 자연스럽게 확인. detailed 카드 + 소지품
- **hover 제거:** 인터랙티브 신호 무 → 사용자 호기심을 본문으로
- **placeholder spinner:** state extraction이 batch라 본문 도착 후 잠시 빈 시간 → "정리 중" 안내

## 5. 화면 폭 대응

```css
.ep-end-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  align-items: start;       /* ★ 한 카드 펼쳐도 옆 카드 stretch 안 함 */
}
.episode-end-cards {
  width: 100%; max-width: 900px;   /* output 760 + 약간 넓게, 1~3열 자동 */
}
@media (max-width: 560px) { ... 1열 fallback ... }
```

## 6. R7 (proposal) 단계

| Phase | 변경 |
|---|---|
| R7.0 | 모바일 보정 (collapsed default, 시간 안내) |
| R7.1 | 사이드바에 신체 부상 신호만 추가 (감정 미노출) |
| R7.2 | 캡처+ source ep-end markup으로 통일 |
| R7.3 | placeholder 단계화 (R5 streaming 후, text_done → 안내, 지연 시 보강) |

## 7. 변경 시 verify

```bash
node scripts/verify_episode_end_character_cards.mjs
node scripts/verify_episode_end_placeholder.mjs
node scripts/verify_reading_mode_scroll_anchor.mjs
```

UI 변경은 코드 verify로는 시각 회귀 못 잡음 → 사장 직접 확인.

## 8. 디버깅 체크리스트

### "사이드바에 감정/소지품이 보임"
- 누군가 minimal 정책을 깸. `updateSceneCharPanel` 안에 detailed 호출이 들어갔는지 확인
- `_legacyUpdateSceneCharPanelDetailed`가 우연히 활성화됐는지

### "본문 인물명에 hover tooltip 뜸"
- `_ensureHoverListener` 안에 mouseover 리스너가 살아 있는지
- CSS의 `.char-name-ref:hover` 부활 여부

### "ep-end 카드 옆이 같이 펼쳐짐"
- `.ep-end-grid { align-items: start; }` 누락
- grid default stretch 회귀

### "재생성 시 이전 화 카드가 잠깐 보임"
- `_clearDebugPanels`에서 `episodeEndCards.hidden = true; innerHTML = ''` 호출 확인
- `renderEpisodeEndCharCards`의 `_generating` 가드 동작 확인

## 9. 금지

- ❌ 사이드바에 감정/소지품/관계/역할 정보 다시 추가 (스포일러)
- ❌ 본문 hover에 LLM-derived 데이터 노출
- ❌ ep-end 카드를 본문 위에 배치 (회차 종료 시점이 의미)
- ❌ 캡처+ 결과가 화면에서 본 카드와 다르게 (source 분기)
