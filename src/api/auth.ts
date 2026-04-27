import { Router, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { pool } from "../lib/db.js";
import { logInfo, logError } from "../lib/logger.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const authRouter = Router();

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:3000/api/auth/google/callback"
);

authRouter.get("/google", (_req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["email", "profile"],
    prompt: "select_account",
  });
  res.redirect(url);
});

authRouter.get("/google/callback", async (req: Request, res: Response) => {
  const { code } = req.query;
  if (!code || typeof code !== "string") {
    res.redirect("/?auth_error=1");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload()!;
    const { sub: googleId, email, name, picture } = payload;

    const result = await pool.query(
      `INSERT INTO users (email, google_id, display_name, picture_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET google_id = $2, display_name = $3, picture_url = $4
       RETURNING id, email, display_name, picture_url`,
      [email, googleId, name, picture ?? null]
    );
    const user = result.rows[0];

    const token = jwt.sign(
      { id: user.id, email: user.email, displayName: user.display_name, picture: user.picture_url },
      process.env.JWT_SECRET!,
      { expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as any }
    );

    // sameSite=lax 쿠키는 cross-site redirect(Google→localhost) 중 Chrome이 드롭한다.
    // /api/auth/set-cookie로 same-origin 리다이렉트 → 거기서 httpOnly 쿠키 세팅 후 /로 이동.
    logInfo("api:auth", "Google 로그인 성공", { email: user.email });
    res.redirect(`/api/auth/set-cookie?t=${encodeURIComponent(token)}`);
  } catch (err: any) {
    logError("api:auth", err, { context: "google callback", message: err?.message, stack: err?.stack?.split("\n")[0] });
    const msg = encodeURIComponent(err?.message ?? "unknown");
    res.redirect(`/?auth_error=1&msg=${msg}`);
  }
});

// same-origin 경유 쿠키 세팅 — cross-site redirect 후 sameSite=lax 드롭 우회
// 302 Set-Cookie는 일부 Chrome 버전에서 드롭됨 → HTML + JS document.cookie로 세팅
authRouter.get("/set-cookie", (req: Request, res: Response) => {
  const t = req.query.t;
  if (!t || typeof t !== "string") { res.redirect("/?auth_error=1"); return; }
  const maxAge = 7 * 24 * 60 * 60;
  const escaped = String(t).replace(/['"<>]/g, "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html><html><body><script>
    document.cookie="fs_token=${escaped};path=/;max-age=${maxAge};samesite=lax";
    location.replace("/");
  </script></body></html>`);
});

authRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT calibration_done, calibration, picture_url FROM users WHERE id = $1`,
      [req.user!.id]
    );
    const row = r.rows[0] ?? {};
    res.json({ user: {
      ...req.user,
      picture: row.picture_url ?? (req.user as any).picture ?? null,
      calibration_done: row.calibration_done ?? false,
      calibration: row.calibration ?? null,
    } });
  } catch {
    res.json({ user: req.user });
  }
});

authRouter.post("/calibration", requireAuth, async (req: Request, res: Response) => {
  const { mbti, reading_cpm, profile_init } = req.body;
  try {
    await pool.query(
      `UPDATE users SET calibration = $1::jsonb, calibration_done = TRUE WHERE id = $2`,
      [JSON.stringify({ mbti, reading_cpm, profile_init, calibrated_at: new Date().toISOString() }), req.user!.id]
    );
    logInfo("api:auth", "캘리브레이션 완료", { user_id: req.user!.id, mbti, reading_cpm });
    res.json({ ok: true });
  } catch (err) {
    logError("api:auth", err, { context: "calibration" });
    res.status(500).json({ error: "calibration save failed" });
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("fs_token");
  res.json({ ok: true });
});

// dev-only: bypass Google OAuth for debugging
authRouter.get("/dev-login", async (_req, res) => {
  if (process.env.NODE_ENV === "production") { res.status(404).end(); return; }
  try {
    const r = await pool.query(`SELECT id, email, display_name, picture_url FROM users LIMIT 1`);
    if (!r.rows[0]) { res.status(404).json({ error: "no users in DB" }); return; }
    const user = r.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, displayName: user.display_name, picture: user.picture_url },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );
    res.cookie("fs_token", token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: "lax" });
    logInfo("api:auth", "dev-login 사용됨", { email: user.email });
    res.redirect("/");
  } catch (err) {
    logError("api:auth", err, { context: "dev-login" });
    res.status(500).json({ error: "dev-login failed" });
  }
});
