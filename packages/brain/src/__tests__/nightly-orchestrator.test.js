import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  return { mockQuery };
});

vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../capacity.js', () => ({ getMaxStreams: vi.fn().mockReturnValue(3) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));

import { generateOvernightReport } from '../nightly-orchestrator.js';

describe('generateOvernightReport — daily_logs type field', () => {
  beforeEach(() => vi.clearAllMocks());

  it("INSERT 使用 type='nightly_orchestration'（21 字符，曾超 VARCHAR(20)）", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ dispatched_today: 0, completed: 0, failed: 0, in_progress: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await generateOvernightReport().catch(() => {});

    const insertCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO daily_logs')
    );
    expect(insertCall, 'INSERT INTO daily_logs call not found').toBeDefined();

    const sqlStr = insertCall[0];
    expect(sqlStr).toContain("'nightly_orchestration'");
    expect('nightly_orchestration'.length).toBe(21);
  });

  it("UPDATE 路径（今日已有记录）— SQL 包含 UPDATE daily_logs", async () => {
    // 模拟：有记录存在（SELECT 返回一行），应走 UPDATE 分支
    // 注意：若模块内 _lastReportDate 已为今日（上一个测试设置），函数提前返回 skipped
    // 此测试通过直接验证 UPDATE SQL 结构（独立于模块状态）
    mockQuery
      .mockResolvedValueOnce({ rows: [{ dispatched_today: 2, completed: 1, failed: 0, in_progress: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-uuid' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await generateOvernightReport();

    expect(result.generated).toBe(true);
    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE daily_logs'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1][0]).toBe('existing-uuid');
    expect(JSON.parse(updateCall[1][1]).orchestrator.tasks).toEqual({
      dispatched: 2, completed: 1, failed: 0, in_progress: 1,
    });
  });
});
