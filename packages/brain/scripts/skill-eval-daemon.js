#!/usr/bin/env node
/**
 * skill-eval-daemon.js — Skill Evaluator 常驻 pm2 进程
 *
 * 包装 skill-eval-worker.runOnce() 做无限 loop：
 *   - 每轮先 reclaimStuckTasks()：把崩溃/被杀后卡在 running 的任务回退到 pending
 *   - 再 runOnce()：原子取一条 pending 并处理
 *   - 有任务处理完立即再循环（flush queue 优先）
 *   - 无任务则等 POLL_INTERVAL_MS 后再试
 *
 * pm2 管理：崩溃自动重启，日志由 pm2-logrotate 轮转
 *
 * 用法（pm2 ecosystem 里声明后 pm2 start ecosystem.config.cjs 即可）：
 *   node packages/brain/scripts/skill-eval-daemon.js
 *
 * 关键环境变量（与 skill-eval-worker.js 共用）：
 *   CLAUDE_BIN            claude 二进制路径（默认 /opt/homebrew/bin/claude）
 *   CLAUDE_CONFIG_DIR     claude 账号目录（默认 /Users/administrator/.claude-account2）
 *   EVAL_PROMPT_PATH      eval-prompt.txt 路径
 *   EVAL_PROXY_TOKEN      内部回调 token
 *   BRAIN_BASE_URL        Brain 地址（默认 http://localhost:5221）
 *   EVAL_POLL_INTERVAL_MS 无任务时轮询间隔毫秒（默认 10000）
 *   EVAL_STUCK_TIMEOUT_MINUTES running 超时分钟数（默认 15）
 */

import pool from '../src/db.js';
import { runOnce } from './skill-eval-worker.js';

const POLL_INTERVAL_MS = parseInt(process.env.EVAL_POLL_INTERVAL_MS || '10000', 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop() {
  console.log('[skill-eval-daemon] 启动，POLL_INTERVAL_MS=' + POLL_INTERVAL_MS);

  while (true) {
    try {
      // runOnce() 内部已含 reclaimStuckTasks()，无需额外调用
      const result = await runOnce();
      if (result === null) {
        // 无 pending 任务，等一轮再查
        await sleep(POLL_INTERVAL_MS);
      }
      // 有任务处理完立即再循环，清空队列
    } catch (err) {
      console.error('[skill-eval-daemon] 意外错误:', err.message);
      // 出错不退出，等一轮后重试（pm2 在极端情况下会重启）
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

// 优雅退出：等当前任务处理完再关库连接
let exiting = false;
process.on('SIGINT', () => { exiting = true; });
process.on('SIGTERM', () => { exiting = true; });

loop()
  .catch((err) => {
    console.error('[skill-eval-daemon] 致命错误，进程退出:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
