import { createHash } from 'node:crypto';
export const fault = code => Object.assign(new Error(`CRM onboarding: ${code}`), { code });
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw fault('invalid_input');
  return value.toLowerCase();
}
export function stable(value, max = 500) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > max) throw fault('invalid_input');
  return value;
}
function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])]));
  return value;
}
export const hash = value => createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex');
export const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0] ?? null;
export async function transaction(db, fn) {
  const client = typeof db.totalCount === 'number' && typeof db.connect === 'function' ? await db.connect() : db;
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { if (client !== db) client.release(); }
}
export const identityLock = (db, tenant, customer) => db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`crm-identity:${tenant}:${customer}`]);
export async function activeBinding(db, tenant, id) {
  const binding = await one(db, 'SELECT * FROM crm_sync_bindings WHERE tenant_id=$1 AND id=$2 FOR SHARE', [tenant, id]);
  if (!binding) throw fault('not_found');
  if (!binding.enabled) throw fault('binding_disabled');
  return binding;
}
