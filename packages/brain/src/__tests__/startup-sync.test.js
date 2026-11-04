/**
 * Startup Sync Tests
 * Tests for Brain startup state reconciliation with actual processes
 */

import { execSync } from 'child_process';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock pool — hoisted so executor.js always gets this mockPool regardless of module cache order
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

// 异步学习会触发模型/写入，测试仅验证孤儿结算，关闭该外部边界。
vi.mock('../auto-learning.js', () => ({ processExecutionAutoLearning: vi.fn() }));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '0'),
}));

// Mock task-router
vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us'),
}));

// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
let syncOrphanTasksOnStartup;
let executor;

beforeAll(async () => {
  vi.resetModules();
  executor = await import('../executor.js');
  syncOrphanTasksOnStartup = executor.syncOrphanTasksOnStartup;
});

describe('syncOrphanTasksOnStartup', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    for (const { taskId } of executor.getActiveProcesses()) executor.removeActiveProcess(taskId);
    vi.mocked(execSync).mockReset().mockReturnValue('0\n');
  });

  it('should do nothing when no in_progress tasks exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(0);
    expect(result.orphans_fixed).toBe(0);
    expect(result.rebuilt).toBe(0);
  });

  it('should mark orphan task as failed when no matching process', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // No matching process

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'orphan-1',
          title: 'Orphan Task',
          // watchdog_retry_count: 2 → 超过重试上限 → 直接 fail（不再 requeue）
          payload: { current_run_id: 'run-orphan-123', watchdog_retry_count: 2 },
          started_at: '2026-02-05T10:00:00Z'
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.orphans_fixed).toBe(1);

    // Verify the UPDATE was called with orphan_detected error
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'failed'");
    expect(updateCall[1][0]).toBe('orphan-1');
    expect(updateCall[1][1]).toContain('[orphan_detected]');
    const payload = JSON.parse(updateCall[1][2]);
    expect(payload.error_details.type).toBe('orphan_detected');
  });

  it('should rebuild activeProcess entry when process exists', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('1\n'); // Process found

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'alive-1',
        title: 'Alive Task',
        payload: { current_run_id: 'run-alive-456' },
        started_at: '2026-02-05T10:00:00Z'
      }]
    });

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(0);
    expect(result.rebuilt).toBe(1);
  });

  it('should requeue inline tasks without run_id rather than mark failed', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'no-runid-1',
          title: 'No RunId Task',
          // watchdog_retry_count: 2 → 超过重试上限 → 直接 fail
          payload: { watchdog_retry_count: 2 },
          started_at: '2026-02-05T10:00:00Z'
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.orphans_fixed).toBe(0);
    expect(result.requeued).toBe(1);
    const [sql, params] = mockPool.query.mock.calls[1];
    expect(sql).toContain("status = 'queued'");
    expect(params[0]).toBe('no-runid-1');
    expect(JSON.parse(params[1])).toEqual({ watchdog_retry_count: 0 });
  });

  it('should handle mixed alive and orphan tasks', async () => {
    const { execSync } = await import('child_process');
    // First call: process found (alive), Second call: no process (orphan)
    execSync
      .mockReturnValueOnce('1\n')  // alive
      .mockReturnValueOnce('0\n'); // dead

    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'alive-2',
            title: 'Alive',
            payload: { current_run_id: 'run-alive' },
            started_at: '2026-02-05T10:00:00Z'
          },
          {
            id: 'orphan-2',
            title: 'Orphan',
            // watchdog_retry_count: 2 → 超过重试上限 → 直接 fail
            payload: { current_run_id: 'run-dead', watchdog_retry_count: 2 },
            started_at: '2026-02-05T10:00:00Z'
          }
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE for orphan

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.orphans_fixed).toBe(1);
    expect(result.rebuilt).toBe(1);
  });
  it('should preserve a headed owner without querying host processes or updating task', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'headed-1', executor_kind: 'headed-session', claimed_by: 'remote-owner', payload: {} }] });
    const result = await syncOrphanTasksOnStartup();
    expect(result.external_skipped).toBe(1);
    expect(result.orphans_found).toBe(0);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    expect(execSync).not.toHaveBeenCalled();
  });

});
