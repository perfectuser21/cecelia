/**
 * action-pipeline.js 单元测试
 *
 * 使用 mock db 避免真实 PostgreSQL 连接。
 * 验证去重逻辑、任务写入、project_id 兜底等核心行为。
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ---- Mock 依赖 ----
const mockPool = { query: vi.fn() };

let enqueueActions;

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('../db.js', () => ({ default: mockPool }));
  const mod = await import('../action-pipeline.js');
  enqueueActions = mod.enqueueActions;
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('enqueueActions()', () => {
  it('空数组 → 返回 {created:0, skipped:0}', async () => {
    const result = await enqueueActions([]);
    expect(result).toEqual({ created: 0, skipped: 0 });
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('无 title 的动作被跳过', async () => {
    const result = await enqueueActions([{ description: '没有标题' }]);
    expect(result).toEqual({ created: 0, skipped: 1 });
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('去重命中：已有相同 title 的活跃任务 → skipped:1', async () => {
    // 懒加载：initiative 查询不会发生（任务在去重阶段就跳过了）
    // 去重查询：命中一行
    mockPool.query.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    const result = await enqueueActions([{ title: '重复任务' }]);
    expect(result).toEqual({ created: 0, skipped: 1 });
    // 不应调用 INSERT
    const calls = mockPool.query.mock.calls.map(c => c[0]);
    expect(calls.some(q => typeof q === 'string' && q.includes('INSERT'))).toBe(false);
    // 不应查询 initiative（任务在去重后跳过，project_id 未被需要）
    expect(calls.some(q => typeof q === 'string' && q.includes('initiative'))).toBe(false);
  });

  it('新任务：去重未命中 → created:1，INSERT 被调用', async () => {
    // 懒加载调用顺序：去重查询 → initiative 查询（需要 project_id 时）→ INSERT
    // 去重查询：无命中
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // getDefaultInitiativeId 查询返回一个 initiative
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'init-001' }] });
    // INSERT 成功
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await enqueueActions([{ title: '全新任务' }]);
    expect(result).toEqual({ created: 1, skipped: 0 });

    const insertCall = mockPool.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT'));
    expect(insertCall).toBeTruthy();
    // 参数验证：title, description, priority, project_id
    expect(insertCall[1][0]).toBe('全新任务');
    expect(insertCall[1][3]).toBe('init-001'); // project_id 来自兜底 initiative
  });

  it('context.project_id 优先于兜底 initiative', async () => {
    // 去重查询：无命中
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT 成功
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await enqueueActions(
      [{ title: '有 project_id 的任务' }],
      { project_id: 'ctx-init-999' }
    );
    expect(result).toEqual({ created: 1, skipped: 0 });

    // 不应查询 initiative（因为 context.project_id 已提供）
    const initiativeQuery = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('type') && c[0].includes('initiative')
    );
    expect(initiativeQuery).toBeUndefined();

    const insertCall = mockPool.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT'));
    expect(insertCall[1][3]).toBe('ctx-init-999');
  });

  it('action 自带 project_id 优先于 context.project_id', async () => {
    // 去重查询：无命中
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT 成功
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await enqueueActions(
      [{ title: '动作自带 project_id', project_id: 'action-init-777' }],
      { project_id: 'ctx-init-999' }
    );
    expect(result).toEqual({ created: 1, skipped: 0 });

    const insertCall = mockPool.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT'));
    expect(insertCall[1][3]).toBe('action-init-777');
  });

  it('批量：2 新 + 1 重复 → {created:2, skipped:1}', async () => {
    // 懒加载调用顺序：
    // action1(A): 去重→空 → initiative查询(init-batch) → INSERT
    // action2(B重复): 去重→命中 → skip（initiative已解析，不再查询）
    // action3(C): 去重→空 → INSERT（复用已缓存的 fallbackProjectId）
    // action1 去重：未命中
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // getDefaultInitiativeId（首次需要时触发）
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'init-batch' }] });
    // action1 INSERT
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // action2 去重：命中
    mockPool.query.mockResolvedValueOnce({ rows: [{ 1: 1 }] });
    // action3 去重：未命中
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // action3 INSERT
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await enqueueActions([
      { title: '任务 A' },
      { title: '任务 B（重复）' },
      { title: '任务 C' },
    ]);
    expect(result).toEqual({ created: 2, skipped: 1 });
  });

  it('INSERT 失败 → 该项 skipped，其余继续', async () => {
    // 懒加载调用顺序：去重→空 → initiative查询 → INSERT抛错
    // 去重：未命中
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // getDefaultInitiativeId
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'init-x' }] });
    // INSERT 抛出错误
    mockPool.query.mockRejectedValueOnce(new Error('DB write error'));

    const result = await enqueueActions([{ title: '写入失败的任务' }]);
    expect(result).toEqual({ created: 0, skipped: 1 });
  });

  it('写入时 status=queued，task_type=dev，trigger_source=cortex', async () => {
    // getDefaultInitiativeId
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // 去重：未命中
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await enqueueActions([{ title: '验证字段' }]);

    const insertCall = mockPool.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT'));
    expect(insertCall[0]).toContain("'queued'");
    expect(insertCall[0]).toContain("'dev'");
    expect(insertCall[0]).toContain("'cortex'");
  });
});
