/**
 * run_double.mjs — mega_tune_v2 10라운드 × 2회 연속 실행
 */
import { execSync } from "child_process";
import { rmSync, existsSync, copyFileSync } from "fs";

const log = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);

for (let run = 1; run <= 2; run++) {
  log(`\n${"█".repeat(50)}`);
  log(` RUN ${run} / 2 시작`);
  log(`${"█".repeat(50)}`);

  if (existsSync("logs/tune_state.json")) rmSync("logs/tune_state.json");

  try {
    execSync("node scripts/mega_tune_v2.mjs", { stdio: "inherit", timeout: 36_000_000 });
  } catch (e) {
    log(`RUN ${run} 종료 (exit: ${e.status ?? "unknown"})`);
  }

  if (existsSync("logs/tune_state.json")) {
    copyFileSync("logs/tune_state.json", `logs/run${run}_state_${Date.now()}.json`);
  }

  log(` RUN ${run} 완료\n`);
}

log("전체 2회 완료");
