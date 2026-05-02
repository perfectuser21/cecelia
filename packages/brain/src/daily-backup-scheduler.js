/**
 * daily-backup-scheduler.js
 *
 * 每日 DB 备份自动调度器。
 *
 * 每次 Tick 末尾调用 scheduleDailyBackup()，内部判断是否到达每日触发时间。
 * 如果是，则往 Brain 任务队列插入一个 trigger_backup 类型任务（幂等）。
 *
 * 触发时间：北京时间 02:00 = UTC 18:00（前一天）
 * 幂等机制：同一天只创建一次 trigger_backup 任务（20h 窗口去重）
 */

/** 每日触发小时（UTC）= 北京时间 02:00 */
const DAILY_BACKUP_HOUR_UTC = 18;

/**
 * 判断当前时间是否在每日备份触发窗口内（UTC 18:00 ± 5 分钟 = 北京时间 02:00-02:05）。
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInDailyBackupWindow(now = new Date()) {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  return utcHour === DAILY_BACKUP_HOUR_UTC && utcMinute < 5;
}

/**
 * 检查今天是否已经创建过 trigger_backup 任务（20h 窗口去重）。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
async function alreadyScheduledToday(pool) {
  const { rows } = await pool.query(
    `SELECT 1 FROM tasks
     WHERE task_type = 'trigger_backup'
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * 创建 trigger_backup 任务。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>} 新任务 ID
 */
async function createBackupTask(pool) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (
       task_type, title, status, priority, payload, created_at, updated_at
     ) VALUES (
       'trigger_backup', $1, 'queued', 40, $2, NOW(), NOW()
     ) RETURNING id`,
    [
      '每日 DB 备份',
      JSON.stringify({
        triggered_by: 'daily-backup-scheduler',
        scheduled_at: new Date().toISOString(),
        backup_type: 'daily',
      }),
    ]
  );
  return rows[0].id;
}

/**
 * 每 Tick 调用：判断是否到达每日备份时间，若是则创建 trigger_backup 任务。
 *
 * @param {import('pg').Pool} pool
 * @param {object} [opts]
 * @param {boolean} [opts.force] - 强制立即触发（跳过时间窗口检查），用于 API 手动触发
 * @returns {Promise<{inWindow: boolean, triggered: boolean, alreadyDone: boolean, taskId?: string}>}
 */
export async function scheduleDailyBackup(pool, { force = false } = {}) {
  const now = new Date();
  const inWindow = isInDailyBackupWindow(now);

  if (!inWindow && !force) {
    return { inWindow: false, triggered: false, alreadyDone: false };
  }

  try {
    const alreadyDone = await alreadyScheduledToday(pool);
    if (alreadyDone) {
      return { inWindow, triggered: false, alreadyDone: true };
    }

    const taskId = await createBackupTask(pool);
    console.log(`[daily-backup-scheduler] 每日备份任务已创建: taskId=${taskId}`);
    return { inWindow, triggered: true, alreadyDone: false, taskId };
  } catch (err) {
    console.error(`[daily-backup-scheduler] 创建备份任务失败: ${err.message}`);
    return { inWindow, triggered: false, alreadyDone: false, error: err.message };
  }
}
