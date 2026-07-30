import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pool from '../../db.js';

const migrationUrl = new URL(
  '../../../migrations/375_kernel_run_identity.sql',
  import.meta.url,
);
const schema = `migration_375_${process.pid}_${randomUUID().replaceAll('-', '')}`;

let client;
let migration;
let taskId;
let initiativeId;
let historicalRunId;

async function expectConstraintFailure(operation) {
  await client.query('SAVEPOINT expected_constraint_failure');
  try {
    await expect(operation()).rejects.toThrow();
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_constraint_failure');
    await client.query('RELEASE SAVEPOINT expected_constraint_failure');
  }
}

async function insertRun({
  phase = 'planning',
  source = 'kernel_dispatch',
  currentTaskId = taskId,
} = {}) {
  return client.query(
    `INSERT INTO initiative_runs (
       initiative_id, current_task_id, phase, orchestrator_version, created_source
     ) VALUES ($1,$2,$3,'v2',$4)
     RETURNING id,current_task_id,phase,created_source`,
    [initiativeId, currentTaskId, phase, source],
  );
}

beforeAll(async () => {
  migration = await readFile(migrationUrl, 'utf8');
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE tasks (
      id UUID PRIMARY KEY,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE initiative_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      initiative_id UUID NOT NULL,
      current_task_id UUID,
      phase TEXT NOT NULL,
      orchestrator_version TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `);

  taskId = randomUUID();
  initiativeId = randomUUID();
  await client.query(
    `INSERT INTO tasks (id,task_type,status)
     VALUES ($1,'harness_initiative','in_progress')`,
    [taskId],
  );
  historicalRunId = (await client.query(
    `INSERT INTO initiative_runs (
       initiative_id,current_task_id,phase,orchestrator_version
     ) VALUES ($1,NULL,'failed','v2')
     RETURNING id`,
    [initiativeId],
  )).rows[0].id;

  await client.query(migration);
  await client.query(migration);
});

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    client.release();
  }
  await pool.end();
});

describe('migration 375 Kernel run identity [PostgreSQL]', () => {
  it('preserves pre-cutover NULL identity history', async () => {
    const historical = await client.query(
      'SELECT id,current_task_id,created_source FROM initiative_runs WHERE id=$1',
      [historicalRunId],
    );
    expect(historical.rows).toEqual([{
      id: historicalRunId,
      current_task_id: null,
      created_source: null,
    }]);
  });

  it('rejects every new v2 row missing task identity or source', async () => {
    await expectConstraintFailure(() => client.query(
      `INSERT INTO initiative_runs (
         initiative_id,current_task_id,phase,orchestrator_version,created_source
       ) VALUES ($1,NULL,'planning','v2','kernel_dispatch')`,
      [initiativeId],
    ));
    await expectConstraintFailure(() => client.query(
      `INSERT INTO initiative_runs (
         initiative_id,current_task_id,phase,orchestrator_version,created_source
       ) VALUES ($1,$2,'planning','v2',NULL)`,
      [initiativeId, taskId],
    ));
  });

  it('rejects unknown sources and task ids', async () => {
    await expectConstraintFailure(() => insertRun({ source: 'invented_source' }));
    await expectConstraintFailure(() => insertRun({ currentTaskId: randomUUID() }));
  });

  it('allows only one active v2 run per task while retaining terminal history', async () => {
    const first = await insertRun();
    expect(first.rows[0]).toMatchObject({
      current_task_id: taskId,
      phase: 'planning',
      created_source: 'kernel_dispatch',
    });

    await expectConstraintFailure(() => insertRun({
      phase: 'generate',
      source: 'foreground_handoff',
    }));

    await client.query(
      `UPDATE initiative_runs
          SET phase='failed',completed_at=NOW()
        WHERE id=$1`,
      [first.rows[0].id],
    );

    const successor = await insertRun({
      source: 'explicit_recovery',
    });
    expect(successor.rows[0]).toMatchObject({
      current_task_id: taskId,
      phase: 'planning',
      created_source: 'explicit_recovery',
    });
  });
});
