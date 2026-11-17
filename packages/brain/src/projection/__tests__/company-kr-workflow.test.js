import { describe, expect, it, vi } from 'vitest';
vi.mock('../../recurring-notion-sync.js', () => ({ notionReq: vi.fn(() => { throw Error('禁止真实Notion请求'); }) }));
import { runCompanyKrWorkflow } from '../company-kr-workflow.js';
import { runCompanyKrProjection } from '../company-key-results.js';
import { fixture } from './company-kr.fixture.js';

describe('公司KR正式同步保留，自动分析退休', () => {
  it('真实同步保留人工正式值与导入收据，成功后零分析、零新任务', async () => {
    const f = fixture();
    f.page.properties.Name.title = [{ plain_text: '主理人确认的新标题' }];
    f.page.properties.Start.number = 2;
    f.page.properties.Current.number = 4;
    f.page.properties.Target.number = 12;
    const analyze = vi.fn().mockResolvedValue({ task_id: 'retired-task' });
    const result = await runCompanyKrWorkflow(f.pool, {
      project: pool => runCompanyKrProjection(pool, { token: 'fake', notionReq: f.notionReq, now: 1000000 }),
      register: async () => ({}), projectRegistration: async () => ({}), analyze,
    });
    expect(result).toMatchObject({ matched: 1, changed_ids: ['kr'] });
    expect(f.kr.title).toBe('主理人确认的新标题');
    expect(f.kr.metadata.company_metric).toMatchObject({ start: '2', current: '4', target: '12' });
    expect(f.task.result.metric_observations).toHaveLength(1);
    expect(f.task.result.metric_observations[0]).toMatchObject({ kind: 'human_formal_claim', actor: 'notion-inlet', after: { start: '2', current: '4', target: '12' } });
    const patches = f.notionReq.mock.calls.filter(([, path, method]) => path.startsWith('/pages/') && method === 'PATCH');
    expect(patches.every(([, , , body]) => Object.keys(body.properties).every(k => k.startsWith('AI')))).toBe(true);
    expect(f.page.properties.Current.number).toBe(4);
    expect(f.page.properties.Target.number).toBe(12);
    expect(f.page.properties.Start.number).toBe(2);
    expect(analyze).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('analysis');
    expect(f.pool.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO tasks'))).toBe(false);
  });
  it('正式来源读取失败继续报错，零分析', async () => {
    const f = fixture(), analyze = vi.fn();
    await expect(runCompanyKrWorkflow(f.pool, {
      project: pool => runCompanyKrProjection(pool, { token: 'fake', notionReq: async () => { throw Error('Notion分页未完成'); }, now: 1000000 }), analyze,
    })).rejects.toThrow('Notion分页未完成');
    expect(analyze).not.toHaveBeenCalled();
  });
  it.each(['not_registered', 'not_configured', 'interval', 'projection_locked'])('同步未执行（%s）保持原结果', async reason => {
    const result = { skipped: true, reason }, analyze = vi.fn();
    expect(await runCompanyKrWorkflow({}, { project: async () => result, analyze })).toBe(result);
    expect(analyze).not.toHaveBeenCalled();
  });
  it('正式同步后不再登记或投影退休分析能力', async () => {
    const register = vi.fn().mockResolvedValue({}), projectRegistration = vi.fn().mockResolvedValue({});
    expect(await runCompanyKrWorkflow({}, { project: async () => ({ matched: 1 }), register, projectRegistration })).toEqual({ matched: 1 });
    expect(register).not.toHaveBeenCalled();
    expect(projectRegistration).not.toHaveBeenCalled();
  });
});
