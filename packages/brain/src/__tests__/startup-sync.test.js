/**
 * Startup Sync Tests
 * Tests for Brain startup state reconciliation with actual processes
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'fs';

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

  afterEach(() => {
    try { rmSync('/tmp/cecelia-orphan-killed.log'); } catch (_) { /* ok */ }
  });

  it('should do nothing when no in_progress tasks exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(0);
    expect(result.orphans_fixed).toBe(0);
    expect(result.rebuilt).toBe(0);
  });

  it('process_disappeared → requeued as queued (Brain restart recovery)', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // No matching process

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'orphan-disappeared',
          title: 'Orphan Task',
          payload: { current_run_id: 'run-orphan-123' },
          started_at: '2026-02-05T10:00:00Z'
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.orphans_fixed).toBe(1);

    // process_disappeared → must be requeued, not failed
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'queued'");
    expect(updateCall[1][2]).toContain('[requeued after brain restart]');
    const payload = JSON.parse(updateCall[1][1]);
    expect(payload.error_details.reason).toBe('process_disappeared');
  });

  it('killed_signal → remains failed (not retryable)', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // No matching process

    // Write a log file with SIGKILL to trigger killed_signal reason
    const taskId = 'orphan-killed';
    writeFileSync(`/tmp/cecelia-${taskId}.log`, 'Process received SIGKILL signal\n');

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: taskId,
          title: 'Killed Task',
          payload: { current_run_id: 'run-killed-456' },
          started_at: '2026-02-05T10:00:00Z'
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

    const result = await syncOrphanTasksOnStartup();
    expect(result.orphans_found).toBe(1);
    expect(result.orphans_fixed).toBe(1);

    // killed_signal → must remain failed
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'failed'");
    const errorMsg = updateCall[1][2];
    expect(errorMsg).toContain('[orphan_detected]');
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

  it('should handle tasks without run_id as orphans', async () => {
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
