/**
 * verify_meaningful_appearance_guard.mjs — R5B-1.8D
 *
 * detectMeaningfulAppearance(body, name)의 deterministic 분류가 R5B-1.8D 명세 케이스를
 * 모두 만족하는지 검증한다.
 *
 * 케이스 (사용자 명세):
 *   1. 이름만 대사 속에서 5회 언급됨            → appeared=false (level=weak)
 *   2. 직접 대사 1회                            → appeared=true  (level=strong)
 *   3. 직접 행동 1회                            → appeared=true  (level=strong)
 *   4. 회상 속 이름 반복                        → 본문 의미 등장 없음 → weak/none
 *   5. 소지품 전달/사용                         → appeared=true  (level=strong)
 *   6. 위치 이동 서술                           → appeared=true  (level=strong)
 *   7. 다른 인물이 "카이렌은 어디 있지?"라고 말함 → 카이렌 appeared=false (level=weak)
 *
 * 본 verify는 본문 fixture를 inline으로 들고 deterministic detector만 호출 (LLM 미사용).
 */
import { detectMeaningfulAppearance, isUpdateAllowed } from "../dist/lib/meaningful_appearance.js";

let pass = 0, fail = 0;
const ok = (s) => { console.log("  ✓ " + s); pass++; };
const ng = (s, d) => { console.error("  ✗ " + s + (d ? " — " + d : "")); fail++; };
const checkLevel = (label, body, name, expected) => {
  const r = detectMeaningfulAppearance(body, name);
  const got = r.level;
  const allowed = isUpdateAllowed(got);
  const expectedAllowed = isUpdateAllowed(expected);
  if (got === expected) {
    ok(`${label} → level=${got} (occ=${r.occurrence_count} S=${r.strong_count} M=${r.medium_count} W=${r.weak_count}) types=[${r.evidence_types.join(",")}]`);
  } else {
    ng(`${label}`,
      `expected ${expected} got ${got} (occ=${r.occurrence_count} S=${r.strong_count} M=${r.medium_count} W=${r.weak_count}) types=[${r.evidence_types.join(",")}] reason=${r.reason}`);
  }
  // update permission는 strong/medium → true, weak/none → false 인지 별도 검증
  if (allowed !== expectedAllowed) {
    ng(`${label} update_allowed`, `expected ${expectedAllowed} got ${allowed}`);
  }
};

console.log("── R5B-1.8D Meaningful Appearance Detector ──");

// ─ 케이스 1: 이름만 대사 속에서 5회 언급됨 → weak ──────────────
checkLevel(
  "1. 이름만 대사 속에서 5회 언급",
  `리오는 한숨을 쉬며 말했다.
"카이렌은 떠났다. 카이렌이 돌아오면 다시 보겠다."
"카이렌, 카이렌, 카이렌… 그 이름이 자꾸 떠오른다."`,
  "카이렌",
  "weak",
);

// ─ 케이스 2: 직접 대사 1회 → strong ──────────────────────────
checkLevel(
  "2. 직접 대사 1회 (대사 화자 표시)",
  `방 안에 정적이 흘렀다.
카이렌이 말했다.
"우리는 떠나야 한다."`,
  "카이렌",
  "strong",
);

// ─ 케이스 3: 직접 행동 1회 → strong ──────────────────────────
checkLevel(
  "3. 직접 행동 1회",
  `카이렌이 검을 뽑았다. 그의 손이 떨렸다.`,
  "카이렌",
  "strong",
);

// ─ 케이스 4: 회상 속 이름 반복 → weak (본문 narrative에 직접 행동 없음) ──
// 회상은 한국어 소설에서 보통 별도 문단/큰따옴표/들여쓰기/사선 등으로 처리되지만
// 결정론적 detector는 "현재 시점 narrative"와 "회상 narrative"를 구분하지 못한다.
// 회상 본문이 dialogue quote로 감싸져 있거나, 단순 이름 호명 형태라면 weak로 잡힌다.
// 만약 회상이 본문 narrative 그대로 나오고 직접 행동이 있으면 strong으로 잡히는 것은
// 보수적 false positive(allow update). audit이 catch하면 OK.
checkLevel(
  "4-a. 회상이 dialogue quote로 표시된 케이스",
  `리오는 옛 기억을 떠올렸다.
"카이렌… 그날의 카이렌은 정말 빛났었지. 카이렌이 처음 검을 잡던 그 순간."
리오는 고개를 저었다.`,
  "카이렌",
  "weak",
);

