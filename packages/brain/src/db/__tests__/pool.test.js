/**
 * db/pool.js — re-export 单元测试
 * task_id: c11cdec4-c845-447f-80da-9d528753be1d
 *
 * pool.js 是一个 trivial re-export，为单元测试 vi.mock 提供精确拦截路径。
 * 本测试验证导出形态符合预期（default + named pool）。
 */

import { describe, it, expect, vi } from 'vitest';

// Mock 上游 db.js，避免真实 PG 连接
vi.mock('../../db.js', () => {
  const mockPool = { query: vi.fn() };
  return { default: mockPool, pool: mockPool };
});

describe('db/pool.js re-export', () => {
  it('default 与具名 pool 重导出上游同一实例', async () => {
    const upstream = await import('../../db.js');
    const mod = await import('../pool.js');
    expect(mod.default).toBe(upstream.default);
    expect(mod.pool).toBe(upstream.default);
  });
});
