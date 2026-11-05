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
import { getDoc, seedSoul, refreshWorldState, refreshSelfModel, refreshUserProfile, upsertDoc } from '../distilled-docs.js';

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
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('snapshot write failed'));

    const result = await refreshWorldState(mockPool);
    expect(result.refreshed).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// 失败必须保留最后一次成功快照；直接调用真实reader与upsert接缝，不复制组装逻辑。
describe('WORLD_STATE 读取失败不得覆盖已有快照', () => {
  it.each(['objectives', 'okr_projects', 'okr_initiatives', 'all'])(
    '%s 读取失败：非致命拒绝刷新，原content/version/time保持', async failedSource => {
      const previous = { content: 'last verified world snapshot', version: 7, updated_at: '2026-10-31T00:00:00Z' };
      let stored = { ...previous };
      const writes = [];
      const reads = [];
      const ownedPool = { query: vi.fn(async (sql, params) => {
        if (sql.startsWith('SELECT content')) return { rows: [{ ...stored }] };
        const source = /FROM\s+(objectives|okr_projects|okr_initiatives)\b/.exec(sql)?.[1];
        if (source) {
          reads.push(source);
          if (failedSource === 'all' || source === failedSource) throw new Error(`owned_read_failure:${source}`);
          return { rows: [{ title: `owned ${source}`, status: 'active' }] };
        }
        if (sql.startsWith('INSERT INTO distilled_docs')) {
          writes.push(params);
          stored = { content: params[1], version: stored.version + 1, updated_at: 'changed' };
          return { rows: [] };
        }
        throw new Error('unexpected owned fixture query');
      }) };

      const result = await refreshWorldState(ownedPool);

      expect(reads).toEqual(['objectives', 'okr_projects', 'okr_initiatives']);
      expect(result).toMatchObject({ refreshed: false, error: expect.stringContaining('owned_read_failure:') });
      expect(writes).toEqual([]);
      expect(await getDoc('WORLD_STATE', ownedPool)).toEqual(previous);
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  it('三路成功且合法空集仍写真实空快照，不能把空集当读取错误', async () => {
    const ownedPool = { query: vi.fn(async () => ({ rows: [] })) };

    expect(await refreshWorldState(ownedPool)).toEqual({ refreshed: true, total: 0 });

    expect(ownedPool.query).toHaveBeenCalledTimes(4);
    const [sql, params] = ownedPool.query.mock.calls[3];
    expect(sql).toContain('INSERT INTO distilled_docs');
    expect(params).toEqual(['WORLD_STATE', expect.stringContaining('_暂无活跃目标或项目_'), 'auto']);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// T8: refreshSelfModel
describe('refreshSelfModel', () => {
  it('T8: 有 learnings 数据时写入 SELF_MODEL，返回 { refreshed: true }', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          { title: 'DoD 格式要求', content: '每条 DoD 必须有 Test 字段', category: 'best_practice', frequency_count: 5 },
          { title: 'CI 修复经验', content: '先看 log-failed 再修', category: 'cortex_insight', frequency_count: 3 },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // upsertDoc

    const result = await refreshSelfModel(mockPool);
    expect(result.refreshed).toBe(true);
    expect(result.count).toBe(2);
  });

  it('T8b: 无 learnings 数据时返回 { refreshed: false }', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await refreshSelfModel(mockPool);
    expect(result.refreshed).toBe(false);
  });

  it('T8c: 数据库异常时返回 { refreshed: false }（非致命）', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('learnings table not found'));

    const result = await refreshSelfModel(mockPool);
    expect(result.refreshed).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// T9: refreshUserProfile
describe('refreshUserProfile', () => {
  it('T9: 有 user_profile_facts 数据时写入 USER_PROFILE，返回 { refreshed: true }', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          { category: '沟通偏好', key: '语言', content: '简体中文，简洁直接' },
          { category: '工作风格', key: '反馈', content: '不需要总结' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // upsertDoc

    const result = await refreshUserProfile(mockPool);
    expect(result.refreshed).toBe(true);
    expect(result.count).toBe(2);
  });

  it('T9b: 无 user_profile_facts 数据时返回 { refreshed: false }', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await refreshUserProfile(mockPool);
    expect(result.refreshed).toBe(false);
  });

  it('T9c: 数据库异常时返回 { refreshed: false }（非致命）', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('user_profile_facts not found'));

    const result = await refreshUserProfile(mockPool);
    expect(result.refreshed).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
