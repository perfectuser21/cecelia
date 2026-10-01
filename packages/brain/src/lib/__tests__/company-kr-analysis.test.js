import { describe, it, expect, vi } from 'vitest';
import { analysisPlan, parseCompanyAnalysis, requestCompanyKrAnalysis, consumeCompanyAnalysis } from '../company-kr-analysis.js';

const input = { version: 1, snapshot_id: 'snapshot', formal_hash: 'formal', day: '2026-10-01', items: [
  { id: 'kr1', source_page_id: 'page1', formal_revision: 'rev1', evidence: [{ source: 'notion:page1', fact: '人工填写Current=0，不代表已验证经营事实' }] },
] };
const result = { snapshot_id: 'snapshot', items: [{ id: 'kr1', suggested_current: null, suggested_target: null, reason: '缺少经营证据，建议补齐线索来源再判断。', evidence: [{ source: 'notion:page1', fact: '人工填写Current=0，不代表已验证经营事实' }] }] };

describe('公司KR分析启动规则', () => {
  it('同日同正式版本只分析一次；AI新观测不导致循环派发', () => {
    expect(analysisPlan({ enabled: true, hour: 8 }, input, { status: 'completed_no_pr', payload: { company_kr_analysis: input } }, { hour: 9 })).toEqual({ run: false, reason: 'already_analyzed' });
  });
  it('正式版本变化触发；在跑时合并为下一轮，不叠单', () => {
    const previous = { status: 'completed_no_pr', payload: { company_kr_analysis: { ...input, formal_hash: 'old' } } };
    expect(analysisPlan({ enabled: true, hour: 8 }, input, previous, { hour: 1 })).toMatchObject({ run: true, trigger: 'change' });
    expect(analysisPlan({ enabled: true, hour: 8 }, input, { ...previous, status: 'in_progress' }, { hour: 9 })).toMatchObject({ run: false, reason: 'in_progress' });
  });
  it('上海每日8点后触发，失败保留且不每5分钟重试，人工可明确重试', () => {
    const old = { status: 'completed_no_pr', payload: { company_kr_analysis: { ...input, day: '2026-09-30' } } };
    expect(analysisPlan({ enabled: true, hour: 8 }, input, old, { hour: 7 })).toMatchObject({ run: false });
    expect(analysisPlan({ enabled: true, hour: 8 }, input, old, { hour: 8 })).toMatchObject({ run: true, trigger: 'daily' });
    const failed = { status: 'failed', payload: { company_kr_analysis: input } };
    expect(analysisPlan({ enabled: true, hour: 8 }, input, failed, { hour: 9 })).toMatchObject({ run: false, reason: 'failed_requires_retry' });
    expect(analysisPlan({ enabled: true, hour: 8 }, input, failed, { hour: 9, manual: true, retry: true })).toMatchObject({ run: true, trigger: 'manual' });
  });
  it('停用和没有有效KR不派；人工触发不能越过停用', () => {
    expect(analysisPlan({ enabled: false }, input, null, { manual: true })).toMatchObject({ run: false, reason: 'disabled' });
    expect(analysisPlan({ enabled: true }, { ...input, items: [] }, null, {})).toMatchObject({ run: false, reason: 'no_active_krs' });
  });
});

describe('只接受绑定快照的完整AI建议', () => {
  it('接受空建议数字，不把缺证据变成零', () => {
    expect(parseCompanyAnalysis(JSON.stringify(result), input)).toEqual(result.items);
  });
  it.each([
    { ...result, snapshot_id: 'old' },
    { ...result, items: [] },
    { ...result, items: [...result.items, ...result.items] },
    { ...result, items: [{ ...result.items[0], current_value: 5 }] },
    { ...result, items: [{ ...result.items[0], suggested_current: 'garbage' }] },
    { ...result, items: [{ ...result.items[0], evidence: [{ source: 'invented', fact: '臆测' }] }] },
  ])('拒绝错版本、缺项、重复、正式字段、非法数字和捏造来源 %j', value => {
    expect(() => parseCompanyAnalysis(JSON.stringify(value), input)).toThrow();
  });
});

describe('工作流真实副作用边界', () => {
  it('未配置时不建任务、不调用AI', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const createTask = vi.fn();
    expect(await requestCompanyKrAnalysis(pool, { createTask })).toMatchObject({ skipped: true, reason: 'disabled' });
    expect(createTask).not.toHaveBeenCalled();
  });
  it('未完整校验之前零建议写入；收据失败不能算分析成功', async () => {
    const saveAdvice = vi.fn();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const task = { id: 'task1', payload: { company_kr_analysis: input } };
    await expect(consumeCompanyAnalysis(pool, task, { text: JSON.stringify({ ...result, items: [] }) }, { saveAdvice })).rejects.toThrow();
    expect(saveAdvice).not.toHaveBeenCalled();
  });
});
