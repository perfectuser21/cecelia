import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { runMigrations } from '../../migrate.js';

const migrationsUrl = new URL('../../../migrations/', import.meta.url);
const schemaName = `commander_367_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const relevantMigrations = [
  '312_orchestrator_runs_state.sql',
  '357_harness_provider_attempts.sql',
  '361_kernel_attempt_telemetry.sql',
  '362_kernel_attempt_telemetry_reconcile.sql',
  '363_kernel_fleet_execution_receipts.sql',
  '364_kernel_local_container_naming.sql',
  '366_kernel_harness_failure_class.sql',
];

let adminPool;
let migrationPool;
let setupClient;

beforeAll(async () => {
  adminPool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  setupClient = await adminPool.connect();
  await setupClient.query(`SET search_path TO ${quotedSchema}, public`);
  await setupClient.query(`
    CREATE TABLE schema_version (
      version VARCHAR(10) PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE initiative_runs (
      id UUID PRIMARY KEY,
      phase TEXT NOT NULL DEFAULT 'planning',
      failure_reason TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  for (const file of relevantMigrations) {
    await setupClient.query(readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8'));
  }

  const versionsExcept367 = readdirSync(migrationsUrl)
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .map((file) => file.split('_')[0])
    .filter((version) => Number(version) !== 367);
  await setupClient.query(
    `INSERT INTO schema_version (version, description)
     SELECT version, 'pre-367 fixture'
       FROM UNNEST($1::text[]) AS version
     ON CONFLICT (version) DO NOTHING`,
    [versionsExcept367],
  );

  migrationPool = new pg.Pool({
    ...DB_DEFAULTS,
    options: `-c search_path=${schemaName},public`,
    max: 3,
  });
}, 15_000);

afterAll(async () => {
  if (setupClient) setupClient.release();
  if (migrationPool) await migrationPool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await adminPool.end();
  }
});

describe('migration 367 through the real PostgreSQL migration runner', () => {
  it('applies once and transactionally projects bounded Run and Attempt events', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(runMigrations(migrationPool)).resolves.toEqual(['367']);
    } finally {
      log.mockRestore();
    }

    const runId = randomUUID();
    const attemptId = randomUUID();
    await migrationPool.query(
      `INSERT INTO initiative_runs (id, commander_mode) VALUES ($1,'hybrid')`,
      [runId],
    );
    await migrationPool.query(
      `INSERT INTO harness_attempts
         (id,run_id,hop,phase,role,provider,task_bundle,callback_secret_hash)
       VALUES ($1,$2,1,'planning','planner','codex','{}','hash')`,
      [attemptId, runId],
    );
    await migrationPool.query(
      `UPDATE harness_attempts SET status='starting', updated_at=NOW() WHERE id=$1`,
      [attemptId],
    );

    const events = await migrationPool.query(
      `SELECT cursor,event_type,payload
         FROM harness_run_events
        WHERE run_id=$1
        ORDER BY cursor`,
      [runId],
    );
    expect(events.rows).toMatchObject([
      { cursor: '1', event_type: 'run.created' },
      { cursor: '2', event_type: 'attempt.starting' },
    ]);
    expect(JSON.stringify(events.rows)).not.toMatch(
      /task_bundle|callback_secret|provider_session_id|error_message|auth|token/i,
    );

    await migrationPool.query('BEGIN');
    await migrationPool.query(
      `UPDATE harness_attempts SET status='running', updated_at=NOW() WHERE id=$1`,
      [attemptId],
    );
    await migrationPool.query('ROLLBACK');
    const afterRollback = await migrationPool.query(
      'SELECT event_type FROM harness_run_events WHERE run_id=$1 ORDER BY cursor',
      [runId],
    );
    expect(afterRollback.rows.map(({ event_type }) => event_type)).toEqual([
      'run.created',
      'attempt.starting',
    ]);
  });

  it('deduplicates source replay and allocates cursors independently per Run', async () => {
    const runA = randomUUID();
    const runB = randomUUID();
    await migrationPool.query('INSERT INTO initiative_runs (id) VALUES ($1),($2)', [runA, runB]);

    const first = await migrationPool.query(
      `SELECT append_harness_run_event(
         $1,'commander.directive_rejected','commander_directive','directive-1',0,
         '{"reason_code":"stale_event_cursor"}'::jsonb,NOW()
       ) AS cursor`,
      [runA],
    );
    const replay = await migrationPool.query(
      `SELECT append_harness_run_event(
         $1,'commander.directive_rejected','commander_directive','directive-1',0,
         '{"reason_code":"ignored_replay"}'::jsonb,NOW()
       ) AS cursor`,
      [runA],
    );
    expect(replay.rows[0].cursor).toBe(first.rows[0].cursor);

    const cursors = await migrationPool.query(
      `SELECT run_id,cursor,event_type
         FROM harness_run_events
        WHERE run_id = ANY($1::uuid[])
        ORDER BY run_id,cursor`,
      [[runA, runB]],
    );
    expect(cursors.rows.filter((row) => row.run_id === runA).map((row) => row.cursor)).toEqual(['1', '2']);
    expect(cursors.rows.filter((row) => row.run_id === runB).map((row) => row.cursor)).toEqual(['1']);
  });

  it('is idempotent through the migration runner', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(runMigrations(migrationPool)).resolves.toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
});
