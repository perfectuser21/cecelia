/**
 * Liveness Probe Tests
 * Tests for process liveness detection and double-confirm pattern
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const {
  probeTaskLiveness,
  isRunIdProcessAlive,
  suspectProcesses,
  isProcessAlive,
} = await import('../executor.js');

describe('isRunIdProcessAlive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return false for null/empty runId', () => {
    expect(isRunIdProcessAlive(null)).toBe(false);
    expect(isRunIdProcessAlive('')).toBe(false);
    expect(isRunIdProcessAlive(undefined)).toBe(false);
  });

  it('should return true when process with runId exists', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValueOnce('1\n');
    expect(isRunIdProcessAlive('run-abc-123')).toBe(true);
  });

  it('should return false when no process with runId exists', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValueOnce('0\n');
    expect(isRunIdProcessAlive('run-abc-123')).toBe(false);
  });

  it('should return false when execSync throws', async () => {
    const { execSync } = await import('child_process');
    execSync.mockImplementationOnce(() => { throw new Error('fail'); });
    expect(isRunIdProcessAlive('run-abc-123')).toBe(false);
  });
});

describe('probeTaskLiveness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suspectProcesses.clear();
  });

  it('should return empty actions when no in_progress tasks', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const actions = await probeTaskLiveness();
    expect(actions).toEqual([]);
  });

  it('should mark task as suspect on first probe failure', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // No matching process

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-1',
        title: 'Test Task',
        payload: { current_run_id: 'run-dead-123', run_triggered_at: new Date(Date.now() - 120000).toISOString() },
        started_at: new Date(Date.now() - 120000).toISOString()
      }]
    });

    const actions = await probeTaskLiveness();
    expect(actions).toEqual([]); // No auto-fail on first probe
    expect(suspectProcesses.has('task-1')).toBe(true);
  });

  it('should auto-fail task on second probe failure (double-confirm)', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n');

    // Pre-populate suspect status
    suspectProcesses.set('task-2', {
      firstSeen: new Date(Date.now() - 10000).toISOString(),
      tickCount: 1
    });

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-2',
          title: 'Dead Task',
          payload: { current_run_id: 'run-dead-456', run_triggered_at: new Date(Date.now() - 120000).toISOString() },
          started_at: new Date(Date.now() - 120000).toISOString()
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE tasks SET status = 'failed'

    const actions = await probeTaskLiveness();
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('liveness_auto_fail');
    expect(actions[0].task_id).toBe('task-2');
    expect(suspectProcesses.has('task-2')).toBe(false); // Cleared after fail
  });

  it('should clear suspect status when process recovers', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('1\n'); // Process found

    suspectProcesses.set('task-3', {
      firstSeen: new Date().toISOString(),
      tickCount: 1
    });

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-3',
        title: 'Recovered Task',
        payload: { current_run_id: 'run-alive-789' },
        started_at: new Date(Date.now() - 60000).toISOString()
      }]
    });

    const actions = await probeTaskLiveness();
    expect(actions).toEqual([]);
    expect(suspectProcesses.has('task-3')).toBe(false);
  });

  it('should use grace period for recently dispatched tasks without run_id', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-4',
        title: 'New Task',
        payload: { run_triggered_at: new Date(Date.now() - 30000).toISOString() }, // 30s ago
        started_at: new Date(Date.now() - 30000).toISOString()
      }]
    });

    const actions = await probeTaskLiveness();
    expect(actions).toEqual([]); // Within 60s grace period
    expect(suspectProcesses.has('task-4')).toBe(false);
  });

  it('should NOT mark decomposition task as dead within 60min grace period', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // Process not found in ps

    const triggeredAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'decomp-task-1',
        title: 'Initiative 拆解: 丘脑路由',
        payload: {
          decomposition: 'true',
          current_run_id: 'run-decomp-123',
          run_triggered_at: triggeredAt,
        },
        started_at: triggeredAt,
      }]
    });

    const actions = await probeTaskLiveness();
    // Should NOT be suspect or failed — decomp grace period applies
    expect(actions).toEqual([]);
    expect(suspectProcesses.has('decomp-task-1')).toBe(false);
  });

  it('should still fail decomposition task after 60min grace period expires', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // Process not found in ps

    // Pre-populate suspect status
    suspectProcesses.set('decomp-task-2', {
      firstSeen: new Date(Date.now() - 10000).toISOString(),
      tickCount: 1
    });

    const triggeredAt = new Date(Date.now() - 65 * 60 * 1000).toISOString(); // 65 min ago (past grace)

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'decomp-task-2',
          title: 'Initiative 拆解: 老任务',
          payload: {
            decomposition: 'true',
            current_run_id: 'run-decomp-456',
            run_triggered_at: triggeredAt,
          },
          started_at: triggeredAt,
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE tasks SET status = 'failed'

    const actions = await probeTaskLiveness();
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('liveness_auto_fail');
    expect(actions[0].task_id).toBe('decomp-task-2');
  });
});
