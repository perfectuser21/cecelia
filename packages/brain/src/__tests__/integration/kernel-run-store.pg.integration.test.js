import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import pool from '../../db.js';
import initiativesRouter from '../../routes/initiatives.js';
import {
  createKernelRun,
  finalizeKernelRun,
  loadActiveKernelRun,
  reconcileKernelTaskTerminal,
} from '../../orchestrator/kernel-run-store.js';

const migrationUrl = new URL(
  '../../../migrations/375_kernel_run_identity.sql',
  import.meta.url,
);
const trustMigrationUrl = new URL(
  '../../../migrations/376_kernel_run_trust.sql',
  import.meta.url,
);
const schema = `kernel_run_store_${process.pid}_${randomUUID().replaceAll('-', '')}`;

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

const searchPath = `${quoteIdentifier(schema)}, public`;

const schemaPool = {
  async connect() {
    const client = await pool.connect();
    await client.query(`SET search_path TO ${searchPath}`);
    const release = client.release.bind(client);
    client.release = () => {
      void client.query('RESET search_path').finally(release);
    };
    return client;
  },
  async query(sql, params) {
    const client = await this.connect();
    try {
      return await client.query(sql, params);
    } finally {
      client.release();
    }
  },
};

async function insertTask(taskId, initiativeId) {
  await schemaPool.query(
    `INSERT INTO tasks (id,task_type,status,payload)
     VALUES ($1,'harness_initiative','in_progress',$2::jsonb)`,
    [taskId, JSON.stringify({ initiative_id: initiativeId })],
  );
}

function runInput(taskId, initiativeId, createdSource = 'kernel_dispatch') {
  return {
    taskId,
    initiativeId,
    phase: 'planning',
    journeyId: null,
    abilityId: null,
    host: 'kernel-v1',
    deadlineHours: 8,
    createdSource,
  };
}

