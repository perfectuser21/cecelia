import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

const { dispatchStrategistDecisions } = await import('../line-strategist-dispatch.js');

describe('dispatchStrategistDecisions', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('creates a strategist_decision task when a terminal task has a journey_id and no queued dup exists', async () => {
    // 1. 扫描近期终态任务
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-1', journey_id: 'journey-abc', status: 'completed' }],
    });
    // 2. 查重：该 journey_id 无排队中的 strategist_decision
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const taskCreator = vi.fn().mockResolvedValue({ task: { id: 'new-task-id' } });
    // 3. UPDATE tasks payload 标记 strategist_dispatched（task-1）
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await dispatchStrategistDecisions(mockPool, { taskCreator });

    expect(result).toEqual({ scanned: 1, dispatched: 1, skipped_duplicate: 0, marked: 1, failed: 0 });

    expect(taskCreator).toHaveBeenCalledWith(expect.objectContaining({
      db: mockPool,
      source: 'child',
      task_type: 'strategist_decision',
      trigger_source: 'brain_auto',
    }));
  });

  it('skips creating a new task when a queued strategist_decision already exists for the journey', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-1', journey_id: 'journey-abc', status: 'completed' }],
    });
    // 查重：已存在排队中的 strategist_decision
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-task' }] });
    // 仍然要标记 task-1，避免下一 tick 重复处理
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await dispatchStrategistDecisions(mockPool);

    expect(result).toEqual({ scanned: 1, dispatched: 0, skipped_duplicate: 1, marked: 1, failed: 0 });
    expect(mockPool.query).toHaveBeenCalledTimes(3); // 无 INSERT 调用
  });

  it('returns all zeros when no terminal tasks have a journey_id in the scan window', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await dispatchStrategistDecisions(mockPool);

    expect(result).toEqual({ scanned: 0, dispatched: 0, skipped_duplicate: 0, marked: 0, failed: 0 });
    expect(mockPool.query).toHaveBeenCalledTimes(1); // 只有扫描查询，无后续
  });

  it('groups multiple terminal tasks with the same journey_id into a single dispatch', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'task-1', journey_id: 'journey-abc', status: 'completed' },
        { id: 'task-2', journey_id: 'journey-abc', status: 'failed' },
      ],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 查重（一次，因为同一 journey_id 只查一次）
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 标记 task-1
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 标记 task-2
    const taskCreator = vi.fn().mockResolvedValue({ task: { id: 'new-task-id' } });

    const result = await dispatchStrategistDecisions(mockPool, { taskCreator });

    expect(result).toEqual({ scanned: 2, dispatched: 1, skipped_duplicate: 0, marked: 2, failed: 0 });
  });

  it('excludes strategist_decision tasks themselves from the scan to prevent a self-perpetuating loop', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 空扫描结果即可验证 SQL 文本
    await dispatchStrategistDecisions(mockPool);
    const [scanSql] = mockPool.query.mock.calls[0];
    expect(scanSql).toMatch(/task_type\s*<>\s*'strategist_decision'/);
  });

  it('一个 journey 的 INSERT 失败不影响其它 journey 派发，且失败 journey 的源任务仍被标记', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'task-fail', journey_id: 'journey-fail', status: 'completed' },
        { id: 'task-ok', journey_id: 'journey-ok', status: 'completed' },
      ],
    });
    const taskCreator = vi.fn()
      .mockRejectedValueOnce(new Error('violates check constraint tasks_task_type_check'))
      .mockResolvedValueOnce({ task: { id: 'new-task-id' } });
    // journey-fail: 查重通过，统一 writer 抛错
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 查重 journey-fail
    // journey-ok: 查重通过，统一 writer 成功
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 查重 journey-ok
    // 标记两条源任务
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 标记 task-fail
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 标记 task-ok

    const result = await dispatchStrategistDecisions(mockPool, { taskCreator });

    expect(result).toEqual({
      scanned: 2, dispatched: 1, skipped_duplicate: 0, marked: 2, failed: 1,
    });
  });
});
