/**
 * KR Progress Calculator 测试（已退役，决策 ee4842a6/3feeae3e，接力棒链 2afa6d69 棒4）
 *
 * 原公式基于 okr_projects → okr_scopes → okr_initiatives 的 initiative 完成率，
 * scope/initiative 层退役后清空为 no-op。回归守卫：两个导出函数无论传入什么 pool，
 * 都绝不调用 pool.query——对应验收标准"tick 一轮无 okr_scopes/okr_initiatives 查询"
 * （kr-progress-sync-plugin.js 每小时 tick 一次会调用 syncAllKrProgress）。
 */

import { describe, it, expect, vi } from 'vitest';
import { updateKrProgress, syncAllKrProgress } from '../kr-progress.js';

function makeSpyPool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe('updateKrProgress（已退役，no-op）', () => {
  it('恒返回零变化，且从不查询数据库', async () => {
    const pool = makeSpyPool();
    const result = await updateKrProgress(pool, 'kr-001');
    expect(result).toEqual({ krId: 'kr-001', progress: 0, completed: 0, total: 0 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('krId 为 null 时同样不查询数据库', async () => {
    const pool = makeSpyPool();
    const result = await updateKrProgress(pool, null);
    expect(result).toEqual({ krId: null, progress: 0, completed: 0, total: 0 });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('syncAllKrProgress（已退役，no-op）', () => {
  it('恒返回零变化，且从不查询数据库', async () => {
    const pool = makeSpyPool();
    const result = await syncAllKrProgress(pool);
    expect(result).toEqual({ updated: 0, results: [] });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
