// worker-pool-dispatch.test.js — 并行血管P1：worker 池自动派发（任务 873acc6d）
// 原实现往宿主 tmux slot7-9 发射交互 claude 跑 /dev --task-id。
// 常量契约 / slot1-6 铁律 / 槽位判定与发射 / 并发上限 / 预占 / 队列扫描 / 5min 自 gate / 发射失败处理 /
// 第四病（僵尸检测 + 发射后探活）各组：已随 Claude 通道退役删除（任务 76a160b3）。
// 现行为：每轮只返回 skipped=claude_channel_retired，不查库、不预占、不执行任何命令。
import { describe, it, expect, vi } from 'vitest';
import { runWorkerPoolDispatch } from '../worker-pool-dispatch.js';

describe('worker 池派发（Claude 通道已退役）', () => {
  it('有 queued 的 parallel_worker 任务也不认领：返回 skipped=claude_channel_retired、dispatched=0，不查库不执行命令', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 't1', payload: { parallel_worker: true } }], rowCount: 1 })) };
    const execFn = vi.fn(() => '');
    const r = await runWorkerPoolDispatch(pool, { execFn });
    expect(r).toEqual({ skipped: 'claude_channel_retired', dispatched: 0 });
    expect(pool.query).not.toHaveBeenCalled();
    expect(execFn).not.toHaveBeenCalled();
  });

  it('连续调用每轮结果一致（不再有 5min 自 gate 状态）', async () => {
    const a = await runWorkerPoolDispatch({ query: vi.fn() });
    const b = await runWorkerPoolDispatch({ query: vi.fn() });
    expect(a).toEqual(b);
    expect(b.skipped).toBe('claude_channel_retired');
  });
});
