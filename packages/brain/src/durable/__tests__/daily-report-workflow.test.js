import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOS: { registerStep: fn => fn, registerWorkflow: fn => fn },
}));
vi.mock('../../db.js', () => ({ default: {} }));
vi.mock('../../notifier.js', () => ({ sendFeishu: vi.fn() }));

import { configureDurableDeps, durableDailyReportWorkflow } from '../daily-report-durable.js';

// 仅替换持久化执行框架，业务运行检查和日报文本生成使用真实模块。
describe('durable 运行日报的业务步骤', () => {
  const saved = [];
  const send = vi.fn();
  const query = vi.fn(async (sql, params) => {
    const text = String(sql);
    if (/FROM dispatch_events/.test(text)) {
      return { rows: [{ task_id: 'unrecorded-dispatch-7', dispatched_at: '2026-11-13T12:00:00Z' }] };
    }
    if (/INSERT INTO working_memory/.test(text)) saved.push(params);
    return { rows: [] };
  });
  beforeEach(() => {
    saved.length = 0;
    send.mockClear();
    query.mockClear();
    configureDurableDeps({ pool: { query }, sendFeishu: send, trace: async () => {}, beforeSave: async () => {} });
  });

  it('先保存带真实运行告警的正文和幂等记录，再推送同一份正文', async () => {
    const result = await durableDailyReportWorkflow({ today: '2026-11-14', yesterday: '2026-11-13' });
    expect(result).toEqual({ generated: true, date: '2026-11-14' });
    const report = JSON.parse(saved.find(params => params[0] === 'daily_report_2026-11-14')[1]).report;
    expect(report).toContain('Brain 运行日报');
    expect(report).toContain('unrecorded-dispatch-7');
    expect(report).toContain('AMBER');
    expect(saved.some(params => params[0] === 'daily_report_triggered_2026-11-14')).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(report);
  });

  it('保存失败不推送未落账的运行日报', async () => {
    configureDurableDeps({ beforeSave: async () => { throw new Error('save unavailable'); } });
    await expect(durableDailyReportWorkflow({ today: '2026-11-14', yesterday: '2026-11-13' })).rejects.toThrow('save unavailable');
    expect(saved).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
