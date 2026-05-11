/**
 * zombie-reaper.js — DB 层 zombie in_progress task 自动清理
 *
 * 背景：
 *   Brain dispatcher 依赖 task_pool available 槽位调度新任务。
 *   当 in_progress 任务 14+ 小时 updated_at 不更新（进程挂死/被杀/网络断开），
 *   任务状态卡在 in_progress，dispatcher available=0，新任务无法派发，形成死锁。
 *
 * 设计：
 *   每 ZOMBIE_REAPER_INTERVAL_MS（默认 5 min）扫一次 tasks 表。
 *   WHERE status='in_progress' AND updated_at < NOW() - INTERVAL '$idleMinutes minutes'
 *   → SET status='failed', error_message='[reaper] zombie: in_progress idle >Xmin'
 *
 * 配置：
 *   ZOMBIE_REAPER_IDLE_MIN      — idle 阈值（分钟），默认 60（B8: 30 太短，长 task 误判）
 *   ZOMBIE_REAPER_EXEMPT_TYPES  — 豁免 task_type 清单，逗号分隔（B8 新增）
 *
 * 安全：
 *   - 跑前打 log，标完打 log
 *   - 单任务 UPDATE 失败不影响其他任务（每行独立 try/catch）
 *   - 不做 retry 派发，只标 failed（YAGNI）
 *   - 不做飞书告警，只 console.warn（YAGNI）
 *   - B8: harness_* 系列豁免（GAN/generator 跑长，updated_at 不被 graph 内部活动 touch）
 */

import defaultPool from './db.js';

// ───── 配置 ─────
export const ZOMBIE_REAPER_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分钟扫一次
const DEFAULT_IDLE_MINUTES = parseInt(process.env.ZOMBIE_REAPER_IDLE_MIN || '60', 10);

// B8 (Walking Skeleton P1 cascade fix): 豁免天然长跑的 task_type。
// W29 实证：harness_initiative 跑 GAN + generator + CI 可达 1+ 小时；中间 LangGraph
// 节点 transition / 容器 spawn 不更新 tasks.updated_at（只 status 转换时变），reaper
// 看 updated_at 误判 active task 为 zombie。spawn 时序 31min 持续 + updated_at 41min
// 不变 → 被 reaper 误杀。
export const DEFAULT_EXEMPT_TASK_TYPES = (process.env.ZOMBIE_REAPER_EXEMPT_TYPES ||
  'harness_initiative,harness_task,harness_evaluate,harness_contract_propose,harness_contract_review,harness_planner,harness_generator'
).split(',').map(s => s.trim()).filter(Boolean);

/**
 * 扫描并标记 zombie in_progress tasks 为 failed。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool] - PostgreSQL 连接池（测试可注入 mock）
 * @param {number} [opts.idleMinutes] - idle 阈值（分钟，默认 ZOMBIE_REAPER_IDLE_MIN env 或 30）
 * @returns {Promise<{ reaped: number, scanned: number, errors: string[] }>}
 */
export async function reapZombies({ pool = defaultPool, idleMinutes = DEFAULT_IDLE_MINUTES, exemptTypes = DEFAULT_EXEMPT_TASK_TYPES } = {}) {
  const result = { reaped: 0, scanned: 0, errors: [] };

  console.log(`[zombie-reaper] Scanning for zombie in_progress tasks (idle > ${idleMinutes} min, exempt: ${exemptTypes.join(',')})...`);

  // SELECT: 找出所有超时 in_progress 任务（豁免 task_type 用 SQL NOT IN 提前过滤）
  let zombies;
  try {
    const selectResult = await pool.query(
      `SELECT id, title, task_type
       FROM tasks
       WHERE status = 'in_progress'
         AND updated_at < NOW() - INTERVAL '${idleMinutes} minutes'
         AND (task_type IS NULL OR task_type != ALL($1::text[]))
       ORDER BY updated_at ASC
       LIMIT 100`,
      [exemptTypes]
    );
    zombies = selectResult.rows;
    result.scanned = zombies.length;
  } catch (err) {
    const msg = `SELECT failed: ${err.message}`;
    result.errors.push(msg);
    console.error(`[zombie-reaper] ${msg}`);
    return result;
  }

  if (zombies.length === 0) {
    console.log('[zombie-reaper] No zombie tasks found.');
    return result;
  }

  console.warn(`[zombie-reaper] Found ${zombies.length} zombie task(s) — marking failed`);

  // UPDATE: 逐行标 failed（独立 try/catch，单行失败不阻断）
  for (const task of zombies) {
    try {
      await pool.query(
        `UPDATE tasks
         SET status = 'failed',
             error_message = $1,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2
           AND status = 'in_progress'`,
        [`[reaper] zombie: in_progress idle >${idleMinutes}min`, task.id]
      );
      result.reaped++;
      console.warn(
        `[zombie-reaper] Reaped zombie task id=${task.id} title=${JSON.stringify(task.title || '')}`
      );
    } catch (err) {
      const msg = `UPDATE failed for task ${task.id}: ${err.message}`;
      result.errors.push(msg);
      console.error(`[zombie-reaper] ${msg}`);
    }
  }

  console.log(
    `[zombie-reaper] Done: reaped=${result.reaped} scanned=${result.scanned} errors=${result.errors.length}`
  );

  return result;
}

/**
 * 启动 zombie reaper 定时器（每 ZOMBIE_REAPER_INTERVAL_MS 触发一次）。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool] - PostgreSQL 连接池（测试可注入 mock）
 * @param {number} [opts.idleMinutes] - idle 阈值（分钟）
 * @returns {NodeJS.Timeout} setInterval 返回的 timer ID
 */
export function startZombieReaper({ pool = defaultPool, idleMinutes = DEFAULT_IDLE_MINUTES, exemptTypes = DEFAULT_EXEMPT_TASK_TYPES } = {}) {
  const timer = setInterval(async () => {
    try {
      await reapZombies({ pool, idleMinutes, exemptTypes });
    } catch (err) {
      console.error('[zombie-reaper] Unexpected error during reap:', err.message);
    }
  }, ZOMBIE_REAPER_INTERVAL_MS);

  // 不阻止进程退出
  if (timer.unref) {
    timer.unref();
  }

  console.log(
    `[zombie-reaper] Started (interval=${ZOMBIE_REAPER_INTERVAL_MS}ms, idleThreshold=${idleMinutes}min)`
  );

  return timer;
}

export default { reapZombies, startZombieReaper, ZOMBIE_REAPER_INTERVAL_MS };
