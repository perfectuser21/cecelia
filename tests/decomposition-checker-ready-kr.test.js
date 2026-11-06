/** 回归：已审核 KR 不得被旧拆解流程退回 decomposing。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
const createTask = vi.hoisted(() => vi.fn());
vi.mock('../packages/brain/src/db.js', () => ({ default: db }));
vi.mock('../packages/brain/src/actions.js', () => ({ createTask }));

describe('退役旧拆解后保护已审核 KR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockResolvedValue({ rows: [] });
  });

  it('入口只检查目标，不再查询或修改任何 KR 状态', async () => {
    const { runDecompositionChecks } = await import('../packages/brain/src/decomposition-checker.js');
    await runDecompositionChecks();
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('FROM objectives');
    expect(db.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/UPDATE\s+key_results/i);
  });

  it('没有缺失 KR 的目标时不创建任何拆解任务', async () => {
    const { runDecompositionChecks } = await import('../packages/brain/src/decomposition-checker.js');
    const result = await runDecompositionChecks();
    expect(createTask).not.toHaveBeenCalled();
    expect(result.total_created).toBe(0);
    expect(result.actions).toEqual([]);
  });
});
