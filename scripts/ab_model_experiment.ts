/**
 * scripts/ab_model_experiment.ts — 베이스 모델 A/B 실험 러너
 *
 * 목적: gemma3:12b vs gemma3:27b vs gemma4:7.5b 비교
 *   A. planner=gemma3:12b  / renderer=gemma3:12b  (현행 기준선)
 *   B. planner=gemma3:12b  / renderer=gemma3:27b  (renderer만 교체)
 *   C. planner=gemma3:27b  / renderer=gemma3:27b  (전체 교체)
 *   D. planner=gemma3:12b  / renderer=gemma4:latest (newer arch renderer)
 *
 * 실험 시나리오 (기존 책 컨텍스트 재사용):
 *   S1: SF탐정 (3인칭 관찰자, 3인물) — POV 위반 재현성 테스트 핵심
 *   S2: 판타지 모험 (4인물, 750자)
 *   S3: 범죄 스릴러 (3인물, 750자)
 *
 * 실행: npx tsx scripts/ab_model_experiment.ts
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { randomUUID } from "crypto";
import * as http from "http";
import * as fs from "fs";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const SERVER = "http://localhost:3000";

// ── 실험 그룹 정의 ──────────────────────────────────────────────
const GROUPS = [
  { id: "A", plannerModel: "gemma3:12b",  rendererModel: "gemma3:12b",  label: "기준선(현행)" },
  { id: "B", plannerModel: "gemma3:12b",  rendererModel: "gemma3:27b",  label: "renderer=27b" },
  { id: "C", plannerModel: "gemma3:27b",  rendererModel: "gemma3:27b",  label: "전체=27b" },
  { id: "D", plannerModel: "gemma3:12b",  rendererModel: "qwen2.5:14b",  label: "renderer=qwen2.5:14b" },
];

// ── 소스 시나리오 (컨텍스트 복제용) ───────────────────────────────
const SOURCE_SCENARIOS = [
  {
    id: "s1", label: "SF탐정(3인칭관찰자)",
    srcBookId: "7f8d321e-ac86-41c7-a409-dc98f5a3420e",
    episodesToGen: 5,
  },
  {
    id: "s2", label: "판타지모험",
    srcBookId: "a5de5090-9117-4b06-a7a0-03efbbd4dccf",
    episodesToGen: 5,
  },
  {
    id: "s3", label: "범죄스릴러",
    srcBookId: "1af6d8c4-e7d0-4abd-86fa-cc6465170060",
    episodesToGen: 5,
  },
];

const EPISODES_PER_BOOK = 5;
const USER_ID = "0720b196-e456-474e-85d1-f51473af9f68";

// ── SSE 스트림 소비 (done 이벤트까지 대기) ───────────────────────
function consumeSSE(url: string, body: object): Promise<{
  success: boolean;
  plan_verdict?: string;
  elapsed_ms: number;
  error?: string;
}> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const bodyStr = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: parseInt(urlObj.port) || 80,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    };

    let planVerdict: string | undefined;
    let buffer = "";
    let finished = false;

    const req = http.request(options, (res) => {
      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.plan?.plan_validation?.verdict) {
              planVerdict = json.plan.plan_validation.verdict;
            }
            if (json.done === true && !finished) {
              finished = true;
              resolve({ success: true, plan_verdict: planVerdict, elapsed_ms: Date.now() - t0 });
            }
            if (json.error && !finished) {
              finished = true;
              resolve({ success: false, error: json.error, elapsed_ms: Date.now() - t0 });
            }
          } catch { /* ignore parse errors */ }
        }
      });
      res.on("end", () => {
        if (!finished) {
          finished = true;
          resolve({ success: true, plan_verdict: planVerdict, elapsed_ms: Date.now() - t0 });
        }
      });
    });

    req.on("error", (err) => {
      if (!finished) {
        finished = true;
        resolve({ success: false, error: err.message, elapsed_ms: Date.now() - t0 });
      }
    });

    // 5분 타임아웃
    setTimeout(() => {
      if (!finished) {
        finished = true;
        req.destroy();
        resolve({ success: false, error: "timeout(5min)", elapsed_ms: Date.now() - t0 });
      }
    }, 5 * 60 * 1000);

    req.write(bodyStr);
    req.end();
  });
}

