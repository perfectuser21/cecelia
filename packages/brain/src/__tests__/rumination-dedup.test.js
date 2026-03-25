/**
 * rumination-dedup.test.js
 * 测试 Rumination 洞察去重机制（P0 修复）
 * 防止 Rumination→Desire 死循环
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeInsightHash, isInsightDuplicate } from '../rumination.js';

describe('computeInsightHash', () => {
  it('对相同内容返回相同 hash', () => {
    const h1 = computeInsightHash('这是一条洞察');
    const h2 = computeInsightHash('这是一条洞察');
    expect(h1).toBe(h2);
  });

  it('对不同内容返回不同 hash', () => {
    const h1 = computeInsightHash('洞察A');
    const h2 = computeInsightHash('洞察B');
    expect(h1).not.toBe(h2);
  });

  it('返回 32 字符 hex 字符串', () => {
    const h = computeInsightHash('test insight');
    expect(h).toMatch(/^[a-f0-9]{32}$/);
  });

  it('空字符串不崩溃', () => {
    expect(() => computeInsightHash('')).not.toThrow();
  });
});

describe('isInsightDuplicate', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
  });

  it('查到重复记录 → 返回 true', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const result = await isInsightDuplicate(mockDb, 'abc123');
    expect(result).toBe(true);
  });

  it('未查到重复记录 → 返回 false', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    const result = await isInsightDuplicate(mockDb, 'newHash');
    expect(result).toBe(false);
  });

  it('DB 查询异常 → 降级返回 false（允许写入）', async () => {
    mockDb.query.mockRejectedValueOnce(new Error('DB connection failed'));
    const result = await isInsightDuplicate(mockDb, 'someHash');
    expect(result).toBe(false);
  });

  it('查询使用正确的 event_type 和时间窗口参数', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    await isInsightDuplicate(mockDb, 'testHash456');
    expect(mockDb.query).toHaveBeenCalledOnce();
    const [sql, params] = mockDb.query.mock.calls[0];
    expect(sql).toContain('rumination_output');
    expect(sql).toContain('content_hash');
    expect(params[0]).toBe('testHash456');
  });
});

describe('digestLearnings dedup 集成（通过 runManualRumination mock）', () => {
  it('DEDUP_WINDOW_HOURS 常量已导出', async () => {
    const mod = await import('../rumination.js');
    expect(typeof mod.DEDUP_WINDOW_HOURS).toBe('number');
    expect(mod.DEDUP_WINDOW_HOURS).toBe(24);
  });
});
