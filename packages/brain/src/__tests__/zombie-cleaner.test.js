/**
 * Tests for Zombie Cleaner — 资源免疫系统 Phase 1
 *
 * 覆盖：
 * - cleanZombieSlots: stale slot 清理（lock dir + worktree + DB 状态）
 * - detectOrphanTasks: 孤儿检测（in_progress > 4h，无进程）
 * - 边界条件: < 4h 不清理，有进程仅 warn
 * - getZombieStats: 24h 统计
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool (db.js)
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

// Mock event-bus
vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Mock emergency-cleanup
vi.mock('../emergency-cleanup.js', () => ({
  emergencyCleanup: vi.fn(() => ({
    worktree: true,
    lock: true,
    devMode: true,
    errors: [],
  })),
}));

import pool from '../db.js';
import { emit } from '../event-bus.js';
import { emergencyCleanup } from '../emergency-cleanup.js';
import {
  cleanZombieSlots,
  detectOrphanTasks,
  getZombieStats,
  _cleanHistory,
  ORPHAN_THRESHOLD_HOURS,
  ORPHAN_WARN_HOURS,
} from '../zombie-cleaner.js';

describe('zombie-cleaner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear history between tests
    _cleanHistory.splice(0, _cleanHistory.length);
  });

  describe('constants', () => {
    it('should have ORPHAN_THRESHOLD_HOURS = 4', () => {
      expect(ORPHAN_THRESHOLD_HOURS).toBe(4);
    });

    it('should have ORPHAN_WARN_HOURS = 8', () => {
      expect(ORPHAN_WARN_HOURS).toBe(8);
    });
  });

  describe('cleanZombieSlots', () => {
    it('should return empty array when no stale slots', async () => {
      const results = await cleanZombieSlots([]);
      expect(results).toEqual([]);
    });

    it('should return empty array for null input', async () => {
      const results = await cleanZombieSlots(null);
      expect(results).toEqual([]);
    });

    it('should call emergencyCleanup and update DB for each stale slot', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-1' }] });

      const staleSlots = [{ slot: 'slot-0', taskId: 'task-1' }];
      const results = await cleanZombieSlots(staleSlots);

      expect(emergencyCleanup).toHaveBeenCalledWith('task-1', 'slot-0');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tasks'),
        ['task-1', 'zombie_process_gone']
      );
      expect(results).toHaveLength(1);
      expect(results[0].taskId).toBe('task-1');
      expect(results[0].slot).toBe('slot-0');
      expect(results[0].cleaned).toBe(true);
      expect(results[0].dbUpdated).toBe(true);
      expect(results[0].errors).toEqual([]);
    });

    it('should emit zombie_cleaned event after cleanup', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-2' }] });

      await cleanZombieSlots([{ slot: 'slot-1', taskId: 'task-2' }]);

      expect(emit).toHaveBeenCalledWith('zombie_cleaned', 'zombie-cleaner', {
        task_id: 'task-2',
        slot: 'slot-1',
        cleaned: true,
        db_updated: true,
      });
    });

    it('should handle emergencyCleanup errors gracefully (continue to DB update)', async () => {
      emergencyCleanup.mockImplementationOnce(() => {
        throw new Error('cleanup failed');
      });
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-3' }] });

      const results = await cleanZombieSlots([{ slot: 'slot-2', taskId: 'task-3' }]);

      expect(results[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('cleanup failed')]));
      expect(results[0].dbUpdated).toBe(true); // DB update still happens
    });

    it('should handle DB errors gracefully (continue to emit)', async () => {
      pool.query.mockRejectedValueOnce(new Error('db error'));

      const results = await cleanZombieSlots([{ slot: 'slot-3', taskId: 'task-4' }]);

      expect(results[0].dbUpdated).toBe(false);
      expect(results[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('db error')]));
      // emit still called (even if db failed, cleaned=true from emergencyCleanup)
      expect(emit).toHaveBeenCalled();
    });

    it('should process multiple stale slots', async () => {
      pool.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 't1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 't2' }] });

      const staleSlots = [
        { slot: 'slot-0', taskId: 't1' },
        { slot: 'slot-1', taskId: 't2' },
      ];
      const results = await cleanZombieSlots(staleSlots);

      expect(results).toHaveLength(2);
      expect(emergencyCleanup).toHaveBeenCalledTimes(2);
    });

    it('should record to _cleanHistory when cleanup successful', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-5' }] });

      await cleanZombieSlots([{ slot: 'slot-4', taskId: 'task-5' }]);

      expect(_cleanHistory.length).toBe(1);
      expect(_cleanHistory[0].type).toBe('zombie');
    });

    it('should NOT record to history when both cleanup and db update fail', async () => {
      emergencyCleanup.mockReturnValueOnce({ worktree: false, lock: false, devMode: false, errors: ['err'] });
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // no rows updated

      await cleanZombieSlots([{ slot: 'slot-5', taskId: 'task-6' }]);

      expect(_cleanHistory.length).toBe(0);
    });
  });

  describe('detectOrphanTasks', () => {
    it('should return zero stats when no old in_progress tasks', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const stats = await detectOrphanTasks(new Map());
      expect(stats.orphans_fixed).toBe(0);
      expect(stats.warnings).toBe(0);
      expect(stats.errors).toBe(0);
    });

    it('should mark task as failed when in_progress > 4h and no process', async () => {
      const startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5h ago
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'orphan-1', title: 'Orphan task', started_at: startedAt }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'orphan-1' }] });

      const pidMap = new Map(); // empty — no active processes
      const stats = await detectOrphanTasks(pidMap);

      expect(pool.query).toHaveBeenNthCalledWith(2,
        expect.stringContaining('UPDATE tasks'),
        ['orphan-1', 'orphan_no_process']
      );
      expect(stats.orphans_fixed).toBe(1);
    });

    it('should emit orphan_detected event for each fixed orphan', async () => {
      const startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'orphan-2', title: 'Test task', started_at: startedAt }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'orphan-2' }] });

      await detectOrphanTasks(new Map());

      expect(emit).toHaveBeenCalledWith('orphan_detected', 'zombie-cleaner', expect.objectContaining({
        task_id: 'orphan-2',
        reason: 'orphan_no_process',
      }));
    });

    it('should NOT mark task as failed when it has an active process', async () => {
      const startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'active-1', title: 'Active task', started_at: startedAt }]
      });

      // pidMap contains this task — it has a live process
      const pidMap = new Map([['active-1', { pid: 1234, slot: 'slot-0' }]]);
      const stats = await detectOrphanTasks(pidMap);

      // No DB update call for the task
      expect(pool.query).toHaveBeenCalledTimes(1); // only the SELECT
      expect(stats.orphans_fixed).toBe(0);
    });

    it('should warn for task > 8h with active process (no kill)', async () => {
      const startedAt = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(); // 9h ago
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'long-1', title: 'Long task', started_at: startedAt }]
      });

      const pidMap = new Map([['long-1', { pid: 5678, slot: 'slot-1' }]]);
      const stats = await detectOrphanTasks(pidMap);

      expect(stats.warnings).toBe(1);
      expect(stats.orphans_fixed).toBe(0);
    });

    it('should NOT process tasks < 4h (boundary condition)', async () => {
      // The DB query filters by started_at < NOW() - 4h, so these wouldn't appear
      // Test that if somehow a task slips through, we don't process it incorrectly
      // (This is more of a DB-level test, but verify empty result handling)
      pool.query.mockResolvedValueOnce({ rows: [] });

      const stats = await detectOrphanTasks(new Map());
      expect(stats.orphans_fixed).toBe(0);
    });

    it('should handle DB errors gracefully', async () => {
      pool.query.mockRejectedValueOnce(new Error('connection lost'));

      const stats = await detectOrphanTasks(new Map());
      expect(stats.errors).toBe(1);
    });

    it('should record orphan events to _cleanHistory', async () => {
      const startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'orphan-3', title: 'Task', started_at: startedAt }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'orphan-3' }] });

      await detectOrphanTasks(new Map());

      expect(_cleanHistory.filter(e => e.type === 'orphan').length).toBe(1);
    });
  });

  describe('getZombieStats', () => {
    it('should return zero stats when no history', () => {
      const stats = getZombieStats();
      expect(stats.zombies_cleaned_24h).toBe(0);
      expect(stats.orphans_fixed_24h).toBe(0);
      expect(stats.last_cleanup_at).toBeNull();
    });

    it('should count zombie and orphan events separately', async () => {
      // 2 zombies: each cleanZombieSlots call needs 1 DB query (UPDATE)
      pool.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 't1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 't2' }] });
      await cleanZombieSlots([
        { slot: 'slot-0', taskId: 't1' },
        { slot: 'slot-1', taskId: 't2' },
      ]);

      // 1 orphan: detectOrphanTasks needs 2 DB queries (SELECT + UPDATE)
      const startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 't3', title: 'Task', started_at: startedAt }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 't3' }] });
      await detectOrphanTasks(new Map());

      const stats = getZombieStats();
      expect(stats.zombies_cleaned_24h).toBe(2);
      expect(stats.orphans_fixed_24h).toBe(1);
      expect(stats.last_cleanup_at).not.toBeNull();
    });

    it('should exclude events older than 24h', () => {
      // Manually inject an old event (> 24h ago)
      const oldTs = Date.now() - 25 * 60 * 60 * 1000;
      _cleanHistory.push({ type: 'zombie', ts: oldTs });
      _cleanHistory.push({ type: 'orphan', ts: oldTs });

      const stats = getZombieStats();
      expect(stats.zombies_cleaned_24h).toBe(0);
      expect(stats.orphans_fixed_24h).toBe(0);
      expect(stats.last_cleanup_at).toBeNull();
    });

    it('should return ISO string for last_cleanup_at when events exist', () => {
      _cleanHistory.push({ type: 'zombie', ts: Date.now() });

      const stats = getZombieStats();
      expect(stats.last_cleanup_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
