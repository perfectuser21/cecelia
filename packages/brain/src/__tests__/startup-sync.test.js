/**
 * Startup Sync Tests
 * Tests for Brain startup state reconciliation with actual processes
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock pool — hoisted so executor.js always gets this mockPool regardless of module cache order
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '0'),
}));

// Mock task-router
vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => 'us'),
}));

// Mock platform-utils to control getDmesgInfo return value
const mockGetDmesgInfo = vi.hoisted(() => vi.fn(() => null));
vi.mock('../platform-utils.js', () => ({
  getDmesgInfo: mockGetDmesgInfo,
  getSwapUsedPct: vi.fn(() => 0),
  _resetCpuSampler: vi.fn(),
  countClaudeProcesses: vi.fn(() => 0),
  calculatePhysicalCapacity: vi.fn(() => 5),
}));

// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
let syncOrphanTasksOnStartup;

beforeAll(async () => {
  vi.resetModules();
  const executor = await import('../executor.js');
  syncOrphanTasksOnStartup = executor.syncOrphanTasksOnStartup;
});

describe('syncOrphanTasksOnStartup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetDmesgInfo.mockReturnValue(null);
  });

  it('should do nothing when no in_progress tasks exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(0);
    expect(result.orphans_fixed).toBe(0);
    expect(result.rebuilt).toBe(0);
  });

  it('should requeue orphan when reason is process_disappeared (Brain restart)', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // No matching process
    mockGetDmesgInfo.mockReturnValue(null); // No OOM info → defaults to process_disappeared

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'orphan-1',
          title: 'Orphan Task',
          payload: { current_run_id: 'run-orphan-123' },
          started_at: '2026-02-05T10:00:00Z'
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.orphans_fixed).toBe(1);

    // process_disappeared → queued (retryable)
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'queued'");
    expect(updateCall[1][1]).toBe('[requeued after brain restart] reason=process_disappeared');
  });

  it('should fail orphan when reason is oom_killed (system-level failure)', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // No matching process
    mockGetDmesgInfo.mockReturnValue('Out of memory: killed process 12345'); // OOM pattern

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'orphan-oom',
          title: 'OOM Task',
          payload: { current_run_id: 'run-oom-999' },
          started_at: '2026-02-05T10:00:00Z'
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.orphans_fixed).toBe(1);

    // oom_likely → failed (not retryable)
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'failed'");
    const payload = JSON.parse(updateCall[1][1]);
    expect(payload.error_details.type).toBe('orphan_detected');
    expect(payload.error_details.reason).toMatch(/oom/);
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

  it('should requeue tasks without run_id (process_disappeared by default)', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'no-runid-1',
          title: 'No RunId Task',
          payload: {},
          started_at: '2026-02-05T10:00:00Z'
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.orphans_fixed).toBe(1);
    // No OOM → process_disappeared → queued
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'queued'");
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
            payload: { current_run_id: 'run-dead' },
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
});
