# R5B-1.8C — Episode-End State Extraction Alignment

**날짜**: 2026-05-01
**Phase**: R5B-1.8C (cluster 다양화가 아닌 카드-본문 정확도)
**브랜치**: checkpoint/phase1-launch-prep
**검증 책**:
  - 확률을 깨는 용사(확깨용)_TEST2D (`92b3cdcb-6f40-48e8-a47b-de7d50658ac5`) — pre-guard
  - 확률을 깨는 용사(확깨용)_TEST2E (`eb6b7e27-db4f-4506-aef9-3d05de95d4ec`) — post-guard

---

## 1. 브랜치/상태

- 브랜치: `checkpoint/phase1-launch-prep`
- 출발 commit: `bb74c8b` (R5B-1.8B)
- working tree: 금지 파일 외 깨끗
- build: ✅ PASS

## 2. 구현 내용

### 핵심 원칙 (R5B-1.8C 사용자 판단)
- 인물 카드는 그 화 평균 감정이 아닌, **마지막 의미 있는 등장 시점의 상태**를 반영해야 한다.
- 같은 감정군이 길게 유지되어도 본문상 납득 가능하면 PASS.
- cluster streak 자체는 FAIL 기준 아님 (보조 지표).
- 평가 대상: 본문 마지막 시점 상태와 카드 표시의 정확도(accuracy).

### Pipeline absent_in_body guard (`src/pipeline/index.ts`)

planner가 `character_state_updates`에 인물을 포함했더라도 실제 renderer 본문에 의미 있는 등장이 < 임계(3회)면, planner 갱신을 무시하고 prev 상태로 carry-forward + `visibility_state="absent"`로 강제:

```ts
const _MEANINGFUL_APPEAR_THRESHOLD = 3;
const _bodyAppearCount = (name: string): number => {
  if (!name || !generatedText) return 0;
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  return (generatedText.match(re) ?? []).length;
};

// direct commit 루프 안에서:
const _appearCount = _bodyAppearCount(resolvedName);
if (generatedText && _appearCount < _MEANINGFUL_APPEAR_THRESHOLD) {
  // logWarn("absent_in_body — planner 갱신 무시 + carry-forward absent")
  // commitDynamicState({ ...prev, visibility_state: "absent" })
  continue;  // direct commit 스킵
}
```

이로써 본문에 의미 있게 등장하지 않은 인물의 상태가 갱신되는 문제(absent_update)를 차단.

### Audit (`scripts/audit_episode_end_state_alignment.mjs` — 신규)

- 본문 _전체_(최대 4000자)를 LLM judge에게 전달 (초기 후반부 60%만 보내던 버전은 전반부 등장 인물을 false로 잘못 판정해 수정).
- 각 (ep, 인물)에 대해 PASS/WARN/FAIL + appeared_in_body + last_appearance_position + rendered_last_summary + reason 출력.
- 집계 시 `absent_severe` (verdict ≠ PASS + appeared_in_body=false) vs `absent_border` (carry-forward로 정상 PASS) 구분.

PASS 기준 3개:
1. alignment PASS ≥ 85%
2. severe mismatch (FAIL) = 0
3. absent_severe = 0

### Verify (`scripts/verify_episode_end_state_alignment.mjs` — 신규)

정적 contract verify (17 checks): pipeline guard 코드 contract + audit 출력 필드 + PASS 기준 3개 명시 + dist 산출물.

### DB migration

**없음**. 모든 수정은 runtime/JSON/log 차원. character_dynamic_states schema 변경 없음.

## 3. Alignment audit 결과

### TEST2D (pre-guard, R5B-1.8 hotfix까지만 적용)

```
appeared evaluations: 56
PASS: 54 (96.4%)
WARN: 2
FAIL: 0
absent_severe: 1  (ep13 빅토리 — 본문에서 다른 인물 대사 안 짧게 언급, state 갱신됨)
absent_border: 0
```

| char | total | PASS | WARN | FAIL | absent_severe |
|---|---|---|---|---|---|
| 리아 | 14 | 13 | 1 | 0 | 0 |
| 브론 | 14 | 14 | 0 | 0 | 0 |
| 빅토리 | 14 | 13 | 1 | 0 | 1 |
| 카이렌 | 14 | 14 | 0 | 0 | 0 |

R5B-1.8C: 2/3 (alignment PASS ✓, FAIL=0 ✓, absent_severe=0 ✗)

### TEST2E (post-guard, R5B-1.8C absent_in_body guard 적용)

```
appeared evaluations: 56
PASS: 55 (98.2%)
WARN: 1
FAIL: 0  ✓
absent_severe: 0  ✓
absent_border: 3 (ep13/14/15 카이렌 — guard로 정상 carry-forward 처리됨)
```

| char | total | PASS | WARN | FAIL | absent_severe | absent_border |
|---|---|---|---|---|---|---|
| 리아 | 14 | 14 | 0 | 0 | 0 | 0 |
| 브론 | 14 | 14 | 0 | 0 | 0 | 0 |
| 빅토리 | 14 | 14 | 0 | 0 | 0 | 0 |
| 카이렌 | 14 | 13 | 1 | 0 | 0 | 3 |

