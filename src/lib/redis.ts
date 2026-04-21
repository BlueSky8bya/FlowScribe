import IORedis from "ioredis";
import { logInfo, logError, logWarn } from "./logger.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

redis.on("connect",           () => logInfo("lib:redis", "Redis 연결됨",             { url: REDIS_URL }));
redis.on("ready",             () => logInfo("lib:redis", "Redis 준비 완료"));
redis.on("close",             () => logWarn("lib:redis", "Redis 연결 닫힘"));
redis.on("reconnecting",      () => logWarn("lib:redis", "Redis 재연결 시도 중"));
redis.on("error",        (err) => logError("lib:redis", err));
