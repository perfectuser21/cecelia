/**
 * Goal Evaluator 完整单元测试 (Outer Loop)
 *
 * 测试覆盖：
 * - _resetGoalEvalTimes / _getGoalEvalTimes: 内部状态管理
 * - computeVerdict: on_track / needs_attention / stalled（含边界值、优先级）
 * - getGoalMetrics: DB 查询 + 空数据 + 精度
 * - evaluateGoal: 事件发送、降级、写入 goal_evaluations
 * - evaluateGoalOuterLoop: 评估所有活跃 goals、周期跳过、错误隔离
 * - migration 089 验证
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPool = { query: vi.fn() };
vi.mock('../db.js', () => ({ default: mockPool }));

const mockRouteEvent = vi.fn().mockResolvedValue({
  level: 1, actions: [], rationale: 'mock', confidence: 0.9, safety: false,
});
vi.mock('../thalamus.js', () => ({
  routeEvent: mockRouteEvent,
  EVENT_TYPES: {
    GOAL_STALLED: 'goal_stalled',
    RUMINATION_RESULT: 'rumination_result',
  },
}));

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

function makeGoal(overrides = {}) {
  return { id: 'goal-1', title: '测试目标', status: 'in_progress', ...overrides };
}

function makeMetricsRow(overrides = {}) {
  return {
    total_tasks_7d: '10',
    completed_tasks_7d: '6',
    failed_tasks_7d: '2',
    last_completed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

// ========================================================================
// _resetGoalEvalTimes / _getGoalEvalTimes
// ========================================================================
describe('_resetGoalEvalTimes / _getGoalEvalTimes', () => {
  let _resetGoalEvalTimes, _getGoalEvalTimes;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db.js', () => ({ default: mockPool }));
    const mod = await import('../goal-evaluator.js');
    _resetGoalEvalTimes = mod._resetGoalEvalTimes;
    _getGoalEvalTimes = mod._getGoalEvalTimes;
  });

  it('重置后返回空对象', () => {
    _resetGoalEvalTimes();
    expect(_getGoalEvalTimes()).toEqual({});
  });

  it('返回副本而非原始引用', () => {
    _resetGoalEvalTimes();
    const times = _getGoalEvalTimes();
    times['fake-id'] = 999;
    expect(_getGoalEvalTimes()).toEqual({});
  });
});

// ========================================================================
// computeVerdict
// ========================================================================
describe('computeVerdict', () => {
  let computeVerdict;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db.js', () => ({ default: mockPool }));
    const mod = await import('../goal-evaluator.js');
    computeVerdict = mod.computeVerdict;
  });

  it('完成率达标（>= 0.5）判为 on_track', () => {
    expect(computeVerdict({
      task_completion_rate: 0.7,
      failure_rate: 0.1,
      total_tasks_7d: 10,
      days_since_last_progress: 1,
    })).toBe('on_track');
  });

  it('完成率刚好 0.5 判为 on_track（边界值）', () => {
    expect(computeVerdict({
      task_completion_rate: 0.5,
      failure_rate: 0.1,
      total_tasks_7d: 10,
      days_since_last_progress: 1,
    })).toBe('on_track');
  });

  it('完成率 0.49 且失败率低判为 needs_attention', () => {
    expect(computeVerdict({
      task_completion_rate: 0.49,
      failure_rate: 0.1,
      total_tasks_7d: 10,
      days_since_last_progress: 2,
    })).toBe('needs_attention');
  });

  it('7 天无进展判为 stalled', () => {
    expect(computeVerdict({
      task_completion_rate: 0.0,
      failure_rate: 0.0,
      total_tasks_7d: 5,
      days_since_last_progress: 8,
    })).toBe('stalled');
  });

  it('刚好 7 天无进展判为 stalled（边界值）', () => {
    expect(computeVerdict({
      task_completion_rate: 0.5,
      failure_rate: 0.0,
      total_tasks_7d: 5,
      days_since_last_progress: 7,
    })).toBe('stalled');
  });

  it('6 天无进展不判为 stalled', () => {
    expect(computeVerdict({
      task_completion_rate: 0.6,
      failure_rate: 0.0,
      total_tasks_7d: 5,
      days_since_last_progress: 6,
    })).toBe('on_track');
  });

  it('days_since_last_progress 为 null 不触发 stalled', () => {
    expect(computeVerdict({
      task_completion_rate: 0.6,
      failure_rate: 0.1,
      total_tasks_7d: 5,
      days_since_last_progress: null,
    })).toBe('on_track');
  });

  it('无任务（total_tasks_7d = 0）判为 needs_attention', () => {
    expect(computeVerdict({
      task_completion_rate: 0,
      failure_rate: 0,
      total_tasks_7d: 0,
      days_since_last_progress: null,
    })).toBe('needs_attention');
  });

  it('失败率 >= 0.4 判为 needs_attention', () => {
    expect(computeVerdict({
      task_completion_rate: 0.3,
      failure_rate: 0.5,
      total_tasks_7d: 10,
      days_since_last_progress: 2,
    })).toBe('needs_attention');
  });

  it('失败率刚好 0.4 判为 needs_attention（边界值）', () => {
    expect(computeVerdict({
      task_completion_rate: 0.3,
      failure_rate: 0.4,
      total_tasks_7d: 10,
      days_since_last_progress: 2,
    })).toBe('needs_attention');
  });

  it('失败率 0.39 不触发 needs_attention（由完成率决定）', () => {
    expect(computeVerdict({
      task_completion_rate: 0.6,
      failure_rate: 0.39,
      total_tasks_7d: 10,
      days_since_last_progress: 2,
    })).toBe('on_track');
  });

  it('stalled 优先于 failure_rate 判定', () => {
    expect(computeVerdict({
      task_completion_rate: 0.1,
      failure_rate: 0.8,
      total_tasks_7d: 10,
      days_since_last_progress: 10,
    })).toBe('stalled');
  });

  it('完成率不足但不满足其他条件判为 needs_attention', () => {
    expect(computeVerdict({
      task_completion_rate: 0.2,
      failure_rate: 0.1,
      total_tasks_7d: 5,
      days_since_last_progress: 3,
    })).toBe('needs_attention');
  });
});

// ========================================================================
// getGoalMetrics
// ========================================================================
describe('getGoalMetrics', () => {
  let getGoalMetrics;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    vi.doMock('../db.js', () => ({ default: mockPool }));
    const mod = await import('../goal-evaluator.js');
    getGoalMetrics = mod.getGoalMetrics;
  });

  it('正确计算完成率和失败率', async () => {
    mockPool.query.mockResolvedValue({
      rows: [makeMetricsRow()],
    });

    const metrics = await getGoalMetrics('goal-1');

    expect(metrics.total_tasks_7d).toBe(10);
    expect(metrics.completed_tasks_7d).toBe(6);
    expect(metrics.recent_failures).toBe(2);
    expect(metrics.task_completion_rate).toBe(0.6);
    expect(metrics.failure_rate).toBe(0.2);
    expect(metrics.days_since_last_progress).toBe(2);
  });

  it('无任务时所有指标归零', async () => {
    mockPool.query.mockResolvedValue({
      rows: [makeMetricsRow({
        total_tasks_7d: '0',
        completed_tasks_7d: '0',
        failed_tasks_7d: '0',
        last_completed_at: null,
      })],
    });

    const metrics = await getGoalMetrics('goal-empty');

    expect(metrics.total_tasks_7d).toBe(0);
    expect(metrics.task_completion_rate).toBe(0);
    expect(metrics.failure_rate).toBe(0);
    expect(metrics.days_since_last_progress).toBeNull();
  });

  it('数据库返回空 row（字段缺失）时使用默认值', async () => {
    mockPool.query.mockResolvedValue({ rows: [{}] });

    const metrics = await getGoalMetrics('goal-no-data');

    expect(metrics.task_completion_rate).toBe(0);
    expect(metrics.failure_rate).toBe(0);
    expect(metrics.total_tasks_7d).toBe(0);
    expect(metrics.days_since_last_progress).toBeNull();
  });

  it('数据库返回空 rows 数组时使用默认值', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const metrics = await getGoalMetrics('goal-no-rows');

    expect(metrics.task_completion_rate).toBe(0);
    expect(metrics.failure_rate).toBe(0);
    expect(metrics.total_tasks_7d).toBe(0);
  });

  it('完成率和失败率四舍五入到两位小数', async () => {
    mockPool.query.mockResolvedValue({
      rows: [makeMetricsRow({
        total_tasks_7d: '3',
        completed_tasks_7d: '1',
        failed_tasks_7d: '1',
      })],
    });

    const metrics = await getGoalMetrics('goal-rounding');

    // 1/3 = 0.3333... → 0.33
    expect(metrics.task_completion_rate).toBe(0.33);
    expect(metrics.failure_rate).toBe(0.33);
  });

  it('last_completed_at 为今天时 days_since_last_progress 为 0', async () => {
    mockPool.query.mockResolvedValue({
      rows: [makeMetricsRow({ last_completed_at: new Date() })],
    });

    const metrics = await getGoalMetrics('goal-today');

    expect(metrics.days_since_last_progress).toBe(0);
  });

  it('传递正确的 goalId 参数给 SQL 查询', async () => {
    mockPool.query.mockResolvedValue({ rows: [makeMetricsRow()] });

    await getGoalMetrics('specific-goal-id');

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('goal_id'),
      expect.arrayContaining(['specific-goal-id']),
    );
  });
});

// ========================================================================
// evaluateGoal
// ========================================================================
describe('evaluateGoal', () => {
  let evaluateGoal, _resetGoalEvalTimes, _getGoalEvalTimes;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    mockRouteEvent.mockReset();
    mockRouteEvent.mockResolvedValue({ level: 1, actions: [], rationale: 'mock', confidence: 0.9, safety: false });
    vi.doMock('../db.js', () => ({ default: mockPool }));
    const mod = await import('../goal-evaluator.js');
    evaluateGoal = mod.evaluateGoal;
    _resetGoalEvalTimes = mod._resetGoalEvalTimes;
    _getGoalEvalTimes = mod._getGoalEvalTimes;
    _resetGoalEvalTimes();
  });

  it('on_track 目标不触发事件，action_taken 为 none', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({
        total_tasks_7d: '10',
        completed_tasks_7d: '7',
        failed_tasks_7d: '1',
        last_completed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // INSERT goal_evaluations

    const result = await evaluateGoal(makeGoal());

    expect(result.verdict).toBe('on_track');
    expect(result.action_taken).toBe('none');
    expect(mockRouteEvent).not.toHaveBeenCalled();
  });

  it('on_track 写入 goal_evaluations 表', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({
        total_tasks_7d: '10',
        completed_tasks_7d: '7',
        failed_tasks_7d: '1',
        last_completed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await evaluateGoal(makeGoal());

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO goal_evaluations'),
      expect.arrayContaining(['goal-1', 'on_track']),
    );
  });

  it('stalled 目标发送 GOAL_STALLED 事件给丘脑', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({
        total_tasks_7d: '3',
        completed_tasks_7d: '0',
        failed_tasks_7d: '0',
        last_completed_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // INSERT goal_evaluations

    const result = await evaluateGoal(makeGoal());

    expect(result.verdict).toBe('stalled');
    expect(result.action_taken).toBe('goal_stalled_event_sent');
    expect(mockRouteEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'goal_stalled',
        goal_id: 'goal-1',
        goal_title: '测试目标',
      }),
    );
  });

  it('stalled + routeEvent 失败时降级创建 initiative_plan（无已有任务）', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({
        total_tasks_7d: '3',
        completed_tasks_7d: '0',
        failed_tasks_7d: '0',
        last_completed_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      })],
    });
    mockRouteEvent.mockRejectedValueOnce(new Error('thalamus down'));
    // createInitiativePlanForStall: 检查已有任务 → 无
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // createInitiativePlanForStall: INSERT 新任务
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'new-task-1' }] });
    // INSERT goal_evaluations
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await evaluateGoal(makeGoal());

    expect(result.verdict).toBe('stalled');
    expect(result.action_taken).toBe('initiative_plan_created_fallback');
  });

  it('stalled + routeEvent 失败 + 已有 initiative_plan 不重复创建', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({
        total_tasks_7d: '3',
        completed_tasks_7d: '0',
        failed_tasks_7d: '0',
        last_completed_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      })],
    });
    mockRouteEvent.mockRejectedValueOnce(new Error('thalamus down'));
    // createInitiativePlanForStall: 已有活跃 initiative_plan
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-task' }] });
    // INSERT goal_evaluations
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await evaluateGoal(makeGoal());

    expect(result.verdict).toBe('stalled');
    expect(result.action_taken).toBe('initiative_plan_created_fallback');
  });

  it('stalled + routeEvent 失败 + createInitiativePlan INSERT 也失败时 action 为 none', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({
        total_tasks_7d: '3',
        completed_tasks_7d: '0',
        failed_tasks_7d: '0',
        last_completed_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      })],
    });
    mockRouteEvent.mockRejectedValueOnce(new Error('thalamus down'));
    // createInitiativePlanForStall: 检查已有任务 → 无
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // createInitiativePlanForStall: INSERT 也失败
    mockPool.query.mockRejectedValueOnce(new Error('insert failed'));
    // INSERT goal_evaluations
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await evaluateGoal(makeGoal());

    expect(result.verdict).toBe('stalled');
    // createInitiativePlanForStall 返回 null，taskId 为 falsy，action 保持 none
    expect(result.action_taken).toBe('none');
  });

  it('needs_attention 目标发送 goal_health_event', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({
        total_tasks_7d: '5',
        completed_tasks_7d: '1',
        failed_tasks_7d: '3',
        last_completed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // INSERT goal_evaluations

    const result = await evaluateGoal(makeGoal({ id: 'goal-attn', title: 'Attention KR' }));

    expect(result.verdict).toBe('needs_attention');
    expect(result.action_taken).toBe('goal_health_event_sent');
    expect(mockRouteEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'goal_stalled', goal_id: 'goal-attn' }),
    );
  });

  it('needs_attention + routeEvent 失败时静默处理，action 为 none', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({
        total_tasks_7d: '5',
        completed_tasks_7d: '1',
        failed_tasks_7d: '3',
        last_completed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      })],
    });
    mockRouteEvent.mockRejectedValueOnce(new Error('route failed'));
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // INSERT goal_evaluations

    const result = await evaluateGoal(makeGoal());

    expect(result.verdict).toBe('needs_attention');
    expect(result.action_taken).toBe('none');
  });

  it('needs_attention 不再写 suggestions 表', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({
        total_tasks_7d: '5',
        completed_tasks_7d: '1',
        failed_tasks_7d: '3',
        last_completed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // INSERT goal_evaluations

    await evaluateGoal(makeGoal());

    const suggestionCall = mockPool.query.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO suggestions'),
    );
    expect(suggestionCall).toBeUndefined();
  });

  it('评估后记录 lastEvalTime', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({
        total_tasks_7d: '10',
        completed_tasks_7d: '8',
        failed_tasks_7d: '0',
        last_completed_at: new Date(),
      })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const before = Date.now();
    await evaluateGoal(makeGoal({ id: 'goal-time' }));
    const after = Date.now();

    const times = _getGoalEvalTimes();
    expect(times['goal-time']).toBeGreaterThanOrEqual(before);
    expect(times['goal-time']).toBeLessThanOrEqual(after);
  });

  it('返回结果包含 goal_id、verdict、metrics、action_taken', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({
        total_tasks_7d: '10',
        completed_tasks_7d: '8',
        failed_tasks_7d: '0',
        last_completed_at: new Date(),
      })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await evaluateGoal(makeGoal());

    expect(result).toHaveProperty('goal_id', 'goal-1');
    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('action_taken');
    expect(result.metrics).toHaveProperty('task_completion_rate');
    expect(result.metrics).toHaveProperty('failure_rate');
  });
});

// ========================================================================
// evaluateGoalOuterLoop
// ========================================================================
describe('evaluateGoalOuterLoop', () => {
  let evaluateGoalOuterLoop, _resetGoalEvalTimes;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    mockRouteEvent.mockReset();
    mockRouteEvent.mockResolvedValue({ level: 1, actions: [], rationale: 'mock', confidence: 0.9, safety: false });
    vi.doMock('../db.js', () => ({ default: mockPool }));
    const mod = await import('../goal-evaluator.js');
    evaluateGoalOuterLoop = mod.evaluateGoalOuterLoop;
    _resetGoalEvalTimes = mod._resetGoalEvalTimes;
    _resetGoalEvalTimes();
  });

  it('评估所有 in_progress 目标', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'g1', title: 'KR 1', status: 'in_progress', priority: 'P0', progress: 30 },
        { id: 'g2', title: 'KR 2', status: 'in_progress', priority: 'P1', progress: 50 },
      ],
    });

    // g1 metrics + g1 eval insert
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({ total_tasks_7d: '5', completed_tasks_7d: '3', failed_tasks_7d: '0', last_completed_at: new Date() })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // g2 metrics + g2 eval insert
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({ total_tasks_7d: '4', completed_tasks_7d: '3', failed_tasks_7d: '0', last_completed_at: new Date() })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const results = await evaluateGoalOuterLoop(0);

    expect(results).toHaveLength(2);
    expect(results[0].goal_id).toBe('g1');
    expect(results[1].goal_id).toBe('g2');
  });

  it('跳过最近已评估过的目标（周期未到）', async () => {
    // 第一轮评估
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'g1', title: 'KR 1', status: 'in_progress', priority: 'P0', progress: 30 }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({ total_tasks_7d: '5', completed_tasks_7d: '3', failed_tasks_7d: '0', last_completed_at: new Date() })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await evaluateGoalOuterLoop(0);

    mockPool.query.mockReset();

    // 第二轮：使用 1 小时间隔，刚评估过应跳过
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'g1', title: 'KR 1', status: 'in_progress', priority: 'P0', progress: 30 }],
    });

    const results = await evaluateGoalOuterLoop(60 * 60 * 1000);

    expect(results).toHaveLength(0);
  });

  it('evalIntervalMs = 0 时每次都评估', async () => {
    // 第一轮
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'g-always', title: '总是评估', status: 'in_progress', priority: 'P0', progress: 50 }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({ total_tasks_7d: '5', completed_tasks_7d: '4', failed_tasks_7d: '0', last_completed_at: new Date() })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await evaluateGoalOuterLoop(0);

    mockPool.query.mockReset();
    mockRouteEvent.mockReset();
    mockRouteEvent.mockResolvedValue({ level: 1, actions: [], rationale: 'mock', confidence: 0.9, safety: false });

    // 第二轮：间隔 0，立即可再次评估
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'g-always', title: '总是评估', status: 'in_progress', priority: 'P0', progress: 50 }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({ total_tasks_7d: '5', completed_tasks_7d: '4', failed_tasks_7d: '0', last_completed_at: new Date() })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const results = await evaluateGoalOuterLoop(0);

    expect(results).toHaveLength(1);
  });

  it('无 in_progress 目标时返回空数组', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const results = await evaluateGoalOuterLoop(0);

    expect(results).toHaveLength(0);
  });

  it('查询目标时 DB 异常返回空数组', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    const results = await evaluateGoalOuterLoop(0);

    expect(results).toHaveLength(0);
  });

  it('单个目标评估失败不影响其他目标', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'g-fail', title: '会失败的', status: 'in_progress', priority: 'P0', progress: 50 },
        { id: 'g-ok', title: '正常的', status: 'in_progress', priority: 'P1', progress: 30 },
      ],
    });

    // g-fail: getGoalMetrics 抛错
    mockPool.query.mockRejectedValueOnce(new Error('metrics query failed'));

    // g-ok: 正常指标 + INSERT
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({ total_tasks_7d: '5', completed_tasks_7d: '4', failed_tasks_7d: '0', last_completed_at: new Date() })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const results = await evaluateGoalOuterLoop(0);

    expect(results).toHaveLength(1);
    expect(results[0].goal_id).toBe('g-ok');
  });

  it('默认 evalIntervalMs 为 24 小时', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'g1', title: 'KR 1', status: 'in_progress', priority: 'P0', progress: 30 }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [makeMetricsRow({ total_tasks_7d: '5', completed_tasks_7d: '3', failed_tasks_7d: '0', last_completed_at: new Date() })],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // 不传参数，使用默认值 24h
    const results = await evaluateGoalOuterLoop();

    expect(results).toHaveLength(1);
  });
});

// ========================================================================
// migration 089 验证
// ========================================================================
describe('migration 089 验证', () => {
  it('migration 文件存在且包含正确的表结构', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const migrationPath = path.resolve(
      import.meta.dirname, '../../migrations/089_goal_evaluations.sql',
    );
    const content = fs.readFileSync(migrationPath, 'utf-8');

    expect(content).toContain('CREATE TABLE IF NOT EXISTS goal_evaluations');
    expect(content).toContain('goal_id UUID NOT NULL');
    expect(content).toContain('verdict VARCHAR(20)');
    expect(content).toContain('metrics JSONB');
    expect(content).toContain('089');
  });
});
