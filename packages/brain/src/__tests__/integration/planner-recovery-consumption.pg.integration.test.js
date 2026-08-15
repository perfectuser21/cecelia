import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { consumePlannerRecoveryReceipt } from '../../orchestrator/planner-recovery-consumption-store.js';
import { createRoutedTask } from '../../work-routing-store.js';
import { seedPlannerRecoveryCallback } from './helpers/planner-recovery-receipt-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let pool;
let databaseName;
let upSql;
let downSql;

function quoteIdentifier(value) {
  if (!/^planner_consumption_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database name');
  return `"${value}"`;
}

async function seedActiveF1() {
  const manifest = (await pool.query(
    "SELECT id,digest FROM map_manifest_versions WHERE scope_key='cecelia' AND status='active'",
  )).rows[0];
  let activeManifest = manifest;
  if (!activeManifest) {
    const decisionId = randomUUID();
    const manifestId = randomUUID();
    const digest = randomUUID().replaceAll('-', '').repeat(2);
    await pool.query(
      "INSERT INTO decisions(id,category,topic,decision) VALUES($1,'testing','planner recovery','active F1')",
      [decisionId],
    );
    await pool.query(
      `INSERT INTO map_manifest_versions(
         id,scope_key,version,source_decision_id,manifest,digest,status,activated_at
       ) VALUES($1,'cecelia',1,$2,$3::jsonb,$4,'active',NOW())`,
      [manifestId, decisionId, JSON.stringify({
        scope_key: 'cecelia', schema_version: 1, source_decision_id: decisionId,
      }), digest],
    );
    activeManifest = { id: manifestId, digest };
  }
  let projectionId = (await pool.query(
    "SELECT id FROM map_projection_runs WHERE scope_key='cecelia' AND status='active'",
  )).rows[0]?.id;
  if (!projectionId) {
    projectionId = randomUUID();
    await pool.query(
      `INSERT INTO map_projection_runs(
         id,scope_key,manifest_version_id,manifest_digest,fact_revisions,
         projector_version,projection_digest,status,activated_at
       ) VALUES($1,'cecelia',$2,$3,'{}','test-v1',$4,'active',NOW())`,
      [
        projectionId,
        activeManifest.id,
        activeManifest.digest,
        randomUUID().replaceAll('-', '').repeat(2),
      ],
    );
  }
  await pool.query(
    `INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name)
     SELECT $1,$2,'capability','F1','Factory F1'
      WHERE NOT EXISTS (
        SELECT 1 FROM map_projection_nodes WHERE run_id=$1 AND node_key='F1'
      )`,
    [projectionId, randomUUID().replaceAll('-', '').repeat(2)],
  );
}

async function seedRecoverablePlannerSource({ terminal = true } = {}) {
  const taskId = randomUUID();
  const routeId = randomUUID();
  const sourceId = `source-${taskId}`;
  const oldPayload = {
    contract_content: 'must not copy',
    pr_url: 'https://github.com/attacker/forged/pull/1',
    private_worker_path: '/tmp/forged',
  };
  await pool.query(
    `INSERT INTO tasks(id,title,status,task_type,payload,pr_url)
     VALUES($1,$2,'queued','harness_initiative',$3::jsonb,$4)`,
    [taskId, `failed source planner ${taskId}`, JSON.stringify(oldPayload), oldPayload.pr_url],
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
    [routeId, taskId, sourceId, JSON.stringify({
      source: 'api', branch: 'cp-source-planner', base_sha: 'a'.repeat(40),
    })],
  );
  const fixture = await seedPlannerRecoveryCallback(pool, {
    taskId,
    taskAlreadyExists: true,
  });
  await fixture.callback();
  if (terminal) {
    await pool.query("UPDATE initiative_runs SET phase='failed' WHERE id=$1", [fixture.runId]);
    await pool.query("UPDATE tasks SET status='failed' WHERE id=$1", [taskId]);
  }
  return { ...fixture, oldPayload, sourceRouteId: routeId };
}

beforeAll(async () => {
  databaseName = `planner_consumption_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
    new URL('../../../migrations/429_planner_recovery_consumptions.sql', import.meta.url),
    'utf8',
  );
  downSql = await readFile(
    new URL('../../../migrations/rollback/429_planner_recovery_consumptions.down.sql', import.meta.url),
    'utf8',
  );
  await pool.query(downSql);
  await pool.query(downSql);
  await pool.query(upSql);
  await pool.query(upSql);
  await seedActiveF1();
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('planner recovery consumption PostgreSQL ledger', () => {
  it('installs an append-only one-receipt one-successor ledger', async () => {
    const shape = await pool.query(
      `SELECT to_regclass('planner_recovery_consumptions')::text AS relation`,
    );
    expect(shape.rows[0].relation).toBe('planner_recovery_consumptions');
  });

  it('serializes ten concurrent requests to one successor, route, and consumption', async () => {
    const fixture = await seedRecoverablePlannerSource();
    const before = await pool.query(
      'SELECT status,payload,pr_url FROM tasks WHERE id=$1',
      [fixture.taskId],
    );
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => (
      consumePlannerRecoveryReceipt(pool, {
        predecessorRunId: fixture.runId,
        idempotencyKey: `retry-${index}`,
      })
    )));

    expect(new Set(results.map((result) => result.successor_task_id)).size).toBe(1);
    expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
    const successorId = results[0].successor_task_id;
    const receiptId = (await pool.query(
      'SELECT id FROM planner_recovery_receipts WHERE planner_attempt_id=$1',
      [fixture.attemptId],
    )).rows[0].id;
    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM planner_recovery_consumptions
           WHERE receipt_id=$1) AS consumptions,
         (SELECT COUNT(*)::int FROM tasks
           WHERE payload->>'planner_recovery_receipt_id'=$1::text) AS successors,
         (SELECT COUNT(*)::int FROM work_routing_receipts
           WHERE source='child' AND source_id=$2) AS routes,
         (SELECT COUNT(*)::int FROM task_dependencies
           WHERE (from_task_id=$3 AND to_task_id=$4)
              OR (from_task_id=$4 AND to_task_id=$3)) AS dependencies`,
      [receiptId, `planner-recovery:${receiptId}`, fixture.taskId, successorId],
    );
    expect(counts.rows[0]).toEqual({
      consumptions: 1,
      successors: 1,
      routes: 1,
      dependencies: 0,
    });
    const successor = await pool.query(
      'SELECT status,payload,pr_url FROM tasks WHERE id=$1',
      [successorId],
    );
    expect(successor.rows[0].status).toBe('queued');
    expect(successor.rows[0].pr_url).toBeNull();
    expect(successor.rows[0].payload).not.toHaveProperty('contract_content');
    expect(successor.rows[0].payload).not.toHaveProperty('private_worker_path');
    expect(Object.keys(successor.rows[0].payload).sort()).toEqual([
      'base_sha',
      'branch',
      'change_kind',
      'default_execution_profile',
      'execution_profile_override',
      'harness_runtime',
      'impact_contract_required',
      'initiative_id',
      'map_scope',
      'orchestrator',
      'planner_recovery_receipt_id',
      'predecessor_run_id',
      'repo',
      'requested_task_type',
      'routing_receipt_id',
      'work_kind',
    ]);
    const after = await pool.query('SELECT status,payload,pr_url FROM tasks WHERE id=$1', [fixture.taskId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('rolls back the successor and routing receipt when consumption fails', async () => {
    const fixture = await seedRecoverablePlannerSource();
    const receipt = await pool.query(
      'SELECT id FROM planner_recovery_receipts WHERE planner_attempt_id=$1',
      [fixture.attemptId],
    );
    const createThenFail = async (...args) => {
      await createRoutedTask(...args);
      throw new Error('injected planner consumption failure');
    };

    await expect(consumePlannerRecoveryReceipt(pool, {
      predecessorRunId: fixture.runId,
    }, { createRoutedTaskFn: createThenFail })).rejects.toThrow(
      'injected planner consumption failure',
    );
    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM planner_recovery_consumptions
           WHERE receipt_id=$1) AS consumptions,
         (SELECT COUNT(*)::int FROM tasks
           WHERE payload->>'planner_recovery_receipt_id'=$1::text) AS successors,
         (SELECT COUNT(*)::int FROM work_routing_receipts
           WHERE source='child' AND source_id=$2) AS routes`,
      [receipt.rows[0].id, `planner-recovery:${receipt.rows[0].id}`],
    );
    expect(counts.rows[0]).toEqual({ consumptions: 0, successors: 0, routes: 0 });
  });

  it('rejects recovery before both the trusted v2 run and source task are failed', async () => {
    const fixture = await seedRecoverablePlannerSource({ terminal: false });

    await expect(consumePlannerRecoveryReceipt(pool, {
      predecessorRunId: fixture.runId,
    })).rejects.toMatchObject({
      code: 'planner_recovery_source_not_eligible',
      httpStatus: 409,
    });
  });

  it('rejects UPDATE and DELETE on a consumed receipt', async () => {
    const fixture = await seedRecoverablePlannerSource();
    const consumed = await consumePlannerRecoveryReceipt(pool, {
      predecessorRunId: fixture.runId,
    });
    await expect(pool.query(
      'UPDATE planner_recovery_consumptions SET idempotency_key=idempotency_key WHERE receipt_id=$1',
      [consumed.receipt_id],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(
      'DELETE FROM planner_recovery_consumptions WHERE receipt_id=$1',
      [consumed.receipt_id],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('fails closed when rollback would drop a non-empty consumption ledger', async () => {
    const rollbackClient = await pool.connect();
    try {
      await expect(rollbackClient.query(downSql)).rejects.toMatchObject({ code: '23514' });
      await rollbackClient.query('ROLLBACK');
    } finally {
      rollbackClient.release();
    }
    const preserved = await pool.query(
      'SELECT COUNT(*)::int AS count FROM planner_recovery_consumptions',
    );
    expect(preserved.rows[0].count).toBeGreaterThan(0);
  });
});
