import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as store from '../../crm/store.js';
import { createCrmRouter } from '../../crm/router.js';
import { crmPgTestConfig, createCrmPgFixture } from '../helpers/crm-pg-fixture.js';
const api = await import('../../crm/contact-resolve.js');
const tenant = 'b1000000-0000-4000-8000-000000000001', other = 'b2000000-0000-4000-8000-000000000001';
const id = n => `b3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
describe.skipIf(!crmPgTestConfig().enabled)('CRM联系人解析真实Postgres隔离与HTTP', () => {
  let db, binding, customer, app, fixture;
  beforeAll(async () => {
    fixture = await createCrmPgFixture(); db = fixture.db;
    binding = await store.configureBinding(db, { tenant_id: tenant, data_source_id: id(1), enabled: true });
    customer = (await store.ingestCustomer(db, binding, { page_id: id(2), display_name: '同名客户', source_edited_at: '2026-10-16T01:00:00Z' })).customer;
    const second = (await store.ingestCustomer(db, binding, { page_id: id(3), display_name: '同名客户', source_edited_at: '2026-10-16T01:00:00Z' })).customer;
    await store.registerAccount(db, tenant, { account_id: 'self-a', agent_id: 'agent-a', persona: { name: '客服A' } });
    await store.registerAccount(db, tenant, { account_id: 'self-b', agent_id: 'agent-b', persona: { name: '客服B' } });
    await store.registerAccount(db, other, { account_id: 'other-account', agent_id: 'other-agent', persona: { name: '另一个企业' } });
    await store.linkContact(db, tenant, { account_id: 'self-a', contact_id: 'native-contact', customer_id: customer.id });
    await store.linkContact(db, tenant, { account_id: 'self-b', contact_id: 'native-contact', customer_id: second.id });
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'resolve-test'); vi.stubEnv('CRM_SYNC_ENABLED', 'true');
    app = express(); app.use(express.json()); app.use('/crm', createCrmRouter({ pool: db }));
  });
  afterAll(async () => {
    vi.unstubAllEnvs(); if (fixture) await fixture.close();
  });
  it('同tenant两号同原生联系人ID按精确账号返回各自客户和人设，零修改', async () => {
    const before = (await db.query('SELECT count(*)::int AS n FROM crm_audit')).rows[0].n;
    const a = await api.resolveContact(db, { tenant_id: tenant.toUpperCase(), account_id: 'self-a', contact_id: 'native-contact' });
    const b = await api.resolveContact(db, { tenant_id: tenant, account_id: 'self-b', contact_id: 'native-contact' });
    expect(a.customer.id).toBe(customer.id); expect(b.customer.id).not.toBe(a.customer.id);
    expect(a.account).toMatchObject({ account_id: 'self-a', agent_id: 'agent-a', persona: { name: '客服A' } });
    expect(b.account).toMatchObject({ account_id: 'self-b', agent_id: 'agent-b', persona: { name: '客服B' } });
    expect(a.contact_link.customer_id).toBe(customer.id);
    expect((await db.query('SELECT count(*)::int AS n FROM crm_audit')).rows[0].n).toBe(before);
  });
  it('跨tenant、未知账号/联系人和仅有同昵称全都不命中', async () => {
    for (const scope of [
      { tenant_id: other, account_id: 'self-a', contact_id: 'native-contact' },
      { tenant_id: tenant, account_id: 'other-account', contact_id: 'native-contact' },
      { tenant_id: tenant, account_id: 'missing-account', contact_id: 'native-contact' },
      { tenant_id: tenant, account_id: 'self-a', contact_id: '同名客户' },
    ]) expect(await api.resolveContact(db, scope)).toBeNull();
  });
  it('客户归档及停用binding均不可解析且HTTP统一404', async () => {
    const body = { tenant_id: tenant, account_id: 'self-a', contact_id: 'native-contact' };
    const call = () => request(app).post('/crm/contacts/resolve').set('Authorization', 'Bearer resolve-test').send(body);
    expect((await call()).status).toBe(200);
    await db.query('UPDATE crm_customers SET source_archived=true WHERE id=$1', [customer.id]);
    expect(await api.resolveContact(db, body)).toBeNull(); expect((await call()).body).toEqual({ error: 'not_found' });
    await db.query('UPDATE crm_customers SET source_archived=false WHERE id=$1', [customer.id]);
    await store.configureBinding(db, { tenant_id: tenant, data_source_id: id(1), enabled: false });
    expect(await api.resolveContact(db, body)).toBeNull(); expect((await call()).status).toBe(404);
    await store.configureBinding(db, { tenant_id: tenant, data_source_id: id(1), enabled: true });
  });
  it('真PG HTTP缺凭据401，跨tenant不泄露，正确关系200', async () => {
    const call = (body, token = 'resolve-test') => request(app).post('/crm/contacts/resolve').set('Authorization', `Bearer ${token}`).send(body);
    const body = { tenant_id: tenant, account_id: 'self-a', contact_id: 'native-contact' };
    expect((await call(body, 'wrong')).status).toBe(401);
    const otherResponse = await call({ ...body, tenant_id: other }); expect(otherResponse.status).toBe(404); expect(otherResponse.body).toEqual({ error: 'not_found' });
    const response = await call(body); expect(response.status).toBe(200); expect(response.body.customer.id).toBe(customer.id); expect(response.body.account.agent_id).toBe('agent-a');
  });
});
