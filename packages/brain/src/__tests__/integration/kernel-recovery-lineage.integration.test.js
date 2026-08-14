import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import pool from '../../db.js';
import { createKernelRun } from '../../orchestrator/kernel-run-store.js';
import { collectGroundTruth } from '../../orchestrator/ground-truth.js';

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
      controller_generation bigint,
      controller_lease_expires_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE kernel_controller_sessions (
      id uuid PRIMARY KEY,
      run_id uuid REFERENCES initiative_runs(id) ON DELETE CASCADE,
      task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      generation bigint NOT NULL DEFAULT 1,
      source text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
      lease_expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
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
    CREATE TABLE orchestrator_decision_log (
      run_id uuid NOT NULL, hop integer NOT NULL, action text NOT NULL,
      observed jsonb NOT NULL DEFAULT '{}', derived_phase text,
      gate_verdict text, detail text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE harness_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
      role text NOT NULL, status text NOT NULL, result jsonb,
      error_code text, hop integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
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

  it('queries explicit-recovery validation lineage without comparing json text to uuid', async () => {
    const ids = await fixture();
    const recoveryRunId = randomUUID();
    const headSha = 'c'.repeat(40);
    const prUrl = 'https://github.com/perfectuser21/cecelia/pull/4872';
    await schemaPool.query(
      `INSERT INTO orchestrator_decision_log
         (run_id,hop,action,observed,derived_phase,gate_verdict)
       VALUES ($1,7,'spawn:evaluator',$2::jsonb,'evaluate','allow')`,
      [ids.predecessorRunId, JSON.stringify({
        routingReceipt: { id: ids.receiptId },
        contract: { id: ids.contractId, row: { approved_sha: 'b'.repeat(40) } },
        implementationBaseline: { base_sha: 'a'.repeat(40) },
        pr: { url: prUrl, head_sha: headSha },
      })],
    );
    await schemaPool.query(
      `INSERT INTO harness_attempts (run_id,role,status,result,completed_at)
       VALUES ($1,'generator','completed','{}',now())`,
      [ids.predecessorRunId],
    );

    const groundTruthPool = {
      async query(sql, params) {
        if (sql.includes('AS validation_origin_run_id')) {
          return schemaPool.query(sql, params);
        }
        if (sql.startsWith('SELECT * FROM initiative_runs')) return { rows: [{
          id: recoveryRunId, current_task_id: ids.taskId, phase: 'evaluate',
          contract_id: ids.contractId, pr_url: prUrl,
          created_source: 'explicit_recovery', predecessor_run_id: ids.predecessorRunId,
          record_trust_status: 'trusted',
        }] };
        if (sql.startsWith('SELECT * FROM initiative_contracts')) {
          return { rows: [{ id: ids.contractId, status: 'approved', approved_sha: 'b'.repeat(40) }] };
        }
        if (sql.includes('FROM initiative_contract_artifacts')) return { rows: [] };
        if (sql.startsWith('SELECT * FROM tasks')) return { rows: [{
          id: ids.taskId, status: 'in_progress',
          payload: { routing_receipt_id: ids.receiptId, pr_url: prUrl },
        }] };
        if (sql.includes('FROM work_routing_receipts receipt')) return { rows: [{
          id: ids.receiptId, task_id: ids.taskId, work_kind: 'coding_mutation',
          change_kind: 'bugfix', pipeline: 'harness', repo: 'cecelia',
          evidence: { branch: 'cp-recovery', base_sha: 'a'.repeat(40) },
          superseded: false,
        }] };
        if (sql.includes('FROM orchestrator_decision_log fix')) return { rows: [] };
        if (sql.includes('FROM orchestrator_decision_log')) return { rows: [] };
        if (sql.includes('FROM harness_attempts')) return { rows: [] };
        if (sql.includes('FROM account_usage_cache')) return { rows: [] };
        if (sql.includes('FROM gan_case_file')) return { rows: [] };
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
    const execCmd = (command) => {
      if (command.includes('gh pr view')) return JSON.stringify({
        number: 4872, state: 'OPEN', mergeStateStatus: 'CLEAN',
        headRefName: 'cp-08122220-a8da7da7', headRefOid: headSha,
        statusCheckRollup: [],
      });
      if (command.includes('docker ps')) return '';
      if (command.includes('ls-remote')) return '';
      return '';
    };

    const observed = await collectGroundTruth({
      pool: groundTruthPool,
      execCmd,
      fileExists: () => false,
      readFile: () => '',
    }, { taskId: ids.taskId, runId: recoveryRunId });

    expect(observed.verifiedExistingPrOrigin).toMatchObject({
      source: 'trusted_prior_kernel_run',
      run_id: ids.predecessorRunId,
      pr_url: prUrl,
      pr_head_sha: headSha,
    });
  });
});
