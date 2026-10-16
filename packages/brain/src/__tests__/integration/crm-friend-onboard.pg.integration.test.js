import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as store from '../../crm/store.js';
import { createCrmRouter } from '../../crm/router.js';
import { crmPgTestConfig, createCrmPgFixture } from '../helpers/crm-pg-fixture.js';
const api = await import('../../crm/onboard-store.js').catch(() => ({}));
const tenant = 'd1000000-0000-4000-8000-000000000001';
const other = 'd1000000-0000-4000-8000-000000000002';
const id = n => `d2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
describe.skipIf(!crmPgTestConfig().enabled)('Brain-first 好友入档真实PG与HTTP', () => {
  let fx, db, binding, input;
  beforeEach(async () => {
    fx = await createCrmPgFixture(); db = fx.db;
    binding = await store.configureBinding(db, { tenant_id: tenant, data_source_id: id(1), enabled: true, fields: { brain_id: 'Brain ID' } });
    await store.registerAccount(db, tenant, { account_id: 'self-a', agent_id: 'agent-a', persona: { name: '客服A' } });
    input = { tenant_id: tenant, binding_id: binding.id, account_id: 'self-a', contact_id: 'native-a', event_id: 'friend-001', display_name: '同名客户', authorized: true, scope: 'test', authorization_ref: 'task:11111111-1111-4111-8111-111111111111', identity_evidence_sha256: 'a'.repeat(64), observed_at: '2026-10-16T01:00:00Z', friendship_status: 'confirmed' };
  });
  afterEach(async () => { vi.unstubAllEnvs(); if (fx) await fx.close(); });
  it('无Notion页面也先事务创建canonical、关系、授权收据、审计与待投影', async () => {
    const result = await api.onboardContact(db, input);
    expect(result.created).toBe(true); expect(result.customer.source_page_id).toBeNull(); expect(result.customer.source_edited_at).toBeNull();
    expect(result.customer.origin_kind).toBe('wechat_friend'); expect(result.customer.projection_pending).toBe(true);
    expect(result.contact_link.customer_id).toBe(result.customer.id);
    expect((await db.query('SELECT count(*)::int n FROM crm_friend_events')).rows[0].n).toBe(1);
    expect((await db.query('SELECT count(*)::int n FROM crm_audit')).rows[0].n).toBe(1);
  });
  it('同事件重放0新增，同event不可变payload更换联系人时冲突', async () => {
    const first = await api.onboardContact(db, input);
    expect((await api.onboardContact(db, input)).customer.id).toBe(first.customer.id);
    await expect(api.onboardContact(db, { ...input, contact_id: 'another' })).rejects.toMatchObject({ code: 'identity_conflict' });
    expect((await db.query('SELECT count(*)::int n FROM crm_customers')).rows[0].n).toBe(1);
    expect((await db.query('SELECT count(*)::int n FROM crm_friend_events')).rows[0].n).toBe(1);
  });
  it('跨账号相同event合法，同昵称不合并；新event昵称不能覆盖已有资料', async () => {
    const first = await api.onboardContact(db, input);
    await db.query('UPDATE crm_customers SET display_name=$2,manual_fields=$3,profile_markdown=$4 WHERE id=$1', [first.customer.id, '人工名字', { note: '人工备注' }, '已确认画像']);
    const repeat = await api.onboardContact(db, { ...input, event_id: 'friend-002', display_name: '新观测昵称' });
    expect(repeat.customer).toMatchObject({ id: first.customer.id, display_name: '人工名字', manual_fields: { note: '人工备注' }, profile_markdown: '已确认画像' });
    await store.registerAccount(db, tenant, { account_id: 'self-b', agent_id: 'agent-b' });
    const second = await api.onboardContact(db, { ...input, account_id: 'self-b' });
    expect(second.customer.id).not.toBe(first.customer.id);
    expect((await db.query('SELECT count(*)::int n FROM crm_friend_events')).rows[0].n).toBe(3);
  });
  it('已有关系换binding、客户归档、停用绑定均失败且不新增', async () => {
    const first = await api.onboardContact(db, input);
    const second = await store.configureBinding(db, { tenant_id: tenant, data_source_id: id(2), enabled: true });
    await expect(api.onboardContact(db, { ...input, event_id: 'other-binding', binding_id: second.id })).rejects.toMatchObject({ code: 'identity_conflict' });
    await db.query('UPDATE crm_customers SET source_archived=true WHERE id=$1', [first.customer.id]);
    await expect(api.onboardContact(db, { ...input, event_id: 'archived' })).rejects.toMatchObject({ code: 'identity_conflict' });
    await db.query('UPDATE crm_customers SET source_archived=false WHERE id=$1', [first.customer.id]);
    await store.configureBinding(db, { tenant_id: tenant, data_source_id: id(1), enabled: false });
    await expect(api.onboardContact(db, { ...input, event_id: 'disabled' })).rejects.toMatchObject({ code: 'binding_disabled' });
    expect((await db.query('SELECT count(*)::int n FROM crm_friend_events')).rows[0].n).toBe(1);
  });
  it('未登记账号、跨租户、无授权、缺证据和生产scope均拒绝', async () => {
    for (const change of [{ account_id: 'missing' }, { tenant_id: other }, { authorized: false }, { scope: 'production' }, { identity_evidence_sha256: '' }, { nickname: '不允许匹配' }]) {
      await expect(api.onboardContact(db, { ...input, ...change })).rejects.toThrow();
    }
    expect((await db.query('SELECT count(*)::int n FROM crm_customers')).rows[0].n).toBe(0);
  });
  it('两连接两个事件并发同联系人，仅一个客户且两收据；同事件并发幂等', async () => {
    const a = await fx.connect(), b = await fx.connect();
    const results = await Promise.all([api.onboardContact(a, input), api.onboardContact(b, { ...input, event_id: 'friend-concurrent' })]);
    expect(results[0].customer.id).toBe(results[1].customer.id);
    await Promise.all([api.onboardContact(a, { ...input, event_id: 'same-event' }), api.onboardContact(b, { ...input, event_id: 'same-event' })]);
    expect((await db.query('SELECT count(*)::int n FROM crm_customers')).rows[0].n).toBe(1);
    expect((await db.query('SELECT count(*)::int n FROM crm_friend_events')).rows[0].n).toBe(3);
  });
  it('HTTP内部鉴权与默认关闭保持，授权test入档201，重放200', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'onboard-test'); vi.stubEnv('CRM_SYNC_ENABLED', 'true');
    const app = express(); app.use(express.json()); app.use('/crm', createCrmRouter({ pool: db }));
    expect((await request(app).post('/crm/contacts/onboard').send(input)).status).toBe(401);
    const call = () => request(app).post('/crm/contacts/onboard').set('Authorization', 'Bearer onboard-test').send(input);
    expect((await call()).status).toBe(201); expect((await call()).status).toBe(200);
    vi.stubEnv('CRM_SYNC_ENABLED', 'false'); expect((await call()).status).toBe(503);
  });
});
