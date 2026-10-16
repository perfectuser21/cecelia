import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCrmRouter } from './router.js';
const api = await import('./contact-resolve.js').catch(() => ({}));
const tenant = 'A0000000-0000-4000-8000-000000000001';
const scope = { tenant_id: tenant, account_id: 'wx-self', contact_id: 'wx-native-contact' };
afterEach(() => vi.unstubAllEnvs());
function fixture(rows = []) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) }, app = express();
  app.use(express.json()); app.use('/crm', createCrmRouter({ pool: db })); return { db, app };
}
describe('CRM稳定联系人只读解析', () => {
  it('精确三键限定，规范UUID但不按昵称猜测，数据库只执行SELECT', async () => {
    const expected = { customer: { id: 'customer' }, contact_link: { contact_id: scope.contact_id }, account: { agent_id: 'agent-a', persona: { name: '人设A' } } };
    const { db } = fixture([expected]);
    expect(await api.resolveContact(db, scope)).toEqual(expected);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/^\s*SELECT/);
    expect(db.query.mock.calls[0][1]).toEqual([tenant.toLowerCase(), scope.account_id, scope.contact_id]);
  });
  it.each([
    {}, { ...scope, tenant_id: 'not-a-uuid' }, { ...scope, contact_id: '' },
    { ...scope, nickname: '张总' }, { ...scope, account_id: ' wx-self' },
  ])('缺失稳定身份或额外昵称参数拒绝，零查询 %j', async value => {
    const { db } = fixture();
    await expect(api.resolveContact(db, value)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(db.query).not.toHaveBeenCalled();
  });
  it('未知联系人返回null，不扩大查询范围', async () => {
    const { db } = fixture(); expect(await api.resolveContact(db, scope)).toBeNull(); expect(db.query).toHaveBeenCalledTimes(1);
  });
});
describe('CRM联系人解析HTTP鉴权与失败关闭', () => {
  it('缺失或错误token不能读取，localhost不绕过已配置token', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'test-internal'); vi.stubEnv('CRM_SYNC_ENABLED', 'true');
    const { app, db } = fixture();
    for (const token of [null, 'wrong']) {
      const call = request(app).post('/crm/contacts/resolve').send(scope);
      if (token) call.set('Authorization', `Bearer ${token}`);
      expect((await call).status).toBe(401);
    }
    expect(db.query).not.toHaveBeenCalled();
  });
  it('全局关闭返回503并且零查询', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'test-internal'); vi.stubEnv('CRM_SYNC_ENABLED', 'false');
    const { app, db } = fixture();
    expect((await request(app).post('/crm/contacts/resolve').set('Authorization', 'Bearer test-internal').send(scope)).status).toBe(503);
    expect(db.query).not.toHaveBeenCalled();
  });
  it('授权请求返回精确映射，未知/跨tenant同为不泄露身份的404', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'test-internal'); vi.stubEnv('CRM_SYNC_ENABLED', 'true');
    const expected = { customer: { id: 'c1' }, contact_link: { contact_id: scope.contact_id }, account: { agent_id: 'a1', persona: {} } };
    const { app, db } = fixture([expected]);
    const call = body => request(app).post('/crm/contacts/resolve').set('Authorization', 'Bearer test-internal').send(body);
    const good = await call(scope); expect(good.status).toBe(200); expect(good.body).toEqual(expected);
    db.query.mockResolvedValue({ rows: [] });
    const unknown = await call({ ...scope, contact_id: 'missing' });
    const other = await call({ ...scope, tenant_id: 'b0000000-0000-4000-8000-000000000001' });
    expect(unknown.status).toBe(404); expect(other.status).toBe(404); expect(unknown.body).toEqual({ error: 'not_found' }); expect(other.body).toEqual(unknown.body);
  });
  it('缺参返回既有invalid_input409且零查询', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'test-internal'); vi.stubEnv('CRM_SYNC_ENABLED', 'true');
    const { app, db } = fixture();
    const response = await request(app).post('/crm/contacts/resolve').set('Authorization', 'Bearer test-internal').send({ tenant_id: tenant, account_id: 'wx-self' });
    expect(response.status).toBe(409); expect(response.body).toEqual({ error: 'invalid_input' }); expect(db.query).not.toHaveBeenCalled();
  });
});
