import { describe, expect, it, vi } from 'vitest';
import { readCompanySnapshot, ensureCompanyAiSchema, companyAiProperties, projectCompanyAi, COMPANY_AI_PROPERTIES } from '../company-kr-notion.js';
import { COMPANY_GOALS, COMPANY_KR_DATABASE, companyFormalRevision } from '../../lib/company-kr-metrics.js';
import { fixture } from './company-kr.fixture.js';

describe('公司Notion来源和AI列合同', () => {
  it('保留原公式与列类型门禁', async () => {
    await expect(readCompanySnapshot({ token: 'fake', notionReq: async () => ({ properties: {} }) })).rejects.toThrow();
  });
  it('动态成员按来源ID读取，新空页单独反馈，不阻断已有KR', async () => {
    const f = fixture(); f.pages.push({ ...structuredClone(f.page), id: 'new', properties: { ...structuredClone(f.page.properties), Goal: { relation: [] } } });
    const snapshot = await readCompanySnapshot({ token: 'fake', notionReq: f.notionReq });
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.errors).toEqual(expect.arrayContaining([expect.objectContaining({ page_id: 'new' })]));
    expect(snapshot.complete).toBe(true);
  });
  it('新增Goal须验证原GoalDB，错误归属作为页反馈', async () => {
    const f = fixture();
    const notionReq = async (...args) => { const page = await f.notionReq(...args); if (args[1] === `/pages/${COMPANY_GOALS[0].page_id}`) page.parent.database_id = 'wrong'; return page; };
    const snapshot = await readCompanySnapshot({ token: 'fake', notionReq });
    expect(snapshot.records).toHaveLength(0); expect(snapshot.errors[0].error).toMatch(/Goal.*归属/);
  });
});

it('AI状态用中文区分失败与完成，正式版本过期优先于旧排队状态', async () => {
  const { companyAiProperties } = await import('../company-kr-notion.js');
  const f = fixture();
  f.kr.metadata.company_analysis = { status: 'completed_no_pr' };
  expect(companyAiProperties(f.kr)['AI分析状态'].rich_text[0].text.content).toBe('分析完成，尚无有效建议');
  f.kr.metadata.company_advice = { formal_revision: 'old', reason: '旧建议' };
  f.kr.metadata.company_analysis.status = 'queued';
  expect(companyAiProperties(f.kr)['AI分析状态'].rich_text[0].text.content).toContain('过期');
  f.kr.metadata.company_status = 'Paused';
  expect(companyAiProperties(f.kr)['AI分析状态'].rich_text[0].text.content).toContain('停止分析');
});

it('完整分页包含新增页且单位来自Unit，保留历史seed单位', async () => {
  const f = fixture();
  const added = { ...structuredClone(f.page), id: 'new-kr', properties: { ...structuredClone(f.page.properties), Unit: { rich_text: [{ text: { content: '客户数' } }] } } };
  let page = 0;
  const notionReq = vi.fn(async (...args) => {
    if (args[1].endsWith('/query')) return ++page === 1
      ? { results: [f.page], has_more: true, next_cursor: 'next' }
      : { results: [added], has_more: false };
    return f.notionReq(...args);
  });
  const snapshot = await readCompanySnapshot({ token: 'fake', notionReq });
  expect(snapshot).toMatchObject({ complete: true, errors: [] });
  expect(snapshot.records.map(r => r.unit)).toEqual([f.kr.unit, '客户数']);
  expect(notionReq.mock.calls.filter(([, path]) => path.endsWith('/query'))[1][3]).toMatchObject({ start_cursor: 'next' });
});

it.each(['missing_cursor', 'repeated_cursor', 'wrong_parent'])('拒绝不完整或错误来源快照：%s', async mode => {
  const f = fixture(); let calls = 0;
  const notionReq = vi.fn(async (...args) => {
    if (args[1].endsWith('/query')) {
      calls++;
      if (mode === 'wrong_parent') return { results: [{ ...f.page, parent: { database_id: 'foreign' } }], has_more: false };
      return { results: [], has_more: true, next_cursor: mode === 'missing_cursor' ? null : 'same-cursor' };
    }
    return f.notionReq(...args);
  });
  await expect(readCompanySnapshot({ token: 'fake', notionReq })).rejects.toThrow(mode === 'wrong_parent' ? '归属' : '分页');
  expect(calls).toBe(mode === 'repeated_cursor' ? 2 : 1);
  expect(notionReq.mock.calls.some(([, , method]) => method === 'PATCH')).toBe(false);
});

it('schema只补独立AI栏和Unit；已有列类型冲突时零写', async () => {
  const f = fixture(), before = structuredClone(f.schema);
  await ensureCompanyAiSchema('fake', f.notionReq, f.schema);
  const patch = f.notionReq.mock.calls.find(([, , method]) => method === 'PATCH');
  expect(patch.slice(1, 3)).toEqual([`/databases/${COMPANY_KR_DATABASE}`, 'PATCH']);
  expect(patch[3].properties).toEqual(COMPANY_AI_PROPERTIES);
  expect(Object.entries(before.properties).every(([key, value]) => JSON.stringify(f.schema.properties[key]) === JSON.stringify(value))).toBe(true);
  f.notionReq.mockClear();
  await ensureCompanyAiSchema('fake', f.notionReq, f.schema);
  expect(f.notionReq).not.toHaveBeenCalled();
  f.schema.properties['AI建议'].type = 'number';
  await expect(ensureCompanyAiSchema('fake', f.notionReq, f.schema)).rejects.toThrow('列类型');
  expect(f.notionReq).not.toHaveBeenCalled();
});

it('生成并投影仅AI属性，正式数字与公式保持原值，等价Notion回读不重写', async () => {
  const f = fixture(), formal = structuredClone(f.page.properties);
  f.kr.metadata.last_observation = { current_value: '2.345' };
  f.kr.metadata.company_advice = { suggested_current: '2.345', suggested_target: null, reason: '补充经营证据',
    formal_revision: companyFormalRevision(f.kr), analyzed_at: '2026-10-01T01:00:00Z', evidence: [{ fact: '实测2.345', source: 'task:observation' }] };
  const properties = companyAiProperties(f.kr);
  expect(await projectCompanyAi('fake', f.notionReq, f.page.id, f.page.properties, properties)).toBe(true);
  const body = f.notionReq.mock.calls[0][3];
  expect(Object.keys(body.properties).every(key => key.startsWith('AI'))).toBe(true);
  expect(body.properties['AI建议'].rich_text[0].text.content).toContain('task:observation');
  expect(body.properties['AI建议目标'].number).toBeNull();
  for (const [key, value] of Object.entries(formal)) expect(f.page.properties[key]).toEqual(value);
  f.page.properties['AI建议'].rich_text = [{ plain_text: properties['AI建议'].rich_text[0].text.content }];
  f.page.properties['AI分析时间'].date.start = '2026-10-01T09:00:00+08:00';
  f.notionReq.mockClear();
  expect(await projectCompanyAi('fake', f.notionReq, f.page.id, f.page.properties, properties)).toBe(false);
  expect(f.notionReq).not.toHaveBeenCalled();
});
