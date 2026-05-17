/**
 * thalamus 自我感知层单元测试
 * 覆盖 buildSelfAwarenessContext() 和缓存机制
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// Mock 其他依赖
vi.mock('../learning.js', () => ({ getRecentLearnings: vi.fn().mockResolvedValue([]) }));
vi.mock('../memory-retriever.js', () => ({
  buildMemoryContext: vi.fn().mockResolvedValue({ block: '', meta: {} }),
}));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));
vi.mock('../embedding-service.js', () => ({ generateTaskEmbeddingAsync: vi.fn() }));

let buildSelfAwarenessContext, _resetSelfAwarenessCache;

beforeEach(async () => {
  vi.resetModules();
  mockQuery.mockReset();
  const mod = await import('../thalamus.js');
  buildSelfAwarenessContext = mod.buildSelfAwarenessContext;
  _resetSelfAwarenessCache = mod._resetSelfAwarenessCache;
  _resetSelfAwarenessCache();
});

describe('buildSelfAwarenessContext()', () => {
  it('包含任务队列状态', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'queued', count: 3 }, { status: 'in_progress', count: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    const ctx = await buildSelfAwarenessContext({ query: mockQuery });

    expect(ctx).toContain('排队中: 3');
    expect(ctx).toContain('执行中: 1');
  });

  it('包含 Skills 能力摘要', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const ctx = await buildSelfAwarenessContext({ query: mockQuery });

    expect(ctx).toContain('Cecelia 能力地图');
    expect(ctx).toContain('/dev');
    expect(ctx).toContain('/douyin-publisher');
  });

  it('5分钟内第二次调用不查数据库（缓存命中）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await buildSelfAwarenessContext({ query: mockQuery });
    mockQuery.mockReset();

    // 第二次调用，应命中缓存，不再查 DB
    await buildSelfAwarenessContext({ query: mockQuery });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('数据库查询失败时返回静态能力地图（graceful fallback）', async () => {
    mockQuery.mockRejectedValue(new Error('DB error'));

    const ctx = await buildSelfAwarenessContext({ query: mockQuery });

    expect(ctx).toContain('Cecelia 能力地图');
    expect(ctx).toContain('静态');
  });

  it('有失败任务时显示最近失败任务列表', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'failed', count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ title: '修复登录 Bug', updated_at: new Date() }] });

    const ctx = await buildSelfAwarenessContext({ query: mockQuery });

    expect(ctx).toContain('修复登录 Bug');
  });
});
