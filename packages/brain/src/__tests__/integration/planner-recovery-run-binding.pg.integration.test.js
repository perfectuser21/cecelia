import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { consumePlannerRecoveryReceipt } from '../../orchestrator/planner-recovery-consumption-store.js';
import { createKernelRun } from '../../orchestrator/kernel-run-store.js';
import { collectGroundTruth } from '../../orchestrator/ground-truth.js';
import { derive } from '../../orchestrator/derive.js';
import { loadPlannerRecoveryPrdAuthority } from '../../orchestrator/planner-recovery-ground-truth.js';
import {
  dispatchPlannerRecoveryProposer,
  seedPlannerRecoveryCallback,
} from './helpers/planner-recovery-receipt-fixture.js';
import { seedActiveF1 } from './helpers/take-map-authority-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let pool;
let databaseName;
let boundRecovery;
let downSql;
let upSql;

function quoteIdentifier(value) {
  if (!/^planner_run_binding_[a-z0-9_]+$/.test(value)) {
    throw new Error('unsafe database name');
  }
  return `"${value}"`;
}

beforeAll(async () => {
  databaseName = `planner_run_binding_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  pool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 12 });
  upSql = await readFile(
    new URL('../../../migrations/430_planner_recovery_run_binding.sql', import.meta.url),
    'utf8',
  );
  downSql = await readFile(
    new URL('../../../migrations/rollback/430_planner_recovery_run_binding.down.sql', import.meta.url),
    'utf8',
  );
  await pool.query(downSql);
  await pool.query(downSql);
  await pool.query(upSql);
  await pool.query(upSql);
  await seedActiveF1(pool);
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('Planner recovery Kernel run binding [real PostgreSQL]', () => {
  it('installs a unique immutable receipt binding on initiative_runs', async () => {
    const shape = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='initiative_runs'
          AND column_name='planner_recovery_receipt_id'`,
    );
    expect(shape.rows).toEqual([{ column_name: 'planner_recovery_receipt_id' }]);
    const constraints = await pool.query(
      `SELECT conname,contype
         FROM pg_constraint
        WHERE conrelid='initiative_runs'::regclass
          AND conname IN (
            'initiative_runs_planner_recovery_receipt_fk',
            'initiative_runs_planner_recovery_receipt_unique'
          )
        ORDER BY conname`,
    );
    expect(constraints.rows).toEqual([
      { conname: 'initiative_runs_planner_recovery_receipt_fk', contype: 'f' },
      { conname: 'initiative_runs_planner_recovery_receipt_unique', contype: 'u' },
    ]);
    const triggers = await pool.query(
      `SELECT tgname
         FROM pg_trigger
        WHERE tgrelid='initiative_runs'::regclass
          AND NOT tgisinternal
          AND tgname IN (
            'planner_recovery_run_authority',
            'planner_recovery_run_binding_immutable'
          )
        ORDER BY tgname`,
    );
    expect(triggers.rows).toEqual([
      { tgname: 'planner_recovery_run_authority' },
      { tgname: 'planner_recovery_run_binding_immutable' },
    ]);
  });

  it('creates exactly one clean GAN run from the exact consumed receipt', async () => {
    const sourceTaskId = randomUUID();
    const sourceRouteId = randomUUID();
    const contractId = randomUUID();
    const sourceInitiativeId = randomUUID();
    await pool.query(
      `INSERT INTO tasks(id,title,status,task_type,payload,pr_url)
       VALUES($1,$2,'queued','harness_initiative',$3::jsonb,$4)`,
      [
        sourceTaskId,
        `Planner recovery source ${sourceTaskId}`,
        JSON.stringify({
          initiative_id: sourceInitiativeId,
          contract_content: 'must not inherit',
          pr_url: 'https://github.com/attacker/forged/pull/1',
        }),
        'https://github.com/attacker/forged/pull/1',
      ],
    );
    await pool.query(
      `INSERT INTO work_routing_receipts(
         id,task_id,source,source_id,work_kind,change_kind,pipeline,
         canonical_task_type,default_execution_profile,repo,map_scope,
         impact_contract_required,orchestrator,router_version,route_reason,
         evidence,map_scope_validation_version
       ) VALUES(
         $1,$2,'api',$3,'coding_mutation','new_capability','harness',
         'harness_initiative','new-capability-v1','cecelia','["F1"]',
         true,'kernel-harness-v2','work-router-v1','fixture',
         $4::jsonb,'active-business-node-v1'
       )`,
      [sourceRouteId, sourceTaskId, `source-${sourceTaskId}`, JSON.stringify({
        source: 'api', branch: 'cp-source-planner', base_sha: 'a'.repeat(40),
      })],
    );
    const fixture = await seedPlannerRecoveryCallback(pool, {
      taskId: sourceTaskId,
      taskAlreadyExists: true,
      initiativeId: sourceInitiativeId,
    });
    await fixture.callback();
    await pool.query(
      `INSERT INTO initiative_contracts(
         id,initiative_id,version,status,contract_content,approved_sha
       ) VALUES($1,$2,1,'approved','must not inherit',$3)`,
      [contractId, fixture.runId, 'c'.repeat(40)],
    );
    await pool.query(
      `UPDATE initiative_runs
          SET phase='failed',contract_id=$2,pr_url=$3
        WHERE id=$1`,
      [fixture.runId, contractId, 'https://github.com/attacker/forged/pull/1'],
    );
    await pool.query("UPDATE tasks SET status='failed' WHERE id=$1", [sourceTaskId]);

    const consumed = await consumePlannerRecoveryReceipt(pool, {
      predecessorRunId: fixture.runId,
    });
    const successor = (await pool.query(
      'SELECT id,payload FROM tasks WHERE id=$1',
      [consumed.successor_task_id],
    )).rows[0];
    const createInput = {
      taskId: successor.id,
      initiativeId: successor.payload.initiative_id,
      phase: 'planning',
      journeyId: null,
      abilityId: null,
      host: 'kernel-v1',
      deadlineHours: 8,
      createdSource: 'kernel_dispatch',
    };
    const results = await Promise.all(Array.from({ length: 10 }, () => (
      createKernelRun(pool, createInput, {
        ensureMapImpactPreflight: async () => ({
          contract: { id: randomUUID(), status: 'active' },
          recovery_contract: null,
        }),
      })
    )));

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.run.id)).size).toBe(1);
    const state = await pool.query(
      `SELECT run.phase,run.created_source,run.predecessor_run_id,
              run.planner_recovery_receipt_id,run.contract_id,run.pr_url,
              source.status AS source_status,successor.status AS successor_status
         FROM initiative_runs run
         JOIN tasks successor ON successor.id=run.current_task_id
         JOIN tasks source ON source.id=$2
        WHERE run.current_task_id=$1`,
      [successor.id, sourceTaskId],
    );
    expect(state.rows).toEqual([{
      phase: 'gan',
      created_source: 'planner_recovery',
      predecessor_run_id: fixture.runId,
      planner_recovery_receipt_id: consumed.receipt_id,
      contract_id: null,
      pr_url: null,
      source_status: 'failed',
      successor_status: 'queued',
    }]);
    await expect(pool.query(
      'UPDATE initiative_runs SET planner_recovery_receipt_id=NULL WHERE id=$1',
      [results[0].run.id],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(
      `INSERT INTO initiative_runs(
         initiative_id,phase,current_task_id,created_source,
         predecessor_run_id,planner_recovery_receipt_id
       ) VALUES($1,'planning',$2,'planner_recovery',$3,$4)`,
      [successor.payload.initiative_id, successor.id, fixture.runId, consumed.receipt_id],
    )).rejects.toMatchObject({ code: '23514' });
    boundRecovery = {
      runId: results[0].run.id,
      taskId: successor.id,
      receiptId: consumed.receipt_id,
      predecessorRunId: fixture.runId,
      sourceTaskId,
      initiativeId: successor.payload.initiative_id,
      exactEvidence: fixture.exactEvidence,
    };
  });

  it('rejects a forged binding after the predecessor task is reopened', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `ALTER TABLE initiative_runs
           DROP CONSTRAINT initiative_runs_planner_recovery_receipt_unique`,
      );
      await client.query(
        "UPDATE tasks SET status='queued' WHERE id=$1",
        [boundRecovery.sourceTaskId],
      );
      await expect(client.query(
        `INSERT INTO initiative_runs(
           initiative_id,phase,current_task_id,created_source,
           predecessor_run_id,planner_recovery_receipt_id
         ) VALUES($1,'gan',$2,'planner_recovery',$3,$4)`,
        [
          boundRecovery.initiativeId,
          boundRecovery.taskId,
          boundRecovery.predecessorRunId,
          boundRecovery.receiptId,
        ],
      )).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('rejects changing an ordinary run into an unbound planner recovery run', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query(
        "UPDATE initiative_runs SET created_source='planner_recovery' WHERE id=$1",
        [boundRecovery.predecessorRunId],
      )).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('requires the recovery successor itself to remain trusted Kernel v2 authority', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `ALTER TABLE initiative_runs
           DROP CONSTRAINT initiative_runs_planner_recovery_receipt_unique`,
      );
      await expect(client.query(
        `INSERT INTO initiative_runs(
           initiative_id,phase,current_task_id,created_source,
           predecessor_run_id,planner_recovery_receipt_id,
           orchestrator_version,record_trust_status
         ) VALUES($1,'gan',$2,'planner_recovery',$3,$4,'v1','untrusted')`,
        [
          boundRecovery.initiativeId,
          boundRecovery.taskId,
          boundRecovery.predecessorRunId,
          boundRecovery.receiptId,
        ],
      )).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }

    await expect(pool.query(
      "UPDATE initiative_runs SET record_trust_status='untrusted' WHERE id=$1",
      [boundRecovery.runId],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('cannot downgrade the consumed successor by deleting mutable payload keys', async () => {
    const original = (await pool.query(
      'SELECT payload FROM tasks WHERE id=$1',
      [boundRecovery.taskId],
    )).rows[0].payload;
    await pool.query(
      `UPDATE tasks
          SET payload=payload
            - 'planner_recovery_receipt_id'
            - 'predecessor_run_id'
        WHERE id=$1`,
      [boundRecovery.taskId],
    );
    try {
      await expect(createKernelRun(pool, {
        taskId: boundRecovery.taskId,
        initiativeId: boundRecovery.initiativeId,
        phase: 'planning',
        journeyId: null,
        abilityId: null,
        host: 'kernel-v1',
        deadlineHours: 8,
        createdSource: 'kernel_dispatch',
      }, {
        ensureMapImpactPreflight: async () => ({
          contract: { id: randomUUID(), status: 'active' },
        }),
      })).rejects.toMatchObject({ code: 'planner_recovery_run_authority_invalid' });
    } finally {
      await pool.query('UPDATE tasks SET payload=$2::jsonb WHERE id=$1', [
        boundRecovery.taskId,
        JSON.stringify(original),
      ]);
    }
  });

  it('revokes Ground Truth authority if the predecessor task is reopened', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE tasks SET status='queued' WHERE id=$1",
        [boundRecovery.sourceTaskId],
      );
      const run = (await client.query(
        'SELECT * FROM initiative_runs WHERE id=$1',
        [boundRecovery.runId],
      )).rows[0];
      await expect(loadPlannerRecoveryPrdAuthority(client, {
        run,
        taskId: boundRecovery.taskId,
      })).rejects.toMatchObject({ code: 'planner_recovery_ground_truth_invalid' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('derives the first successor action from only the immutable receipt', async () => {
    const observed = await collectGroundTruth({
      pool,
      execCmd: (command) => (command.includes('gh pr list') ? '[]' : ''),
      fileExists: (path) => {
        if (path === '/host/forged/sprint-prd.md') {
          throw new Error('recovery must not consult a mutable host PRD');
        }
        return false;
      },
      readFile: () => '',
      readAuthCircuit: async () => [],
    }, {
      taskId: boundRecovery.taskId,
      runId: boundRecovery.runId,
      prdPath: '/host/forged/sprint-prd.md',
    });

    expect(observed.prdExists).toBe(true);
    expect(observed.prdEvidence).toMatchObject({
      source: 'planner_recovery_receipt',
      receipt_id: boundRecovery.receiptId,
    });
    expect(observed.plannerPrdArtifact).toMatchObject({
      type: 'git_artifact',
      kind: 'planner_prd',
      path: boundRecovery.exactEvidence.prd_path,
      branch: boundRecovery.exactEvidence.resolved_branch,
      head_sha: boundRecovery.exactEvidence.head_sha,
      verification_status: 'verified',
    });
    const decision = derive({
      ...observed,
      counters: {
        hops: 0,
        fixRound: 0,
        pollCount: 0,
        noPushStreak: 0,
        noVerdictStreak: 0,
        ganCostUsd: 0,
      },
    });
    expect(decision).toMatchObject({
      phase: 'gan',
      action: 'spawn:proposer',
    });
    expect(observed.task.payload).not.toHaveProperty('sprint_dir');
    const dispatched = await dispatchPlannerRecoveryProposer({
      observed, taskId: boundRecovery.taskId, runId: boundRecovery.runId,
    });
    expect(dispatched.result.status, JSON.stringify(dispatched.result)).toBe('LAUNCHED');
    expect(dispatched.result.provider).toBe('codex');
    expect(dispatched.created.bundle.inputs).toMatchObject({
      sprint_dir: boundRecovery.exactEvidence.prd_path.replace('/sprint-prd.md', ''),
      prd: { path: boundRecovery.exactEvidence.prd_path },
      planner_branch: boundRecovery.exactEvidence.resolved_branch,
      planner_head_sha: boundRecovery.exactEvidence.head_sha,
    });
  });

  it('cannot reopen the failed source task through legacy explicit recovery after consumption', async () => {
    let createdRun = null;
    let rejection = null;
    try {
      createdRun = await createKernelRun(pool, {
        taskId: boundRecovery.sourceTaskId,
        initiativeId: boundRecovery.initiativeId,
        phase: 'planning',
        journeyId: null,
        abilityId: null,
        host: 'kernel-v1',
        deadlineHours: 8,
        createdSource: 'explicit_recovery',
        predecessorRunId: boundRecovery.predecessorRunId,
      }, {
        ensureMapImpactPreflight: async () => ({
          contract: { id: randomUUID(), status: 'active' },
          recovery_contract: null,
        }),
      });
    } catch (error) {
      rejection = error;
    } finally {
      if (createdRun?.run?.id) {
        await pool.query("UPDATE initiative_runs SET phase='failed' WHERE id=$1", [
          createdRun.run.id,
        ]);
        await pool.query("UPDATE tasks SET status='failed' WHERE id=$1", [
          boundRecovery.sourceTaskId,
        ]);
      }
    }
    expect(rejection).toMatchObject({
      message: 'explicit recovery predecessor already consumed by planner recovery',
    });
    const source = await pool.query('SELECT status FROM tasks WHERE id=$1', [
      boundRecovery.sourceTaskId,
    ]);
    expect(source.rows).toEqual([{ status: 'failed' }]);
  });

  it('fails closed instead of dropping a non-empty receipt binding', async () => {
    const client = await pool.connect();
    try {
      await expect(client.query(downSql)).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const preserved = await pool.query(
      'SELECT planner_recovery_receipt_id FROM initiative_runs WHERE id=$1',
      [boundRecovery.runId],
    );
    expect(preserved.rows).toEqual([{ planner_recovery_receipt_id: boundRecovery.receiptId }]);
  });
});
