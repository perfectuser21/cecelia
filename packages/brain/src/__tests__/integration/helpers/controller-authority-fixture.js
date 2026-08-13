import { randomUUID } from 'node:crypto';

export async function seedOwnedActiveV2RunInClient(client, {
  runId = randomUUID(),
  initiativeId = randomUUID(),
  taskId,
  phase = 'planning',
  createdSource = 'kernel_dispatch',
  recordTrustStatus = 'trusted',
  startedAt = new Date(),
  orchestratorHost = null,
  deadlineAt = null,
  impactContractPolicy = 'legacy_exempt',
  impactContractPolicyReason = 'integration fixture without routed Impact Contract',
}) {
  const controllerSessionId = randomUUID();
  await client.query(
    `INSERT INTO kernel_controller_sessions (
       id,task_id,generation,source,status,last_heartbeat_at,lease_expires_at
     ) VALUES ($1,$2,1,$3,'active',NOW(),NOW()+INTERVAL '30 minutes')`,
    [controllerSessionId,taskId,createdSource],
  );
  await client.query(
    `INSERT INTO initiative_runs (
       id,initiative_id,phase,current_task_id,orchestrator_version,
       created_source,record_trust_status,started_at,orchestrator_host,deadline_at,
       impact_contract_policy,impact_contract_policy_reason,
       controller_session_id,controller_generation,controller_lease_expires_at
     ) VALUES ($1,$2,$3,$4,'v2',$5,$6,$7,$8,$9,$10,$11,$12,1,
       (SELECT lease_expires_at FROM kernel_controller_sessions WHERE id=$12))`,
    [runId,initiativeId,phase,taskId,createdSource,recordTrustStatus,
      startedAt,orchestratorHost,deadlineAt,impactContractPolicy,
      impactContractPolicyReason,controllerSessionId],
  );
  await client.query(
    `UPDATE kernel_controller_sessions
        SET run_id=$2,updated_at=NOW()
      WHERE id=$1 AND generation=1 AND status='active'`,
    [controllerSessionId,runId],
  );
  return { runId, initiativeId, taskId, controllerSessionId, controllerGeneration: 1 };
}

export async function seedOwnedActiveV2Run(pool, options) {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const seeded = await seedOwnedActiveV2RunInClient(client, options);
    await client.query('COMMIT');
    return seeded;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
