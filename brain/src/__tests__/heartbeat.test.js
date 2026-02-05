/**
 * Heartbeat Endpoint Tests
 * Tests for POST /api/brain/heartbeat
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

const { recordHeartbeat } = await import('../executor.js');

describe('recordHeartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update last_heartbeat for in_progress task', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-hb-1' }] });

    const result = await recordHeartbeat('task-hb-1', 'run-hb-1');
    expect(result.success).toBe(true);
    expect(result.message).toBe('Heartbeat recorded');

    // Verify the query updates payload with last_heartbeat
    const queryCall = mockPool.query.mock.calls[0];
    expect(queryCall[0]).toContain('last_heartbeat');
    expect(queryCall[0]).toContain("status = 'in_progress'");
  });

  it('should return failure for non-existent or non-in_progress task', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const result = await recordHeartbeat('task-nonexist', 'run-1');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('should include timestamp in heartbeat update', async () => {
    const before = new Date();
    mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-ts' }] });

    await recordHeartbeat('task-ts', 'run-ts');

    const queryParams = mockPool.query.mock.calls[0][1];
    const heartbeatTime = new Date(queryParams[1]); // second param is the timestamp
    expect(heartbeatTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});
