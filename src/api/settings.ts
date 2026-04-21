import { Router } from "express";
import { getActiveProvider, setActiveProvider, getProviderList, LLMProvider } from "../lib/llm.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const settingsRouter = Router();

settingsRouter.get("/model", requireAuth, (_req, res) => {
  res.json({
    active: getActiveProvider(),
    providers: getProviderList(),
  });
});

settingsRouter.post("/model", requireAuth, (req, res) => {
  const { provider } = req.body as { provider: LLMProvider };
  const valid: LLMProvider[] = ["ollama", "deepseek", "openai", "gemini"];
  if (!valid.includes(provider)) {
    res.status(400).json({ error: "유효하지 않은 프로바이더" });
    return;
  }
  setActiveProvider(provider);
  res.json({ ok: true, active: provider });
});
