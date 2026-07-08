#!/usr/bin/env node
/**
 * skill-eval-daemon.mjs — pm2 常驻 wrapper
 *
 * pm2 start 时不要加 --watch。该脚本本身就是一个无限循环：
 *   runOnce() → sleep POLL_INTERVAL_MS → repeat
 *
 * 停止：pm2 stop skill-eval-daemon
 *
 * 环境变量（可在 ecosystem.config.cjs 里覆盖）：
 *   EVAL_POLL_INTERVAL_MS  两次 runOnce 之间的休眠时间（默认 10000ms）
 *   EVAL_STUCK_TIMEOUT_MINUTES  running 超时回收阈值（默认 15 分钟，见 skill-eval-worker.js）
 */

import { runOnce } from './skill-eval-worker.js';
import pool from '../src/db.js';

const POLL_INTERVAL_MS = parseInt(process.env.EVAL_POLL_INTERVAL_MS || '10000', 10);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loop() {
  console.log('[skill-eval-daemon] 启动，轮询间隔', POLL_INTERVAL_MS, 'ms');
  while (true) {
    try {
      await runOnce();
    } catch (err) {
      console.error('[skill-eval-daemon] runOnce 未捕获异常:', err.message);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

loop().catch((err) => {
  console.error('[skill-eval-daemon] 循环崩溃:', err);
  pool.end().catch(() => {});
  process.exit(1);
});
