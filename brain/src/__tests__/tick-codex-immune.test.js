import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureCodexImmune } from '../tick.js';

/**
 * ensureCodexImmune 单元测试
 * D3: 函数存在并可调用
 * D4: 超过 20h 时创建任务
 * D5: 任务字段正确
 * D6: 20h 内跳过（防重复）
 */

function makePool(lastCreatedAt = null) {
  const insertSpy = vi.fn().mockResolvedValue({ rows: [] });
  const pool = {
    query: vi.fn(async (sql) => {
      if (sql.trim().startsWith('SELECT created_at')) {
        return { rows: lastCreatedAt ? [{ created_at: lastCreatedAt }] : [] };
      }
      if (sql.trim().startsWith('INSERT INTO tasks')) {
        return insertSpy(sql);
      }
      return { rows: [] };
    }),
    _insertSpy: insertSpy
  };
  return pool;
}

describe('ensureCodexImmune', () => {
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
    // SQL 包含 codex_qa 和 P1
    expect(insertCall[0]).toContain('codex_qa');
    expect(insertCall[0]).toContain('P1');
    // 参数包含正确 title 和 description
    expect(insertCall[1][0]).toBe('Codex 免疫检查 - cecelia-core');
    expect(insertCall[1][1]).toContain('run-codex-immune.sh');
  });
});
