#!/usr/bin/env node
/**
 * skill-eval-daemon.js — skill-eval-worker 常驻 pm2 包装器
 *
 * 职责：
 *   1. 启动时先回收超时卡在 status='running' 的僵尸任务（进程崩溃/被杀留下的）
 *   2. 反复调用 runOnce() 轮询 pending 任务；没任务时 sleep POLL_INTERVAL_MS
 *   3. 任何单次错误不退出，继续循环（pm2 重启只兜最终 crash）
 *
 * pm2 启动：
 *   pm2 start packages/brain/scripts/skill-eval-daemon.js --name skill-eval-worker \
 *       --interpreter node --no-autorestart
 *   （循环在进程内，不需要 pm2 restart-delay / cron_restart）
 */

import { runOnce } from './skill-eval-worker.js';
import pool from '../src/db.js';

const POLL_INTERVAL_MS = parseInt(process.env.SKILL_EVAL_POLL_INTERVAL_MS || '5000', 10);
// 任务卡在 running 超过此分钟数 → 回收为 pending
const STUCK_RUNNING_TIMEOUT_MINUTES = parseInt(
  process.env.SKILL_EVAL_STUCK_TIMEOUT_MINUTES || '30',
  10
);

async function recoverStuckRunning() {
  const { rowCount } = await pool.query(
    `UPDATE skill_evals
     SET status = 'pending', updated_at = now()
     WHERE status = 'running'
       AND updated_at < now() - ($1 || ' minutes')::interval`,
    [String(STUCK_RUNNING_TIMEOUT_MINUTES)]
  );
  if (rowCount > 0) {
    console.log(`[skill-eval-daemon] 回收 ${rowCount} 个卡住 >=${STUCK_RUNNING_TIMEOUT_MINUTES}min 的 running 任务`);
  }
}

async function mainLoop() {
  console.log(
    `[skill-eval-daemon] 启动，poll_interval=${POLL_INTERVAL_MS}ms，stuck_timeout=${STUCK_RUNNING_TIMEOUT_MINUTES}min`
  );

  while (true) {
    try {
      await recoverStuckRunning();
      const result = await runOnce();
      if (!result) {
        // 没有 pending 任务，等一段再轮询
        await sleep(POLL_INTERVAL_MS);
      }
      // 有任务处理完毕 → 立即再取下一条（不 sleep）
    } catch (err) {
      console.error('[skill-eval-daemon] 循环错误（继续运行）:', err.message);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

mainLoop().catch((err) => {
  console.error('[skill-eval-daemon] 致命错误，进程退出:', err);
  pool.end().finally(() => process.exit(1));
});
