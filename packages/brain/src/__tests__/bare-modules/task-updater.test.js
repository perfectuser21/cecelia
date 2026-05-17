/**
 * Bare Module Test: task-updater.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

describe('task-updater module', () => {
  it('can be imported', async () => {
    const mod = await import('../../task-updater.js');
    expect(mod).toBeDefined();
  });

  it('exports updateTaskStatus function', async () => {
    const { updateTaskStatus } = await import('../../task-updater.js');
    expect(typeof updateTaskStatus).toBe('function');
  });

  it('exports updateTaskProgress function', async () => {
    const { updateTaskProgress } = await import('../../task-updater.js');
    expect(typeof updateTaskProgress).toBe('function');
  });

  it('exports broadcastTaskState function', async () => {
    const { broadcastTaskState } = await import('../../task-updater.js');
    expect(typeof broadcastTaskState).toBe('function');
  });
});
