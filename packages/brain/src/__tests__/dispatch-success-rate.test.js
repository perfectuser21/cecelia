import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
// monitor-loop 的其他处置边界不参与本次统计，不启动监控循环。
vi.mock('../actions.js', () => ({ updateTask: vi.fn() }));
vi.mock('../rca-deduplication.js', () => ({
  shouldAnalyzeFailure: vi.fn(), cacheRcaResult: vi.fn(), getRcaCacheStats: vi.fn(),
}));
vi.mock('../auto-fix.js', () => ({
  shouldAutoFix: vi.fn(), dispatchToDevSkill: vi.fn(), getAutoFixStats: vi.fn(),
}));
vi.mock('../policy-validator.js', () => ({ validatePolicyJson: vi.fn() }));
import { detectFailureSpike } from '../monitor-loop.js';

// 生产检测器返回失败统计；旧测试附加的 success_rate 并非生产返回字段。
describe('detectFailureSpike — 真实1小时派发统计', () => {
  beforeEach(() => mockQuery.mockReset());
  it.each([
    ['部分失败', { failed_count: '3', total_count: '10', failure_rate: '0.30' },
      { failed_count: 3, total_count: 10, failure_rate: 0.3 }],
    ['没有运行记录', { failed_count: '0', total_count: '0', failure_rate: null },
      { failed_count: 0, total_count: 0, failure_rate: 0 }],
    ['全部失败', { failed_count: '5', total_count: '5', failure_rate: '1.00' },
      { failed_count: 5, total_count: 5, failure_rate: 1 }],
    ['全部成功', { failed_count: '0', total_count: '20', failure_rate: '0.00' },
      { failed_count: 0, total_count: 20, failure_rate: 0 }],
    ['空结果行', undefined, { failed_count: 0, total_count: 0, failure_rate: 0 }],
  ])('%s：执行真实查询并转换统计结果', async (_label, row, expected) => {
    mockQuery.mockResolvedValueOnce({ rows: row ? [row] : [] });
    expect(await detectFailureSpike()).toEqual(expected);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM\s+run_events/i);
    expect(sql).toMatch(/WHERE\s+ts_start\s*>\s*NOW\(\)\s*-\s*INTERVAL\s+'1 hour'/i);
    expect(sql).toMatch(/COUNT\(\*\)\s+FILTER\s*\(WHERE status = 'failed'\)/i);
  });
});
