import { isDeepStrictEqual } from 'node:util';
import { validateCrmMarkdown } from './markdown.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function error(code, message = code) { return Object.assign(new Error(message), { code }); }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) throw error('invalid_input', '需要有效UUID'); return value.toLowerCase(); }
function text(value, max = 100000) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw error('invalid_input', '缺少稳定ID或文字无效'); return value; }
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('invalid_input', '需要JSON对象'); return value; }
function date(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw error('invalid_input', '无效时间'); return new Date(value).toISOString(); }
function integer(value) { if (!Number.isSafeInteger(value) || value < 1) throw error('invalid_input', '需要正整数版本'); return value; }
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] ?? null;

async function transaction(db, fn) {
  // pg Client 已有 connect 方法，但没有 pool.totalCount；不能重新 connect Client。
  const client = typeof db.totalCount === 'number' && typeof db.connect === 'function' ? await db.connect() : db;
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { if (client !== db) client.release(); }
}

export async function configureBinding(db, { tenant_id, data_source_id, enabled = false, fields = {} }) {
  const tenant = uuid(tenant_id), source = uuid(data_source_id); object(fields);
  if (typeof enabled !== 'boolean') throw error('invalid_input');
  return transaction(db, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm-binding:${source}`]);
    const previous = await one(tx, 'SELECT * FROM crm_sync_bindings WHERE data_source_id=$1 FOR UPDATE', [source]);
    if (previous && previous.tenant_id !== tenant) throw error('tenant_mismatch');
    const changed = previous && !isDeepStrictEqual(previous.fields, fields);
    const cursor = previous && !changed ? previous.cursor : null;
    if (changed) await tx.query('UPDATE crm_customers SET projection_pending=true,revision=revision+1,updated_at=now() WHERE binding_id=$1 AND tenant_id=$2', [previous.id, tenant]);
    return one(tx, `INSERT INTO crm_sync_bindings(tenant_id,data_source_id,enabled,fields,cursor) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(data_source_id) DO UPDATE SET enabled=EXCLUDED.enabled,fields=EXCLUDED.fields,cursor=EXCLUDED.cursor,
      config_revision=crm_sync_bindings.config_revision+CASE WHEN crm_sync_bindings.enabled IS DISTINCT FROM EXCLUDED.enabled OR crm_sync_bindings.fields IS DISTINCT FROM EXCLUDED.fields THEN 1 ELSE 0 END,
      updated_at=now() RETURNING *`, [tenant, source, enabled, JSON.stringify(fields), cursor]);
  });
}

export async function listBindings(db) { return (await db.query('SELECT * FROM crm_sync_bindings ORDER BY created_at,id')).rows; }
export async function updateBindingCursor(db, bindingId, cursor) {
  uuid(bindingId); if (cursor !== null) text(cursor, 2000);
  return one(db, 'UPDATE crm_sync_bindings SET cursor=$2,updated_at=now() WHERE id=$1 RETURNING *', [bindingId, cursor]);
}
export async function getCustomer(db, tenant, id) {
  return one(db, 'SELECT * FROM crm_customers WHERE tenant_id=$1 AND id=$2', [uuid(tenant), uuid(id)]);
}
async function audit(db, customer, action, actor, previous, next) {
  await db.query('INSERT INTO crm_audit(tenant_id,customer_id,action,actor,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6)',
    [customer.tenant_id, customer.id, action, actor, previous ? JSON.stringify(previous) : null, JSON.stringify(next)]);
}

export async function ingestCustomer(db, binding, input) {
  const bindingId = uuid(binding?.id), tenant = uuid(binding?.tenant_id), page = uuid(input.page_id);
  const name = text(input.display_name, 2000), manualPatch = object(input.manual_fields ?? {}), edited = date(input.source_edited_at);
  const archived = input.source_archived ?? false;
  if (typeof archived !== 'boolean') throw error('invalid_input');
  if (input.external_customer_id !== null && input.external_customer_id !== undefined) text(input.external_customer_id, 2000);
  return transaction(db, async tx => {
    const registered = await one(tx, 'SELECT * FROM crm_sync_bindings WHERE id=$1 AND tenant_id=$2 FOR SHARE', [bindingId, tenant]);
    if (!registered) throw error('not_found', '绑定不存在');
    if (!registered.enabled) throw error('binding_disabled');
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm-page:${page}`]);
    const previous = await one(tx, 'SELECT * FROM crm_customers WHERE source_page_id=$1 FOR UPDATE', [page]);
    if (previous && (previous.tenant_id !== tenant || previous.binding_id !== bindingId)) throw error('tenant_mismatch');
    if (previous && new Date(previous.source_edited_at).getTime() > Date.parse(edited)) return { customer: previous, created: false, changed: false };
    const manual = { ...(previous?.manual_fields ?? {}), ...manualPatch };
    const external = input.external_customer_id === undefined ? previous?.external_customer_id ?? null : input.external_customer_id;
    const next = { display_name: name, manual_fields: manual, external_customer_id: external, source_archived: archived };
    const old = previous && Object.fromEntries(Object.keys(next).map(key => [key, previous[key]]));
    if (previous && isDeepStrictEqual(old, next)) {
      await tx.query('UPDATE crm_customers SET source_edited_at=$2 WHERE id=$1', [previous.id, edited]);
      return { customer: { ...previous, source_edited_at: new Date(edited) }, created: false, changed: false };
    }
    // Notion may round last_edited_time to the minute. The binding sync lock and
    // fresh API read determine observation order; equal timestamps are not CAS tokens.
    // Content equality above handles replay, and strictly older snapshots remain rejected.
    const customer = previous
      ? await one(tx, `UPDATE crm_customers SET display_name=$2,manual_fields=$3,external_customer_id=$4,source_archived=$5,
          source_edited_at=$6,revision=revision+1,projection_pending=true,updated_at=now() WHERE id=$1 RETURNING *`, [previous.id, name, JSON.stringify(manual), external, archived, edited])
      : await one(tx, `INSERT INTO crm_customers(tenant_id,binding_id,source_page_id,display_name,manual_fields,external_customer_id,source_archived,source_edited_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [tenant, bindingId, page, name, JSON.stringify(manual), external, archived, edited]);
    await audit(tx, customer, previous ? 'manual_update' : 'created', 'notion-human-inlet', old, next);
    return { customer, created: !previous, changed: true };
  });
}

export async function registerAccount(db, tenant, { account_id, agent_id = null, persona = {} }) {
  tenant = uuid(tenant); text(account_id, 500); object(persona); if (agent_id !== null) text(agent_id, 500);
  return transaction(db, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm-account:${account_id}`]);
    const previous = await one(tx, 'SELECT * FROM crm_wechat_accounts WHERE account_id=$1 FOR UPDATE', [account_id]);
    if (previous && previous.tenant_id !== tenant) throw error('tenant_mismatch');
    return one(tx, `INSERT INTO crm_wechat_accounts(tenant_id,account_id,agent_id,persona) VALUES($1,$2,$3,$4)
      ON CONFLICT(tenant_id,account_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,persona=EXCLUDED.persona,updated_at=now() RETURNING *`, [tenant, account_id, agent_id, JSON.stringify(persona)]);
  });
}
export async function linkContact(db, tenant, { account_id, contact_id, customer_id }) {
  tenant = uuid(tenant); customer_id = uuid(customer_id); text(account_id, 500); text(contact_id, 500);
  return transaction(db, async tx => {
    if (!await getCustomer(tx, tenant, customer_id)) throw error('not_found');
    if (!await one(tx, 'SELECT account_id FROM crm_wechat_accounts WHERE tenant_id=$1 AND account_id=$2', [tenant, account_id])) throw error('not_found');
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm-contact:${tenant}:${account_id}:${contact_id}`]);
    const previous = await one(tx, 'SELECT * FROM crm_contact_links WHERE tenant_id=$1 AND account_id=$2 AND contact_id=$3', [tenant, account_id, contact_id]);
    if (previous && previous.customer_id !== customer_id) throw error('identity_conflict');
    return previous ?? one(tx, 'INSERT INTO crm_contact_links(tenant_id,account_id,contact_id,customer_id) VALUES($1,$2,$3,$4) RETURNING *', [tenant, account_id, contact_id, customer_id]);
  });
}

export async function ingestMessage(db, tenant, input) {
  tenant = uuid(tenant); const { account_id, contact_id, message_id, direction } = input;
  for (const value of [account_id, contact_id, message_id]) text(value, 2000);
  text(input.text); const occurred = date(input.occurred_at), precision = input.time_precision ?? 'exact', evidence = object(input.evidence ?? {});
  if (!['inbound', 'outbound'].includes(direction) || !['exact', 'minute', 'day', 'unknown'].includes(precision)) throw error('invalid_input');
  return transaction(db, async tx => {
    const link = await one(tx, 'SELECT * FROM crm_contact_links WHERE tenant_id=$1 AND account_id=$2 AND contact_id=$3', [tenant, account_id, contact_id]);
    if (!link) throw error('not_found', '未登记联系人关系');
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm-msg:${tenant}:${account_id}:${link.id}:${message_id}`]);
    const previous = await one(tx, 'SELECT * FROM crm_messages WHERE tenant_id=$1 AND account_id=$2 AND contact_link_id=$3 AND message_id=$4', [tenant, account_id, link.id, message_id]);
    if (previous) {
      if (previous.contact_link_id !== link.id || previous.text !== input.text || previous.direction !== direction || new Date(previous.occurred_at).toISOString() !== occurred || previous.time_precision !== precision || !isDeepStrictEqual(previous.evidence, evidence)) throw error('identity_conflict', '原生消息ID内容冲突');
      return { message: previous, created: false };
    }
    const message = await one(tx, `INSERT INTO crm_messages(tenant_id,customer_id,contact_link_id,account_id,message_id,direction,text,occurred_at,time_precision,evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [tenant, link.customer_id, link.id, account_id, message_id, direction, input.text, occurred, precision, JSON.stringify(evidence)]);
    await tx.query('UPDATE crm_customers SET revision=revision+1,projection_pending=true,updated_at=now() WHERE tenant_id=$1 AND id=$2', [tenant, link.customer_id]);
    return { message, created: true };
  });
}

export async function saveReport(db, tenant, input) {
  validateCrmMarkdown(input.markdown);
  tenant = uuid(tenant); const customerId = uuid(input.customer_id), version = integer(input.version ?? 1);
  if (!['daily', 'weekly', 'monthly'].includes(input.type)) throw error('invalid_input');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.period_start) || !/^\d{4}-\d{2}-\d{2}$/.test(input.period_end) || date(input.period_start) > date(input.period_end)) throw error('invalid_input');
  text(input.markdown); const ids = [...new Set(input.message_ids ?? [])].map(uuid).sort();
  return transaction(db, async tx => {
    if (!await getCustomer(tx, tenant, customerId)) throw error('not_found');
    const messages = await tx.query('SELECT id FROM crm_messages WHERE tenant_id=$1 AND customer_id=$2 AND id=ANY($3::uuid[])', [tenant, customerId, ids]);
    if (messages.rows.length !== ids.length) throw error('identity_conflict', '报告引用非本客户消息');
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm-report:${tenant}:${customerId}:${input.type}:${input.period_start}:${input.period_end}:${version}`]);
    const previous = await one(tx, 'SELECT * FROM crm_reports WHERE tenant_id=$1 AND customer_id=$2 AND type=$3 AND period_start=$4 AND period_end=$5 AND version=$6', [tenant, customerId, input.type, input.period_start, input.period_end, version]);
    if (previous) {
      const refs = (await tx.query('SELECT message_id FROM crm_report_messages WHERE report_id=$1 ORDER BY message_id', [previous.id])).rows.map(r => r.message_id);
      if (previous.markdown !== input.markdown || !isDeepStrictEqual(refs, ids)) throw error('identity_conflict', '报告版本不可覆盖');
      return previous;
    }
    const report = await one(tx, 'INSERT INTO crm_reports(tenant_id,customer_id,type,period_start,period_end,version,markdown) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [tenant, customerId, input.type, input.period_start, input.period_end, version, input.markdown]);
    for (const messageId of ids) await tx.query('INSERT INTO crm_report_messages(report_id,message_id,tenant_id,customer_id) VALUES($1,$2,$3,$4)', [report.id, messageId, tenant, customerId]);
    await tx.query('UPDATE crm_customers SET revision=revision+1,projection_pending=true,updated_at=now() WHERE tenant_id=$1 AND id=$2', [tenant, customerId]);
    return report;
  });
}

