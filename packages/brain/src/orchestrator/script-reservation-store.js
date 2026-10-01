import { createHash, randomUUID } from 'node:crypto';
import { MACHINE_CAPACITY_LOCK_SQL } from './attempt-machine-capacity.js';
import { getNodeProfile } from './fleet-node/node-profile.js';

const WAIT = Object.freeze({ outcome: 'wait', reason: 'capacity' });
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validSnapshot(input) {
  const s = input.capacitySnapshot;
  if (s?.verified !== true || s.machine !== input.machineId || s.expires_at <= Date.now()
    || !Number.isFinite(s.expires_at) || s.capacity?.ok !== true) return false;
  try {
    return [s.capacity.physical_base_slots, s.capacity.effective_base_slots,
      getNodeProfile(input.machineId).capacity].every((n) => Number.isInteger(n) && n > 0);
  } catch { return false; }
}
const required = (row, message) => { if (!row) throw new Error(message); return row; };

/** 非 Harness 预约不依赖 tasks.status、task_runs 或 lease 存活时间。 */
export function createScriptReservationStore(pool) {
  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function rowUpdate(sql, params) {
    return required((await pool.query(sql, params)).rows[0], 'reservation_transition_rejected');
  }
  return Object.freeze({
    async reserve(input) {
      if (!/^script-[a-f0-9-]+-a[1-9][0-9]*$/.test(input.ownerKey)
        || !/^[a-f0-9]{64}$/.test(input.configDigest)) throw new Error('invalid_reservation_identity');
      return transaction(async (client) => {
        await client.query(MACHINE_CAPACITY_LOCK_SQL, [input.machineId]);
        const existing = (await client.query(
          "SELECT * FROM capacity_reservations WHERE owner_kind='script' AND owner_key=$1 FOR UPDATE", [input.ownerKey])).rows[0];
        if (existing) {
          if (existing.config_digest !== input.configDigest || existing.machine_id !== input.machineId
            || existing.task_id !== input.taskId) throw new Error('configuration_conflict');
          return { outcome: existing.status === 'released' ? 'released' : 'reserved', reservation: existing };
        }
        if (!validSnapshot(input)) return WAIT;
        const task = (await client.query('SELECT status FROM tasks WHERE id=$1 FOR NO KEY UPDATE', [input.taskId])).rows[0];
        if (!['queued','in_progress'].includes(task?.status)) throw new Error('script_task_not_dispatchable');
        const occupied = (await client.query(`SELECT EXISTS (
          SELECT 1 FROM harness_attempts active WHERE
            (active.status IN ('queued','starting','running') AND $1 IN
              (active.actual_machine_id,active.requested_machine_id,active.machine_id))
            OR EXISTS (SELECT 1 FROM harness_attempt_cleanup_outbox c
              WHERE c.attempt_id=active.id AND c.status <> 'confirmed' AND c.target_machine_id=$1)
          UNION ALL SELECT 1 FROM capacity_reservations WHERE machine_id=$1 AND status <> 'released'
        ) AS occupied`, [input.machineId])).rows[0].occupied;
        if (occupied || !validSnapshot(input)) return WAIT;
        const reservation = (await client.query(`INSERT INTO capacity_reservations
          (id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest)
          SELECT $1,$2,'script',$3,$4,$5,'exclusive_unclassified','script-exclusive-v1',to_timestamp($8/1000.0),$6
          WHERE $7::double precision > EXTRACT(EPOCH FROM clock_timestamp()) * 1000 RETURNING *`,
        [randomUUID(),input.machineId,input.ownerKey,input.taskId,input.configDigest,digest(input.capacitySnapshot),input.capacitySnapshot.expires_at,
          input.capacitySnapshot.captured_at ?? Date.now()])).rows[0];
        return reservation ? { outcome: 'reserved', reservation } : WAIT;
      });
    },
    async markLaunching(id, identity) {
      if (!identity.worker_id || !identity.worker_boot_id) throw new Error('worker_identity_required');
      return rowUpdate(`UPDATE capacity_reservations SET status='launching',worker_id=$2,worker_boot_id=$3,updated_at=NOW()
        WHERE id=$1 AND status IN ('reserved','launching') RETURNING *`, [id,identity.worker_id,identity.worker_boot_id]);
    },
    async markRunning(id, identity) {
      if (!/^[a-f0-9]{64}$/.test(identity.container_id)) throw new Error('exact_container_id_required');
      return rowUpdate(`UPDATE capacity_reservations SET status=CASE WHEN status IN ('cleanup_pending','blocked') THEN status ELSE 'running' END,container_id=$2,updated_at=NOW()
        WHERE id=$1 AND status IN ('launching','running','cleanup_pending','blocked') AND worker_id=$3 AND worker_boot_id=$4 RETURNING *`,
      [id,identity.container_id,identity.worker_id,identity.worker_boot_id]);
    },
    async recordUnknown(id, error) {
      return rowUpdate(`UPDATE capacity_reservations SET last_error=$2,updated_at=NOW()
        WHERE id=$1 AND status <> 'released' RETURNING *`, [id,String(error).slice(0,500)]);
    },
    async listOutstanding(limit = 100) {
      return (await pool.query(`SELECT r.*,t.status AS task_status FROM capacity_reservations r
        LEFT JOIN tasks t ON t.id=r.task_id WHERE r.status <> 'released' OR (t.status='in_progress' AND t.payload->>'script_reservation_id'=r.id::text)
        ORDER BY r.updated_at LIMIT $1`, [limit])).rows;
    },
    async claimCleanup(id, owner, leaseMs) {
      if (!owner || !Number.isFinite(leaseMs) || leaseMs <= 0 || leaseMs > 300_000) throw new Error('invalid_cleanup_claim');
      return (await pool.query(`UPDATE capacity_reservations SET status='cleanup_pending',cleanup_claim_owner=$2,
        cleanup_claim_generation=cleanup_claim_generation+1,cleanup_challenge=$3,
        cleanup_claim_expires_at=clock_timestamp()+($4 * interval '1 millisecond'),updated_at=NOW()
        WHERE id=$1 AND status <> 'released' AND
          (cleanup_claim_expires_at IS NULL OR cleanup_claim_expires_at < clock_timestamp()) RETURNING *`,
      [id,owner,randomUUID(),leaseMs])).rows[0] ?? null;
    },
    async confirmCleanup(claim, verified) {
      if (verified?.authenticated !== true) throw new Error('cleanup_receipt_unverified');
      return transaction(async (client) => {
        const row = required((await client.query('SELECT * FROM capacity_reservations WHERE id=$1 FOR UPDATE', [claim.id])).rows[0], 'reservation_missing');
        if (row.status !== 'cleanup_pending' || row.cleanup_claim_owner !== claim.cleanup_claim_owner
          || row.cleanup_claim_generation !== claim.cleanup_claim_generation
          || new Date(row.cleanup_claim_expires_at).getTime() <= Date.now()) throw new Error('cleanup_claim_stale');
        const receipt = verified.receipt;
        const bindings = { reservation_id:row.id,machine_id:row.machine_id,owner_key:row.owner_key,
          launch_generation:row.launch_generation,intent_id:row.intent_id,worker_id:row.worker_id,
          worker_boot_id:row.worker_boot_id,container_id:row.container_id,challenge:row.cleanup_challenge };
        if (receipt?.status !== 'cleaned' || receipt.absent !== true || receipt.tombstoned !== true
          || Object.entries(bindings).some(([key,value]) => receipt[key] !== value)) throw new Error('cleanup_receipt_mismatch');
        return (await client.query(`UPDATE capacity_reservations SET status='released',released_at=NOW(),
          confirmed_receipt=$2::jsonb,updated_at=NOW() WHERE id=$1 RETURNING *`, [row.id,JSON.stringify(receipt)])).rows[0];
      });
    },
  });
}
