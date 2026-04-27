import { buildEffectiveContext } from './services/effective_context.js';
import { pool } from './lib/db.js';
import { validate } from './services/validator.js';

async function main() {
  const ctx = await buildEffectiveContext({ bookId: 'b5ef8d70-0638-4db1-9509-cb164da558ab', episodeNumber: 1, pool: pool as any });
  const ep = await (pool as any).query('SELECT content FROM episodes WHERE book_id = $1 AND episode_number = 1', ['b5ef8d70-0638-4db1-9509-cb164da558ab']);
  const generatedText = ep.rows[0].content;
  console.log('absolute_forbidden:', ctx.absolute_forbidden);
  console.log('gen_config.pov:', ctx.gen_config.pov);
  console.log('generatedText length:', generatedText.length);
  const t0 = Date.now();
  const result = await validate(generatedText, ctx);
  console.log('validate time:', Date.now()-t0, 'ms');
  console.log('verdict:', result.verdict, 'score:', result.total_score);
  console.log('summary:', result.summary);
  await (pool as any).end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
