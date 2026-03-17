/**
 * Test: syncOrphanTasksOnStartup requeue 行为
 *
 * DoD 映射：
 * - 可重试孤儿（watchdog_retry_count=0, no error_message）→ status='queued'
 * - 超重试限制（watchdog_retry_count >= QUARANTINE_AFTER_KILLS）→ status='failed'
 * - 已有 error_message 的孤儿 → status='failed'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDmesgInfo } from '../platform-utils.js';

// Mock 所有 executor.js 的外部依赖（无 DB 模式）
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn()
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '')
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0'),
  existsSync: vi.fn(() => false)
}));

vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => 'us')
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { EXECUTOR: 'executor' },
  STATUS: { START: 'start', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US: 'us', HK: 'hk' }
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn()
}));

vi.mock('../auto-learning.js', () => ({
  processExecutionAutoLearning: vi.fn()
}));

vi.mock('../platform-utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listProcessesWithPpid: vi.fn(() => []),
    listProcessesWithElapsed: vi.fn(() => []),
    getMacOSMemoryPressure: vi.fn(() => 0),
    getAvailableMemoryMB: vi.fn(() => 8000),
    calculatePhysicalCapacity: vi.fn(() => 4),
    countClaudeProcesses: vi.fn(() => 0),
    sampleCpuUsage: vi.fn(() => 0),
    getSwapUsedPct: vi.fn(() => 0),
    getDmesgInfo: vi.fn(() => ''),
  };
});

describe('syncOrphanTasksOnStartup requeue 行为', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('可重试孤儿（watchdog_retry_count=0, no error_message）→ requeue', async () => {
    // SELECT in_progress tasks — 返回一个可重试孤儿
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'retryable-orphan-1',
          title: 'retryable task',
          payload: { current_run_id: null, watchdog_retry_count: 0 },
          started_at: new Date().toISOString(),
          error_message: null,
        }]
      });

    // checkExitReason 内部查询，以及 requeue UPDATE，都返回空
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { syncOrphanTasksOnStartup } = await import('../executor.js');
    const result = await syncOrphanTasksOnStartup();

    // 验证返回值包含 requeued 计数
    expect(result.requeued).toBe(1);
    expect(result.orphans_fixed).toBe(0);

    // 找到 status='queued' 的 UPDATE 调用
    const requeueCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes("status = 'queued'")
    );
    expect(requeueCall).toBeTruthy();

    const params = requeueCall[1];
    // $2 = error_message
    expect(params[1]).toBe('requeued after brain restart');
    // $3 = payload patch（watchdog_retry_count 递增到 1）
    const payloadPatch = JSON.parse(params[2]);
    expect(payloadPatch.watchdog_retry_count).toBe(1);
  });

  it('超重试限制（watchdog_retry_count >= 2）→ status=failed', async () => {
    // SELECT in_progress tasks — 返回一个已超重试限制的孤儿
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'exhausted-orphan-1',
          title: 'exhausted task',
          payload: { current_run_id: null, watchdog_retry_count: 2 },
          started_at: new Date().toISOString(),
          error_message: null,
        }]
      });

    // checkExitReason 内部查询以及 failed UPDATE
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { syncOrphanTasksOnStartup } = await import('../executor.js');
    const result = await syncOrphanTasksOnStartup();

    expect(result.orphans_fixed).toBe(1);
    expect(result.requeued).toBe(0);

    // 验证没有 status='queued' 的 UPDATE
    const requeueCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes("status = 'queued'")
    );
    expect(requeueCall).toBeUndefined();

    // 验证有 status='failed' 的 UPDATE
    const failedCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes("status = 'failed'")
    );
    expect(failedCall).toBeTruthy();
  });

  it('已有 error_message 的孤儿 → status=failed', async () => {
    // SELECT in_progress tasks — 已有 error_message（说明之前已知失败）
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'pre-error-orphan-1',
          title: 'pre-error task',
          payload: { current_run_id: null, watchdog_retry_count: 0 },
          started_at: new Date().toISOString(),
          error_message: 'previous failure reason',
        }]
      });

    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { syncOrphanTasksOnStartup } = await import('../executor.js');
    const result = await syncOrphanTasksOnStartup();

    expect(result.orphans_fixed).toBe(1);
    expect(result.requeued).toBe(0);

    // 验证没有 status='queued' 的 UPDATE
    const requeueCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes("status = 'queued'")
    );
    expect(requeueCall).toBeUndefined();
  });

  // 场景2：OOM/kill 标记的孤儿仍保持 failed，error_details 包含 OOM 原因
  it('场景2：OOM 孤儿（超重试限制 + dmesg OOM 信号）→ status=failed，error_details.reason 为 oom_likely', async () => {
    // 让 dmesg 返回 OOM 信号，checkExitReason 会检测到 oom_likely
    getDmesgInfo.mockReturnValueOnce('Out of memory: Kill process 1234 (node)\nKilled');

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'oom-orphan-1',
          title: 'OOM killed task',
          payload: { current_run_id: null, watchdog_retry_count: 2 },
          started_at: new Date().toISOString(),
          error_message: null,
        }]
      });

    // checkExitReason 内部查询 + failed UPDATE
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { syncOrphanTasksOnStartup } = await import('../executor.js');
    const result = await syncOrphanTasksOnStartup();

    expect(result.orphans_fixed).toBe(1);
    expect(result.requeued).toBe(0);

    // 验证 UPDATE 设置了 status='failed'
    const failedCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes("status = 'failed'")
    );
    expect(failedCall).toBeTruthy();

    // 验证 error_details.reason 为 oom 相关（oom_killed 或 oom_likely）
    const payloadPatch = JSON.parse(failedCall[1][1]);
    expect(['oom_killed', 'oom_likely']).toContain(payloadPatch.error_details.reason);
  });

  // 场景3：并发重启时无重复 requeue（SELECT WHERE status=in_progress 幂等保护）
  it('场景3：第二次调用 SELECT 返回空（任务已 queued）→ 不重复 requeue', async () => {
    const { syncOrphanTasksOnStartup } = await import('../executor.js');

    // 第一次调用：有一个可重试孤儿 → requeued=1
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'idempotent-task-1',
          title: 'idempotent task',
          payload: { current_run_id: null, watchdog_retry_count: 0 },
          started_at: new Date().toISOString(),
          error_message: null,
        }]
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const result1 = await syncOrphanTasksOnStartup();
    expect(result1.requeued).toBe(1);

    // 模拟第二次调用：SELECT WHERE status=in_progress 返回空（任务已被改为 queued）
    vi.clearAllMocks();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result2 = await syncOrphanTasksOnStartup();
    expect(result2.requeued).toBe(0);
    expect(result2.orphans_found).toBe(0);
  });
});
