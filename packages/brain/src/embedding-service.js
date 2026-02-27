/**
 * Embedding Service - 异步生成向量
 *
 * 职责：
 * - task/learning/memory_stream 写入后 fire-and-forget 生成 embedding
 * - 无 OPENAI_API_KEY → no-op
 * - 失败静默，不影响任何主流程
 */

import pool from './db.js';
import { generateEmbedding } from './openai-client.js';

/**
 * 异步为 task 生成并保存 embedding（fire-and-forget）
 * @param {string} taskId - Task UUID
 * @param {string} title - Task title
 * @param {string|null} description - Task description
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
  } catch (_err) {
    // 静默失败 — 不影响主流程
  }
}

/**
 * 异步为 learning 生成并保存 embedding（fire-and-forget）
 * @param {string} learningId - Learning UUID
 * @param {string} text - 要向量化的文本（title + content）
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
  } catch (_err) {
    // 静默失败 — 不影响主流程
  }
}

/**
 * 异步为 memory_stream 记录生成并保存 embedding（fire-and-forget）
 *
 * 供 reflection.js 在写入反思洞察后调用，接受外部 pool 参数
 * （embedding-service 默认 pool 和 reflection 使用同一 pool，保持一致）
 *
 * @param {string} recordId - memory_stream UUID
 * @param {string} text - 要向量化的内容（content 字段）
 * @param {Object} [dbPool] - pg Pool 实例（可选，默认用 module-level pool）
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
  } catch (_err) {
    // 静默失败 — 不影响主流程
  }
}

/**
 * 异步为用户 profile fact 生成并保存 embedding（fire-and-forget）
 * @param {string} factId - user_profile_facts UUID
 * @param {string} text - 事实内容文本
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
  } catch (_err) {
    // 静默失败 — 不影响主流程
  }
}
