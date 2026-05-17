/**
 * task-weight.js 单元测试
 *
 * 测试 calculateTaskWeight() 和 sortTasksByWeight() 函数的所有逻辑分支
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import {
  calculateTaskWeight,
  sortTasksByWeight,
  getTaskWeights,
  PRIORITY_BASE_SCORES,
  TASK_TYPE_ADJUSTMENTS,
  WAIT_BONUS_MAX,
  RETRY_BONUS_MAX
} from '../task-weight.js';

// Fixed "now" for deterministic tests
const FIXED_NOW = new Date('2026-03-02T10:00:00.000Z');

describe('calculateTaskWeight', () => {
  beforeEach(() => {
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('priority base score', () => {
    it('P0 task should have priority_score = 100', () => {
      const task = { priority: 'P0', queued_at: null, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.priority_score).toBe(100);
    });

    it('P1 task should have priority_score = 60', () => {
      const task = { priority: 'P1', queued_at: null, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.priority_score).toBe(60);
    });

    it('P2 task should have priority_score = 30', () => {
      const task = { priority: 'P2', queued_at: null, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.priority_score).toBe(30);
    });

    it('unknown priority should default to 30', () => {
      const task = { priority: 'P9', queued_at: null, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.priority_score).toBe(PRIORITY_BASE_SCORES['default']);
    });

    it('null priority should default to 30', () => {
      const task = { priority: null, queued_at: null, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.priority_score).toBe(30);
    });

    it('lowercase priority (p0) should work correctly', () => {
      const task = { priority: 'p0', queued_at: null, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.priority_score).toBe(100);
    });
  });

  describe('wait time bonus (queued_at)', () => {
    it('task queued 1 hour ago should get +2 wait bonus', () => {
      const queuedAt = new Date(FIXED_NOW.getTime() - 1 * 60 * 60 * 1000).toISOString();
      const task = { priority: 'P1', queued_at: queuedAt, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.wait_bonus).toBe(2);
    });

    it('task queued 10 hours ago should get +20 wait bonus', () => {
      const queuedAt = new Date(FIXED_NOW.getTime() - 10 * 60 * 60 * 1000).toISOString();
      const task = { priority: 'P1', queued_at: queuedAt, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.wait_bonus).toBe(20);
    });

    it('wait bonus should be capped at 40 (20+ hours)', () => {
      const queuedAt = new Date(FIXED_NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
      const task = { priority: 'P1', queued_at: queuedAt, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.wait_bonus).toBe(WAIT_BONUS_MAX);
    });

    it('task with null queued_at should fall back to created_at', () => {
      const createdAt = new Date(FIXED_NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
      const task = { priority: 'P1', queued_at: null, created_at: createdAt, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.wait_bonus).toBe(4);
    });

    it('task with no time fields should have 0 wait bonus', () => {
      const task = { priority: 'P1', queued_at: null, created_at: null, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.wait_bonus).toBe(0);
    });
  });

  describe('retry count bonus', () => {
    it('task with retry_count=0 should have 0 retry bonus', () => {
      const task = { priority: 'P1', queued_at: null, retry_count: 0, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.retry_bonus).toBe(0);
    });

    it('task with retry_count=1 should get +5 retry bonus', () => {
      const task = { priority: 'P1', queued_at: null, retry_count: 1, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.retry_bonus).toBe(5);
    });

    it('task with retry_count=3 should get +15 retry bonus', () => {
      const task = { priority: 'P1', queued_at: null, retry_count: 3, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.retry_bonus).toBe(15);
    });

    it('retry bonus should be capped at 20 (4+ retries)', () => {
      const task = { priority: 'P1', queued_at: null, retry_count: 10, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.retry_bonus).toBe(RETRY_BONUS_MAX);
    });

    it('retry_count from payload should be used', () => {
      const task = { priority: 'P1', queued_at: null, payload: { retry_count: 2 }, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.retry_bonus).toBe(10);
    });

    it('retry_count from metadata should be used as fallback', () => {
      const task = { priority: 'P1', queued_at: null, metadata: { retry_count: 1 }, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.retry_bonus).toBe(5);
    });

    it('null retry_count should give 0 retry bonus', () => {
      const task = { priority: 'P1', queued_at: null, retry_count: null, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.retry_bonus).toBe(0);
    });
  });

  describe('task type adjustment', () => {
    it('initiative_plan should get +20 type adjustment', () => {
      const task = { priority: 'P1', queued_at: null, task_type: 'initiative_plan' };
      const result = calculateTaskWeight(task);
      expect(result.type_adjustment).toBe(TASK_TYPE_ADJUSTMENTS['initiative_plan']);
      expect(result.type_adjustment).toBe(20);
    });

    it('dev task should get +10 type adjustment', () => {
      const task = { priority: 'P1', queued_at: null, task_type: 'dev' };
      const result = calculateTaskWeight(task);
      expect(result.type_adjustment).toBe(10);
    });

    it('dept_heartbeat should get -10 type adjustment', () => {
      const task = { priority: 'P1', queued_at: null, task_type: 'dept_heartbeat' };
      const result = calculateTaskWeight(task);
      expect(result.type_adjustment).toBe(-10);
    });

    it('unknown task_type should get 0 type adjustment', () => {
      const task = { priority: 'P1', queued_at: null, task_type: 'unknown_type' };
      const result = calculateTaskWeight(task);
      expect(result.type_adjustment).toBe(0);
    });

    it('null task_type should get 0 type adjustment', () => {
      const task = { priority: 'P1', queued_at: null, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.type_adjustment).toBe(0);
    });
  });

  describe('total weight calculation', () => {
    it('P0 task with no wait/retry/type should have weight=100', () => {
      const task = { priority: 'P0', queued_at: null, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.weight).toBe(100);
    });

    it('P1 task with 5h wait + 1 retry + dev type should have correct total', () => {
      const queuedAt = new Date(FIXED_NOW.getTime() - 5 * 60 * 60 * 1000).toISOString();
      const task = { priority: 'P1', queued_at: queuedAt, retry_count: 1, task_type: 'dev' };
      const result = calculateTaskWeight(task);
      // 60 (P1) + 10 (5h * 2) + 5 (1 retry) + 10 (dev) = 85
      expect(result.priority_score).toBe(60);
      expect(result.wait_bonus).toBe(10);
      expect(result.retry_bonus).toBe(5);
      expect(result.type_adjustment).toBe(10);
      expect(result.weight).toBe(85);
    });

    it('should include breakdown string', () => {
      const task = { priority: 'P0', queued_at: null, task_type: null };
      const result = calculateTaskWeight(task);
      expect(result.breakdown).toContain('priority(100)');
      expect(result.breakdown).toContain('= 100');
    });
  });

  describe('invalid input handling', () => {
    it('null task should return weight=0', () => {
      const result = calculateTaskWeight(null);
      expect(result.weight).toBe(0);
    });

    it('undefined task should return weight=0', () => {
      const result = calculateTaskWeight(undefined);
      expect(result.weight).toBe(0);
    });

    it('non-object task should return weight=0', () => {
      const result = calculateTaskWeight('string');
      expect(result.weight).toBe(0);
    });
  });
});

describe('sortTasksByWeight', () => {
  beforeEach(() => {
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should sort P0 before P1 before P2', () => {
    const tasks = [
      { id: '1', priority: 'P2', queued_at: null, task_type: null },
      { id: '2', priority: 'P0', queued_at: null, task_type: null },
      { id: '3', priority: 'P1', queued_at: null, task_type: null }
    ];
    const sorted = sortTasksByWeight(tasks);
    expect(sorted[0].id).toBe('2'); // P0
    expect(sorted[1].id).toBe('3'); // P1
    expect(sorted[2].id).toBe('1'); // P2
  });

  it('should use FIFO (queued_at) as tiebreaker for equal weights', () => {
    const earlier = new Date(FIXED_NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const later = new Date(FIXED_NOW.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const tasks = [
      { id: 'b', priority: 'P1', queued_at: later, task_type: null },
      { id: 'a', priority: 'P1', queued_at: earlier, task_type: null }
    ];
    const sorted = sortTasksByWeight(tasks);
    // Both have same priority but different wait times, so 'a' gets slightly higher weight
    // (2h wait = 4 bonus vs 1h wait = 2 bonus)
    // 'a' should come first due to higher wait_bonus
    expect(sorted[0].id).toBe('a');
  });

  it('initiative_plan should beat P1 dev task of same priority level', () => {
    const tasks = [
      { id: 'dev', priority: 'P1', queued_at: null, task_type: 'dev' },
      { id: 'plan', priority: 'P1', queued_at: null, task_type: 'initiative_plan' }
    ];
    const sorted = sortTasksByWeight(tasks);
    expect(sorted[0].id).toBe('plan'); // initiative_plan has +20 vs dev +10
  });

  it('should attach _weight to each task', () => {
    const tasks = [
      { id: '1', priority: 'P1', queued_at: null, task_type: null }
    ];
    const sorted = sortTasksByWeight(tasks);
    expect(sorted[0]._weight).toBeDefined();
    expect(sorted[0]._weight.weight).toBe(60);
  });

  it('empty array should return empty array', () => {
    expect(sortTasksByWeight([])).toEqual([]);
  });

  it('non-array input should return empty array', () => {
    expect(sortTasksByWeight(null)).toEqual([]);
    expect(sortTasksByWeight(undefined)).toEqual([]);
  });
});

describe('getTaskWeights', () => {
  it('should return weight info for each task', () => {
    const tasks = [
      { id: 'task1', title: 'Test Task', priority: 'P0', task_type: 'dev', queued_at: null }
    ];
    const weights = getTaskWeights(tasks);
    expect(weights).toHaveLength(1);
    expect(weights[0].id).toBe('task1');
    expect(weights[0].title).toBe('Test Task');
    expect(weights[0].weight).toBe(110); // 100 (P0) + 10 (dev)
  });

  it('non-array input should return empty array', () => {
    expect(getTaskWeights(null)).toEqual([]);
  });
});
