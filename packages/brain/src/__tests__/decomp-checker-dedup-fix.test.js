/**
 * decomp-checker-dedup-fix.test.js - OKR 统一版 (v2.0)
 *
 * 测试 hasExistingDecompositionTask（按 goal_id 去重）
 *
 * 去重窗口：24h 内的 completed/failed 任务仍然算"已存在"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

// Mock capacity.js
vi.mock('../capacity.js', () => ({
  computeCapacity: () => ({
    project: { max: 2, softMin: 1 },
    initiative: { max: 9, softMin: 3 },
    task: { queuedCap: 27, softMin: 9 },
  }),
  isAtCapacity: () => false,
}));

// Mock task-quality-gate.js
vi.mock('../task-quality-gate.js', () => ({
  validateTaskDescription: () => ({ valid: true, reasons: [] }),
}));

describe('hasExistingDecompositionTask (by goalId)', () => {
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
  });

  it('queued decomp task → returns true (blocks new creation)', async () => {
    const { hasExistingDecompositionTask } = await import('../decomposition-checker.js');

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'existing-queued' }]
    });

    const result = await hasExistingDecompositionTask('kr-1');
    expect(result).toBe(true);
  });

  it('in_progress decomp task → returns true', async () => {
    const { hasExistingDecompositionTask } = await import('../decomposition-checker.js');

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'existing-in-progress' }]
    });

    const result = await hasExistingDecompositionTask('kr-1');
    expect(result).toBe(true);
  });

  it('no decomp tasks → returns false (allows creation)', async () => {
    const { hasExistingDecompositionTask } = await import('../decomposition-checker.js');

    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await hasExistingDecompositionTask('kr-1');
    expect(result).toBe(false);
  });

  it('SQL query checks correct statuses and dedup window', async () => {
    const { hasExistingDecompositionTask } = await import('../decomposition-checker.js');

    pool.query.mockResolvedValueOnce({ rows: [] });

    await hasExistingDecompositionTask('kr-test');

    // Verify the query was called with goal_id
    const call = pool.query.mock.calls[0];
    expect(call[1]).toEqual(['kr-test']);

    // Verify SQL checks for decomposition flag, statuses, and dedup window
    const sql = call[0];
    expect(sql).toContain("payload->>'decomposition'");
    expect(sql).toContain('queued');
    expect(sql).toContain('in_progress');
    expect(sql).toContain('completed');
    expect(sql).toContain('24 hours'); // DEDUP_WINDOW_HOURS
  });
});

describe('canCreateDecompositionTask (WIP limit)', () => {
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
  });

  it('returns true when under WIP limit', async () => {
    const { canCreateDecompositionTask } = await import('../decomposition-checker.js');

    pool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await canCreateDecompositionTask();
    expect(result).toBe(true);
  });

  it('returns false when at WIP limit (3)', async () => {
    const { canCreateDecompositionTask } = await import('../decomposition-checker.js');

    pool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const result = await canCreateDecompositionTask();
    expect(result).toBe(false);
  });

  it('returns false when above WIP limit', async () => {
    const { canCreateDecompositionTask } = await import('../decomposition-checker.js');

    pool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });

    const result = await canCreateDecompositionTask();
    expect(result).toBe(false);
  });
});
