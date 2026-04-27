import { Queue } from "bullmq";
import { redis } from "../lib/redis.js";

const connection = redis;

export const logSaveQueue = new Queue("log_save", { connection });
export const profileUpdateQueue = new Queue("profile_update", { connection });
export const audioSyncQueue = new Queue("audio_sync", { connection });
