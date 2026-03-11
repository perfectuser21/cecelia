/**
 * Cortex 路由 — 皮层 LLM 调用历史 API
 *
 * GET /api/brain/cortex/call-history
 *   查询最近的 Cortex LLM 调用记录（含成功/失败）
 *   ?status=failed|success|timeout  — 按状态过滤（timeout 由 duration_ms 派生）
 *   ?limit=N                        — 返回条数（默认 50，最大 200）
 *
 * 注：status=timeout 是派生字段，通过 duration_ms >= CORTEX_TIMEOUT_MS - 5000 判断。
 *     底层表 cortex_call_log 只存 'success' / 'failed'。
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/** Cortex 超时阈值（ms）：与 callCortexLLM 保持一致 */
const CORTEX_TIMEOUT_MS = parseInt(process.env.CECELIA_BRIDGE_TIMEOUT_MS || '120000', 10);
/** timeout 派生阈值：duration_ms >= CORTEX_TIMEOUT_MS - 5000 视为超时 */
const TIMEOUT_THRESHOLD_MS = CORTEX_TIMEOUT_MS - 5000;

/**
 * 将 DB 行转换为 API 响应格式
 * status=timeout 在此处派生（不依赖表字段）
 */
function toRecord(row) {
  const dbStatus = row.status;
  const durationMs = row.duration_ms != null ? Number(row.duration_ms) : null;

  let status = dbStatus;
  if (dbStatus === 'success' && durationMs != null && durationMs >= TIMEOUT_THRESHOLD_MS) {
    status = 'timeout';
  }

  return {
    id: row.id,
    ts: row.ts,
    trigger: row.trigger,
    status,
    duration_ms: durationMs,
    http_status: row.http_status != null ? Number(row.http_status) : null,
    model: row.model,
    error_summary: row.error_summary,
  };
}

/**
 * GET /call-history
 * 查询 Cortex LLM 调用历史
 */
router.get('/call-history', async (req, res) => {
  const rawStatus = req.query.status;
  const rawLimit = req.query.limit;

  // 参数校验：status
  const VALID_STATUSES = ['success', 'failed', 'timeout'];
  if (rawStatus != null && !VALID_STATUSES.includes(rawStatus)) {
    return res.status(400).json({ error: `invalid status: ${rawStatus}. valid values: success, failed, timeout` });
  }

  // 参数校验：limit
  const limit = rawLimit != null ? parseInt(rawLimit, 10) : 50;
  if (isNaN(limit) || limit < 1 || limit > 200) {
    return res.status(400).json({ error: 'limit must be 1–200' });
  }

  try {
    let rows;

    if (rawStatus === 'timeout') {
      // timeout 由 duration_ms 派生：只查 success 行，筛选超时
      const result = await pool.query(
        `SELECT id, ts, trigger, status, duration_ms, http_status, model, error_summary
         FROM cortex_call_log
         WHERE status = 'success' AND duration_ms >= $1
         ORDER BY ts DESC
         LIMIT $2`,
        [TIMEOUT_THRESHOLD_MS, limit]
      );
      rows = result.rows;
    } else if (rawStatus != null) {
      // status=success 或 status=failed
      const result = await pool.query(
        `SELECT id, ts, trigger, status, duration_ms, http_status, model, error_summary
         FROM cortex_call_log
         WHERE status = $1
         ORDER BY ts DESC
         LIMIT $2`,
        [rawStatus, limit]
      );
      rows = result.rows;
    } else {
      // 不过滤 status
      const result = await pool.query(
        `SELECT id, ts, trigger, status, duration_ms, http_status, model, error_summary
         FROM cortex_call_log
         ORDER BY ts DESC
         LIMIT $1`,
        [limit]
      );
      rows = result.rows;
    }

    res.json(rows.map(toRecord));
  } catch (err) {
    console.error('[API] cortex/call-history error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
