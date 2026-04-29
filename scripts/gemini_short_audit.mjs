/**
 * gemini_short_audit.mjs
 * Phase 4.6 clean smoke 10화 Gemini short audit
 * Usage: node scripts/gemini_short_audit.mjs --book-id <uuid>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const args = process.argv.slice(2);
const bookIdIdx = args.indexOf("--book-id");
const BOOK = bookIdIdx !== -1 ? args[bookIdIdx + 1] : null;
if (!BOOK) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`Gemini API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no response)";
}

async function run() {
  const epRes = await pool.query(
    `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
    [BOOK]
  );
  await pool.end();

  const episodes = epRes.rows;
  const summary = episodes.map(e =>
    `=== ${e.episode_number}화 ===\n${e.content.slice(0, 1200)}`
  ).join("\n\n");

  const prompt = `당신은 한국어 소설 편집자입니다. 아래는 10화로 구성된 AI 생성 한국어 소설의 전체 내용입니다.

[감사 목적]
이 소설은 "Phase 4.6 clean smoke" 테스트로 생성된 것입니다. 로컬 LLM(gemma3:12b)으로 생성됐으며, 파이프라인 수정 후 품질이 실제로 회복됐는지 판단하는 것이 목적입니다.

[소설 내용]
${summary}

[감사 항목 — 각 항목마다 YES/PARTIALLY/NO + 한두 줄 근거 제시]

1. 각 화가 직전 화에서 실제로 전진하는가? (단순 반복/제자리가 아닌 사건/상황의 진행)
2. 같은 감정(공포/혼란/불안)이 3화 이상 연속으로 반복되는가?
3. 소지품과 위치가 일관되게 유지되는가? (이준서의 설계도/손전등, 한유리의 측정 장치, 오민혁의 마스터 키, 서채린의 카메라/메모장)
4. 복선(설계도 이상, 오민혁의 비밀, 시간 균열 패턴)이 키워드 재등장이 아닌 의미 있는 방식으로 이어지는가?
5. 인물 상태와 목표가 화수에 따라 누적/변화되는가? (4명 모두 각자 역할 수행 중인가)
6. 외국어 조각, 깨진 토큰, 비한국어 문자가 보이는가?
7. 독자 몰입을 깨는 구조적 문제(갑작스러운 점프, 설명 없는 장면 전환, 캐릭터 일관성 붕괴)가 있는가?
8. 과도한 제약 때문에 문장이 부자연스럽거나 전개가 빈약한가? (LLM이 규칙 회피에 집중해 창작이 빈약해진 흔적)

[최종 판정]
판정 기준:
- PASS: 전반적으로 읽을 수 있는 수준, 구조 문제 없음, 30화 진행 가능
- CONDITIONAL PASS: 몇 가지 약점 있지만 핵심 구조는 작동, 개선하며 30화 진행 가능
- WARN: 뚜렷한 반복/품질 저하 있음, 30화 전 추가 수정 권장
- FAIL: 구조 붕괴, 인물 일관성 없음, 외국어 오염 다수, 30화 진행 불가

감사 결과를 위 형식대로 작성하고, 마지막에 판정 한 줄로 마무리해라.`;

  console.log("\n═══════════════════════════════════════════════════════");
  console.log(" GEMINI SHORT AUDIT — Phase 4.6 Clean 10EP Smoke");
  console.log(`═══════════════════════════════════════════════════════\n`);

  const result = await callGemini(prompt);
  console.log(result);

  console.log("\n═══════════════════════════════════════════════════════");
}

run().catch(e => { console.error(e.message); process.exit(1); });