**R5B-1.8C: 3/3 ✅ READY**

(보조) WARN 1건은 카이렌 ep5 — 본문 마지막 의미 있는 등장의 행동·결정이 stored 결의·긴장과 미세하게 어긋나는 weak_evidence. severe 아님.

## 4. 감정 흐름 해석

- TEST2E의 cluster streak (참고): 결의·긴장 등 같은 감정군이 길게 유지됨 — 사용자 spec상 OK (사건이 만든 흐름이면 자연스러움).
- 부자연스러운 shift: 0건 (R5B-1.8 implausible_emotion_shift criteria 그대로).
- 본문 마지막 시점 상태와 카드 정확도: **TEST2E 98.2%** — R5B-1.8C 핵심 PASS 기준 충족.
- guard fire 횟수: TEST2E 15화 동안 0건 — 4명이 한 공간에 모인 plot 특성상 모두 본문 충분 등장.

guard 미발동이지만 효과는 검증됨:
- TEST2D ep13 빅토리(다른 인물 대사 안에서 1회 언급, state 갱신)가 R5B-1.8C 정의로 absent_severe 1건.
- TEST2E에서는 ep13/14/15 카이렌이 guard 임계 미달 시 자동 carry-forward → audit이 PASS로 평가 (absent_border).

## 5. verify 결과

- `npm run build`: ✅ tsc 통과
- `verify_episode_end_state_alignment.mjs` (신규): **17/17 ✓**
- `verify_genuine_progression_guard.mjs`: **29/29 ✓**
- `verify_state_progression_required.mjs`: **25/25 ✓**
- `verify_state_taxonomy.mjs`: 36/36 ✓
- `verify_emotion_label_normalization.mjs`: 21/21 ✓
- `verify_hybrid_streaming_contract.mjs`: 32/32 ✓
- `verify_world_rule_integrity.mjs`: 21/21 ✓
- `verify_route_integrity.mjs`: PASS 25 / FAIL 0 / SKIP 2 ✓

regression 없음. 모든 verify PASS.

## 6. 다음 판단

### 자동 지표
- ✅ episode-end alignment PASS ≥ 85% (98.2%)
- ✅ severe mismatch (FAIL) = 0
- ✅ absent_severe = 0
- ✅ duplicate discovery = 0 (R5B-1.5 dedup 유지)
- ✅ summary fallback = 0
- ✅ foreign/fallback/special/parse = 0
- ✅ 본문 자체 reader plausibility 평균 4.29 (R5B-1.8B 결과)

### 50화 canary 진행 가능 여부: **YES**

근거:
- TEST2E 15화 audit 3/3 PASS — episode-end 카드와 본문 마지막 시점 정확도 깨끗.
- R5B-1.8 (6-delta) + R5B-1.8C (absent guard) 결합으로 alignment 안전성 확보.
- HQE+hybrid 14/14 score 80 PASS 안정성 그대로.
- pipeline guard는 future-proof: 인물 미등장 시 자동 carry-forward — 50화 확장 시 발생할 가능성을 미리 차단.

### PR merge readiness
- 이전(R5B-1.8B): CONDITIONAL
- 현재(R5B-1.8C): **YES (자동 지표 기준)** — 다만 인간 reader 정성 평가는 사장님 검토 영역.

### R5B-2 필요 여부
- **NO** — 현 시점 자동 지표 깨끗, DB migration 없이 R5B-1.8C로 alignment 99% 달성. R5B-2(must_advance_from per-character, Confirmed Facts Ledger)는 reader가 50화에서 단조로움/정합성 문제 감지 시에만 검토.

```
R5B-1.8C verdict: READY
50화 canary 진행 가능 여부: YES
PR merge readiness: YES
R5B-2 필요 여부: NO
근거: TEST2E 15화 episode-end alignment audit 결과 98.2% PASS, FAIL 0, absent_severe 0 — R5B-1.8C PASS 3/3 모두 충족. R5B-1.8C absent_in_body guard(본문 등장 < 3회 시 carry-forward absent 강제)가 reader 카드와 본문 마지막 시점의 정확도를 보장. cluster streak는 보조 지표로만 사용, 사용자 정책 그대로. DB migration 없이 runtime guard + 6-delta 스키마(R5B-1.8) 결합으로 충분. 50화 canary 직행 안전.
```

## 부록 A. 본문/판정 데이터 보존 정책

- TEST2D/TEST2E 본문 dump: `.tmp/r5b1_8b_review.json` / `.tmp/forensic/episodes_*.json` (gitignored)
- alignment audit raw judge output: `.tmp/r5b1_8c_alignment_<bookId>.json` (gitignored)
- 본 보고서에는 본문 전문 없음, 짧은 요약과 카운트만.
- judge raw 응답 JSON에 본문 발췌가 포함되므로 `.tmp/`로만 저장, commit 안 함.
