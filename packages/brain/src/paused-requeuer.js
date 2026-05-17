/**
 * paused-requeuer.js — Brain v2
 *
 * 核心逻辑：扫描 status='paused' AND updated_at < NOW()-1h AND retry_count < 3，
 * 改 status='queued' + retry_count++。
 * retry_count >= 3 → archived（防无限循环）。
 *
 * 插件包装见 paused-requeuer-plugin.js（tick() 节流接口）。
 */

import pool from './db.js';

const MAX_RETRY_COUNT = 3;
const PAUSED_AGE_MINUTES = 60;

/**
 * Core logic: requeue or archive stale paused tasks.
 *
 * @param {import('pg').Pool} [dbPool]
 * @returns {Promise<{ requeued: number, archived: number }>}
 */
export async function runPausedRequeue(dbPool) {
  const db = dbPool || pool;

  // Archive first: paused + retry_count >= MAX_RETRY_COUNT（防无限循环）
  const archiveResult = await db.query(`
    UPDATE tasks
    SET status = 'archived',
        updated_at = NOW()
    WHERE status = 'paused'
      AND COALESCE(retry_count, 0) >= $1
    RETURNING id
  `, [MAX_RETRY_COUNT]);

  // Requeue: paused > 1h, retry_count < MAX_RETRY_COUNT
  const requeueResult = await db.query(`
    UPDATE tasks
    SET status = 'queued',
        retry_count = COALESCE(retry_count, 0) + 1,
        updated_at = NOW()
    WHERE status = 'paused'
      AND updated_at < NOW() - INTERVAL '${PAUSED_AGE_MINUTES} minutes'
      AND COALESCE(retry_count, 0) < $1
    RETURNING id
  `, [MAX_RETRY_COUNT]);

  return {
    requeued: requeueResult.rowCount ?? 0,
    archived: archiveResult.rowCount ?? 0,
  };
}

export default { runPausedRequeue };
