import { createProductionCapabilityProbes } from './preflight/production-probes.js';
import { MACHINE_CAPACITY_LOCK_SQL } from './attempt-machine-capacity.js';
import { MACHINE_CAPACITY_CONTENDED, prepareResourceBudget } from './attempt-resource-budget.js';

export async function collectReplacementSnapshot(input, { probes = createProductionCapabilityProbes(), now = Date.now } = {}) {
  const capacity = await probes.getMachineCapacity({ machine: input.machineId, task_bundle: { ...input.bundle, role: input.role } });
  return { verified: true, machine: input.machineId, capacity,
    created_at: now(), expires_at: now() + 30_000 };
}

// Renewal and other recovery contenders cannot change the old lease while its
// exact worker is being stopped. Unknown cleanup rolls back without releasing
// even one resource slot. Only a confirmed stop permits reservation transfer.
export async function reserveExpiredAttemptReplacement({
  pool, parentAttempt, childInput, confirmCleanup,
  collectSnapshot = collectReplacementSnapshot,
}) {
  if (typeof pool?.connect !== 'function') throw new Error('replacement_requires_transactional_pool');
  const capacitySnapshot = await collectSnapshot(childInput);
  if (!prepareResourceBudget({ ...childInput, capacitySnapshot }).valid) throw new Error(MACHINE_CAPACITY_CONTENDED);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(MACHINE_CAPACITY_LOCK_SQL, [childInput.machineId]);
    await client.query('SELECT id FROM initiative_runs WHERE id=$1 FOR SHARE', [parentAttempt.run_id]);
    const locked = (await client.query(`SELECT * FROM harness_attempts WHERE id=$1
      AND status IN ('queued','starting','running') AND lease_generation=$2
      AND lease_owner IS NOT DISTINCT FROM $3
      AND (lease_expires_at IS NULL OR lease_expires_at < clock_timestamp()) FOR UPDATE`,
    [parentAttempt.id, parentAttempt.lease_generation, parentAttempt.lease_owner])).rows[0];
    if (!locked) { await client.query('ROLLBACK'); return null; }
    if (childInput.runId !== locked.run_id || childInput.role !== locked.role
        || childInput.machineId !== (locked.actual_machine_id ?? locked.machine_id ?? locked.requested_machine_id)) {
      throw new Error('replacement_identity_mismatch');
    }
    let timer;
    let receipt;
    try {
      receipt = await Promise.race([
        confirmCleanup(locked),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('replacement_cleanup_timeout')), 20_000); }),
      ]);
    } finally { clearTimeout(timer); }
    if (!['cleaned', 'already_clean'].includes(receipt?.status) || receipt.attempt_id !== locked.id) {
      throw new Error('replacement_cleanup_unconfirmed');
    }
    const { createAttemptStore } = await import('./attempt-store.js');
    const store = createAttemptStore(client, { transactionClient: true });
    const failed = await store.fail(locked.id, { code: 'resumed_as_child', message: 'exact old worker cleanup confirmed before replacement' },
      { leaseOwner: locked.lease_owner, leaseGeneration: locked.lease_generation, requireExpired: true });
    if (!failed.attempt) throw new Error('replacement_parent_fenced');
    const child = await store.createAttempt({ ...childInput, capacitySnapshot });
    await client.query('COMMIT');
    return { parent: locked, child };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
