import "dotenv/config";
import { Worker } from "bullmq";
import { redis } from "../lib/redis.js";
import { writeLog } from "../services/logger.js";
import { updateProfileFromLog } from "../services/profile.js";
import { generateAndSaveItemDescriptions } from "../services/item_desc.js";
import { logInfo, logError } from "../lib/logger.js";

const connection = redis;

// ── log_save 워커 ──────────────────────────────────────────
const logWorker = new Worker(
  "log_save",
  async job => {
    if (job.name === "save-log") {
      await writeLog(job.data);
      logInfo("worker:log_save", "세션 로그 저장 완료", { book_id: job.data.book_id, episode: job.data.episode_number });
    }
  },
  { connection, concurrency: 3 }
);
logWorker.on("failed", (job, err) => {
  logError("worker:log_save", err, { job_id: job?.id, data: job?.data });
});

const profileWorker = new Worker(
  "profile_update",
  async job => {
    if (job.name === "update-profile") {
      await updateProfileFromLog(job.data);
      logInfo("worker:profile_update", "프로필 갱신 완료", { book_id: job.data.book_id, episode: job.data.episode_number });
    }
  },
  { connection, concurrency: 2 }
);
profileWorker.on("failed", (job, err) => {
  logError("worker:profile_update", err, { job_id: job?.id });
});

// ── item_desc 워커 (소지품 설명 LLM 자동 생성) ───────────────
const itemDescWorker = new Worker(
  "item_desc",
  async job => {
    if (job.name === "generate-item-desc") {
      await generateAndSaveItemDescriptions(job.data);
    }
  },
  { connection, concurrency: 2 }
);
itemDescWorker.on("failed", (job, err) => {
  logError("worker:item_desc", err, { job_id: job?.id, char: job?.data?.char_name });
});

// ── audio_sync 워커 (stub — Phase 2에서 구현) ───────────────
const audioWorker = new Worker(
  "audio_sync",
  async job => {
    logInfo("worker:audio_sync", "audio_sync 작업 수신", { job_name: job.name, data: job.data });
  },
  { connection }
);
audioWorker.on("failed", (job, err) => {
  logError("worker:audio_sync", err, { job_id: job?.id });
});

logInfo("worker:startup", "FlowScribe workers started", { queues: ["log_save", "profile_update", "item_desc", "audio_sync"] });

process.on("SIGTERM", async () => {
  logInfo("worker:startup", "SIGTERM 수신 — workers 종료 중");
  await Promise.all([logWorker.close(), profileWorker.close(), itemDescWorker.close(), audioWorker.close()]);
  process.exit(0);
});