beforeAll(async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const trustMigration = await readFile(trustMigrationUrl, 'utf8');
  await pool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  await schemaPool.query(`
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
      commander_mode TEXT NOT NULL DEFAULT 'kernel-only'
        CHECK (commander_mode IN ('legacy-session','kernel-only','hybrid')),
      orchestrator_host TEXT,
      orchestrator_heartbeat_at TIMESTAMPTZ,
      orchestrator_pid INTEGER,
      journey_id UUID,
      ability_id UUID,
      deadline_at TIMESTAMPTZ,
      failure_reason TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE TABLE orchestrator_decision_log (
      run_id UUID NOT NULL,
      hop INTEGER NOT NULL,
      observed JSONB,
      derived_phase TEXT,
      gate_verdict TEXT,
      action TEXT,
      detail JSONB
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
  await schemaPool.query(migration);
  await schemaPool.query(trustMigration);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
  await pool.end();
});

describe('Kernel run store PostgreSQL concurrency', () => {
  it('leaves no active attempt when its exact parent run becomes terminal', async () => {
    const taskId = randomUUID();
    const initiativeId = randomUUID();
    await insertTask(taskId, initiativeId);
    const created = await createKernelRun(
      schemaPool,
      runInput(taskId, initiativeId),
    );
    const attemptId = randomUUID();
    await schemaPool.query(
      `INSERT INTO harness_attempts (
         id,run_id,status,lease_owner,lease_expires_at
       ) VALUES ($1,$2,'running','brain:test',NOW() + INTERVAL '3 minutes')`,
      [attemptId, created.run.id],
    );

    const receipt = await finalizeKernelRun(schemaPool, {
      runId: created.run.id,
      expectedTaskId: taskId,
      outcome: 'failed',
      reason: 'integration_terminal_attempt',
    });

    const state = await schemaPool.query(
      `SELECT status,lease_owner,lease_expires_at,error_code,completed_at
         FROM harness_attempts
        WHERE id=$1`,
      [attemptId],
    );
    expect(receipt.attemptsTerminalized).toBe(1);
    expect(state.rows[0]).toMatchObject({
      status: 'cancelled',
      lease_owner: null,
      lease_expires_at: null,
      error_code: 'parent_run_terminal',
    });
    expect(state.rows[0].completed_at).toBeInstanceOf(Date);
  });

  it('deduplicates simultaneous canonical POSTs to one active run', async () => {
    const taskId = randomUUID();
    const initiativeId = randomUUID();
    await insertTask(taskId, initiativeId);

    const app = express();
    app.set('pool', schemaPool);
    app.use(express.json());
    app.use('/api/brain/orchestrator', initiativesRouter);
    const body = {
      initiative_id: initiativeId,
      current_task_id: taskId,
      created_source: 'foreground_handoff',
      phase: 'planning',
    };

    const responses = await Promise.all([
      request(app).post('/api/brain/orchestrator/relay-runs').send(body),
      request(app).post('/api/brain/orchestrator/relay-runs').send(body),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    expect(responses[0].body.run.id).toBe(responses[1].body.run.id);
    const active = await schemaPool.query(
      `SELECT id,commander_mode
         FROM initiative_runs
        WHERE current_task_id=$1
          AND orchestrator_version='v2'
          AND phase NOT IN ('done','failed')`,
      [taskId],
    );
    expect(active.rows).toHaveLength(1);
    expect(active.rows[0].commander_mode).toBe('kernel-only');
  });

  it('persists and returns an explicit hybrid mode through the canonical API', async () => {
    const taskId = randomUUID();
    const initiativeId = randomUUID();
    await insertTask(taskId, initiativeId);

    const app = express();
    app.set('pool', schemaPool);
    app.use(express.json());
    app.use('/api/brain/orchestrator', initiativesRouter);
    const created = await request(app)
      .post('/api/brain/orchestrator/relay-runs')
      .send({
        initiative_id: initiativeId,
        current_task_id: taskId,
        created_source: 'foreground_handoff',
        commander_mode: 'hybrid',
      });

    expect(created.status).toBe(201);
    const persisted = await schemaPool.query(
      'SELECT commander_mode FROM initiative_runs WHERE id=$1',
      [created.body.run.id],
    );
    expect(persisted.rows).toEqual([{ commander_mode: 'hybrid' }]);

    const loaded = await loadActiveKernelRun(schemaPool, taskId);
    expect(loaded.commander_mode).toBe('hybrid');
  });

  it('persists kernel-only when the Store input omits commander mode', async () => {
    const taskId = randomUUID();
    const initiativeId = randomUUID();
    await insertTask(taskId, initiativeId);

    const created = await createKernelRun(
      schemaPool,
      runInput(taskId, initiativeId),
    );
    const persisted = await schemaPool.query(
      'SELECT commander_mode FROM initiative_runs WHERE id=$1',
      [created.run.id],
    );

    expect(persisted.rows).toEqual([{ commander_mode: 'kernel-only' }]);
  });

  it('uses one lock order for create/finalize interleaving without deadlock', async () => {
    const taskId = randomUUID();
    const initiativeId = randomUUID();
    await insertTask(taskId, initiativeId);
    const created = await createKernelRun(
      schemaPool,
      runInput(taskId, initiativeId),
    );

    await schemaPool.query(`
      CREATE OR REPLACE FUNCTION pause_kernel_terminal_update()
      RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_sleep(0.2);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER pause_kernel_terminal_update
      BEFORE UPDATE OF phase ON initiative_runs
      FOR EACH ROW
      WHEN (
        OLD.phase NOT IN ('done','failed')
        AND NEW.phase IN ('done','failed')
      )
      EXECUTE FUNCTION pause_kernel_terminal_update();
    `);

    const finalizing = finalizeKernelRun(schemaPool, {
      runId: created.run.id,
      expectedTaskId: taskId,
      outcome: 'failed',
      reason: 'integration_interleaving',
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const recovering = createKernelRun(
      schemaPool,
      runInput(taskId, initiativeId, 'explicit_recovery'),
    );
    const results = await Promise.allSettled([finalizing, recovering]);

    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason?.code).not.toBe('40P01');
      }
    }
    expect(results[0].status).toBe('fulfilled');
    const state = await schemaPool.query(
      `SELECT r.phase,t.status
         FROM initiative_runs r
         JOIN tasks t ON t.id=r.current_task_id
        WHERE r.id=$1`,
      [created.run.id],
    );
    expect(state.rows).toEqual([{ phase: 'failed', status: 'failed' }]);
  });

  it('orphan reconciliation cannot terminalize a task after recovery creates an active run', async () => {
    const taskId = randomUUID();
    const initiativeId = randomUUID();
    await insertTask(taskId, initiativeId);
    const old = await createKernelRun(
      schemaPool,
      runInput(taskId, initiativeId),
    );
    await finalizeKernelRun(schemaPool, {
      runId: old.run.id,
      expectedTaskId: taskId,
      outcome: 'failed',
      reason: 'old_attempt_failed',
    });
    await schemaPool.query(
      `UPDATE tasks SET status = 'in_progress' WHERE id = $1`,
      [taskId],
    );

    let activeRunId = null;
    const finalizeAfterRecovery = async (targetPool, options) => {
      const recovery = await createKernelRun(
        targetPool,
        runInput(taskId, initiativeId, 'explicit_recovery'),
      );
      activeRunId = recovery.run.id;
      return finalizeKernelRun(targetPool, options);
    };
    await expect(reconcileKernelTaskTerminal(
      schemaPool,
      taskId,
      { finalizeRun: finalizeAfterRecovery },
    )).rejects.toThrow(/active sibling/);

    const state = await schemaPool.query(
      `SELECT t.status AS task_status, r.phase AS active_phase
         FROM tasks t
         JOIN initiative_runs r ON r.current_task_id = t.id
        WHERE t.id = $1 AND r.id = $2`,
      [taskId, activeRunId],
    );
    expect(state.rows).toEqual([{
      task_status: 'in_progress',
      active_phase: 'planning',
    }]);
  });
});
