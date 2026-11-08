/** 回归：检查目标时，已有进行中的战略会议不得重复创建。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
const createTask = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: db }));
vi.mock('../actions.js', () => ({ createTask }));

describe('目标检查去重', () => {
  beforeEach(() => vi.clearAllMocks());
  it('目标已有会议时不再创建任务，并报告去重', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'obj-1', title: '目标' }] });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'existing-meeting' }] });
    const { runDecompositionChecks } = await import('../decomposition-checker.js');
    const result = await runDecompositionChecks();
    expect(createTask).not.toHaveBeenCalled();
    expect(db.query.mock.calls[1][1]).toEqual(['obj-1']);
    expect(result.actions).toEqual([expect.objectContaining({ action: 'skip_dedup', goal_id: 'obj-1' })]);
  });
});
