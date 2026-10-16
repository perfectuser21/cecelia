import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projectOnboardCustomer } from './onboard-notion.js';
import { getOnboardPageState, reservePageAttempt, bindOnboardPage } from './onboard-page-store.js';

// 仅替代数据库访问；分页、schema校验和创建决策执行真实模块。
vi.mock('./onboard-page-store.js', async importOriginal => ({
  ...await importOriginal(), getOnboardPageState: vi.fn(), reservePageAttempt: vi.fn(), bindOnboardPage: vi.fn(),
}));
const customer = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', source_page_id: null };
const binding = { data_source_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', fields: { brain_id: 'Brain ID', customer_id: null, manual: {} } };
const schema = () => ({ id: binding.data_source_id, properties: { '客户名称': { type: 'title' }, 'Brain ID': { type: 'rich_text' } } });
const createCalls = request => request.mock.calls.filter(([path, method]) => path === '/pages' && method === 'POST');
beforeEach(() => { vi.resetAllMocks(); getOnboardPageState.mockResolvedValue({ binding, customer, attempt: null }); });

describe('好友Notion投影失败边界', () => {
  it.each(['missing_cursor', 'repeated_cursor', 'missing_has_more', 'incomplete_response', 'unbounded_cursor'])('不完整分页%s不能授权预留或创建', async mode => {
    let queries = 0;
    const request = vi.fn(async path => {
      if (!path.endsWith('/query')) return schema();
      queries++;
      if (mode === 'missing_has_more') return { results: [] };
      if (mode === 'incomplete_response') return { results: [], has_more: false, request_status: { type: 'incomplete' } };
      return { results: [], has_more: true, next_cursor: mode === 'missing_cursor' ? null : mode === 'repeated_cursor' ? 'same' : String(queries) };
    });
    await expect(projectOnboardCustomer({}, request, binding, customer)).rejects.toMatchObject({ code: 'incomplete_query' });
    expect(queries).toBe(mode === 'unbounded_cursor' ? 100 : mode === 'repeated_cursor' ? 2 : 1);
    expect(reservePageAttempt).not.toHaveBeenCalled();
    expect(bindOnboardPage).not.toHaveBeenCalled();
    expect(createCalls(request)).toHaveLength(0);
  });
  it('精确ID跨分页发现重复页面时不创建或绑定', async () => {
    let queries = 0;
    const request = vi.fn(async (path, method, body) => {
      if (!path.endsWith('/query')) return schema();
      queries++;
      expect(method).toBe('POST');
      expect(body.filter).toEqual({ property: 'Brain ID', rich_text: { equals: customer.id } });
      if (queries === 1) return { results: [{ id: 'first' }], has_more: true, next_cursor: 'next' };
      expect(body.start_cursor).toBe('next');
      return { results: [{ id: 'second' }], has_more: false };
    });
    await expect(projectOnboardCustomer({}, request, binding, customer)).rejects.toMatchObject({ code: 'identity_conflict' });
    expect(reservePageAttempt).not.toHaveBeenCalled();
    expect(bindOnboardPage).not.toHaveBeenCalled();
    expect(createCalls(request)).toHaveLength(0);
  });
  it('外来schema在分页查询或创建前拒绝', async () => {
    const request = vi.fn().mockResolvedValue({ ...schema(), id: customer.id });
    await expect(projectOnboardCustomer({}, request, binding, customer)).rejects.toMatchObject({ code: 'invalid_schema' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(reservePageAttempt).not.toHaveBeenCalled();
    expect(createCalls(request)).toHaveLength(0);
  });
  it('已映射客户不再调用外部API', async () => {
    const mapped = { ...customer, source_page_id: binding.data_source_id };
    getOnboardPageState.mockResolvedValue({ binding, customer: mapped, attempt: null });
    const request = vi.fn();
    await expect(projectOnboardCustomer({}, request, binding, customer)).resolves.toEqual({ status: 'already_mapped', customer: mapped });
    expect(request).not.toHaveBeenCalled();
    expect(reservePageAttempt).not.toHaveBeenCalled();
  });
  it('显式白名单不允许创建未知页面', async () => {
    getOnboardPageState.mockResolvedValue({ binding: { ...binding, fields: { ...binding.fields, allowed_page_ids: [] } }, customer, attempt: null });
    const request = vi.fn();
    await expect(projectOnboardCustomer({}, request, binding, customer)).resolves.toEqual({ status: 'blocked_scope' });
    expect(request).not.toHaveBeenCalled();
    expect(reservePageAttempt).not.toHaveBeenCalled();
  });
  it('未知创建重放查询零结果保留unknown，不重复POST', async () => {
    getOnboardPageState.mockResolvedValue({ binding, customer, attempt: { id: 'durable-fence' } });
    reservePageAttempt.mockResolvedValue({ binding, customer, created: false });
    const request = vi.fn(async path => path.endsWith('/query') ? { results: [], has_more: false } : schema());
    await expect(projectOnboardCustomer({}, request, binding, customer)).resolves.toEqual({ status: 'unknown' });
    expect(reservePageAttempt).toHaveBeenCalledTimes(1);
    expect(createCalls(request)).toHaveLength(0);
    expect(bindOnboardPage).not.toHaveBeenCalled();
  });
});
