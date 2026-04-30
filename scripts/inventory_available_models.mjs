/**
 * inventory_available_models.mjs — Phase 4.14C 사용 가능 모델 전수조사
 *
 * - ollama list로 로컬 모델
 * - Gemini / OpenAI / DeepSeek API에 작은 dry-run 호출
 *
 * API key는 절대 출력하지 않음.
 *
 * Usage: node scripts/inventory_available_models.mjs
 */
import { createRequire } from "module";
import https from "https";
import { writeFileSync, mkdirSync, existsSync } from "fs";

const require = createRequire(import.meta.url);
require("dotenv").config();

const W = 75;
const matrix = [];

function record(o) { matrix.push(o); }

// ── ollama list ────────────────────────────────────────────────
async function listOllama() {
  const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  return new Promise((resolve) => {
    const u = new URL("/api/tags", baseURL.replace(/\/v1$/, ""));
    const http = u.protocol === "https:" ? require("https") : require("http");
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: "GET",
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve((j.models ?? []).map(m => m.name));
        } catch { resolve([]); }
      });
    });
    req.on("error", () => resolve([]));
    req.on("timeout", () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// ── ollama dry-run (small prompt) ────────────────────────────
async function ollamaDryRun(model) {
  const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "한국어로 단어 하나만 출력해라: 안녕." }],
    temperature: 0.1, max_tokens: 30, stream: false,
  });
  const u = new URL("/v1/chat/completions", baseURL.replace(/\/v1$/, ""));
  const http = u.protocol === "https:" ? require("https") : require("http");
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => {
        const elapsed = Date.now() - t0;
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const text = j.choices?.[0]?.message?.content ?? "";
          resolve({ ok: res.statusCode === 200 && text.length > 0, latency_ms: elapsed, text_len: text.length });
        } catch { resolve({ ok: false, latency_ms: elapsed, error: "parse" }); }
      });
    });
    req.on("error", e => resolve({ ok: false, latency_ms: Date.now()-t0, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, latency_ms: Date.now()-t0, error: "timeout" }); });
    req.write(body); req.end();
  });
}

// ── OpenAI-compatible dry-run (deepseek/openai) ──────────────
async function openaiCompatDryRun(model, host, key, path = "/v1/chat/completions") {
  if (!key || key.length < 8) return { ok: false, error: "no_api_key" };
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "한국어로 한 단어만: 안녕." }],
    temperature: 0.1, max_tokens: 20,
  });
  const t0 = Date.now();
  return new Promise((resolve) => {
    const req = https.request({
      hostname: host, path, method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => {
        const elapsed = Date.now() - t0;
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const text = j.choices?.[0]?.message?.content ?? "";
          resolve({ ok: res.statusCode === 200 && text.length > 0, latency_ms: elapsed, text_len: text.length, error: j.error?.message });
        } catch { resolve({ ok: false, latency_ms: elapsed, error: "parse" }); }
      });
    });
    req.on("error", e => resolve({ ok: false, latency_ms: Date.now()-t0, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, latency_ms: Date.now()-t0, error: "timeout" }); });
    req.write(body); req.end();
  });
}

