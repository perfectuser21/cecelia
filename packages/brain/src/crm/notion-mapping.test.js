import { describe, it, expect } from 'vitest';
import { parseCustomerPage, buildCustomerProperties, parseRelatedPage } from './notion-mapping.js';

const rich = value => ({ type: 'rich_text', rich_text: [{ plain_text: value }] });
const binding = { fields: { name: '客户名称', customer_id: '客户ID', manual: { notes: '人工备注' }, profile: '客户摘要' } };
const page = { id: 'page-1', last_edited_time: '2026-10-16T00:00:00Z', properties: {
  客户名称: { type: 'title', title: [{ plain_text: '同名客户' }] }, 客户ID: rich('legacy-id'), 人工备注: rich('人工内容'), 客户摘要: rich('AI内容'),
} };
describe('CRM Notion field ownership', () => {
  it('imports only configured human fields, preserves external legacy ID', () => {
    expect(parseCustomerPage(page, binding)).toMatchObject({ page_id: 'page-1', external_customer_id: 'legacy-id', display_name: '同名客户', manual_fields: { notes: '人工内容' } });
    expect(parseCustomerPage(page, binding).manual_fields).not.toHaveProperty('profile');
  });
  it('does not equate missing fields to explicit clears, rejects wrong types', () => {
    const missing = structuredClone(page); delete missing.properties.人工备注;
    expect(parseCustomerPage(missing, binding).manual_fields).toEqual({});
    missing.properties.人工备注 = { type: 'number', number: 1 };
    expect(() => parseCustomerPage(missing, binding)).toThrow();
  });
  it('accepts a newly entered customer whose external customer ID is blank', () => {
    const fresh = structuredClone(page); fresh.properties.客户ID = rich('');
    expect(parseCustomerPage(fresh, binding).external_customer_id).toBeNull();
  });
  it('projects only configured AI fields, never human notes or legacy customer ID', () => {
    expect(buildCustomerProperties({ id: 'brain-id', profile_managed: true, profile_markdown: '画像', manual_fields: { notes: '不要覆盖' } }, binding)).toEqual({ 客户摘要: { rich_text: [{ type: 'text', text: { content: '画像' } }] } });
  });
  it('distinguishes untouched profiles from explicit empty profiles, accepts long profiles', () => {
    expect(buildCustomerProperties({ profile_markdown: '' }, binding)).toEqual({});
    expect(buildCustomerProperties({ profile_managed: true, profile_markdown: '' }, binding).客户摘要.rich_text[0].text.content).toBe('');
    const parts = buildCustomerProperties({ profile_managed: true, profile_markdown: 'x'.repeat(2001) }, binding).客户摘要.rich_text;
    expect(parts.map(x => x.text.content).join('')).toHaveLength(2001);
  });
  it('requires a related record to point at this exact customer page', () => {
    const row = { id: 'report', properties: { 客户: { type: 'relation', relation: [{ id: 'another-page' }] } } };
    expect(() => parseRelatedPage(row, { customer_relation: '客户' }, 'page-1')).toThrow();
  });
});
