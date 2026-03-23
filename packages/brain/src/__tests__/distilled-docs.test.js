/**
 * distilled-docs 单元测试
 *
 * T1: getDoc — 存在时返回文档对象
 * T2: getDoc — 不存在时返回 null
 * T3: getDoc — 数据库异常时返回 null（非致命）
 * T4: seedSoul — 不存在时写入默认内容，返回 { seeded: true }
 * T5: seedSoul — 已存在时跳过，返回 { seeded: false }
 * T6: refreshWorldState — 有数据时写入，返回 { refreshed: true }
 * T7: refreshWorldState — 数据库异常时返回 { refreshed: false }（非致命）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

import pool from '../db.js';
import { getDoc, seedSoul, refreshWorldState, upsertDoc } from '../distilled-docs.js';

const mockPool = {
  query: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// T1: getDoc 存在时返回文档
describe('getDoc', () => {
  it('T1: 存在时返回文档对象', async () => {
    const mockRow = { content: 'SOUL content', updated_at: new Date(), version: 1 };
    mockPool.query.mockResolvedValueOnce({ rows: [mockRow] });

    const result = await getDoc('SOUL', mockPool);
    expect(result).toEqual(mockRow);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT content'),
      ['SOUL']
    );
  });

  // T2: getDoc 不存在时返回 null
  it('T2: 不存在时返回 null', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getDoc('SOUL', mockPool);
    expect(result).toBeNull();
  });

  // T3: getDoc 数据库异常时返回 null
  it('T3: 数据库异常时返回 null（非致命）', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

    const result = await getDoc('SOUL', mockPool);
    expect(result).toBeNull();
  });
});

// T4: seedSoul 不存在时写入
describe('seedSoul', () => {
  it('T4: SOUL 不存在时写入默认内容，返回 { seeded: true }', async () => {
    // getDoc 返回 null（不存在）
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // getDoc SELECT
      .mockResolvedValueOnce({ rows: [] }); // upsertDoc INSERT

    const result = await seedSoul(mockPool);
    expect(result.seeded).toBe(true);
    // 确认写入了 SOUL 内容
    const upsertCall = mockPool.query.mock.calls[1];
    expect(upsertCall[1][0]).toBe('SOUL');
    expect(upsertCall[1][1]).toContain('Cecelia');
  });

  // T5: seedSoul 已存在时跳过
  it('T5: SOUL 已存在时跳过，返回 { seeded: false }', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ content: 'existing soul', updated_at: new Date(), version: 2 }],
    });

    const result = await seedSoul(mockPool);
    expect(result.seeded).toBe(false);
    // 不应调用第二次 query（upsert）
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });
});

// T6: refreshWorldState 有数据时写入
describe('refreshWorldState', () => {
  it('T6: 有数据时写入快照，返回 { refreshed: true }', async () => {
    // 3 个并行查询：goals, projects, initiatives
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ title: 'OKR Q1', status: 'in_progress', progress: 65 }] })
      .mockResolvedValueOnce({ rows: [{ title: 'Project Alpha', status: 'active', current_phase: 'dev' }] })
      .mockResolvedValueOnce({ rows: [{ title: 'Initiative 1', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [] }); // upsertDoc

    const result = await refreshWorldState(mockPool);
    expect(result.refreshed).toBe(true);
    expect(result.total).toBeGreaterThan(0);
  });

  // T7: refreshWorldState 数据库异常时返回 { refreshed: false }
  it('T7: 数据库异常时返回 { refreshed: false }（非致命）', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('table not found'));

    const result = await refreshWorldState(mockPool);
    expect(result.refreshed).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
