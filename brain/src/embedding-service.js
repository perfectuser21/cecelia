/**
 * Embedding Service - 异步生成任务向量
 *
 * 职责：
 * - task 创建/完成后 fire-and-forget 生成 embedding
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
