import { randomUUID } from 'node:crypto';
import {
  CONTROLLER_LEASE_DEFAULT_SECONDS,
} from '../../orchestrator/kernel-run-store.js';
import { kernelHistoryPgFixture } from './helpers/kernel-history-pg-fixture.js';
export const LEASE = CONTROLLER_LEASE_DEFAULT_SECONDS;
export const MIN = 60_000;
export function createKernelLeasePgFixture() {
  let fixture;
  let testPool;
  async function createIsolatedDatabase() {
    fixture = await kernelHistoryPgFixture();
    testPool = fixture.pool;
  }
  async function dropIsolatedDatabase() { await fixture?.close(); }
  function pool() {
    if (!testPool) throw new Error('kernel lease PG fixture is not initialized');
    return testPool;
  }
  async function seedOwnedRun({ controllerSessionId }) {
    const initiativeId = randomUUID();
    const taskId = randomUUID();
    const receiptId = randomUUID();
    await pool().query(
      `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
       VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
      [taskId, `kernel-leaserenew-${taskId}`, JSON.stringify({
        initiative_id: initiativeId,
        routing_receipt_id: receiptId,
        work_kind: 'coding_mutation',
        change_kind: 'bugfix',
        repo: 'cecelia',
        harness_runtime: 'kernel-v1',
      })],
    );
    await pool().query(
      `INSERT INTO work_routing_receipts (
         id,task_id,source,source_id,work_kind,change_kind,pipeline,
         canonical_task_type,map_scope,impact_contract_required,
         orchestrator,router_version,route_reason,default_execution_profile,repo,evidence,
         direct_contract_seed,map_scope_validation_version
       ) VALUES (
         $1,$2,'integration',$3,'coding_mutation','bugfix','harness',
         'harness_initiative','["F0"]'::jsonb,true,
         'kernel-harness-v2','work-router-v1','integration','hotfix-v1','cecelia',$4::jsonb,
         $5::jsonb,'active-business-node-v1'
       )`,
      [receiptId,taskId,`kernel-lease:${taskId}`,JSON.stringify({
        branch:'cp-kernel-lease-integration',
        base_sha:'a'.repeat(40),
      }),JSON.stringify({
        contract_version:'direct-profile-contract-seed/v1',
        title:`kernel-leaserenew-${taskId}`,
        objective:`kernel-leaserenew-${taskId}`,
        execution_profile:'hotfix-v1',
      })],
    );
    const runId = randomUUID();
    await pool().query(`INSERT INTO kernel_controller_sessions
      (id,task_id,generation,source,status,lease_expires_at)
      VALUES ($1,$2,1,'historical_reconstruction','active',NOW()+INTERVAL '30 minutes')`, [controllerSessionId,taskId]);
    const { rows: [run] } = await pool().query(`INSERT INTO initiative_runs
      (id,initiative_id,current_task_id,phase,orchestrator_version,created_source,
       controller_session_id,controller_generation,controller_lease_expires_at,deadline_at)
      SELECT $1,$2,$3,'planning','v2','historical_reconstruction',id,generation,lease_expires_at,NOW()+INTERVAL '8 hours'
      FROM kernel_controller_sessions WHERE id=$4 RETURNING *`, [runId,initiativeId,taskId,controllerSessionId]);
    await pool().query('UPDATE kernel_controller_sessions SET run_id=$2 WHERE id=$1',[controllerSessionId,runId]);
    return {
      runId: run.id,
      taskId,
      initiativeId,
      controllerSessionId: run.controller_session_id,
      controllerGeneration: Number(run.controller_generation),
    };
  }
  async function leaseOf(runId) {
    const { rows } = await pool().query(
      `SELECT r.controller_lease_expires_at, r.orchestrator_heartbeat_at,
              r.phase, r.failure_reason,
              t.status AS task_status
         FROM initiative_runs r
         JOIN tasks t ON t.id = r.current_task_id
        WHERE r.id = $1`,
      [runId],
    );
    return rows[0];
  }
  async function auditEvents(runId) {
    const { rows } = await pool().query(
      `SELECT event_type, source, task_id, payload
         FROM cecelia_events
        WHERE payload->>'run_id' = $1
        ORDER BY id`,
      [runId],
    );
    return rows;
  }
  async function installRejectingAuditTrigger(eventType) {
    if (!['kernel_controller_lease_renewed', 'kernel_ownerless_run_recovered'].includes(eventType)) {
      throw new Error(`unsafe audit event fixture: ${eventType}`);
    }
    await pool().query(`
      CREATE OR REPLACE FUNCTION reject_kernel_audit_event()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = TG_ARGV[0] THEN
          RAISE EXCEPTION 'forced kernel audit failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool().query(
      `CREATE TRIGGER reject_kernel_audit_event_trigger
         BEFORE INSERT ON cecelia_events
         FOR EACH ROW
         EXECUTE FUNCTION reject_kernel_audit_event('${eventType}')`,
    );
  }
  async function removeRejectingAuditTrigger() {
    await pool().query('DROP TRIGGER IF EXISTS reject_kernel_audit_event_trigger ON cecelia_events');
    await pool().query('DROP FUNCTION IF EXISTS reject_kernel_audit_event()');
  }
  async function waitForBlockedFinalize() {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { rows } = await pool().query(
        `SELECT count(*)::int AS blocked
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND cardinality(pg_blocking_pids(pid)) > 0
            AND query LIKE '%SELECT id, status%'
            AND query LIKE '%FROM tasks%'
            AND query LIKE '%FOR UPDATE%'`,
      );
      if (rows[0].blocked > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('reconcile did not reach the blocked finalize boundary');
  }
  return {
    auditEvents,
    createIsolatedDatabase,
    dropIsolatedDatabase,
    installRejectingAuditTrigger,
    leaseOf,
    pool,
    removeRejectingAuditTrigger,
    seedOwnedRun,
    waitForBlockedFinalize,
  };
}
