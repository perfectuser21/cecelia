import { fault, uuid, hash, one, transaction, activeBinding, identityLock } from './onboard-common.js';
import { fieldConfig, parseCustomerPage } from './notion-mapping.js';

export const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replaceAll('-', '').toLowerCase() === b.replaceAll('-', '').toLowerCase();
const plain = values => (values ?? []).map(value => value.plain_text ?? value.text?.content ?? '').join('');
export function pageBrainId(page, binding) {
  const field = binding.fields?.brain_id;
  if (!field || page.properties?.[field] === undefined) return null;
  const property = page.properties[field];
  if (property.type !== 'rich_text') throw fault('identity_conflict');
  const value = plain(property.rich_text);
  if (!value) return null;
  try { return uuid(value); } catch { throw fault('identity_conflict'); }
}
export function creationPayload(binding, customer) {
  const fields = fieldConfig(binding);
  if (typeof fields.brain_id !== 'string' || !fields.brain_id || fields.brain_id === fields.name) throw fault('invalid_schema');
  const text = content => [{ type: 'text', text: { content } }];
  return { parent: { type: 'data_source_id', data_source_id: binding.data_source_id }, properties: {
    [fields.name]: { title: text(customer.display_name) }, [fields.brain_id]: { rich_text: text(customer.id) },
  } };
}
export function validateOnboardPage(page, binding, customerId) {
  if (!page || !sameId(page.parent?.data_source_id, binding.data_source_id) || page.in_trash || page.archived || pageBrainId(page, binding) !== customerId) throw fault('identity_conflict');
  uuid(page.id);
  const allowed = binding.fields?.allowed_page_ids;
  if (allowed !== undefined && (!Array.isArray(allowed) || !allowed.some(id => sameId(id, page.id)))) throw fault('blocked_scope');
  return parseCustomerPage(page, binding);
}
function configSnapshot(binding) {
  return { tenant_id: binding.tenant_id, binding_id: binding.id, data_source_id: binding.data_source_id,
    enabled: binding.enabled, config_revision: String(binding.config_revision), fields: binding.fields };
}
function verifyFrozen(binding, attempt) {
  if (attempt && (hash(configSnapshot(binding)) !== attempt.config_sha256 || String(binding.config_revision) !== String(attempt.config_revision))) throw fault('configuration_changed');
}
async function state(tx, binding, customerId) {
  const current = await activeBinding(tx, uuid(binding.tenant_id), uuid(binding.id));
  await identityLock(tx, current.tenant_id, uuid(customerId));
  const customer = await one(tx, 'SELECT * FROM crm_customers WHERE tenant_id=$1 AND binding_id=$2 AND id=$3 FOR UPDATE', [current.tenant_id, current.id, customerId]);
  if (!customer || customer.source_archived) throw fault('identity_conflict');
  const attempt = await one(tx, 'SELECT * FROM crm_customer_page_attempts WHERE tenant_id=$1 AND customer_id=$2', [current.tenant_id, customer.id]);
  const receipt = await one(tx, 'SELECT * FROM crm_friend_events WHERE tenant_id=$1 AND binding_id=$2 AND customer_id=$3 ORDER BY created_at,id LIMIT 1', [current.tenant_id, current.id, customer.id]);
  if (!customer.source_page_id && (customer.origin_kind !== 'wechat_friend' || !receipt)) throw fault('identity_conflict');
  if (!customer.source_page_id) verifyFrozen(current, attempt);
  return { binding: current, customer, attempt, receipt };
}
export const getOnboardPageState = (db, binding, customerId) => transaction(db, tx => state(tx, binding, customerId));

/** Independently committed before the one permitted create POST. No reset/retry API exists. */
export async function reservePageAttempt(db, binding, customer) {
  return transaction(db, async tx => {
    const current = await state(tx, binding, uuid(customer.id));
    if (current.customer.source_page_id) return { ...current, created: false };
    if (current.attempt) return { ...current, created: false };
    if (current.binding.fields?.allowed_page_ids !== undefined) throw fault('blocked_scope');
    const payload = creationPayload(current.binding, current.customer), config = configSnapshot(current.binding);
    const fields = fieldConfig(current.binding);
    const attempt = await one(tx, `INSERT INTO crm_customer_page_attempts(tenant_id,binding_id,customer_id,receipt_id,data_source_id,name_property,brain_id_property,frozen_config,config_sha256,config_revision,request_sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [current.binding.tenant_id, current.binding.id, current.customer.id, current.receipt.id, current.binding.data_source_id, fields.name, fields.brain_id, JSON.stringify(config), hash(config), current.binding.config_revision, hash(payload)]);
    return { ...current, attempt, payload, created: true };
  });
}

/** Pull and projector share this identity lock, compare-and-set, unique page constraint, and audit. */
export async function bindOnboardPage(db, binding, customerId, page) {
  try {
    return await transaction(db, async tx => {
      const current = await state(tx, binding, uuid(customerId));
      if (!current.attempt || current.customer.origin_kind !== 'wechat_friend' || !current.receipt) throw fault('identity_conflict');
      const parsed = validateOnboardPage(page, current.binding, current.customer.id);
      if (current.customer.source_page_id) {
        if (!sameId(current.customer.source_page_id, page.id)) throw fault('identity_conflict');
        return current.customer;
      }
      const manual = { ...current.customer.manual_fields, ...parsed.manual_fields };
      const customer = await one(tx, `UPDATE crm_customers SET source_page_id=$4,source_edited_at=$5,display_name=$6,manual_fields=$7,
        external_customer_id=$8,revision=revision+1,projection_pending=true,updated_at=now()
        WHERE tenant_id=$1 AND binding_id=$2 AND id=$3 AND source_page_id IS NULL RETURNING *`,
      [current.binding.tenant_id, current.binding.id, current.customer.id, uuid(page.id), parsed.source_edited_at, parsed.display_name, JSON.stringify(manual), parsed.external_customer_id === undefined ? current.customer.external_customer_id : parsed.external_customer_id]);
      if (!customer) throw fault('identity_conflict');
      await tx.query('UPDATE crm_customer_page_attempts SET confirmed_page_id=$2,confirmed_at=now() WHERE id=$1', [current.attempt.id, customer.source_page_id]);
      await tx.query('INSERT INTO crm_audit(tenant_id,customer_id,actor,action,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6)',
        [customer.tenant_id, customer.id, 'notion-projection', 'friend_page_bound', JSON.stringify({ source_page_id: null, display_name: current.customer.display_name, manual_fields: current.customer.manual_fields }), JSON.stringify({ source_page_id: customer.source_page_id, display_name: customer.display_name, manual_fields: customer.manual_fields })]);
      return customer;
    });
  } catch (error) { if (error.code === '23505') throw fault('identity_conflict'); throw error; }
}
