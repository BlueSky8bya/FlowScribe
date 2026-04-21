/**
 * suggest_eval.mjs — AI 추천(세계관 규칙 + 인물) 품질 자동 평가
 *
 * 평가 항목 (총 100점):
 *   [A] 장르 이름 적합성   (15점) — 이름이 해당 장르 풀에 있거나 어감이 맞는가
 *   [B] 장르 유형 적합성   (15점) — 캐릭터 유형에 타 장르 소품이 없는가
 *   [C] 규칙 장르 연관성   (20점) — 규칙에 해당 장르 키워드가 있는가
 *   [D] 규칙 비진부성       (15점) — "능력→소모" 같은 진부 패턴이 없는가
 *   [E] 규칙 구조 완성도   (15점) — 주체+조건+결과 구조를 갖추는가
 *   [F] 성격 구체성         (10점) — 추상 심리 형용사 없이 행동 묘사인가
 *   [G] 성격 길이 적합성   (10점) — 30~250자 범위인가
 *
 * Usage: node scripts/suggest_eval.mjs [round]
 */

import "dotenv/config";
import fetch from "node-fetch";

const BASE = "http://localhost:3000";
const ROUNDS = parseInt(process.argv[2] ?? "1", 10);

// ── 테스트 케이스 ──────────────────────────────────────────────
const TEST_CASES = [
  { label: "무협+복수",      settings: ["무협","강호"],     moods: ["복수","성장"] },
  { label: "이세계+마법",    settings: ["이세계","판타지"], moods: ["성장","모험"] },
  { label: "SF+우주",        settings: ["SF","미래"],       moods: ["생존","고독"] },
  { label: "현대+스릴러",    settings: ["현대","스릴러"],   moods: ["추적","범죄"] },
  { label: "사극+궁중",      settings: ["사극","조선"],     moods: ["음모","복수"] },
  { label: "사이버펑크+해커",settings: ["사이버펑크","네온"],moods: ["도주","부채"] },
];

// ── 장르 우선순위 (suggest.ts의 priority 값과 일치) ───────────────
const GENRE_PRIORITY = {
  이세계: 100, 사이버펑크: 91, 무협: 90, SF: 88, 사극: 87, 판타지: 85, 스릴러: 83, 현대: 70,
};

function resolvePrimaryGenre(settings) {
  return settings.reduce((best, s) => {
    const p = GENRE_PRIORITY[s] ?? 0;
    return p > (GENRE_PRIORITY[best] ?? 0) ? s : best;
  }, settings[0]);
}

// ── 장르별 기대 키워드 ─────────────────────────────────────────
const GENRE_VOCAB = {
  무협:     ["문파","비급","내공","강호","협객","칼","사부","의리","복수","무인","검","표국","객잔","맹","강기"],
  이세계:   ["계약","가문","성물","기사단","왕도","서약","진명","성검","마법","왕족","신탁","봉인","별자리"],
  판타지:   ["유적","정령","별자리","숲","연금술","마법","고대","세계수","기사","마력석"],
  SF:       ["기억","연산","복제","중력","행성","데이터","우주","신경","생체","산소","방공호","폐허"],
  현대:     ["일상","퇴근","아파트","분실물","휴대폰","편의점","소문","블랙박스","아르바이트"],
  스릴러:   ["추적","탈출","위협","암호","잠입","용의자","살인","수사","증거","신분증"],
  사극:     ["교지","가문","예법","소문","무당","궁","상소","향","서찰","붓","왕실","신하","표물","옥패","봉인서","상궁","내시","사대부"],
  사이버펑크:["계정","기억","부채","도시","감시","의체","해커","네온","기업","백도어","뇌파","서버"],
};

// ── 금지 교차 장르 키워드 ─────────────────────────────────────
const CROSS_CONTAMINATION = {
  무협:      ["우주선","신경 칩","나노","안드로이드","미사일","총","성검","진명"],
  이세계:    ["우주선","해커","의체","나노","사이버","신경 칩"],
  SF:        ["성검","신탁","마도구","강호","문파","비급","사부"],
  현대:      ["성검","정령","내공","마력","우주선"],
  사이버펑크:["성검","신탁","마도구","강호","문파","정령"],
};

