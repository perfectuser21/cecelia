import { enrollmentError } from './spec.js';

const ADDRESS_FIELDS = ['address', 'tailscale_ip', 'public_ip'];
export function registryIdentity(machine) {
  return { name: machine.name, addresses: Object.fromEntries(ADDRESS_FIELDS.map(key => [key, machine.metadata?.[key] ?? null])) };
}
export async function registryTarget(db, request) {
  const { rows } = await db.query(`SELECT * FROM system_registry WHERE type='machine' AND
    (name=$1 OR metadata->>'address'=$2 OR metadata->>'tailscale_ip'=$2 OR metadata->>'public_ip'=$2
      OR metadata->>'ssh_alias'=$2 OR metadata->>'tailscale_name'=$2) ORDER BY id FOR UPDATE`, [request.name, request.address]);
  if (!rows.length) return null;
  if (rows.length !== 1 || rows[0].name !== request.name || !ADDRESS_FIELDS.some(key => rows[0].metadata?.[key] === request.address)) {
    throw enrollmentError('机器名称与台账连接地址不一致，或地址已属于其他机器', 409);
  }
  return rows[0];
}
export function matchesAdoption(machine, meta) {
  return machine?.id === meta.id && !machine.metadata?.onboarding &&
    machine.name === meta.adoption?.name && ADDRESS_FIELDS.every(key =>
      (machine.metadata?.[key] ?? null) === meta.adoption?.addresses?.[key]);
}
export function requireAdoption(machine, meta) {
  if (!matchesAdoption(machine, meta)) throw enrollmentError('原机器身份已变化，请核对设备台账', 409);
}
export async function adoptReceipt(db, meta, metadata) {
  let machine;
  try { machine = await registryTarget(db, meta.request); }
  catch (error) { if (error.status === 409) return { rows: [] }; throw error; }
  if (!matchesAdoption(machine, meta)) return { rows: [] };
  // 只合并可信接入事实；状态、服务、账号及硬件等台账字段仍由原所有者维护。
  const patch = { address: meta.request.address, role: meta.request.role,
    node_health: metadata.node_health, onboarding: metadata.onboarding };
  if (!machine.metadata?.physical_location) patch.physical_location = meta.request.region;
  return db.query(`UPDATE system_registry SET metadata=COALESCE(metadata,'{}'::jsonb)||$2::jsonb,updated_at=now()
    WHERE id=$1 AND type='machine' RETURNING id,metadata`, [meta.id, JSON.stringify(patch)]);
}
