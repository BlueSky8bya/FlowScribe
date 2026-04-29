/**
 * gemini_audit_raw.mjs - raw response debug
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();
const { Pool } = require("pg");

const BOOK = process.argv[process.argv.indexOf("--book-id") + 1];
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const epRes = await pool.query(
  `SELECT episode_number, content FROM episodes WHERE book_id=$1 ORDER BY episode_number`,
  [BOOK]
);
await pool.end();

const summary = epRes.rows.map(e =>
  `=== ${e.episode_number}화 ===\n${e.content.slice(0, 1000)}`
).join("\n\n");

const prompt = `당신은 한국어 소설 편집자입니다. 아래는 10화로 구성된 AI 생성 한국어 소설입니다.

[소설]
${summary}

[감사 항목 — 각 항목마다 YES/PARTIALLY/NO + 한두 줄 근거]

1. 각 화가 직전 화에서 실제로 전진하는가?
2. 같은 감정(공포/혼란/불안)이 3화 이상 연속 반복되는가?
3. 소지품과 위치가 일관되는가? (설계도, 측정 장치, 마스터 키, 카메라)
4. 복선(설계도 이상, 오민혁 비밀, 시간 균열)이 의미 있게 이어지는가?
5. 4명 인물이 각자 역할을 수행하며 상태가 누적되는가?
6. 외국어 조각, 깨진 토큰이 보이는가?
7. 독자 몰입을 깨는 구조 문제(급격한 장면 점프, 캐릭터 일관성 붕괴)가 있는가?
8. 과도한 제약으로 문장이 부자연스럽거나 전개가 빈약한가?

[판정] PASS / CONDITIONAL PASS / WARN / FAIL 중 하나와 이유 두 줄.`;

const apiKey = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
const body = {
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
};

const resp = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

if (!resp.ok) {
  console.error("API error:", resp.status, await resp.text());
  process.exit(1);
}

const data = await resp.json();
const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no text)";
const finishReason = data.candidates?.[0]?.finishReason;
console.log("finishReason:", finishReason);
console.log("text length:", text.length);
console.log("\n" + text);
