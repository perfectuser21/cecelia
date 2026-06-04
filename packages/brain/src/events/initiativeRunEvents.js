/**
 * initiativeRunEvents — harness pipeline 节点状态追踪
 *
 * 写入 initiative_run_events 表（migration 279，migration 293 加列）
 * 供 GET /api/brain/harness/stream?initiative_id=... SSE 端点消费。
 *
 * 规范：
 *   - 字段：initiativeId / node / status / attempt / model
 *   - status 合法值：'running' | 'done' | 'failed' | 'completed'
 *   - ts 为 BIGINT（Unix 秒），ts_end 为 BIGINT（Unix 毫秒）
 */

import pool from '../db.js';

/**
 * @param {object} args
 * @param {string} args.initiativeId
 * @param {string} args.node
 * @param {'running'|'done'|'failed'|'completed'} args.status
 * @param {number} [args.attempt]
 * @param {string} [args.model]
 * @param {import('pg').Pool} [args.dbPool]
 */
export async function writeInitiativeRunEvent({ initiativeId, node, status, attempt = 1, model, dbPool } = {}) {
  const db = dbPool || pool;
  const ts = Math.floor(Date.now() / 1000);
  await db.query(
    `INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts, model)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [initiativeId, node, status, attempt, ts, model ?? null]
  );
}

/**
 * @param {object} args
 * @param {number|string} args.id  — initiative_run_events.id (BIGSERIAL PK)
 * @param {number} [args.tsEnd]    — Unix 毫秒时间戳
 * @param {number} [args.costUsd]
 * @param {string} [args.status]
 * @param {import('pg').Pool} [args.dbPool]
 * @returns {Promise<object|null>}  更新后的行，不存在返回 null
 */
export async function updateInitiativeRunEvent({ id, tsEnd, costUsd, status, dbPool } = {}) {
  const db = dbPool || pool;
  const { rows } = await db.query(
    `UPDATE initiative_run_events
        SET ts_end   = COALESCE($2, ts_end),
            cost_usd = COALESCE($3, cost_usd),
            status   = COALESCE($4, status)
      WHERE id = $1
      RETURNING id, initiative_id, node, status, model, ts, ts_end, cost_usd`,
    [id, tsEnd ?? null, costUsd ?? null, status ?? null]
  );
  return rows[0] ?? null;
}
