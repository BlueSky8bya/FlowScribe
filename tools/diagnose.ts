/**
 * FlowScribe 자동 진단 스크립트
 * 실행: npm run diagnose
 *
 * Workflow → Decision → Tool 원칙에 따라 실제 Ollama를 호출해
 * 파이프라인 버그를 사전에 탐지하고 logs/diagnose_*.log에 저장한다.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "../logs/diagnose");
const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1").replace("/v1", "");
const STORY_MODEL   = process.env.STORY_MODEL   ?? "gemma3:27b";
const SUGGEST_MODEL = process.env.SUGGEST_MODEL ?? "llama3.1:8b";
const MODEL = SUGGEST_MODEL;

// ── 체크 결과 타입 ────────────────────────────────────────────
interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  raw?: string;
}

const results: CheckResult[] = [];

function pass(name: string, detail: string, raw?: string) {
  results.push({ name, pass: true, detail, raw });
  console.log(`  ✅ ${name}: ${detail}`);
}

function fail(name: string, detail: string, raw?: string) {
  results.push({ name, pass: false, detail, raw });
  console.error(`  ❌ ${name}: ${detail}`);
}

function warn(name: string, detail: string, raw?: string) {
  results.push({ name, pass: true, detail: `[경고] ${detail}`, raw });
  console.warn(`  ⚠️  ${name}: ${detail}`);
}

// ── Ollama 호출 헬퍼 ─────────────────────────────────────────
async function callOllama(messages: { role: string; content: string }[], numPredict = 600): Promise<string> {
  const body = JSON.stringify({
    model: MODEL,
    think: false,
    stream: false,
    options: { num_predict: numPredict, temperature: 0.85 },
    messages,
  });

  const url = new URL("/api/chat", OLLAMA_BASE);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = (await res.json()) as any;
  return String(data?.message?.content ?? "").trim();
}

// ── 검사 1: Story 생성 품질 ───────────────────────────────────
async function checkStoryGeneration() {
  console.log("\n[1] Story 생성 품질 검사");

  const SYSTEM = `당신은 한국 소설 생성 AI다. 서술과 인물의 대화·독백은 반드시 한국어로 작성하라. 아래 설정대로 1화(300~500자)를 써라. 반드시 완결된 문장으로 끝내라.

인물: 칼시아: 용기사. 성별: 여성. 과묵하고 칼을 늘 닦는다 / 리린: 엘프 마법사. 성별: 여성. 말이 많고 호기심이 강하다
세계관: 서약한 이름은 절대 잊히지 않는다
대명사: 칼시아→그녀/그녀의, 리린→그녀/그녀의

규칙:
- 화 제목은 반드시 "# 1화 - 제목" 형식으로 첫 줄에.
- 핵심 감정 단어 한두 개만 **굵게** 처리. 감정 단어를 단독 문장으로 쓰지 말 것.
- 목록·인용·코드블록 금지.
- 인물 성격과 말투를 일관되게 유지.
- 문장 반복 절대 금지.
- 반드시 완결된 문장으로 끝낼 것.
- 본문만 출력. 설명·주석·JSON·메타 정보 절대 금지.`;

  let raw = "";
  try {
    raw = await callOllama([
      { role: "system", content: SYSTEM },
      { role: "user", content: "1화를 생성해줘." },
    ], 700);
  } catch (e: any) {
    fail("story:생성", `Ollama 호출 실패: ${e.message}`);
    return;
  }

  // 제목 형식
  if (/^# \d+화 - .+/.test(raw)) {
    pass("story:제목형식", "# N화 - 제목 형식 정상");
  } else {
    fail("story:제목형식", "제목 형식 불일치", raw.slice(0, 100));
  }

  // JSON 노출 검사
  if (raw.includes("```json") || raw.includes('{"new_characters"')) {
    fail("story:JSON노출", "본문에 JSON 블록이 노출됨", raw.slice(-200));
  } else {
    pass("story:JSON노출", "JSON 노출 없음");
  }

  // 번호 목록 노출
  if (/\n\d+\.\s/.test(raw)) {
    fail("story:번호목록", "번호 목록이 출력에 포함됨", raw.slice(0, 300));
  } else {
    pass("story:번호목록", "번호 목록 없음");
  }

  // 쓰레기 반복 감지 (3줄 이상 연속 *만)
  const garbageLines = raw.split("\n").filter(l => /^[\s*.\-]+$/.test(l));
  if (garbageLines.length >= 3) {
    fail("story:쓰레기출력", `쓰레기 라인 ${garbageLines.length}개 감지`, raw.slice(-300));
  } else {
    pass("story:쓰레기출력", "쓰레기 반복 없음");
  }

  // 감정 단어 단독 문장 (단어 하나 + 마침표)
  const loneEmotion = raw.split("\n").filter(l => /^[가-힣]{2,5}[.。]$/.test(l.trim()));
  if (loneEmotion.length > 0) {
    fail("story:단독감정어", `단독 감정어 문장 감지: ${loneEmotion.join(", ")}`, raw);
  } else {
    pass("story:단독감정어", "단독 감정어 없음");
  }

  // 완결성: 마지막 줄이 문장 끝 부호로 끝나는지
  const lastLine = raw.trim().split("\n").filter(l => l.trim()).pop() ?? "";
  if (/[.!?。"』]$/.test(lastLine)) {
    pass("story:완결성", `마지막 줄 정상 종결: "${lastLine.slice(-30)}"`);
  } else {
    warn("story:완결성", `마지막 줄 불완전 종결 의심: "${lastLine.slice(-30)}"`, raw);
  }

  // 분량
  const charCount = raw.replace(/\s/g, "").length;
  if (charCount < 100) {
    fail("story:분량", `너무 짧음 (${charCount}자)`);
  } else if (charCount > 2000) {
    warn("story:분량", `예상보다 김 (${charCount}자)`);
  } else {
    pass("story:분량", `${charCount}자`);
  }

  // 한국어 비율
  const koreanChars = (raw.match(/[가-힣]/g) ?? []).length;
  const ratio = raw.length > 0 ? koreanChars / raw.length : 0;
  if (ratio < 0.3) {
    fail("story:한국어비율", `한국어 비율 ${(ratio * 100).toFixed(1)}% — 외국어 과다`);
  } else {
    pass("story:한국어비율", `한국어 비율 ${(ratio * 100).toFixed(1)}%`);
  }
}

// ── 검사 2: Character Suggest 품질 ───────────────────────────
async function checkCharacterSuggest() {
  console.log("\n[2] Character Suggest 품질 검사");

  const SYSTEM_MSG = `Output valid JSON array only. No explanation. No markdown fences. Use Korean Hangul for JSON values whenever possible. Avoid clichés. Keep each character concrete and each rule world-shaping.`;

  const USER_PROMPT = `컨텍스트: 이세계 마법 아카데미
설정 태그: 이세계, 판타지
분위기 태그: 서사적인

이름 선택 규칙 — 반드시 아래 후보 중 하나를 그대로 사용. 목록 외 이름 생성 절대 금지:
- 여성: 아리아 · 엘라라 · 세레인 · 밀레나 · 칼리아
- 남성: 카엘 · 발드릭 · 레온 · 아르덴 · 시리온
- 중성: 루 · 세이 · 벨

유형 후보:
1. 엘프
2. 인간 마법사
3. 타락한 성기사
4. 드래곤 기사
5. 정령

절대 규칙:
- 출력은 JSON 배열만.
- 배열 길이는 1.
- 필드: name, personality, type, gender
- name은 위 이름 후보 목록에서 하나를 그대로 복사할 것. 새 이름 창작 금지.
- personality는 추상 심리 금지. 관찰 가능한 행동, 말투, 취향, 버릇만 1~2문장.
- 인간, 엘프, 기사 등 생물학적 성별이 있는 유형이면 gender는 반드시 남성 또는 여성.
- 인공지능, 정령 같은 존재만 gender를 해당없음으로 허용.

JSON만 출력:
[{"name":"이름","personality":"행동과 취향","type":"유형","gender":"남성|여성|해당없음"}]`;

  let raw = "";
  try {
    raw = await callOllama([
      { role: "system", content: SYSTEM_MSG },
      { role: "user", content: USER_PROMPT },
    ], 250);
  } catch (e: any) {
    fail("suggest:생성", `Ollama 호출 실패: ${e.message}`);
    return;
  }

  // JSON 파싱
  let parsed: any[] = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch {
    fail("suggest:JSON파싱", "응답이 JSON 배열이 아님", raw.slice(0, 200));
    return;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail("suggest:배열길이", "빈 배열 반환");
    return;
  }

  const c = parsed[0];

  // 이름 후보 준수
  const ALLOWED_NAMES = ["아리아","엘라라","세레인","밀레나","칼리아","카엘","발드릭","레온","아르덴","시리온","루","세이","벨"];
  if (ALLOWED_NAMES.includes(c.name)) {
    pass("suggest:이름준수", `후보 목록 내 이름 사용: "${c.name}"`);
  } else {
    fail("suggest:이름준수", `목록 외 이름 생성: "${c.name}"`, raw);
  }

  // 성별 규칙
  if (c.gender === "해당없음" && !["정령","AI","골렘","말하는 동물","디지털 유령","유령"].some(t => (c.type ?? "").includes(t))) {
    fail("suggest:성별규칙", `생물형 유형인데 해당없음: type="${c.type}"`, raw);
  } else {
    pass("suggest:성별규칙", `성별 정상: gender="${c.gender}", type="${c.type}"`);
  }

  // personality 길이
  const pLen = (c.personality ?? "").length;
  if (pLen < 10) {
    fail("suggest:personality길이", `너무 짧음 (${pLen}자): "${c.personality}"`);
  } else if (pLen > 200) {
    warn("suggest:personality길이", `200자 초과 (${pLen}자)`);
  } else {
    pass("suggest:personality길이", `${pLen}자: "${c.personality}"`);
  }

  // personality 추상어 감지
  const ABSTRACT = ["내성적","외향적","차갑다","따뜻하다","친절하다","냉철하다","강하다","용감하다"];
  const found = ABSTRACT.filter(w => (c.personality ?? "").includes(w));
  if (found.length > 0) {
    warn("suggest:personality추상어", `추상 심리어 감지: ${found.join(", ")}`);
  } else {
    pass("suggest:personality추상어", "추상 심리어 없음");
  }
}

// ── 검사 3: Rule Suggest 품질 ─────────────────────────────────
async function checkRuleSuggest() {
  console.log("\n[3] Rule Suggest 품질 검사");

  const SYSTEM_MSG = `Output valid JSON array only. No explanation. No markdown fences. Use Korean Hangul for JSON values whenever possible.`;

  const USER_PROMPT = `설정 태그: 이세계, 판타지
분위기 태그: 서사적인, 계약 중심의
기존 규칙 수: 1
기존 규칙: 서약한 이름은 절대 잊히지 않는다

이번 생성 방식: 계약-대가-구속
방식 설명: 힘을 얻는 방식, 생활형 대가, 어기면 생기는 구속을 연결한다.

목표:
세계관 규칙 2개를 JSON 배열로 생성하라.

절대 규칙:
- 출력은 JSON 배열만.
- 각 원소는 {"val":"...", "hard":false|true}
- val은 한글 중심 자연어 1문장.
- 주체, 조건, 결과가 보이게 써라.
- 최소 한 개는 hard=true.

JSON만 출력:
[{"val":"규칙 문장","hard":false}]`;

  let raw = "";
  try {
    raw = await callOllama([
      { role: "system", content: SYSTEM_MSG },
      { role: "user", content: USER_PROMPT },
    ], 400);
  } catch (e: any) {
    fail("rule:생성", `Ollama 호출 실패: ${e.message}`);
    return;
  }

  let parsed: any[] = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch {
    fail("rule:JSON파싱", "응답이 JSON 배열이 아님", raw.slice(0, 200));
    return;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail("rule:배열길이", "빈 배열 반환");
    return;
  }

  // hard:true 포함 여부
  if (parsed.some(r => r.hard === true)) {
    pass("rule:hard포함", "hard=true 규칙 포함");
  } else {
    fail("rule:hard포함", "hard=true 규칙이 없음", raw);
  }

  // val 길이 및 주어-결과 구조
  for (const r of parsed) {
    const val: string = r.val ?? "";
    if (val.length < 10) {
      fail("rule:val길이", `규칙이 너무 짧음 (${val.length}자): "${val}"`);
    } else {
      pass("rule:val길이", `${val.length}자: "${val.slice(0, 50)}..."`);
    }
    // 금지된 진부한 패턴
    const CLICHE = ["체력이 소모된다","수명이 줄어든다","마나가 소모된다"];
    const hit = CLICHE.find(p => val.includes(p));
    if (hit) {
      warn("rule:진부한패턴", `진부한 규칙 패턴 감지: "${hit}"`);
    }
  }
}

// ── 검사 4: Refine 품질 ───────────────────────────────────────
async function checkRefine() {
  console.log("\n[4] Personality Refine 품질 검사");

  const SYSTEM_MSG = `Output valid JSON only. No explanation. No markdown. Use Korean Hangul.`;

  const USER_PROMPT = `인물 정보:
- 이름: 칼시아
- 유형: 용기사
- 성별: 여성
- 설정: 이세계, 판타지

현재 성격·특징:
"과묵하고 차갑다"

위 인물의 성격·특징 묘사를 더 구체화하라.
규칙:
- 기존 묘사의 핵심 인상을 유지하면서 관찰 가능한 행동·말투·버릇·취향을 추가
- 추상적 심리 표현은 구체적 행동으로 변환
- 20~80자 한국어, 자연스러운 1~2문장
- 출력: {"val":"..."}`;

  let raw = "";
  try {
    raw = await callOllama([
      { role: "system", content: SYSTEM_MSG },
      { role: "user", content: USER_PROMPT },
    ], 200);
  } catch (e: any) {
    fail("refine:생성", `Ollama 호출 실패: ${e.message}`);
    return;
  }

  // JSON 파싱
  let val = "";
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    val = String(parsed?.val ?? "");
  } catch {
    fail("refine:JSON파싱", "응답이 JSON 오브젝트가 아님", raw.slice(0, 200));
    return;
  }

  if (val.length < 10) {
    fail("refine:길이", `너무 짧음 (${val.length}자): "${val}"`);
  } else {
    pass("refine:길이", `${val.length}자: "${val}"`);
  }

  // 기존 추상어가 구체어로 변환됐는지
  if (val.includes("과묵하고 차갑다")) {
    warn("refine:변환", "원문이 그대로 반환됨 (구체화 미적용)");
  } else {
    pass("refine:변환", "원문과 다른 구체적 묘사 생성");
  }
}

// ── 메인 실행 ─────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  console.log("━━━ FlowScribe 자동 진단 ━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`모델: ${MODEL}  |  Ollama: ${OLLAMA_BASE}`);
  console.log(`시작: ${new Date().toLocaleString("ko-KR")}`);

  await checkStoryGeneration();
  await checkCharacterSuggest();
  await checkRuleSuggest();
  await checkRefine();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const passCount = results.filter(r => r.pass).length;
  const failCount = results.filter(r => !r.pass).length;

  console.log("\n━━━ 결과 요약 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`총 ${results.length}개 체크  ✅ ${passCount}개 통과  ❌ ${failCount}개 실패  (${elapsed}s)`);

  const failures = results.filter(r => !r.pass);
  if (failures.length > 0) {
    console.log("\n[실패 항목]");
    for (const f of failures) {
      console.error(`  ❌ ${f.name}: ${f.detail}`);
      if (f.raw) console.error(`     RAW: ${f.raw.slice(0, 120)}`);
    }
  }

  // 로그 저장
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `diagnose_${timestamp}.log`);
  const logContent = [
    `FlowScribe 진단 리포트 — ${new Date().toLocaleString("ko-KR")}`,
    `모델: ${MODEL} | 총 ${results.length}개 | 통과 ${passCount} | 실패 ${failCount} | ${elapsed}s`,
    "",
    ...results.map(r => `[${r.pass ? "PASS" : "FAIL"}] ${r.name}: ${r.detail}${r.raw ? "\n  RAW: " + r.raw.slice(0, 300) : ""}`),
  ].join("\n");
  fs.writeFileSync(logPath, logContent, "utf8");
  console.log(`\n📄 로그 저장: ${logPath}`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => { console.error("진단 실행 오류:", e); process.exit(1); });
