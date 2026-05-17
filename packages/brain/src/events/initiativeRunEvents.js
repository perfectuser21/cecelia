/**
 * initiativeRunEvents — ws3 harness pipeline 节点状态追踪
 *
 * 写入 initiative_run_events 表（migration 279）
 * 供 GET /api/brain/harness/stream?initiative_id=... SSE 端点消费。
 *
 * 规范（DoD ws3）：
 *   - 字段：initiativeId / node / status / attempt
 *   - status 合法值：'running' | 'done' | 'failed'
 *   - 无 label 字段
 *   - ts 为 BIGINT（Unix 秒）
 */

import pool from '../db.js';

/**
 * @param {object} args
 * @param {string} args.initiativeId
 * @param {string} args.node
 * @param {'running'|'done'|'failed'} args.status
 * @param {number} [args.attempt]
 * @param {import('pg').Pool} [args.dbPool]
 */
export async function writeInitiativeRunEvent({ initiativeId, node, status, attempt = 1, dbPool } = {}) {
  const db = dbPool || pool;
  const ts = Math.floor(Date.now() / 1000);
  await db.query(
    `INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts)
     VALUES ($1, $2, $3, $4, $5)`,
    [initiativeId, node, status, attempt, ts]
  );
}