export async function updateProfile(db, tenant, id, { profile_markdown, expected_revision }) {
  validateCrmMarkdown(profile_markdown);
  tenant = uuid(tenant); id = uuid(id); integer(expected_revision); if (typeof profile_markdown !== 'string' || profile_markdown.length > 100000) throw error('invalid_input');
  return transaction(db, async tx => {
    const previous = await one(tx, 'SELECT * FROM crm_customers WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant, id]);
    if (!previous) throw error('not_found');
    if (previous.revision !== expected_revision) throw error('stale_revision');
    if (previous.profile_managed && previous.profile_markdown === profile_markdown) return previous;
    const customer = await one(tx, 'UPDATE crm_customers SET profile_markdown=$3,profile_managed=true,revision=revision+1,projection_pending=true,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *', [tenant, id, profile_markdown]);
    await audit(tx, customer, 'profile_update', 'ai-profile', { profile_markdown: previous.profile_markdown, profile_managed: previous.profile_managed }, { profile_markdown, profile_managed: true });
    return customer;
  });
}
export async function listPending(db, { tenant_id, binding_id, allowed_page_ids, limit = 50 } = {}) {
  if (tenant_id !== undefined) tenant_id = uuid(tenant_id);
  if (binding_id !== undefined) binding_id = uuid(binding_id);
  if (allowed_page_ids !== undefined) {
    if (!Array.isArray(allowed_page_ids)) throw error('invalid_input');
    allowed_page_ids = allowed_page_ids.map(uuid);
  }
  integer(limit); if (limit > 500) throw error('invalid_input');
  return (await db.query(`SELECT to_jsonb(c) AS customer,to_jsonb(b) AS binding FROM crm_customers c
    JOIN crm_sync_bindings b ON b.id=c.binding_id AND b.tenant_id=c.tenant_id
    WHERE c.projection_pending AND b.enabled AND ($1::uuid IS NULL OR c.tenant_id=$1)
    AND ($2::uuid IS NULL OR b.id=$2) AND ($3::text[] IS NULL OR c.source_page_id=ANY($3::text[]))
    ORDER BY c.updated_at,c.id LIMIT $4`, [tenant_id ?? null, binding_id ?? null, allowed_page_ids ?? null, limit])).rows;
}
export async function markProjected(db, tenant, id, revision) {
  tenant = uuid(tenant); id = uuid(id); integer(revision);
  return Boolean(await one(db, 'UPDATE crm_customers SET projection_pending=false WHERE tenant_id=$1 AND id=$2 AND revision=$3 RETURNING id', [tenant, id, revision]));
}
export async function listCustomerMessages(db, tenant, customerId) {
  return (await db.query('SELECT * FROM crm_messages WHERE tenant_id=$1 AND customer_id=$2 ORDER BY occurred_at,id', [uuid(tenant), uuid(customerId)])).rows;
}
export async function listCustomerReports(db, tenant, customerId) {
  return (await db.query(`SELECT r.*,COALESCE((SELECT jsonb_agg(rm.message_id ORDER BY rm.message_id) FROM crm_report_messages rm WHERE rm.report_id=r.id),'[]'::jsonb) AS message_ids
    FROM crm_reports r WHERE r.tenant_id=$1 AND r.customer_id=$2 ORDER BY r.period_start,r.version,r.id`, [uuid(tenant), uuid(customerId)])).rows;
}
async function markChildProjected(db, table, tenant, id, pageId) {
  tenant = uuid(tenant); id = uuid(id); pageId = uuid(pageId);
  return transaction(db, async tx => {
    const row = await one(tx, `SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenant, id]);
    if (!row) return false;
    if (row.notion_page_id && row.notion_page_id !== pageId) throw error('identity_conflict', '外部页面映射冲突');
    return Boolean(await one(tx, `UPDATE ${table} SET notion_page_id=$3,projection_pending=false WHERE tenant_id=$1 AND id=$2 RETURNING id`, [tenant, id, pageId]));
  });
}
export const markMessageProjected = (db, tenant, id, pageId) => markChildProjected(db, 'crm_messages', tenant, id, pageId);
export const markReportProjected = (db, tenant, id, pageId) => markChildProjected(db, 'crm_reports', tenant, id, pageId);
