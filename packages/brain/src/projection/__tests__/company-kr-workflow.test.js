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
    const result = await runCompanyKrWorkflow(pool, { project, analyze, register: async () => ({}), projectRegistration: async () => ({}) });
    expect(order).toEqual(['formal_committed', 'analysis_requested']);
    expect(result).toMatchObject({ ...projection, analysis: { task_id: 'analysis-task' } });
    expect(analyze).toHaveBeenCalledOnce();
  });

  it('分析停用仍完成来源同步，真实请求函数不登记任务', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ value_json: { enabled: false } }] }), connect: vi.fn() };
    const project = vi.fn().mockResolvedValue({ matched: 8, changed_ids: ['kr'] });
    expect(await runCompanyKrWorkflow(pool, { project, register: async () => ({}), projectRegistration: async () => ({}) })).toMatchObject({ matched: 8, changed_ids: ['kr'], analysis: { skipped: true, reason: 'disabled' } });
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });

  it('分析登记失败不能把该轮报告为成功', async () => {
    const project = vi.fn().mockResolvedValue({ matched: 8 }), analyze = vi.fn().mockRejectedValue(new Error('任务登记失败'));
    await expect(runCompanyKrWorkflow({}, { project, analyze })).rejects.toThrow('任务登记失败');
    expect(project).toHaveBeenCalledOnce(); expect(analyze).toHaveBeenCalledOnce();
  });
});

describe('KR同步周期登记接线',()=>{
  it('成功同步后补登记和投影，再交给原分析入口',async()=>{
    const order=[]; const deps=Object.fromEntries(['project','register','projectRegistration','analyze'].map(k=>[k,vi.fn(async()=>{order.push(k);return {};})]));
    await runCompanyKrWorkflow({},deps);
    expect(order).toEqual(['project','register','projectRegistration','analyze']);
    deps.project.mockResolvedValue({skipped:true});order.length=0;
    await runCompanyKrWorkflow({},deps);expect(order).toEqual([]);
  });
  it('Notion登记失败仍完成经营分析登记，并向调度器报失败',async()=>{
    const analyze=vi.fn().mockResolvedValue({task_id:'t'});
    await expect(runCompanyKrWorkflow({}, {project:async()=>({matched:8}),register:async()=>({workflow_id:'w'}),projectRegistration:async()=>{throw Error('Notion不可达');},analyze})).rejects.toThrow('Notion不可达');
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});
