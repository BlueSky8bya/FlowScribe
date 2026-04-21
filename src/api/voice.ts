import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { pool } from "../lib/db.js";
import { logInfo, logError } from "../lib/logger.js";
import { requireAuth } from "../middleware/requireAuth.js";
import multer from "multer";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

export const voiceRouter = Router();
voiceRouter.use(requireAuth);

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(__dirname, "../../assets/voice_archive");
mkdirSync(SAMPLE_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SAMPLE_DIR),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}.${file.originalname.split(".").pop() ?? "webm"}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(new Error("audio files only"));
  },
});

// ── 사용 전 검증 헬퍼 (SOP §16, assets/README 7항) ────────────
function isVoiceUsable(v: any): boolean {
  return (
    v.consent_status === "confirmed" &&
    v.active === true &&
    v.delete_requested === false
  );
}

// ── GET /api/voice/mine ─────────────────────────────────────
voiceRouter.get("/mine", async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT v.*,
              (SELECT COUNT(*) FROM voice_character_map WHERE voice_id = v.id) AS mapped_characters
       FROM voice_archive v
       WHERE v.owner_id = $1 AND v.deleted_at IS NULL
       ORDER BY v.created_at DESC`,
      [req.user!.id]
    );
    res.json({ voices: r.rows });
  } catch (err) {
    logError("api:voice", err, { context: "list-mine" });
    res.status(500).json({ error: "fetch failed" });
  }
});

// ── GET /api/voice/browse ───────────────────────────────────
// 다른 사용자의 shared/public 보이스 탐색
voiceRouter.get("/browse", async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT v.id, v.display_name, v.description, v.scope_level,
              v.style_tags, v.character_types, v.default_rate, v.default_pitch,
              v.ai_narration_allowed, v.character_voice_allowed,
              u.display_name AS owner_name,
              v.created_at
       FROM voice_archive v
       JOIN users u ON u.id = v.owner_id
       WHERE v.owner_id != $1
         AND v.scope_level IN ('shared','public')
         AND v.consent_status = 'confirmed'
         AND v.active = TRUE
         AND v.delete_requested = FALSE
         AND v.deleted_at IS NULL
       ORDER BY v.scope_level DESC, v.created_at DESC
       LIMIT 60`,
      [req.user!.id]
    );
    res.json({ voices: r.rows });
  } catch (err) {
    logError("api:voice", err, { context: "browse" });
    res.status(500).json({ error: "browse failed" });
  }
});