// ── 실험용 책 생성 (기존 책 컨텍스트 복제) ───────────────────────
async function createExperimentBook(
  srcBookId: string,
  groupId: string,
  scenarioId: string,
  scenarioLabel: string,
): Promise<string> {
  const src = await pool.query(
    "SELECT context, title FROM books WHERE id = $1",
    [srcBookId],
  );
  if (!src.rows.length) throw new Error(`Source book not found: ${srcBookId}`);

  const { context, title } = src.rows[0];
  const newId = randomUUID();
  const expTitle = `[EXP_${groupId}_${scenarioId}] ${title ?? scenarioLabel}`;

  await pool.query(
    `INSERT INTO books (id, user_id, title, context, current_episode, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, NOW(), NOW())`,
    [newId, USER_ID, expTitle, JSON.stringify(context)],
  );

  // 캐릭터도 복제
  const chars = await pool.query(
    "SELECT name, gender, type, personality, role, source, extra FROM characters WHERE book_id = $1",
    [srcBookId],
  );
  for (const c of chars.rows) {
    await pool.query(
      `INSERT INTO characters (id, book_id, name, gender, type, personality, role, source, extra, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [randomUUID(), newId, c.name, c.gender, c.type, c.personality, c.role, c.source, c.extra],
    );
  }

  return newId;
}

// ── 결과 분석 ────────────────────────────────────────────────────
async function analyzeResults(experimentBookIds: Record<string, string[]>) {
  console.log("\n\n═══════════════════════════════════════════");
  console.log("           실험 결과 분석");
  console.log("═══════════════════════════════════════════\n");

  const results: Record<string, any> = {};

  for (const [groupId, bookIds] of Object.entries(experimentBookIds)) {
    const placeholders = bookIds.map((_, i) => `$${i + 1}`).join(",");
    const r = await pool.query(
      `SELECT
        final_verdict,
        final_score,
        total_elapsed_ms,
        (planner_trace->>'elapsed_ms')::int planner_ms,
        (planner_trace->>'model_used') planner_model,
        (computed_reward->>'planner_reward')::float planner_reward,
        (computed_reward->>'renderer_reward')::float renderer_reward,
        (computed_reward->>'combined_reward')::float combined_reward,
        prose_validation->>'summary' summary,
        prose_validation->'hard_violations' hard_viol
       FROM run_traces
       WHERE book_id IN (${placeholders})
         AND final_verdict IS NOT NULL
       ORDER BY created_at`,
      bookIds,
    );

    const rows = r.rows;
    if (!rows.length) {
      console.log(`Group ${groupId}: 결과 없음`);
      continue;
    }

    const pass = rows.filter(r => r.final_verdict === "PASS").length;
    const warn = rows.filter(r => r.final_verdict === "WARN").length;
    const fail = rows.filter(r => r.final_verdict === "FAIL").length;
    const avgScore = Math.round(rows.reduce((a, b) => a + (b.final_score || 0), 0) / rows.length);
    const avgTotal = Math.round(rows.reduce((a, b) => a + (b.total_elapsed_ms || 0), 0) / rows.length / 1000);
    const avgPlanner = Math.round(rows.reduce((a, b) => a + (b.planner_ms || 0), 0) / rows.length / 1000);
    const avgCombined = (rows.reduce((a, b) => a + (b.combined_reward || 0), 0) / rows.length).toFixed(3);
    const avgRenderer = (rows.reduce((a, b) => a + (b.renderer_reward || 0), 0) / rows.length).toFixed(3);

    // POV 위반 카운트
    let povViolations = 0;
    let stateViolations = 0;
    for (const row of rows) {
      const viols = row.hard_viol || [];
      if (viols.some((v: any) => (v.rule || "").includes("POV") || (v.rule || "").includes("시점"))) povViolations++;
      if (viols.some((v: any) => (v.rule || "").includes("상태") || (v.rule || "").includes("보존"))) stateViolations++;
    }

    const plannerModel = rows.find(r => r.planner_model)?.planner_model ?? "unknown";
    results[groupId] = {
      n: rows.length, pass, warn, fail, avgScore, avgTotal, avgPlanner,
      avgCombined, avgRenderer, povViolations, stateViolations, plannerModel,
    };

    const grp = GROUPS.find(g => g.id === groupId)!;
    console.log(`\n─── Group ${groupId}: ${grp.label} ───`);
    console.log(`  planner_model : ${grp.plannerModel}`);
    console.log(`  renderer_model: ${grp.rendererModel}`);
    console.log(`  n             : ${rows.length} 화`);
    console.log(`  PASS/WARN/FAIL: ${pass}/${warn}/${fail} (PASS=${(pass/rows.length*100).toFixed(0)}%)`);
    console.log(`  avg score     : ${avgScore}/100`);
    console.log(`  avg combined  : ${avgCombined}`);
    console.log(`  avg renderer_r: ${avgRenderer}`);
    console.log(`  POV 위반화 수 : ${povViolations}/${rows.length} (${(povViolations/rows.length*100).toFixed(0)}%)`);
    console.log(`  상태보존 위반 : ${stateViolations}/${rows.length}`);
    console.log(`  avg total_ms  : ${avgTotal}s`);
    console.log(`  avg planner_ms: ${avgPlanner}s`);
  }

  return results;
}

// ── 메인 실험 루프 ────────────────────────────────────────────────
// RUN_GROUPS_ONLY: 특정 그룹만 실행 (빈 배열이면 전체)
const RUN_GROUPS_ONLY: string[] = process.env.RUN_GROUPS ? process.env.RUN_GROUPS.split(",") : [];

// EXISTING_BOOKS: 이미 완료된 그룹의 실험 책 ID (재사용)
const EXISTING_BOOKS: Record<string, string[]> = process.env.EXISTING_BOOKS
  ? JSON.parse(process.env.EXISTING_BOOKS)
  : {};

async function main() {
  const runGroups = RUN_GROUPS_ONLY.length ? GROUPS.filter(g => RUN_GROUPS_ONLY.includes(g.id)) : GROUPS;
  console.log("FlowScribe 베이스 모델 A/B 실험");
  console.log("시작:", new Date().toISOString());
  console.log("실행 그룹:", runGroups.map(g => `${g.id}(planner=${g.plannerModel}/renderer=${g.rendererModel})`).join(", "));
  console.log("시나리오:", SOURCE_SCENARIOS.map(s => s.label).join(", "));
  console.log(`에피소드: ${EPISODES_PER_BOOK}화 × ${runGroups.length}그룹 × ${SOURCE_SCENARIOS.length}시나리오 = ${EPISODES_PER_BOOK * runGroups.length * SOURCE_SCENARIOS.length} 화\n`);

  const logFile = `c:/projects/FlowScribe/logs/ab_experiment_${Date.now()}.jsonl`;
  const experimentBookIds: Record<string, string[]> = { ...EXISTING_BOOKS };
  const experimentLog: any[] = [];

  for (const group of runGroups) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`그룹 ${group.id}: ${group.label}`);
    console.log(`planner=${group.plannerModel} / renderer=${group.rendererModel}`);
    console.log("═".repeat(60));

    experimentBookIds[group.id] = [];

    for (const scenario of SOURCE_SCENARIOS) {
      console.log(`\n  시나리오: ${scenario.label}`);

      // 실험용 책 생성 (기존 책 컨텍스트 복제)
      const bookId = await createExperimentBook(
        scenario.srcBookId,
        group.id,
        scenario.id,
        scenario.label,
      );
      experimentBookIds[group.id].push(bookId);
      console.log(`  책 생성: ${bookId.slice(0, 8)}`);

      // 에피소드 순차 생성
      for (let ep = 1; ep <= EPISODES_PER_BOOK; ep++) {
        const t0 = Date.now();
        process.stdout.write(`  화 ${ep}/${EPISODES_PER_BOOK} ... `);

        const result = await consumeSSE(`${SERVER}/api/generate-v2`, {
          book_id: bookId,
          episode: ep,
          use_planner: true,
          enable_trace: true,
          validate: true,
          revise: false,
          planner_model: group.plannerModel,
          renderer_model: group.rendererModel,
        });

        const elapsed = Date.now() - t0;
        const status = result.success ? `ok(${Math.round(elapsed/1000)}s)` : `FAIL(${result.error})`;
        console.log(status);

        experimentLog.push({
          group: group.id, scenario: scenario.id, book_id: bookId,
          episode: ep, success: result.success, elapsed_ms: elapsed,
          plan_verdict: result.plan_verdict, error: result.error,
          planner_model: group.plannerModel, renderer_model: group.rendererModel,
          ts: new Date().toISOString(),
        });

        // 진행 로그 저장 (크래시 복구용)
        fs.writeFileSync(logFile, experimentLog.map(x => JSON.stringify(x)).join("\n") + "\n");

        // 에피소드 간 짧은 대기 (Ollama 안정화)
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  console.log(`\n\n실험 완료: ${new Date().toISOString()}`);
  console.log(`로그: ${logFile}`);

  // 결과 분석
  const results = await analyzeResults(experimentBookIds);

  // 최종 판정
  console.log("\n\n═══════════════════════════════════════════");
  console.log("           최종 판정 데이터");
  console.log("═══════════════════════════════════════════");
  console.log(JSON.stringify({ experimentBookIds, results }, null, 2));

  await pool.end();
}

main().catch(async (e) => {
  console.error("실험 실패:", e.message);
  await pool.end();
  process.exit(1);
});
