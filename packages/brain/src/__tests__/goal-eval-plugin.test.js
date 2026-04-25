/**
 * goal-eval-plugin.test.js — Brain v2 Phase D1.7c-plugin1
 *
 * 验证 goal-eval-plugin.js tick(now, tickState):
 *  - elapsed < GOAL_EVAL_INTERVAL_MS 时不跑
 *  - elapsed >= GOAL_EVAL_INTERVAL_MS 时跑：先 mark 时间戳再调 evaluator
 *  - 仅 stalledCount > 0 时 push goal_outer_loop action（保持原 tick.js 行为）
 *  - evaluator 抛错被吞，返回 ran:true、actions:[]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEvaluateGoalOuterLoop = vi.fn();
vi.mock('../goal-evaluator.js', () => ({
  evaluateGoalOuterLoop: (interval) => mockEvaluateGoalOuterLoop(interval),
}));

import * as goalPlugin from '../goal-eval-plugin.js';

describe('goal-eval-plugin tick()', () => {
  beforeEach(() => {
    mockEvaluateGoalOuterLoop.mockReset();
  });

  it('exports a tick function and constant', () => {
    expect(typeof goalPlugin.tick).toBe('function');
    expect(typeof goalPlugin._GOAL_EVAL_INTERVAL_MS).toBe('number');
  });

  it('returns {ran:false} when tickState missing', async () => {
    const r = await goalPlugin.tick(new Date(), null);
    expect(r).toEqual({ ran: false, actions: [] });
  });

  it('skips when elapsed < GOAL_EVAL_INTERVAL_MS', async () => {
    const tickState = { lastGoalEvalTime: Date.now() };
    const r = await goalPlugin.tick(new Date(), tickState);
    expect(r.ran).toBe(false);
    expect(mockEvaluateGoalOuterLoop).not.toHaveBeenCalled();
  });

  it('runs, marks timestamp, and pushes action when stalledCount > 0', async () => {
    mockEvaluateGoalOuterLoop.mockResolvedValue([
      { verdict: 'stalled' },
      { verdict: 'stalled' },
      { verdict: 'needs_attention' },
      { verdict: 'on_track' },
    ]);

    const tickState = { lastGoalEvalTime: 0 }; // 触发跑
    const r = await goalPlugin.tick(new Date(), tickState);

    expect(r.ran).toBe(true);
    expect(tickState.lastGoalEvalTime).toBeGreaterThan(0);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({
      action: 'goal_outer_loop',
      evaluated: 4,
      stalled: 2,
      needs_attention: 1,
    });
  });

  it('runs but does NOT push action when stalledCount == 0', async () => {
    mockEvaluateGoalOuterLoop.mockResolvedValue([
      { verdict: 'on_track' },
      { verdict: 'needs_attention' },
    ]);

    const tickState = { lastGoalEvalTime: 0 };
    const r = await goalPlugin.tick(new Date(), tickState);

    expect(r.ran).toBe(true);
    expect(r.actions).toEqual([]);
  });

  it('runs with empty results: no actions pushed', async () => {
    mockEvaluateGoalOuterLoop.mockResolvedValue([]);
    const tickState = { lastGoalEvalTime: 0 };
    const r = await goalPlugin.tick(new Date(), tickState);
    expect(r.ran).toBe(true);
    expect(r.actions).toEqual([]);
  });

  it('marks timestamp BEFORE running (no retry on inner error)', async () => {
    mockEvaluateGoalOuterLoop.mockRejectedValue(new Error('eval boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tickState = { lastGoalEvalTime: 0 };
    const r = await goalPlugin.tick(new Date(), tickState);

    expect(r.ran).toBe(true);
    expect(tickState.lastGoalEvalTime).toBeGreaterThan(0); // 已 mark
    expect(r.actions).toEqual([]);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
