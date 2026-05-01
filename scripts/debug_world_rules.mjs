import pg from "pg";
import { config } from "dotenv";
config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const bookId = process.argv[2];
const r = await pool.query(
  `SELECT rule_type, COUNT(*) AS n FROM world_rules WHERE book_id=$1 GROUP BY rule_type ORDER BY n DESC`,
  [bookId]
);
console.log("by rule_type:", r.rows);
const dup = await pool.query(
  `SELECT content, COUNT(*) AS n FROM world_rules WHERE book_id=$1 GROUP BY content HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 8`,
  [bookId]
);
console.log("duplicates:", dup.rows.length);
for (const d of dup.rows) console.log(`  x${d.n}: ${d.content.slice(0,80)}`);
const sample = await pool.query(
  `SELECT rule_type, content FROM world_rules WHERE book_id=$1 ORDER BY id ASC LIMIT 12`,
  [bookId]
);
console.log("sample:");
for (const s of sample.rows) console.log(`  [${s.rule_type}] ${s.content.slice(0,80)}`);
await pool.end();
