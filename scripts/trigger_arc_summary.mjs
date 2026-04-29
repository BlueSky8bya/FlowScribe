/**
 * trigger_arc_summary.mjs
 * arc summary 수동 트리거
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config();

const args = process.argv.slice(2);
const bookIdIdx = args.indexOf("--book-id");
const BOOK = bookIdIdx !== -1 ? args[bookIdIdx + 1] : null;
if (!BOOK) { console.error("Usage: --book-id <uuid>"); process.exit(1); }

const { generateAndSaveArcSummary } = await import("../dist/services/arc_memory.js");

try {
  console.log("Triggering arc summary arc=1 ep1~10 for book:", BOOK);
  const result = await generateAndSaveArcSummary(
    BOOK,
    1,
    ["이준서", "한유리", "오민혁", "서채린"]
  );
  console.log("Result:", JSON.stringify(result).slice(0, 300));
} catch(e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
process.exit(0);
