/**
 * prod-ordering-runner.mjs — 复现生产 boot 顺序的子进程：
 *   1) import dbos-runtime（生产入口，必须在此触发 durable workflow 注册）
 *   2) bootDurable() → DBOS.launch()
 *   3) launch 之后才驱动 routeDailyReport（= tick 时的真实顺序）
 *
 * 若 daily-report-durable.js 只被 router 的 lazy import() 在 launch 后首次加载，
 * registerStep/registerWorkflow 会抛 DBOSConflictingRegistrationError → 本 runner 非 0 退出。
 * 修复后（dbos-runtime 静态 import durable 模块，注册早于 launch）→ 0 退出。
 *
 * 关键：本 runner **绝不**在 launch 前显式 import daily-report-durable.js / router，
 * 全靠生产入口 dbos-runtime 的静态依赖把注册拉到 launch 之前——这才忠实复现生产形态。
 */

import pg from 'pg';
import { bootDurable } from '../dbos-runtime.js';

const TEST_DB_URL = process.env.TEST_DB_URL;
process.env.DBOS_DURABLE_ENABLED = 'true';
process.env.DATABASE_URL = TEST_DB_URL; // initDurable 用它当 systemDatabaseUrl

const pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 5 });

async function main() {
  // 1+2：生产 boot —— bootDurable 内 initDurable → configureDurableDeps（launch 前注入）→ launch
  const started = await bootDurable();
  if (!started) {
    console.error('[prod-ordering] bootDurable 返回 false（未启动 durable）');
    process.exit(2);
  }

  // 3：launch 之后才加载 router 并驱动（tick 真实顺序）。
  // 用窗口内时间 + 注入 sendFeishu 计数，确保真的跑到 workflow（而非被窗口守卫挡掉）。
  const { routeDailyReport } = await import('../daily-report-router.js');
  const { configureDurableDeps } = await import('../daily-report-durable.js');
  let feishuCount = 0;
  configureDurableDeps({ pool, sendFeishu: async () => { feishuCount += 1; } });

  // 窗口内时间（UTC 01:00），保证不被 skipped_window 挡
  const now = new Date('2026-06-21T01:00:00Z');
  const res = await routeDailyReport(pool, {}, now);
  console.log('[prod-ordering] route result:', JSON.stringify(res), 'feishu=', feishuCount);

  const { shutdownDurable } = await import('../dbos-runtime.js');
  await shutdownDurable();
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('[prod-ordering] FATAL:', e?.constructor?.name, '-', String(e?.message).slice(0, 200));
  process.exit(1);
});