// ── Gemini dry-run ────────────────────────────────────────────
async function geminiDryRun(model) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "no_api_key" };
  const body = JSON.stringify({
    contents: [{ parts: [{ text: "한국어 단어 하나: 안녕." }] }],
    generationConfig: { maxOutputTokens: 30, temperature: 0.1 },
  });
  const t0 = Date.now();
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${model}:generateContent?key=${key}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => {
        const elapsed = Date.now() - t0;
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const text = j.candidates?.[0]?.content?.parts?.find(p => !p.thought && p.text)?.text ?? "";
          resolve({ ok: res.statusCode === 200 && text.length > 0, latency_ms: elapsed, text_len: text.length, error: j.error?.message });
        } catch { resolve({ ok: false, latency_ms: elapsed, error: "parse" }); }
      });
    });
    req.on("error", e => resolve({ ok: false, latency_ms: Date.now()-t0, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, latency_ms: Date.now()-t0, error: "timeout" }); });
    req.write(body); req.end();
  });
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(W)}\n Phase 4.14C — Model Availability Inventory\n${"═".repeat(W)}\n`);

  // 1. Local ollama
  console.log("[A] Local (ollama) 모델 조회...");
  const ollamaModels = await listOllama();
  if (!ollamaModels.length) console.log("  ⚠ ollama 응답 없음 또는 빈 목록");
  for (const m of ollamaModels) {
    process.stdout.write(`  ${m.padEnd(35)} dry-run... `);
    const r = await ollamaDryRun(m);
    if (r.ok) console.log(`✓ ${r.latency_ms}ms`);
    else console.log(`✗ ${r.error ?? "fail"}`);
    record({ provider: "ollama", model: m, available: true, dry_run_ok: r.ok, latency_ms: r.latency_ms, error: r.error });
  }

  // 2. Gemini
  console.log("\n[B] Gemini API 모델 dry-run...");
  const geminiCandidates = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
  for (const m of geminiCandidates) {
    process.stdout.write(`  ${m.padEnd(35)} dry-run... `);
    const r = await geminiDryRun(m);
    if (r.ok) console.log(`✓ ${r.latency_ms}ms`);
    else console.log(`✗ ${r.error ?? "fail"}`);
    record({ provider: "gemini", model: m, available: process.env.GEMINI_API_KEY ? true : false, dry_run_ok: r.ok, latency_ms: r.latency_ms, error: r.error });
  }

  // 3. OpenAI
  console.log("\n[C] OpenAI API 모델 dry-run...");
  const openaiCandidates = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"];
  for (const m of openaiCandidates) {
    process.stdout.write(`  ${m.padEnd(35)} dry-run... `);
    const r = await openaiCompatDryRun(m, "api.openai.com", process.env.OPENAI_API_KEY);
    if (r.ok) console.log(`✓ ${r.latency_ms}ms`);
    else console.log(`✗ ${(r.error ?? "fail").slice(0, 50)}`);
    record({ provider: "openai", model: m, available: process.env.OPENAI_API_KEY ? true : false, dry_run_ok: r.ok, latency_ms: r.latency_ms, error: r.error });
  }

  // 4. DeepSeek
  console.log("\n[D] DeepSeek API 모델 dry-run...");
  const deepseekCandidates = ["deepseek-chat", "deepseek-reasoner"];
  for (const m of deepseekCandidates) {
    process.stdout.write(`  ${m.padEnd(35)} dry-run... `);
    const r = await openaiCompatDryRun(m, "api.deepseek.com", process.env.DEEPSEEK_API_KEY);
    if (r.ok) console.log(`✓ ${r.latency_ms}ms`);
    else console.log(`✗ ${(r.error ?? "fail").slice(0, 50)}`);
    record({ provider: "deepseek", model: m, available: process.env.DEEPSEEK_API_KEY ? true : false, dry_run_ok: r.ok, latency_ms: r.latency_ms, error: r.error });
  }

  // ── docs/model-availability-matrix.md 작성 ──
  if (!existsSync("docs")) mkdirSync("docs", { recursive: true });
  const md = [
    "# Phase 4.14C — Model Availability Matrix",
    "",
    `생성: ${new Date().toISOString()}`,
    "",
    "| provider | model | available | dry_run | latency_ms | error |",
    "|----------|-------|-----------|---------|-----------:|-------|",
    ...matrix.map(m => `| ${m.provider} | ${m.model} | ${m.available} | ${m.dry_run_ok ? "✓" : "✗"} | ${m.latency_ms} | ${(m.error ?? "").slice(0, 40)} |`),
    "",
    "## 요약",
    `- 총 모델: ${matrix.length}`,
    `- dry_run OK: ${matrix.filter(m => m.dry_run_ok).length}`,
    `- 실패: ${matrix.filter(m => !m.dry_run_ok).length}`,
  ];
  writeFileSync("docs/model-availability-matrix.md", md.join("\n"), "utf8");

  console.log(`\n${"─".repeat(W)}`);
  console.log(`총 ${matrix.length}개 — OK ${matrix.filter(m => m.dry_run_ok).length} / FAIL ${matrix.filter(m => !m.dry_run_ok).length}`);
  console.log(`✓ docs/model-availability-matrix.md 작성`);
  console.log(`${"═".repeat(W)}\n`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
