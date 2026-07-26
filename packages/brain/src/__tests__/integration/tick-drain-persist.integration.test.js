/**
 * Tick Drain 持久化 Integration Test [BEHAVIOR]
 *
 * 真实事故（2026-07-19）：draining 状态此前只是 drain.js 里的内存变量，任何触发
 * Brain 容器重启的事件（最常见是 Gate3 部署）都会把它清零。同一 session 内，
 * 用户明确要求"停止后台自动派发"后，因合并 PR 触发的部署把 drain 静默清零、
 * tick 重新自动派发任务，反复复现 3 次。
 *
 * 本文件验证：drainTick() 激活后，即使进程重启（模拟：resetModules + 重新
 * import drain.js），draining 状态仍能从 DB 恢复——不再是纯内存态。
 *
 * 运行环境：CI brain-integration job（含真实 PostgreSQL 服务，见 ci.yml）。
 * 放在 src/__tests__/integration/ 下才会被该 job 的
 * `npx vitest run src/__tests__/integration/` 实际执行到——
 * 根目录 src/__tests__/tick-drain.test.js 在 vitest.config.js 的 unit shard
 * exclude 名单里，且不在任何 integration job 范围内，从未被 CI 跑过。
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

describe('Tick Drain 持久化跨重启存活', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM working_memory WHERE key = 'tick_draining'`);
    await pool.end();
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM working_memory WHERE key = 'tick_draining'`);
    vi.resetModules();
  });

  async function freshDrainModule() {
    vi.resetModules();
    return import('../../drain.js');
  }

  it('drainTick() 激活后，模拟进程重启（resetModules）再 restoreDrainState() 应恢复 draining=true', async () => {
    const drain1 = await freshDrainModule();
    const activateResult = await drain1.drainTick();
    expect(activateResult.draining).toBe(true);

    // 模拟重启：resetModules 后重新 import，内存态清零
    const drain2 = await freshDrainModule();
    expect(drain2.isDraining()).toBe(false);

    // Brain 启动时应调用的恢复函数
    await drain2.restoreDrainState();
    expect(drain2.isDraining()).toBe(true);
  });

  it('未激活过 drain 时，restoreDrainState() 不应把 draining 设为 true（无脏恢复）', async () => {
    const drain = await freshDrainModule();
    await drain.restoreDrainState();
    expect(drain.isDraining()).toBe(false);
  });

  it('drain 自动完成（无 in_progress 任务）后，重启不应再恢复出 draining=true', async () => {
    await pool.query("UPDATE tasks SET status = 'completed' WHERE status = 'in_progress'");

    const drain1 = await freshDrainModule();
    await drain1.drainTick();
    const status = await drain1.getDrainStatus(); // remaining=0 → auto-complete，应清库

    expect(status.draining).toBe(false);
    expect(status.drain_completed).toBe(true);

    const drain2 = await freshDrainModule();
    await drain2.restoreDrainState();
    expect(drain2.isDraining()).toBe(false);
  });

  it('cancelDrain() 后，重启不应再恢复出 draining=true', async () => {
    const drain1 = await freshDrainModule();
    await drain1.drainTick();
    await drain1.cancelDrain();

    const drain2 = await freshDrainModule();
    await drain2.restoreDrainState();
    expect(drain2.isDraining()).toBe(false);
  });
});
