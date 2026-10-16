import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import * as store from '../../crm/store.js';
import { crmPgTestConfig, createCrmPgFixture } from '../helpers/crm-pg-fixture.js';

const enabled = crmPgTestConfig().enabled;
const tenant = '20000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const source = '20000000-0000-4000-8000-000000000003';
const page = '20000000-0000-4000-8000-000000000004';
describe.skipIf(!enabled)('CRM store 真Postgres事务与关系约束（隔离测试库）', () => {
  let db, binding, customer, fixture;
  beforeAll(async () => {
    fixture = await createCrmPgFixture(); db = fixture.db;
  });
  afterAll(async () => {
    if (fixture) await fixture.close();
  });
  it('绑定默认关闭，datasource不能跨租户重绑', async () => {
    binding = await store.configureBinding(db, { tenant_id: tenant, data_source_id: source });
    expect(binding.enabled).toBe(false);
    await expect(store.configureBinding(db, { tenant_id: other, data_source_id: source })).rejects.toMatchObject({ code: 'tenant_mismatch' });
    binding = await store.configureBinding(db, { tenant_id: tenant, data_source_id: source, enabled: true });
  });
  it('页面重放0新增、人工改动留痕、同昵称不同页面不合并', async () => {
    const input = { page_id: page, display_name: '张总', manual_fields: { note: '人工原备注' }, source_edited_at: '2026-10-16T01:00:00Z' };
    const first = await store.ingestCustomer(db, binding, input);
    customer = first.customer;
    expect(first.created).toBe(true);
    expect((await store.ingestCustomer(db, binding, input)).changed).toBe(false);
    const next = await store.ingestCustomer(db, binding, { ...input, manual_fields: { note: '人工新备注' }, source_edited_at: '2026-10-16T02:00:00Z' });
    expect(next.customer.manual_fields.note).toBe('人工新备注');
    const audit = await db.query('SELECT old_value,new_value FROM crm_audit WHERE customer_id=$1', [customer.id]);
    expect(audit.rows.some(r => r.old_value?.manual_fields?.note === '人工原备注' && r.new_value.manual_fields?.note === '人工新备注')).toBe(true);
    const second = await store.ingestCustomer(db, binding, { ...input, page_id: '20000000-0000-4000-8000-000000000005' });
    expect(second.customer.id).not.toBe(customer.id);
  });
  it('跨tenant读取隔离；稳定好友关联不可被静默重指', async () => {
    expect(await store.getCustomer(db, other, customer.id)).toBeNull();
    await store.registerAccount(db, tenant, { account_id: 'wx-self', agent_id: 'agent-a', persona: { name: '客服A' } });
    await store.registerAccount(db, tenant, { account_id: 'wx-self-2', agent_id: 'agent-b', persona: { name: '客服B' } });
    await expect(store.registerAccount(db, other, { account_id: 'wx-self' })).rejects.toMatchObject({ code: 'tenant_mismatch' });
    await store.linkContact(db, tenant, { account_id: 'wx-self', contact_id: 'wx-native-1', customer_id: customer.id });
    await expect(store.linkContact(db, other, { account_id: 'wx-self', contact_id: 'wx-native-1', customer_id: customer.id })).rejects.toThrow();
    const second = (await db.query('SELECT id FROM crm_customers WHERE id<>$1 LIMIT 1', [customer.id])).rows[0];
    await expect(store.linkContact(db, tenant, { account_id: 'wx-self', contact_id: 'wx-native-1', customer_id: second.id })).rejects.toMatchObject({ code: 'identity_conflict' });
  });
  it('消息按原生ID重放去重，冲突内容拒绝，报告只能引用同客户原文', async () => {
    const input = { account_id: 'wx-self', contact_id: 'wx-native-1', message_id: 'native-msg-1', direction: 'inbound', text: '预算5000', occurred_at: '2026-10-16T01:02:00Z', evidence: { uri: 'local-proof' } };
    const message = await store.ingestMessage(db, tenant, input);
    expect(message.created).toBe(true);
    expect((await store.ingestMessage(db, tenant, input)).created).toBe(false);
    await expect(store.ingestMessage(db, tenant, { ...input, text: '伪造覆盖' })).rejects.toMatchObject({ code: 'identity_conflict' });
    const report = await store.saveReport(db, tenant, { customer_id: customer.id, type: 'daily', period_start: '2026-10-16', period_end: '2026-10-16', markdown: '今天确认预算', message_ids: [message.message.id] });
    expect(report.customer_id).toBe(customer.id);
    const second = (await db.query('SELECT id FROM crm_customers WHERE id<>$1 LIMIT 1', [customer.id])).rows[0];
    await expect(store.saveReport(db, tenant, { customer_id: second.id, type: 'daily', period_start: '2026-10-16', period_end: '2026-10-16', markdown: '不能借别人的消息', message_ids: [message.message.id] })).rejects.toMatchObject({ code: 'identity_conflict' });
    expect((await db.query('SELECT count(*)::int n FROM crm_reports')).rows[0].n).toBe(1);
  });
  it('旧revision回执不能清除新画像待投影标记', async () => {
    const current = await store.getCustomer(db, tenant, customer.id);
    const next = await store.updateProfile(db, tenant, customer.id, { profile_markdown: '预算5000，待跟进', expected_revision: current.revision });
    expect(next.projection_pending).toBe(true);
    expect(next.manual_fields.note).toBe('人工新备注');
    expect(await store.markProjected(db, tenant, customer.id, current.revision)).toBe(false);
    await expect(store.updateProfile(db, tenant, customer.id, { profile_markdown: '旧写', expected_revision: current.revision })).rejects.toMatchObject({ code: 'stale_revision' });
    expect(await store.markProjected(db, tenant, customer.id, next.revision)).toBe(true);
  });
  it('数据库本身拒绝跨tenant外键，伪造binding对象也不能越界', async () => {
    await expect(db.query('INSERT INTO crm_contact_links(tenant_id,account_id,contact_id,customer_id) VALUES($1,$2,$3,$4)', [other, 'wx-self', 'forged-contact', customer.id])).rejects.toMatchObject({ code: '23503' });
    await expect(store.ingestCustomer(db, { ...binding, tenant_id: other }, { page_id: '20000000-0000-4000-8000-000000000099', display_name: '伪造', source_edited_at: '2026-10-16T03:00:00Z' })).rejects.toMatchObject({ code: 'not_found' });
    expect((await db.query('SELECT count(*)::int n FROM crm_customers WHERE tenant_id=$1', [other])).rows[0].n).toBe(0);
  });
  it('原文和报告映射保留原页面，其他tenant无读取和回执权限', async () => {
    const messages = await store.listCustomerMessages(db, tenant, customer.id);
    const reports = await store.listCustomerReports(db, tenant, customer.id);
    expect(reports[0].message_ids).toEqual([messages[0].id]);
    expect(await store.listCustomerMessages(db, other, customer.id)).toEqual([]);
    expect(await store.markMessageProjected(db, other, messages[0].id, source)).toBe(false);
    expect(await store.markMessageProjected(db, tenant, messages[0].id, source)).toBe(true);
    await expect(store.markMessageProjected(db, tenant, messages[0].id, page)).rejects.toMatchObject({ code: 'identity_conflict' });
    expect(await store.markReportProjected(db, tenant, reports[0].id, page)).toBe(true);
  });
  it('部分人工字段更新不清空未提交备注与外部ID，显式空值才清空', async () => {
    await store.ingestCustomer(db, binding, { page_id: page, display_name: '张总', external_customer_id: 'legacy-1', manual_fields: { budget: '5000' }, source_edited_at: '2026-10-16T04:00:00Z' });
    const next = await store.ingestCustomer(db, binding, { page_id: page, display_name: '张总', manual_fields: { budget: '8000' }, source_edited_at: '2026-10-16T05:00:00Z' });
    expect(next.customer.manual_fields).toEqual({ note: '人工新备注', budget: '8000' });
    expect(next.customer.external_customer_id).toBe('legacy-1');
    const cleared = await store.ingestCustomer(db, binding, { page_id: page, display_name: '张总', manual_fields: { note: '' }, external_customer_id: null, source_edited_at: '2026-10-16T06:00:00Z' });
    expect(cleared.customer.manual_fields).toEqual({ note: '', budget: '8000' });
    expect(cleared.customer.external_customer_id).toBeNull();
  });
  it('大写UUID不改变身份，原生消息ID按会话分域', async () => {
    const uppercaseTenant = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    const account = await store.registerAccount(db, uppercaseTenant, { account_id: 'wx-uppercase' });
    expect((await store.registerAccount(db, uppercaseTenant, { account_id: 'wx-uppercase' })).tenant_id).toBe(account.tenant_id);
    const second = (await db.query('SELECT id FROM crm_customers WHERE id<>$1 LIMIT 1', [customer.id])).rows[0];
    await store.linkContact(db, tenant, { account_id: 'wx-self', contact_id: 'wx-native-2', customer_id: second.id.toUpperCase() });
    const input = { account_id: 'wx-self', contact_id: 'wx-native-2', message_id: 'native-msg-1', direction: 'inbound', text: '另一个会话', occurred_at: '2026-10-16T01:02:00Z' };
    expect((await store.ingestMessage(db, tenant, input)).created).toBe(true);
    expect((await store.ingestMessage(db, tenant, input)).created).toBe(false);
    await expect(store.ingestMessage(db, tenant, { ...input, text: '冲突' })).rejects.toMatchObject({ code: 'identity_conflict' });
  });
  it('pending先按binding过滤再LIMIT，不能拿同tenant其他库的客户', async () => {
    const second = await store.configureBinding(db, { tenant_id: tenant, data_source_id: '20000000-0000-4000-8000-000000000070', enabled: true });
    const row = await store.ingestCustomer(db, second, { page_id: '20000000-0000-4000-8000-000000000071', display_name: '第二个库', source_edited_at: '2026-10-16T01:00:00Z' });
    const pending = await store.listPending(db, { tenant_id: tenant, binding_id: second.id, limit: 1 });
    expect(pending.map(item => item.customer.id)).toEqual([row.customer.id]);
    expect(await store.listPending(db, { tenant_id: other, binding_id: second.id, limit: 1 })).toEqual([]);
  });
  it('映射或allowed pages变化重置cursor，相同配置保留cursor', async () => {
    const fields = { display_name: '客户名称', allowed_page_ids: [page] };
    await store.configureBinding(db, { tenant_id: tenant, data_source_id: source, enabled: true, fields });
    await store.updateBindingCursor(db, binding.id, '2026-10-16T01:00:00Z');
    const same = await store.configureBinding(db, { tenant_id: tenant, data_source_id: source, enabled: true, fields });
    expect(same.cursor).toBe('2026-10-16T01:00:00Z');
    const before = await store.getCustomer(db, tenant, customer.id);
    await store.markProjected(db, tenant, customer.id, before.revision);
    const expanded = await store.configureBinding(db, { tenant_id: tenant, data_source_id: source, enabled: true, fields: { ...fields, allowed_page_ids: [...fields.allowed_page_ids, '20000000-0000-4000-8000-000000000072'] } });
    expect(expanded.cursor).toBeNull();
    const after = await store.getCustomer(db, tenant, customer.id);
    expect(after.projection_pending).toBe(true);
    expect(after.revision).toBe(before.revision + 1);
    expect(await store.markProjected(db, tenant, customer.id, before.revision)).toBe(false);
    await store.updateBindingCursor(db, binding.id, '2026-10-16T02:00:00Z');
    const remapped = await store.configureBinding(db, { tenant_id: tenant, data_source_id: source, enabled: true, fields: { ...fields, display_name: '新客户名称' } });
    expect(remapped.cursor).toBeNull();
  });
  it('初始未托管画像与显式清空画像区别保存', async () => {
    const current = await store.ingestCustomer(db, binding, { page_id: '20000000-0000-4000-8000-000000000080', display_name: '尚未生成画像', source_edited_at: '2026-10-16T01:00:00Z' });
    expect(current.customer.profile_managed).toBe(false);
    const clear = await store.updateProfile(db, tenant, current.customer.id, { profile_markdown: '', expected_revision: current.customer.revision });
    expect(clear.profile_managed).toBe(true);
    expect(clear.profile_markdown).toBe('');
    expect(clear.revision).toBe(current.customer.revision + 1);
  });
  it('Notion分钟精度时间相同的两次真实修改均可入账，重放幂等且更旧时间拒绝', async () => {
    const input = { page_id: '20000000-0000-4000-8000-000000000090', display_name: '分钟精度客户', manual_fields: { note: '原值' }, source_edited_at: '2026-10-16T03:00:00Z' };
    const first = await store.ingestCustomer(db, binding, input);
    const second = await store.ingestCustomer(db, binding, { ...input, manual_fields: { note: '同分钟修改' } });
    const restored = await store.ingestCustomer(db, binding, input);
    expect(second.customer.manual_fields.note).toBe('同分钟修改');
    expect(restored.customer.manual_fields.note).toBe('原值');
    expect(restored.customer.revision).toBe(first.customer.revision + 2);
    expect((await store.ingestCustomer(db, binding, input)).changed).toBe(false);
    const older = await store.ingestCustomer(db, binding, { ...input, manual_fields: { note: '较旧快照' }, source_edited_at: '2026-10-16T02:59:00Z' });
    expect(older.changed).toBe(false);
    expect(older.customer.manual_fields.note).toBe('原值');
    expect((await db.query('SELECT count(*)::int n FROM crm_audit WHERE customer_id=$1', [first.customer.id])).rows[0].n).toBe(3);
  });
  it('allowlist在LIMIT前过滤，50个未授权pending不能饿死第51个授权客户', async () => {
    const scope = await store.configureBinding(db, { tenant_id: tenant, data_source_id: '40000000-0000-4000-8000-000000000001', enabled: true });
    let allowed;
    for (let n = 1; n <= 51; n++) {
      const result = await store.ingestCustomer(db, scope, { page_id: `40000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`, display_name: `客户${n}`, source_edited_at: '2026-10-16T03:00:00Z' });
      if (n === 51) allowed = result.customer;
    }
    const rows = await store.listPending(db, { tenant_id: tenant, binding_id: scope.id, allowed_page_ids: [allowed.source_page_id], limit: 50 });
    expect(rows.map(row => row.customer.id)).toEqual([allowed.id]);
    expect(await store.listPending(db, { tenant_id: tenant, binding_id: scope.id, allowed_page_ids: [], limit: 50 })).toEqual([]);
    expect((await db.query('SELECT count(*)::int n FROM crm_customers WHERE binding_id=$1 AND projection_pending', [scope.id])).rows[0].n).toBe(51);
  });
});
