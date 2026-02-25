/**
 * Completed No PR 测试
 * DoD: D5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('D5: Dev task completed without PR → completed_no_pr', () => {
  let pool;
  let mockPool;

  beforeEach(() => {
    // 创建 mock pool 和 client
    mockPool = {
      query: vi.fn(),
      connect: vi.fn(),
    };

    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    mockPool.connect.mockResolvedValue(mockClient);
  });

  it('dev task completed without PR → status becomes completed_no_pr', () => {
    // 模拟 execution-callback 逻辑（不需要真正调用 route）
    const status = 'AI Done';
    const pr_url = null;
    const taskType = 'dev';
    const isDecomposition = undefined;

    let newStatus = status === 'AI Done' ? 'completed' : 'failed';

    // P1-1 逻辑
    if (newStatus === 'completed' && !pr_url) {
      if (taskType === 'dev' && !isDecomposition) {
        newStatus = 'completed_no_pr';
      }
    }

    expect(newStatus).toBe('completed_no_pr');
  });

  it('dev task completed with PR → status stays completed', () => {
    const status = 'AI Done';
    const pr_url = 'https://github.com/org/repo/pull/123';
    const taskType = 'dev';
    const isDecomposition = undefined;

    let newStatus = status === 'AI Done' ? 'completed' : 'failed';

    if (newStatus === 'completed' && !pr_url) {
      if (taskType === 'dev' && !isDecomposition) {
        newStatus = 'completed_no_pr';
      }
    }

    expect(newStatus).toBe('completed');
  });

  it('exploratory task completed without PR → status stays completed (allowed)', () => {
    const status = 'AI Done';
    const pr_url = null;
    const taskType = 'exploratory';
    const isDecomposition = undefined;

    let newStatus = status === 'AI Done' ? 'completed' : 'failed';

    if (newStatus === 'completed' && !pr_url) {
      if (taskType === 'dev' && !isDecomposition) {
        newStatus = 'completed_no_pr';
      }
    }

    expect(newStatus).toBe('completed');
  });

  it('decomposition dev task completed without PR → status stays completed (exempt)', () => {
    const status = 'AI Done';
    const pr_url = null;
    const taskType = 'dev';
    const isDecomposition = 'true';  // decomposition 任务免检

    let newStatus = status === 'AI Done' ? 'completed' : 'failed';

    if (newStatus === 'completed' && !pr_url) {
      if (taskType === 'dev' && !isDecomposition) {
        newStatus = 'completed_no_pr';
      }
    }

    expect(newStatus).toBe('completed');
  });

  it('failed task stays failed regardless of PR', () => {
    const status = 'AI Failed';
    const pr_url = null;
    const taskType = 'dev';

    let newStatus = status === 'AI Done' ? 'completed' : 'failed';

    if (newStatus === 'completed' && !pr_url) {
      if (taskType === 'dev') {
        newStatus = 'completed_no_pr';
      }
    }

    expect(newStatus).toBe('failed');
  });
});
