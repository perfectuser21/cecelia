import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import pool from '../../db.js';
import { createKernelRun } from '../../orchestrator/kernel-run-store.js';

const schema = `kernel_recovery_lineage_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const searchPath = `${quote(schema)}, public`;

const schemaPool = {
  async connect() {
    const client = await pool.connect();
    await client.query(`SET search_path TO ${searchPath}`);
    const release = client.release.bind(client);
    client.release = () => void client.query('RESET search_path').finally(release);
    return client;
  },
  async query(sql, params) {
    const client = await this.connect();
    try { return await client.query(sql, params); } finally { client.release(); }
  },
};

beforeAll(async () => {
  const database = await pool.query('SELECT current_database() AS name');
  if (!database.rows[0].name.endsWith('_test')) throw new Error('test database required');
  await pool.query(`CREATE SCHEMA ${quote(schema)}`);
  await schemaPool.query(`
    CREATE TABLE tasks (
      id uuid PRIMARY KEY, task_type text NOT NULL, status text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'
    );
    CREATE TABLE initiative_contracts (
      id uuid PRIMARY KEY, status text NOT NULL, approved_sha text
    );
    CREATE TABLE initiative_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), initiative_id uuid NOT NULL,
      current_task_id uuid NOT NULL, phase text NOT NULL,
      journey_id uuid, orchestrator_version text, orchestrator_host text,
      orchestrator_heartbeat_at timestamptz, orchestrator_pid integer,
      deadline_at timestamptz, ability_id uuid, created_source text,
      record_trust_status text, commander_mode text, gear text,
      impact_contract_policy text, impact_contract_policy_reason text,
      impact_contract_policy_decision_id text, map_recovery_contract_id uuid,
      contract_id uuid, predecessor_run_id uuid,
      controller_session_id uuid,
      controller_lease_expires_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX one_active_kernel_run
      ON initiative_runs(current_task_id)
      WHERE phase NOT IN ('done','failed');
    CREATE TABLE work_routing_receipts (
      id uuid PRIMARY KEY, task_id uuid NOT NULL, source text NOT NULL,
      source_id text NOT NULL, work_kind text NOT NULL, change_kind text,
      pipeline text NOT NULL, canonical_task_type text NOT NULL,
      default_execution_profile text, execution_profile_override text,
      repo text, map_scope jsonb NOT NULL DEFAULT '[]',
      impact_contract_required boolean NOT NULL, orchestrator text,
      router_version text, route_reason text, evidence jsonb NOT NULL DEFAULT '{}',
      supersedes_receipt_id uuid
    );
    CREATE TABLE cecelia_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text,
      source text, payload jsonb
    );
  `);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
  await pool.end();
});

async function fixture() {
  const taskId = randomUUID();
  const initiativeId = randomUUID();
  const receiptId = randomUUID();
  const contractId = randomUUID();
  const predecessorRunId = randomUUID();
  await schemaPool.query(
    `INSERT INTO tasks (id,task_type,status,payload)
     VALUES ($1,'harness_initiative','in_progress',$2::jsonb)`,
    [taskId, JSON.stringify({ initiative_id: initiativeId, routing_receipt_id: receiptId })],
  );
  await schemaPool.query(
    `INSERT INTO work_routing_receipts (
       id,task_id,source,source_id,work_kind,change_kind,pipeline,
       canonical_task_type,default_execution_profile,repo,map_scope,
       impact_contract_required,evidence
     ) VALUES ($1,$2,'api',$3,'coding_mutation','bugfix','harness',
       'harness_initiative','hotfix-v1','cecelia','["F0"]',true,$4::jsonb)`,
    [receiptId, taskId, `recovery:${taskId}`, JSON.stringify({ branch: 'cp-recovery', base_sha: 'a'.repeat(40) })],
  );
  await schemaPool.query(
    `INSERT INTO initiative_contracts (id,status,approved_sha)
     VALUES ($1,'approved',$2)`,
    [contractId, 'b'.repeat(40)],
  );
  await schemaPool.query(
    `INSERT INTO initiative_runs (
       id,initiative_id,current_task_id,phase,orchestrator_version,
       created_source,record_trust_status,commander_mode,contract_id
     ) VALUES ($1,$2,$3,'failed','v2','kernel_dispatch','trusted','kernel-only',$4)`,
    [predecessorRunId, initiativeId, taskId, contractId],
  );
  return { taskId, initiativeId, receiptId, contractId, predecessorRunId };
}

describe('explicit recovery lineage [PostgreSQL]', () => {
  it('persists the exact predecessor and inherits only its approved contract', async () => {
    const ids = await fixture();
    const created = await createKernelRun(schemaPool, {
      taskId: ids.taskId,
      initiativeId: ids.initiativeId,
      phase: 'evaluate', journeyId: null, abilityId: null,
      host: 'integration', deadlineHours: 1,
      createdSource: 'explicit_recovery',
      predecessorRunId: ids.predecessorRunId,
      controllerSessionId: randomUUID(),
    }, {
      ensureMapImpactPreflight: async () => ({ contract: { id: 'impact', status: 'active' } }),
    });

    const persisted = await schemaPool.query(
      `SELECT predecessor_run_id,contract_id,record_trust_status
         FROM initiative_runs WHERE id=$1`,
      [created.run.id],
    );
    expect(persisted.rows).toEqual([{
      predecessor_run_id: ids.predecessorRunId,
      contract_id: ids.contractId,
      record_trust_status: 'trusted',
    }]);
  });

  it('rejects a predecessor from another task before creating a recovery run', async () => {
    const ids = await fixture();
    const otherTaskId = randomUUID();
    await schemaPool.query('UPDATE initiative_runs SET current_task_id=$2 WHERE id=$1', [ids.predecessorRunId, otherTaskId]);

    await expect(createKernelRun(schemaPool, {
      taskId: ids.taskId,
      initiativeId: ids.initiativeId,
      phase: 'evaluate', journeyId: null, abilityId: null,
      host: 'integration', deadlineHours: 1,
      createdSource: 'explicit_recovery',
      predecessorRunId: ids.predecessorRunId,
      controllerSessionId: randomUUID(),
    }, {
      ensureMapImpactPreflight: async () => ({ contract: { id: 'impact', status: 'active' } }),
    })).rejects.toThrow('explicit recovery predecessor is invalid');

    const count = await schemaPool.query(
      `SELECT count(*)::int AS count FROM initiative_runs
        WHERE predecessor_run_id=$1`,
      [ids.predecessorRunId],
    );
    expect(count.rows[0].count).toBe(0);
  });
});