// ── GET /api/voice/book/:bookId/map ────────────────────────
voiceRouter.get("/book/:bookId/map", async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT m.character_name, m.narrator_role, m.pan_position,
              v.id AS voice_id, v.display_name, v.tts_engine,
              v.tts_voice_id, v.default_rate, v.default_pitch, v.style_tags
       FROM voice_character_map m
       LEFT JOIN voice_archive v ON v.id = m.voice_id
       WHERE m.book_id = $1
       ORDER BY m.character_name`,
      [req.params.bookId]
    );
    res.json({ map: r.rows });
  } catch (err) {
    logError("api:voice", err, { context: "map-get" });
    res.status(500).json({ error: "map fetch failed" });
  }
});

// ── POST /api/voice ─────────────────────────────────────────
// 음성 등록 — 동의 필수 (SOP §16.4 Normative)
voiceRouter.post("/", async (req: Request, res: Response) => {
  const {
    display_name, description = "",
    scope_level = "private",
    ai_narration_allowed = true,
    character_voice_allowed = true,
    commercial_use_allowed = false,
    adult_content_allowed = false,
    redistribution_allowed = false,
    genre_restriction = null,
    tts_engine = "web_speech",
    tts_voice_id = null,
    default_rate = 1.0,
    default_pitch = 1.0,
    style_tags = [],
    character_types = [],
    consent_confirmed,   // true 필수
  } = req.body;

  if (!consent_confirmed) {
    res.status(400).json({ error: "동의가 필요합니다 (SOP §16.4 Normative)" });
    return;
  }
  if (!display_name?.trim()) {
    res.status(400).json({ error: "보이스 이름을 입력해주세요" });
    return;
  }

  try {
    const r = await pool.query(
      `INSERT INTO voice_archive (
         owner_id, display_name, description, scope_level,
         ai_narration_allowed, character_voice_allowed,
         commercial_use_allowed, adult_content_allowed, redistribution_allowed,
         genre_restriction, tts_engine, tts_voice_id,
         default_rate, default_pitch, style_tags, character_types,
         consent_status, consent_version, consented_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,
         $10,$11,$12,$13,$14,$15,$16,
         'confirmed','1.0',NOW()
       ) RETURNING *`,
      [
        req.user!.id, display_name.trim(), description,
        scope_level,
        ai_narration_allowed, character_voice_allowed,
        commercial_use_allowed, adult_content_allowed, redistribution_allowed,
        genre_restriction, tts_engine, tts_voice_id,
        default_rate, default_pitch,
        style_tags, character_types,
      ]
    );
    const voice = r.rows[0];

    // 학습 메타데이터 초기 레코드 생성
    await pool.query(
      `INSERT INTO voice_training_metadata
         (voice_id, source_owner_id, status)
       VALUES ($1, $2, 'pending')`,
      [voice.id, req.user!.id]
    );

    logInfo("api:voice", "음성 등록", { voice_id: voice.id, scope: scope_level });
    res.json({ voice });
  } catch (err) {
    logError("api:voice", err, { context: "create" });
    res.status(500).json({ error: "voice register failed" });
  }
});

// ── POST /api/voice/:id/sample ──────────────────────────────
// 음성 샘플 업로드 (MediaRecorder WebM)
voiceRouter.post("/:id/sample", upload.single("audio"), async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!req.file) { res.status(400).json({ error: "audio file required" }); return; }

  try {
    const own = await pool.query(
      `SELECT id FROM voice_archive WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL`,
      [id, req.user!.id]
    );
    if (!own.rows.length) { res.status(403).json({ error: "forbidden" }); return; }

    const relPath = `assets/voice_archive/${req.file.filename}`;
    await pool.query(
      `UPDATE voice_archive SET sample_path=$1, updated_at=NOW() WHERE id=$2`,
      [relPath, id]
    );

    // 학습 메타데이터 업데이트
    await pool.query(
      `UPDATE voice_training_metadata
       SET sample_count = sample_count + 1,
           audit_log = audit_log || $1::jsonb
       WHERE voice_id = $2`,
      [
        JSON.stringify([{ event: "sample_uploaded", file: req.file.filename, at: new Date().toISOString() }]),
        id,
      ]
    );

    logInfo("api:voice", "샘플 업로드", { voice_id: id, file: req.file.filename });
    res.json({ ok: true, sample_path: relPath });
  } catch (err) {
    logError("api:voice", err, { context: "sample-upload" });
    res.status(500).json({ error: "upload failed" });
  }
});

// ── PATCH /api/voice/:id ────────────────────────────────────
// 보이스 설정 수정 (SOP §16.4 — 등록 후 범위 수정 기능)
voiceRouter.patch("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const fields = [
    "display_name","description","scope_level",
    "ai_narration_allowed","character_voice_allowed",
    "commercial_use_allowed","adult_content_allowed","redistribution_allowed",
    "genre_restriction","tts_engine","tts_voice_id",
    "default_rate","default_pitch","style_tags","character_types",
  ];
  const setClauses: string[] = ["updated_at = NOW()"];
  const params: any[] = [id, req.user!.id];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      setClauses.push(`${f} = $${params.length + 1}`);
      params.push(req.body[f]);
    }
  }
  if (setClauses.length === 1) { res.json({ ok: true }); return; }

  try {
    await pool.query(
      `UPDATE voice_archive SET ${setClauses.join(",")}
       WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL`,
      params
    );
    // 감사 로그 기록
    await pool.query(
      `UPDATE voice_training_metadata
       SET audit_log = audit_log || $1::jsonb
       WHERE voice_id = $2`,
      [JSON.stringify([{ event: "settings_updated", at: new Date().toISOString() }]), id]
    );
    res.json({ ok: true });
  } catch (err) {
    logError("api:voice", err, { context: "update" });
    res.status(500).json({ error: "update failed" });
  }
});

// ── POST /api/voice/:id/deactivate ─────────────────────────
voiceRouter.post("/:id/deactivate", async (req: Request, res: Response) => {
  try {
    await pool.query(
      `UPDATE voice_archive SET active=FALSE, updated_at=NOW()
       WHERE id=$1 AND owner_id=$2`,
      [req.params.id, req.user!.id]
    );
    res.json({ ok: true });
  } catch (err) {
    logError("api:voice", err, { context: "deactivate" });
    res.status(500).json({ error: "deactivate failed" });
  }
});

// ── POST /api/voice/:id/activate ───────────────────────────
voiceRouter.post("/:id/activate", async (req: Request, res: Response) => {
  try {
    await pool.query(
      `UPDATE voice_archive SET active=TRUE, updated_at=NOW()
       WHERE id=$1 AND owner_id=$2`,
      [req.params.id, req.user!.id]
    );
    res.json({ ok: true });
  } catch (err) {
    logError("api:voice", err, { context: "activate" });
    res.status(500).json({ error: "activate failed" });
  }
});

// ── DELETE /api/voice/:id ───────────────────────────────────
// 소프트 삭제 — 즉시 사용 중단 (SOP §16.4)
voiceRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    await pool.query(
      `UPDATE voice_archive
       SET delete_requested=TRUE, active=FALSE, deleted_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND owner_id=$2`,
      [req.params.id, req.user!.id]
    );
    // 감사 로그
    await pool.query(
      `UPDATE voice_training_metadata
       SET audit_log = audit_log || $1::jsonb
       WHERE voice_id = $2`,
      [JSON.stringify([{ event: "delete_requested", at: new Date().toISOString() }]), req.params.id]
    );
    logInfo("api:voice", "보이스 삭제 요청", { voice_id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    logError("api:voice", err, { context: "delete" });
    res.status(500).json({ error: "delete failed" });
  }
});

// ── PUT /api/voice/book/:bookId/map ────────────────────────
// 캐릭터 → 보이스 매핑 저장
voiceRouter.put("/book/:bookId/map", async (req: Request, res: Response) => {
  const { bookId } = req.params;
  const { mappings } = req.body as {
    mappings: Array<{ character_name: string; voice_id: string | null; narrator_role?: string; pan_position?: number }>;
  };
  if (!Array.isArray(mappings)) { res.status(400).json({ error: "mappings required" }); return; }

  try {
    for (const m of mappings) {
      // 사용 전 검증 (SOP assets/README 7항)
      if (m.voice_id) {
        const vr = await pool.query(
          `SELECT consent_status, active, delete_requested, scope_level, owner_id
           FROM voice_archive WHERE id=$1`,
          [m.voice_id]
        );
        const v = vr.rows[0];
        if (!v || !isVoiceUsable(v)) continue; // fallback — skip invalid voice
        // shared/public는 누구나, private는 소유자만
        if (v.scope_level === "private" && v.owner_id !== req.user!.id) continue;
      }

      await pool.query(
        `INSERT INTO voice_character_map (book_id, character_name, voice_id, narrator_role, pan_position)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (book_id, character_name)
         DO UPDATE SET voice_id=$3, narrator_role=$4, pan_position=$5`,
        [bookId, m.character_name, m.voice_id ?? null, m.narrator_role ?? "character", m.pan_position ?? 0.0]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    logError("api:voice", err, { context: "map-set" });
    res.status(500).json({ error: "map save failed" });
  }
});

// ── GET /api/voice/:id/training ────────────────────────────
voiceRouter.get("/:id/training", async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT t.* FROM voice_training_metadata t
       JOIN voice_archive v ON v.id = t.voice_id
       WHERE t.voice_id = $1 AND v.owner_id = $2`,
      [req.params.id, req.user!.id]
    );
    res.json({ training: r.rows[0] ?? null });
  } catch (err) {
    logError("api:voice", err, { context: "training-get" });
    res.status(500).json({ error: "training fetch failed" });
  }
});
