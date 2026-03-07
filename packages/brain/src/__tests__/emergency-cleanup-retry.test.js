/**
 * emergency-cleanup.js 重试机制单元测试
 *
 * 覆盖：
 * - getCleanupStats: 返回累计统计
 * - emergencyCleanup 重试机制：步骤失败重试，成功时统计 retried
 * - 重试耗尽后调用 emit cleanup_failed
 * - 统计 total_calls / success / failed 累计
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { existsSync, readFileSync, rmSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

// Import after mocks are established
const { emergencyCleanup, getCleanupStats } = await import('../emergency-cleanup.js');

describe('getCleanupStats', () => {
  it('返回包含 total_calls, success, failed, retried 的对象', () => {
    const stats = getCleanupStats();
    expect(stats).toHaveProperty('total_calls');
    expect(stats).toHaveProperty('success');
    expect(stats).toHaveProperty('failed');
    expect(stats).toHaveProperty('retried');
    expect(typeof stats.total_calls).toBe('number');
    expect(typeof stats.success).toBe('number');
    expect(typeof stats.failed).toBe('number');
    expect(typeof stats.retried).toBe('number');
  });
});

describe('emergencyCleanup 重试机制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('所有步骤一次成功：success +1，不调用 emit', () => {
    const infoJson = JSON.stringify({ task_id: 'task-ok', pid: 1, worktree_path: '/tmp/wt-ok' });
    existsSync.mockImplementation(path => {
      if (path.includes('info.json')) return true;
      if (path.includes('wt-ok')) return true;
      if (path.includes('.dev-mode')) return true;
      if (path.includes('slot-ok')) return true;
      return false;
    });
    readFileSync.mockReturnValue(infoJson);
    execSync.mockReturnValue('');
    rmSync.mockReturnValue(undefined);

    const mockEmit = vi.fn();
    const statsBefore = getCleanupStats();
    emergencyCleanup('task-ok', 'slot-ok', { emit: mockEmit, maxRetries: 2, retryDelayMs: 0 });
    const statsAfter = getCleanupStats();

    expect(statsAfter.total_calls).toBe(statsBefore.total_calls + 1);
    expect(statsAfter.success).toBe(statsBefore.success + 1);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('步骤第一次失败第二次成功：retried +1', () => {
    const infoJson = JSON.stringify({ task_id: 'task-retry', worktree_path: '/tmp/wt-retry' });
    existsSync.mockImplementation(path => {
      if (path.includes('info.json')) return true;
      if (path.includes('wt-retry')) return true;
      if (path.includes('.dev-mode')) return true;
      if (path.includes('slot-retry')) return true;
      return false;
    });
    readFileSync.mockReturnValue(infoJson);
    execSync.mockReturnValue('');

    // rmSync: first call (devMode) success, second call (worktree rm via git throws + manual rm)
    // Let's make git worktree remove throw once, then succeed
    let execCallCount = 0;
    execSync.mockImplementation(() => {
      execCallCount++;
      if (execCallCount === 1) throw new Error('git locked'); // worktree remove fails
      return '';
    });
    rmSync.mockReturnValue(undefined); // manual rm succeeds

    const statsBefore = getCleanupStats();
    emergencyCleanup('task-retry', 'slot-retry', { emit: null, maxRetries: 2, retryDelayMs: 0 });
    const statsAfter = getCleanupStats();

    // total_calls increases
    expect(statsAfter.total_calls).toBe(statsBefore.total_calls + 1);
  });

  it('重试耗尽后调用 emit cleanup_failed', () => {
    const infoJson = JSON.stringify({ task_id: 'task-fail', worktree_path: '/tmp/wt-fail' });
    existsSync.mockImplementation(path => {
      if (path.includes('info.json')) return true;
      if (path.includes('wt-fail')) return true;
      if (path.includes('.dev-mode')) return true;
      if (path.includes('slot-fail')) return true;
      return false;
    });
    readFileSync.mockReturnValue(infoJson);

    // Make all execSync calls fail → worktree step will exhaust retries
    execSync.mockImplementation(() => { throw new Error('persistent git error'); });
    // Also make rmSync fail for worktree manual fallback
    rmSync.mockImplementation((path) => {
      if (path.includes('wt-fail')) throw new Error('permission denied');
      // slot rm succeeds
    });

    const mockEmit = vi.fn();
    const statsBefore = getCleanupStats();
    const result = emergencyCleanup('task-fail', 'slot-fail', { emit: mockEmit, maxRetries: 1, retryDelayMs: 0 });
    const statsAfter = getCleanupStats();

    expect(result.errors.length).toBeGreaterThan(0);
    expect(mockEmit).toHaveBeenCalledWith(
      'cleanup_failed',
      'emergency-cleanup',
      expect.objectContaining({ step: 'worktree', error: expect.any(String) })
    );
    expect(statsAfter.failed).toBe(statsBefore.failed + 1);
  });

  it('worktreePath 不存在时：不执行 worktree/devMode 清理', () => {
    existsSync.mockReturnValue(false);

    const result = emergencyCleanup('task-nopath', 'slot-nopath', { maxRetries: 0, retryDelayMs: 0 });

    expect(result.worktree).toBe(false);
    expect(result.devMode).toBe(false);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('emit 函数本身抛出时：不影响主流程', () => {
    existsSync.mockReturnValue(false);

    const badEmit = vi.fn().mockImplementation(() => { throw new Error('emit crash'); });

    expect(() => {
      emergencyCleanup('task-emit-crash', 'slot-x', { emit: badEmit, maxRetries: 0, retryDelayMs: 0 });
    }).not.toThrow();
  });
});
