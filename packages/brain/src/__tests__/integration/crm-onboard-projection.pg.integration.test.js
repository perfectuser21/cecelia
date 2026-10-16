import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as store from '../../crm/store.js';
import { onboardContact } from '../../crm/onboard-store.js';
import { runCrmSync, createNotionRequest } from '../../crm/notion-sync.js';
import { crmPgTestConfig, createCrmPgFixture } from '../helpers/crm-pg-fixture.js';
const api = await import('../../crm/onboard-notion.js').catch(() => ({}));
const mapping = await import('../../crm/onboard-page-store.js').catch(() => ({}));
const tenant = 'e1000000-0000-4000-8000-000000000001';
const id = n => `e2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fields = { name: '客户名称', brain_id: 'Brain ID', customer_id: null, profile: null, manual: { notes: '人工备注' } };
describe.skipIf(!crmPgTestConfig().enabled)('好友客户Notion投影：真PG+fake协议，不访问真实Notion', () => {
  let fx, db, binding, customer, pages, request, nextPage;
  const makePage = (customerId, pageId, source) => ({ id: pageId, parent: { data_source_id: source }, last_edited_time: '2026-10-16T02:00:00Z', properties: {
    客户名称: { type: 'title', title: [{ plain_text: 'Notion人工名字' }] },
    'Brain ID': { type: 'rich_text', rich_text: [{ plain_text: customerId }] },
    人工备注: { type: 'rich_text', rich_text: [{ plain_text: '人工备注保留' }] },
  } });
  beforeEach(async () => {
    fx = await createCrmPgFixture(); db = fx.db; pages = new Map(); nextPage = 10;
    binding = await store.configureBinding(db, { tenant_id: tenant, data_source_id: id(1), enabled: true, fields });
    await store.registerAccount(db, tenant, { account_id: 'self', agent_id: 'agent' });
    customer = (await onboardContact(db, { tenant_id: tenant, binding_id: binding.id, account_id: 'self', contact_id: 'native', event_id: 'friend', display_name: '首次昵称', authorized: true, scope: 'test', authorization_ref: 'approved-test-task', identity_evidence_sha256: 'a'.repeat(64), observed_at: '2026-10-16T01:00:00Z', friendship_status: 'confirmed' })).customer;
    request = vi.fn(async (path, method = 'GET', body) => {
      if (path.startsWith('/data_sources/') && method === 'GET') return { id: id(1), properties: { 客户名称: { type: 'title' }, 'Brain ID': { type: 'rich_text' }, 人工备注: { type: 'rich_text' } } };
      if (path.endsWith('/query')) {
        const selected = [...pages.values()].filter(p => !body.filter?.rich_text || p.properties['Brain ID'].rich_text[0].plain_text === body.filter.rich_text.equals);
        return { results: structuredClone(selected), has_more: false };
      }
      if (path === '/pages' && method === 'POST') {
        const page = makePage(body.properties['Brain ID'].rich_text[0].text.content, id(nextPage++), body.parent.data_source_id);
        pages.set(page.id, page); return structuredClone(page);
      }
      if (path.startsWith('/pages/') && method === 'GET') return structuredClone(pages.get(path.split('/')[2]));
      throw Error('fake protocol unexpected request');
    });
  });
  afterEach(async () => { vi.unstubAllEnvs(); if (fx) await fx.close(); });
  const creates = request => request.mock.calls.filter(c => c[0] === '/pages' && c[1] === 'POST');
  it('fence独立提交先于create，最小属性创建且读回人工字段入原UUID', async () => {
    const normal = request.getMockImplementation(), observer = await fx.connect();
    request.mockImplementation(async (path, method, body) => {
      if (path === '/pages') expect((await observer.query('SELECT count(*)::int n FROM crm_customer_page_attempts')).rows[0].n).toBe(1);
      return normal(path, method, body);
    });
    const result = await api.projectOnboardCustomer(db, request, binding, customer);
    expect(result.status).toBe('mapped'); expect(result.customer.id).toBe(customer.id);
    expect(result.customer).toMatchObject({ display_name: 'Notion人工名字', manual_fields: { notes: '人工备注保留' } });
    expect(Object.keys(creates(request)[0][2].properties).sort()).toEqual(['Brain ID','客户名称']);
    expect(creates(request)).toHaveLength(1);
    expect((await api.projectOnboardCustomer(db, request, binding, customer)).status).toBe('already_mapped');
    expect(creates(request)).toHaveLength(1);
  });
  it('POST服务端已创建但响应超时，重跑找回原页且不重发', async () => {
    const normal = request.getMockImplementation(); let timeout = true;
    request.mockImplementation(async (path, method, body) => {
      const result = await normal(path, method, body);
      if (path === '/pages' && timeout) { timeout = false; throw Object.assign(Error('timeout'), { code: 'ETIMEDOUT' }); }
      return result;
    });
    expect((await api.projectOnboardCustomer(db, request, binding, customer)).status).toBe('unknown');
    expect((await api.projectOnboardCustomer(db, request, binding, customer)).status).toBe('mapped');
    expect(creates(request)).toHaveLength(1);
  });
  it('POST未知且连续查询0，pending保留、不清fence、不再POST', async () => {
    const normal = request.getMockImplementation();
    request.mockImplementation((path, method, body) => path === '/pages' ? Promise.reject(Object.assign(Error('timeout'), { code: 'ETIMEDOUT' })) : normal(path, method, body));
    for (let n = 0; n < 3; n++) expect((await api.projectOnboardCustomer(db, request, binding, customer)).status).toBe('unknown');
    expect(creates(request)).toHaveLength(1);
    expect((await store.getCustomer(db, tenant, customer.id)).projection_pending).toBe(true);
    expect((await db.query('SELECT count(*)::int n FROM crm_customer_page_attempts')).rows[0].n).toBe(1);
  });
  it('asyncunknown不绑定，后续可见后只查询恢复', async () => {
    const normal = request.getMockImplementation();
    request.mockImplementation(async (path, method, body) => { const value = await normal(path, method, body); return path === '/pages' ? { object: 'async_task', id: 'async' } : value; });
    expect((await api.projectOnboardCustomer(db, request, binding, customer)).status).toBe('unknown');
    expect((await api.projectOnboardCustomer(db, request, binding, customer)).status).toBe('mapped');
    expect(creates(request)).toHaveLength(1);
  });
  it.each([{ allowed: [] }, { allowed: [id(90)] }])('任何allowlist数组都禁止未知page自动创建 %j', async ({ allowed }) => {
    binding = await store.configureBinding(db, { tenant_id: tenant, data_source_id: id(1), enabled: true, fields: { ...fields, allowed_page_ids: allowed } });
    expect((await api.projectOnboardCustomer(db, request, binding, customer)).status).toBe('blocked_scope');
    expect(creates(request)).toHaveLength(0); expect((await db.query('SELECT count(*)::int n FROM crm_customer_page_attempts')).rows[0].n).toBe(0);
  });
  it.each(['disabled','scope','revision'])('create返回前配置被%s改变，不绑定且fence不重置', async change => {
    const normal = request.getMockImplementation();
    request.mockImplementation(async (path, method, body) => {
      const value = await normal(path, method, body);
      if (path === '/pages') await store.configureBinding(db, { tenant_id: tenant, data_source_id: id(1), enabled: change !== 'disabled', fields: change === 'scope' ? { ...fields, allowed_page_ids: [] } : change === 'revision' ? { ...fields, managed_content: true } : fields });
      return value;
    });
    await expect(api.projectOnboardCustomer(db, request, binding, customer)).rejects.toThrow();
    expect((await store.getCustomer(db, tenant, customer.id)).source_page_id).toBeNull();
    expect((await db.query('SELECT count(*)::int n FROM crm_customer_page_attempts')).rows[0].n).toBe(1);
  });
  it('两连接并发projector至多一次create', async () => {
    const a = await fx.connect(), b = await fx.connect();
    const results = await Promise.all([api.projectOnboardCustomer(a, request, binding, customer), api.projectOnboardCustomer(b, request, binding, customer)]);
    expect(results.some(r => r.status === 'mapped' || r.status === 'already_mapped')).toBe(true); expect(creates(request)).toHaveLength(1);
  });
  it('创建返回前pull恢复映射，随后projector确认同一页', async () => {
    const normal = request.getMockImplementation(), pulling = await fx.connect();
    request.mockImplementation(async (path, method, body) => {
      const page = await normal(path, method, body);
      if (path === '/pages') expect((await api.recoverOnboardPage(pulling, request, binding, page)).customer.id).toBe(customer.id);
      return page;
    });
    expect((await api.projectOnboardCustomer(db, request, binding, customer)).customer.source_page_id).toBe(id(10));
    expect(creates(request)).toHaveLength(1); expect((await db.query('SELECT count(*)::int n FROM crm_customers')).rows[0].n).toBe(1);
  });
  it('恢复查询完整分页，第二页出现重复BrainID拒绝任何绑定', async () => {
    await mapping.reservePageAttempt(db, binding, customer);
    const p1 = makePage(customer.id, id(10), id(1)), p2 = makePage(customer.id, id(11), id(1)); pages.set(p1.id, p1); pages.set(p2.id, p2);
    const normal = request.getMockImplementation();
    request.mockImplementation((path, method, body) => path.endsWith('/query') ? Promise.resolve(body.start_cursor ? { results: [p2], has_more: false } : { results: [p1], has_more: true, next_cursor: 'second' }) : normal(path, method, body));
    await expect(api.recoverOnboardPage(db, request, binding, p1)).rejects.toMatchObject({ code: 'identity_conflict' });
    expect((await store.getCustomer(db, tenant, customer.id)).source_page_id).toBeNull(); expect(creates(request)).toHaveLength(0);
  });
  it('无attempt、未知/跨tenant/binding BrainID或已绑另一页均拒绝而不普通导入', async () => {
    const page = makePage(customer.id, id(10), id(1)); pages.set(page.id, page);
    await expect(api.recoverOnboardPage(db, request, binding, page)).rejects.toThrow();
    await mapping.reservePageAttempt(db, binding, customer);
    await expect(api.recoverOnboardPage(db, request, binding, { ...page, properties: { ...page.properties, 'Brain ID': { type: 'rich_text', rich_text: [{ plain_text: id(99) }] } } })).rejects.toThrow();
    await expect(api.recoverOnboardPage(db, request, { ...binding, tenant_id: id(98) }, page)).rejects.toThrow();
    await expect(api.recoverOnboardPage(db, request, { ...binding, id: id(97) }, page)).rejects.toThrow();
    await api.recoverOnboardPage(db, request, binding, page);
    const other = makePage(customer.id, id(11), id(1)); pages.set(other.id, other);
    await expect(api.recoverOnboardPage(db, request, binding, other)).rejects.toThrow();
    expect((await db.query('SELECT count(*)::int n FROM crm_customers')).rows[0].n).toBe(1);
  });
  it('两不同page并发CAS绑定仅一页成功，错parent或错BrainID零绑定', async () => {
    await mapping.reservePageAttempt(db, binding, customer);
    const p1 = makePage(customer.id, id(10), id(1)), p2 = makePage(customer.id, id(11), id(1));
    await expect(mapping.bindOnboardPage(db, binding, customer.id, { ...p1, parent: { data_source_id: id(99) } })).rejects.toThrow();
    const a = await fx.connect(), b = await fx.connect();
    const results = await Promise.allSettled([mapping.bindOnboardPage(a, binding, customer.id, p1), mapping.bindOnboardPage(b, binding, customer.id, p2)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  });
  it('runCrmSync遇pending BrainID先恢复同一UUID，普通导入不得新建', async () => {
    await mapping.reservePageAttempt(db, binding, customer);
    const page = makePage(customer.id, id(10), id(1)); pages.set(page.id, page);
    vi.stubEnv('CRM_SYNC_ENABLED', 'true');
    const pool = { connect: async () => ({ query: db.query.bind(db), release() {} }) };
    const base = await import('../../crm/store.js');
    await runCrmSync(pool, binding.id, { request, store: { ...base, listPending: async () => [] } });
    expect((await store.getCustomer(db, tenant, customer.id)).source_page_id).toBe(page.id);
    expect((await db.query('SELECT count(*)::int n FROM crm_customers')).rows[0].n).toBe(1);
  });
  it('已确认同页后正常配置更新可继续pull，旧fence保留且不再创建', async () => {
    const mapped = await api.projectOnboardCustomer(db, request, binding, customer);
    binding = await store.configureBinding(db, { tenant_id: tenant, data_source_id: id(1), enabled: true, fields: { ...fields, managed_content: true } });
    const restored = await api.recoverOnboardPage(db, request, binding, pages.get(mapped.customer.source_page_id));
    expect(restored.customer.id).toBe(customer.id); expect(restored.recovered).toBe(false);
    expect(creates(request)).toHaveLength(1); expect((await db.query('SELECT count(*)::int n FROM crm_customer_page_attempts')).rows[0].n).toBe(1);
  });
  it('fence提交后进程退出且未POST，重启只查询，不能自动重发', async () => {
    await mapping.reservePageAttempt(db, binding, customer);
    expect((await api.projectOnboardCustomer(db, request, binding, customer)).status).toBe('unknown');
    expect(creates(request)).toHaveLength(0); expect((await store.getCustomer(db, tenant, customer.id)).source_page_id).toBeNull();
  });
  it('查询分页不完整不创建；页面唯一约束拒绝占用其他客户的页', async () => {
    const normal = request.getMockImplementation();
    request.mockImplementation((path, method, body) => path.endsWith('/query') ? Promise.resolve({ results: [], has_more: true, next_cursor: null }) : normal(path, method, body));
    await expect(api.projectOnboardCustomer(db, request, binding, customer)).rejects.toMatchObject({ code: 'incomplete_query' });
    expect(creates(request)).toHaveLength(0); expect((await db.query('SELECT count(*)::int n FROM crm_customer_page_attempts')).rows[0].n).toBe(0);
    const existing = (await store.ingestCustomer(db, binding, { page_id: id(20), display_name: '其他人工客户', source_edited_at: '2026-10-16T02:00:00Z' })).customer;
    await mapping.reservePageAttempt(db, binding, customer);
    await expect(mapping.bindOnboardPage(db, binding, customer.id, makePage(customer.id, id(20), id(1)))).rejects.toMatchObject({ code: 'identity_conflict' });
    expect((await store.getCustomer(db, tenant, customer.id)).source_page_id).toBeNull();
    expect((await store.getCustomer(db, tenant, existing.id)).source_page_id).toBe(id(20));
  });
  it('真实HTTP adapter收到创建429只发一次网络POST，fence保留且重跑unknown', async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      expect(new URL(url).origin).toBe('https://api.notion.com');
      const path = new URL(url).pathname.replace(/^\/v1/, '');
      if (path === '/pages' && options.method === 'POST') return { status: 429, ok: false, headers: new Headers({ 'retry-after': '0' }) };
      const value = await request(path, options.method, options.body ? JSON.parse(options.body) : undefined);
      return { status: 200, ok: true, json: async () => value };
    });
    const actualAdapter = createNotionRequest({ token: 'test-only', fetchImpl });
    expect((await api.projectOnboardCustomer(db, actualAdapter, binding, customer)).status).toBe('unknown');
    expect((await api.projectOnboardCustomer(db, actualAdapter, binding, customer)).status).toBe('unknown');
    expect(fetchImpl.mock.calls.filter(([url, options]) => new URL(url).pathname === '/v1/pages' && options.method === 'POST')).toHaveLength(1);
    expect((await db.query('SELECT count(*)::int n FROM crm_customer_page_attempts')).rows[0].n).toBe(1);
    expect((await store.getCustomer(db, tenant, customer.id)).projection_pending).toBe(true);
  });
  it('50个unknown不饿死第51个新好友，runCrmSync至少两轮公平轮转且不伪造业务进度', async () => {
    await mapping.reservePageAttempt(db, binding, customer);
    for (let n = 1; n <= 49; n++) {
      const result = await onboardContact(db, { tenant_id: tenant, binding_id: binding.id, account_id: 'self', contact_id: `unknown-${n}`, event_id: `unknown-event-${n}`, display_name: `未确认${n}`, authorized: true, scope: 'test', authorization_ref: 'approved-test-task', identity_evidence_sha256: 'a'.repeat(64), observed_at: '2026-10-16T01:00:00Z', friendship_status: 'confirmed' });
      await mapping.reservePageAttempt(db, binding, result.customer);
    }
    const last = (await onboardContact(db, { tenant_id: tenant, binding_id: binding.id, account_id: 'self', contact_id: 'processable-51', event_id: 'processable-event', display_name: '第51个可处理好友', authorized: true, scope: 'test', authorization_ref: 'approved-test-task', identity_evidence_sha256: 'a'.repeat(64), observed_at: '2026-10-16T01:00:00Z', friendship_status: 'confirmed' })).customer;
    vi.stubEnv('CRM_SYNC_ENABLED', 'true');
    const pool = { connect: async () => ({ query: db.query.bind(db), release() {} }) };
    const first = await runCrmSync(pool, binding.id, { request });
    expect(first.deferred).toBe(50); expect((await store.getCustomer(db, tenant, last.id)).source_page_id).toBeNull();
    const second = await runCrmSync(pool, binding.id, { request });
    expect(second.onboard_mapped).toBe(1); expect((await store.getCustomer(db, tenant, last.id)).source_page_id).toBeTruthy();
    expect(creates(request)).toHaveLength(1);
    const unknown = await store.getCustomer(db, tenant, customer.id);
    expect(unknown).toMatchObject({ revision: 1, projection_pending: true, source_page_id: null, manual_fields: {} });
    expect((await db.query('SELECT count(*)::int n FROM crm_customer_page_attempts')).rows[0].n).toBe(51);
  });
});
