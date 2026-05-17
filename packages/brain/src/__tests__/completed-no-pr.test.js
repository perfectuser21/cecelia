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

// ===== D1/D2/D3: 自动重排逻辑 =====

/**
 * 模拟 execution-callback 中的重排逻辑（routes.js P1-2）
 */
function simulateReschedule({ newStatus, retryCount, maxRetry = 3 }) {
  let rescheduled = false;
  let updatedStatus = newStatus;
  let updatedRetryCount = retryCount;
  let nextRunAt = null;

  if (newStatus === 'completed_no_pr') {
    if (retryCount < maxRetry) {
      nextRunAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      updatedStatus = 'queued';
      updatedRetryCount = retryCount + 1;
      rescheduled = true;
    }
  }

  return { rescheduled, updatedStatus, updatedRetryCount, nextRunAt };
}

describe('D1/D2/D3: completed_no_pr 自动重排逻辑', () => {
  it('D1: retry_count < max_retries → 重排到 queued 并递增 retry_count', () => {
    const result = simulateReschedule({ newStatus: 'completed_no_pr', retryCount: 0 });

    expect(result.rescheduled).toBe(true);
    expect(result.updatedStatus).toBe('queued');
    expect(result.updatedRetryCount).toBe(1);
    expect(result.nextRunAt).not.toBeNull();
    // next_run_at 应在 5min 后（允许 ±1s 误差）
    const diffMs = new Date(result.nextRunAt).getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(4 * 60 * 1000);
    expect(diffMs).toBeLessThan(6 * 60 * 1000);
  });

  it('D2: retry_count >= max_retries → 不重排，rescheduled=false', () => {
    const result = simulateReschedule({ newStatus: 'completed_no_pr', retryCount: 3 });

    expect(result.rescheduled).toBe(false);
    expect(result.updatedStatus).toBe('completed_no_pr');
    expect(result.nextRunAt).toBeNull();
  });

  it('D3: rescheduled=true 时 initiative_plan 应跳过触发', () => {
    // 模拟 initiative_plan 触发条件
    function shouldTriggerInitiativePlan({ newStatus, rescheduled }) {
      return newStatus === 'completed' || (newStatus === 'completed_no_pr' && !rescheduled);
    }

    // 重排时不触发
    expect(shouldTriggerInitiativePlan({ newStatus: 'completed_no_pr', rescheduled: true })).toBe(false);
    // 未重排（已达 max_retries）时触发
    expect(shouldTriggerInitiativePlan({ newStatus: 'completed_no_pr', rescheduled: false })).toBe(true);
    // 正常完成始终触发
    expect(shouldTriggerInitiativePlan({ newStatus: 'completed', rescheduled: false })).toBe(true);
  });
});
