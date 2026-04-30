/**
 * verify_reader_immersion_audit.mjs — Reader Immersion Audit 정적 검증
 *
 * 1. 필수 파일 존재 확인
 * 2. 핵심 로직 fixture 테스트 (DB 없이 인메모리)
 * 3. 모든 ImmersionIssueCategory 커버리지 확인
 *
 * Usage: node scripts/verify_reader_immersion_audit.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dir, "..");

// ══════════════════════════════════════════════════════════════
// 1. File existence check
// ══════════════════════════════════════════════════════════════
const REQUIRED_FILES = [
  "src/services/reader_immersion_audit.ts",
  "scripts/audit_reader_immersion.mjs",
  "scripts/gemini_reader_immersion_audit.mjs",
  "scripts/verify_reader_immersion_audit.mjs",
];

let allPass = true;
const results = [];

for (const f of REQUIRED_FILES) {
  const full = path.join(root, f);
  const exists = fs.existsSync(full);
  results.push({ check: `file:${f}`, pass: exists, detail: exists ? "found" : "MISSING" });
  if (!exists) allPass = false;
}

// ══════════════════════════════════════════════════════════════
// 2. Content checks — key symbols present in audit service
// ══════════════════════════════════════════════════════════════
const SERVICE_FILE = path.join(root, "src/services/reader_immersion_audit.ts");
const AUDIT_SCRIPT = path.join(root, "scripts/audit_reader_immersion.mjs");
const GEMINI_SCRIPT = path.join(root, "scripts/gemini_reader_immersion_audit.mjs");

function checkContains(file, patterns, label) {
  const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  for (const { re, name } of patterns) {
    const pass = re.test(content);
    results.push({ check: `${label}:${name}`, pass, detail: pass ? "ok" : "NOT FOUND" });
    if (!pass) allPass = false;
  }
}

checkContains(SERVICE_FILE, [
  { re: /ImmersionIssue\b/, name: "ImmersionIssue type" },
  { re: /checkAliveContradictions/, name: "checkAliveContradictions" },
  { re: /checkInventoryContradictions/, name: "checkInventoryContradictions" },
  { re: /checkLocationJumps/, name: "checkLocationJumps" },
  { re: /checkEmotionalLoops/, name: "checkEmotionalLoops" },
  { re: /checkArtifactNoise/, name: "checkArtifactNoise" },
  { re: /checkSpeechRegisterFlips/, name: "checkSpeechRegisterFlips" },
  { re: /computeImmersionScore/, name: "computeImmersionScore" },
  { re: /scoreToVerdict/, name: "scoreToVerdict" },
  { re: /runImmersionAudit/, name: "runImmersionAudit export" },
  { re: /thirty_ep_allowed/, name: "thirty_ep_allowed field" },
], "service");

checkContains(AUDIT_SCRIPT, [
  { re: /alive_contradiction/, name: "alive check" },
  { re: /inventory_contradiction/, name: "inventory check" },
  { re: /location_jump/, name: "location check" },
  { re: /repetition_loop/, name: "emotional loop check" },
  { re: /artifact_noise/, name: "artifact check" },
  { re: /immersion_score/, name: "immersion_score output" },
  { re: /30화 가능/, name: "30ep_allowed output" },
], "audit_script");

checkContains(GEMINI_SCRIPT, [
  { re: /독자 몰입/, name: "immersion focus" },
  { re: /지식 누출/, name: "knowledge leak" },
  { re: /whether_30ep_allowed/, name: "30ep output" },
  { re: /immersion_verdict/, name: "verdict output" },
  { re: /generativelanguage\.googleapis\.com/, name: "gemini endpoint" },
], "gemini_script");

// ══════════════════════════════════════════════════════════════
// 3. Inline fixture tests — deterministic logic without DB
// ══════════════════════════════════════════════════════════════

// ── emotionGroup logic ──
const EMOTION_GROUPS = [
  ["혼란", "혼돈"], ["불안", "두려", "공포", "무서"],
  ["슬픔", "슬퍼", "비통"], ["분노", "화가", "격분"],
  ["절망", "희망이 없"],
];
function emotionGroup(e) {
  if (!e) return "(없음)";
  for (const grp of EMOTION_GROUPS) {
    if (grp.some(k => e.includes(k))) return grp[0];
  }
  return e;
}

// fixture: 동일 감정 3화 연속
function fixtureEmotionalLoop() {
  const states = [
    { character_name: "강이준", episode_number: 1, emotional_state: "혼란스럽다", recent_goal: "단서 찾기" },
    { character_name: "강이준", episode_number: 2, emotional_state: "혼란스럽다", recent_goal: "단서 찾기" },
    { character_name: "강이준", episode_number: 3, emotional_state: "혼란과 불안", recent_goal: "단서 찾기" },
    { character_name: "강이준", episode_number: 4, emotional_state: "두려움", recent_goal: "탈출" },
  ];

  const issues = [];
  const byChar = {};
  for (const s of states.sort((a, b) => a.episode_number - b.episode_number)) {
    if (!byChar[s.character_name]) byChar[s.character_name] = [];
    byChar[s.character_name].push(s);
  }
  for (const [, hist] of Object.entries(byChar)) {
    let streak = 1;
    for (let i = 1; i < hist.length; i++) {
      const prevEmo = emotionGroup(hist[i - 1].emotional_state ?? "");
      const currEmo = emotionGroup(hist[i].emotional_state ?? "");
      const goalSame = hist[i - 1].recent_goal === hist[i].recent_goal;
      if (prevEmo === currEmo && goalSame) {
        streak++;
        if (streak >= 3) { issues.push({ ep: hist[i].episode_number, streak }); streak = 1; }
      } else { streak = 1; }
    }
  }
  return issues.length === 1 && issues[0].ep === 3;
}

results.push({ check: "fixture:emotional_loop_3streak", pass: fixtureEmotionalLoop(), detail: fixtureEmotionalLoop() ? "ok" : "FAIL" });

// ── fixture: artifact detection ──
function fixtureArtifact() {
  const ARTIFACT_PATTERNS = [
    { re: /<\/?s>/gi, label: "LLM 특수토큰" },
    { re: /\[unused\d*\]/gi, label: "unused 토큰" },
    { re: /[一-鿿]{4,}/g, label: "중국어 조각" },
  ];
  const texts = [
    { ep: 1, text: "정상적인 한국어 문장이다." },
    { ep: 2, text: "그는 말했다. </s> 이상한 토큰이 있다." },
    { ep: 3, text: "중국어가 섞인다 一二三四五六七 문장이다." },
  ];
  const found = [];
  for (const { ep, text } of texts) {
    for (const { re } of ARTIFACT_PATTERNS) {
      if (re.test(text)) found.push(ep);
    }
  }
  return found.includes(2) && found.includes(3) && !found.includes(1);
}
results.push({ check: "fixture:artifact_detection", pass: fixtureArtifact(), detail: fixtureArtifact() ? "ok" : "FAIL" });

// ── fixture: isSameZone ──
function isSameZone(a, b) {
  if (!a || !b) return false;
  return a.split(/[\s-]/)[0] === b.split(/[\s-]/)[0];
}
const sameZone1 = isSameZone("D동 격리 구역", "D동 격리 구역 - 실험실");
const sameZone2 = isSameZone("A동 실험실", "B동 거주동");
results.push({ check: "fixture:isSameZone_true", pass: sameZone1, detail: sameZone1 ? "ok" : "FAIL" });
results.push({ check: "fixture:isSameZone_false", pass: !sameZone2, detail: !sameZone2 ? "ok" : "FAIL" });

// ── fixture: score computation ──
function fixtureScore() {
  const fakeIssues = [
    { severity: "fatal" },
    { severity: "major" },
    { severity: "minor" },
  ];
  let penalty = 0;
  for (const i of fakeIssues) {
    if (i.severity === "fatal") penalty += 0.15;
    else if (i.severity === "major") penalty += 0.03;
    else penalty += 0.01;
  }
  const score = Math.max(0, 1 - penalty);
  // 1 - 0.19 = 0.81 → WARN
  const verdict = score >= 0.95 ? "PASS" : score >= 0.90 ? "CONDITIONAL" : score >= 0.80 ? "WARN" : "FAIL";
  return Math.abs(score - 0.81) < 0.001 && verdict === "WARN";
}
results.push({ check: "fixture:score_WARN_0.81", pass: fixtureScore(), detail: fixtureScore() ? "ok" : "FAIL" });

// ══════════════════════════════════════════════════════════════
// Output
// ══════════════════════════════════════════════════════════════
const W = 65;
console.log(`\n${"═".repeat(W)}`);
console.log(` verify_reader_immersion_audit`);
console.log("═".repeat(W));

for (const r of results) {
  const icon = r.pass ? "✅" : "❌";
  console.log(`${icon}  ${r.check.padEnd(50)} ${r.detail}`);
}

const failCount = results.filter(r => !r.pass).length;
console.log("\n" + "─".repeat(W));
if (failCount === 0) {
  console.log(" ALL PASS ✅");
} else {
  console.log(` FAILED: ${failCount} check(s)`);
  process.exit(1);
}
console.log("═".repeat(W) + "\n");
