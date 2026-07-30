import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pool from '../../db.js';

const identityMigrationUrl = new URL(
  '../../../migrations/375_kernel_run_identity.sql',
  import.meta.url,
);
const trustMigrationUrl = new URL(
  '../../../migrations/376_kernel_run_trust.sql',
  import.meta.url,
);
const schema = `migration_376_${process.pid}_${randomUUID().replaceAll('-', '')}`;

let client;
let historicalRunId;
let taskId;
let initiativeId;

async function expectConstraintFailure(operation) {
  await client.query('SAVEPOINT expected_constraint_failure');
  try {
    await expect(operation()).rejects.toThrow();
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_constraint_failure');
    await client.query('RELEASE SAVEPOINT expected_constraint_failure');
  }
}

beforeAll(async () => {
  const identityMigration = await readFile(identityMigrationUrl, 'utf8');
  const trustMigration = await readFile(trustMigrationUrl, 'utf8');
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
  await client.query(identityMigration);
  historicalRunId = (await client.query(
    `INSERT INTO initiative_runs (
       initiative_id,current_task_id,phase,orchestrator_version,created_source
     ) VALUES ($1,$2,'failed','v2','legacy_relay')
     RETURNING id`,
    [initiativeId, taskId],
  )).rows[0].id;

  await client.query(trustMigration);
  await client.query(trustMigration);
});

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    client.release();
  }
  await pool.end();
});

describe('migration 376 Kernel run trust [PostgreSQL]', () => {
  it('keeps every pre-migration row untrusted instead of guessing', async () => {
    const { rows } = await client.query(
      `SELECT record_trust_status,record_trust_reason,predecessor_run_id
         FROM initiative_runs
        WHERE id=$1`,
      [historicalRunId],
    );
    expect(rows).toEqual([{
      record_trust_status: 'untrusted',
      record_trust_reason: null,
      predecessor_run_id: null,
    }]);
  });

  it('accepts only the three trust states', async () => {
    await expectConstraintFailure(() => client.query(
      `UPDATE initiative_runs
          SET record_trust_status='guessed'
        WHERE id=$1`,
      [historicalRunId],
    ));
    await expect(client.query(
      `UPDATE initiative_runs
          SET record_trust_status='reconstructed',
              record_trust_reason='direct_task_reference'
        WHERE id=$1`,
      [historicalRunId],
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it('enforces predecessor lineage without rewriting the predecessor', async () => {
    const successor = await client.query(
      `INSERT INTO initiative_runs (
         initiative_id,current_task_id,phase,orchestrator_version,created_source,
         record_trust_status,predecessor_run_id
       ) VALUES ($1,$2,'failed','v2','explicit_recovery','trusted',$3)
       RETURNING predecessor_run_id,record_trust_status`,
      [initiativeId, taskId, historicalRunId],
    );
    expect(successor.rows[0]).toEqual({
      predecessor_run_id: historicalRunId,
      record_trust_status: 'trusted',
    });
    await expectConstraintFailure(() => client.query(
      `INSERT INTO initiative_runs (
         initiative_id,current_task_id,phase,orchestrator_version,created_source,
         record_trust_status,predecessor_run_id
       ) VALUES ($1,$2,'failed','v2','explicit_recovery','trusted',$3)`,
      [initiativeId, taskId, randomUUID()],
    ));
  });
});
