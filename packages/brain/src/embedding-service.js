/**
 * Embedding Service - 异步生成向量
 *
 * 职责：
 * - task/learning/memory_stream 写入后 fire-and-forget 生成 embedding
 * - 无 OPENAI_API_KEY → no-op
 * - 失败时记录日志 + 写入重试队列（working_memory key=embedding_retry_queue）
 */

/* global console */

import pool from './db.js';
import { generateEmbedding } from './openai-client.js';

const BACKFILL_BATCH_SIZE = 10;
const BACKFILL_DELAY_MS = 500; // 批次间延迟，避免 rate limit

/**
 * 失败时写入重试队列（working_memory）
 */
async function enqueueRetry(table, id, text, dbPool) {
  const p = dbPool || pool;
  try {
    const existing = await p.query(
      `SELECT value_json FROM working_memory WHERE key = 'embedding_retry_queue'`
    );
    const queue = existing.rows[0]?.value_json || [];
    queue.push({ table, id, text: text.substring(0, 500), failed_at: new Date().toISOString() });
    const trimmed = queue.slice(-100);
    await p.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ('embedding_retry_queue', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()`,
      [JSON.stringify(trimmed)]
    );
  } catch (_e) {
    // 重试队列写入失败不影响主流程
  }
}

/**
 * 异步为 task 生成并保存 embedding（fire-and-forget）
 */
export async function generateTaskEmbeddingAsync(taskId, title, description) {
  if (!process.env.OPENAI_API_KEY) return;

  try {
    const text = [title, description || ''].join('\n\n').substring(0, 4000);
    const embedding = await generateEmbedding(text);
    const embStr = '[' + embedding.join(',') + ']';
    await pool.query(
      `UPDATE tasks SET embedding = $1::vector WHERE id = $2`,
      [embStr, taskId]
    );
  } catch (err) {
    console.warn(`[embedding-service] task embedding failed id=${taskId}: ${err.message}`);
    await enqueueRetry('tasks', taskId, [title, description || ''].join('\n\n'));
  }
}

/**
 * 异步为 learning 生成并保存 embedding（fire-and-forget）
 */
export async function generateLearningEmbeddingAsync(learningId, text) {
  if (!process.env.OPENAI_API_KEY) return;

  try {
    const embedding = await generateEmbedding(text.substring(0, 4000));
    const embStr = '[' + embedding.join(',') + ']';
    await pool.query(
      `UPDATE learnings SET embedding = $1::vector WHERE id = $2`,
      [embStr, learningId]
    );
  } catch (err) {
    console.warn(`[embedding-service] learning embedding failed id=${learningId}: ${err.message}`);
    await enqueueRetry('learnings', learningId, text);
  }
}

/**
 * 批量补全 learnings 中 embedding=null 的记录（Brain 启动时调用）
 * 分批处理，每批 BACKFILL_BATCH_SIZE 条，批次间延迟 BACKFILL_DELAY_MS
 */
export async function backfillLearningEmbeddings(dbPool) {
  if (!process.env.OPENAI_API_KEY) return { processed: 0, failed: 0 };

  const p = dbPool || pool;
  let processed = 0;
  let failed = 0;

  try {
    const { rows } = await p.query(
      `SELECT id, title, content FROM learnings
       WHERE embedding IS NULL
       ORDER BY created_at DESC
       LIMIT $1`,
      [BACKFILL_BATCH_SIZE]
    );

    if (rows.length === 0) return { processed: 0, failed: 0 };

    console.log(`[embedding-service] backfill: 处理 ${rows.length} 条 learnings`);

    for (const row of rows) {
      const text = `${row.title}\n\n${row.content || ''}`.substring(0, 4000);
      try {
        const embedding = await generateEmbedding(text);
        const embStr = '[' + embedding.join(',') + ']';
        await p.query(
          `UPDATE learnings SET embedding = $1::vector WHERE id = $2`,
          [embStr, row.id]
        );
        processed++;
      } catch (err) {
        console.warn(`[embedding-service] backfill failed id=${row.id}: ${err.message}`);
        failed++;
      }
      await new Promise(r => setTimeout(r, BACKFILL_DELAY_MS));
    }

    console.log(`[embedding-service] backfill 完成: processed=${processed}, failed=${failed}`);
  } catch (err) {
    console.warn(`[embedding-service] backfill 查询失败: ${err.message}`);
  }

  return { processed, failed };
}

/**
 * 异步为 memory_stream 记录生成并保存 embedding（fire-and-forget）
 */
export async function generateMemoryStreamEmbeddingAsync(recordId, text, dbPool) {
  if (!process.env.OPENAI_API_KEY) return;

  try {
    const embedding = await generateEmbedding(text.substring(0, 4000));
    const embStr = '[' + embedding.join(',') + ']';
    const p = dbPool || pool;
    await p.query(
      `UPDATE memory_stream SET embedding = $1::vector WHERE id = $2`,
      [embStr, recordId]
    );
  } catch (err) {
    console.warn(`[embedding-service] memory_stream embedding failed id=${recordId}: ${err.message}`);
  }
}

/**
 * 异步为用户 profile fact 生成并保存 embedding（fire-and-forget）
 */
export async function generateProfileFactEmbeddingAsync(factId, text) {
  if (!process.env.OPENAI_API_KEY) return;

  try {
    const embedding = await generateEmbedding(text.substring(0, 2000));
    const embStr = '[' + embedding.join(',') + ']';
    await pool.query(
      `UPDATE user_profile_facts SET embedding = $1::vector WHERE id = $2`,
      [embStr, factId]
    );
  } catch (err) {
    console.warn(`[embedding-service] profile_fact embedding failed id=${factId}: ${err.message}`);
  }
}
