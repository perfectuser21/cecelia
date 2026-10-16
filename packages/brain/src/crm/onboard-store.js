import { fault, uuid, stable, hash, one, transaction, activeBinding, contactLock } from './onboard-common.js';

function normalize(input) {
  const keys = ['tenant_id','binding_id','account_id','contact_id','event_id','display_name','authorized','scope','authorization_ref','identity_evidence_sha256','observed_at','friendship_status'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw fault('invalid_input');
  if (input.authorized !== true || input.scope !== 'test' || !['confirmed','no_op'].includes(input.friendship_status) ||
      !/^[a-f0-9]{64}$/.test(input.identity_evidence_sha256 ?? '') || typeof input.observed_at !== 'string' ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(input.observed_at) || !Number.isFinite(Date.parse(input.observed_at))) throw fault('invalid_input');
  return { tenant_id: uuid(input.tenant_id), binding_id: uuid(input.binding_id), account_id: stable(input.account_id),
    contact_id: stable(input.contact_id), event_id: stable(input.event_id,200), display_name: stable(input.display_name,2000),
    authorized: true, scope: 'test', authorization_ref: stable(input.authorization_ref,2000),
    identity_evidence_sha256: input.identity_evidence_sha256, observed_at: new Date(input.observed_at).toISOString(), friendship_status: input.friendship_status };
}

/** Trusted workflow attestation only. No Notion call, UI action, nickname matching, or scope expansion. */
export async function onboardContact(db, input) {
  const value = normalize(input), digest = hash(value);
  const { tenant_id: tenant, binding_id: bindingId, account_id: account, contact_id: contact } = value;
  return transaction(db, async tx => {
    await activeBinding(tx, tenant, bindingId);
    if (!await one(tx, 'SELECT account_id FROM crm_wechat_accounts WHERE tenant_id=$1 AND account_id=$2', [tenant, account])) throw fault('not_found');
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`crm-friend-event:${tenant}:${account}:${value.event_id}`]);
    await contactLock(tx, tenant, account, contact);
    const previous = await one(tx, 'SELECT * FROM crm_friend_events WHERE tenant_id=$1 AND account_id=$2 AND event_id=$3', [tenant, account, value.event_id]);
    if (previous && previous.payload_sha256 !== digest) throw fault('identity_conflict');
    let link = await one(tx, 'SELECT * FROM crm_contact_links WHERE tenant_id=$1 AND account_id=$2 AND contact_id=$3 FOR UPDATE', [tenant, account, contact]);
    let customer, created = false;
    if (link) {
      customer = await one(tx, 'SELECT * FROM crm_customers WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant, link.customer_id]);
      if (!customer || customer.source_archived || customer.binding_id !== bindingId) throw fault('identity_conflict');
    } else {
      if (previous) throw fault('identity_conflict');
      customer = await one(tx, `INSERT INTO crm_customers(tenant_id,binding_id,display_name,origin_kind)
        VALUES($1,$2,$3,'wechat_friend') RETURNING *`, [tenant, bindingId, value.display_name]);
      link = await one(tx, 'INSERT INTO crm_contact_links(tenant_id,account_id,contact_id,customer_id) VALUES($1,$2,$3,$4) RETURNING *', [tenant, account, contact, customer.id]);
      created = true;
    }
    if (previous) return { customer, contact_link: link, event: previous, created: false, replayed: true };
    const event = await one(tx, `INSERT INTO crm_friend_events(tenant_id,account_id,event_id,binding_id,contact_id,contact_link_id,customer_id,payload,payload_sha256,authorization_ref,evidence_sha256,observed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [tenant, account, value.event_id, bindingId, contact, link.id, customer.id, JSON.stringify(value), digest, value.authorization_ref, value.identity_evidence_sha256, value.observed_at]);
    await tx.query(`INSERT INTO crm_audit(tenant_id,customer_id,actor,action,new_value) VALUES($1,$2,$3,$4,$5)`,
      [tenant, customer.id, 'trusted-workflow:wechat_friend_onboarding.android', created ? 'friend_customer_created' : 'friend_observed', JSON.stringify({ event_id: event.id, contact_link_id: link.id, authorization_ref: value.authorization_ref })]);
    return { customer, contact_link: link, event, created, replayed: false };
  });
}