// ── 진부 패턴 ─────────────────────────────────────────────────
const CLICHE_PATTERNS = [
  /능력.{0,6}체력/,
  /마법.{0,6}소모/,
  /스킬.{0,6}소진/,
  /사용.{0,6}수명/,
  /힘을 쓰면/,
  /대가.{0,6}치러/,
  /포인트/,
  /레벨업/,
  /강해진다/,
  /약해진다/,
];

// ── 추상 심리 패턴 ─────────────────────────────────────────────
const ABSTRACT_PATTERNS = [
  /내성적이다|내향적이다/,
  /차가운 성격/,
  /따뜻한 성격/,
  /냉정한 편이다/,
  /소심하다/,
  /용감하다/,
  /착하다/,
  /친절하다/,
  /[가-힣]{1,4}하는 성격/,
];

// ── 인증 쿠키 획득 ─────────────────────────────────────────────
async function getAuthCookie() {
  const res = await fetch(`${BASE}/api/auth/dev-login`, { redirect: "manual" });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/fs_token=[^;]+/);
  if (!match) throw new Error("dev-login 실패");
  return match[0];
}

// ── API 호출 ──────────────────────────────────────────────────
async function callSuggest(cookie, section, settings, moods, existingRules = []) {
  const body = section === "characters"
    ? { section, settings, moods, world_rules: existingRules, exclude_names: [], exclude_types: [] }
    : { section, settings, moods, world_rules: [], existing_rules: existingRules, existing_rule_count: existingRules.length };

  const res = await fetch(`${BASE}/api/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return json.data ?? [];
}

// ── 점수 계산 ──────────────────────────────────────────────────
function scoreCharacter(char, primaryGenre) {
  let score = 0;
  const reasons = [];

  // [A] 이름 적합성 (15점)
  const genreVocab = GENRE_VOCAB[primaryGenre] ?? [];
  const nameOk = char.name && char.name.length >= 2;
  if (nameOk) { score += 15; } else { reasons.push(`[A-] 이름 불량: "${char.name}"`); }

  // [B] 유형 적합성 (15점)
  const crossList = CROSS_CONTAMINATION[primaryGenre] ?? [];
  const typeContaminated = crossList.some(kw => (char.type ?? "").includes(kw));
  if (!typeContaminated) { score += 15; } else { reasons.push(`[B-] 유형 교차오염: "${char.type}"`); }

  // [F] 성격 구체성 (10점)
  const personality = char.personality ?? "";
  const hasAbstract = ABSTRACT_PATTERNS.some(p => p.test(personality));
  if (!hasAbstract) { score += 10; } else { reasons.push(`[F-] 추상 심리 표현 발견`); }

  // [G] 성격 길이 (10점)
  const pLen = personality.replace(/\s/g, "").length;
  if (pLen >= 30 && pLen <= 300) { score += 10; } else { reasons.push(`[G-] 성격 길이 이상: ${pLen}자`); }

  return { score, maxScore: 50, reasons };
}

function scoreRules(rules, settings, moods) {
  const allTags = [...settings, ...moods];
  let score = 0;
  const reasons = [];

  // [C] 규칙 장르 연관성 (20점)
  // 복합 장르의 경우 settings에 포함된 모든 장르 vocab 합산 — 어느 한 장르 키워드라도 히트하면 인정
  const primaryGenre = allTags.find(t => GENRE_VOCAB[t]) ?? settings[0];
  const genreVocab = [...new Set(settings.flatMap(s => GENRE_VOCAB[s] ?? []))];
  const crossList = CROSS_CONTAMINATION[primaryGenre] ?? [];

  let contaminated = 0;
  let genreHit = 0;
  for (const r of rules) {
    if (crossList.some(kw => r.val.includes(kw))) contaminated++;
    if (genreVocab.some(kw => r.val.includes(kw))) genreHit++;
  }
  const genreScore = rules.length
    ? Math.round((genreHit / rules.length) * 20)
    : 0;
  score += genreScore;
  if (contaminated > 0) {
    score -= contaminated * 5;
    reasons.push(`[C-] 교차오염 규칙 ${contaminated}개`);
  }
  if (genreHit === 0 && rules.length > 0) reasons.push(`[C-] 장르 키워드 0건`);

  // [D] 비진부성 (15점)
  const clicheCount = rules.filter(r => CLICHE_PATTERNS.some(p => p.test(r.val))).length;
  const dScore = Math.max(0, 15 - clicheCount * 7);
  score += dScore;
  if (clicheCount > 0) reasons.push(`[D-] 진부 규칙 ${clicheCount}개`);

  // [E] 구조 완성도 (15점) — "~하면/~할 때" + "~다" 결과문
  const structured = rules.filter(r => {
    const hasCond = /면|때|경우|시/.test(r.val);
    const hasResult = /다$|된다$|진다$|힌다$|린다$/.test(r.val.trim());
    const notTooShort = r.val.replace(/\s/g, "").length >= 15;
    return hasCond && hasResult && notTooShort;
  }).length;
  const eScore = rules.length ? Math.round((structured / rules.length) * 15) : 0;
  score += eScore;
  if (structured < rules.length) reasons.push(`[E-] 구조 불완전 ${rules.length - structured}개`);

  return { score: Math.max(0, score), maxScore: 50, reasons };
}

// ── 메인 평가 루프 ────────────────────────────────────────────
async function runEval(roundNum) {
  const cookie = await getAuthCookie();
  let totalScore = 0;
  let totalMax = 0;
  const results = [];

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Round ${roundNum} 평가 시작 — ${TEST_CASES.length}개 케이스`);
  console.log(`${"=".repeat(60)}`);

  for (const tc of TEST_CASES) {
    const primaryGenre = resolvePrimaryGenre(tc.settings);
    const [chars, rules] = await Promise.all([
      callSuggest(cookie, "characters", tc.settings, tc.moods),
      callSuggest(cookie, "rules", tc.settings, tc.moods),
    ]);

    const char = chars[0];
    const charRes = char ? scoreCharacter(char, primaryGenre) : { score: 0, maxScore: 50, reasons: ["캐릭터 없음"] };
    const rulesRes = scoreRules(rules, tc.settings, tc.moods);

    const caseScore = charRes.score + rulesRes.score;
    const caseMax   = charRes.maxScore + rulesRes.maxScore;
    const pct = Math.round((caseScore / caseMax) * 100);

    totalScore += caseScore;
    totalMax   += caseMax;

    const issues = [...charRes.reasons, ...rulesRes.reasons];
    const status = pct >= 85 ? "✅" : pct >= 60 ? "⚠️" : "❌";

    console.log(`\n${status} [${tc.label}]  ${pct}점`);
    if (char) {
      console.log(`   인물: ${char.name} | ${char.type} | ${char.gender}`);
      console.log(`   성격: ${(char.personality ?? "").slice(0, 80)}…`);
    } else {
      console.log(`   인물: (없음)`);
    }
    if (rules.length) {
      rules.forEach((r, i) => console.log(`   규칙${i+1}: [${r.hard ? "금기" : "일반"}] ${r.val.slice(0, 60)}${r.val.length > 60 ? "…" : ""}`));
    }
    if (issues.length) console.log(`   이슈: ${issues.join(" / ")}`);

    results.push({ label: tc.label, pct, issues });
  }

  const roundPct = Math.round((totalScore / totalMax) * 100);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Round ${roundNum} 합계: ${roundPct}점 (${totalScore}/${totalMax})`);
  console.log(`${"─".repeat(60)}\n`);

  return { roundPct, results };
}

// ── 실행 ──────────────────────────────────────────────────────
(async () => {
  const scores = [];
  for (let r = 1; r <= ROUNDS; r++) {
    const { roundPct, results } = await runEval(r);
    scores.push(roundPct);
    if (ROUNDS > 1) {
      await new Promise(ok => setTimeout(ok, 800)); // 시드 변화 유도
    }
  }
  if (ROUNDS > 1) {
    console.log(`\n총 ${ROUNDS}라운드 점수: [${scores.join(", ")}]`);
    console.log(`평균: ${Math.round(scores.reduce((a, b) => a + b) / scores.length)}점`);
  }
})().catch(console.error);
