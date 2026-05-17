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

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 10;

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

async function pollAndProcess() {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(`
      SELECT * FROM callback_queue
      WHERE processed_at IS NULL
      ORDER BY created_at ASC
      LIMIT ${BATCH_SIZE}
    `);

    for (const row of result.rows) {
      try {
        const data = buildDataFromRow(row);
        await processExecutionCallback(data, pool);
        await client.query(
          'UPDATE callback_queue SET processed_at = NOW() WHERE id = $1',
          [row.id]
        );
        console.log(`[callback-worker] Processed callback_queue id=${row.id} task=${row.task_id}`);
      } catch (rowErr) {
        console.error(`[callback-worker] Failed to process row id=${row.id} task=${row.task_id}: ${rowErr.message}`);
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
