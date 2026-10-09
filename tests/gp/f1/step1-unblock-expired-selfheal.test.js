// F1「工厂 · 开发闭环」步骤 1 —— 边：blocked 任务的 TTL 自愈必须真的在跑
//
// ── 根因（2026-09-07 核实）──
//
// Wave 2（2026-05-04）起 tick-loop.js 改调 runScheduler，executeTick() 从此再没被调用过。
// unblockExpiredTasks 只挂在 executeTick 体内（tick-runner.js:1039），于是**死了四个月**。
//
// 同期断在 executeTick 里的其他安全网都已被一条条接回独立循环——
// cleanupStaleClaims / checkStuckPipelines / autoFailTimedOutTasks / probeTaskLiveness
// 四条都在 recovery-loop 里跑着，唯独 TTL 自愈这条漏了。
//
// 实测代价：blocked 积压 217 个，其中 15 个 blocked_until 已过期本该自动回 queued，
// 最早一个卡自 7 月 12 日。这些任务不会有人去捞——TTL 自愈就是那个"人"。
//
// 这类 bug 的特征是**静默**：没有报错、没有告警，只是某件事再也不发生了。
// 所以守卫不能只测 unblockExpiredTasks 函数本身好不好使（它一直好使），
// 必须测「它有没有被一个活着的循环调用」。

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRecoveryOnce } from '../../../packages/brain/src/recovery-loop.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/brain/src');

describe('F1 step1 · TTL 自愈接在活着的循环上', () => {
  it('recovery-loop 会调用 unblockExpiredTasks', async () => {
    const unblockExpiredTasks = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const r = await runRecoveryOnce({
      dbPool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      cleanupStaleClaims: vi.fn().mockResolvedValue({ cleaned: 0 }),
      checkStuckPipelines: vi.fn().mockResolvedValue({ canceled: [] }),
      fetchInProgress: vi.fn().mockResolvedValue([]),
      autoFailTimedOutTasks: vi.fn().mockResolvedValue([]),
      probeTaskLiveness: vi.fn().mockResolvedValue([]),
      unblockExpiredTasks,
    });
    expect(unblockExpiredTasks).toHaveBeenCalledTimes(1);
    expect(r.blockedRecovered).toBe(2);
  });

  it('这条网抛错不影响其他四条（各自独立 try-catch）', async () => {
    const probeTaskLiveness = vi.fn().mockResolvedValue([{ id: 'x' }]);
    const r = await runRecoveryOnce({
      dbPool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      cleanupStaleClaims: vi.fn().mockResolvedValue({ cleaned: 1 }),
      checkStuckPipelines: vi.fn().mockResolvedValue({ canceled: [] }),
      fetchInProgress: vi.fn().mockResolvedValue([]),
      autoFailTimedOutTasks: vi.fn().mockResolvedValue([]),
      probeTaskLiveness,
      unblockExpiredTasks: vi.fn().mockRejectedValue(new Error('db down')),
    });
    expect(r.blockedRecovered).toBe(0);
    expect(r.staleReleased).toBe(1);
    expect(r.orphansRequeued).toBe(1); // 后面的网照跑
  });

  it('恢复数进可观测输出——全 0 也要打，才证明"我在跑"', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runRecoveryOnce({
      dbPool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      cleanupStaleClaims: vi.fn().mockResolvedValue({ cleaned: 0 }),
      checkStuckPipelines: vi.fn().mockResolvedValue({ canceled: [] }),
      fetchInProgress: vi.fn().mockResolvedValue([]),
      autoFailTimedOutTasks: vi.fn().mockResolvedValue([]),
      probeTaskLiveness: vi.fn().mockResolvedValue([]),
      unblockExpiredTasks: vi.fn().mockResolvedValue([]),
    });
    const line = spy.mock.calls.map((c) => String(c[0])).find((s) => s.includes('[recovery-loop]'));
    spy.mockRestore();
    expect(line).toContain('blockedRecovered=0');
  });
});

// 静默失效防复发：光测「函数被调用」还不够——这个 bug 的形态正是
// 「函数好好的，只是没人调它了」。所以再加一道源码守卫，盯住那个唯一的调用点。
describe('F1 step1 · 自愈不许再退回死代码', () => {
  it('unblockExpiredTasks 在 recovery-loop 里有调用点', () => {
    const src = readFileSync(join(SRC, 'recovery-loop.js'), 'utf8');
    expect(src).toContain('unblockExpiredTasks');
  });

  it('它不再只存在于废弃的 executeTick 里', () => {
    const alive = ['recovery-loop.js', 'scheduler-jobs.js', 'tick-scheduler.js', 'consciousness-loop.js']
      .filter((f) => {
        try { return readFileSync(join(SRC, f), 'utf8').includes('unblockExpiredTasks'); }
        catch { return false; }
      });
    expect(alive.length).toBeGreaterThan(0);
  });
});
