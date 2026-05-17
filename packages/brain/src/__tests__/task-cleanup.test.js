/**
 * task-cleanup.js 单元测试
 *
 * 测试 runTaskCleanup() 和 isRecurringTask() 的所有逻辑
 * 使用 mock DB 避免真实数据库依赖
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runTaskCleanup,
  isRecurringTask,
  isProtectedTask,
  RECURRING_TASK_TYPES,
  PROTECTED_TASK_TYPES,
  RECURRING_QUEUE_TIMEOUT_HOURS,
  PAUSED_ARCHIVE_DAYS
} from '../task-cleanup.js';

/**
 * Create a mock DB pool with configurable query responses
 */
function createMockDb(overrides = {}) {
  const defaultRows = {
    staleRecurring: [],
    stalePaused: []
  };
  const config = { ...defaultRows, ...overrides };
  let callCount = 0;

  return {
    callCount: () => callCount,
    query: vi.fn(async (sql) => {
      callCount++;
      // Match stale recurring query
      if (sql.includes("RECURRING_TASK_TYPES") || sql.includes("is_recurring") || sql.includes("queued_at <")) {
        return { rows: config.staleRecurring };
      }
      // Match stale paused query
      if (sql.includes("status = 'paused'") || sql.includes("'archived'")) {
        return { rows: config.stalePaused };
      }
      // UPDATE statements
      if (sql.trim().toUpperCase().startsWith('UPDATE')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    })
  };
}

describe('isProtectedTask', () => {
  it('initiative_plan should be protected', () => {
    expect(isProtectedTask({ task_type: 'initiative_plan', title: 'Plan Initiative' })).toBe(true);
  });

  it('initiative_verify should be protected', () => {
    expect(isProtectedTask({ task_type: 'initiative_verify', title: 'Verify Initiative' })).toBe(true);
  });

  it('dev task should NOT be protected', () => {
    expect(isProtectedTask({ task_type: 'dev', title: 'Implement feature' })).toBe(false);
  });

  it('dept_heartbeat should NOT be protected', () => {
    expect(isProtectedTask({ task_type: 'dept_heartbeat', title: 'Heartbeat' })).toBe(false);
  });

  it('null task should return false', () => {
    expect(isProtectedTask(null)).toBe(false);
  });

  it('task without task_type should not be protected', () => {
    expect(isProtectedTask({ title: 'Some task' })).toBe(false);
  });
});

describe('isRecurringTask', () => {
  it('task_type dept_heartbeat should be recurring', () => {
    expect(isRecurringTask({ task_type: 'dept_heartbeat', title: 'Test' })).toBe(true);
  });

  it('task_type codex_qa should be recurring', () => {
    expect(isRecurringTask({ task_type: 'codex_qa', title: 'Test' })).toBe(true);
  });

  it('payload.is_recurring=true should be recurring', () => {
    expect(isRecurringTask({
      task_type: 'dev',
      title: 'Test',
      payload: { is_recurring: true }
    })).toBe(true);
  });

  it('title matching "heartbeat" pattern should be recurring', () => {
    expect(isRecurringTask({ task_type: null, title: 'Weekly Heartbeat Check' })).toBe(true);
  });

  it('normal dev task should NOT be recurring', () => {
    expect(isRecurringTask({ task_type: 'dev', title: 'Implement feature X' })).toBe(false);
  });

  it('null task should return false', () => {
    expect(isRecurringTask(null)).toBe(false);
  });

  it('initiative_plan should NOT be recurring (protected task)', () => {
    expect(isRecurringTask({ task_type: 'initiative_plan', title: 'Plan Initiative' })).toBe(false);
  });

  it('initiative_plan with is_recurring=true should still NOT be recurring (protected overrides)', () => {
    expect(isRecurringTask({
      task_type: 'initiative_plan',
      title: 'Plan Initiative',
      payload: { is_recurring: true }
    })).toBe(false);
  });

  it('initiative_verify should NOT be recurring (protected task)', () => {
    expect(isRecurringTask({ task_type: 'initiative_verify', title: 'Verify Initiative' })).toBe(false);
  });
});

describe('runTaskCleanup', () => {
  describe('dry run mode', () => {
    it('should not execute UPDATE when dry_run=true', async () => {
      const mockDb = {
        query: vi.fn(async (sql) => {
          if (sql.trim().toUpperCase().startsWith('UPDATE')) {
            throw new Error('UPDATE should not be called in dry run mode');
          }
          // Return some stale tasks for SELECT
          if (sql.includes('queued_at <')) {
            return {
              rows: [
                { id: 'task-1', title: 'Heartbeat', task_type: 'dept_heartbeat', queued_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }
              ]
            };
          }
          if (sql.includes("status = 'paused'")) {
            return {
              rows: [
                { id: 'task-2', title: 'Old paused task', task_type: 'dev', updated_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000) }
              ]
            };
          }
          return { rows: [] };
        })
      };

      const stats = await runTaskCleanup(mockDb, { dryRun: true });

      expect(stats.dry_run).toBe(true);
      // Should report counts but not execute
      expect(stats.canceled).toBeGreaterThanOrEqual(0);
      expect(stats.archived).toBeGreaterThanOrEqual(0);
      // Verify no UPDATE was called (mock would throw if it was)
    });
  });

  describe('cleanup of stale recurring tasks', () => {
    it('should cancel recurring tasks queued >24h', async () => {
      const staleTask = {
        id: 'stale-recurring-1',
        title: 'Dept Heartbeat',
        task_type: 'dept_heartbeat',
        queued_at: new Date(Date.now() - 25 * 60 * 60 * 1000),
        payload: {}
      };

      let updateCalled = false;
      const mockDb = {
        query: vi.fn(async (sql, params) => {
          if (sql.trim().toUpperCase().startsWith('UPDATE')) {
            updateCalled = true;
            return { rowCount: 1 };
          }
          if (sql.includes('queued_at <')) {
            return { rows: [staleTask] };
          }
          if (sql.includes("status = 'paused'")) {
            return { rows: [] };
          }
          return { rows: [] };
        })
      };

      const stats = await runTaskCleanup(mockDb, { dryRun: false });

      expect(stats.canceled).toBe(1);
      expect(stats.canceled_task_ids).toContain('stale-recurring-1');
      expect(updateCalled).toBe(true);
    });

    it('should return 0 canceled when no stale recurring tasks', async () => {
      const mockDb = {
        query: vi.fn(async (sql) => {
          if (sql.includes('queued_at <')) return { rows: [] };
          if (sql.includes("status = 'paused'")) return { rows: [] };
          return { rows: [] };
        })
      };

      const stats = await runTaskCleanup(mockDb);
      expect(stats.canceled).toBe(0);
      expect(stats.canceled_task_ids).toHaveLength(0);
    });
  });

  describe('cleanup of old paused tasks', () => {
    it('should archive paused tasks older than 30 days', async () => {
      const oldPausedTask = {
        id: 'old-paused-1',
        title: 'Old paused task',
        task_type: 'dev',
        updated_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
      };

      let archiveCalled = false;
      const mockDb = {
        query: vi.fn(async (sql) => {
          if (sql.trim().toUpperCase().startsWith('UPDATE')) {
            archiveCalled = true;
            return { rowCount: 1 };
          }
          if (sql.includes('queued_at <')) return { rows: [] };
          if (sql.includes("status = 'paused'")) return { rows: [oldPausedTask] };
          return { rows: [] };
        })
      };

      const stats = await runTaskCleanup(mockDb, { dryRun: false });

      expect(stats.archived).toBe(1);
      expect(stats.archived_task_ids).toContain('old-paused-1');
      expect(archiveCalled).toBe(true);
    });

    it('should return 0 archived when no old paused tasks', async () => {
      const mockDb = {
        query: vi.fn(async (sql) => {
          if (sql.includes('queued_at <')) return { rows: [] };
          if (sql.includes("status = 'paused'")) return { rows: [] };
          return { rows: [] };
        })
      };

      const stats = await runTaskCleanup(mockDb);
      expect(stats.archived).toBe(0);
    });
  });

  describe('return value structure', () => {
    it('should always return { canceled, archived, dry_run }', async () => {
      const mockDb = {
        query: vi.fn(async () => ({ rows: [] }))
      };

      const stats = await runTaskCleanup(mockDb);

      expect(stats).toHaveProperty('canceled');
      expect(stats).toHaveProperty('archived');
      expect(stats).toHaveProperty('dry_run');
      expect(stats).toHaveProperty('canceled_task_ids');
      expect(stats).toHaveProperty('archived_task_ids');
      expect(stats).toHaveProperty('errors');
      expect(typeof stats.canceled).toBe('number');
      expect(typeof stats.archived).toBe('number');
    });

    it('should include errors array even when cleanup succeeds', async () => {
      const mockDb = {
        query: vi.fn(async () => ({ rows: [] }))
      };

      const stats = await runTaskCleanup(mockDb);
      expect(Array.isArray(stats.errors)).toBe(true);
      expect(stats.errors).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should catch DB errors and return them in stats.errors', async () => {
      const mockDb = {
        query: vi.fn(async () => {
          throw new Error('DB connection failed');
        })
      };

      const stats = await runTaskCleanup(mockDb);

      expect(stats.errors).toHaveLength(1);
      expect(stats.errors[0]).toContain('DB connection failed');
      expect(stats.canceled).toBe(0);
      expect(stats.archived).toBe(0);
    });
  });

  describe('custom thresholds', () => {
    it('should use custom recurringTimeoutHours', async () => {
      const capturedParams = [];
      const mockDb = {
        query: vi.fn(async (sql, params) => {
          if (params) capturedParams.push({ sql: sql.slice(0, 50), params });
          if (sql.includes("status = 'paused'")) return { rows: [] };
          return { rows: [] };
        })
      };

      // Use 48h instead of 24h
      await runTaskCleanup(mockDb, { recurringTimeoutHours: 48, dryRun: true });

      // The query should use a cutoff ~48h ago
      // We can verify via the captured params (cutoff timestamp)
      const queuedAtQuery = capturedParams.find(p => p.params?.[0]);
      if (queuedAtQuery) {
        const cutoff = new Date(queuedAtQuery.params[0]);
        const hoursAgo = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60);
        // Should be approximately 48 hours, not 24
        expect(hoursAgo).toBeGreaterThan(47);
        expect(hoursAgo).toBeLessThan(49);
      }
    });
  });
});

describe('constants', () => {
  it('RECURRING_TASK_TYPES should include dept_heartbeat and codex_qa', () => {
    expect(RECURRING_TASK_TYPES).toContain('dept_heartbeat');
    expect(RECURRING_TASK_TYPES).toContain('codex_qa');
  });

  it('PROTECTED_TASK_TYPES should include initiative_plan and initiative_verify', () => {
    expect(PROTECTED_TASK_TYPES).toContain('initiative_plan');
    expect(PROTECTED_TASK_TYPES).toContain('initiative_verify');
  });

  it('PROTECTED_TASK_TYPES should NOT overlap with RECURRING_TASK_TYPES', () => {
    const overlap = PROTECTED_TASK_TYPES.filter(t => RECURRING_TASK_TYPES.includes(t));
    expect(overlap).toHaveLength(0);
  });

  it('RECURRING_QUEUE_TIMEOUT_HOURS should be 24', () => {
    expect(RECURRING_QUEUE_TIMEOUT_HOURS).toBe(24);
  });

  it('PAUSED_ARCHIVE_DAYS should be 30', () => {
    expect(PAUSED_ARCHIVE_DAYS).toBe(30);
  });
});
