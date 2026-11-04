import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  return { mockQuery };
});

vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../capacity.js', () => ({ getMaxStreams: vi.fn().mockReturnValue(3) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));

let generateOvernightReport;

describe('generateOvernightReport — daily_logs type field', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    ({ generateOvernightReport } = await import('../nightly-orchestrator.js'));
  });

  it("INSERT 使用 type='nightly_orchestration'（21 字符，曾超 VARCHAR(20)）", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ dispatched_today: 0, completed: 0, failed: 0, in_progress: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await generateOvernightReport();
    expect(result.generated).toBe(true);

    const insertCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO daily_logs')
    );
    expect(insertCall, 'INSERT INTO daily_logs call not found').toBeDefined();

    const sqlStr = insertCall[0];
    expect(sqlStr).toContain("'nightly_orchestration'");
    expect('nightly_orchestration'.length).toBe(21);
  });

  it("UPDATE 路径（今日已有记录）— SQL 包含 UPDATE daily_logs", async () => {
    // 隔离同日缓存后，真实执行已有记录的更新分支。
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
