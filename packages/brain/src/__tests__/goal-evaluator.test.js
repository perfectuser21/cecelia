/**
 * Goal Evaluator 测试 (Outer Loop)
 *
 * 测试覆盖：
 * - computeVerdict: on_track / needs_attention / stalled
 * - getGoalMetrics: DB 查询正确
 * - evaluateGoal: 写入 goal_evaluations 表
 * - evaluateGoalOuterLoop: 评估所有活跃 goals，每 goal 独立计时
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPool = { query: vi.fn() };
vi.mock('../db.js', () => ({ default: mockPool }));

// ── Tests: computeVerdict ─────────────────────────────────────────────────────

describe('computeVerdict', () => {
  let computeVerdict;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db.js', () => ({ default: mockPool }));
    const mod = await import('../goal-evaluator.js');
    computeVerdict = mod.computeVerdict;
  });

  it('returns on_track when completion rate is good', () => {
    expect(computeVerdict({
      task_completion_rate: 0.7,
      failure_rate: 0.1,
      total_tasks_7d: 10,
      days_since_last_progress: 1,
    })).toBe('on_track');
  });

  it('returns stalled when no progress for 7+ days', () => {
    expect(computeVerdict({
      task_completion_rate: 0.0,
      failure_rate: 0.0,
      total_tasks_7d: 5,
      days_since_last_progress: 8,
    })).toBe('stalled');
  });

  it('returns needs_attention when no tasks in 7 days', () => {
    expect(computeVerdict({
      task_completion_rate: 0,
      failure_rate: 0,
      total_tasks_7d: 0,
      days_since_last_progress: null,
    })).toBe('needs_attention');
  });

  it('returns needs_attention when failure rate is high', () => {
    expect(computeVerdict({
      task_completion_rate: 0.3,
      failure_rate: 0.5,
      total_tasks_7d: 10,
      days_since_last_progress: 2,
    })).toBe('needs_attention');
  });

  it('returns needs_attention when completion rate is low but not stalled', () => {
    expect(computeVerdict({
      task_completion_rate: 0.2,
      failure_rate: 0.1,
      total_tasks_7d: 5,
      days_since_last_progress: 3,
    })).toBe('needs_attention');
  });
});

// ── Tests: getGoalMetrics ─────────────────────────────────────────────────────

describe('getGoalMetrics', () => {
  let getGoalMetrics;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    vi.doMock('../db.js', () => ({ default: mockPool }));
    const mod = await import('../goal-evaluator.js');
    getGoalMetrics = mod.getGoalMetrics;
  });

  it('calculates metrics correctly', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        total_tasks_7d: '10',
        completed_tasks_7d: '6',
        failed_tasks_7d: '2',
        last_completed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      }],
    });

    const metrics = await getGoalMetrics('goal-1');

    expect(metrics.total_tasks_7d).toBe(10);
    expect(metrics.completed_tasks_7d).toBe(6);
    expect(metrics.recent_failures).toBe(2);
    expect(metrics.task_completion_rate).toBe(0.6);
    expect(metrics.failure_rate).toBe(0.2);
    expect(metrics.days_since_last_progress).toBe(2);
  });

  it('handles no tasks', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        total_tasks_7d: '0',
        completed_tasks_7d: '0',
        failed_tasks_7d: '0',
        last_completed_at: null,
      }],
    });

    const metrics = await getGoalMetrics('goal-1');

    expect(metrics.total_tasks_7d).toBe(0);
    expect(metrics.task_completion_rate).toBe(0);
    expect(metrics.days_since_last_progress).toBeNull();
  });
});

// ── Tests: evaluateGoal ───────────────────────────────────────────────────────

describe('evaluateGoal', () => {
  let evaluateGoal;
  let _resetGoalEvalTimes;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    vi.doMock('../db.js', () => ({ default: mockPool }));
    const mod = await import('../goal-evaluator.js');
    evaluateGoal = mod.evaluateGoal;
    _resetGoalEvalTimes = mod._resetGoalEvalTimes;
    _resetGoalEvalTimes();
  });

  it('writes on_track evaluation with no action', async () => {
    // getGoalMetrics query
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        total_tasks_7d: '10',
        completed_tasks_7d: '7',
        failed_tasks_7d: '1',
        last_completed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      }],
    });
    // INSERT into goal_evaluations
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await evaluateGoal({ id: 'goal-1', title: 'Test KR' });

    expect(result.verdict).toBe('on_track');
    expect(result.action_taken).toBe('none');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO goal_evaluations'),
      expect.arrayContaining(['goal-1', 'on_track'])
    );
  });

  it('creates initiative_plan task for stalled goal', async () => {
    // getGoalMetrics
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        total_tasks_7d: '3',
        completed_tasks_7d: '0',
        failed_tasks_7d: '0',
        last_completed_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      }],
    });
    // check existing initiative_plan
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT into tasks
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'task-new-1' }] });
    // INSERT into goal_evaluations
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await evaluateGoal({ id: 'goal-stall', title: 'Stalled KR' });

    expect(result.verdict).toBe('stalled');
    expect(result.action_taken).toBe('initiative_plan_created');
  });

  it('creates suggestion for needs_attention goal', async () => {
    // getGoalMetrics
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        total_tasks_7d: '5',
        completed_tasks_7d: '1',
        failed_tasks_7d: '3',
        last_completed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      }],
    });
    // INSERT into suggestions
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'sug-1' }] });
    // INSERT into goal_evaluations
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await evaluateGoal({ id: 'goal-attn', title: 'Attention KR' });

    expect(result.verdict).toBe('needs_attention');
    expect(result.action_taken).toBe('suggestion_created');
  });
});

// ── Tests: evaluateGoalOuterLoop ──────────────────────────────────────────────

describe('evaluateGoalOuterLoop', () => {
  let evaluateGoalOuterLoop;
  let _resetGoalEvalTimes;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    vi.doMock('../db.js', () => ({ default: mockPool }));
    const mod = await import('../goal-evaluator.js');
    evaluateGoalOuterLoop = mod.evaluateGoalOuterLoop;
    _resetGoalEvalTimes = mod._resetGoalEvalTimes;
    _resetGoalEvalTimes();
  });

  it('evaluates all in_progress goals', async () => {
    // fetch goals
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'g1', title: 'KR 1', status: 'in_progress', priority: 'P0', progress: 30 },
        { id: 'g2', title: 'KR 2', status: 'in_progress', priority: 'P1', progress: 50 },
      ],
    });

    // goal g1 metrics
    mockPool.query.mockResolvedValueOnce({
      rows: [{ total_tasks_7d: '5', completed_tasks_7d: '3', failed_tasks_7d: '0', last_completed_at: new Date() }],
    });
    // goal g1 eval insert
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // goal g2 metrics
    mockPool.query.mockResolvedValueOnce({
      rows: [{ total_tasks_7d: '4', completed_tasks_7d: '3', failed_tasks_7d: '0', last_completed_at: new Date() }],
    });
    // goal g2 eval insert
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const results = await evaluateGoalOuterLoop(0); // interval=0 强制立即评估

    expect(results.length).toBe(2);
    expect(results[0].goal_id).toBe('g1');
    expect(results[1].goal_id).toBe('g2');
  });

  it('skips goals that were recently evaluated', async () => {
    // fetch goals
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'g1', title: 'KR 1', status: 'in_progress', priority: 'P0', progress: 30 }],
    });

    // 第一次评估
    mockPool.query.mockResolvedValueOnce({
      rows: [{ total_tasks_7d: '5', completed_tasks_7d: '3', failed_tasks_7d: '0', last_completed_at: new Date() }],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await evaluateGoalOuterLoop(0);

    mockPool.query.mockReset();

    // 第二次评估时 fetch goals 再来一次
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'g1', title: 'KR 1', status: 'in_progress', priority: 'P0', progress: 30 }],
    });

    // 使用 1 小时间隔 → g1 刚刚评估过，应该跳过
    const results = await evaluateGoalOuterLoop(60 * 60 * 1000);

    expect(results.length).toBe(0); // 全部跳过
  });

  it('returns empty array when no in_progress goals', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const results = await evaluateGoalOuterLoop(0);

    expect(results.length).toBe(0);
  });

  it('handles DB error gracefully', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    const results = await evaluateGoalOuterLoop(0);

    expect(results.length).toBe(0);
  });
});

// ── Tests: migration 089 ──────────────────────────────────────────────────────

describe('migration 089 validation', () => {
  it('should have correct migration file', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const migrationPath = path.resolve(
      import.meta.dirname, '../../migrations/089_goal_evaluations.sql'
    );
    const content = fs.readFileSync(migrationPath, 'utf-8');

    expect(content).toContain('CREATE TABLE IF NOT EXISTS goal_evaluations');
    expect(content).toContain('goal_id UUID NOT NULL');
    expect(content).toContain('verdict VARCHAR(20)');
    expect(content).toContain('metrics JSONB');
    expect(content).toContain('089');
  });
});
