import { describe, expect, it, vi } from 'vitest';
import { runCompanyKrWorkflow } from '../company-kr-workflow.js';

describe('公司KR同步后分析顺序', () => {
  it('来源同步失败时传播错误，零分析调用', async () => {
    const pool = {}, analyze = vi.fn();
    const project = vi.fn().mockRejectedValue(new Error('Notion分页未完成'));
    await expect(runCompanyKrWorkflow(pool, { project, analyze })).rejects.toThrow('Notion分页未完成');
    expect(project).toHaveBeenCalledWith(pool);
    expect(analyze).not.toHaveBeenCalled();
  });

  it.each(['not_registered', 'not_configured', 'interval', 'projection_locked'])('同步未执行（%s）时不启动分析', async reason => {
    const projection = { skipped: true, reason, changed_ids: [] }, analyze = vi.fn();
    expect(await runCompanyKrWorkflow({}, { project: async () => projection, analyze })).toBe(projection);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('先等待正式来源入账，再分析，保留同步结果和分析任务号', async () => {
    const order = [], pool = {}, projection = { matched: 9, changed_ids: ['kr-9'], errors: [] };
    const project = vi.fn(async () => { await Promise.resolve(); order.push('formal_committed'); return projection; });
    const analyze = vi.fn(async actual => { expect(actual).toBe(pool); order.push('analysis_requested'); return { task_id: 'analysis-task' }; });
    const result = await runCompanyKrWorkflow(pool, { project, analyze });
    expect(order).toEqual(['formal_committed', 'analysis_requested']);
    expect(result).toEqual({ ...projection, analysis: { task_id: 'analysis-task' } });
    expect(analyze).toHaveBeenCalledOnce();
  });

  it('分析停用仍完成来源同步，真实请求函数不登记任务', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ value_json: { enabled: false } }] }), connect: vi.fn() };
    const project = vi.fn().mockResolvedValue({ matched: 8, changed_ids: ['kr'] });
    expect(await runCompanyKrWorkflow(pool, { project })).toEqual({ matched: 8, changed_ids: ['kr'], analysis: { skipped: true, reason: 'disabled' } });
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });

  it('分析登记失败不能把该轮报告为成功', async () => {
    const project = vi.fn().mockResolvedValue({ matched: 8 }), analyze = vi.fn().mockRejectedValue(new Error('任务登记失败'));
    await expect(runCompanyKrWorkflow({}, { project, analyze })).rejects.toThrow('任务登记失败');
    expect(project).toHaveBeenCalledOnce(); expect(analyze).toHaveBeenCalledOnce();
  });
});
