import { describe, it, expect } from 'vitest';
import { creationPayload, pageBrainId, validateOnboardPage } from './onboard-page-store.js';

const customerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const binding = { data_source_id: sourceId, fields: { brain_id: 'Brain ID', manual: { notes: '人工备注' } } };
const rich = content => ({ type: 'rich_text', rich_text: [{ text: { content } }] });
const page = () => ({ id: pageId, parent: { data_source_id: sourceId }, last_edited_time: '2026-10-16T08:00:00Z',
  properties: { 'Brain ID': rich(customerId), '客户名称': { type: 'title', title: [{ plain_text: '人工改名' }] }, '人工备注': rich('人工跟进记录') } });

describe('好友客户页身份与人工字段边界', () => {
  it('首次创建仅含客户名称和Brain ID，不覆盖人工备注或画像', () => {
    const payload = creationPayload(binding, { id: customerId, display_name: '初始昵称', manual_fields: { notes: '旧备注' }, profile_markdown: '画像' });
    expect(payload).toEqual({ parent: { type: 'data_source_id', data_source_id: sourceId }, properties: {
      '客户名称': { title: [{ type: 'text', text: { content: '初始昵称' } }] },
      'Brain ID': { rich_text: [{ type: 'text', text: { content: customerId } }] },
    } });
  });
  it('读取真实人工改名与备注，不使用初始昵称回盖', () => {
    expect(validateOnboardPage(page(), binding, customerId)).toMatchObject({ page_id: pageId, display_name: '人工改名', manual_fields: { notes: '人工跟进记录' } });
  });
  it('Brain ID允许大小写标准化，但缺失不猜测身份', () => {
    const value = page(); value.properties['Brain ID'] = rich(customerId.toUpperCase());
    expect(pageBrainId(value, binding)).toBe(customerId);
    delete value.properties['Brain ID'];
    expect(pageBrainId(value, binding)).toBeNull();
  });
  it.each([rich('张总'), { type: 'title', title: [] }])('非法Brain ID或属性类型拒绝', property => {
    const value = page(); value.properties['Brain ID'] = property;
    expect(() => pageBrainId(value, binding)).toThrow(expect.objectContaining({ code: 'identity_conflict' }));
  });
  it.each([
    { parent: { data_source_id: pageId } }, { archived: true }, { in_trash: true },
    { properties: { 'Brain ID': rich(pageId) } },
  ])('外来数据源、归档页或其他客户ID不能绑定：%j', change => {
    expect(() => validateOnboardPage({ ...page(), ...change }, binding, customerId)).toThrow(expect.objectContaining({ code: 'identity_conflict' }));
  });
  it('空白名单与外来页面拒绝，明确授权页面可读', () => {
    for (const allowed_page_ids of [[], [sourceId]]) {
      expect(() => validateOnboardPage(page(), { ...binding, fields: { ...binding.fields, allowed_page_ids } }, customerId)).toThrow(expect.objectContaining({ code: 'blocked_scope' }));
    }
    expect(validateOnboardPage(page(), { ...binding, fields: { ...binding.fields, allowed_page_ids: [pageId] } }, customerId).page_id).toBe(pageId);
  });
  it('创建身份字段缺失或与标题重名时拒绝', () => {
    for (const brain_id of ['', '客户名称']) expect(() => creationPayload({ ...binding, fields: { brain_id } }, { id: customerId })).toThrow(expect.objectContaining({ code: 'invalid_schema' }));
  });
});
