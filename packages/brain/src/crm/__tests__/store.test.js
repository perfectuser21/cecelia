import { describe, it, expect, vi } from 'vitest';
import * as store from '../store.js';

const tenant = '10000000-0000-4000-8000-000000000001';
const id = '10000000-0000-4000-8000-000000000002';
describe('CRM store 输入与身份边界', () => {
  it('拒绝缺租户的绑定，零数据库写入', async () => {
    const db = { query: vi.fn() };
    await expect(store.configureBinding(db, { data_source_id: id })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(db.query).not.toHaveBeenCalled();
  });
  it('非法消息方向在查询前拒绝', async () => {
    const db = { query: vi.fn() };
    await expect(store.ingestMessage(db, tenant, { account_id: 'wx-self', contact_id: 'wx-contact', message_id: 'm1', direction: 'system', text: 'hello', occurred_at: new Date().toISOString() })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(db.query).not.toHaveBeenCalled();
  });
  it('缺稳定联系人ID时不能用昵称代替', async () => {
    const db = { query: vi.fn() };
    await expect(store.linkContact(db, tenant, { account_id: 'wx-self', customer_id: id, nickname: '张总' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(db.query).not.toHaveBeenCalled();
  });
  it('读取始终同时限定tenant和customer UUID', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    expect(await store.getCustomer(db, tenant, id)).toBeNull();
    expect(db.query.mock.calls[0][0]).toMatch(/tenant_id\s*=\s*\$1[\s\S]*id\s*=\s*\$2/);
    expect(db.query.mock.calls[0][1]).toEqual([tenant, id]);
  });
  it('无版本的画像更新被拒绝，避免覆盖并发修改', async () => {
    const db = { query: vi.fn() };
    await expect(store.updateProfile(db, tenant, id, { profile_markdown: '画像' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(db.query).not.toHaveBeenCalled();
  });
});
