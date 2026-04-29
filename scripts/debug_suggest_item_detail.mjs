/**
 * debug_suggest_item_detail.mjs
 * suggest item_detail / item_refine 전체 경로 디버깅
 *
 * 사용법:
 *   node scripts/debug_suggest_item_detail.mjs --target item_detail --item "좌표의 지팡이" --character "리아"
 *   node scripts/debug_suggest_item_detail.mjs --target item_refine --item "좌표의 지팡이" --description "좌표를 찾는 지팡이" --character "리아"
 *
 * GEMINI_API_KEY 출력 금지 — 키 존재 여부만 표시
 */

import { readFileSync, existsSync } from "fs";
import { createRequire } from "module";
import * as path from "path";
import * as url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

// .env 로드 (dotenv 없이)
const envPath = path.join(projectRoot, ".env");
if (existsSync(envPath)) {
  const envLines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of envLines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// CLI args
const args = {};
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    args[key] = process.argv[i + 1] ?? "";
    i++;
  }
}

const target      = args.target      || "item_detail";
const itemName    = args.item        || "마법 지팡이";
const charName    = args.character   || "주인공";
const charType    = args.type        || "마법사";
const charGender  = args.gender      || "여성";
const personality = args.personality || "침착하고 분석적인 성향";
const existDesc   = args.description || "";
const existCat    = args.category    || "";
const settings    = (args.settings   || "판타지, 마법 학원").split(",").map(s => s.trim());
const moods       = (args.moods      || "미스터리, 성장").split(",").map(s => s.trim());
const rules       = (args.rules      || "마법은 공식에 따라 작동한다").split(",").map(s => s.trim());

// ── 프롬프트 빌드 (suggest.ts 로직 복제) ─────────────────────

function sanitizeItemDescription(desc) {
  if (!desc) return desc;
  return desc
    .replace(/\d+\s*자\s*(이내|내외|이상|이하|정도)/g, "")
    .replace(/^(설명|출력|결과|답변|내용)\s*[:：]\s*/i, "")
    .replace(/\bJSON\b/gi, "")
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
}

function buildItemDetailPrompt() {
  const ruleStr = rules.slice(0, 3).join(" / ") || "없음";
  const existDescLine = existDesc ? `현재 설명: ${existDesc}` : "";
  const existCatLine  = existCat  ? `현재 카테고리: ${existCat}` : "";
  return `당신은 한국 소설 세계관 설정 AI입니다.

배경/세계관: ${settings.join(", ")}
장르/분위기: ${moods.join(", ")}
세계관 규칙: ${ruleStr}
인물 이름: ${charName}
인물 유형: ${charType}
인물 성별: ${charGender}
인물 성격: ${personality.slice(0, 150)}
소지품 이름: ${itemName}
${existDescLine}
${existCatLine}

위 세계관과 인물에 어울리는 소지품 정보를 추천해 주세요.
규칙:
- description: 40~120자 한국어, 이 소지품의 서사적 의미나 용도를 자연스럽게 서술
- category: 무기/방어구/마법/의복/도구/소모품/귀중품/문서 중 적합한 것
- badge_label: category와 같거나 더 짧은 1~3자 표시 레이블
- 이미 입력된 값(있으면 위에 표시됨)은 그대로 두고 빈 항목만 채워주세요.
- name은 절대 바꾸지 마세요.
- description에 "XX자 이내", "JSON", "설명:", "출력:" 같은 지시문/메타 표현을 포함하지 마세요.

반드시 아래 JSON 형식만 출력 (다른 텍스트 금지):
{"item": {"name": "${itemName}", "description": "한국어 설명", "category": "도구", "badge_label": "도구"}}`;
}

function buildItemRefinePrompt() {
  const ruleStr = rules.slice(0, 3).join(" / ") || "없음";
  return `당신은 한국 소설 세계관 설정 AI입니다.
기존 소지품 설명을 세계관에 맞게 더 구체적으로 다듬어 주세요.

배경/세계관: ${settings.join(", ")}
장르/분위기: ${moods.join(", ")}
세계관 규칙: ${ruleStr}
인물 이름: ${charName}
인물 성격: ${personality.slice(0, 150)}
소지품 이름: ${itemName}
현재 설명: ${existDesc || "(없음)"}
현재 카테고리: ${existCat || "(없음)"}

규칙:
- 소지품 이름(name)은 절대 변경하지 마세요.
- 기존 설명의 핵심 의미를 살리면서 더 구체적이고 생생하게 다듬어 주세요.
- description: 40~120자 한국어, 이 소지품이 서사에서 갖는 의미/용도/특징
- description에 "XX자 이내", "JSON", "설명:", "출력:" 같은 지시문/메타 표현을 포함하지 마세요.
- 이미 좋은 category/badge_label이 있으면 그대로 유지해도 됩니다.

반드시 아래 JSON 형식만 출력 (다른 텍스트 금지):
{"item": {"name": "${itemName}", "description": "개선된 한국어 설명", "category": "도구", "badge_label": "도구"}}`;
}

