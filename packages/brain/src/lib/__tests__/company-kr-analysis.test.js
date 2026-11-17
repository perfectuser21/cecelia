import { describe, it, expect, vi } from 'vitest';
import { parseCompanyAnalysis, consumeCompanyAnalysis } from '../company-kr-analysis.js';

const input = { version: 1, snapshot_id: 'snapshot', formal_hash: 'formal', day: '2026-10-01', items: [
  { id: 'kr1', source_page_id: 'page1', formal_revision: 'rev1', evidence: [{ source: 'notion:page1', fact: '人工填写Current=0，不代表已验证经营事实' }] },
] };
const result = { snapshot_id: 'snapshot', items: [{ id: 'kr1', suggested_current: null, suggested_target: null, reason: '缺少经营证据，建议补齐线索来源再判断。', evidence: [{ source: 'notion:page1', fact: '人工填写Current=0，不代表已验证经营事实' }] }] };

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
    { ...result, items: [{ ...result.items[0], suggested_current: 999 }] },
  ])('拒绝错版本、缺项、重复、正式字段、非法数字和捏造来源 %j', value => {
    expect(() => parseCompanyAnalysis(JSON.stringify(value), input)).toThrow();
  });
});

describe('工作流真实副作用边界', () => {
  it('历史绑定快照仍消费可信建议并记录完成状态', async () => {
    const saveAdvice = vi.fn().mockResolvedValue({});
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const task = { id: 'existing-task', payload: { company_kr_analysis: input } };
    const receipt = await consumeCompanyAnalysis(pool, task, { text: JSON.stringify(result) }, { saveAdvice });
    expect(receipt).toMatchObject({ saved: ['kr1'], stale: [], snapshot_id: 'snapshot' });
    expect(saveAdvice).toHaveBeenCalledWith(pool, 'kr1', expect.objectContaining({ task_id: 'existing-task', actor: 'brain-openclaw-reaper', formal_revision: 'rev1', idempotency_key: 'existing-task:kr1' }));
    expect(pool.query.mock.calls.every(([sql]) => !sql.includes('INSERT INTO tasks'))).toBe(true);
    expect(pool.query.mock.calls[0][0]).toContain('UPDATE key_results SET metadata=');
  });
  it('未完整校验之前零建议写入；收据失败不能算分析成功', async () => {
    const saveAdvice = vi.fn();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const task = { id: 'task1', payload: { company_kr_analysis: input } };
    await expect(consumeCompanyAnalysis(pool, task, { text: JSON.stringify({ ...result, items: [] }) }, { saveAdvice })).rejects.toThrow();
    expect(saveAdvice).not.toHaveBeenCalled();
  });
});
