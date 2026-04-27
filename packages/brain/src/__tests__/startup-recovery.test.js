/**
 * startup-recovery.js 单元测试
 *
 * 覆盖：
 * - runStartupRecovery 不接受 pool 参数，不调用 pool.query
 * - 返回值只含 { worktrees_pruned, slots_freed, devmode_cleaned }
 * - 环境清理调用正常执行
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn().mockReturnValue('') }));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Mock cleanup-lock — fs mock 让真锁失败，pass-through 让单测走原路径
vi.mock('../utils/cleanup-lock.js', () => ({
  withLock: vi.fn(async (_opts, fn) => fn()),
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn(),
  LOCK_DIR_DEFAULT: '/tmp/cecelia-cleanup.lock',
}));

let runStartupRecovery;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../startup-recovery.js');
  runStartupRecovery = mod.runStartupRecovery;
});

describe('startup-recovery.js', () => {
  it('runStartupRecovery 不调用 pool.query（不接受 pool 参数）', async () => {
    const mockQuery = vi.fn();
    const mockPool = { query: mockQuery };

    // 即使传入 pool，也不应被调用（函数签名不再接受 pool）
    await runStartupRecovery(mockPool);

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('返回值包含 worktrees_pruned, slots_freed, devmode_cleaned，不含 requeued', async () => {
    const result = await runStartupRecovery();

    expect(result).toHaveProperty('worktrees_pruned');
    expect(result).toHaveProperty('slots_freed');
    expect(result).toHaveProperty('devmode_cleaned');
    expect(result).not.toHaveProperty('requeued');
    expect(result).not.toHaveProperty('error');
  });

  it('环境清理失败时不抛出异常，返回统计字段', async () => {
    const { execSync } = await import('child_process');
    execSync.mockImplementationOnce(() => { throw new Error('git error'); });

    const result = await runStartupRecovery();

    expect(result).toHaveProperty('worktrees_pruned');
    expect(result).toHaveProperty('slots_freed');
    expect(result).toHaveProperty('devmode_cleaned');
  });
});
