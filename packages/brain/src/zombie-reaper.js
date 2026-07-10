/**
 * zombie-reaper.js — DB 层 zombie in_progress task 自动清理
 *
 * T2 重写：改为逐任务调用 assessTaskLiveness，删除 DEFAULT_EXEMPT_TASK_TYPES。
 * 架构文档：docs/architecture/2026-07-10-executor-liveness-contract/architecture.md
 *
 * 处置规则（由合同决定，不再硬编码 task_type 列表）：
 *   verdict=dead + onStale=fail              → 标 failed（brain-local）
 *   verdict=dead + onStale=release-claim-and-alert → 释放 claim 回 queued + 飞书告警（headed-session）
 *   verdict=dead + 其他 onStale             → skip（relay-watchdog/bridge-requeue 等专属组件负责）
 *   verdict=alive / unknown                  → skip（fail-open）
 */

import defaultPool from './db.js';
import { assessTaskLiveness } from './executor-contracts.js';
import { sendFeishu } from './notifier.js';

// ───── 配置 ─────
export const ZOMBIE_REAPER_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分钟扫一次

/**
 * 扫描所有 in_progress 任务，逐个调用 assessTaskLiveness 决定处置。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool]
 * @param {object} [opts.ctx] - 传给 assessTaskLiveness 的运行上下文（activeProcesses Map 等）
 * @returns {Promise<{ reaped: number, released: number, scanned: number, errors: string[] }>}
 */
export async function reapZombies({ pool = defaultPool, ctx = {} } = {}) {
  const result = { reaped: 0, released: 0, scanned: 0, errors: [] };

  console.log('[zombie-reaper] Scanning in_progress tasks via assessTaskLiveness...');

  let tasks;
  try {
    const selectResult = await pool.query(
      `SELECT id, title, task_type, executor_kind, updated_at, claimed_by, last_attempt_at
       FROM tasks
       WHERE status = 'in_progress'
       ORDER BY updated_at ASC
       LIMIT 100`
    );
    tasks = selectResult.rows;
    result.scanned = tasks.length;
  } catch (err) {
    const msg = `SELECT failed: ${err.message}`;
    result.errors.push(msg);
    console.error(`[zombie-reaper] ${msg}`);
    return result;
  }

  if (tasks.length === 0) {
    console.log('[zombie-reaper] No in_progress tasks found.');
    return result;
  }

  for (const task of tasks) {
    try {
      const { verdict, onStale, kind } = await assessTaskLiveness(task, ctx);

      if (verdict !== 'dead') continue; // alive 或 unknown → fail-open，不动

      if (onStale === 'fail') {
        await pool.query(
          `UPDATE tasks
           SET status = 'failed',
               error_message = $1,
               completed_at = NOW(),
               updated_at = NOW()
           WHERE id = $2
             AND status = 'in_progress'`,
          [`[reaper] zombie: executor_kind=${kind}, probe=dead`, task.id]
        );
        result.reaped++;
        console.warn(
          `[zombie-reaper] Reaped zombie task id=${task.id} kind=${kind} title=${JSON.stringify(task.title || '')}`
        );

      } else if (onStale === 'release-claim-and-alert') {
        // headed-session：绝不标 failed，释放 claim 回 queued + 飞书告警
        await pool.query(
          `UPDATE tasks
           SET status = 'queued',
               claimed_by = NULL,
               claimed_at = NULL,
               started_at = NULL,
               updated_at = NOW()
           WHERE id = $1
             AND status = 'in_progress'`,
          [task.id]
        );
        result.released++;
        const alertMsg = `[reaper] headed-session 已断开，释放 claim → queued: task=${task.id} title=${task.title}`;
        console.warn(`[zombie-reaper] ${alertMsg}`);
        sendFeishu(alertMsg).catch(e =>
          console.error('[zombie-reaper] feishu alert failed:', e.message)
        );

      } else {
        // reignite/requeue/never → 其他守护组件负责，reaper 不介入
        console.log(
          `[zombie-reaper] task=${task.id} kind=${kind} onStale=${onStale} — skip (handled by dedicated guardian)`
        );
      }
    } catch (err) {
      const msg = `task ${task.id}: ${err.message}`;
      result.errors.push(msg);
      console.error(`[zombie-reaper] Error processing ${msg}`);
    }
  }

  console.log(
    `[zombie-reaper] Done: reaped=${result.reaped} released=${result.released} scanned=${result.scanned} errors=${result.errors.length}`
  );

  return result;
}

/**
 * 启动 zombie reaper 定时器（每 ZOMBIE_REAPER_INTERVAL_MS 触发一次）。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool]
 * @param {object} [opts.ctx] - activeProcesses 等运行上下文
 * @returns {NodeJS.Timeout}
 */
export function startZombieReaper({ pool = defaultPool, ctx = {} } = {}) {
  const timer = setInterval(async () => {
    try {
      await reapZombies({ pool, ctx });
    } catch (err) {
      console.error('[zombie-reaper] Unexpected error during reap:', err.message);
    }
  }, ZOMBIE_REAPER_INTERVAL_MS);

  if (timer.unref) timer.unref();

  console.log(`[zombie-reaper] Started (interval=${ZOMBIE_REAPER_INTERVAL_MS}ms)`);
  return timer;
}

export default { reapZombies, startZombieReaper, ZOMBIE_REAPER_INTERVAL_MS };
