/**
 * Startup Sync Tests
 * Tests for Brain startup state reconciliation with actual processes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockPool = {
  query: vi.fn(),
};
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

const { syncOrphanTasksOnStartup } = await import('../executor.js');

describe('syncOrphanTasksOnStartup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          payload: { current_run_id: 'run-orphan-123' },
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
    const payload = JSON.parse(updateCall[1][1]);
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
