/** Resolve only an explicitly registered Tenant/account/contact relationship; never create it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid() { throw Object.assign(new Error('CRM contact scope is invalid'), { code: 'invalid_input' }); }
function stableId(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || value.trim() !== value) invalid();
  return value;
}

export async function resolveContact(db, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['tenant_id', 'account_id', 'contact_id'].includes(key))) invalid();
  if (typeof input.tenant_id !== 'string' || !UUID.test(input.tenant_id)) invalid();
  const tenant = input.tenant_id.toLowerCase();
  const account = stableId(input.account_id), contact = stableId(input.contact_id);
  const { rows } = await db.query(
    `SELECT to_jsonb(c) AS customer, to_jsonb(l) AS contact_link,
            jsonb_build_object('tenant_id',a.tenant_id,'account_id',a.account_id,
                               'agent_id',a.agent_id,'persona',a.persona) AS account
       FROM crm_wechat_accounts a
       JOIN crm_contact_links l ON l.tenant_id=a.tenant_id AND l.account_id=a.account_id
       JOIN crm_customers c ON c.tenant_id=l.tenant_id AND c.id=l.customer_id
       JOIN crm_sync_bindings b ON b.tenant_id=c.tenant_id AND b.id=c.binding_id
      WHERE a.tenant_id=$1 AND a.account_id=$2 AND l.contact_id=$3
        AND c.source_archived=false AND b.enabled=true`,
    [tenant, account, contact]
  );
  // Unique source keys and FKs guarantee at most one match. Fail closed if schema drift breaks it.
  if (rows.length > 1) throw Object.assign(new Error('CRM contact identity is ambiguous'), { code: 'identity_conflict' });
  return rows[0] ?? null;
}
