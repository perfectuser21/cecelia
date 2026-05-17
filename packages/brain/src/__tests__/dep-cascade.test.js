import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db module
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

import { propagateDependencyFailure, recoverDependencyChain } from '../dep-cascade.js';

describe('propagateDependencyFailure', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('marks downstream tasks as dep_failed', async () => {
    // First call: find dependents of task-A
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-B', status: 'queued' }],
    });
    // Update task-B to dep_failed
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // Recurse: find dependents of task-B
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-C', status: 'queued' }],
    });
    // Update task-C to dep_failed
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // Recurse: find dependents of task-C (none)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await propagateDependencyFailure('task-A');

    expect(result.affected).toContain('task-B');
    expect(result.affected).toContain('task-C');
    expect(result.affected).toHaveLength(2);
  });

  it('skips already dep_failed tasks but still propagates', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-B', status: 'dep_failed' }],
    });
    // Recurse from task-B: no more dependents
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await propagateDependencyFailure('task-A');

    expect(result.affected).toHaveLength(0);
  });

  it('handles no dependents gracefully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await propagateDependencyFailure('task-lonely');

    expect(result.affected).toHaveLength(0);
  });
});

describe('recoverDependencyChain', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('recovers dep_failed tasks when all deps completed', async () => {
    // Find dep_failed tasks depending on completed-task
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-B', payload: { depends_on: ['task-A'], dep_failed_original_status: 'queued' } }],
    });
    // Check all deps of task-B are completed
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    // Update task-B to queued
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // Recurse: find dep_failed tasks depending on task-B (none)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await recoverDependencyChain('task-A');

    expect(result.recovered).toContain('task-B');
  });

  it('does not recover if other deps still pending', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-B', payload: { depends_on: ['task-A', 'task-X'] } }],
    });
    // task-X is not completed
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await recoverDependencyChain('task-A');

    expect(result.recovered).toHaveLength(0);
  });
});
