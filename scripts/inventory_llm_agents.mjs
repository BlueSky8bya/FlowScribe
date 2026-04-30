/**
 * inventory_llm_agents.mjs — Phase 4.12 LLM/API 호출 지점 전수조사
 *
 * src/, scripts/ 안의 모든 LLM 호출을 찾아 docs/agent-routing-inventory.md 생성.
 *
 * Usage: node scripts/inventory_llm_agents.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();

// 검색 대상 디렉토리
const SCAN_DIRS = ["src", "scripts"];

// LLM 호출 패턴
const LLM_PATTERNS = [
  { name: "getLLMClient",         re: /getLLMClient\(\)/g },
  { name: "chat.completions",     re: /chat\.completions\.create/g },
  { name: "generateContent",      re: /generateContent/g },
  { name: "generativelanguage",   re: /generativelanguage\.googleapis\.com/g },
  { name: "GEMINI_API_KEY",       re: /GEMINI_API_KEY/g },
  { name: "OPENAI_API_KEY",       re: /OPENAI_API_KEY/g },
  { name: "DEEPSEEK_API_KEY",     re: /DEEPSEEK_API_KEY/g },
  { name: "getStoryModel",        re: /getStoryModel\(\)/g },
  { name: "getPlannerModel",      re: /getPlannerModel\(\)/g },
  { name: "getRendererModel",     re: /getRendererModel\(\)/g },
  { name: "getSuggestModel",      re: /getSuggestModel\(\)/g },
  { name: "getSummaryModel",      re: /getSummaryModel\(\)/g },
];

// 디렉토리 walk
function walk(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, results);
    else if (/\.(ts|mjs|js)$/.test(entry) && !entry.endsWith(".d.ts")) results.push(full);
  }
  return results;
}

// 파일별 호출 검출
function scanFile(file) {
  const content = readFileSync(file, "utf8");
  const hits = [];
  for (const p of LLM_PATTERNS) {
    const matches = [...content.matchAll(p.re)];
    if (matches.length) hits.push({ pattern: p.name, count: matches.length });
  }
  return hits;
}

// agent_id 추론 — 파일명/패턴 기반
function inferAgentId(file, hits) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const fname = rel.split("/").pop().replace(/\.(ts|mjs|js)$/, "");
  const dir = rel.split("/").slice(-2, -1)[0] ?? "";

  // suggest 류
  if (rel.includes("/api/suggest")) return "suggestion (multiple sub-agents)";
  if (rel.includes("/api/books")) return "books_meta_suggest";
  if (fname === "planner" || rel.includes("planner")) return "planner";
  if (fname === "renderer") return "renderer";
  if (fname === "state_extractor") return "state_extractor";
  if (fname === "narrative_coherence") return "narrative_repair_judge";
  if (fname === "foreshadow") return "foreshadow_extractor + foreshadow_resolver";
  if (fname === "arc_memory") return "arc_summary_writer";
  if (fname.includes("validator")) return "post_validator";
  if (fname.includes("revision")) return "post_revision";
  if (fname.includes("item_desc")) return "item_description_generator";
  if (fname.includes("name_classifier")) return "name_classifier";
  if (fname.includes("character_state")) return "character_state_helpers";
  if (rel.startsWith("scripts/gemini_reader_immersion")) return "reader_immersion_judge_gemini";
  if (rel.startsWith("scripts/audit_knowledge_boundaries")) return "knowledge_boundary_judge";
  if (rel.startsWith("scripts/audit_action_affordance")) return "action_affordance_judge";
  if (rel.startsWith("scripts/audit_dialogue")) return "dialogue_repetition_audit (deterministic)";
  if (rel.startsWith("scripts/")) return `script:${fname}`;
  return `unknown:${fname}`;
}

// route 가능 여부 추론
function inferRouteable(file, hits, agentId) {
  if (agentId.startsWith("script:") || agentId.startsWith("unknown:")) return false;
  // judge 스크립트도 기본 OK
  if (hits.length === 0) return false;
  return true;
}

// task type 추론
function inferTaskType(agentId) {
  if (agentId.includes("suggest")) return "SUGGESTION_LIGHT";
  if (agentId === "planner") return "PLANNER_LONG_CONTEXT";
  if (agentId === "renderer") return "RENDERER_CREATIVE";
  if (agentId === "state_extractor") return "STATE_EXTRACTION";
  if (agentId.includes("repair")) return "POSTPROCESS_REPAIR";
  if (agentId.includes("foreshadow")) return "FORESHADOW_REASONING";
  if (agentId.includes("arc")) return "MEMORY_SUMMARY";
  if (agentId.includes("item")) return "ITEM_DESCRIPTION";
  if (agentId.includes("immersion_judge") || agentId.includes("knowledge_boundary") || agentId.includes("action_affordance")) return "READER_IMMERSION_JUDGE";
  if (agentId.includes("validator")) return "POSTPROCESS_REPAIR";
  if (agentId.includes("name_classifier")) return "STATE_EXTRACTION";
  return "UNKNOWN";
}

// ── 실행 ─────────────────────────────────────────────────────
const allFiles = SCAN_DIRS.flatMap(d => walk(d));
const inventory = [];
for (const f of allFiles) {
  const hits = scanFile(f);
  if (hits.length === 0) continue;
  const agentId = inferAgentId(f, hits);
  const routeable = inferRouteable(f, hits, agentId);
  const taskType = inferTaskType(agentId);
  inventory.push({
    file: relative(ROOT, f).replace(/\\/g, "/"),
    agent_id: agentId,
    task_type: taskType,
    routeable,
    patterns: hits.map(h => `${h.pattern}×${h.count}`).join(", "),
  });
}

// 정렬
inventory.sort((a, b) => a.file.localeCompare(b.file));

// 통계
const totalAgents = inventory.length;
const routeable = inventory.filter(i => i.routeable).length;
const taskCounts = {};
for (const i of inventory) taskCounts[i.task_type] = (taskCounts[i.task_type] ?? 0) + 1;

// 출력 — 콘솔
const W = 70;
console.log(`\n${"═".repeat(W)}`);
console.log(` LLM Agent Inventory (Phase 4.12)`);
console.log("═".repeat(W));
console.log(`총 호출 파일: ${totalAgents}`);
console.log(`routeable: ${routeable} | non-routeable: ${totalAgents - routeable}`);
console.log("\nTask type 분포:");
for (const [t, n] of Object.entries(taskCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t}: ${n}`);
}
console.log("\n파일별 detail:");
console.log(`${"file".padEnd(50)} ${"agent_id".padEnd(35)} ${"task_type".padEnd(25)} routeable`);
console.log("-".repeat(W + 50));
for (const i of inventory) {
  const file = i.file.length > 48 ? "…" + i.file.slice(-47) : i.file;
  const aid = i.agent_id.length > 33 ? i.agent_id.slice(0, 33) + "…" : i.agent_id;
  console.log(`${file.padEnd(50)} ${aid.padEnd(35)} ${i.task_type.padEnd(25)} ${i.routeable}`);
}

// 출력 — markdown
if (!existsSync("docs")) mkdirSync("docs", { recursive: true });
const md = [
  "# LLM Agent Routing Inventory (Phase 4.12)",
  "",
  `생성: ${new Date().toISOString()}`,
  "",
  `## 요약`,
  `- 총 호출 파일: **${totalAgents}**`,
  `- routeable: **${routeable}**`,
  `- non-routeable (audit/script): ${totalAgents - routeable}`,
  "",
  `## Task Type 분포`,
  ...Object.entries(taskCounts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `- ${t}: ${n}`),
  "",
  `## 파일별 inventory`,
  "",
  `| file | agent_id | task_type | routeable | patterns |`,
  `|------|----------|-----------|-----------|----------|`,
  ...inventory.map(i => `| \`${i.file}\` | ${i.agent_id} | ${i.task_type} | ${i.routeable} | ${i.patterns} |`),
];
writeFileSync("docs/agent-routing-inventory.md", md.join("\n"), "utf8");
console.log(`\n✅ docs/agent-routing-inventory.md 작성 완료`);
console.log(`${"═".repeat(W)}\n`);
