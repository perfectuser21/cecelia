/**
 * dispatcher.js — Skill Eval 任务调度器
 * 职责：单槽位检查 / 额度预检 / dispatch / 完成/失败回写
 */

import pool from '../db.js';

// ─── 配置（全来自 env）────────────────────────────────────────────────
const getMaxConcurrent = () => parseInt(process.env.MAX_CONCURRENT_SKILL_EVAL || '1', 10);
const getQuota5hMinPct = () => parseInt(process.env.QUOTA_5H_MIN_PCT || '85', 10);
const getQuota7dMinPct = () => parseInt(process.env.QUOTA_7D_MIN_PCT || '90', 10);
const getTimeout = () => parseInt(process.env.SKILL_EVAL_TIMEOUT || '1800000', 10);

// ─── B05: 额度预检 ────────────────────────────────────────────────────
export async function checkQuota() {
  // 查 account_usage 表（如果存在）
  // 如果表不存在或数据不足，默认放行（fail open）
  try {
    const result = await pool.query(
      `SELECT
        COALESCE(
          (SELECT ROUND(100.0 * tokens_used / NULLIF(tokens_limit, 0))
           FROM account_usage WHERE window = '5h' LIMIT 1), 0
        ) AS pct_5h,
        COALESCE(
          (SELECT ROUND(100.0 * tokens_used / NULLIF(tokens_limit, 0))
           FROM account_usage WHERE window = '7d' LIMIT 1), 0
        ) AS pct_7d`
    );

    const { pct_5h, pct_7d } = result.rows[0] || {};
    const used5h = parseFloat(pct_5h) || 0;
    const used7d = parseFloat(pct_7d) || 0;

    const remaining5h = 100 - used5h;
    const remaining7d = 100 - used7d;

    if (remaining5h < getQuota5hMinPct()) {
      return { ok: false, reason: `quota_5h: remaining ${remaining5h.toFixed(1)}% < min ${getQuota5hMinPct()}%` };
    }
    if (remaining7d < getQuota7dMinPct()) {
      return { ok: false, reason: `quota_7d: remaining ${remaining7d.toFixed(1)}% < min ${getQuota7dMinPct()}%` };
    }

    return { ok: true };
  } catch (_err) {
    // Table doesn't exist or query failed — fail open
    return { ok: true };
  }
}

// ─── B04: 尝试调度（单槽位） ──────────────────────────────────────────
export async function tryDispatch() {
  const maxConcurrent = getMaxConcurrent();

  // 检查当前运行数
  const runningResult = await pool.query(
    `SELECT COUNT(*)::text AS count FROM tasks
     WHERE task_type = 'skill_eval' AND status = 'in_progress'`
  );
  const runningCount = parseInt(runningResult.rows[0]?.count || '0', 10);

  if (runningCount >= maxConcurrent) {
    return { skipped: true, reason: 'slot_occupied', running: runningCount };
  }

  // 取最早的 pending task
  const pendingResult = await pool.query(
    `SELECT id, title, payload FROM tasks
     WHERE task_type = 'skill_eval' AND status = 'pending'
     ORDER BY created_at ASC LIMIT 1`
  );

  if (pendingResult.rows.length === 0) {
    return { skipped: true, reason: 'no_pending' };
  }

  const task = pendingResult.rows[0];
  const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;

  // 额度预检
  const quota = await checkQuota();
  if (!quota.ok) {
    return { skipped: true, reason: `quota_blocked: ${quota.reason}` };
  }

  // 标记为 in_progress
  await pool.query(
    `UPDATE tasks SET status = 'in_progress', started_at = NOW() WHERE id = $1`,
    [task.id]
  );

  // 调度执行（异步，不等待）
  dispatch(task.id, payload).catch(async (err) => {
    await onTaskFailed(task.id, payload.skill_name || 'unknown', 'failed(dispatch)', err);
  });

  return { dispatched: true, taskId: task.id };
}

// ─── 执行调度 ─────────────────────────────────────────────────────────
async function dispatch(taskId, payload) {
  // docker-executor 或其他执行方式
  // 这里是 stub — 实际执行器会调用 docker-executor.js
  try {
    const { runSkillEval } = await import('../docker-executor.js').catch(() => null) || {};
    if (runSkillEval) {
      const startTime = Date.now();
      const result = await Promise.race([
        runSkillEval({ taskId, payload }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), getTimeout())
        ),
      ]);
      await onTaskComplete(taskId, payload.skill_name, result, Date.now() - startTime);
    } else {
      // docker-executor not available — mark failed(dispatch)
      await onTaskFailed(taskId, payload.skill_name || 'unknown', 'failed(dispatch)', new Error('docker-executor not available'));
    }
  } catch (err) {
    const status = err.message === 'timeout' ? 'failed(timeout)' : 'failed(crash)';
    await onTaskFailed(taskId, payload.skill_name || 'unknown', status, err);
  }
}

// ─── 完成回调 ─────────────────────────────────────────────────────────
export async function onTaskComplete(taskId, skillName, result, durationMs) {
  await pool.query(
    `UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`,
    [taskId]
  );

  // publisher 回写 evals 表
  try {
    const { writeEvalsRow } = await import('./publisher.js');
    await writeEvalsRow({
      taskId,
      skillName,
      status: 'completed',
      reportUrl: result?.reportUrl || null,
      durationMs,
    });
  } catch (_err) {
    // Non-fatal
  }
}

// ─── 失败回调 ─────────────────────────────────────────────────────────
export async function onTaskFailed(taskId, skillName, status, err) {
  const validStatuses = ['failed(dispatch)', 'failed(crash)', 'failed(timeout)', 'failed(publish)'];
  const finalStatus = validStatuses.includes(status) ? status : 'failed(crash)';

  await pool.query(
    `UPDATE tasks SET status = $1, completed_at = NOW() WHERE id = $2`,
    [finalStatus, taskId]
  );

  // publisher 回写 evals 表
  try {
    const { writeEvalsRow } = await import('./publisher.js');
    await writeEvalsRow({
      taskId,
      skillName,
      status: finalStatus,
      reportUrl: null,
      durationMs: null,
    });
  } catch (_writeErr) {
    // Non-fatal
  }
}
