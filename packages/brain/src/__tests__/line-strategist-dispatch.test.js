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
    // 3. INSERT INTO tasks（新建 strategist_decision）
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] });
    // 4. UPDATE tasks payload 标记 strategist_dispatched（task-1）
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await dispatchStrategistDecisions(mockPool);

    expect(result).toEqual({ scanned: 1, dispatched: 1, skipped_duplicate: 0, marked: 1 });

    const [insertSql, insertParams] = mockPool.query.mock.calls[2];
    expect(insertSql).toMatch(/INSERT INTO tasks/);
    expect(insertSql).toMatch(/trigger_source/);
    expect(insertParams).toContain('strategist_decision');
    expect(insertParams).toContain('brain_auto');
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

    expect(result).toEqual({ scanned: 1, dispatched: 0, skipped_duplicate: 1, marked: 1 });
    expect(mockPool.query).toHaveBeenCalledTimes(3); // 无 INSERT 调用
  });

  it('returns all zeros when no terminal tasks have a journey_id in the scan window', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await dispatchStrategistDecisions(mockPool);

    expect(result).toEqual({ scanned: 0, dispatched: 0, skipped_duplicate: 0, marked: 0 });
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
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] }); // INSERT
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 标记 task-1
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 标记 task-2

    const result = await dispatchStrategistDecisions(mockPool);

    expect(result).toEqual({ scanned: 2, dispatched: 1, skipped_duplicate: 0, marked: 2 });
  });
});
