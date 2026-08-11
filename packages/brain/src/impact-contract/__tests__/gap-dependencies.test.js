import { describe, expect, it, vi } from 'vitest';
import { addHardDependency, assignRepairTask } from '../gap-dependencies.js';

describe('Gap dependency persistence', () => {
  it('assignRepairTask 对不存在的 Gap 返回稳定 404 错误', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await expect(assignRepairTask(db, 'gap-missing', 'repair-1')).rejects.toMatchObject({
      code: 'gap_not_found',
      httpStatus: 404,
    });
  });

  it('addHardDependency 同时写 task DAG 与逐 Gap 依赖账本', async () => {
    const dependency = {
      from_task_id: 'source-1',
      to_task_id: 'repair-1',
      gap_id: 'gap-1',
      edge_type: 'hard',
      status: 'pending',
      created: true,
    };
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [dependency] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await expect(addHardDependency(db, {
      fromTaskId: 'source-1',
      toTaskId: 'repair-1',
      gapId: 'gap-1',
    })).resolves.toEqual({ dep: dependency, created: true });

    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[0][0]).toContain('INSERT INTO task_dependencies');
    expect(db.query.mock.calls[1][0]).toContain('INSERT INTO harness_gap_dependencies');
  });
});
