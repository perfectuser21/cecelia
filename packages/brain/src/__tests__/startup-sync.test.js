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
  });

  it('should do nothing when no in_progress tasks exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(0);
    expect(result.orphans_fixed).toBe(0);
    expect(result.rebuilt).toBe(0);
  });

  it('should requeue retryable orphan (retry_count < max_retries, no error_message)', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // No matching process

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'orphan-retry',
          title: 'Retryable Orphan Task',
          payload: { current_run_id: 'run-orphan-retry' },
          started_at: '2026-03-17T10:00:00Z',
          retry_count: 0,
          error_message: null,
          task_type: 'dev',
          max_retries: 3,
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE to queued

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.requeued).toBe(1);
    expect(result.orphans_fixed).toBe(0);

    // Verify UPDATE sets status = 'queued' and error_message = 'requeued after brain restart'
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'queued'");
    expect(updateCall[1][1]).toBe('requeued after brain restart');
    const requeuePayload = JSON.parse(updateCall[1][2]);
    expect(requeuePayload.requeue_info.reason).toBe('brain_restart');
    expect(requeuePayload.requeue_info.retry_count).toBe(1);
  });

  it('should mark orphan as failed when retry_count >= max_retries', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // No matching process

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'orphan-exhausted',
          title: 'Exhausted Orphan Task',
          payload: { current_run_id: 'run-orphan-exhausted' },
          started_at: '2026-03-17T10:00:00Z',
          retry_count: 3,
          error_message: null,
          task_type: 'dev',
          max_retries: 3,
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE to failed

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.orphans_fixed).toBe(1);
    expect(result.requeued).toBe(0);

    // Verify UPDATE sets status = 'failed' with orphan_detected
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'failed'");
    const payload = JSON.parse(updateCall[1][1]);
    expect(payload.error_details.type).toBe('orphan_detected');
  });

  it('should mark orphan as failed when error_message is non-empty', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // No matching process

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'orphan-errored',
          title: 'Previously Errored Task',
          payload: { current_run_id: 'run-orphan-errored' },
          started_at: '2026-03-17T10:00:00Z',
          retry_count: 1,
          error_message: 'previous error: something went wrong',
          task_type: 'dev',
          max_retries: 3,
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE to failed

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.orphans_fixed).toBe(1);
    expect(result.requeued).toBe(0);

    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'failed'");
  });

  it('should rebuild activeProcess entry when process exists', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('1\n'); // Process found

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'alive-1',
        title: 'Alive Task',
        payload: { current_run_id: 'run-alive-456' },
        started_at: '2026-02-05T10:00:00Z',
        retry_count: 0,
        error_message: null,
        task_type: 'dev',
        max_retries: 3,
      }]
    });

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(0);
    expect(result.rebuilt).toBe(1);
  });

  it('should handle tasks without run_id as retryable orphans (retry_count=0)', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'no-runid-1',
          title: 'No RunId Task',
          payload: {},
          started_at: '2026-02-05T10:00:00Z',
          retry_count: 0,
          error_message: null,
          task_type: 'dev',
          max_retries: 3,
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE to queued

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.requeued).toBe(1);
    expect(result.orphans_fixed).toBe(0);
  });

  it('should handle mixed: alive task + retryable orphan + exhausted orphan', async () => {
    const { execSync } = await import('child_process');
    // First call: process found (alive), Second call: no process (retryable), Third call: no process (exhausted)
    execSync
      .mockReturnValueOnce('1\n')  // alive
      .mockReturnValueOnce('0\n') // retryable orphan
      .mockReturnValueOnce('0\n'); // exhausted orphan

    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'alive-2',
            title: 'Alive',
            payload: { current_run_id: 'run-alive' },
            started_at: '2026-02-05T10:00:00Z',
            retry_count: 0,
            error_message: null,
            task_type: 'dev',
            max_retries: 3,
          },
          {
            id: 'orphan-retryable',
            title: 'Retryable Orphan',
            payload: { current_run_id: 'run-dead-retryable' },
            started_at: '2026-02-05T10:00:00Z',
            retry_count: 1,
            error_message: null,
            task_type: 'dev',
            max_retries: 3,
          },
          {
            id: 'orphan-exhausted',
            title: 'Exhausted Orphan',
            payload: { current_run_id: 'run-dead-exhausted' },
            started_at: '2026-02-05T10:00:00Z',
            retry_count: 3,
            error_message: null,
            task_type: 'dev',
            max_retries: 3,
          }
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE retryable → queued
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE exhausted → failed

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(2);
    expect(result.requeued).toBe(1);
    expect(result.orphans_fixed).toBe(1);
    expect(result.rebuilt).toBe(1);
  });
});
