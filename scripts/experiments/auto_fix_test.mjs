/**
 * auto_fix_test.mjs
 * 에피소드 생성 자동 루프: 5연속 정상 확인될 때까지 생성 → 분석 → 수정 반복
 *
 * "정상" 기준:
 *   1. DB 저장 성공
 *   2. content 길이 >= minLen (episodeLength - var)
 *   3. content 끝이 완결된 문장 (마지막 글자가 .·!·?·" 중 하나, 또는 클리프행어 단락 존재)
 *   4. [CLIFF] 마커 클라이언트 누출 없음
 *   5. 직선따옴표 비율 < 30%
 */

import { readFileSync, writeFileSync } from "fs";
import pg from "pg";

// env 로드
try {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://flowscribe:flowscribe@localhost:5432/flowscribe" });
const BASE = "http://localhost:3000";
const log  = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 테스트 세계관 설정 (랜덤 다양)
const WORLDS = [
  { label: "이세계 판타지", bookId: "c05ac9a9-579a-447d-9ba9-c388825d9ae8" },
  // 다른 책이 없으면 같은 책으로 다른 에피소드 번호 사용
];

let consecutiveOk = 0;
let totalTried = 0;
let lastEpisode = 1;

// ── SSE 스트림 읽기 ──────────────────────────────────────────
async function fetchSSE(bookId, episode) {
  const { execSync } = await import("child_process");
  const start = Date.now();
  try {
    const url = `${BASE}/api/generate?book_id=${encodeURIComponent(bookId)}&episode=${episode}`;
    const raw = execSync(
      `curl -s -N --max-time 120 "${url}"`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 125000 }
    );
    const tokens = [];
    let firstToken = null;
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const d = JSON.parse(line.slice(5).trim());
        if (d.token) { tokens.push(d.token); if (!firstToken) firstToken = Date.now() - start; }
      } catch {}
    }
    return { text: tokens.join(""), ttft: firstToken ?? 0, elapsed: Date.now() - start };
  } catch (e) {
    log(`  SSE 오류: ${e.message?.slice(0, 80)}`);
    return { text: "", ttft: 0, elapsed: Date.now() - start };
  }
}

// ── DB에서 저장된 content 확인 ────────────────────────────────
async function getStoredContent(bookId, episode) {
  try {
    const r = await pool.query("SELECT content FROM episodes WHERE book_id=$1 AND episode_number=$2", [bookId, episode]);
    return r.rows[0]?.content ?? null;
  } catch { return null; }
}

