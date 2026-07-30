import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import pool from '../../db.js';

const identityMigrationUrl = new URL(
  '../../../migrations/375_kernel_run_identity.sql',
  import.meta.url,
);
const trustMigrationUrl = new URL(
  '../../../migrations/376_kernel_run_trust.sql',
  import.meta.url,
);
const insertLockMigrationUrl = new URL(
  '../../../migrations/377_initiative_run_insert_identity_lock.sql',
  import.meta.url,
);
const schema = `exact_run_${process.pid}_${randomUUID().replaceAll('-', '')}`;

let client;
let app;
let initiativeId;
let targetRunId;
let beforeById;

const adapter = {
  query: (...args) => client.query(...args),
  connect: async () => ({
    query: (...args) => client.query(...args),
    release: () => {},
  }),
};

async function snapshotRuns() {
  const { rows } = await client.query(
    `SELECT id::text,phase,completed_at::text,failure_reason,pr_url,
            evaluate_verdict,judge_verdict,cost_usd::text,updated_at::text
       FROM initiative_runs
      WHERE initiative_id=$1
      ORDER BY id`,
    [initiativeId],
  );
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

beforeAll(async () => {
  const identityMigration = await readFile(identityMigrationUrl, 'utf8');
  const trustMigration = await readFile(trustMigrationUrl, 'utf8');
  const insertLockMigration = await readFile(insertLockMigrationUrl, 'utf8');
  client = await pool.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE tasks (
      id UUID PRIMARY KEY,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE initiative_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      initiative_id UUID NOT NULL,
      current_task_id UUID,
      phase TEXT NOT NULL,
      orchestrator_version TEXT,
      orchestrator_heartbeat_at TIMESTAMPTZ,
      orchestrator_pid INTEGER,
      orchestrator_host TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deadline_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      failure_reason TEXT,
      pr_url TEXT,
      evaluate_verdict TEXT,
      judge_verdict TEXT,
      cost_usd NUMERIC
    );
    CREATE TABLE orchestrator_decision_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL,
      hop INTEGER NOT NULL,
      observed JSONB NOT NULL,
      derived_phase TEXT NOT NULL,
      gate_verdict TEXT NOT NULL,
      action TEXT NOT NULL,
      detail JSONB NOT NULL,
      UNIQUE(run_id,hop)
    );
    CREATE TABLE harness_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES initiative_runs(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error_code TEXT,
      error_message TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(identityMigration);
  await client.query(trustMigration);
  await client.query(insertLockMigration);

  initiativeId = randomUUID();
  for (let index = 0; index < 25; index += 1) {
    const taskId = randomUUID();
    await client.query(
      `INSERT INTO tasks(id,task_type,status,payload,completed_at)
       VALUES($1,'harness_initiative','completed',$2::jsonb,NOW())`,
      [taskId, JSON.stringify({ initiative_id: initiativeId })],
    );
    const inserted = await client.query(
      `INSERT INTO initiative_runs(
         initiative_id,current_task_id,phase,orchestrator_version,created_source,
         record_trust_status,completed_at
       ) VALUES($1,$2,'done','v2','legacy_relay','untrusted',NOW())
       RETURNING id`,
      [initiativeId, taskId],
    );
    if (index === 12) targetRunId = inserted.rows[0].id;
  }
  beforeById = await snapshotRuns();

  const { default: router } = await import('../../routes/initiatives.js');
  app = express();
  app.use(express.json());
  app.set('pool', adapter);
  app.use('/api/brain/orchestrator', router);
});

afterAll(async () => {
  if (client) {
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
  }
  await pool.end();
});

describe('exact relay run API [PostgreSQL]', () => {
  it('R1 changes one selected run and leaves the other 24 byte-equivalent', async () => {
    const prUrl = 'https://github.com/perfectuser21/cecelia/pull/4502';
    const response = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/by-id/${targetRunId}`)
      .send({ phase: 'done', pr_url: prUrl });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: targetRunId,
      phase: 'done',
      pr_url: prUrl,
    });

    const afterById = await snapshotRuns();
    expect(Object.keys(afterById)).toHaveLength(25);
    expect(afterById[targetRunId].pr_url).toBe(prUrl);
    for (const [runId, before] of Object.entries(beforeById)) {
      if (runId === targetRunId) continue;
      expect(afterById[runId]).toEqual(before);
    }
  });

  it('reads the same row by run id and returns all history in stable order', async () => {
    const exact = await request(app)
      .get(`/api/brain/orchestrator/relay-runs/by-id/${targetRunId}`);
    expect(exact.status).toBe(200);
    expect(exact.body.id).toBe(targetRunId);

    const history = await request(app)
      .get(`/api/brain/orchestrator/relay-initiatives/${initiativeId}/runs`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(25);
    const expected = await client.query(
      `SELECT id::text
         FROM initiative_runs
        WHERE initiative_id=$1
        ORDER BY started_at DESC,id DESC`,
      [initiativeId],
    );
    expect(history.body.map(({ id }) => id)).toEqual(
      expected.rows.map(({ id }) => id),
    );
  });

  it('atomically terminalizes an active run and task, rolling both back on task failure', async () => {
    const taskId = randomUUID();
    const runId = randomUUID();
    const attemptId = randomUUID();
    await client.query(
      `INSERT INTO tasks(id,task_type,status,payload)
       VALUES($1,'harness_initiative','in_progress',$2::jsonb)`,
      [taskId, JSON.stringify({ initiative_id: initiativeId })],
    );
    await client.query(
      `INSERT INTO initiative_runs(
         id,initiative_id,current_task_id,phase,orchestrator_version,
         created_source,record_trust_status
       ) VALUES($1,$2,$3,'generate','v2','kernel_dispatch','trusted')`,
      [runId, initiativeId, taskId],
    );
    await client.query(
      `INSERT INTO harness_attempts (
         id,run_id,status,lease_owner,lease_expires_at
       ) VALUES ($1,$2,'running','exact-api-worker',NOW() + INTERVAL '2 minutes')`,
      [attemptId, runId],
    );
    await client.query(`
      CREATE OR REPLACE FUNCTION reject_test_task_failure()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = '${taskId}'::uuid AND NEW.status = 'failed' THEN
          RAISE EXCEPTION 'injected task write failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_test_task_failure
      BEFORE UPDATE ON tasks
      FOR EACH ROW EXECUTE FUNCTION reject_test_task_failure();
    `);

    const failed = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/by-id/${runId}`)
      .send({ phase: 'failed', failure_reason: 'test_failure' });
    expect(failed.status).toBe(500);
    const rolledBack = await client.query(
      `SELECT r.phase,t.status,a.status AS attempt_status
         FROM initiative_runs r
         JOIN tasks t ON t.id=r.current_task_id
         JOIN harness_attempts a ON a.run_id=r.id
        WHERE r.id=$1`,
      [runId],
    );
    expect(rolledBack.rows[0]).toEqual({
      phase: 'generate',
      status: 'in_progress',
      attempt_status: 'running',
    });

    await client.query('DROP TRIGGER reject_test_task_failure ON tasks');
    const succeeded = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/by-id/${runId}`)
      .send({ phase: 'failed', failure_reason: 'test_failure' });
    expect(succeeded.status).toBe(200);
    const committed = await client.query(
      `SELECT r.phase,t.status,a.status AS attempt_status,
              a.error_code,a.lease_owner,a.lease_expires_at
         FROM initiative_runs r
         JOIN tasks t ON t.id=r.current_task_id
         JOIN harness_attempts a ON a.run_id=r.id
        WHERE r.id=$1`,
      [runId],
    );
    expect(committed.rows[0]).toEqual({
      phase: 'failed',
      status: 'failed',
      attempt_status: 'cancelled',
      error_code: 'parent_run_terminal',
      lease_owner: null,
      lease_expires_at: null,
    });
  });
});