// ── Gemini 호출 ───────────────────────────────────────────────

async function callGemini(prompt) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const keyPresent = !!(geminiKey && geminiKey.length > 10);

  if (!keyPresent) {
    return { ok: false, provider: "none", error: "GEMINI_API_KEY 없음" };
  }

  const model = "gemini-2.5-flash-lite";
  console.log(`\n[provider] Gemini / model: ${model}`);
  console.log(`[GEMINI_API_KEY] 존재: ${keyPresent} (값 출력 금지)`);

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
      }),
    }
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { ok: false, provider: "gemini", status: resp.status, error: body.slice(0, 300) };
  }

  const data = await resp.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return { ok: true, provider: "gemini", status: resp.status, raw };
}

// ── 파서 ─────────────────────────────────────────────────────

function parseItemResponse(raw, itemNameOrig) {
  const cleaned = raw.replace(/^```[\w]*\n?/gm, "").replace(/```$/gm, "").trim();
  let parsed = null;
  let parseOk = false;
  try {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? "{}");
    parseOk = true;
  } catch (e) {
    return { ok: false, parseOk: false, error: String(e) };
  }

  if (!parsed?.item?.name) {
    return { ok: false, parseOk, parsed, error: "item.name 없음" };
  }

  const item = parsed.item;
  const descRaw = String(item.description || "");
  const descSanitized = sanitizeItemDescription(descRaw);

  return {
    ok: true,
    parseOk,
    name: String(itemNameOrig || item.name || ""),
    descRaw,
    descSanitized,
    descChanged: descRaw !== descSanitized,
    category: String(item.category || ""),
    badge_label: String(item.badge_label || item.category || ""),
  };
}

// ── 메인 실행 ─────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(60));
  console.log(`[debug_suggest_item_detail.mjs]`);
  console.log(`  target:      ${target}`);
  console.log(`  item:        ${itemName}`);
  console.log(`  character:   ${charName} (${charType}/${charGender})`);
  console.log(`  personality: ${personality.slice(0, 60)}`);
  if (existDesc) console.log(`  existing desc: ${existDesc}`);
  console.log("═".repeat(60));

  // 1. 프롬프트 빌드
  const prompt = target === "item_refine" ? buildItemRefinePrompt() : buildItemDetailPrompt();
  console.log("\n── 1. PROMPT (마지막 5줄) ──");
  const promptLines = prompt.split("\n");
  console.log(promptLines.slice(-5).map(l => `  ${l}`).join("\n"));

  // 2. API 호출
  console.log("\n── 2. API 호출 ──");
  const callResult = await callGemini(prompt);

  if (!callResult.ok) {
    console.error(`  [ERROR] ${callResult.error}`);
    console.log("\n결론: API 호출 실패 — Gemini 키 확인 필요");
    process.exit(1);
  }

  // 3. raw response
  const rawLen = callResult.raw.length;
  console.log(`\n── 3. RAW RESPONSE (${rawLen}자) ──`);
  console.log("  " + callResult.raw.slice(0, 500).replace(/\n/g, "\n  "));

  // 4. parse + sanitize
  console.log("\n── 4. PARSE + SANITIZE ──");
  const parseResult = parseItemResponse(callResult.raw, itemName);

  if (!parseResult.ok) {
    console.error(`  [PARSE ERROR] ${parseResult.error}`);
    if (parseResult.parsed) console.log("  parsed:", JSON.stringify(parseResult.parsed).slice(0, 200));
    process.exit(1);
  }

  console.log(`  parse OK: ${parseResult.parseOk}`);
  console.log(`  name:        ${parseResult.name}`);
  console.log(`  desc (raw):  ${parseResult.descRaw}`);
  console.log(`  desc (clean):${parseResult.descSanitized}`);
  if (parseResult.descChanged) {
    console.log(`  ⚠ sanitize 적용됨 (지시문 제거)`);
  }
  console.log(`  category:    ${parseResult.category}`);
  console.log(`  badge_label: ${parseResult.badge_label}`);

  // 5. 성공 기준 검증
  console.log("\n── 5. 성공 기준 검증 ──");
  const checks = [
    ["item.name 있음",           !!parseResult.name],
    ["item.description 있음",    !!parseResult.descSanitized],
    ["item.category 있음",       !!parseResult.category],
    ["지시문 없음 (15자 이내 등)", !/\d+자\s*(이내|내외|이상)/.test(parseResult.descSanitized)],
    ["name 변경 없음",           parseResult.name === itemName],
    ["description 40자 이상",    parseResult.descSanitized.length >= 20],
  ];

  let allOk = true;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) allOk = false;
  }

  console.log("\n" + "═".repeat(60));
  console.log(allOk ? "✅ 전체 경로 정상" : "❌ 일부 검증 실패");
  process.exit(allOk ? 0 : 1);
}

main().catch(e => {
  console.error("[FATAL]", e);
  process.exit(1);
});
