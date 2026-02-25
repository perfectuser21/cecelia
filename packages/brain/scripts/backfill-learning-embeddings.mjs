#!/usr/bin/env node
/**
 * Backfill Learning Embeddings
 *
 * 批量为存量 learnings 生成 embedding 向量。
 * - 每批 50 条
 * - 批次间 sleep 1s 避免 OpenAI rate limit
 * - 跳过已有 embedding 的记录
 * - 失败记录 log 但不中断
 *
 * Usage:
 *   node brain/scripts/backfill-learning-embeddings.mjs
 *   node brain/scripts/backfill-learning-embeddings.mjs --dry-run
 */

import pg from 'pg';
import OpenAI from 'openai';

const { Pool } = pg;

const BATCH_SIZE = 50;
const SLEEP_MS = 1000;
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('[backfill] OPENAI_API_KEY not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // Check if embedding column exists
    const columnCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'learnings' AND column_name = 'embedding'
    `);
    if (columnCheck.rows.length === 0) {
      console.error('[backfill] learnings.embedding column does not exist. Run migration 053 first.');
      process.exit(1);
    }

    // Count learnings without embedding
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM learnings WHERE embedding IS NULL`
    );
    const total = parseInt(countResult.rows[0].count);
    console.log(`[backfill] ${total} learnings without embedding`);

    if (total === 0) {
      console.log('[backfill] Nothing to do.');
      return;
    }

    if (DRY_RUN) {
      console.log('[backfill] Dry run — no changes will be made.');
      return;
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    while (processed < total) {
      const batch = await pool.query(`
        SELECT id, title, content
        FROM learnings
        WHERE embedding IS NULL
        ORDER BY created_at ASC
        LIMIT $1
      `, [BATCH_SIZE]);

      if (batch.rows.length === 0) break;

      for (const learning of batch.rows) {
        try {
          const text = `${learning.title || ''}\n\n${
            typeof learning.content === 'string' ? learning.content : JSON.stringify(learning.content || '')
          }`.substring(0, 4000);

          const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
            encoding_format: 'float',
          });

          const embedding = response.data[0].embedding;
          const embStr = `[${embedding.join(',')}]`;

          await pool.query(
            `UPDATE learnings SET embedding = $1::vector WHERE id = $2`,
            [embStr, learning.id]
          );

          succeeded++;
        } catch (err) {
          console.warn(`[backfill] Failed for learning ${learning.id}: ${err.message}`);
          failed++;
        }
        processed++;
      }

      console.log(`[backfill] Progress: ${processed}/${total} (${succeeded} ok, ${failed} failed)`);

      // Rate limit protection
      if (processed < total) {
        await new Promise(r => setTimeout(r, SLEEP_MS));
      }
    }

    console.log(`[backfill] Done: ${succeeded} succeeded, ${failed} failed out of ${total}`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[backfill] Fatal:', err.message);
  process.exit(1);
});