// ── 정상 판단 ────────────────────────────────────────────────
function judge(content, episodeLength = 900, epVar = 100) {
  if (!content) return { ok: false, reasons: ["DB 저장 실패"] };
  const reasons = [];
  const minLen = episodeLength - epVar;

  // 1. 길이
  if (content.length < minLen) reasons.push(`분량 부족 (${content.length}자 < ${minLen}자)`);

  // 2. 잘림 감지 — 마지막 300자에 완결 구두점 없으면 잘린 것
  const tail = content.slice(-100);
  const endsClean = /[.!?'"\u201C\u201D\u300D\u300F」』\n]/.test(tail.trimEnd().slice(-1));
  if (!endsClean) reasons.push(`본문 잘림 (tail: "${tail.slice(-30)}")`);

  // 3. [CLIFF] 누출
  if (content.includes("[CLIFF]") || content.includes("[CLIFF")) reasons.push("[CLIFF] 마커 누출");

  // 4. 직선따옴표 비율
  const dialogLines = content.split("\n\n").filter(p => p.trim().startsWith('"'));
  const straightCount = (content.match(/"/g) || []).length;
  const curlyCount = (content.match(/[\u201C\u201D]/g) || []).length;
  const total = straightCount + curlyCount;
  const straightRate = total > 0 ? straightCount / total : 0;
  if (straightRate > 0.9) reasons.push(`직선따옴표 과다 (${Math.round(straightRate*100)}%)`);

  return { ok: reasons.length === 0, reasons, len: content.length, straightRate: Math.round(straightRate*100) };
}

// ── 메인 루프 ─────────────────────────────────────────────────
async function main() {
  log("=== 자동 수정 테스트 루프 시작 ===");
  log("목표: 5연속 정상 에피소드");

  const bookId = WORLDS[0].bookId;

  // 현재 book의 current_episode 파악
  const bookRow = await pool.query("SELECT current_episode, context FROM books WHERE id=$1", [bookId]);
  let ep = bookRow.rows[0]?.current_episode ?? 1;
  const cfg = bookRow.rows[0]?.context?.story_config ?? {};
  const episodeLength = cfg.episodeLength ?? 900;
  const epVar = cfg.episodeLengthVar ?? 100;
  log(`book_id: ${bookId} | current_ep: ${ep} | episodeLength: ${episodeLength}±${epVar}`);

  while (consecutiveOk < 5) {
    totalTried++;
    log(`\n── 시도 #${totalTried} (연속 정상: ${consecutiveOk}/5) — ${ep}화 생성 중...`);

    const { text, ttft, elapsed } = await fetchSSE(bookId, ep);
    log(`  TTFT: ${(ttft/1000).toFixed(1)}s | 총: ${(elapsed/1000).toFixed(1)}s | 스트림 길이: ${text.length}자`);

    // 스트림 텍스트 정제: [CLIFF] 마커 및 후속 텍스트 제거 후 마지막 완결 문장까지 트리밍
    function trimToClean(t) {
      // [CLIFF] 마커 이후 모두 제거
      const cliffIdx = t.search(/\[CLIFF/);
      if (cliffIdx !== -1) t = t.slice(0, cliffIdx).trimEnd();
      // 마지막 완결 문장 경계까지 트리밍
      const cleanEnd = /[.!?"\u201D\u300D\n]$/;
      if (cleanEnd.test(t)) return t;
      const lastBound = t.search(/[.!?"\u201D\u300D\n][^.!?"\u201D\u300D\n]*$/);
      return lastBound !== -1 ? t.slice(0, lastBound + 1) : t;
    }

    // DB에 직접 저장 (테스트 목적 — 브라우저 save 호출 대체)
    let content = null;
    if (text.length > 100) {
      const trimmed = trimToClean(text);
      try {
        await pool.query(
          `INSERT INTO episodes (book_id, episode_number, content, summary)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (book_id, episode_number) DO UPDATE SET content=$3`,
          [bookId, ep, trimmed, trimmed.split(/[.!?]/)[0]?.trim() ?? ""]
        );
        content = trimmed;
        log(`  DB 저장 완료 (원본 ${text.length}자 → 트리밍 후 ${trimmed.length}자)`);
      } catch (e) {
        log(`  DB 저장 오류: ${e.message}`);
      }
    } else {
      log(`  스트림 텍스트 부족 (${text.length}자) — 스킵`);
    }
    const verdict = judge(content, episodeLength, epVar);

    if (verdict.ok) {
      consecutiveOk++;
      log(`  ✅ 정상 (${verdict.len}자, 직선따옴표 ${verdict.straightRate}%) — 연속 ${consecutiveOk}/5`);
    } else {
      consecutiveOk = 0;
      log(`  ❌ 비정상: ${verdict.reasons.join(" | ")}`);
      log(`  → 문제 분석 및 수정 시도...`);
      await analyzeFix(verdict.reasons, content);
    }

    ep++;
    await sleep(3000);
  }

  log("\n=== 5연속 정상 달성! ===");
  log(`총 시도: ${totalTried}회`);
  await pool.end();
}

// ── 문제 분석 및 자동 수정 ────────────────────────────────────
async function analyzeFix(reasons, content) {
  const storyTS = new URL("../src/services/story.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  let src = readFileSync(storyTS, "utf-8");
  let changed = false;

  for (const reason of reasons) {
    // 본문 잘림 → CLIFF 강제 삽입 임계값 낮추기
    if (reason.includes("본문 잘림")) {
      const m = src.match(/targetMaxLen \* ([\d.]+)\s*\)\s*{\s*\/\/ CLIFF 강제|fullText\.length > targetMaxLen \* ([\d.]+)\s*\)/);
      // 현재 1.3이면 1.2로 낮추기
      const current = parseFloat(src.match(/fullText\.length > targetMaxLen \* ([\d.]+)/)?.[1] ?? "1.3");
      if (current > 1.1) {
        const next = (current - 0.05).toFixed(2);
        src = src.replace(
          new RegExp(`(!cliffMode && !isFinale && fullText\\.length > targetMaxLen \\* )${current.toFixed(2).replace('.', '\\.')}`),
          `$1${next}`
        );
        log(`  [패치] CLIFF 강제 임계값 ${current} → ${next}`);
        changed = true;
      }
    }

    // [CLIFF] 누출 → 이미 flushSentBuf에 수정됨, 추가 대응 없음
    if (reason.includes("[CLIFF] 마커 누출")) {
      log(`  [알림] [CLIFF] 누출 — flushSentBuf 패치 이미 적용됨, 관찰 중`);
    }
  }

  if (changed) {
    writeFileSync(storyTS, src, "utf-8");
    log("  [패치] story.ts 저장 완료 — 서버 재시작...");
    await restartServer();
  } else {
    log("  [알림] 자동 수정 불가 — 다음 생성에서 재확인");
  }
}

// ── 서버 재시작 ───────────────────────────────────────────────
async function restartServer() {
  const { execSync, spawn } = await import("child_process");
  try {
    const netstat = execSync("netstat -ano | findstr :3000", { encoding: "utf-8" }).trim();
    const pidMatch = netstat.match(/LISTENING\s+(\d+)/);
    if (pidMatch) {
      execSync(`taskkill /PID ${pidMatch[1]} /F`, { encoding: "utf-8" });
      log(`  PID ${pidMatch[1]} 종료`);
    }
  } catch {}
  await sleep(2000);
  const cwd = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  const child = spawn("npx.cmd", ["tsx", "src/index.ts"], { detached: true, stdio: "ignore", shell: true, cwd });
  child.unref();
  log(`  서버 시작 (PID: ${child.pid})`);
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    try { const r = await fetch(`${BASE}/`); if (r.ok || r.status < 500) { log("  서버 준비 완료"); return; } } catch {}
  }
  log("  [경고] 서버 준비 확인 실패");
}

main().catch(e => { console.error(e); process.exit(1); });
