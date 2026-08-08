/**
 * callback-worker.js
 *
 * Callback Queue 后台轮询 Worker。
 * Brain 启动时自动启动，每 2 秒轮询 callback_queue 表中未处理的记录，
 * 调用共享处理函数 processExecutionCallback 处理每条记录。
 * 处理成功后标记 processed_at；处理失败时保留 processed_at = NULL，等待下次重试。
 */

import pool from './db.js';
import { processExecutionCallback } from './callback-processor.js';
import os from 'node:os';

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 10;
const CALLBACK_LEASE_TTL_MINUTES = 5;
const WORKER_ID = `callback-worker:${os.hostname()}:${process.pid}`;

/**
 * 从 callback_queue 行重建 data 对象，兼容两种来源：
 * 1. HTTP 端点写入：result_json 含 _meta 字段（存 pr_url、account_id 等）
 * 2. 直接 INSERT（测试/WS3）：result_json 为纯 result 数据，无 _meta
 */
function buildDataFromRow(row) {
  const resultJson = row.result_json || {};
  const meta = resultJson._meta || {};

  const result = (() => {
    const rj = { ...resultJson };
    delete rj._meta;
    return Object.keys(rj).length > 0 ? rj : null;
  })();

  return {
    task_id: row.task_id,
    run_id: row.run_id,
    checkpoint_id: row.checkpoint_id || null,
    status: row.status,
    result,
    pr_url: meta.pr_url || null,
    duration_ms: row.duration_ms || null,
    iterations: row.attempt || null,
    exit_code: row.exit_code || null,
    stderr: row.stderr_tail || null,
    failure_class: row.failure_class || null,
    account_id: meta.account_id || null,
  };
}

export async function pollAndProcess() {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(`
      WITH candidates AS (
        SELECT id
        FROM callback_queue
        WHERE processed_at IS NULL
          AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '${CALLBACK_LEASE_TTL_MINUTES} minutes')
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${BATCH_SIZE}
      )
      UPDATE callback_queue AS queue
      SET claimed_at = NOW(), claimed_by = $1
      FROM candidates
      WHERE queue.id = candidates.id
      RETURNING queue.*
    `, [WORKER_ID]);

    for (const row of result.rows) {
      try {
        const data = buildDataFromRow(row);
        await processExecutionCallback(data, pool);
        await client.query(
          'UPDATE callback_queue SET processed_at = NOW(), claimed_at = NULL, claimed_by = NULL WHERE id = $1',
          [row.id]
        );
        console.log(`[callback-worker] Processed callback_queue id=${row.id} task=${row.task_id}`);
      } catch (rowErr) {
        console.error(`[callback-worker] Failed to process row id=${row.id} task=${row.task_id}: ${rowErr.message}`);
        await client.query(
          `UPDATE callback_queue
           SET claimed_at = NULL, claimed_by = NULL, retry_count = COALESCE(retry_count, 0) + 1
           WHERE id = $1`,
          [row.id]
        ).catch(releaseErr => {
          console.error(`[callback-worker] Failed to release lease id=${row.id}: ${releaseErr.message}`);
        });
      }
    }
  } catch (pollErr) {
    console.error(`[callback-worker] Poll error: ${pollErr.message}`);
  } finally {
    if (client) client.release();
  }
}

/**
 * startCallbackWorker()
 * Brain 入口调用此函数启动 Worker。
 */
export function startCallbackWorker() {
  console.log(`[callback-worker] Starting callback queue worker (${POLL_INTERVAL_MS}ms interval)`);
  setInterval(() => {
    pollAndProcess().catch(err =>
      console.error('[callback-worker] Unhandled poll error:', err.message)
    );
  }, POLL_INTERVAL_MS);
}
