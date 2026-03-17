/**
 * startup-recovery.js 单元测试
 *
 * 覆盖：
 * - runStartupRecovery 不调用 pool.query（DB 孤儿恢复已移至 executor.js::syncOrphanTasksOnStartup）
 * - 返回值包含 worktrees_pruned, slots_freed, devmode_cleaned 字段
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

let runStartupRecovery;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../startup-recovery.js');
  runStartupRecovery = mod.runStartupRecovery;
});

describe('startup-recovery.js', () => {
  it('不接受 pool 参数，不调用 pool.query', async () => {
    const mockQuery = vi.fn();
    const mockPool = { query: mockQuery };

    // runStartupRecovery 签名已移除 pool 参数，即使传入也不应调用
    const result = await runStartupRecovery(mockPool);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(result).toHaveProperty('worktrees_pruned');
    expect(result).toHaveProperty('slots_freed');
    expect(result).toHaveProperty('devmode_cleaned');
  });

  it('返回值不含 requeued 字段（DB 恢复由 syncOrphanTasksOnStartup 负责）', async () => {
    const result = await runStartupRecovery();

    expect(result).not.toHaveProperty('requeued');
    expect(result).not.toHaveProperty('error');
  });
});
