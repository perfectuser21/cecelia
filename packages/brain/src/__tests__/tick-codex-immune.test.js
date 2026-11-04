import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../db.js', () => ({ default: { query: () => { throw new Error('真实数据库禁止用于本单测'); } } }));
import { ensureCodexImmune } from '../codex-immune.js';

/**
 * ensureCodexImmune 单元测试
 * D3: 函数存在并可调用
 * D4: 超过 20h 时创建任务
 * D5: 任务字段正确
 * D6: 20h 内跳过（防重复）
 */

function makePool(lastCreatedAt = null) {
  const insertSpy = vi.fn(async (sql, params) => ({ rows: [{ id: 'immune-task', title: params[0], task_type: params[3], priority: params[2] }] }));
  const pool = {
    query: vi.fn(async (sql, params) => {
      if (sql.trim().startsWith('SELECT created_at')) {
        return { rows: lastCreatedAt ? [{ created_at: lastCreatedAt }] : [] };
      }
      if (sql.trim().startsWith('INSERT INTO tasks')) {
        return insertSpy(sql, params);
      }
      if (sql.includes('INSERT INTO work_routing_receipts')) return { rows: [{ id: 'immune-receipt' }] };
      return { rows: [] };
    }),
    _insertSpy: insertSpy
  };
  return pool;
}

describe('ensureCodexImmune', () => {
  afterEach(() => vi.useRealTimers());

  it('恰好20小时允许创建，查询失败则拒绝创建', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
    const pool = makePool(new Date(Date.now() - 20 * 60 * 60 * 1000));
    expect((await ensureCodexImmune(pool)).created).toBe(true);
    const failingPool = { query: vi.fn().mockRejectedValue(new Error('读取失败')) };
    await expect(ensureCodexImmune(failingPool)).rejects.toThrow('读取失败');
    expect(failingPool.query).toHaveBeenCalledTimes(1);
  });
  it('D3: 函数导出存在', () => {
    expect(typeof ensureCodexImmune).toBe('function');
  });

  it('D4: 从未有过 codex_qa 任务时创建', async () => {
    const pool = makePool(null);
    const result = await ensureCodexImmune(pool);
    expect(result.created).toBe(true);
    // 确认 INSERT 被调用
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tasks'),
      expect.arrayContaining(['Codex 免疫检查 - cecelia-core'])
    );
  });

  it('D4: 超过 20 小时时创建新任务', async () => {
    const twentyOneHoursAgo = new Date(Date.now() - 21 * 60 * 60 * 1000);
    const pool = makePool(twentyOneHoursAgo);
    const result = await ensureCodexImmune(pool);
    expect(result.created).toBe(true);
  });

  it('D6: 20 小时内跳过，不重复创建', async () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const pool = makePool(oneHourAgo);
    const result = await ensureCodexImmune(pool);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('too_soon');
    // 确认没有 INSERT
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tasks'),
      expect.anything()
    );
  });

  it('D5: 创建的任务有正确字段 task_type=codex_qa priority=P1', async () => {
    const pool = makePool(null);
    await ensureCodexImmune(pool);
    const insertCall = pool.query.mock.calls.find(
      c => c[0].includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1][3]).toBe('codex_qa');
    expect(insertCall[1][2]).toBe('P1');
    // 参数包含正确 title 和 description
    expect(insertCall[1][0]).toBe('Codex 免疫检查 - cecelia-core');
    expect(insertCall[1][1]).toContain('run-codex-immune.sh');
  });
});
