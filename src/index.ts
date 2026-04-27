import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { runStartup } from "./lib/startup.js";
import { logError, logInfo } from "./lib/logger.js";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateRouter } from "./api/generate.js";
import { episodesRouter } from "./api/episodes.js";
import { contextRouter } from "./api/context.js";
import { charactersRouter } from "./api/characters.js";
import { suggestRouter } from "./api/suggest.js";
import { logsRouter } from "./api/logs.js";
import { debugRouter } from "./api/debug.js";
import { directorRouter } from "./api/director.js";
import { authRouter } from "./api/auth.js";
import { booksRouter } from "./api/books.js";
import { voiceRouter } from "./api/voice.js";
import { settingsRouter } from "./api/settings.js";
import { generateV2Router } from "./api/generate_v2.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.static(join(__dirname, "../public"), {
  setHeaders: (res, path) => {
    if (path.endsWith(".js") || path.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  },
}));


app.use("/api/auth",     authRouter);
app.use("/api/books",    booksRouter);
app.use("/api/generate", generateRouter);
app.use("/api/episodes", episodesRouter);
app.use("/api/context",  contextRouter);
app.use("/api/characters", charactersRouter);
app.use("/api/suggest",  suggestRouter);
app.use("/api/logs",     logsRouter);
app.use("/api/debug",    debugRouter);
app.use("/api/director", directorRouter);
app.use("/api/voice",    voiceRouter);
app.use("/api/settings",     settingsRouter);
app.use("/api/generate-v2", generateV2Router);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

runStartup().then(() => {
  app.listen(Number(PORT), () => {
    logInfo("startup", `FlowScribe server running`, { port: PORT, url: `http://localhost:${PORT}` });
  });
}).catch(err => {
  logError("startup:fatal", err);
  process.exit(1);
});
