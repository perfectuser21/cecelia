import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTriageOfficer15min, __resetTriageOfficer15minForTest, LEADERBOARD_KEY } from '../triage-officer-15min.js';

function makePool(queryResults = []) {
  let callIdx = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      const result = queryResults[callIdx] ?? { rows: [] };
      callIdx++;
      return Promise.resolve(result);
    }),
  };
}

describe('runTriageOfficer15min', () => {
  beforeEach(() => {
    __resetTriageOfficer15minForTest();
    vi.clearAllMocks();
  });

  it('15min 内重复调用跳过', async () => {
    const pool = makePool([{ rows: [] }, { rows: [] }]);
    await runTriageOfficer15min(pool);              // 第一次跑
    const result = await runTriageOfficer15min(pool); // 15min 内再跑
    expect(result).toMatchObject({ skipped: true });
  });

  it('规则1: 查询了重名归并 SQL（PARTITION BY title, task_type）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await runTriageOfficer15min(pool);
    const mergeCall = pool.query.mock.calls.find(
      (args) => args[0].includes('PARTITION BY title'),
    );
    expect(mergeCall).toBeDefined();
  });

  it('规则1: 归并结果反映在返回值 merged 字段', async () => {
    const pool = {
      query: vi.fn()
        // 规则1归并：取消了 2 条
        .mockResolvedValueOnce({ rows: [{ id: 'x', title: '任务X' }, { id: 'y', title: '任务Y' }] })
        // 规则2 否决窗：无 leaderboard
        .mockResolvedValueOnce({ rows: [] }),
    };
    const result = await runTriageOfficer15min(pool);
    expect(result.merged).toBe(2);
  });

  it('规则2: 否决窗未过期不放行', async () => {
    const vetoDl = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h 后
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // 规则1归并
        .mockResolvedValueOnce({
          rows: [{
            value_json: {
              leaderboard: [{ id: '11111111-0000-0000-0000-000000000001' }],
              veto_deadline: vetoDl,
              vetoed: false,
            },
          }],
        }), // 规则2 读 leaderboard
    };
    const result = await runTriageOfficer15min(pool);
    expect(result.autoApproved).toBe(0);
  });

  it('规则2: 否决窗过期且 !vetoed → autoApproved 有值', async () => {
    const vetoDl = new Date(Date.now() - 60 * 1000).toISOString(); // 1min 前已过期
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // 规则1归并
        .mockResolvedValueOnce({               // 规则2 读 leaderboard
          rows: [{
            value_json: {
              leaderboard: [{ id: '11111111-0000-0000-0000-000000000001' }],
              veto_deadline: vetoDl,
              vetoed: false,
            },
          }],
        })
        .mockResolvedValueOnce({ rows: [{ id: '11111111-0000-0000-0000-000000000001' }] }) // UPDATE tasks
        .mockResolvedValueOnce({ rows: [] }), // 写 sentinel
    };
    const result = await runTriageOfficer15min(pool);
    expect(result.autoApproved).toBe(1);
  });

  it('规则2: vetoed=true 时不放行', async () => {
    const vetoDl = new Date(Date.now() - 60 * 1000).toISOString();
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            value_json: {
              leaderboard: [{ id: '11111111-0000-0000-0000-000000000001' }],
              veto_deadline: vetoDl,
              vetoed: true,
            },
          }],
        }),
    };
    const result = await runTriageOfficer15min(pool);
    expect(result.autoApproved).toBe(0);
  });

  it('规则2: auto_approved_at 已存在时不重复放行', async () => {
    const vetoDl = new Date(Date.now() - 60 * 1000).toISOString();
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            value_json: {
              leaderboard: [{ id: '11111111-0000-0000-0000-000000000001' }],
              veto_deadline: vetoDl,
              vetoed: false,
              auto_approved_at: new Date().toISOString(), // 已放行
            },
          }],
        }),
    };
    const result = await runTriageOfficer15min(pool);
    expect(result.autoApproved).toBe(0);
  });

  it('DB 错误时 fail-open，返回 merged=0 autoApproved=0', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    const result = await runTriageOfficer15min(pool);
    expect(result).toMatchObject({ merged: 0, autoApproved: 0 });
  });
});