checkLevel(
  "4-b. 단순 호명만 있는 회상 (조사 없음)",
  `리오의 머릿속에 카이렌, 카이렌, 그 이름만이 맴돌았다.`,
  "카이렌",
  "weak",
);

// ─ 케이스 5: 소지품 전달/사용 → strong ────────────────────────
checkLevel(
  "5. 소지품 전달 (직접 행동)",
  `카이렌이 단검을 건넸다. 리오는 그것을 받았다.`,
  "카이렌",
  "strong",
);

// ─ 케이스 6: 위치 이동 서술 → strong ────────────────────────
checkLevel(
  "6. 위치 이동 서술",
  `카이렌이 천천히 방으로 들어왔다. 그의 발걸음 소리가 울렸다.`,
  "카이렌",
  "strong",
);

// ─ 케이스 7: "카이렌은 어디 있지?" → weak ────────────────────
checkLevel(
  "7. 다른 인물이 부재 확인성 호명 (대사 안)",
  `리오가 두리번거렸다.
"카이렌은 어디 있지? 어디로 사라진 거야?"
아무도 대답하지 않았다.`,
  "카이렌",
  "weak",
);

// ─ 추가 케이스: 본문에 이름 없음 → none ──────────────────────
checkLevel(
  "8. 본문에 이름 없음",
  `리오는 혼자 걸었다. 바람이 차가웠다.`,
  "카이렌",
  "none",
);

// ─ 추가 케이스: 직접 행동 + 대사 (혼합) → strong ─────────────
checkLevel(
  "9. 행동 + 대사 (혼합 strong)",
  `카이렌이 일어섰다.
"이제 떠나자."
카이렌이 결심했다.`,
  "카이렌",
  "strong",
);

// ─ 추가 케이스: 인물이 상호작용 대상 (의/에게) → medium ─────
checkLevel(
  "10. 인물이 상호작용 대상 (medium evidence)",
  `리오는 카이렌의 어깨를 두드렸다. 리오가 카이렌에게 검을 건넸다.`,
  "카이렌",
  "medium",
);

// ─ 추가 케이스: dialogue 내부 + 외부 narrative 행동 혼재 → strong ──
checkLevel(
  "11. dialogue 안 + 외부 narrative 행동 혼재",
  `"카이렌은 어디로 갔지?" 리오가 중얼거렸다.
잠시 후 카이렌이 문을 열고 들어왔다.`,
  "카이렌",
  "strong",
);

// ─ 추가 케이스: 짧은 직접 행동 + 다른 caller의 대사 안 호명 → strong (행동 우선) ──
checkLevel(
  "12. 행동 1회 + 다른 화자의 호명 다회",
  `"카이렌, 카이렌!" 리오가 외쳤다.
카이렌이 고개를 돌렸다.`,
  "카이렌",
  "strong",
);

console.log("\n── isUpdateAllowed 정책 ──");
const lvls = ["strong", "medium", "weak", "none"];
const expected = { strong: true, medium: true, weak: false, none: false };
for (const l of lvls) {
  const got = isUpdateAllowed(l);
  if (got === expected[l]) ok(`isUpdateAllowed("${l}") = ${got}`);
  else                     ng(`isUpdateAllowed("${l}")`, `expected ${expected[l]} got ${got}`);
}

console.log("\n" + "─".repeat(60));
const verdict = fail === 0 ? "✅  ALL PASSED" : `❌  ${fail} FAILED`;
console.log(`${verdict} — ${pass + fail} checks (${pass} passed, ${fail} failed)`);
process.exit(fail > 0 ? 1 : 0);
